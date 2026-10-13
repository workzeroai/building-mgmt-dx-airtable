// 스키마 모델 → 에어테이블 Meta API 요청 계획, 그리고 그 계획을 실제로 보내는 실행기.
//
// 순서(연결 필드는 상대 테이블 ID가 있어야 만들 수 있어서 2단계):
//   1) POST /v0/meta/bases/{baseId}/tables                       테이블 + 일반 필드(첫 필드 = 기본 필드)
//   2) POST /v0/meta/bases/{baseId}/tables/{tableId}/fields      정방향 연결(역방향은 에어테이블이 자동 생성)
//      역방향 이름이 기본값(원본 테이블 이름)과 다르면 PATCH …/fields/{fieldId}로 이름을 바꾼다
//   3) 수식·룩업·롤업·개수는 Meta API로 만들 수 없어 "수동 추가" 목록으로 남긴다
// 실행기는 먼저 GET …/tables로 이미 있는 테이블·필드를 읽고 없는 것만 만든다(다시 실행해도 안전).
import { COMPUTED_TYPES, apiType, forwardLinks, plainFields } from './schema.js';

export const META_API = 'https://api.airtable.com';

function fieldOptions(f, timeZone) {
  switch (f.type) {
    case 'number':
      return { precision: f.integer ? 0 : 2 };
    case 'currency':
      return { precision: 0, symbol: '₩' };
    case 'percent':
      return { precision: 1 };
    case 'singleSelect':
      return { choices: f.choices.map((name) => ({ name })) };
    case 'date':
      return { dateFormat: { name: 'iso' } };
    case 'dateTime':
      return { dateFormat: { name: 'iso' }, timeFormat: { name: '24hour' }, timeZone };
    case 'checkbox':
      return { icon: 'check', color: 'greenBright' };
    default:
      return null;
  }
}

export function fieldRequest(f, { timeZone = 'Asia/Seoul', description } = {}) {
  const out = { name: f.name, type: apiType(f.type) };
  const desc = [description ?? f.desc, f.json ? 'JSON 문자열' : null].filter(Boolean).join(' · ');
  if (desc) out.description = desc.slice(0, 20000);
  const options = fieldOptions(f, timeZone);
  if (options) out.options = options;
  return out;
}

function describe(f, table, contracts) {
  if (f.desc) return f.desc;
  const schema = table.contract ?? table.copyContract;
  return schema ? contracts?.[schema]?.properties?.[f.name]?.description : undefined;
}

/**
 * @returns {{base: object, steps: object[], manual: object[]}}
 *   steps[i] = { kind: 'createTable'|'createLink'|'renameInverse', table, field?, method, path, body }
 *   경로의 {baseId}·{tableId:이름}·{fieldId:테이블.필드}는 실행할 때 실제 ID로 바뀐다.
 */
export function planBase(model, base) {
  const steps = [];
  const manual = [];
  for (const table of base.tables) {
    steps.push({
      kind: 'createTable',
      table: table.name,
      method: 'POST',
      path: '/v0/meta/bases/{baseId}/tables',
      body: {
        name: table.name,
        description: table.description || undefined,
        fields: plainFields(table).map((f) => fieldRequest(f, { timeZone: model.timeZone, description: describe(f, table, model.contracts) })),
      },
    });
  }
  for (const table of base.tables) {
    for (const f of forwardLinks(table)) {
      const target = base.tables.find((t) => t.key === f.to);
      steps.push({
        kind: 'createLink',
        table: table.name,
        field: f.name,
        method: 'POST',
        path: `/v0/meta/bases/{baseId}/tables/{tableId:${table.name}}/fields`,
        body: { name: f.name, type: 'multipleRecordLinks', description: f.desc ?? (f.from ? `${f.from}로 채우는 연결(자동화)` : undefined), options: { linkedTableId: `{tableId:${target.name}}` } },
      });
      const inverse = target.fields.find((x) => x.inverseOf === `${table.key}.${f.name}`);
      if (inverse && inverse.name !== table.name) {
        steps.push({
          kind: 'renameInverse',
          table: target.name,
          field: inverse.name,
          method: 'PATCH',
          path: `/v0/meta/bases/{baseId}/tables/{tableId:${target.name}}/fields/{inverseOf:${table.name}.${f.name}}`,
          body: { name: inverse.name },
        });
      }
    }
  }
  for (const table of base.tables) {
    for (const f of table.fields.filter((x) => COMPUTED_TYPES.includes(x.type))) {
      const def = f.type === 'formula' ? f.formula : f.type === 'count' ? `COUNT(${f.via})` : f.type === 'rollup' ? `${f.via}.${f.field} → ${f.fn}` : `${f.via}.${f.field}`;
      manual.push({ table: table.name, field: f.name, type: f.type, definition: def });
    }
  }
  for (const s of steps) if (s.body.description === undefined) delete s.body.description;
  return { base, steps, manual };
}

