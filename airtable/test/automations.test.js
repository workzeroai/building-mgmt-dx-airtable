// 에어테이블 자동화 스크립트 4개 — 하네스(가짜 base·input·output·fetch)에서 실제 파일을 그대로 실행한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeBase, fakeAirtableRest, fakeFetch, runScript } from '../automations/harness/airtable-harness.js';
import { baseByKey } from '../lib/schema.js';
import { dataset, model, rules, script, seededBase } from './helpers.js';

// ---------------------------------------------------------------- 상태 전이 가드

test('상태 전이 가드: 허용 전이는 기준 상태를 갱신하고, 허용되지 않은 전이는 되돌리고 사유를 남긴다', async () => {
  const base = await seededBase('fire', { tables: ['customers', 'buildings', 'quotes'] });
  const table = base.getTable('견적');
  const row = base.rows('견적').find((r) => r.status === 'sent');
  // 사람이 sent → won 으로 바꿈(허용)
  await table.updateRecordAsync(row.recId, { status: { name: 'won' } });
  let run = await runScript(script('status-guard.js'), { base, config: { tableName: '견적', recordId: row.recId } });
  assert.equal(run.error, null);
  assert.equal(run.output.values.verdict, 'accept');
  let after = base.rows('견적').find((r) => r.recId === row.recId);
  assert.equal(after.statusConfirmed, 'won');
  assert.match(after.statusNote, /허용: sent → won 허용/u);

  // won → draft 는 규칙에 없음 → 되돌림
  await table.updateRecordAsync(row.recId, { status: { name: 'draft' } });
  run = await runScript(script('status-guard.js'), { base, config: { tableName: '견적', recordId: row.recId } });
  assert.equal(run.output.values.verdict, 'reject');
  after = base.rows('견적').find((r) => r.recId === row.recId);
  assert.equal(after.status, 'won', 'status를 마지막 허용 상태로 되돌린다');
  assert.match(after.statusNote, /되돌림: won → draft 불가\. won에서 갈 수 있는 상태: 없음\(종료 상태\)/u);

  // 되돌린 수정이 다시 트리거돼도 변경 없음으로 끝난다(무한 반복 없음)
  run = await runScript(script('status-guard.js'), { base, config: { tableName: '견적', recordId: row.recId } });
  assert.equal(run.output.values.verdict, 'noop');
});

test('상태 전이 가드: 처음 보는 레코드는 기준만 기록, 청구 issued → overdue 허용·paid → issued 거부, 규칙 없는 테이블은 오류 기록', async () => {
  const base = await seededBase('fire', { tables: ['customers', 'buildings', 'quotes', 'contracts', 'inspections', 'inspectionResults', 'invoices'] });
  const newId = await base.getTable('견적').createRecordAsync({ quoteNo: 'GW-FIRE-20261013-900', id: 'quo_0900', status: { name: 'draft' } });
  let run = await runScript(script('status-guard.js'), { base, config: { tableName: '견적', recordId: newId } });
  assert.equal(run.output.values.verdict, 'accept');
  assert.equal(base.rows('견적').find((r) => r.recId === newId).statusConfirmed, 'draft');

  const invoices = base.getTable('청구');
  const issued = base.rows('청구').find((r) => r.status === 'issued');
  await invoices.updateRecordAsync(issued.recId, { status: { name: 'overdue' } });
  run = await runScript(script('status-guard.js'), { base, config: { tableName: '청구', recordId: issued.recId } });
  assert.equal(run.output.values.verdict, 'accept');
  const paid = base.rows('청구').find((r) => r.status === 'paid');
  await invoices.updateRecordAsync(paid.recId, { status: { name: 'issued' } });
  run = await runScript(script('status-guard.js'), { base, config: { tableName: '청구', recordId: paid.recId } });
  assert.equal(run.output.values.verdict, 'reject');
  assert.equal(base.rows('청구').find((r) => r.recId === paid.recId).status, 'paid');

  run = await runScript(script('status-guard.js'), { base, config: { tableName: '단가', recordId: 'recX' } });
  assert.match(run.error.message, /상태 전이 규칙이 없는 테이블: 단가/u);
  const [err] = base.rows('자동화 오류');
  assert.equal(err.automation, 'statusGuard');
  assert.equal(err.stage, 'error');
  assert.equal(err.notified, false);

  run = await runScript(script('status-guard.js'), { base, config: { tableName: '견적', recordId: 'recNONE' } });
  assert.equal(run.output.values.verdict, 'missing');
});

