// 사업부 3 — 기계설비 유지관리 (세 번째 사업부, "설정 파일만 추가" 시연용)
// 이 사업부를 붙이며 바꾼 파일: 이 config.js + data/pricing/mechanical.json, 두 개뿐이다(core 변경 없음).
// 계산: 설비 종류별 수량 × 방문당 단가 × 연간 방문 횟수 + 출동비 − 방문 주기 할인

const roundTo = (value, unit) => Math.round(value / unit) * unit;
const won = (n) => `${Math.round(n).toLocaleString('ko-KR')}원`;

const EQUIPMENT = [
  { key: 'boilers', label: '보일러', unit: '대' },
  { key: 'chillers', label: '냉동기', unit: '대' },
  { key: 'ahus', label: '공조기', unit: '대' },
  { key: 'pumps', label: '펌프', unit: '대' },
  { key: 'fans', label: '급배기팬', unit: '대' },
];

export default {
  id: 'mechanical',
  code: 'MECH',
  name: '기계설비 유지관리',
  order: 3,
  description: '설비 종류별 수량 × 단가 + 방문 주기(월/분기) 할인',
  outputSheet: '견적서',
  pricingKeys: ['unitPerVisit', 'visitFee', 'cycles', 'vatRate', 'rounding'],

  inputs: [
    { key: 'boilers', label: '보일러', type: 'number', min: 0, max: 50, default: 2, unit: '대' },
    { key: 'chillers', label: '냉동기', type: 'number', min: 0, max: 50, default: 1, unit: '대' },
    { key: 'ahus', label: '공조기', type: 'number', min: 0, max: 100, default: 4, unit: '대' },
    { key: 'pumps', label: '펌프', type: 'number', min: 0, max: 200, default: 6, unit: '대' },
    { key: 'fans', label: '급배기팬', type: 'number', min: 0, max: 200, default: 8, unit: '대' },
    { key: 'cycle', label: '방문 주기', type: 'select', options: ['월', '분기'], default: '월' },
  ],

  items: [
    ...EQUIPMENT.map((e) => ({ code: e.key, name: `${e.label} 점검` })),
    { code: 'visit', name: '출동비' },
    { code: 'discount', name: '방문 주기 할인' },
  ],

  template: {
    title: '기계설비 유지관리 견적서',
    fields: [
      { label: '방문 주기', key: 'cycle' },
      { label: '계약 기간', key: 'period' },
    ],
    itemRows: 9,
    footnote: '소모품·부품 교체비는 실비 별도. 연간 계약 기준 금액.',
  },

  sample: {
    building: { name: '샘플 교육시설', mainPurpose: '교육연구시설', totalArea: 2100, groundFloors: 4, undergroundFloors: 1 },
    conditions: { boilers: 2, chillers: 1, ahus: 4, pumps: 6, fans: 8, cycle: '월' },
  },

  calculateCosts({ conditions }, pricing) {
    const cycle = pricing.cycles[conditions.cycle];
    const visits = cycle.visitsPerYear;
    const items = EQUIPMENT
      .filter((e) => conditions[e.key] > 0)
      .map((e) => ({
        code: e.key,
        name: `${e.label} 점검`,
        basis: `${conditions[e.key]}${e.unit} × ${won(pricing.unitPerVisit[e.key])} × 연 ${visits}회`,
        amount: conditions[e.key] * pricing.unitPerVisit[e.key] * visits,
      }));
    items.push({ code: 'visit', name: '출동비', basis: `${won(pricing.visitFee)} × 연 ${visits}회`, amount: pricing.visitFee * visits });
    const beforeDiscount = items.reduce((s, it) => s + it.amount, 0);
    const discount = -roundTo(beforeDiscount * cycle.discountRate, pricing.rounding);
    if (discount !== 0) {
      items.push({ code: 'discount', name: '방문 주기 할인', basis: `${conditions.cycle} 방문 ${Math.round(cycle.discountRate * 100)}% 할인`, amount: discount });
    }
    const subtotal = items.reduce((s, it) => s + it.amount, 0);
    const vat = Math.floor(subtotal * pricing.vatRate);
    return { items, subtotal, vat, total: subtotal + vat, meta: { cycle: conditions.cycle, visits } };
  },

  excelMapping(result) {
    return {
      fields: { cycle: `${result.meta.cycle} 1회 (연 ${result.meta.visits}회)`, period: '계약일로부터 12개월' },
      items: result.items.map((it) => ({ name: it.name, basis: it.basis, amount: it.amount })),
    };
  },
};
