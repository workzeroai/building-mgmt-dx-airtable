// n8n 워크플로(n8n/sync-safety.json): 가져오기 가능한 구조인지, Code 노드가 에어테이블 스크립트와 같은 판정을 내는지.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { WORKFLOW_FILE, WEBHOOK_PLACEHOLDER, renderWorkflow, uuid5 } from '../../airtable/lib/n8n.js';
import { checkVolume, normalizeSource, planSync, recordHash, summarizeRun, validateSourceRecord } from '../../airtable/automations/lib/sync-core.js';
import { createFakeBase, fakeAirtableRest, runScript } from '../../airtable/automations/harness/airtable-harness.js';
import { baseByKey } from '../../airtable/lib/schema.js';
import { dataset, model, rules, script } from '../../airtable/test/helpers.js';
import { restPages, runCodeNode } from './n8n-harness.js';

const WF = JSON.parse(fs.readFileSync(WORKFLOW_FILE, 'utf8'));
const NODES = Object.fromEntries(WF.nodes.map((n) => [n.name, n]));
const jsOf = (name) => NODES[name].parameters.jsCode;

test('워크플로 파일은 스키마에서 만든 최신본이다', () => {
  assert.equal(fs.readFileSync(WORKFLOW_FILE, 'utf8').replace(/\r\n/gu, '\n'), renderWorkflow(model));
});