// ---------------------------------------------------------------- 중복 감지

test('중복 감지(건물): 표기가 다른 같은 주소를 서로 후보로 잇고, 병합·삭제는 하지 않는다', async () => {
  const base = await seededBase('hub', { tables: ['customers', 'buildings'] });
  const table = base.getTable('건물');
  const target = base.rows('건물')[0];
  const before = base.rows('건물').length;
  // 같은 건물을 약칭·상세 주소로 다시 등록
  const variant = target.roadAddress.replace(/^부산광역시/u, '부산').replace(/^서울특별시/u, '서울') + ', 3층 (가상동)';
  const dupId = await table.createRecordAsync({
    id: 'bld_0901', roadAddress: variant, admCd: '1114010100', name: '중복 등록(가상)', mainPurpose: '업무시설', totalArea: 1, groundFloors: 1, undergroundFloors: 0, source: { name: 'seed' }, createdAt: '2026-10-13T00:00:00.000Z',
  });
  const run = await runScript(script('duplicate-detect.js'), { base, config: { tableName: '건물', recordId: dupId } });
  assert.equal(run.error, null);
  assert.equal(run.output.values.result, 'candidates');
  assert.deepEqual(run.output.values.candidates, [target.id]);
  const rows = base.rows('건물');
  const dup = rows.find((r) => r.recId === dupId);
  const orig = rows.find((r) => r.recId === target.recId);
  assert.deepEqual(dup.dupCandidates, [target.id]);
  assert.deepEqual(orig.dupCandidates, ['bld_0901'], '상대 레코드에도 연결(자기 테이블 연결은 반대쪽이 자동으로 안 채워짐)');
  assert.equal(dup.dupStatus, '후보 있음');
  assert.equal(orig.dupStatus, '후보 있음');
  assert.equal(dup.addressKey, target.roadAddress.replace(/\s+/gu, ''));
  assert.equal(rows.length, before + 1, '레코드를 지우거나 합치지 않는다');

  // 사람이 '검토 완료'로 바꾸면 같은 후보로는 다시 띄우지 않는다
  await table.updateRecordAsync(dupId, { dupStatus: { name: '검토 완료' } });
  await runScript(script('duplicate-detect.js'), { base, config: { tableName: '건물', recordId: dupId } });
  assert.equal(base.rows('건물').find((r) => r.recId === dupId).dupStatus, '검토 완료');
});

test('중복 감지(고객): 사업자번호 숫자가 같으면 후보, 없으면 후보 없음. 대상이 아닌 테이블은 오류 기록', async () => {
  const base = await seededBase('hub', { tables: ['customers'] });
  const table = base.getTable('고객');
  const first = base.rows('고객')[0];
  const sameBiz = await table.createRecordAsync({ id: 'cus_0901', name: '같은 사업자 다른 표기(가상)', type: { name: '법인' }, businessNo: first.businessNo.replace(/-/gu, ' '), createdAt: '2026-10-13T00:00:00.000Z' });
  let run = await runScript(script('duplicate-detect.js'), { base, config: { tableName: '고객', recordId: sameBiz } });
  assert.deepEqual(run.output.values.candidates, [first.id]);
  const alone = await table.createRecordAsync({ id: 'cus_0902', name: '새 고객(가상)', type: { name: '법인' }, businessNo: '000-99-99999', createdAt: '2026-10-13T00:00:00.000Z' });
  run = await runScript(script('duplicate-detect.js'), { base, config: { tableName: '고객', recordId: alone } });
  assert.equal(run.output.values.result, 'none');
  assert.equal(base.rows('고객').find((r) => r.recId === alone).dupStatus, '후보 없음');
  run = await runScript(script('duplicate-detect.js'), { base, config: { tableName: '사업부', recordId: alone } });
  assert.match(run.error.message, /중복 감지 대상이 아닌 테이블/u);
  assert.equal(base.rows('자동화 오류')[0].automation, 'duplicateDetect');
});

