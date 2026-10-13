// create-base.mjs: dry-run 스냅샷, 요청 계획의 규칙, 실제 실행기(가짜 Meta API)로 생성·건너뜀·오류.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { main, parseArgs } from '../create-base.mjs';
import { applyPlan, fieldRequest, planBase } from '../lib/meta-api.js';
import { COMPUTED_TYPES, baseByKey } from '../lib/schema.js';
import { fakeFetch } from '../automations/harness/airtable-harness.js';
import { model } from './helpers.js';

const SNAPSHOT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'snapshots', 'create-base.dry-run.txt');
const BASE_ID = 'appTESTTESTTEST01'; // qa-scan: allow

async function run(argv, options = {}) {
  const lines = [];
  const code = await main(argv, { log: (l) => lines.push(l), ...options });
  return { code, out: `${lines.join('\n')}\n` };
}

test('--dry-run 출력 스냅샷(4개 Base 전체). 바꿨다면 UPDATE_SNAPSHOTS=1 npm test', async () => {
  const { code, out } = await run(['--dry-run']);
  assert.equal(code, 0);
  if (process.env.UPDATE_SNAPSHOTS === '1' || !fs.existsSync(SNAPSHOT)) {
    fs.mkdirSync(path.dirname(SNAPSHOT), { recursive: true });
    fs.writeFileSync(SNAPSHOT, out, 'utf8');
  }
  assert.equal(out, fs.readFileSync(SNAPSHOT, 'utf8').replace(/\r\n/gu, '\n'));
  assert.match(out, /합계: Base 4 · 요청 \d+건 · 수동 추가 \d+건/u);
  assert.doesNotMatch(out, /pat[A-Za-z0-9]{10}|app[A-Za-z0-9]{14}/u, '토큰·실제 Base ID가 출력에 없다');
});

test('요청 계획: 첫 필드 = 기본 필드, 계산 필드는 요청에 없고 수동 목록에, 연결은 같은 Base 테이블을 가리킨다', () => {
  for (const base of model.bases) {
    const plan = planBase(model, base);
    const tables = plan.steps.filter((s) => s.kind === 'createTable');
    assert.equal(tables.length, base.tables.length);
    for (const s of tables) {
      const t = base.tables.find((x) => x.name === s.table);
      assert.equal(s.body.fields[0].name, t.primary, `${base.key}.${t.name} 기본 필드`);
      assert.ok(s.body.fields.every((f) => !COMPUTED_TYPES.includes(f.type) && f.type !== 'multipleRecordLinks'));
    }
    for (const s of plan.steps.filter((x) => x.kind === 'createLink')) {
      const target = s.body.options.linkedTableId.match(/^\{tableId:(.+)\}$/u)[1];
      assert.ok(base.tables.some((t) => t.name === target), `${s.table}.${s.field} → ${target}`);
    }
    const computed = base.tables.flatMap((t) => t.fields.filter((f) => COMPUTED_TYPES.includes(f.type)));
    assert.equal(plan.manual.length, computed.length);
  }
  assert.deepEqual(fieldRequest({ name: 'amount', type: 'currency' }).options, { precision: 0, symbol: '₩' });
  assert.equal(fieldRequest({ name: 'at', type: 'dateTime' }, { timeZone: 'Asia/Seoul' }).options.timeZone, 'Asia/Seoul');
  assert.equal(fieldRequest({ name: 'c', type: 'multilineText', json: true }).description, 'JSON 문자열');
});

/** 가짜 Meta API: 테이블·필드 생성, 연결이면 역방향 필드도 만든다. */
function fakeMeta({ existing = [], failOn = null } = {}) {
  const tables = existing.map((t, i) => ({ id: `tbl${i}`, name: t.name, fields: t.fields.map((f, j) => ({ id: `fld${i}_${j}`, ...f })) }));
  let seq = 100;
  return fakeFetch((url, init) => {
    const u = new URL(url);
    const parts = u.pathname.split('/'); // ['', 'v0', 'meta', 'bases', id, 'tables', tableId?, 'fields', fieldId?]
    if (failOn && failOn(init.method, u.pathname)) return { status: 422, body: { error: { type: 'INVALID_REQUEST' } } };
    if (init.method === 'GET') return { body: { tables } };
    const body = JSON.parse(init.body);
    if (parts.length === 6) {
      const t = { id: `tbl${seq += 1}`, name: body.name, fields: body.fields.map((f) => ({ id: `fld${seq += 1}`, ...f })) };
      tables.push(t);
      return { body: t };
    }
    const table = tables.find((t) => t.id === parts[6]);
    if (init.method === 'PATCH') {
      const f = tables.flatMap((t) => t.fields).find((x) => x.id === parts[8]);
      f.name = body.name;
      return { body: f };
    }
    const field = { id: `fld${seq += 1}`, ...body };
    if (body.type === 'multipleRecordLinks') {
      const target = tables.find((t) => t.id === body.options.linkedTableId);
      const inverse = { id: `fld${seq += 1}`, name: table.name, type: 'multipleRecordLinks', options: { linkedTableId: table.id, inverseLinkFieldId: field.id } };
      target.fields.push(inverse);
      field.options = { ...body.options, inverseLinkFieldId: inverse.id };
    }
    table.fields.push(field);
    return { body: field };
  });
}

