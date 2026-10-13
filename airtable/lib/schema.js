// 스키마 YAML(airtable/schema/gridwell.yaml)을 읽어 "펼친 모델"로 만들고 구조를 검사한다.
//
// 펼치기:
//   1) 사업부 Base 틀(kind: division)을 사업부마다 1개씩 만든다(이름의 {divisionName} 치환)
//   2) commonTables(자동화 오류)를 모든 Base에 넣는다
//   3) copyOf(허브 사본)는 허브 테이블의 필드를 그대로 가져와 owner: copy로 붙인다
//   4) extensions(사업부 확장 필드)를 해당 사업부 Base에만 붙인다
//   5) statusFlow가 있는 테이블에 가드용 필드(statusConfirmed·statusNote)를 붙인다
//   6) 정방향 연결의 역방향 필드를 상대 테이블에 만든다(에어테이블이 자동으로 만드는 것과 같게)
//   7) 데이터 계약 테이블은 ID 접두어·필수 필드를 계약(JSON Schema)에서 가져온다
import fs from 'node:fs';
import YAML from 'yaml';
import { loadSchemas } from '../../quote-engine/src/core/store/schema.js';
import { CONTRACT_DIR, SCHEMA_FILE } from './paths.js';

export const PLAIN_TYPES = ['singleLineText', 'multilineText', 'email', 'url', 'number', 'currency', 'percent', 'singleSelect', 'date', 'dateTime', 'checkbox'];
export const COMPUTED_TYPES = ['formula', 'lookup', 'rollup', 'count'];
export const FIELD_TYPES = [...PLAIN_TYPES, 'link', ...COMPUTED_TYPES];
export const TEXT_TYPES = ['singleLineText', 'multilineText', 'email', 'url'];
export const OWNERS = ['contract', 'ops', 'copy', 'link', 'computed'];
export const OWNER_LABEL = {
  contract: '데이터 계약',
  ops: '운영',
  copy: '허브 사본',
  link: '연결',
  computed: '계산',
};
/** 에어테이블 API 타입 이름(link·lookup은 줄임말). */
export const API_TYPE = { link: 'multipleRecordLinks', lookup: 'multipleLookupValues' };
export const apiType = (type) => API_TYPE[type] ?? type;

export function loadRawSchema(file = SCHEMA_FILE) {
  return YAML.parse(fs.readFileSync(file, 'utf8'));
}

const clone = (v) => structuredClone(v);

function normalizeField(raw, defaults) {
  const f = { ...raw };
  if (f.type === 'link') f.owner = 'link';
  else if (COMPUTED_TYPES.includes(f.type)) f.owner = 'computed';
  else f.owner ??= defaults.owner;
  if (defaults.extension) f.extension = defaults.extension;
  return f;
}

function idPattern(prefix) {
  return prefix ? `^(stg_)?${prefix}_[0-9a-z]+$` : null;
}

function buildTable(raw, ctx) {
  const table = {
    key: raw.key,
    name: raw.name,
    description: raw.description ?? '',
    contract: raw.contract ?? null,
    copyOf: raw.copyOf ? clone(raw.copyOf) : null,
    idPrefix: raw.idPrefix ?? null,
    primary: raw.primary ?? 'id',
    required: raw.required ? [...raw.required] : [],
    statusFlow: raw.statusFlow ? clone(raw.statusFlow) : null,
    baseKey: ctx.base.key,
    common: Boolean(ctx.common),
    fields: [],
  };
  const owner = table.contract ? 'contract' : 'ops';
  table.fields = (raw.fields ?? []).map((f) => normalizeField(f, { owner }));
  return table;
}

/**
 * @param {object} raw loadRawSchema() 결과
 * @param {{contracts?: Record<string, object>}} [options] 견적 엔진 데이터 계약(기본: data/schema)
 */
