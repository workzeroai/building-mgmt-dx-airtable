// 에어테이블 스크립팅 환경 흉내(테스트 전용). 실제 Airtable 없이 자동화 스크립트를 node:test에서 돌린다.
//
// - base·테이블·필드는 스키마 모델(airtable/lib/schema.js)에서 만든다 → 스크립트가 없는 필드를 쓰면 테스트가 실패한다
// - 셀 값 형식을 검사한다: 단일 선택은 {name}, 연결은 [{id}](같은 Base에 있는 레코드), 계산 필드는 쓰기 금지 …
// - selectRecordsAsync({fields})로 읽지 않은 필드를 getCellValue하면 에러(실제 Airtable과 같음)
// - 쓰기 한도(한 번에 50건)를 넘으면 에러
// - failOn(op, tableName, fields)로 특정 건의 쓰기 실패를 흉내 낸다(묶음 쓰기는 한 건만 실패해도 묶음 전체가 실패)
import fs from 'node:fs';
import { COMPUTED_TYPES } from '../../lib/schema.js';

const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
const MAX_BATCH = 50;

class ScriptError extends Error {}

function makeRecordId(seq) {
  return `rec${String(seq).padStart(14, '0')}`;
}

export function createFakeBase(baseModel, { failOn = null } = {}) {
  let seq = 0;
  const tables = new Map();
  const log = [];
  const api = { name: baseModel.name, log };

  function getTableOrThrow(name) {
    const t = tables.get(name);
    if (!t) throw new ScriptError(`테이블 없음: ${name}`);
    return t;
  }

  function checkCell(tableModel, name, value) {
    const f = tableModel.fields.find((x) => x.name === name);
    if (!f) throw new ScriptError(`${tableModel.name}: 필드 없음 "${name}"`);
    if (COMPUTED_TYPES.includes(f.type)) throw new ScriptError(`${tableModel.name}.${name}: 계산 필드에는 쓸 수 없음`);
    if (f.inverseOf) throw new ScriptError(`${tableModel.name}.${name}: 역방향 연결은 직접 쓰지 않는다(정방향 필드에 쓴다)`);
    if (value === null || value === undefined) {
      if (f.type === 'checkbox') throw new ScriptError(`${tableModel.name}.${name}: 체크박스는 true/false`);
      return null;
    }
    const bad = (why) => new ScriptError(`${tableModel.name}.${name}(${f.type}): ${why} — ${JSON.stringify(value)}`);
    switch (f.type) {
      case 'singleLineText':
      case 'multilineText':
      case 'email':
      case 'url':
        if (typeof value !== 'string') throw bad('문자열이어야 함');
        if (f.type === 'singleLineText' && value.includes('\n')) throw bad('한 줄 텍스트에 줄바꿈');
        return value;
      case 'number':
      case 'currency':
      case 'percent':
        if (typeof value !== 'number' || !Number.isFinite(value)) throw bad('숫자여야 함');
        return value;
      case 'checkbox':
        if (typeof value !== 'boolean') throw bad('true/false여야 함');
        return value;
      case 'date':
        if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) throw bad('YYYY-MM-DD여야 함');
        return value;
      case 'dateTime':
        if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) throw bad('ISO 날짜·시간이어야 함');
        return value;
      case 'singleSelect': {
        if (typeof value !== 'object' || Array.isArray(value) || typeof value.name !== 'string') throw bad('{name: 선택지} 형식이어야 함');
        if (!f.choices.includes(value.name)) throw bad(`없는 선택지(허용: ${f.choices.join(', ')})`);
        return { id: `sel${f.choices.indexOf(value.name)}`, name: value.name, color: 'grayLight2' };
      }
      case 'link': {
        if (!Array.isArray(value)) throw bad('[{id}] 배열이어야 함');
        const target = [...tables.values()].find((t) => t.model.key === f.to);
        return value.map((v) => {
          const rec = v && target.records.get(v.id);
          if (!rec) throw bad(`연결 대상 ${target.model.name}에 없는 레코드 ${v && v.id}`);
          return { id: rec.id, name: target.primaryString(rec) };
        });
      }
      default:
        throw bad('지원하지 않는 타입');
    }
  }

  class FakeRecord {
    constructor(table, stored, loaded) {
      this.id = stored.id;
      this.name = table.primaryString(stored);
      this._table = table;
      this._stored = stored;
      this._loaded = loaded;
    }

    _field(name) {
      const f = this._table.model.fields.find((x) => x.name === name);
      if (!f) throw new ScriptError(`${this._table.model.name}: 필드 없음 "${name}"`);
      if (this._loaded && !this._loaded.includes(name)) throw new ScriptError(`${this._table.model.name}.${name}: 읽어 오지 않은 필드(selectRecordsAsync fields에 넣어야 함)`);
      return f;
    }

    getCellValue(name) {
      this._field(name);
      const v = this._stored.cells[name];
      return v === undefined ? null : structuredClone(v);
    }

    getCellValueAsString(name) {
      const f = this._field(name);
      const v = this._stored.cells[name];
      if (v === undefined || v === null) return '';
      if (f.type === 'singleSelect') return v.name;
      if (f.type === 'link') return v.map((x) => x.name).join(', ');
      if (f.type === 'checkbox') return v ? 'checked' : '';
      return String(v);
    }
  }

  class FakeTable {
    constructor(model) {
      this.model = model;
      this.name = model.name;
      this.records = new Map();
      this.fields = model.fields.map((f) => ({ name: f.name, type: f.type }));
    }

    primaryString(stored) {
      const v = stored.cells[this.model.primary];
      return v === undefined || v === null ? '' : String(v);
    }

    getField(name) {
      const f = this.model.fields.find((x) => x.name === name);
      if (!f) throw new ScriptError(`${this.name}: 필드 없음 "${name}"`);
      return { name: f.name, type: f.type };
    }

    _cells(fields) {
      const cells = {};
      for (const [k, v] of Object.entries(fields)) cells[k] = checkCell(this.model, k, v);
      return cells;
    }

    _maybeFail(op, fields) {
      if (failOn && failOn(op, this.name, fields)) throw new ScriptError(`쓰기 실패(시뮬레이션): ${op} ${this.name} ${JSON.stringify(fields.id ?? '')}`);
    }

    async selectRecordsAsync(opts = {}) {
      const loaded = opts.fields ? [...opts.fields] : null;
      if (loaded) for (const name of loaded) this.getField(name);
      let list = [...this.records.values()];
      for (const s of [...(opts.sorts ?? [])].reverse()) {
        this.getField(s.field);
        const dir = s.direction === 'desc' ? -1 : 1;
        // 값이 같으면 나중에 만든 레코드를 desc에서 앞에 둔다(같은 밀리초에 만든 기록이 있어도 결과가 흔들리지 않게)
        const order = new Map(list.map((r, i) => [r.id, i]));
        list = list.sort((a, b) => {
          const x = a.cells[s.field] ?? '';
          const y = b.cells[s.field] ?? '';
          return ((x < y ? -1 : x > y ? 1 : 0) || order.get(a.id) - order.get(b.id)) * dir;
        });
      }
      const records = list.map((r) => new FakeRecord(this, r, loaded));
      log.push({ op: 'select', table: this.name, count: records.length });
      return {
        records,
        recordIds: records.map((r) => r.id),
        getRecord: (id) => {
          const r = records.find((x) => x.id === id);
          if (!r) throw new ScriptError(`${this.name}: 결과에 없는 레코드 ${id}`);
          return r;
        },
      };
    }

    async selectRecordAsync(id, opts = {}) {
      const stored = this.records.get(id);
      if (!stored) return null;
      const loaded = opts.fields ? [...opts.fields] : null;
      if (loaded) for (const name of loaded) this.getField(name);
      return new FakeRecord(this, stored, loaded);
    }

    _insert(fields) {
      const cells = this._cells(fields);
      seq += 1;
      const stored = { id: makeRecordId(seq), cells };
      this.records.set(stored.id, stored);
      return stored.id;
    }

    async createRecordAsync(fields) {
      this._maybeFail('create', fields);
      const id = this._insert(fields);
      log.push({ op: 'create', table: this.name, count: 1 });
      return id;
    }

    async createRecordsAsync(list) {
      if (list.length > MAX_BATCH) throw new ScriptError(`${this.name}: 한 번에 ${MAX_BATCH}건까지(요청 ${list.length}건)`);
      for (const r of list) this._maybeFail('create', r.fields);
      for (const r of list) this._cells(r.fields); // 묶음 전체를 먼저 검사(하나라도 틀리면 아무것도 쓰지 않음)
      const ids = list.map((r) => this._insert(r.fields));
      log.push({ op: 'create', table: this.name, count: list.length });
      return ids;
    }

    _patch(id, fields) {
      const stored = this.records.get(typeof id === 'string' ? id : id.id);
      if (!stored) throw new ScriptError(`${this.name}: 없는 레코드 ${typeof id === 'string' ? id : id.id}`);
      return { stored, cells: this._cells(fields) };
    }

    async updateRecordAsync(id, fields) {
      const { stored, cells } = this._patch(id, fields);
      this._maybeFail('update', { ...fields, id: stored.cells.id });
      Object.assign(stored.cells, cells);
      log.push({ op: 'update', table: this.name, count: 1 });
    }

    async updateRecordsAsync(list) {
      if (list.length > MAX_BATCH) throw new ScriptError(`${this.name}: 한 번에 ${MAX_BATCH}건까지(요청 ${list.length}건)`);
      const patches = list.map((r) => this._patch(r.id, r.fields));
      patches.forEach((p, i) => this._maybeFail('update', { ...list[i].fields, id: p.stored.cells.id }));
      for (const p of patches) Object.assign(p.stored.cells, p.cells);
      log.push({ op: 'update', table: this.name, count: list.length });
    }

    async deleteRecordsAsync() {
      throw new ScriptError('이 저장소의 자동화는 레코드를 지우지 않는다(테스트가 삭제 시도를 잡는다)');
    }
  }

  for (const t of baseModel.tables) tables.set(t.name, new FakeTable(t));

  api.getTable = getTableOrThrow;
  api.tables = [...tables.values()];

  /** 테스트 준비: 평평한 레코드(단일 선택은 문자열, 연결은 {필드: [우리 id…]})를 넣는다. @returns recId 목록 */
  api.seed = (tableName, rows, { links = {} } = {}) => {
    const t = getTableOrThrow(tableName);
    return rows.map((row) => {
      const fields = {};
      for (const [k, v] of Object.entries(row)) {
        const f = t.model.fields.find((x) => x.name === k);
        if (!f || v === undefined) continue;
        if (f.type === 'singleSelect') fields[k] = v === null ? null : { name: v };
        else if (f.type === 'checkbox') fields[k] = v === true;
        else if (f.type === 'multilineText' && f.json && v !== null) fields[k] = JSON.stringify(v);
        else if (f.type === 'link' || COMPUTED_TYPES.includes(f.type)) continue;
        else fields[k] = v;
      }
      for (const [field, ids] of Object.entries(links)) {
        const f = t.model.fields.find((x) => x.name === field);
        const target = [...tables.values()].find((x) => x.model.key === f.to);
        const wanted = typeof ids === 'function' ? ids(row) : ids;
        fields[field] = (wanted ?? []).map((ourId) => ({ id: [...target.records.values()].find((r) => r.cells.id === ourId)?.id }));
      }
      return t._insert(fields);
    });
  };

  /** 테스트 확인용: 평평한 행(단일 선택 → 이름, 연결 → 대상의 우리 id). */
  api.rows = (tableName) => {
    const t = getTableOrThrow(tableName);
    return [...t.records.values()].map((r) => {
      const out = { recId: r.id };
      for (const [k, v] of Object.entries(r.cells)) {
        const f = t.model.fields.find((x) => x.name === k);
        if (f.type === 'singleSelect') out[k] = v ? v.name : null;
        else if (f.type === 'link') {
          const target = [...tables.values()].find((x) => x.model.key === f.to);
          out[k] = (v ?? []).map((x) => target.records.get(x.id)?.cells.id ?? x.id);
        } else out[k] = v;
      }
      return out;
    });
  };
  return api;
}