/** 사람이 읽는 dry-run 출력. 토큰·실제 ID는 나오지 않는다. */
export function renderPlan(plan) {
  const { base, steps, manual } = plan;
  const lines = [];
  const tables = steps.filter((s) => s.kind === 'createTable');
  const fieldCount = tables.reduce((n, s) => n + s.body.fields.length, 0);
  const links = steps.filter((s) => s.kind === 'createLink').length;
  lines.push(`■ ${base.name} (${base.key}) — 테이블 ${tables.length} · 일반 필드 ${fieldCount} · 연결 ${links} · 수동 추가 ${manual.length}`);
  steps.forEach((s, i) => {
    const what = s.kind === 'createTable' ? `테이블 "${s.table}" (필드 ${s.body.fields.length})` : s.kind === 'createLink' ? `연결 "${s.table}.${s.field}" → ${s.body.options.linkedTableId}` : `역방향 이름 "${s.table}.${s.field}"`;
    lines.push(`${String(i + 1).padStart(3)}. ${s.method} ${s.path}  ${what}`);
    lines.push(`     ${JSON.stringify(s.body)}`);
  });
  if (manual.length) {
    lines.push(`  수동 추가(Meta API로 만들 수 없는 계산 필드) ${manual.length}개:`);
    for (const m of manual) lines.push(`   - ${m.table}.${m.field} (${m.type}): ${m.definition}`);
  }
  return lines.join('\n');
}

const sleep = (ms) => new Promise((r) => {
  setTimeout(r, ms);
});

/**
 * 계획을 실제 Base에 보낸다. 이미 있는 테이블·필드는 건너뛴다.
 * @param {object} plan planBase() 결과
 * @param {{baseId: string, token: string, fetchImpl?: Function, delayMs?: number, log?: Function}} options
 */
export async function applyPlan(plan, { baseId, token, fetchImpl = globalThis.fetch, delayMs = 250, log = () => {} }) {
  if (!/^app[A-Za-z0-9]{14}$/u.test(baseId ?? '')) throw new Error('Base ID 형식이 아닙니다(app + 14자).');
  if (!token) throw new Error('AIRTABLE_TOKEN(스키마 쓰기 권한 PAT)이 필요합니다.');
  const call = async (method, path, body) => {
    const res = await fetchImpl(`${META_API}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Meta API ${method} ${path.replace(baseId, '{baseId}')} → HTTP ${res.status}: ${text.slice(0, 300)}`);
    if (delayMs) await sleep(delayMs); // Base당 초당 5회 한도
    return text ? JSON.parse(text) : {};
  };
  const existing = await call('GET', `/v0/meta/bases/${baseId}/tables`);
  const tables = new Map(existing.tables.map((t) => [t.name, { id: t.id, fields: new Map(t.fields.map((f) => [f.name, f])) }]));
  const inverseIds = new Map();
  const result = { createdTables: 0, createdFields: 0, createdLinks: 0, renamed: 0, skipped: 0 };
  const resolve = (text) => text
    .replace('{baseId}', baseId)
    .replace(/\{tableId:([^}]+)\}/gu, (_, name) => {
      const t = tables.get(name);
      if (!t) throw new Error(`테이블 ID를 모름: ${name}`);
      return t.id;
    })
    .replace(/\{inverseOf:([^}]+)\}/gu, (_, key) => {
      const id = inverseIds.get(key);
      if (!id) throw new Error(`역방향 필드 ID를 모름: ${key}`);
      return id;
    });

  for (const step of plan.steps) {
    if (step.kind === 'createTable') {
      const have = tables.get(step.table);
      if (!have) {
        const t = await call('POST', resolve(step.path), step.body);
        tables.set(t.name, { id: t.id, fields: new Map(t.fields.map((f) => [f.name, f])) });
        result.createdTables += 1;
        log(`테이블 생성: ${step.table}`);
        continue;
      }
      for (const f of step.body.fields) {
        if (have.fields.has(f.name)) {
          result.skipped += 1;
          continue;
        }
        const created = await call('POST', `/v0/meta/bases/${baseId}/tables/${have.id}/fields`, f);
        have.fields.set(created.name, created);
        result.createdFields += 1;
        log(`필드 추가: ${step.table}.${f.name}`);
      }
    } else if (step.kind === 'createLink') {
      const t = tables.get(step.table);
      const found = t?.fields.get(step.field);
      if (found) {
        if (found.options?.inverseLinkFieldId) inverseIds.set(`${step.table}.${step.field}`, found.options.inverseLinkFieldId);
        result.skipped += 1;
        continue;
      }
      const body = JSON.parse(resolve(JSON.stringify(step.body)));
      const created = await call('POST', resolve(step.path), body);
      t.fields.set(created.name, created);
      if (created.options?.inverseLinkFieldId) inverseIds.set(`${step.table}.${step.field}`, created.options.inverseLinkFieldId);
      result.createdLinks += 1;
      log(`연결 생성: ${step.table}.${step.field}`);
    } else if (step.kind === 'renameInverse') {
      const t = tables.get(step.table);
      if (t?.fields.has(step.field)) {
        result.skipped += 1;
        continue;
      }
      await call('PATCH', resolve(step.path), step.body);
      result.renamed += 1;
    }
  }
  return { ...result, manual: plan.manual.length };
}
