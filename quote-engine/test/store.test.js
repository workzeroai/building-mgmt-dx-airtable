// 데이터 저장소: 로컬 JSON 어댑터 · 에어테이블 어댑터 · 스테이징 ID 가드(두 어댑터 모두)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadSchemas } from '../src/core/store/schema.js';
import { createLocalAdapter } from '../src/core/store/local.js';
import { createAirtableAdapter } from '../src/core/store/airtable.js';
import { createIdMap, loadIdMap, withStagingGuard } from '../src/core/store/guard.js';
import { airtableFake, makeTmp, mockFetch, testContext } from './helpers.js';

const schemas = loadSchemas();
const customer = (name = '가상 고객') => ({ name, type: '법인', region: '서울특별시', contactEmail: null, note: null });

test('로컬 어댑터: 생성(순번 ID)·조회·필터·수정, 데이터 계약 위반은 거부', async () => {
  const store = createLocalAdapter({ dir: makeTmp(), schemas });
  const a = await store.create('customers', customer('A'));
  const b = await store.create('customers', { ...customer('B'), type: '관리단' });
  assert.equal(a.id, 'cus_0001');
  assert.equal(b.id, 'cus_0002');
  assert.ok(a.createdAt);
  assert.deepEqual((await store.list('customers', { type: '관리단' })).map((r) => r.name), ['B']);
  const updated = await store.update('customers', 'cus_0001', { note: '메모' });
  assert.equal(updated.note, '메모');
  assert.ok(updated.updatedAt);
  assert.equal(await store.get('customers', 'cus_9999'), null);
  await assert.rejects(store.update('customers', 'cus_9999', {}), { code: 'NOT_FOUND' });
  await assert.rejects(store.create('customers', { ...customer(), type: '외계인' }), /허용 값/u);
  await assert.rejects(store.create('customers', { ...customer(), unknownField: 1 }), /계약에 없는 필드/u);
  await assert.rejects(store.create('nope', {}), /데이터 계약에 없는 테이블/u);
  assert.deepEqual(await store.list('quotes'), [], '파일이 없으면 빈 테이블');
});

test('로컬 어댑터: 동시 쓰기 20건이 서로 덮어쓰지 않는다', async () => {
  const store = createLocalAdapter({ dir: makeTmp(), schemas });
  await Promise.all(Array.from({ length: 20 }, (_, i) => store.create('customers', customer(`C${i}`))));
  const rows = await store.list('customers');
  assert.equal(rows.length, 20);
  assert.equal(new Set(rows.map((r) => r.id)).size, 20);
});

test('스테이징 가드(로컬): 매핑된 운영 ID는 스테이징 ID로 바꿔 쓰고, 매핑 없는 ID는 차단', async () => {
  const dir = makeTmp();
  const base = createLocalAdapter({ dir, schemas, idNamespace: 'stg_' });
  await base.replaceAll('customers', [{ id: 'stg_cus_0001', ...customer(), createdAt: 'x' }]);
  const idMap = createIdMap({ tables: { customers: { cus_0001: 'stg_cus_0001' } } }, path.join(dir, 'id-map.json'));
  const store = withStagingGuard(base, { target: 'staging', idMap, schemas });

  const u = await store.update('customers', 'cus_0001', { note: '스테이징 수정' });
  assert.equal(u.id, 'stg_cus_0001');
  assert.equal((await store.get('customers', 'cus_0001')).note, '스테이징 수정', '읽기도 매핑으로 변환');
  await assert.rejects(store.update('customers', 'cus_0002', { note: 'x' }), (err) => {
    assert.equal(err.code, 'STAGING_ID_GUARD');
    assert.equal(err.status, 409);
    assert.deepEqual(err.details, { target: 'staging', table: 'customers', field: 'customers.id', id: 'cus_0002' });
    return true;
  });
  const before = fs.readFileSync(path.join(dir, 'customers.json'), 'utf8');
  await assert.rejects(store.create('buildings', {
    customerId: 'cus_0777', roadAddress: 'r', admCd: '1111010100', name: 'n', mainPurpose: '업무시설', totalArea: 1, groundFloors: 1, undergroundFloors: 0, source: 'seed',
  }), { code: 'STAGING_ID_GUARD' });
  assert.equal(fs.existsSync(path.join(dir, 'buildings.json')), false, '차단된 쓰기는 파일을 만들지도 않는다');
  assert.equal(fs.readFileSync(path.join(dir, 'customers.json'), 'utf8'), before);

  // 스테이징에서 새로 만든 레코드는 매핑표 created에 등록되고 이후 수정 가능
  const created = await store.create('customers', customer('스테이징 신규'));
  assert.equal(created.id, 'stg_cus_0002');
  assert.equal((await store.update('customers', created.id, { note: 'ok' })).note, 'ok');
  const saved = await loadIdMap(path.join(dir, 'id-map.json'));
  assert.deepEqual(saved.data.created.customers, ['stg_cus_0002']);
  assert.equal(store.guardStatus().blocked, 2);
});

