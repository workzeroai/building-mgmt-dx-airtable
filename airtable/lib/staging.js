// 스테이징 Base 준비: 운영 Base를 복제한 뒤 우리 ID(id 필드·텍스트 ID 참조)에 stg_를 붙이고,
// 견적 엔진(6-1)의 스테이징 ID 가드가 읽는 매핑표(id-map.json)를 같은 형식으로 만든다.
//
// 에어테이블에서 Base를 복제하면 레코드 ID(rec…)는 새로 생기지만 우리 id 필드 값은 운영과 같다.
// 그대로 두면 스테이징에서 만든 데이터와 운영 데이터를 ID로 구분할 수 없어 운영 ID가 섞여 들어간다.
// 그래서 복제 직후 ID를 모두 stg_로 바꾸고 매핑표를 남긴다 → 가드가 매핑 없는 운영 ID 쓰기를 막는다.
//   { "tables": { "customers": { "cus_0001": "stg_cus_0001" } }, "created": {} }
// divisionId는 코드가 정한 사업부 ID라 바꾸지 않는다(6-1 규칙과 같음).
import { refFields } from './schema.js';

export const STAGING_PREFIX = 'stg_';
const BATCH = 10; // REST API 한 번에 10건

const stage = (id) => (id === null || id === undefined || String(id).startsWith(STAGING_PREFIX) ? id : `${STAGING_PREFIX}${id}`);

/** 테이블 key → 매핑표의 테이블 이름(6-1 계약 이름. 사본은 원본 테이블과 같은 이름을 쓴다). */
const mapKey = (table) => table.contract ?? table.copyContract ?? table.copyOf?.table ?? table.key;

/**
 * 한 테이블의 레코드 → 바꿀 필드 목록.
 * @param {object} table 스키마 테이블
 * @param {Array<{recId?: string, fields: object}>} records
 */
export function planTable(table, records) {
  const refs = Object.entries(refFields(table)).filter(([, target]) => target !== 'divisions');
  const keepIds = mapKey(table) === 'divisions'; // 사업부 ID는 환경과 무관하게 같다
  const patches = [];
  const mapped = {};
  for (const r of records) {
    const fields = {};
    if (keepIds) {
      // id를 바꾸지 않음
    } else if (r.fields.id && !String(r.fields.id).startsWith(STAGING_PREFIX)) {
      fields.id = stage(r.fields.id);
      mapped[r.fields.id] = fields.id;
    } else if (r.fields.id) {
      mapped[String(r.fields.id).slice(STAGING_PREFIX.length)] = r.fields.id;
    }
    for (const [field] of refs) {
      const v = r.fields[field];
      if (v && !String(v).startsWith(STAGING_PREFIX)) fields[field] = stage(v);
    }
    if (Object.keys(fields).length) patches.push({ recId: r.recId ?? null, id: r.fields.id, fields });
  }
  return { refs: refs.map(([f]) => f), patches, mapped };
}

/**
 * Base 전체 계획.
 * @param {object} base 스키마 Base
 * @param {Map<string, Array>} recordsByTable 테이블 key → [{recId, fields}]
 */
export function planBaseStaging(base, recordsByTable) {
  const tables = [];
  for (const table of base.tables) {
    const records = recordsByTable.get(table.key) ?? [];
    const p = planTable(table, records);
    tables.push({ table, records: records.length, ...p, batches: Math.ceil(p.patches.length / BATCH) });
  }
  return { base, tables };
}

/** 여러 Base 계획 → 6-1 형식 매핑표(사본·원본은 같은 테이블 이름으로 합친다). */
export function idMapFrom(plans) {
  const tables = {};
  for (const plan of plans) {
    for (const t of plan.tables) {
      if (Object.keys(t.mapped).length === 0) continue;
      const key = mapKey(t.table);
      tables[key] = { ...(tables[key] ?? {}), ...t.mapped };
    }
  }
  const sorted = Object.fromEntries(Object.keys(tables).sort().map((k) => [k, Object.fromEntries(Object.entries(tables[k]).sort(([a], [b]) => a.localeCompare(b)))]));
  return { tables: sorted, created: {} };
}

const wide = (s) => [...s].reduce((w, ch) => w + (/[ᄀ-ᇿ㄰-㆏가-힯]/u.test(ch) ? 2 : 1), 0);
const padWide = (s, n) => `${s}${' '.repeat(Math.max(0, n - wide(s)))}`;

export function renderStagingPlan(plan) {
  const lines = [`■ ${plan.base.name} (${plan.base.key})`];
  for (const t of plan.tables) {
    if (t.records === 0) continue;
    const sample = t.patches[0];
    lines.push(`  ${padWide(t.table.name, 10)} 레코드 ${String(t.records).padStart(3)} → PATCH ${String(t.patches.length).padStart(3)}건(${t.batches}회)${t.refs.length ? ` · 참조 ${t.refs.join(', ')}` : ''}${sample ? `  예) ${JSON.stringify(sample.fields)}` : ''}`);
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------- 실제 실행(REST)

const API = 'https://api.airtable.com/v0';

async function listAll(fetchImpl, token, baseId, tableName, fields) {
  const out = [];
  let offset = null;
  do {
    const q = new URLSearchParams({ pageSize: '100' });
    for (const f of fields) q.append('fields[]', f);
    if (offset) q.set('offset', offset);
    const res = await fetchImpl(`${API}/${baseId}/${encodeURIComponent(tableName)}?${q}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`${tableName} 조회 실패 HTTP ${res.status}`);
    const body = await res.json();
    out.push(...body.records.map((r) => ({ recId: r.id, fields: r.fields })));
    offset = body.offset ?? null;
  } while (offset);
  return out;
}

/**
 * 복제한 스테이징 Base에서 ID를 바꾼다. 이미 stg_인 값은 건너뛰므로 다시 실행해도 안전하다.
 * @returns {Promise<object>} planBaseStaging 결과(+ patched 건수)
 */
export async function applyStaging(base, { baseId, token, fetchImpl = globalThis.fetch, delayMs = 250 }) {
  if (!/^app[A-Za-z0-9]{14}$/u.test(baseId ?? '')) throw new Error('스테이징 Base ID 형식이 아닙니다(app + 14자).');
  if (!token) throw new Error('AIRTABLE_TOKEN(data.records:read·write, 스테이징 Base만)이 필요합니다.');
  const recordsByTable = new Map();
  for (const table of base.tables) {
    const fields = ['id', ...Object.keys(refFields(table))];
    recordsByTable.set(table.key, await listAll(fetchImpl, token, baseId, table.name, fields));
  }
  const plan = planBaseStaging(base, recordsByTable);
  let patched = 0;
  for (const t of plan.tables) {
    for (let i = 0; i < t.patches.length; i += BATCH) {
      const batch = t.patches.slice(i, i + BATCH);
      const res = await fetchImpl(`${API}/${baseId}/${encodeURIComponent(t.table.name)}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ records: batch.map((p) => ({ id: p.recId, fields: p.fields })) }),
      });
      if (!res.ok) throw new Error(`${t.table.name} 수정 실패 HTTP ${res.status} (앞선 ${patched}건은 반영됨, 다시 실행하면 이어서 진행)`);
      patched += batch.length;
      if (delayMs) await new Promise((r) => {
        setTimeout(r, delayMs);
      });
    }
  }
  return { ...plan, patched };
}