export function expandSchema(raw, { contracts = loadSchemas(CONTRACT_DIR) } = {}) {
  const model = {
    version: raw.version,
    title: raw.title,
    company: raw.company ?? raw.title,
    timeZone: raw.timeZone ?? 'Asia/Seoul',
    divisions: clone(raw.divisions ?? []),
    sync: clone(raw.sync ?? {}),
    bases: [],
    contracts,
  };
  const templates = Object.fromEntries((raw.bases ?? []).map((b) => [b.kind, b]));
  const commons = raw.commonTables ?? [];

  const makeBase = (tpl, key, division = null) => {
    const base = {
      key,
      kind: tpl.kind,
      division,
      name: division ? tpl.name.replace('{divisionName}', division.name) : tpl.name,
      description: tpl.description ?? '',
      tables: [],
    };
    base.tables = (tpl.tables ?? []).map((t) => buildTable(t, { base }));
    base.tables.push(...commons.map((t) => buildTable(t, { base, common: true })));
    return base;
  };

  if (templates.hub) model.bases.push(makeBase(templates.hub, 'hub'));
  if (templates.division) {
    for (const division of model.divisions) model.bases.push(makeBase(templates.division, division.id, division));
  }
  const hub = model.bases.find((b) => b.kind === 'hub');

  for (const base of model.bases) {
    for (const table of base.tables) {
      // 3) 허브 사본
      if (table.copyOf) {
        const source = hub?.tables.find((t) => t.key === table.copyOf.table);
        const copied = [];
        for (const name of table.copyOf.fields ?? []) {
          const f = source?.fields.find((x) => x.name === name);
          if (f) copied.push({ ...clone(f), owner: 'copy', desc: f.desc });
          else copied.push({ name, type: 'singleLineText', owner: 'copy', missingInSource: true });
        }
        table.fields = [...copied, ...table.fields];
        table.contract = null;
        table.copyContract = source?.contract ?? null;
        table.idPrefix = source?.idPrefix ?? (source?.contract ? contracts[source.contract]?.['x-idPrefix'] : null) ?? table.idPrefix;
        table.primary = source && copied.some((f) => f.name === source.primary) ? source.primary : 'id';
        table.required = (source ? requiredOf(source, contracts) : []).filter((n) => table.copyOf.fields.includes(n));
      }
      // 4) 사업부 확장
      const ext = base.division ? raw.extensions?.[base.division.id]?.[table.key] : null;
      if (ext) table.fields.push(...ext.map((f) => normalizeField(f, { owner: 'ops', extension: base.division.id })));
      // 5) 상태 전이 가드 필드
      if (table.statusFlow) {
        table.fields.push(
          { name: 'statusConfirmed', type: 'singleLineText', owner: 'ops', auto: 'statusFlow', desc: '상태 전이 가드가 마지막으로 허용한 상태(되돌릴 기준)' },
          { name: 'statusNote', type: 'multilineText', owner: 'ops', auto: 'statusFlow', desc: '상태 전이 기록(허용·거부 사유)' },
        );
      }
      // 7) 계약 테이블: 접두어·필수 필드
      if (table.contract && contracts[table.contract]) {
        table.idPrefix = contracts[table.contract]['x-idPrefix'];
        table.required = [...(contracts[table.contract].required ?? [])];
      }
      table.idPattern = idPattern(table.idPrefix);
      // 기본 필드를 맨 앞으로(에어테이블은 테이블 생성 요청의 첫 필드를 기본 필드로 쓴다)
      const pi = table.fields.findIndex((f) => f.name === table.primary);
      if (pi > 0) table.fields.unshift(...table.fields.splice(pi, 1));
    }
  }

  // 6) 역방향 연결
  for (const base of model.bases) {
    for (const table of base.tables) {
      for (const f of table.fields.filter((x) => x.type === 'link' && !x.inverseOf)) {
        if (f.to === table.key || f.inverse === false) continue;
        const target = base.tables.find((t) => t.key === f.to);
        if (!target) continue;
        const name = f.inverse ?? table.name;
        if (target.fields.some((x) => x.name === name)) {
          target.fields.push({ name, type: 'link', owner: 'link', to: table.key, inverseOf: `${table.key}.${f.name}`, duplicateInverse: true });
        } else {
          target.fields.push({ name, type: 'link', owner: 'link', to: table.key, inverseOf: `${table.key}.${f.name}`, desc: `${table.name}.${f.name}의 역방향(자동)` });
        }
      }
    }
  }
  return model;
}