test('운영 대상: 스테이징 ID가 운영 쓰기에 섞이면 차단', async () => {
  const base = createLocalAdapter({ dir: makeTmp(), schemas });
  const store = withStagingGuard(base, { target: 'production', idMap: createIdMap({ tables: { customers: { cus_0001: 'stg_cus_0001' } } }), schemas });
  const ok = await store.create('customers', customer());
  assert.equal(ok.id, 'cus_0001');
  await assert.rejects(store.create('buildings', {
    customerId: 'stg_cus_0001', roadAddress: 'r', admCd: '1111010100', name: 'n', mainPurpose: '업무시설', totalArea: 1, groundFloors: 1, undergroundFloors: 0, source: 'seed',
  }), /운영 쓰기 차단/u);
});


test('에어테이블 어댑터: 계약의 테이블 이름·JSON 필드·페이지 넘김·필터 수식', async () => {
  const fetchImpl = airtableFake();
  const store = createAirtableAdapter({ token: 'pat-test', baseId: 'appTEST', schemas, fetchImpl, now: () => new Date(Date.UTC(2026, 9, 13)) }); // qa-scan: allow
  const p = await store.create('pricing', { divisionId: 'fire', version: 'v1', source: '가상', data: { a: 1 }, updatedAt: 'x' });
  assert.match(p.id, /^prc_[0-9a-z]+$/u);
  assert.deepEqual(p.data, { a: 1 }, 'JSON 필드는 문자열로 저장했다가 객체로 되돌린다');
  const post = fetchImpl.calls.find((c) => c.init.method === 'POST');
  assert.match(post.url, /\/v0\/appTEST\/%EB%8B%A8%EA%B0%80$/u, '테이블 이름은 계약의 x-airtable.table("단가")');
  assert.equal(post.init.headers.Authorization, 'Bearer pat-test');
  assert.equal(typeof JSON.parse(post.init.body).records[0].fields.data, 'string');

  await store.create('pricing', { divisionId: 'telecom', version: 'v1', source: '가상', data: { b: 2 }, updatedAt: 'x' });
  assert.equal((await store.list('pricing')).length, 2, 'offset 페이지까지 모두 읽는다');
  assert.equal((await store.list('pricing', { divisionId: 'telecom' }))[0].data.b, 2);
  const updated = await store.update('pricing', p.id, { version: 'v2' });
  assert.equal(updated.version, 'v2');
  assert.equal((await store.get('pricing', p.id)).version, 'v2');
  await assert.rejects(store.update('pricing', 'prc_none', {}), { code: 'NOT_FOUND' });
  assert.throws(() => createAirtableAdapter({ token: '', baseId: '', schemas }), /AIRTABLE_TOKEN/u);

  const failing = createAirtableAdapter({ token: 't', baseId: 'b', schemas, fetchImpl: mockFetch(() => ({ status: 422, body: { error: 'INVALID' } })) });
  await assert.rejects(failing.list('pricing'), /HTTP 422/u);
  const down = createAirtableAdapter({ token: 't', baseId: 'b', schemas, fetchImpl: mockFetch(() => new Error('ENOTFOUND')) });
  await assert.rejects(down.get('pricing', 'x'), /에어테이블 호출 실패/u);
});

test('스테이징 가드(에어테이블): 같은 가드가 막고, 막힌 쓰기는 API를 호출하지 않는다', async () => {
  const fetchImpl = airtableFake();
  const base = createAirtableAdapter({ token: 't', baseId: 'appSTG', schemas, fetchImpl, idNamespace: 'stg_' });
  const store = withStagingGuard(base, { target: 'staging', idMap: createIdMap({ tables: { customers: { cus_0001: 'stg_cus_0001' } } }), schemas });
  await assert.rejects(store.update('customers', 'cus_0404', { note: 'x' }), { code: 'STAGING_ID_GUARD' });
  await assert.rejects(store.create('contracts', { contractNo: 'GW-C-2026-001', quoteId: 'quo_0001', buildingId: 'bld_0001', divisionId: 'fire', startDate: 'a', endDate: 'b', annualAmount: 1, status: 'active' }), { code: 'STAGING_ID_GUARD' });
  assert.equal(fetchImpl.calls.length, 0, '차단은 네트워크 호출 전에 일어난다');

  const created = await store.create('customers', { name: 'n', type: '법인' });
  assert.match(created.id, /^stg_cus_/u);
  assert.equal(fetchImpl.calls.filter((c) => c.init.method === 'POST').length, 1);
});

test('스테이징 저장소 시드: 운영 데이터를 ID만 바꿔 복제하고 매핑표를 만든다', async () => {
  const { ctx, dir } = await testContext({ target: 'staging' });
  const [first] = await ctx.store.list('quotes');
  assert.match(first.id, /^stg_quo_/u);
  assert.match(first.buildingId, /^stg_bld_/u);
  assert.equal(ctx.idMap.translate('quotes', 'quo_0001'), 'stg_quo_0001');
  assert.ok(fs.existsSync(path.join(dir, 'store', 'staging', 'id-map.json')));
  const r = await ctx.engine.createQuote({ divisionId: 'fire', address: '서울 중구 예시로 12', customerId: 'cus_0002' });
  assert.equal(r.quote.customerId, 'stg_cus_0002', '운영 고객 ID는 매핑표로 스테이징 ID가 된다');
  assert.match(r.quote.id, /^stg_quo_/u);
  await assert.rejects(ctx.engine.createQuote({ divisionId: 'fire', address: '서울 중구 예시로 12', customerId: 'cus_9999' }), /고객을 찾지 못했습니다/u);
});
