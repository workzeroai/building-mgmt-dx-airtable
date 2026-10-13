// 오류 요약 알림: 규칙 기반 3줄 요약(기본) · LLM 요약(키가 있을 때만, 실패 시 규칙으로) · 웹훅 · 반복 억제
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLlmFromEnv, createNotifier, sanitize, summarizeByRules } from '../src/core/notify.js';
import { StagingGuardError } from '../src/core/errors.js';
import { REPO_ROOT } from '../src/core/paths.js';
import { mockFetch, silent } from './helpers.js';

function fakeClaude(reply) {
  const calls = [];
  return {
    calls,
    messages: {
      async create(body) {
        calls.push(body);
        if (reply instanceof Error) throw reply;
        return reply;
      },
    },
  };
}

test('규칙 기반 요약: 오류·위치·조치 3줄, 경로·키는 가린다', () => {
  const err = new StagingGuardError('스테이징 쓰기 차단: customers ID "cus_9" 매핑 없음 key=SECRET123');
  const lines = summarizeByRules(err, { method: 'POST', path: '/api/quotes' });
  assert.equal(lines.length, 3);
  assert.match(lines[0], /^StagingGuardError\(STAGING_ID_GUARD\): /u);
  assert.match(lines[0], /key=\*\*\*/u);
  assert.match(lines[1], /요청: POST \/api\/quotes/u);
  assert.ok(!lines[1].includes(REPO_ROOT), '절대 경로를 남기지 않는다');
  assert.match(lines[2], /매핑표/u);
  assert.match(summarizeByRules(new Error('x'), { where: '배치' })[1], /요청: 배치/u);
  assert.equal(sanitize('Authorization: Bearer abc.def serviceKey=zzz'), 'Authorization: Bearer *** serviceKey=***');
});

test('웹훅이 없으면 콘솔, 있으면 디스코드 형식으로 보낸다', async () => {
  const logged = [];
  const consoleOnly = createNotifier({ logger: { ...silent, error: (m) => logged.push(m) } });
  const r1 = await consoleOnly.notifyError(new Error('boom'));
  assert.equal(r1.channel, 'console');
  assert.equal(r1.summarySource, 'rules');
  assert.match(logged[0], /견적 서버 오류/u);

  const fetchImpl = mockFetch(() => ({ status: 204, body: {} }));
  const hook = createNotifier({ webhookUrl: 'https://example.invalid/webhook', fetchImpl, logger: silent });
  const r2 = await hook.notifyError(Object.assign(new Error('PDF 변환 시간 초과'), { code: 'PDF_TIMEOUT' }), { method: 'POST', path: '/api/quotes' });
  assert.equal(r2.delivered, true);
  const payload = JSON.parse(fetchImpl.calls[0].init.body);
  assert.equal(payload.embeds[0].title, '견적 서버 오류 · PDF_TIMEOUT');
  assert.equal(payload.embeds[0].description.split('\n').length, 3);
  assert.equal(payload.embeds[0].fields[0].value, '규칙 기반 요약');
  await hook.notifyEvent('PDF 서킷브레이커 closed → open', 'token=abc 연속 실패', 'danger');
  assert.match(JSON.parse(fetchImpl.calls[1].init.body).embeds[0].description, /token=\*\*\*/u);

  const broken = createNotifier({ webhookUrl: 'https://example.invalid/webhook', fetchImpl: mockFetch(() => new Error('ECONNREFUSED')), logger: silent });
  assert.equal((await broken.notifyError(new Error('x'))).delivered, false, '웹훅 실패가 서버를 멈추지 않는다');
});

test('같은 오류가 10분 안에 반복되면 한 번만 보내고 건수만 센다', async () => {
  let now = 0;
  const n = createNotifier({ logger: silent, now: () => now });
  const make = () => Object.assign(new Error('같은 오류'), { code: 'X' });
  assert.equal((await n.notifyError(make())).channel, 'console');
  assert.deepEqual(await n.notifyError(make()), { suppressed: true, count: 2 });
  now = 10 * 60 * 1000 + 1;
  assert.equal((await n.notifyError(make())).channel, 'console');
  assert.equal(n.status().suppressed, 1);
});

test('LLM 요약(선택): 키가 있을 때만, 3줄이면 사용하고 표시를 남긴다', async () => {
  const client = fakeClaude({ stop_reason: 'end_turn', content: [{ type: 'text', text: '1. 스테이징 매핑 누락\n2. guard.js · POST /api/quotes\n3. id-map.json 확인' }] });
  const n = createNotifier({ llm: { client, model: 'claude-opus-5-5' }, logger: silent });
  const r = await n.notifyError(new Error('boom key=abc'), { method: 'POST', path: '/api/quotes' });
  assert.equal(r.summarySource, 'llm');
  assert.equal(r.payload.embeds[0].fields[0].value, 'LLM 요약');
  assert.deepEqual(r.payload.embeds[0].description.split('\n'), ['스테이징 매핑 누락', 'guard.js · POST /api/quotes', 'id-map.json 확인']);
  assert.equal(client.calls[0].model, 'claude-opus-5-5');
  assert.ok(!client.calls[0].messages[0].content.includes('key=abc'), 'LLM에 보내기 전에 키를 가린다');
});

test('LLM 요약 실패·거절·형식 불일치 → 규칙 기반 요약으로 대체', async () => {
  for (const reply of [
    new Error('429 rate limited'),
    { stop_reason: 'refusal', content: [] },
    { stop_reason: 'end_turn', content: [{ type: 'text', text: '한 줄만' }] },
  ]) {
    const n = createNotifier({ llm: { client: fakeClaude(reply), model: 'm' }, logger: silent });
    const r = await n.summarize(new Error('boom'), {});
    assert.equal(r.source, 'rules');
    assert.equal(r.lines.length, 3);
  }
});

test('ANTHROPIC_API_KEY가 없으면 LLM 요약기를 만들지 않는다', async () => {
  assert.equal(await createLlmFromEnv({}), null);
  const llm = await createLlmFromEnv({ ANTHROPIC_API_KEY: 'test-key-not-real', ANTHROPIC_MODEL: '' });
  assert.equal(llm.model, 'claude-opus-5-5');
  assert.equal(typeof llm.client.messages.create, 'function');
});
