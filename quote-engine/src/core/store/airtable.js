// 에어테이블 어댑터(선택). 로컬 어댑터와 같은 인터페이스를 에어테이블 REST API로 구현한다.
// - 테이블 이름은 데이터 계약의 x-airtable.table, 레코드 키는 우리 ID를 담은 "id" 필드(에어테이블 rec ID와 별개)
// - 객체·배열 필드(x-airtable.jsonFields)는 긴 텍스트에 JSON 문자열로 저장
// 베이스 생성·필드 정의는 airtable/의 스키마 YAML과 create-base.mjs가 만든다. 이 파일은 그 계약을 따라 읽고 쓴다.
// 허브 + 사업부 Base로 나눈 구성은 airtable-multi.js가 이 어댑터를 Base마다 하나씩 만들어 묶는다.
import { randomBytes } from 'node:crypto';
import { ExternalApiError, NotFoundError } from '../errors.js';
import { assertValid } from './schema.js';

const API = 'https://api.airtable.com/v0';

function escapeFormula(value) {
  return String(value).replace(/\\/gu, '\\\\').replace(/'/gu, "\\'");
}

export function createAirtableAdapter({
  token, baseId, schemas, fetchImpl = globalThis.fetch, timeoutMs = 10_000, idNamespace = '', now = () => new Date(),
}) {
  if (!token || !baseId) throw new ExternalApiError('AIRTABLE_TOKEN과 AIRTABLE_BASE_ID가 필요합니다.');

  function meta(table) {
    const schema = schemas[table];
    if (!schema) throw new NotFoundError(`데이터 계약에 없는 테이블: ${table}`);
    return { schema, name: schema['x-airtable'].table, jsonFields: schema['x-airtable'].jsonFields ?? [] };
  }

  async function call(method, urlPath, body) {
    let res;
    try {
      res = await fetchImpl(`${API}/${baseId}/${urlPath}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      throw new ExternalApiError(`에어테이블 호출 실패: ${err.message}`);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new ExternalApiError(`에어테이블 응답 오류 HTTP ${res.status}: ${text.slice(0, 200)}`, { status: res.status });
    }
    return res.json();
  }

  function toFields(table, record) {
    const { jsonFields } = meta(table);
    const out = {};
    for (const [k, v] of Object.entries(record)) {
      if (v === undefined) continue;
      out[k] = jsonFields.includes(k) && v !== null ? JSON.stringify(v) : v;
    }
    return out;
  }

  function fromRecord(table, airtableRecord) {
    const { schema, jsonFields } = meta(table);
    const out = {};
    // 에어테이블에만 있는 필드(연결·룩업·수식·운영 필드, airtable/schema 참고)는 계약 밖이라 버린다.
    // 남겨 두면 update에서 계약 검사(additionalProperties: false)에 걸린다.
    for (const [k, v] of Object.entries(airtableRecord.fields)) {
      if (schema.properties?.[k]) out[k] = v;
    }
    for (const k of jsonFields) {
      if (typeof out[k] === 'string') out[k] = JSON.parse(out[k]);
    }
    return out;
  }

  async function findRaw(table, filter) {
    const { name } = meta(table);
    const formula = Object.entries(filter).map(([k, v]) => `{${k}}='${escapeFormula(v)}'`);
    const params = new URLSearchParams();
    if (formula.length) params.set('filterByFormula', formula.length > 1 ? `AND(${formula.join(',')})` : formula[0]);
    const rows = [];
    let offset;
    do {
      if (offset) params.set('offset', offset);
      const page = await call('GET', `${encodeURIComponent(name)}?${params}`);
      rows.push(...page.records);
      offset = page.offset;
    } while (offset);
    return rows;
  }

  function newId(table) {
    const prefix = meta(table).schema['x-idPrefix'];
    return `${idNamespace}${prefix}_${now().getTime().toString(36)}${randomBytes(2).toString('hex')}`;
  }

  return {
    kind: 'airtable',
    async list(table, filter = {}) {
      return (await findRaw(table, filter)).map((r) => fromRecord(table, r));
    },
    async get(table, id) {
      const [row] = await findRaw(table, { id });
      return row ? fromRecord(table, row) : null;
    },
    async create(table, fields) {
      const record = { id: fields.id ?? newId(table), ...fields, createdAt: fields.createdAt ?? now().toISOString() };
      assertValid(meta(table).schema, record);
      const res = await call('POST', encodeURIComponent(meta(table).name), {
        records: [{ fields: toFields(table, record) }], typecast: true,
      });
      return fromRecord(table, res.records[0]);
    },
    async update(table, id, fields) {
      const [row] = await findRaw(table, { id });
      if (!row) throw new NotFoundError(`${table}에 ${id} 레코드가 없습니다.`);
      const merged = { ...fromRecord(table, row), ...fields, id, updatedAt: now().toISOString() };
      assertValid(meta(table).schema, merged);
      const res = await call('PATCH', encodeURIComponent(meta(table).name), {
        records: [{ id: row.id, fields: toFields(table, { ...fields, updatedAt: merged.updatedAt }) }], typecast: true,
      });
      return fromRecord(table, { fields: { ...row.fields, ...res.records[0].fields } });
    },
  };
}
