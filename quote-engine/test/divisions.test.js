// 사업부별 계산 규칙(가상 단가 기준 금액을 손으로 계산해 고정)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadDivisions } from '../src/core/registry.js';
import { loadBundledPricing } from '../src/core/pricing.js';
import { checkResult, resolveConditions } from '../src/core/pipeline.js';

const registry = await loadDivisions();
const price = Object.fromEntries(await Promise.all(registry.ids().map(async (id) => [id, await loadBundledPricing(id)])));
const calc = (id, building, conditions) => checkResult(registry.get(id), registry.get(id).calculateCosts({ building, conditions }, price[id]));
const amounts = (r) => Object.fromEntries(r.items.map((it) => [it.code, it.amount]));

test('fire: 연면적 구간 × 용도 계수 × 등급 + 층수·지하층 가산', () => {
  const office = calc('fire', { mainPurpose: '업무시설', totalArea: 4200, groundFloors: 9, undergroundFloors: 2 }, { grade: '종합' });
  assert.deepEqual(amounts(office), { base: 680000, grade: 408000, underground: 80000 }, '계수 1.0·10층 이하는 항목에서 빠진다');
  assert.equal(office.total, 1284800);

  const apt = calc('fire', { mainPurpose: '공동주택', totalArea: 28640, groundFloors: 25, undergroundFloors: 3 }, { grade: '작동' });
  assert.deepEqual(amounts(apt), { base: 1940000, usage: -194000, floors: 375000, underground: 120000 });
  assert.equal(apt.subtotal, 2241000);
  assert.equal(apt.vat, 224100);
  assert.equal(apt.total, 2465100);
});

test('fire: 표에 없는 용도는 "기타", 최대 구간은 상한 없음', () => {
  const r = calc('fire', { mainPurpose: '종교시설', totalArea: 50000, groundFloors: 3, undergroundFloors: 0 }, { grade: '작동' });
  assert.equal(r.meta.usageCategory, '기타');
  assert.equal(amounts(r).base, 2860000);
  assert.equal(amounts(r).usage, 286000);
});

test('telecom: 수량 × 단가 × 규모 계수, 연간 계약은 4회 × 12% 할인', () => {
  const r = calc('telecom', { totalArea: 12300.8 }, { lines: 180, switches: 8, terminalBoxes: 4, contract: '연간' });
  assert.deepEqual(amounts(r), { lines: 1728000, equipment: 1632000, scale: 672000, discount: -484000 });
  assert.equal(r.total, 3902800);
});

test('telecom: 단건 소규모는 최소 출동료까지 보정하고 할인 없음', () => {
  const r = calc('telecom', { totalArea: 1000 }, { lines: 10, switches: 1, terminalBoxes: 0, contract: '단건' });
  assert.deepEqual(amounts(r), { lines: 24000, equipment: 38000, minimum: 188000 });
  assert.equal(r.subtotal, 250000);
  assert.equal(r.total, 275000);
});

test('mechanical: 설비별 수량 × 방문당 단가 × 연간 방문 + 출동비 − 주기 할인', () => {
  const monthly = calc('mechanical', {}, { boilers: 2, chillers: 1, ahus: 3, pumps: 6, fans: 8, cycle: '월' });
  assert.equal(amounts(monthly).discount, -438000);
  assert.equal(monthly.total, 4336200);
  const quarterly = calc('mechanical', {}, { boilers: 2, chillers: 0, ahus: 3, pumps: 6, fans: 8, cycle: '분기' });
  assert.equal(amounts(quarterly).chillers, undefined, '수량 0인 설비는 항목에서 빠진다');
  assert.equal(amounts(quarterly).discount, undefined, '분기 방문은 할인 없음');
  assert.equal(quarterly.subtotal, (84000 + 84000 + 54000 + 48000) * 4 + 30000 * 4);
});

test('모든 사업부: 엑셀 매핑은 양식의 사업부 값 자리를 모두 채운다', () => {
  for (const d of registry.list()) {
    const r = d.calculateCosts(d.sample, price[d.id]);
    const mapping = d.excelMapping(r);
    for (const f of d.template.fields) assert.ok(mapping.fields[f.key] !== undefined, `${d.id}.${f.key}`);
    assert.equal(mapping.items.length, r.items.length);
    assert.ok(mapping.items.length <= (d.template.itemRows ?? 10));
  }
});

test('입력 조건: 기본값 채움·숫자 변환·범위·선택지 검사', () => {
  const telecom = registry.get('telecom');
  assert.deepEqual(resolveConditions(telecom, { lines: '30' }), { lines: 30, switches: 6, terminalBoxes: 4, contract: '연간' });
  assert.throws(() => resolveConditions(telecom, { lines: -1 }), /회선 수: 0 이상/u);
  assert.throws(() => resolveConditions(telecom, { lines: 99999 }), /5000 이하/u);
  assert.throws(() => resolveConditions(telecom, { lines: 'abc' }), /숫자여야/u);
  assert.throws(() => resolveConditions(telecom, { contract: '3년' }), /단건\/연간 중 하나/u);
});

test('공통 검사: 항목 합계가 공급가액과 다르면 CALC_MISMATCH', () => {
  const d = registry.get('fire');
  assert.throws(() => checkResult(d, { items: [{ name: 'a', amount: 100 }], subtotal: 90, vat: 9, total: 99 }), { code: 'CALC_MISMATCH' });
  assert.throws(() => checkResult(d, { items: [{ name: 'a', amount: 10.5 }], subtotal: 10.5, vat: 0, total: 10.5 }), { code: 'CALC_MISMATCH' });
});
