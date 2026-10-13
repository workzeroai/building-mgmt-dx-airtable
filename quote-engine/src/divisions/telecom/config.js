// 사업부 2 — 통신설비 점검 (두 번째 사업부)
// 계산: 설비 수량(회선·네트워크 장비·광단자함) × 단가 × 건물 규모 계수, 연간 계약이면 방문 횟수만큼 곱하고 할인
// 단가는 data/pricing/telecom.json(지어낸 값). 이 파일은 다른 파일을 import하지 않는다.

const roundTo = (value, unit) => Math.round(value / unit) * unit;
const won = (n) => `${Math.round(n).toLocaleString('ko-KR')}원`;

export default {
  id: 'telecom',
  code: 'TEL',
  name: '통신설비 점검',
  order: 2,
  description: '설비 수량 × 단가 × 건물 규모 계수, 연간 계약 할인',
  outputSheet: '견적서',
  pricingKeys: ['unitPrices', 'scaleBands', 'minimumPerVisit', 'annual', 'vatRate', 'rounding'],

  inputs: [
    { key: 'lines', label: '회선 수', type: 'number', min: 0, max: 5000, default: 120, unit: '회선' },
    { key: 'switches', label: '네트워크 장비', type: 'number', min: 0, max: 500, default: 6, unit: '대' },
    { key: 'terminalBoxes', label: '광단자함', type: 'number', min: 0, max: 200, default: 4, unit: '개' },
    { key: 'contract', label: '계약 형태', type: 'select', options: ['단건', '연간'], default: '연간' },
  ],

  items: [
    { code: 'lines', name: '회선 점검' },
    { code: 'equipment', name: '장비 점검' },
    { code: 'scale', name: '건물 규모 보정' },
    { code: 'minimum', name: '최소 출동료 보정' },
    { code: 'discount', name: '연간 계약 할인' },
  ],

  template: {
    title: '통신설비 점검 견적서',
    fields: [
      // 값이 긴 '점검 설비'를 넓은 B열에 둔다(D열에 두면 PDF에서 줄바꿈돼 잘린다)
      { label: '점검 설비', key: 'equipmentSummary' },
      { label: '계약 형태', key: 'contract' },
    ],
    itemRows: 8,
    footnote: '연간 계약은 분기 1회 방문 기준. 장애 긴급 출동은 별도.',
  },

  sample: {
    building: { name: '샘플 판매시설', mainPurpose: '판매시설', totalArea: 12000, groundFloors: 8, undergroundFloors: 3 },
    conditions: { lines: 240, switches: 12, terminalBoxes: 6, contract: '연간' },
  },

  calculateCosts({ building, conditions }, pricing) {
    const unit = pricing.rounding;
    const p = pricing.unitPrices;
    const annual = conditions.contract === '연간';
    const visits = annual ? pricing.annual.visitsPerYear : 1;
    const band = pricing.scaleBands.find((b) => b.maxArea === null || building.totalArea <= b.maxArea);
    const times = visits > 1 ? ` × ${visits}회` : '';

    const lines = conditions.lines * p.line * visits;
    const equipment = (conditions.switches * p.switch + conditions.terminalBoxes * p.terminalBox) * visits;
    const scale = roundTo((lines + equipment) * (band.factor - 1), unit);
    const perVisit = (lines + equipment + scale) / visits;
    const minimum = perVisit < pricing.minimumPerVisit ? roundTo((pricing.minimumPerVisit - perVisit) * visits, unit) : 0;
    const beforeDiscount = lines + equipment + scale + minimum;
    const discount = annual ? -roundTo(beforeDiscount * pricing.annual.discountRate, unit) : 0;

    const items = [
      { code: 'lines', name: '회선 점검', basis: `${conditions.lines}회선 × ${won(p.line)}${times}`, amount: lines },
      { code: 'equipment', name: '장비 점검', basis: `장비 ${conditions.switches}대 × ${won(p.switch)} + 광단자함 ${conditions.terminalBoxes}개 × ${won(p.terminalBox)}${times}`, amount: equipment },
      { code: 'scale', name: '건물 규모 보정', basis: `${band.label} 계수 ×${band.factor}`, amount: scale },
      { code: 'minimum', name: '최소 출동료 보정', basis: `방문 1회 최소 ${won(pricing.minimumPerVisit)}`, amount: minimum },
      { code: 'discount', name: '연간 계약 할인', basis: `연 ${visits}회 계약 ${Math.round(pricing.annual.discountRate * 100)}% 할인`, amount: discount },
    ].filter((it) => it.amount !== 0);

    const subtotal = items.reduce((s, it) => s + it.amount, 0);
    const vat = Math.floor(subtotal * pricing.vatRate);
    return { items, subtotal, vat, total: subtotal + vat, meta: { contract: conditions.contract, visits, ...conditions } };
  },

  excelMapping(result) {
    const m = result.meta;
    return {
      fields: {
        contract: m.contract === '연간' ? `연간 계약(${m.visits}회)` : '단건',
        equipmentSummary: `회선 ${m.lines} · 장비 ${m.switches} · 광단자함 ${m.terminalBoxes}`,
      },
      items: result.items.map((it) => ({ name: it.name, basis: it.basis, amount: it.amount })),
    };
  },
};
