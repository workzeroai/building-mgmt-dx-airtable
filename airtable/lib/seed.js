// 운영 테이블 가상 시드: 견적 엔진 시드(data/seed/*.json)에서 이어지는 담당자·점검 일정·점검 결과·청구·동기화 기록.
// - 결정적: 난수 대신 레코드 id의 지문으로 값을 고른다 → 다시 만들어도 같은 파일(깃 diff가 깔끔)
// - 날짜 기준일은 견적 엔진 생성 스크립트와 같은 2026-10-13
// - 모든 값은 지어낸 것. 금액은 계약 연간 금액 ÷ 연간 방문 횟수
import { normalizeSource, recordHash } from '../automations/lib/sync-core.js';

export const TODAY = '2026-10-13';
const STAMP = '2026-10-01T00:00:00.000Z';

const pad = (n, w) => String(n).padStart(w, '0');
/** 문자열 → 0~1 사이 고정 값(FNV-1a). */
export function unit(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h / 0x100000000;
}
const between = (key, min, max) => Math.round(min + unit(key) * (max - min));
const addDays = (ymd, days) => new Date(Date.parse(`${ymd}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
function addMonths(ymd, months) {
  const [y, m, d] = ymd.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(d, last));
  return date.toISOString().slice(0, 10);
}
const short = (division) => division.name.slice(0, 2);

/** 사업자등록번호(가상): 000으로 시작해 실제 번호와 겹치지 않게 한다. */
export function fakeBusinessNo(customerId) {
  const n = Number(customerId.replace(/\D/gu, ''));
  return `000-${pad((n * 37) % 90 + 10, 2)}-${pad((n * 7919) % 100000, 5)}`;
}

/** 계약의 연간 방문 횟수: 사업부 기본값, 기계설비는 견적 조건의 방문 주기(월 12·분기 4). */
export function visitsPerYear(division, quote) {
  if (division.visitsPerYear) return division.visitsPerYear;
  return quote?.conditions?.cycle === '분기' ? 4 : 12;
}

/**
 * @param {{customers, buildings, quotes, contracts}} seed 견적 엔진 시드
 * @param {Array<{id, code, name, visitsPerYear}>} divisions 스키마의 사업부 목록
 * @param {{tables: Record<string, object>}} syncRule syncRules() 결과(사본 지문 계산용)
 */
export function generateOpsSeed(seed, divisions, syncRule) {
  const byId = (rows) => new Map(rows.map((r) => [r.id, r]));
  const quotes = byId(seed.quotes);
  const buildings = byId(seed.buildings);
  const divisionOf = new Map(divisions.map((d) => [d.id, d]));

  // 담당자: 사업부마다 점검원 2·영업 1, 관리자 1
  const staff = [];
  for (const d of divisions) {
    for (const [role, letter] of [['점검원', 'A'], ['점검원', 'B'], ['영업', 'A']]) {
      const id = `stf_${pad(staff.length + 1, 4)}`;
      staff.push({ id, name: `${short(d)} ${role} ${letter}`, divisionId: d.id, role, email: `staff+${id.replace('_', '')}@example.com`, active: true, createdAt: STAMP });
    }
  }
  staff.push({ id: `stf_${pad(staff.length + 1, 4)}`, name: '운영 관리자', divisionId: null, role: '관리자', email: `staff+stf${pad(staff.length + 1, 4)}@example.com`, active: true, createdAt: STAMP });

  const extras = { customers: {}, contracts: {} };
  for (const c of seed.customers) extras.customers[c.id] = { businessNo: fakeBusinessNo(c.id) };

  // 점검 일정: 계약 시작일부터 연간 방문 횟수 간격으로, 2026-12-31까지
  const inspections = [];
  const inspectorsOf = (divisionId) => staff.filter((s) => s.divisionId === divisionId && s.role === '점검원');
  for (const c of seed.contracts) {
    const d = divisionOf.get(c.divisionId);
    const visits = visitsPerYear(d, quotes.get(c.quoteId));
    extras.contracts[c.id] = { visitsPerYear: visits };
    const interval = Math.round(12 / visits);
    for (let k = 0; k < visits; k += 1) {
      const scheduledDate = addMonths(c.startDate, k * interval);
      if (scheduledDate > '2026-12-31' || scheduledDate > c.endDate) break;
      const id = `ins_${pad(inspections.length + 1, 4)}`;
      const past = scheduledDate < TODAY;
      const inspectors = inspectorsOf(c.divisionId);
      inspections.push({
        id, divisionId: c.divisionId, contractId: c.id, buildingId: c.buildingId,
        assigneeId: inspectors[inspections.length % inspectors.length].id, scheduledDate, visitNo: k + 1,
        status: past ? (unit(`${id}:missed`) < 0.08 ? 'missed' : 'done') : 'scheduled', createdAt: c.createdAt,
      });
    }
  }

  // 점검 결과: 완료된 방문마다 1건 + 사업부 확장 필드
  const FINDINGS = {
    fire: ['소화기 압력 저하', '감지기 오작동', '유도등 점등 불량', '방화문 닫힘 불량'],
    telecom: ['단자함 결선 표시 누락', '접지 저항 기준 초과', '회선 감쇠 기준 초과'],
    mechanical: ['필터 오염', '냉각수 수질 기준 초과', '펌프 진동 증가'],
  };
  const inspectionResults = [];
  for (const ins of inspections.filter((x) => x.status === 'done')) {
    const id = `res_${pad(inspectionResults.length + 1, 4)}`;
    const roll = unit(`${id}:result`);
    const result = roll < 0.7 ? 'pass' : roll < 0.92 ? 'actionRequired' : 'fail';
    const defects = result === 'pass' ? between(`${id}:d`, 0, 1) : result === 'actionRequired' ? between(`${id}:d`, 1, 4) : between(`${id}:d`, 3, 8);
    const list = FINDINGS[ins.divisionId];
    const findings = defects === 0 ? '지적 사항 없음' : Array.from({ length: Math.min(defects, 3) }, (_, i) => list[(i + between(`${id}:f`, 0, list.length - 1)) % list.length]).join(', ');
    const row = {
      id, divisionId: ins.divisionId, inspectionId: ins.id, contractId: ins.contractId, inspectedAt: ins.scheduledDate,
      result, defects, findings, createdAt: `${ins.scheduledDate}T09:00:00.000Z`,
    };
    const building = buildings.get(ins.buildingId);
    const contract = seed.contracts.find((c) => c.id === ins.contractId);
    const conditions = quotes.get(contract.quoteId)?.conditions ?? {};
    if (ins.divisionId === 'fire') {
      row.extinguisherCount = Math.max(4, Math.round(building.totalArea / 150));
      row.detectorFaults = Math.min(defects, between(`${id}:det`, 0, 3));
    } else if (ins.divisionId === 'telecom') {
      row.linesTested = conditions.lines ?? 0;
      row.linePassRate = result === 'pass' ? 1 : Math.round((0.9 + unit(`${id}:lp`) * 0.08) * 1000) / 1000;
    } else if (ins.divisionId === 'mechanical') {
      row.filterReplaced = true;
      row.refrigerantChecked = (conditions.chillers ?? 0) > 0;
      row.boilerEfficiency = (conditions.boilers ?? 0) > 0 ? Math.round((0.85 + unit(`${id}:be`) * 0.08) * 1000) / 1000 : null;
    }
    inspectionResults.push(row);
  }

  // 청구: 결과 1건 = 청구 1건. 기한이 지난 건은 대부분 입금, 일부 미수(overdue)
  const invoices = [];
  const seqByDivision = new Map();
  for (const r of inspectionResults) {
    const c = seed.contracts.find((x) => x.id === r.contractId);
    const d = divisionOf.get(r.divisionId);
    const seq = (seqByDivision.get(d.id) ?? 0) + 1;
    seqByDivision.set(d.id, seq);
    const id = `inv_${pad(invoices.length + 1, 4)}`;
    const amount = Math.floor(c.annualAmount / extras.contracts[c.id].visitsPerYear / 10) * 10;
    const issuedAt = addDays(r.inspectedAt, 3);
    const dueDate = addDays(issuedAt, 30);
    const roll = unit(`${id}:paid`);
    let status = 'issued';
    let paidAt = null;
    if (dueDate < TODAY) {
      if (roll < 0.85) {
        status = 'paid';
        paidAt = addDays(dueDate, -between(`${id}:pd`, 0, 12));
      } else status = 'overdue';
    } else if (roll < 0.3 && addDays(issuedAt, 10) < TODAY) {
      status = 'paid';
      paidAt = addDays(issuedAt, between(`${id}:pd`, 3, 10));
    }
    invoices.push({
      id, invoiceNo: `GW-INV-${d.code}-2026-${pad(seq, 3)}`, divisionId: d.id, contractId: c.id, resultId: r.id,
      amount, issuedAt, dueDate, paidAt, paidAmount: status === 'paid' ? amount : 0, status, createdAt: `${issuedAt}T01:00:00.000Z`,
    });
  }

  // 동기화 기록: 사업부마다 테이블별 정상 실행 2회(첫 반영 → 변경 없음). 다음 실행의 급감 비교 기준.
  const counts = { customers: seed.customers.length, buildings: seed.buildings.length, staff: staff.length };
  const syncRuns = [];
  for (const d of divisions) {
    for (const [hour, first] of [[0, true], [1, false]]) {
      for (const key of Object.keys(syncRule.tables)) {
        const n = counts[key];
        syncRuns.push({
          id: `syn_${pad(syncRuns.length + 1, 4)}`, divisionId: d.id, runner: 'airtable-script', tableKey: key,
          startedAt: `${TODAY}T${pad(hour, 2)}:00:00.000Z`, finishedAt: `${TODAY}T${pad(hour, 2)}:00:20.000Z`,
          sourceCount: n, previousCount: first ? null : n, created: first ? n : 0, updated: 0, unchanged: first ? 0 : n,
          skipped: 0, failed: 0, missing: 0, status: 'ok', note: first ? '첫 동기화(가상 시드)' : '변경 없음(가상 시드)',
        });
      }
    }
  }
  return { staff, inspections, inspectionResults, invoices, syncRuns, extras };
}

/** 허브 사본 행: 원본에서 사본 필드만 + 동기화 필드(지문은 동기화 스크립트와 같은 함수). */
export function copyRows(rule, sourceRows, syncedAt = `${TODAY}T01:00:20.000Z`) {
  return sourceRows.map((row) => {
    const out = normalizeSource(rule, row);
    return { ...out, syncedAt, syncHash: recordHash(rule, out), hubMissing: false };
  });
}