test('실행기: 빈 Base에 테이블·연결을 만들고, 다시 실행하면 모두 건너뛴다', async () => {
  const hub = baseByKey(model, 'hub');
  const plan = planBase(model, hub);
  const fetchImpl = fakeMeta();
  const r1 = await applyPlan(plan, { baseId: BASE_ID, token: 't', fetchImpl, delayMs: 0 });
  assert.equal(r1.createdTables, hub.tables.length);
  assert.equal(r1.createdLinks, plan.steps.filter((s) => s.kind === 'createLink').length);
  const post = fetchImpl.calls.find((c) => c.init.method === 'POST');
  assert.equal(post.init.headers.Authorization, 'Bearer t');
  const linkCall = fetchImpl.calls.find((c) => c.init.body?.includes('multipleRecordLinks'));
  assert.match(JSON.parse(linkCall.init.body).options.linkedTableId, /^tbl\d+$/u, '자리표시가 실제 테이블 ID로 바뀐다');

  const n = fetchImpl.calls.length;
  const r2 = await applyPlan(plan, { baseId: BASE_ID, token: 't', fetchImpl, delayMs: 0 });
  assert.equal(r2.createdTables + r2.createdFields + r2.createdLinks, 0);
  assert.equal(fetchImpl.calls.length, n + 1, '다시 실행하면 GET 한 번뿐');
});

test('실행기: 일부만 있는 Base에는 빠진 필드만 추가, 역방향 이름 바꾸기, 오류·입력 검사', async () => {
  const hub = baseByKey(model, 'hub');
  const plan = planBase(model, hub);
  const fetchImpl = fakeMeta({ existing: [{ name: '고객', fields: [{ name: 'id', type: 'singleLineText' }] }] });
  const r = await applyPlan(plan, { baseId: BASE_ID, token: 't', fetchImpl, delayMs: 0 });
  assert.equal(r.createdTables, hub.tables.length - 1);
  assert.equal(r.createdFields, plan.steps.find((s) => s.table === '고객').body.fields.length - 1);

  // 역방향 이름이 기본값과 다른 연결
  const custom = structuredClone(plan);
  custom.steps.push({ kind: 'renameInverse', table: '고객', field: '소속 건물', method: 'PATCH', path: '/v0/meta/bases/{baseId}/tables/{tableId:고객}/fields/{inverseOf:건물.customer}', body: { name: '소속 건물' } });
  const f2 = fakeMeta();
  const r2 = await applyPlan(custom, { baseId: BASE_ID, token: 't', fetchImpl: f2, delayMs: 0 });
  assert.equal(r2.renamed, 1);
  assert.ok(f2.calls.some((c) => c.init.method === 'PATCH' && /\/fields\/fld\d+$/u.test(c.url)));

  await assert.rejects(applyPlan(plan, { baseId: 'nope', token: 't', fetchImpl }), /Base ID 형식/u);
  await assert.rejects(applyPlan(plan, { baseId: BASE_ID, token: '', fetchImpl }), /AIRTABLE_TOKEN/u);
  const failing = fakeMeta({ failOn: (method) => method === 'POST' });
  await assert.rejects(applyPlan(plan, { baseId: BASE_ID, token: 't', fetchImpl: failing, delayMs: 0 }), /HTTP 422/u);
});

test('CLI: 옵션 해석, --json, 한 Base만, --apply는 Base 하나·토큰 필요', async () => {
  assert.deepEqual(parseArgs(['--base', 'fire']), { base: 'fire', dryRun: true, apply: false, json: false, baseId: null });
  assert.throws(() => parseArgs(['--nope']), /알 수 없는 옵션/u);
  let r = await run(['--base', 'fire', '--json']);
  const plans = JSON.parse(r.out);
  assert.equal(plans.length, 1);
  assert.equal(plans[0].base, 'fire');
  r = await run(['--base', 'telecom']);
  assert.match(r.out, /■ GW 통신설비 점검 \(telecom\)/u);
  assert.doesNotMatch(r.out, /GW 허브/u);
  assert.equal((await run(['--base', 'nope'])).code, 2);
  assert.equal((await run(['--bad'])).code, 2);
  assert.equal((await run(['--help'])).code, 0);
  assert.equal((await run(['--apply'])).code, 2, '--apply는 Base 하나씩');
  r = await run(['--apply', '--base', 'hub', '--base-id', BASE_ID], { env: {}, fetchImpl: fakeMeta(), delayMs: 0 });
  assert.equal(r.code, 1);
  assert.match(r.out, /AIRTABLE_TOKEN/u);
  r = await run(['--apply', '--base', 'hub', '--base-id', BASE_ID], { env: { AIRTABLE_TOKEN: 't' }, fetchImpl: fakeMeta(), delayMs: 0 });
  assert.equal(r.code, 0);
  assert.match(r.out, /완료: 테이블 5/u);
});