function requiredOf(table, contracts) {
  if (table.contract && contracts[table.contract]) return contracts[table.contract].required ?? [];
  return table.required ?? [];
}

export function loadModel(options = {}) {
  return expandSchema(loadRawSchema(options.file), options);
}

// ---------------------------------------------------------------- 조회 도우미

export const baseByKey = (model, key) => model.bases.find((b) => b.key === key);
export const tableByKey = (base, key) => base.tables.find((t) => t.key === key);
export const fieldByName = (table, name) => table.fields.find((f) => f.name === name);
export const isComputed = (f) => COMPUTED_TYPES.includes(f.type);
/** 레코드 데이터로 쓰는 필드(연결·계산 제외). CSV·시드·검증의 기준. */
export const dataFields = (table) => table.fields.filter((f) => PLAIN_TYPES.includes(f.type));
/** 에어테이블 생성 요청에서 테이블과 함께 만드는 필드(연결·계산 제외). */
export const plainFields = dataFields;
/** 정방향 연결(역방향 자동 필드 제외). */
export const forwardLinks = (table) => table.fields.filter((f) => f.type === 'link' && !f.inverseOf);
/** 다른 테이블의 id를 담는 텍스트 필드 { 필드: 대상 테이블 key } — 연결의 from + ref 표시. */
export function refFields(table) {
  const out = {};
  for (const f of forwardLinks(table)) if (f.from && f.to !== table.key) out[f.from] = f.to;
  for (const f of table.fields) if (f.ref) out[f.name] = f.ref;
  return out;
}
export const allTables = (model) => model.bases.flatMap((b) => b.tables.map((t) => ({ base: b, table: t })));

export function formulaRefs(formula) {
  return [...String(formula).matchAll(/\{([^}]+)\}/gu)].map((m) => m[1]);
}

/** 요약 수치(문서·보고용). */
export function stats(model) {
  const tables = allTables(model);
  const fields = tables.flatMap(({ table }) => table.fields);
  const byOwner = Object.fromEntries(OWNERS.map((o) => [o, fields.filter((f) => f.owner === o).length]));
  return {
    bases: model.bases.length,
    tables: tables.length,
    fields: fields.length,
    links: fields.filter((f) => f.type === 'link' && !f.inverseOf).length,
    computed: fields.filter(isComputed).length,
    byOwner,
  };
}

// ---------------------------------------------------------------- 구조 검사

const PRIMARY_TYPES = ['singleLineText', 'multilineText', 'email', 'url', 'number', 'currency', 'percent', 'date', 'dateTime'];