// ---------------------------------------------------------------- 동기화 안전장치

const HUB_ID = 'appHUBHUBHUBHUBHUB';
const TOKEN = 'pat-test-read-only'; // qa-scan: allow

async function hubSource() {
  const { rows } = await dataset();
  const hub = rows.get('hub');
  return { 고객: structuredClone(hub.get('customers')), 건물: structuredClone(hub.get('buildings')), 담당자: structuredClone(hub.get('staff')) };
}

function emptyDivisionBase(options = {}) {
  return createFakeBase(baseByKey(model, 'fire'), options);
}

const runSync = (base, tables, extra = {}) => runScript(script('sync-safety.js'), {
  base,
  config: { divisionId: 'fire', hubBaseId: HUB_ID, hubToken: TOKEN },
  fetch: fakeAirtableRest({ baseId: HUB_ID, token: TOKEN, tables, pageSize: 7, ...extra }),
});

test('동기화: 첫 실행은 전부 생성 + 연결 채움, 다시 돌리면 변경 없음, 원본이 바뀐 건만 수정', async () => {
  const base = emptyDivisionBase();
  const src = await hubSource();
  let run = await runSync(base, src);
  assert.equal(run.error, null, run.error?.stack);
  assert.equal(run.output.values.status, 'ok');
  assert.equal(base.rows('고객').length, src.고객.length);
  assert.equal(base.rows('건물').length, src.건물.length);
  const b = base.rows('건물').find((r) => r.id === 'bld_0001');
  assert.deepEqual(b.customer, [b.customerId], '건물 사본의 customer 연결을 customerId로 채운다');
  const runs = base.rows('동기화 기록');
  assert.deepEqual(runs.map((r) => [r.tableKey, r.status, r.created, r.previousCount ?? null]), [['customers', 'ok', 24, null], ['buildings', 'ok', 36, null], ['staff', 'ok', 10, null]]);

  run = await runSync(base, src);
  assert.deepEqual(run.output.values.results.map((r) => [r.key, r.status, r.unchanged, r.created, r.updated]), [['customers', 'ok', 24, 0, 0], ['buildings', 'ok', 36, 0, 0], ['staff', 'ok', 10, 0, 0]]);

  src.건물[2].name = '이름 바뀜(가상)';
  run = await runSync(base, src);
  const buildings = run.output.values.results.find((r) => r.key === 'buildings');
  assert.equal(buildings.updated, 1);
  assert.equal(base.rows('건물').find((r) => r.id === src.건물[2].id).name, '이름 바뀜(가상)');
  assert.equal(base.rows('자동화 오류').length, 0);
});

test('동기화: 검증 실패 건은 건너뛰고, 쓰기 실패 건은 그 건만 빼고 반영한다(partial + 자동화 오류)', async () => {
  const src = await hubSource();
  src.건물[0].name = null; // 필수 값 없음
  src.건물[1].id = 'BLD-1'; // id 형식 오류
  src.건물.push({ ...src.건물[5] }); // 같은 id 두 번
  const base = emptyDivisionBase({ failOn: (op, table, fields) => table === '건물' && fields.id === 'bld_0010' });
  const run = await runSync(base, src);
  assert.equal(run.error, null);
  const r = run.output.values.results.find((x) => x.key === 'buildings');
  assert.equal(r.status, 'partial');
  assert.equal(r.skipped, 3);
  assert.equal(r.failed, 1);
  assert.equal(r.created, src.건물.length - 3 - 1);
  assert.ok(!base.rows('건물').some((x) => x.id === 'bld_0010'), '실패 건만 빠진다');
  assert.ok(base.rows('건물').some((x) => x.id === 'bld_0011'), '같은 묶음의 다른 건은 한 건씩 다시 써서 반영');
  const errors = base.rows('자동화 오류').filter((e) => e.tableName === '건물');
  assert.deepEqual(errors.map((e) => e.stage).sort(), ['failed', 'skipped', 'skipped', 'skipped']);
  assert.ok(errors.some((e) => /필수 값 없음: name/u.test(e.message)));
  assert.ok(errors.some((e) => /같은 id가 두 번/u.test(e.message)));
  assert.equal(base.rows('동기화 기록').find((x) => x.tableKey === 'buildings').status, 'partial');
});

