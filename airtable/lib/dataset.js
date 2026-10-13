// Base·테이블별 가상 레코드 묶음. 견적 엔진 시드(data/seed/*.json)를 그대로 쓰고
// 운영 테이블 시드(lib/seed.js)를 이어 붙인다. CSV·스테이징 복제 계획·테스트가 같은 묶음을 쓴다.
import fs from 'node:fs';
import path from 'node:path';
import { loadDivisions } from '../../quote-engine/src/core/registry.js';
import { divisionRecords, pricingRecords } from '../../quote-engine/src/core/store/seed.js';
import { PRICING_DIR, SEED_DIR } from './paths.js';
import { copyRows, generateOpsSeed } from './seed.js';
import { dataFields, forwardLinks, syncRules, valueKind } from './schema.js';

export const ENGINE_SEED_TABLES = ['customers', 'buildings', 'quotes', 'contracts'];

export function loadEngineSeed(dir = SEED_DIR) {
  return Object.fromEntries(ENGINE_SEED_TABLES.map((t) => [t, JSON.parse(fs.readFileSync(path.join(dir, `${t}.json`), 'utf8'))]));
}

/**
 * @returns {Promise<{rows: Map<string, Map<string, object[]>>, ops: object, seed: object}>}
 *   rows: baseKey → tableKey → 평평한 레코드(단일 선택은 문자열, JSON 필드는 객체)
 */
export async function loadDataset(model, { seedDir = SEED_DIR, pricingDir = PRICING_DIR } = {}) {
  const seed = loadEngineSeed(seedDir);
  const registry = await loadDivisions();
  const rules = syncRules(model);
  const ops = generateOpsSeed(seed, model.divisions, rules);
  const divisions = divisionRecords(registry);
  const pricing = await pricingRecords(registry, pricingDir);
  const withExtras = (rows, extras = {}) => rows.map((r) => ({ ...r, ...(extras[r.id] ?? {}) }));
  const hubRows = {
    divisions,
    customers: withExtras(seed.customers, ops.extras.customers),
    buildings: seed.buildings,
    staff: ops.staff,
  };

  const rows = new Map();
  for (const base of model.bases) {
    const tables = new Map();
    for (const table of base.tables) {
      let list = [];
      if (base.kind === 'hub') list = hubRows[table.key] ?? [];
      else if (table.copyOf) list = copyRows(rules.tables[table.key], hubRows[table.copyOf.table]);
      else {
        const own = (r) => r.divisionId === base.key;
        const byTable = {
          quotes: seed.quotes,
          contracts: withExtras(seed.contracts, ops.extras.contracts),
          pricing,
          inspections: ops.inspections,
          inspectionResults: ops.inspectionResults,
          invoices: ops.invoices,
          syncRuns: ops.syncRuns,
        };
        list = (byTable[table.key] ?? []).filter(own);
      }
      // 상태 전이 가드의 기준값: 가져온 시점의 상태를 허용된 상태로 둔다
      if (table.statusFlow) list = list.map((r) => ({ ...r, statusConfirmed: r[table.statusFlow.field] ?? null }));
      tables.set(table.key, list);
    }
    rows.set(base.key, tables);
  }
  return { rows, ops, seed };
}

// ---------------------------------------------------------------- 행 검증(스키마 YAML 기준)