test('구조: n8n 가져오기 형식, 자격증명 비움, 연결 대상 존재, 노드 id 고유·결정적', () => {
  assert.equal(WF.active, false);
  assert.equal(WF.settings.executionOrder, 'v1');
  const ids = WF.nodes.map((n) => n.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(new Set(WF.nodes.map((n) => n.name)).size, WF.nodes.length);
  for (const n of WF.nodes) {
    for (const k of ['parameters', 'id', 'name', 'type', 'typeVersion', 'position']) assert.ok(k in n, `${n.name}.${k}`);
    assert.match(n.type, /^n8n-nodes-base\./u);
    assert.ok(!('credentials' in n), `${n.name}: 자격증명은 비워 둔다`);
    assert.match(n.id, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
    assert.equal(n.id, uuid5(n.name));
  }
  const incoming = new Set();
  for (const [src, outs] of Object.entries(WF.connections)) {
    assert.ok(NODES[src], `연결 출발 ${src}`);
    for (const branch of outs.main) for (const l of branch) {
      assert.ok(NODES[l.node], `연결 대상 ${l.node}`);
      assert.equal(l.type, 'main');
      incoming.add(l.node);
    }
  }
  for (const n of WF.nodes) {
    if (n.type.endsWith('stickyNote') || n.type.endsWith('scheduleTrigger')) continue;
    assert.ok(incoming.has(n.name), `${n.name}: 들어오는 연결 없음`);
  }
  const json = JSON.stringify(WF);
  assert.ok(!/app[A-Za-z0-9]{14}/u.test(json), '실제 Base ID 형식 문자열이 없다(자리표시만)');
  assert.ok(json.includes('REPLACE_WITH_HUB_BASE_ID'));
});

test('구조: 급감 검사 → 중단 분기, 건 단위 반영의 실패는 오류 출력으로 분기, 루프가 끝나면 요약', () => {
  const c = WF.connections;
  assert.deepEqual(c['반영 중단?'].main.map((b) => b[0].node), ['중단 기록', '건별 반영']);
  assert.deepEqual(c['건별 반영'].main.map((b) => b[0].node), ['결과 요약', '쓸 건?'], 'splitInBatches v3: 0=done, 1=loop');
  const write = NODES['사본 반영'];
  assert.equal(write.onError, 'continueErrorOutput');
  assert.deepEqual(c['사본 반영'].main.map((b) => b[0].node), ['반영 완료 표시', '반영 실패 표시']);
  assert.equal(c['반영 완료 표시'].main[0][0].node, '건별 반영');
  assert.equal(c['반영 실패 표시'].main[0][0].node, '건별 반영');
  assert.deepEqual(c['결과 요약'].main[0].map((l) => l.node), ['동기화 기록 저장', '오류 행 만들기']);
  for (const name of ['결과 알림', '중단 알림']) {
    assert.equal(NODES[name].parameters.url, WEBHOOK_PLACEHOLDER);
    assert.equal(NODES[name].onError, 'continueRegularOutput', '알림 실패가 기록을 막지 않게');
  }
  for (const n of WF.nodes.filter((x) => x.type === 'n8n-nodes-base.httpRequest' && x.parameters.nodeCredentialType)) {
    assert.equal(n.parameters.nodeCredentialType, 'airtableTokenApi');
    assert.match(n.parameters.url, /^=\{\{ 'https:\/\/api\.airtable\.com\/v0\/' \+ /u);
  }
  assert.ok(NODES['허브 원본 조회'].parameters.options.pagination, '허브 원본은 offset 페이지를 끝까지 읽는다');
});

// ---------------------------------------------------------------- 판정 일치

const settings = async (tableKey = 'buildings') => {
  const code = jsOf('동기화 설정').replace("tableKey: 'buildings'", `tableKey: '${tableKey}'`);
  return (await runCodeNode(code))[0];
};

async function n8nRun({ tableKey, source, target, previous, failIds = [] }) {
  const cfg = await settings(tableKey);
  const nodes = {
    '동기화 설정': [cfg],
    '직전 동기화 기록 조회': [{ records: previous === null ? [] : [{ id: 'recRUN', fields: { sourceCount: previous } }] }],
    '허브 원본 조회': restPages(source.map((fields, i) => ({ id: `rechub${i}`, fields })), 10),
    '사본 조회': restPages(target, 10),
  };
  const plan = await runCodeNode(jsOf('반영 계획'), { nodes });
  if (plan[0].kind === 'abort') return { plan, aborted: true };
  // 루프 흉내: 쓸 건은 사본 반영 → 성공/실패 표시, marker는 그대로 돌아온다
  const looped = plan.map((item) => (item.kind === 'marker' ? item : failIds.includes(item.id) ? { outcome: 'failed', kind: item.kind, id: item.id, reason: '쓰기 실패(시뮬레이션)' } : { outcome: 'done', kind: item.kind, id: item.id }));
  const [summary] = await runCodeNode(jsOf('결과 요약'), { input: looped, nodes: { ...nodes, '반영 계획': plan } });
  const errorRows = await runCodeNode(jsOf('오류 행 만들기'), { input: [summary] });
  return { plan, summary, errorRows };
}

test('Code 노드 "반영 계획"·"결과 요약"은 lib/sync-core.js와 같은 판정을 낸다', async () => {
  const { rows } = await dataset();
  const rule = rules.tables.buildings;
  const source = structuredClone(rows.get('hub').get('buildings'));
  source[0].totalArea = -5; // 음수
  source[1].mainPurpose = null; // 필수 없음
  // 사본: 앞 10건은 이미 같은 값, 다음 5건은 옛 값, 원본에 없는 1건
  const target = [
    ...source.slice(2, 12).map((s, i) => ({ id: `recA${i}`, fields: { id: s.id, syncHash: recordHash(rule, normalizeSource(rule, s)) } })),
    ...source.slice(12, 17).map((s, i) => ({ id: `recB${i}`, fields: { id: s.id, syncHash: 'old' } })),
    { id: 'recGone', fields: { id: 'bld_0999', syncHash: 'x' } },
  ];
  const expected = planSync({ rule, source, target: target.map((t) => ({ recId: t.id, fields: { ...t.fields, hubMissing: false } })) });
  const { plan, summary } = await n8nRun({ tableKey: 'buildings', source, target, previous: 36, failIds: [source[20].id] });
  const kinds = (k) => plan.filter((p) => p.kind === k).map((p) => p.id);
  assert.deepEqual(kinds('create'), expected.create.map((x) => x.id));
  assert.deepEqual(kinds('update'), expected.update.map((x) => x.id));
  assert.deepEqual(kinds('missing'), ['bld_0999']);
  const marker = plan.find((p) => p.kind === 'marker');
  assert.deepEqual(marker.skipped, expected.skipped);
  assert.equal(marker.unchanged, 10);
  assert.deepEqual(marker.volume, checkVolume({ current: 36, previous: 36, maxDropRatio: rules.maxDropRatio }));
  assert.equal(summary.status, 'partial');
  assert.equal(summary.failed, 1);
  assert.equal(summary.created, expected.create.length - 1);
  const created = plan.find((p) => p.kind === 'create').body;
  assert.deepEqual(created.performUpsert, { fieldsToMergeOn: ['id'] }, 'id로 업서트(같은 건을 두 번 만들지 않음)');
  assert.equal(summary.runBody.records[0].fields.runner, 'n8n');
});

test('같은 시나리오에서 n8n 판과 에어테이블 스크립트 판의 결과(건수·상태·건너뛴 건)가 같다', async () => {
  const { rows } = await dataset();
  const HUB = 'appHUBHUBHUBHUBHUB';
  const TOKEN = 'pat-test'; // qa-scan: allow
  const scenarios = [
    { name: '첫 실행', mutate: (s) => s, previous: null },
    { name: '검증 실패 2건 + 쓰기 실패 1건', mutate: (s) => { s[3].name = null; s[4].id = 'X'; return s; }, previous: 36, failIds: ['bld_0010'] },
    { name: '원본 급감(36→20)', mutate: (s) => s.slice(0, 20), previous: 36 },
    { name: '원본 0건', mutate: () => [], previous: 36 },
    { name: '소폭 감소(36→30)', mutate: (s) => s.slice(6), previous: 36 },
  ];
  for (const sc of scenarios) {
    const source = sc.mutate(structuredClone(rows.get('hub').get('buildings')));
    // 에어테이블 판: 고객 사본이 있어야 연결이 채워진다(판정에는 영향 없음). 직전 기록은 동기화 기록 1행으로 준다.
    const base = createFakeBase(baseByKey(model, 'fire'), { failOn: (op, table, fields) => table === '건물' && (sc.failIds ?? []).includes(fields.id) });
    if (sc.previous !== null) {
      base.seed('동기화 기록', [{ id: 'syn_0001', divisionId: 'fire', runner: 'airtable-script', tableKey: 'buildings', startedAt: '2026-10-13T00:00:00.000Z', sourceCount: sc.previous, status: 'ok' }]);
    }
    const tables = { 고객: rows.get('hub').get('customers'), 건물: source, 담당자: rows.get('hub').get('staff') };
    const run = await runScript(script('sync-safety.js'), { base, config: { divisionId: 'fire', hubBaseId: HUB, hubToken: TOKEN }, fetch: fakeAirtableRest({ baseId: HUB, token: TOKEN, tables }) });
    assert.equal(run.error, null, `${sc.name}: ${run.error?.message}`);
    const airtable = run.output.values.results.find((r) => r.key === 'buildings');
    const skippedAirtable = base.rows('자동화 오류').filter((e) => e.tableName === '건물' && e.stage === 'skipped').map((e) => e.recordId);

    const n8n = await n8nRun({ tableKey: 'buildings', source, target: [], previous: sc.previous, failIds: sc.failIds ?? [] });
    if (n8n.aborted) {
      assert.equal(airtable.status, 'aborted', sc.name);
      assert.equal(n8n.plan[0].volume.reason, checkVolume({ current: source.length, previous: sc.previous, maxDropRatio: rules.maxDropRatio }).reason);
      continue;
    }
    for (const k of ['status', 'created', 'updated', 'unchanged', 'skipped', 'failed', 'missing']) assert.equal(n8n.summary[k], airtable[k], `${sc.name}: ${k}`);
    assert.deepEqual(n8n.errorRows.filter((e) => e.body.records[0].fields.stage === 'skipped').map((e) => e.body.records[0].fields.recordId), skippedAirtable, `${sc.name}: 건너뛴 건`);
  }
});

test('Code 노드: 원본 급감이면 abort 1건만 내고 중단 기록·오류·알림 본문을 만든다', async () => {
  const { rows } = await dataset();
  const out = await n8nRun({ tableKey: 'customers', source: rows.get('hub').get('customers').slice(0, 5), target: [], previous: 24 });
  assert.equal(out.aborted, true);
  assert.equal(out.plan.length, 1);
  const a = out.plan[0];
  assert.equal(a.runBody.records[0].fields.status, 'aborted');
  assert.equal(a.errorBody.records[0].fields.stage, 'aborted');
  assert.match(a.alertText, /^\[GW 소방시설 점검\] 고객 동기화 중단 — 원본 24→5건/u);
  await assert.rejects(runCodeNode(jsOf('동기화 설정').replace("tableKey: 'buildings'", "tableKey: 'nope'")), /동기화 규칙이 없는 테이블/u);
});

test('sync-core 단위: 급감 경계·검증 규칙·지문·요약', () => {
  const rule = rules.tables.staff;
  assert.equal(checkVolume({ current: 7, previous: 10, maxDropRatio: 0.3 }).verdict, 'proceed', '정확히 30% 감소는 통과');
  assert.equal(checkVolume({ current: 6, previous: 10, maxDropRatio: 0.3 }).verdict, 'abort');
  assert.equal(checkVolume({ current: 0, previous: 0, maxDropRatio: 0.3 }).verdict, 'proceed');
  assert.equal(checkVolume({ current: 12, previous: 10, maxDropRatio: 0.3 }).dropRatio, 0);
  const ok = normalizeSource(rule, { id: 'stf_0001', name: 'n', role: '점검원' });
  assert.equal(ok.active, false, '체크박스가 응답에 없으면 false');
  assert.deepEqual(validateSourceRecord(rule, ok), { ok: true });
  assert.match(validateSourceRecord(rule, { ...ok, role: '사장' }).reason, /허용되지 않은 선택지/u);
  assert.deepEqual(validateSourceRecord(rule, { ...ok, id: 'stg_stf_0001' }), { ok: true }, '스테이징 ID도 받는다');
  assert.match(validateSourceRecord(rule, { ...ok, id: 'cus_0001' }).reason, /id 형식 오류/u);
  assert.match(validateSourceRecord(rules.tables.buildings, { id: 'bld_1', roadAddress: 'r', name: 'n', mainPurpose: 'm', totalArea: '1', groundFloors: 1, undergroundFloors: 0 }).reason, /숫자가 아님/u);
  assert.match(validateSourceRecord(rules.tables.buildings, { id: 'bld_1', roadAddress: 'r', name: 'n', mainPurpose: 'm', totalArea: 1, groundFloors: 1.5, undergroundFloors: 0 }).reason, /정수가 아님/u);
  assert.equal(normalizeSource(rule, { id: 'x', role: { name: '영업' } }).role, '영업', '단일 선택 셀 {name}도 받는다');
  assert.equal(recordHash(rule, ok), recordHash(rule, { ...ok }));
  assert.notEqual(recordHash(rule, ok), recordHash(rule, { ...ok, name: 'm' }));
  assert.equal(summarizeRun({ created: 1 }).status, 'ok');
  assert.equal(summarizeRun({ skipped: 1 }).status, 'partial');
  assert.equal(summarizeRun({ aborted: true, failed: 3 }).status, 'aborted');
});
