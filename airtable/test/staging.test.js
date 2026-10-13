// 스테이징 Base 준비(clone-staging.mjs): 매핑표가 견적 엔진(6-1)의 형식·값과 같고, 가드가 그대로 쓴다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { main } from '../clone-staging.mjs';
import { applyStaging, idMapFrom, planBaseStaging, planTable } from '../lib/staging.js';
import { baseByKey, tableByKey } from '../lib/schema.js';
import { fakeFetch } from '../automations/harness/airtable-harness.js';
import { toStaging } from '../../quote-engine/src/core/store/seed.js';
import { createIdMap, withStagingGuard } from '../../quote-engine/src/core/store/guard.js';
import { createLocalAdapter } from '../../quote-engine/src/core/store/local.js';
import { dataset, makeTmp, model } from './helpers.js';

const asRecords = (rows) => rows.map((fields, i) => ({ recId: `rec${i}`, fields }));

async function allPlans() {
  const { rows } = await dataset();
  return model.bases.map((b) => planBaseStaging(b, new Map([...rows.get(b.key)].map(([k, v]) => [k, asRecords(v)]))));
}

test('매핑표: 견적 엔진 테이블은 6-1 toStaging과 같은 값, 사업부 ID는 그대로', async () => {
  const { rows, seed } = await dataset();
  const idMap = idMapFrom(await allPlans());
  const engine = toStaging(seed, model.contracts).idMap;
  for (const t of ['customers', 'buildings', 'quotes', 'contracts']) assert.deepEqual(idMap.tables[t], engine.tables[t], t);
  assert.deepEqual(idMap.created, {});
  assert.ok(!('divisions' in idMap.tables), '사업부 ID는 코드가 정한 값이라 바꾸지 않는다');
  assert.equal(idMap.tables.pricing.prc_fire, 'stg_prc_fire');
  assert.equal(idMap.tables.inspections.ins_0001, 'stg_ins_0001');
  assert.equal(Object.keys(idMap.tables.customers).length, rows.get('hub').get('customers').length, '허브와 사본이 같은 이름으로 합쳐진다');
});

test('계획: id와 텍스트 ID 참조(연결 from·ref)를 바꾸고 divisionId는 두며, 이미 stg_면 건너뛴다', () => {
  const fire = baseByKey(model, 'fire');
  const results = tableByKey(fire, 'inspectionResults');
  const p = planTable(results, [{ recId: 'r1', fields: { id: 'res_0001', inspectionId: 'ins_0001', contractId: 'con_0001', divisionId: 'fire' } }]);
  assert.deepEqual(p.patches[0].fields, { id: 'stg_res_0001', inspectionId: 'stg_ins_0001', contractId: 'stg_con_0001' });
  const again = planTable(results, [{ recId: 'r1', fields: { id: 'stg_res_0001', inspectionId: 'stg_ins_0001', contractId: 'stg_con_0001' } }]);
  assert.equal(again.patches.length, 0, '다시 실행해도 안전');
  assert.deepEqual(again.mapped, { res_0001: 'stg_res_0001' });
  const staff = planTable(tableByKey(baseByKey(model, 'hub'), 'staff'), [{ recId: 'r', fields: { id: 'stf_0001', divisionId: 'fire' } }]);
  assert.deepEqual(staff.patches[0].fields, { id: 'stg_stf_0001' });
});

test('견적 엔진의 스테이징 가드가 이 매핑표로 운영 ID를 바꾸고, 매핑 없는 ID는 막는다', async () => {
  const idMapData = idMapFrom(await allPlans());
  const { seed } = await dataset();
  const dir = makeTmp();
  const local = createLocalAdapter({ dir, schemas: model.contracts, idNamespace: 'stg_' });
  const staged = toStaging({ customers: seed.customers }, model.contracts).tables.customers;
  await local.replaceAll('customers', staged);
  const store = withStagingGuard(local, { target: 'staging', idMap: createIdMap(structuredClone(idMapData)), schemas: model.contracts });
  const u = await store.update('customers', 'cus_0003', { note: '스테이징 테스트' });
  assert.equal(u.id, 'stg_cus_0003');
  await assert.rejects(store.update('customers', 'cus_0999', { note: 'x' }), { code: 'STAGING_ID_GUARD' });
});

