// 사업부 1 — 소방시설 점검 (첫 사업부)
// 계산: 연면적 구간별 기본 점검료 × 용도 계수 × 점검 등급 + 층수·지하층 가산
// 단가·계수는 data/pricing/fire.json(지어낸 값)에서 온다. 이 파일은 다른 파일을 import하지 않는다(설정만으로 독립).

const roundTo = (value, unit) => Math.round(value / unit) * unit;
const won = (n) => `${Math.round(n).toLocaleString('ko-KR')}원`;

export default {
  id: 'fire',
  code: 'FIRE',
  name: '소방시설 점검',
  order: 1,
  description: '연면적 구간 × 용도 계수 × 점검 등급 + 층수 가산',
  outputSheet: '견적서',
  pricingKeys: ['areaBands', 'usageMap', 'usageFactors', 'gradeFactors', 'floorSurcharge', 'undergroundPerFloor', 'vatRate', 'rounding'],

  inputs: [
    { key: 'grade', label: '점검 등급', type: 'select', options: ['작동', '종합'], default: '작동', help: '종합 점검은 작동 점검보다 항목이 많다' },
  ],

  items: [
    { code: 'base', name: '기본 점검료' },
    { code: 'usage', name: '용도 보정' },
    { code: 'grade', name: '점검 등급 보정' },
    { code: 'floors', name: '고층 가산' },
    { code: 'underground', name: '지하층 가산' },
  ],

  template: {
    title: '소방시설 점검 견적서',
    fields: [
      { label: '점검 등급', key: 'grade' },
      { label: '용도 구분', key: 'usageCategory' },
    ],
    itemRows: 8,
    footnote: '점검 결과 보고서 1부 포함. 보수 공사는 별도 견적.',
  },

  sample: {
    building: { name: '샘플 업무빌딩', mainPurpose: '업무시설', totalArea: 4200, groundFloors: 9, undergroundFloors: 2 },
    conditions: { grade: '종합' },
  },

  calculateCosts({ building, conditions }, pricing) {
    const area = Number(building.totalArea);
    const band = pricing.areaBands.find((b) => b.maxArea === null || area <= b.maxArea);
    const usageCategory = pricing.usageMap[building.mainPurpose] ?? '기타';
    const usageFactor = pricing.usageFactors[usageCategory] ?? pricing.usageFactors['기타'];
    const gradeFactor = pricing.gradeFactors[conditions.grade];
    const unit = pricing.rounding;

    const base = roundTo(band.fee, unit);
    const usage = roundTo(base * (usageFactor - 1), unit);
    const grade = roundTo((base + usage) * (gradeFactor - 1), unit);
    const extraFloors = Math.max(0, building.groundFloors - pricing.floorSurcharge.freeFloors);
    const floors = extraFloors * pricing.floorSurcharge.perFloor;
    const underground = building.undergroundFloors * pricing.undergroundPerFloor;

    const items = [
      { code: 'base', name: '기본 점검료', basis: `연면적 ${area.toLocaleString('ko-KR')}㎡ → ${band.label}`, amount: base },
      { code: 'usage', name: '용도 보정', basis: `${building.mainPurpose} → ${usageCategory} 계수 ×${usageFactor}`, amount: usage },
      { code: 'grade', name: '점검 등급 보정', basis: `${conditions.grade} 점검 계수 ×${gradeFactor}`, amount: grade },
      { code: 'floors', name: '고층 가산', basis: `지상 ${building.groundFloors}층 중 ${pricing.floorSurcharge.freeFloors}층 초과 ${extraFloors}개 층 × ${won(pricing.floorSurcharge.perFloor)}`, amount: floors },
      { code: 'underground', name: '지하층 가산', basis: `지하 ${building.undergroundFloors}개 층 × ${won(pricing.undergroundPerFloor)}`, amount: underground },
    ].filter((it) => it.amount !== 0 || it.code === 'base');

    const subtotal = items.reduce((s, it) => s + it.amount, 0);
    const vat = Math.floor(subtotal * pricing.vatRate);
    return { items, subtotal, vat, total: subtotal + vat, meta: { grade: conditions.grade, usageCategory, band: band.label } };
  },

  excelMapping(result) {
    return {
      fields: { grade: `${result.meta.grade} 점검`, usageCategory: result.meta.usageCategory },
      items: result.items.map((it) => ({ name: it.name, basis: it.basis, amount: it.amount })),
    };
  },
};