/** @returns {string[]} 오류 목록 */
export function validateRow(table, row) {
  const errors = [];
  const fields = new Map(dataFields(table).map((f) => [f.name, f]));
  for (const key of Object.keys(row)) if (!fields.has(key)) errors.push(`${key}: 테이블에 없는 데이터 필드`);
  for (const r of table.required) if (row[r] === null || row[r] === undefined) errors.push(`${r}: 필수 값 없음`);
  if (table.idPattern && typeof row.id === 'string' && !new RegExp(table.idPattern, 'u').test(row.id)) errors.push(`id: 형식 ${table.idPattern} 불일치`);
  for (const [name, f] of fields) {
    const v = row[name];
    if (v === null || v === undefined) continue;
    const kind = valueKind(f);
    const bad = (why) => errors.push(`${name}: ${why} (${JSON.stringify(v).slice(0, 40)})`);
    if (f.json) {
      if (typeof v !== 'object') bad('JSON 객체·배열이어야 함');
    } else if (kind === 'integer') {
      if (!Number.isInteger(v)) bad('정수여야 함');
    } else if (kind === 'number') {
      if (typeof v !== 'number' || !Number.isFinite(v)) bad('숫자여야 함');
      else if (f.type === 'percent' && (v < 0 || v > 1)) bad('비율은 0~1');
    } else if (kind === 'boolean') {
      if (typeof v !== 'boolean') bad('true/false여야 함');
    } else if (kind === 'select') {
      if (!f.choices.includes(v)) bad(`선택지 밖(${f.choices.join('|')})`);
    } else if (kind === 'date') {
      if (!/^\d{4}-\d{2}-\d{2}$/u.test(v)) bad('YYYY-MM-DD여야 함');
    } else if (kind === 'dateTime') {
      if (typeof v !== 'string' || Number.isNaN(Date.parse(v))) bad('ISO 날짜·시간이어야 함');
    } else if (typeof v !== 'string') bad('문자열이어야 함');
    else if (f.type === 'email' && !/^[^@\s]+@example\.com$/u.test(v)) bad('가상 데이터 이메일은 example.com만');
  }
  return errors;
}

/** 모든 Base·테이블 행 검사 + 연결 ID가 같은 Base 안에 실제로 있는지. */
export function validateDataset(model, rows) {
  const problems = [];
  for (const base of model.bases) {
    const tables = rows.get(base.key);
    for (const table of base.tables) {
      const list = tables.get(table.key) ?? [];
      const ids = new Set();
      for (const row of list) {
        for (const e of validateRow(table, row)) problems.push(`${base.key}.${table.key}/${row.id}: ${e}`);
        if (ids.has(row.id)) problems.push(`${base.key}.${table.key}/${row.id}: id 중복`);
        ids.add(row.id);
      }
      for (const link of forwardLinks(table).filter((f) => f.from)) {
        const targetIds = new Set((tables.get(link.to) ?? []).map((r) => r.id));
        for (const row of list) {
          if (row[link.from] && !targetIds.has(row[link.from])) problems.push(`${base.key}.${table.key}/${row.id}.${link.from}: ${link.to}에 없는 ${row[link.from]}`);
        }
      }
    }
  }
  return problems;
}

// ---------------------------------------------------------------- CSV(에어테이블 CSV 가져오기용)

function csvCell(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n\r]/u.test(s) ? `"${s.replace(/"/gu, '""')}"` : s;
}

/** CSV 열: 데이터 필드 + ID로 채울 수 있는 정방향 연결(값 = 대상 레코드의 기본 필드 값). */
export function csvColumns(table) {
  return [...dataFields(table).map((f) => f.name), ...forwardLinks(table).filter((f) => f.from).map((f) => f.name)];
}

export function renderCsv(base, table, rows) {
  const fields = new Map(table.fields.map((f) => [f.name, f]));
  const primaryOf = (tableKey, id) => {
    const target = base.tables.find((t) => t.key === tableKey);
    const row = rows.get(tableKey)?.find((r) => r.id === id);
    return row ? row[target.primary] : null;
  };
  const cols = csvColumns(table);
  const lines = [cols.join(',')];
  for (const row of rows.get(table.key) ?? []) {
    lines.push(cols.map((c) => {
      const f = fields.get(c);
      if (f.type === 'link') return csvCell(row[f.from] ? primaryOf(f.to, row[f.from]) : null);
      const v = row[c];
      if (f.json && v !== null && v !== undefined) return csvCell(JSON.stringify(v));
      if (f.type === 'checkbox') return v ? 'checked' : '';
      return csvCell(v);
    }).join(','));
  }
  return lines.map((l) => `${l}\n`).join('');
}

/** 가져오기 순서: 연결 대상이 먼저 있어야 연결이 이어진다. */
export function importOrder(base) {
  const order = [];
  const visit = (table, stack = new Set()) => {
    if (order.includes(table) || stack.has(table)) return;
    stack.add(table);
    for (const link of forwardLinks(table)) {
      const target = base.tables.find((t) => t.key === link.to);
      if (target && target !== table) visit(target, stack);
    }
    order.push(table);
  };
  for (const t of base.tables) visit(t);
  return order;
}