/** @returns {string[]} 오류 목록(비어 있으면 통과) */
export function validateModel(model) {
  const errors = [];
  const err = (where, msg) => errors.push(`${where}: ${msg}`);
  if (!model.bases.some((b) => b.kind === 'hub')) err('bases', '허브 Base(kind: hub)가 없습니다');
  if (!model.bases.some((b) => b.kind === 'division')) err('bases', '사업부 Base(kind: division)가 없습니다');
  const divisionIds = new Set(model.divisions.map((d) => d.id));
  if (divisionIds.size !== model.divisions.length) err('divisions', '사업부 id 중복');

  for (const base of model.bases) {
    const tableKeys = new Set();
    const tableNames = new Set();
    for (const table of base.tables) {
      const where = `${base.key}.${table.key}`;
      if (tableKeys.has(table.key)) err(where, '테이블 key 중복');
      if (tableNames.has(table.name)) err(where, `테이블 이름 중복: ${table.name}`);
      tableKeys.add(table.key);
      tableNames.add(table.name);

      const names = new Set();
      for (const f of table.fields) {
        const fw = `${where}.${f.name}`;
        if (names.has(f.name)) err(fw, '필드 이름 중복');
        names.add(f.name);
        if (!FIELD_TYPES.includes(f.type)) err(fw, `알 수 없는 타입 ${f.type}`);
        if (!OWNERS.includes(f.owner)) err(fw, `알 수 없는 owner ${f.owner}`);
        if (f.missingInSource) err(fw, `copyOf 원본(허브 ${table.copyOf.table})에 없는 필드`);
        if (f.duplicateInverse) err(fw, '역방향 연결 이름이 기존 필드와 겹칩니다(inverse로 다른 이름을 주세요)');
        if (f.type === 'singleSelect' && (!Array.isArray(f.choices) || f.choices.length === 0 || new Set(f.choices).size !== f.choices.length)) {
          err(fw, '단일 선택에는 겹치지 않는 choices가 필요합니다');
        }
        if (f.json && !['multilineText'].includes(f.type)) err(fw, 'json 필드는 multilineText여야 합니다');
        if ((f.owner === 'contract' || f.owner === 'ops' || f.owner === 'copy') && !/^[a-z][A-Za-z0-9]*$/u.test(f.name)) {
          err(fw, '코드가 읽고 쓰는 필드 이름은 영문 camelCase여야 합니다');
        }
        if (f.ref) {
          if (!TEXT_TYPES.includes(f.type)) err(fw, 'ref는 텍스트 필드에만 씁니다');
          if (!base.tables.some((t) => t.key === f.ref)) err(fw, `ref 대상 ${f.ref}이(가) 같은 Base에 없습니다`);
        }
        if (f.type === 'link') {
          const target = base.tables.find((t) => t.key === f.to);
          if (!target) err(fw, `연결 대상 테이블 ${f.to}이(가) 같은 Base에 없습니다`);
          if (f.from) {
            const src = table.fields.find((x) => x.name === f.from);
            if (!src || !TEXT_TYPES.includes(src.type)) err(fw, `from 필드 ${f.from}이(가) 없거나 텍스트가 아닙니다`);
          }
        }
        if (f.type === 'lookup' || f.type === 'rollup' || f.type === 'count') {
          const via = table.fields.find((x) => x.name === f.via && x.type === 'link');
          if (!via) err(fw, `via ${f.via}은(는) 이 테이블의 연결 필드여야 합니다`);
          else if (f.type !== 'count') {
            const target = base.tables.find((t) => t.key === via.to);
            if (!target?.fields.some((x) => x.name === f.field)) err(fw, `${via.to}에 ${f.field} 필드가 없습니다`);
          }
          if (f.type === 'rollup' && !f.fn) err(fw, 'rollup에는 fn(집계 수식)이 필요합니다');
        }
        if (f.type === 'formula') {
          if (!f.formula) err(fw, '수식이 비었습니다');
          for (const ref of formulaRefs(f.formula ?? '')) if (!table.fields.some((x) => x.name === ref)) err(fw, `수식이 없는 필드 {${ref}}를 참조합니다`);
        }
      }
      const primary = table.fields[0];
      if (!primary || primary.name !== table.primary) err(where, `기본 필드 ${table.primary}이(가) 없습니다`);
      else if (!PRIMARY_TYPES.includes(primary.type)) err(where, `기본 필드 타입 ${primary.type}은(는) 쓸 수 없습니다`);
      if (!names.has('id')) err(where, '모든 테이블에는 우리 ID를 담는 id 필드가 있어야 합니다');
      if (!table.contract && !table.idPrefix) err(where, 'idPrefix가 필요합니다');
      for (const r of table.required) if (!names.has(r)) err(where, `필수 필드 ${r}이(가) 없습니다`);
      if (base.kind === 'division' && !table.copyOf && !table.common && !names.has('divisionId')) {
        err(where, '사업부 Base의 업무 테이블에는 divisionId가 필요합니다');
      }
      if (table.statusFlow) {
        const sf = table.fields.find((x) => x.name === table.statusFlow.field);
        const states = Object.keys(table.statusFlow.transitions ?? {});
        if (!sf || sf.type !== 'singleSelect') err(where, 'statusFlow.field는 단일 선택 필드여야 합니다');
        else if (JSON.stringify([...states].sort()) !== JSON.stringify([...sf.choices].sort())) err(where, 'statusFlow 상태 목록이 선택지와 다릅니다');
        for (const [from, tos] of Object.entries(table.statusFlow.transitions ?? {})) {
          for (const to of tos) if (!states.includes(to)) err(where, `전이 ${from} → ${to}: 없는 상태`);
        }
      }
    }
  }

  // 확장 필드: 사업부 틀에 있는 테이블에만
  const divisionBase = model.bases.find((b) => b.kind === 'division');
  if (divisionBase) {
    for (const d of model.divisions) {
      const b = model.bases.find((x) => x.key === d.id);
      if (!b) err(`divisions.${d.id}`, '사업부 Base가 만들어지지 않았습니다');
    }
  }

  // 동기화 정의
  const sync = model.sync ?? {};
  if (!['hub-to-division'].includes(sync.direction)) err('sync', 'direction은 hub-to-division만 지원합니다');
  if (!(sync.maxDropRatio > 0 && sync.maxDropRatio < 1)) err('sync', 'maxDropRatio는 0과 1 사이');
  for (const key of sync.tables ?? []) {
    for (const base of model.bases.filter((b) => b.kind === 'division')) {
      const t = base.tables.find((x) => x.key === key);
      if (!t?.copyOf) err(`sync.${key}`, `${base.key}에 허브 사본 테이블이 없습니다`);
    }
  }
  return errors;
}

