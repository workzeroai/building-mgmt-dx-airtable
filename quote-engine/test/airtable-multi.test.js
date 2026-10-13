// 에어테이블 허브 + 사업부 Base 구성(airtable/schema 설계): 테이블을 Base로 나눠 읽고 쓰며, 엔진은 차이를 모른다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSchemas } from '../src/core/store/schema.js';
import { createAirtableAdapter } from '../src/core/store/airtable.js';
import { basesFromEnv, createMultiBaseAirtableAdapter } from '../src/core/store/airtable-multi.js';
import { airtableFake, testContext } from './helpers.js';

const schemas = loadSchemas();
const BASES = { hub: 'appHUB', divisions: { fire: 'appFIRE', telecom: 'appTEL', mechanical: 'appMECH' } };

/** Base ID별로 따로 동작하는 에어테이블 가짜를 URL로 나눠 부른다. */
function router() {
  const fakes = {};
  const fn = async (url, init) => {
    const baseId = new URL(url).pathname.split('/')[2];
    fakes[baseId] ??= airtableFake();
    return fakes[baseId](url, init);
  };
  fn.fakes = fakes;
  fn.callsTo = (baseId) => fakes[baseId]?.calls ?? [];
  return fn;
}

test('허브 테이블은 허브 Base, 사업부 테이블은 divisionId의 사업부 Base로 간다', async () => {
  const fetchImpl = router();
  const store = createMultiBaseAirtableAdapter({ token: 't', bases: BASES, schemas, fetchImpl });
  assert.equal(store.layout, 'hub+division');
  await store.create('customers', { name: '(주)가온자산관리', type: '법인' });
  await store.create('pricing', { divisionId: 'fire', version: 'v1', source: '가상', data: { a: 1 }, updatedAt: 'x' });
  const tel = await store.create('pricing', { divisionId: 'telecom', version: 'v1', source: '가상', data: { b: 2 }, updatedAt: 'x' });
  assert.equal(fetchImpl.callsTo('appHUB').length, 1);
  assert.equal(fetchImpl.callsTo('appFIRE').length, 1);
  assert.equal(fetchImpl.callsTo('appTEL').length, 1);

  assert.equal((await store.list('pricing')).length, 2, 'divisionId 없이 목록을 달라면 모든 사업부 Base를 합친다');
  assert.equal((await store.list('pricing', { divisionId: 'telecom' }))[0].data.b, 2);
  assert.equal((await store.get('pricing', tel.id)).divisionId, 'telecom', 'id만으로도 주인 Base를 찾는다');
  assert.equal((await store.update('pricing', tel.id, { version: 'v2' })).version, 'v2');
  assert.equal((await store.list('customers'))[0].name, '(주)가온자산관리');
  assert.equal(await store.get('pricing', 'prc_none'), null);
  await assert.rejects(store.update('pricing', 'prc_none', {}), { code: 'NOT_FOUND' });
  await assert.rejects(store.create('quotes', { quoteNo: 'GW-FIRE-20261013-001' }), /divisionId가 필요/u);
  await assert.rejects(store.create('pricing', { divisionId: 'elevator', version: 'v1', source: '가상', data: {}, updatedAt: 'x' }), /AIRTABLE_BASE_ID_ELEVATOR/u);
  assert.throws(() => createMultiBaseAirtableAdapter({ token: 't', bases: { divisions: {} }, schemas }), /AIRTABLE_HUB_BASE_ID/u);
});

test('에어테이블에만 있는 필드(연결·룩업·운영 필드)는 읽을 때 버려 계약 검사에 걸리지 않는다', async () => {
  const fetchImpl = airtableFake();
  const store = createAirtableAdapter({ token: 't', baseId: 'appHUB', schemas, fetchImpl });
  const c = await store.create('customers', { name: '(주)가온자산관리', type: '법인' });
  // 사람이·자동화가 에어테이블에서 채운 필드
  await fetchImpl('https://api.airtable.com/v0/appHUB/%EA%B3%A0%EA%B0%9D', { method: 'PATCH', body: JSON.stringify({ records: [{ id: 'rec1', fields: { businessNo: '000-10-00001', dupStatus: '후보 없음', '건물 수': 2, dupCandidates: ['rec2'] } }] }) });
  const [row] = await store.list('customers');
  assert.deepEqual(Object.keys(row).sort(), ['createdAt', 'id', 'name', 'type']);
  const updated = await store.update('customers', c.id, { note: '메모' });
  assert.equal(updated.note, '메모');
});

test('환경변수: 허브 ID가 있으면 허브 + 사업부 구성, 없으면 Base 하나 구성', async () => {
  assert.equal(basesFromEnv({}, ['fire']), null);
  assert.deepEqual(basesFromEnv({ AIRTABLE_HUB_BASE_ID: 'appH', AIRTABLE_BASE_ID_FIRE: 'appF' }, ['fire', 'telecom']), { hub: 'appH', divisions: { fire: 'appF' } });

  const fetchImpl = router();
  const env = { STORE_ADAPTER: 'airtable', AIRTABLE_TOKEN: 't', AIRTABLE_HUB_BASE_ID: 'appHUB', AIRTABLE_BASE_ID_FIRE: 'appFIRE', AIRTABLE_BASE_ID_TELECOM: 'appTEL', AIRTABLE_BASE_ID_MECHANICAL: 'appMECH' };
  const { ctx } = await testContext({ env, fetchImpl });
  assert.equal(ctx.store.layout, 'hub+division');
  // 시작 시 사업부(허브)·단가·양식 버전(사업부 Base)을 채운다
  assert.ok(fetchImpl.callsTo('appHUB').some((c) => c.init.method === 'POST'));
  for (const id of ['appFIRE', 'appTEL', 'appMECH']) assert.ok(fetchImpl.callsTo(id).some((c) => c.init.method === 'POST'), id);
  const r = await ctx.engine.createQuote({ divisionId: 'telecom', address: '경기도 성남시 분당구 샘플로 45', conditions: { lines: 180, switches: 8, terminalBoxes: 4, contract: '연간' } });
  assert.match(r.quote.quoteNo, /^GW-TEL-/u);
  const quotePost = fetchImpl.callsTo('appTEL').find((c) => c.init.method === 'POST' && c.url.endsWith(encodeURIComponent('견적')));
  assert.ok(quotePost, '견적은 통신 사업부 Base에 쓴다');
  const buildingPost = fetchImpl.callsTo('appHUB').find((c) => c.init.method === 'POST' && c.url.endsWith(encodeURIComponent('건물')));
  assert.ok(buildingPost, '새 건물은 허브 Base에 쓴다');
});
