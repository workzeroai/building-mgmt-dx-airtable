// 에어테이블 어댑터(허브 + 사업부 Base 구성). airtable/schema/gridwell.yaml의 설계를 따른다.
// - 계약의 x-airtable.base가 hub인 테이블(사업부·고객·건물) → 허브 Base
// - division인 테이블(견적·계약·단가·양식 버전) → 레코드의 divisionId에 해당하는 사업부 Base
// Base 하나짜리 구성(airtable.js 단독)과 같은 인터페이스(list·get·create·update)라 엔진은 차이를 모른다.
import { createAirtableAdapter } from './airtable.js';
import { ExternalApiError, NotFoundError, ValidationError } from '../errors.js';

/**
 * @param {object} options
 * @param {{hub: string, divisions: Record<string, string>}} options.bases 허브·사업부별 Base ID
 */
export function createMultiBaseAirtableAdapter({ token, bases, schemas, ...rest }) {
  if (!bases?.hub) throw new ExternalApiError('허브 Base ID(AIRTABLE_HUB_BASE_ID)가 필요합니다.');
  const hub = createAirtableAdapter({ token, baseId: bases.hub, schemas, ...rest });
  const divisions = new Map(Object.entries(bases.divisions ?? {}).map(([id, baseId]) => [id, createAirtableAdapter({ token, baseId, schemas, ...rest })]));
  const isHub = (table) => (schemas[table]?.['x-airtable']?.base ?? 'hub') === 'hub';

  function forDivision(divisionId) {
    const adapter = divisions.get(divisionId);
    if (!adapter) throw new ExternalApiError(`사업부 ${divisionId}의 Base ID가 없습니다(AIRTABLE_BASE_ID_${String(divisionId).toUpperCase()}).`);
    return adapter;
  }

  async function findOwner(table, id) {
    for (const adapter of divisions.values()) {
      const record = await adapter.get(table, id);
      if (record) return { adapter, record };
    }
    return null;
  }

  return {
    kind: 'airtable',
    layout: 'hub+division',
    async list(table, filter = {}) {
      if (isHub(table)) return hub.list(table, filter);
      if (filter.divisionId) return forDivision(filter.divisionId).list(table, filter);
      return (await Promise.all([...divisions.values()].map((a) => a.list(table, filter)))).flat();
    },
    async get(table, id) {
      if (isHub(table)) return hub.get(table, id);
      return (await findOwner(table, id))?.record ?? null;
    },
    async create(table, fields) {
      if (isHub(table)) return hub.create(table, fields);
      if (!fields.divisionId) throw new ValidationError(`${table}: 사업부 Base를 고르려면 divisionId가 필요합니다.`);
      return forDivision(fields.divisionId).create(table, fields);
    },
    async update(table, id, fields) {
      if (isHub(table)) return hub.update(table, id, fields);
      const owner = await findOwner(table, id);
      if (!owner) throw new NotFoundError(`${table}에 ${id} 레코드가 없습니다.`);
      return owner.adapter.update(table, id, fields);
    },
  };
}

/** 환경변수 → Base ID 묶음. 허브 ID가 없으면 null(Base 하나짜리 구성을 쓴다). */
export function basesFromEnv(env, divisionIds) {
  if (!env.AIRTABLE_HUB_BASE_ID) return null;
  const divisions = {};
  for (const id of divisionIds) {
    const value = env[`AIRTABLE_BASE_ID_${id.toUpperCase()}`];
    if (value) divisions[id] = value;
  }
  return { hub: env.AIRTABLE_HUB_BASE_ID, divisions };
}
