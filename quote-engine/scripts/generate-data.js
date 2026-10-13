// 가상 데이터 생성: data/seed/{customers,buildings,quotes,contracts}.json
// - 시드 고정(같은 입력이면 같은 파일) → 깃 diff가 깔끔하다.
// - 견적 금액은 실제 사업부 계산 함수 + 번들 단가로 계산한다(데이터와 엔진이 어긋나지 않게).
// - 사업부 확산 흐름을 데이터에도 반영: 소방(3월~) → 통신(5월~) → 기계(7월~). 날짜·건수는 지어낸 값.
// 사용: npm run data:generate
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadDivisions } from '../src/core/registry.js';
import { loadBundledPricing } from '../src/core/pricing.js';
import { loadSchemas, validateRecord } from '../src/core/store/schema.js';
import { SEED_DIR } from '../src/core/paths.js';

function mulberry32(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
let rand = mulberry32(20261013); // generate()마다 같은 시드로 다시 시작
const pick = (list) => list[Math.floor(rand() * list.length)];
const between = (min, max) => Math.round(min + rand() * (max - min));
const pad = (n, w) => String(n).padStart(w, '0');

const REGIONS = [
  { sido: '서울특별시', sgg: '중구', code: '11140' },
  { sido: '서울특별시', sgg: '마포구', code: '11440' },
  { sido: '서울특별시', sgg: '송파구', code: '11710' },
  { sido: '부산광역시', sgg: '해운대구', code: '26350' },
  { sido: '인천광역시', sgg: '연수구', code: '28185' },
  { sido: '대전광역시', sgg: '유성구', code: '30200' },
  { sido: '경기도', sgg: '성남시 분당구', code: '41135' },
  { sido: '경기도', sgg: '수원시 영통구', code: '41117' },
];
const ROADS = ['예시로', '샘플로', '가상길', '데모대로', '모의로', '시범길', '테스트로', '견본로', '연습로', '본보기길'];
const DONGS = ['가상동', '모의동', '시범동', '견본동', '예시동'];
const PREFIX = ['가온', '누리', '다솜', '라온', '마루', '바른', '새솔', '아라', '한결', '해든', '온새', '미르', '별빛', '푸른', '도담', '이음'];
const PURPOSES = [
  { purpose: '업무시설', w: 5, area: [1800, 26000], floors: [6, 22], under: [1, 5], suffix: ['타워', '오피스', '빌딩'] },
  { purpose: '공동주택', w: 3, area: [6000, 42000], floors: [12, 30], under: [1, 3], suffix: ['빌리지', '하이츠', '파크'] },
  { purpose: '판매시설', w: 3, area: [3000, 30000], floors: [4, 10], under: [2, 5], suffix: ['스퀘어', '몰', '프라자'] },
  { purpose: '공장', w: 2, area: [900, 9000], floors: [1, 4], under: [0, 1], suffix: ['정밀 제1공장', '테크 공장'] },
  { purpose: '교육연구시설', w: 2, area: [1500, 12000], floors: [3, 8], under: [0, 2], suffix: ['교육센터', '연구소'] },
  { purpose: '제2종근린생활시설', w: 2, area: [600, 3500], floors: [3, 7], under: [0, 2], suffix: ['상가', '프라자'] },
  { purpose: '의료시설', w: 1, area: [3000, 15000], floors: [5, 12], under: [1, 3], suffix: ['메디컬센터', '병원'] },
  { purpose: '창고시설', w: 1, area: [2000, 14000], floors: [1, 4], under: [0, 1], suffix: ['물류센터'] },
];
const weighted = (list) => {
  const total = list.reduce((s, x) => s + x.w, 0);
  let r = rand() * total;
  return list.find((x) => (r -= x.w) < 0) ?? list.at(-1);
};
// 고객 이름: 첫 건물의 용도에 맞는 유형·이름을 고른다(모두 지어낸 조합).
// 예) 업무시설 → "온새빌딩 관리단", 공장 → "(주)새솔정밀", 의료시설 → "의료법인 한결의료재단"
// 건물 suffix의 첫 단어(정밀·테크 등)를 회사 이름 줄기로 쓴다.
const stemOf = (suffix) => suffix.split(' ')[0];
const CUSTOMER_STYLES = {
  업무시설: [
    { type: '관리단', name: ({ full }) => `${full} 관리단` },
    { type: '관리사무소', name: ({ full }) => `${full} 관리사무소` },
    { type: '법인', name: ({ prefix }) => `(주)${prefix}자산관리` },
  ],
  공동주택: [{ type: '관리사무소', name: ({ full }) => `${full} 관리사무소` }],
  판매시설: [
    { type: '관리단', name: ({ full }) => `${full} 관리단` },
    { type: '관리사무소', name: ({ full }) => `${full} 관리사무소` },
    { type: '법인', name: ({ prefix }) => `(주)${prefix}리테일` },
  ],
  공장: [
    { type: '법인', name: ({ prefix, suffix }) => `(주)${prefix}${stemOf(suffix)}` },
    { type: '개인사업자', name: ({ prefix, suffix }) => `${prefix}${stemOf(suffix)}` },
  ],
  교육연구시설: [{ type: '법인', name: ({ prefix, suffix }) => (suffix === '교육센터' ? `(재)${prefix}교육재단` : `(주)${prefix}연구소`) }],
  제2종근린생활시설: [
    { type: '개인사업자', name: ({ prefix }) => `${prefix}상사` },
    { type: '관리단', name: ({ full }) => `${full} 관리단` },
  ],
  의료시설: [{ type: '법인', name: ({ prefix }) => `의료법인 ${prefix}의료재단` }],
  창고시설: [{ type: '법인', name: ({ prefix }) => `(주)${prefix}로지스` }],
};

// 건물을 2개 이상 가진 고객은 주로 여러 건물을 맡기는 자산관리·개발 법인이다.
const MULTI_BUILDING_STYLES = [
  { type: '법인', name: ({ prefix }) => `(주)${prefix}자산관리` },
  { type: '법인', name: ({ prefix }) => `${prefix}개발(주)` },
  { type: '법인', name: ({ prefix }) => `(주)${prefix}에셋` },
  { type: '법인', name: ({ prefix }) => `${prefix}물산(주)` },
];

const COLLECTIVE = new Set(['업무시설', '판매시설', '제2종근린생활시설']); // 집합건물이 많은 용도 → 관리단

/** roll(0~1)로 스타일을 고르고, 이미 쓴 이름이면 다음 스타일 → 그래도 겹치면 건물 관리사무소로. */
function customerIdentity(meta, roll, used, multi = false) {
  // 여러 건물 고객: 자산관리·개발 법인, 또는 집합건물 관리단·관리사무소(부속 건물까지 맡김)
  const styles = multi
    ? [...MULTI_BUILDING_STYLES, ...(COLLECTIVE.has(meta.purpose) ? CUSTOMER_STYLES[meta.purpose].filter((x) => x.type !== '법인') : [])]
    : CUSTOMER_STYLES[meta.purpose];
  const start = Math.floor(roll * styles.length);
  for (let k = 0; k < styles.length; k += 1) {
    const style = styles[(start + k) % styles.length];
    const name = style.name(meta);
    if (!used.has(name)) return { type: style.type, name };
  }
  return { type: '관리사무소', name: `${meta.full} 관리사무소` };
}

const iso = (y, m, d) => new Date(Date.UTC(y, m - 1, d, 1, 0, 0)).toISOString();
const addDays = (isoStr, days) => new Date(new Date(isoStr).getTime() + days * 86_400_000).toISOString();

export async function generate() {
  rand = mulberry32(20261013);
  const registry = await loadDivisions();
  const schemas = loadSchemas();
  const pricing = Object.fromEntries(await Promise.all(registry.ids().map(async (id) => [id, await loadBundledPricing(id)])));

  // 건물 36개(고객 24명, 일부 고객은 건물 2개)
  const buildings = [];
  const usedNames = new Set();
  const meta = new Map(); // 건물 ID → 이름 재료(고객 이름 만들 때만 쓰고 저장하지 않음)
  for (let i = 1; i <= 36; i += 1) {
    const kind = weighted(PURPOSES);
    const region = pick(REGIONS);
    let name;
    let prefix;
    let suffix;
    do {
      prefix = pick(PREFIX);
      suffix = pick(kind.suffix);
      name = `${prefix}${suffix}`;
    } while (usedNames.has(name));
    usedNames.add(name);
    meta.set(`bld_${pad(i, 4)}`, { purpose: kind.purpose, prefix, suffix, full: name });
    const bun = between(10, 980);
    buildings.push({
      id: `bld_${pad(i, 4)}`,
      customerId: null,
      roadAddress: `${region.sido} ${region.sgg} ${pick(ROADS)} ${between(1, 240)}`,
      jibunAddress: `${region.sido} ${region.sgg} ${pick(DONGS)} ${bun}`,
      admCd: `${region.code}${pad(between(101, 189) * 100, 5)}`,
      registerKey: null,
      adminCodeFallback: null,
      name: `${name}(가상)`,
      mainPurpose: kind.purpose,
      totalArea: Math.round((kind.area[0] + rand() * (kind.area[1] - kind.area[0])) * 100) / 100,
      groundFloors: between(kind.floors[0], kind.floors[1]),
      undergroundFloors: between(kind.under[0], kind.under[1]),
      dongCount: 1,
      approvalDate: `${between(1995, 2022)}${pad(between(1, 12), 2)}${pad(between(1, 28), 2)}`,
      source: 'seed',
      createdAt: iso(2026, 2, between(2, 27)),
    });
  }

  const customers = [];
  const usedCustomerNames = new Set();
  let b = 0;
  for (let i = 1; i <= 24; i += 1) {
    const owned = i <= 12 ? 2 : 1;
    const first = buildings[b];
    const t = customerIdentity(meta.get(first.id), rand(), usedCustomerNames, owned > 1);
    usedCustomerNames.add(t.name);
    const id = `cus_${pad(i, 4)}`;
    customers.push({
      id, name: t.name, type: t.type,
      region: first.roadAddress.split(' ')[0], contactEmail: `facility+${id.replace('_', '')}@example.com`,
      note: '가상 고객', createdAt: first.createdAt,
    });
    for (let k = 0; k < owned; k += 1) buildings[b + k].customerId = id;
    b += owned;
  }

  // 견적: 사업부별 시작 월(확산 흐름)
  const start = { 1: 3, 2: 5, 3: 7 };
  const quotes = [];
  const dailySeq = new Map();
  let q = 0;
  for (let month = 3; month <= 9; month += 1) {
    for (const division of registry.list()) {
      if (month < (start[division.order] ?? 3)) continue;
      const count = division.order === 1 ? between(6, 9) : division.order === 2 ? between(4, 7) : between(3, 5);
      for (let k = 0; k < count; k += 1) {
        const building = pick(buildings);
        const day = between(1, 28);
        const conditions = {};
        for (const input of division.inputs) {
          conditions[input.key] = input.type === 'select'
            ? pick(input.options)
            : Math.min(input.max ?? 1e9, between(Math.max(input.min ?? 0, Math.round(input.default * 0.3)), Math.round(input.default * 2.5) || 3));
        }
        const result = division.calculateCosts({ building, conditions }, pricing[division.id]);
        const ymd = `2026${pad(month, 2)}${pad(day, 2)}`;
        const key = `${division.code}-${ymd}`;
        dailySeq.set(key, (dailySeq.get(key) ?? 0) + 1);
        const created = iso(2026, month, day);
        const age = (Date.UTC(2026, 9, 13) - new Date(created).getTime()) / 86_400_000;
        const roll = rand();
        const status = age < 20 ? (roll < 0.6 ? 'sent' : 'draft') : roll < 0.42 ? 'won' : roll < 0.75 ? 'lost' : 'sent';
        q += 1;
        quotes.push({
          id: `quo_${pad(q, 4)}`, quoteNo: `GW-${key}-${pad(dailySeq.get(key), 3)}`, divisionId: division.id,
          customerId: building.customerId, buildingId: building.id, conditions, items: result.items,
          subtotal: result.subtotal, vat: result.vat, total: result.total, pricingSource: 'store', pricingVersion: null,
          templateVersionId: null, templateVersion: null, files: null, pdfStatus: null, status, createdAt: created,
        });
      }
    }
  }
  quotes.sort((x, y) => x.createdAt.localeCompare(y.createdAt));
  quotes.forEach((row, i) => { row.id = `quo_${pad(i + 1, 4)}`; });

  const contracts = quotes.filter((row) => row.status === 'won').map((row, i) => {
    const startDate = addDays(row.createdAt, 14).slice(0, 10);
    const endDate = addDays(`${startDate}T00:00:00.000Z`, 364).slice(0, 10);
    return {
      id: `con_${pad(i + 1, 4)}`, contractNo: `GW-C-2026-${pad(i + 1, 3)}`, quoteId: row.id, customerId: row.customerId,
      buildingId: row.buildingId, divisionId: row.divisionId, startDate, endDate, annualAmount: row.total,
      status: startDate > '2026-10-13' ? 'pending' : 'active', createdAt: addDays(row.createdAt, 10),
    };
  });

  const tables = { customers, buildings, quotes, contracts };
  for (const [table, rows] of Object.entries(tables)) {
    for (const row of rows) {
      const errors = validateRecord(schemas[table], row);
      if (errors.length) throw new Error(`${table}/${row.id}: ${errors.join(', ')}`);
    }
  }
  return tables;
}

export async function main(outDir = SEED_DIR) {
  const tables = await generate();
  await fs.mkdir(outDir, { recursive: true });
  for (const [table, rows] of Object.entries(tables)) {
    await fs.writeFile(path.join(outDir, `${table}.json`), `${JSON.stringify(rows, null, 2)}\n`, 'utf8');
  }
  const byDivision = Object.groupBy(tables.quotes, (row) => row.divisionId);
  console.log(`가상 데이터 생성 → ${path.relative(process.cwd(), outDir)}`);
  console.log(`  고객 ${tables.customers.length} · 건물 ${tables.buildings.length} · 견적 ${tables.quotes.length} · 계약 ${tables.contracts.length}`);
  console.log(`  사업부별 견적: ${Object.entries(byDivision).map(([k, v]) => `${k} ${v.length}`).join(' · ')}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