test('동기화: 원본이 직전 대비 30% 넘게 줄면 그 테이블은 반영하지 않고 중단 기록, 조금 줄면 사라진 건만 표시(삭제 안 함)', async () => {
  const src = await hubSource();
  const base = emptyDivisionBase();
  await runSync(base, src);
  const before = base.rows('건물').length;

  // 36 → 20건(44% 감소): 필터·권한 사고로 보고 중단
  const shrunk = { ...src, 건물: src.건물.slice(0, 20) };
  let run = await runSync(base, shrunk);
  const r = run.output.values.results.find((x) => x.key === 'buildings');
  assert.equal(r.status, 'aborted');
  assert.equal(base.rows('건물').length, before);
  assert.ok(base.rows('건물').every((x) => x.hubMissing === false), '중단이면 아무것도 표시하지 않는다');
  const aborted = base.rows('동기화 기록').filter((x) => x.tableKey === 'buildings').at(-1);
  assert.equal(aborted.status, 'aborted');
  assert.match(aborted.note, /36→20건\(44\.4% 감소, 기준 30%\)/u);
  assert.equal(base.rows('자동화 오류').filter((e) => e.stage === 'aborted').length, 1);
  assert.equal(run.output.values.results.find((x) => x.key === 'customers').status, 'ok', '다른 테이블은 계속 동기화');

  // 36 → 33건(8% 감소): 사라진 3건은 지우지 않고 hubMissing 표시
  run = await runSync(base, { ...src, 건물: src.건물.slice(3) });
  const ok = run.output.values.results.find((x) => x.key === 'buildings');
  assert.equal(ok.missing, 3);
  assert.equal(base.rows('건물').length, before, '삭제 없음');
  assert.deepEqual(base.rows('건물').filter((x) => x.hubMissing).map((x) => x.id), src.건물.slice(0, 3).map((x) => x.id));
  // 직전 비교 기준은 '중단'이 아니라 마지막 정상 실행(36건)
  assert.equal(base.rows('동기화 기록').filter((x) => x.tableKey === 'buildings').at(-1).previousCount, 36);
});

test('동기화: 허브 조회 실패·입력 누락', async () => {
  const src = await hubSource();
  const base = emptyDivisionBase();
  let run = await runSync(base, src, { failTables: ['건물'] });
  assert.equal(run.error, null);
  assert.equal(run.output.values.results.find((x) => x.key === 'buildings').status, 'error');
  assert.match(base.rows('자동화 오류').find((e) => e.stage === 'error').message, /허브 건물 조회 실패 HTTP 503/u);
  assert.equal(run.output.values.status, 'partial');
  run = await runScript(script('sync-safety.js'), { base, config: { divisionId: 'fire' } });
  assert.match(run.error.message, /hubBaseId·hubToken/u);
  run = await runScript(script('sync-safety.js'), { base, config: { divisionId: 'fire', hubBaseId: HUB_ID, hubToken: 'wrong' }, fetch: fakeAirtableRest({ baseId: HUB_ID, token: TOKEN, tables: src }) });
  assert.equal(run.output.values.status, 'failed');
});

// ---------------------------------------------------------------- 오류 알림

