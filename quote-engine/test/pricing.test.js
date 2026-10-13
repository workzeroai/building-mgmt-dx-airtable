// 단가 외부화: 저장소 → 5분 캐시 → 실패 시 번들 기본값 폴백
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPricingService, DEFAULT_TTL_MS, loadBundledPricing } from '../src/core/pricing.js';
import { loadDivisions } from '../src/core/registry.js';
import { makeTmp, silent } from './helpers.js';

const registry = await loadDivisions();

function fakeStore(rows) {
  const store = {
    calls: 0,
    fail: null,
    rows,
    async list(table, filter) {
      store.calls += 1;
      if (store.fail) throw store.fail;
      return store.rows.filter((r) => r.divisionId === filter.divisionId);
    },
    async update(table, id, fields) { const r = store.rows.find((x) => x.id === id); Object.assign(r, fields); return r; },
    async create(table, fields) { const r = { id: `prc_${store.rows.length + 1}`, ...fields }; store.rows.push(r); return r; },
  };
  return store;
}

async function storeWith(divisionId, patch = {}) {
  const data = { ...(await loadBundledPricing(divisionId)), ...patch };
  return fakeStore([{ id: `prc_${divisionId}`, divisionId, version: 'store-v2', source: '가상', data }]);
}

test('첫 조회는 저장소, TTL(5분) 안에서는 캐시, TTL이 지나면 다시 저장소', async () => {
  let now = 1_000_000;
  const store = await storeWith('fire');
  const pricing = createPricingService({ store, registry, now: () => now, logger: silent });
  assert.equal(DEFAULT_TTL_MS, 300_000);

  assert.equal((await pricing.get('fire')).source, 'store');
  now += DEFAULT_TTL_MS - 1;
  const cached = await pricing.get('fire');
  assert.equal(cached.source, 'cache');
  assert.equal(cached.version, 'store-v2');
  assert.equal(store.calls, 1, '캐시 적중 시 저장소를 부르지 않는다');
  now += 2;
  assert.equal((await pricing.get('fire')).source, 'store');
  assert.equal(store.calls, 2);
  assert.equal(pricing.status().cached[0].divisionId, 'fire');
});

test('저장소 오류면 번들 기본값으로 폴백하고, 폴백은 캐시하지 않는다', async () => {
  const store = await storeWith('telecom');
  store.fail = new Error('connect ETIMEDOUT');
  const pricing = createPricingService({ store, registry, logger: silent });
  const fb = await pricing.get('telecom');
  assert.equal(fb.source, 'fallback');
  assert.equal(fb.version, '2026-10-01');
  assert.match(fb.warning, /ETIMEDOUT/u);
  assert.equal(fb.data.unitPrices.line, 2400);

  store.fail = null; // 저장소 복구
  assert.equal((await pricing.get('telecom')).source, 'store', '복구 즉시 저장소 단가 사용');
  assert.equal(pricing.status().fallback, 1);
});

test('저장소에 레코드가 없거나 형식이 깨졌으면 폴백', async () => {
  const empty = createPricingService({ store: fakeStore([]), registry, logger: silent });
  assert.equal((await empty.get('mechanical')).source, 'fallback');

  const broken = await storeWith('mechanical');
  delete broken.rows[0].data.unitPerVisit;
  const pricing = createPricingService({ store: broken, registry, logger: silent });
  const r = await pricing.get('mechanical');
  assert.equal(r.source, 'fallback');
  assert.match(r.warning, /unitPerVisit/u);
});

test('번들 파일도 없으면 명확한 오류', async () => {
  const pricing = createPricingService({ store: fakeStore([]), registry, bundledDir: makeTmp(), logger: silent });
  await assert.rejects(pricing.get('fire'), /번들 단가 파일이 없습니다/u);
  await assert.rejects(pricing.get('elevator'), { code: 'NOT_FOUND' });
});

test('관리자 단가 수정: 형식 검사 → 저장 → 캐시 비움', async () => {
  const store = await storeWith('fire');
  const pricing = createPricingService({ store, registry, logger: silent, now: () => Date.UTC(2026, 9, 13) });
  await pricing.get('fire');
  const data = { ...store.rows[0].data, undergroundPerFloor: 50000 };
  const saved = await pricing.update('fire', data, { updatedBy: '테스트' });
  assert.equal(saved.version, '2026-10-13');
  assert.equal(saved.updatedBy, '테스트');
  const next = await pricing.get('fire');
  assert.equal(next.source, 'store', '수정 직후에는 캐시가 아니라 저장소에서 다시 읽는다');
  assert.equal(next.data.undergroundPerFloor, 50000);

  await assert.rejects(pricing.update('fire', { vatRate: 0.1 }), /필요한 키가 없습니다/u);
  await assert.rejects(pricing.update('fire', [1, 2]), /JSON 객체/u);
  const created = await createPricingService({ store: fakeStore([]), registry, logger: silent }).update('telecom', await loadBundledPricing('telecom'), { version: 'v9' });
  assert.equal(created.version, 'v9');
});
