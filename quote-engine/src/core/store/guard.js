// 스테이징 ID 매핑 가드.
//
// 스테이징 저장소(복제 베이스)는 운영과 레코드 ID가 다르다. 코드·화면·자동화가 운영 ID를 들고
// 스테이징에 쓰면, 연결이 깨지거나(없는 레코드 참조) 어댑터 설정이 잘못된 날에는 운영 데이터가 바뀐다.
// 그래서 스테이징 대상 쓰기는 "매핑표(운영 ID → 스테이징 ID)에 있는 ID"만 허용하고, 없으면 에러로 막는다.
// 운영 대상 쓰기에서는 반대로 스테이징 ID가 섞여 들어오는 것을 막는다.
// 어댑터(로컬·에어테이블)를 감싸는 래퍼라 두 어댑터 모두 같은 규칙을 탄다.
import fs from 'node:fs/promises';
import path from 'node:path';
import { StagingGuardError } from '../errors.js';
import { linksOf } from './schema.js';

/**
 * 매핑표. 파일 형식: { "tables": { "customers": { "cus_0001": "stg_cus_0001" } }, "created": { "quotes": ["stg_quo_0001"] } }
 * created는 스테이징에서 새로 만든(운영에 대응 레코드가 없는) ID 목록이다.
 */
export async function loadIdMap(file) {
  let data = { tables: {}, created: {} };
  try {
    data = JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  data.tables ??= {};
  data.created ??= {};
  return createIdMap(data, file);
}

export function createIdMap(data = { tables: {}, created: {} }, file = null) {
  data.tables ??= {};
  data.created ??= {};
  const stagingIds = new Map();
  const remember = (table, id) => {
    if (!stagingIds.has(table)) stagingIds.set(table, new Set());
    stagingIds.get(table).add(id);
  };
  for (const [table, map] of Object.entries(data.tables)) for (const id of Object.values(map)) remember(table, id);
  for (const [table, ids] of Object.entries(data.created)) for (const id of ids) remember(table, id);

  return {
    data,
    translate: (table, id) => data.tables[table]?.[id] ?? null,
    isStagingId: (table, id) => stagingIds.get(table)?.has(id) ?? false,
    registerCreated(table, id) {
      (data.created[table] ??= []).push(id);
      remember(table, id);
    },
    size: () => Object.values(data.tables).reduce((n, m) => n + Object.keys(m).length, 0),
    async save() {
      if (!file) return;
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    },
  };
}

/**
 * @param {object} adapter list·get·create·update를 가진 저장소 어댑터
 * @param {object} options
 * @param {'production'|'staging'} options.target
 * @param {ReturnType<typeof createIdMap>} options.idMap
 * @param {Record<string, object>} options.schemas
 */
export function withStagingGuard(adapter, { target, idMap, schemas }) {
  const stats = { blocked: 0, translated: 0, lastBlocked: null };

  function block(message, details) {
    stats.blocked += 1;
    stats.lastBlocked = { message, ...details, at: new Date().toISOString() };
    throw new StagingGuardError(message, details);
  }

  /** 스테이징 쓰기에 쓰일 ID를 확인·변환한다. */
  function resolve(table, id, field) {
    if (id === null || id === undefined) return id;
    if (target === 'staging') {
      if (idMap.isStagingId(table, id)) return id;
      const mapped = idMap.translate(table, id);
      if (mapped) {
        stats.translated += 1;
        return mapped;
      }
      return block(`스테이징 쓰기 차단: ${table} ID "${id}"(${field})가 매핑표에 없습니다. 운영 ID를 스테이징에 쓰지 않도록 매핑을 먼저 추가하세요.`,
        { target, table, field, id });
    }
    if (idMap.isStagingId(table, id)) {
      return block(`운영 쓰기 차단: ${table} ID "${id}"(${field})는 스테이징 ID입니다.`, { target, table, field, id });
    }
    return id;
  }

  function resolveLinks(table, fields) {
    const out = { ...fields };
    for (const [field, linkedTable] of Object.entries(linksOf(schemas[table]))) {
      if (field in out) out[field] = resolve(linkedTable, out[field], `${table}.${field}`);
    }
    return out;
  }

  return {
    ...adapter,
    kind: adapter.kind,
    target,
    list: (table, filter) => adapter.list(table, filter),
    get(table, id) {
      const mapped = target === 'staging' ? idMap.translate(table, id) : null;
      return adapter.get(table, mapped ?? id);
    },
    async create(table, fields) {
      const checked = resolveLinks(table, fields);
      if (fields.id !== undefined) checked.id = resolve(table, fields.id, `${table}.id`);
      const record = await adapter.create(table, checked);
      if (target === 'staging' && !idMap.isStagingId(table, record.id)) {
        idMap.registerCreated(table, record.id);
        await idMap.save();
      }
      return record;
    },
    async update(table, id, fields) {
      const resolvedId = resolve(table, id, `${table}.id`);
      return adapter.update(table, resolvedId, resolveLinks(table, fields));
    },
    guardStatus: () => ({ target, mappedIds: idMap.size(), ...stats }),
  };
}