test('오류 알림: 안 보낸 오류를 자동화별로 묶어 웹훅 1번, 성공하면 notified 켬, 실패하면 그대로', async () => {
  const base = createFakeBase(baseByKey(model, 'fire'));
  const errors = base.getTable('자동화 오류');
  const row = (automation, stage, message, notified = false) => ({ id: `err_${message}`, automation, stage: { name: stage }, tableName: '건물', recordId: 'bld_0001', message, occurredAt: '2026-10-13T01:00:00.000Z', notified });
  await errors.createRecordsAsync([row('syncSafety', 'skipped', 'a'), row('syncSafety', 'failed', 'b'), row('statusGuard', 'error', 'c'), row('syncSafety', 'skipped', 'old', true)].map((fields) => ({ fields })));

  const down = fakeFetch(() => ({ status: 500 }));
  let run = await runScript(script('error-alert.js'), { base, config: { webhookUrl: 'https://hooks.example.com/x', label: 'GW 소방시설 점검' }, fetch: down });
  assert.match(run.error.message, /웹훅 발송 실패 HTTP 500/u);
  assert.equal(base.rows('자동화 오류').filter((e) => e.notified).length, 1, '실패하면 notified를 켜지 않는다');

  const hook = fakeFetch(() => ({ status: 204 }));
  run = await runScript(script('error-alert.js'), { base, config: { webhookUrl: 'https://hooks.example.com/x', label: 'GW 소방시설 점검' }, fetch: hook });
  assert.equal(run.error, null);
  assert.equal(hook.calls.length, 1, '건마다가 아니라 한 번에');
  const body = JSON.parse(hook.calls[0].init.body);
  assert.equal(body.content, body.text);
  assert.match(body.content, /^\[GW 소방시설 점검\] 자동화 오류 3건/u);
  assert.match(body.content, /syncSafety 2건 \(skipped 1, failed 1\)/u);
  assert.equal(run.output.values.sent, 3);
  assert.ok(base.rows('자동화 오류').every((e) => e.notified));

  run = await runScript(script('error-alert.js'), { base, config: { webhookUrl: 'https://hooks.example.com/x' }, fetch: hook });
  assert.equal(run.output.values.sent, 0);
  assert.equal(hook.calls.length, 1, '보낼 것이 없으면 호출하지 않는다');
  run = await runScript(script('error-alert.js'), { base, config: {} });
  assert.match(run.error.message, /webhookUrl/u);
});

test('하네스: 없는 필드·잘못된 셀 형식·계산 필드 쓰기·50건 초과·읽지 않은 필드를 잡는다', async () => {
  const base = createFakeBase(baseByKey(model, 'fire'));
  const t = base.getTable('견적');
  await assert.rejects(t.createRecordAsync({ nope: 'x' }), /필드 없음 "nope"/u);
  await assert.rejects(t.createRecordAsync({ status: 'won' }), /\{name: 선택지\}/u);
  await assert.rejects(t.createRecordAsync({ status: { name: 'maybe' } }), /없는 선택지/u);
  await assert.rejects(t.createRecordAsync({ 고객명: 'x' }), /계산 필드/u);
  await assert.rejects(t.createRecordAsync({ customer: [{ id: 'recNONE' }] }), /없는 레코드/u);
  await assert.rejects(t.createRecordAsync({ total: '100' }), /숫자여야/u);
  await assert.rejects(t.createRecordsAsync(Array.from({ length: 51 }, () => ({ fields: {} }))), /50건까지/u);
  const id = await t.createRecordAsync({ quoteNo: 'Q', status: { name: 'draft' } });
  const q = await t.selectRecordsAsync({ fields: ['quoteNo'] });
  assert.throws(() => q.getRecord(id).getCellValue('status'), /읽어 오지 않은 필드/u);
  assert.equal(q.getRecord(id).getCellValueAsString('quoteNo'), 'Q');
  assert.throws(() => base.getTable('없는 테이블'), /테이블 없음/u);
  await assert.rejects(t.deleteRecordsAsync([id]), /지우지 않는다/u);
  assert.ok(rules.tables.buildings, '동기화 규칙에 건물이 있다');
});