// ---------------------------------------------------------------- 동기화·상태 규칙(스크립트·n8n에 넣는 설정)

/** 값 종류(검증용): string | integer | number | boolean | date | dateTime | select */
export function valueKind(f) {
  if ((f.type === 'number' && f.integer) || f.type === 'currency') return 'integer'; // 금액은 원 단위 정수
  if (['number', 'currency', 'percent'].includes(f.type)) return 'number';
  if (f.type === 'checkbox') return 'boolean';
  if (f.type === 'singleSelect') return 'select';
  if (f.type === 'date' || f.type === 'dateTime') return f.type;
  return 'string';
}

/** 허브 → 사업부 동기화 규칙. 스크립트·n8n Code 노드가 같은 규칙을 쓴다. */
export function syncRules(model) {
  const hub = model.bases.find((b) => b.kind === 'hub');
  const division = model.bases.find((b) => b.kind === 'division');
  const tables = {};
  for (const key of model.sync.tables ?? []) {
    const copy = division.tables.find((t) => t.key === key);
    const source = hub.tables.find((t) => t.key === copy.copyOf.table);
    const fields = copy.fields.filter((f) => f.owner === 'copy');
    tables[key] = {
      key,
      name: copy.name,
      sourceName: source.name,
      fields: fields.map((f) => f.name),
      required: copy.required,
      idPattern: copy.idPattern,
      kinds: Object.fromEntries(fields.map((f) => [f.name, valueKind(f)])),
      choices: Object.fromEntries(fields.filter((f) => f.type === 'singleSelect').map((f) => [f.name, f.choices])),
      links: Object.fromEntries(forwardLinks(copy).filter((f) => f.from).map((f) => [f.name, { from: f.from, table: f.to }])),
    };
  }
  return {
    direction: model.sync.direction,
    key: model.sync.key ?? 'id',
    order: model.sync.tables ?? [],
    maxDropRatio: model.sync.maxDropRatio,
    batchSize: model.sync.batchSize ?? 50,
    onMissing: model.sync.onMissing ?? 'mark',
    tables,
  };
}

/** 상태 전이 규칙 { 테이블 이름: { field, transitions } } (사업부 Base 기준). */
export function statusFlows(model, kind = 'division') {
  const base = model.bases.find((b) => b.kind === kind);
  return Object.fromEntries(base.tables.filter((t) => t.statusFlow).map((t) => [t.name, { field: t.statusFlow.field, transitions: t.statusFlow.transitions }]));
}