test('실행: 복제한 스테이징 Base를 읽어 10건씩 PATCH, 다시 실행하면 수정 없음', async () => {
  const { rows } = await dataset();
  const hub = baseByKey(model, 'hub');
  const BASE_ID = 'appSTAGINGSTAGING'; // qa-scan: allow
  const store = Object.fromEntries(hub.tables.map((t) => [t.name, asRecords(structuredClone(rows.get('hub').get(t.key) ?? []))]));
  const fetchImpl = fakeFetch((url, init) => {
    const u = new URL(url);
    const name = decodeURIComponent(u.pathname.split('/')[3]);
    if (init.method === 'PATCH') {
      const body = JSON.parse(init.body);
      assert.ok(body.records.length <= 10);
      for (const r of body.records) Object.assign(store[name].find((x) => x.recId === r.id).fields, r.fields);
      return { body: { records: body.records } };
    }
    const start = Number(u.searchParams.get('offset') ?? 0);
    const list = store[name].slice(start, start + 20).map((r) => ({ id: r.recId, fields: r.fields }));
    return { body: start + 20 < store[name].length ? { records: list, offset: String(start + 20) } : { records: list } };
  });
  const r = await applyStaging(hub, { baseId: BASE_ID, token: 't', fetchImpl, delayMs: 0 });
  assert.equal(r.patched, 24 + 36 + 10);
  assert.ok(store['건물'].every((x) => x.fields.id.startsWith('stg_') && (!x.fields.customerId || x.fields.customerId.startsWith('stg_'))));
  assert.ok(store['사업부'].every((x) => !x.fields.id.startsWith('stg_')));
  const again = await applyStaging(hub, { baseId: BASE_ID, token: 't', fetchImpl, delayMs: 0 });
  assert.equal(again.patched, 0);
  assert.equal(idMapFrom([again]).tables.customers.cus_0001, 'stg_cus_0001', '이미 바뀐 Base에서도 매핑표를 다시 만든다');
  await assert.rejects(applyStaging(hub, { baseId: 'x', token: 't', fetchImpl }), /Base ID 형식/u);
  await assert.rejects(applyStaging(hub, { baseId: BASE_ID, token: '', fetchImpl }), /AIRTABLE_TOKEN/u);
  const down = fakeFetch(() => ({ status: 500 }));
  await assert.rejects(applyStaging(hub, { baseId: BASE_ID, token: 't', fetchImpl: down, delayMs: 0 }), /조회 실패 HTTP 500/u);
});

test('CLI: dry-run은 가상 시드로 계획을 출력하고 매핑표를 --out에 쓴다', async () => {
  const dir = makeTmp();
  const out = path.join(dir, 'id-map.json');
  const lines = [];
  assert.equal(await main(['--dry-run', '--out', out], { log: (l) => lines.push(l) }), 0);
  const text = lines.join('\n');
  assert.match(text, /\[dry-run\]/u);
  assert.match(text, /■ GW 소방시설 점검 \(fire\)/u);
  assert.match(text, /매핑표 → .*테이블 \d+ · ID \d+개/u);
  const idMap = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.equal(idMap.tables.quotes.quo_0001, 'stg_quo_0001');
  assert.equal(await main(['--base', 'nope'], { log: () => {} }), 2);
  assert.equal(await main(['--apply', '--dry-run'], { log: () => {} }), 2);
  assert.equal(await main(['--apply'], { log: () => {} }), 2);
  assert.equal(await main(['--help'], { log: () => {} }), 0);
  assert.equal(await main(['--apply', '--base', 'hub', '--staging-base-id', 'x', '--out', out], { env: { AIRTABLE_TOKEN: 't' }, log: () => {} }), 1);
});