export function createOutput() {
  const values = {};
  const lines = [];
  return {
    values,
    lines,
    set: (k, v) => {
      values[k] = structuredClone(v);
    },
    text: (s) => lines.push(String(s)),
    markdown: (s) => lines.push(String(s)),
    inspect: (v) => lines.push(JSON.stringify(v)),
  };
}

/** fetch 가짜: handler(url, init, n) → {status, body} | Error. 호출 기록은 fn.calls. */
export function fakeFetch(handler) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const out = await handler(String(url), init, calls.length);
    if (out instanceof Error) throw out;
    const status = out?.status ?? 200;
    return { ok: status >= 200 && status < 300, status, json: async () => out?.body ?? {}, text: async () => JSON.stringify(out?.body ?? {}) };
  };
  fn.calls = calls;
  return fn;
}

/**
 * 허브 Base REST API 흉내: GET /v0/{baseId}/{table}?fields[]=…&offset=…
 * 빈 값(null·''·false)은 응답에서 빠진다(실제 API와 같음). pageSize 건씩 끊어 offset으로 넘긴다.
 */
export function fakeAirtableRest({ baseId, token, tables, pageSize = 10, failTables = [] }) {
  return fakeFetch((url, init) => {
    const u = new URL(url);
    const [, version, bId, tableEnc] = u.pathname.split('/');
    if (version !== 'v0' || bId !== baseId) return { status: 404, body: { error: 'NOT_FOUND' } };
    if (init.headers?.Authorization !== `Bearer ${token}`) return { status: 401, body: { error: 'AUTHENTICATION_REQUIRED' } };
    const name = decodeURIComponent(tableEnc);
    if (failTables.includes(name)) return { status: 503, body: { error: 'SERVICE_UNAVAILABLE' } };
    const rows = tables[name];
    if (!rows) return { status: 404, body: { error: 'TABLE_NOT_FOUND' } };
    const fields = u.searchParams.getAll('fields[]');
    const start = Number(u.searchParams.get('offset') ?? 0);
    const page = rows.slice(start, start + pageSize).map((row, i) => {
      const out = {};
      for (const [k, v] of Object.entries(row)) {
        if (fields.length && !fields.includes(k)) continue;
        if (v === null || v === undefined || v === '' || v === false) continue;
        out[k] = v;
      }
      return { id: `rechub${String(start + i).padStart(11, '0')}`, createdTime: '2026-10-01T00:00:00.000Z', fields: out };
    });
    const next = start + pageSize < rows.length ? String(start + pageSize) : undefined;
    return { body: next ? { records: page, offset: next } : { records: page } };
  });
}

/**
 * 스크립트 파일을 Airtable과 같은 전역(base·input·output·fetch·console)으로 실행한다.
 * @returns {Promise<{output, logs: string[], error: Error|null}>}
 */
export async function runScript(file, { base, config = {}, fetch = async () => { throw new Error('fetch 없음'); } }) {
  const code = fs.readFileSync(file, 'utf8');
  const output = createOutput();
  const logs = [];
  const consoleLike = { log: (...a) => logs.push(a.join(' ')), error: (...a) => logs.push(`ERROR ${a.join(' ')}`), warn: (...a) => logs.push(`WARN ${a.join(' ')}`) };
  const input = { config: () => structuredClone(config) };
  let error = null;
  try {
    await new AsyncFunction('base', 'input', 'output', 'fetch', 'console', code)(base, input, output, fetch, consoleLike);
  } catch (e) {
    error = e;
  }
  return { output, logs, error };
}
