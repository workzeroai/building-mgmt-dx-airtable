// 로컬 JSON 데이터 저장소: 테이블 1개 = JSON 파일 1개(레코드 배열).
// 에어테이블 어댑터와 같은 인터페이스(list·get·create·update)를 가진다.
import fs from 'node:fs/promises';
import path from 'node:path';
import { assertValid } from './schema.js';
import { NotFoundError } from '../errors.js';

// idNamespace: 스테이징 저장소는 'stg_'를 붙여 운영 ID와 모양부터 다르게 만든다.
export function createLocalAdapter({ dir, schemas, idNamespace = '', now = () => new Date() }) {
  const locks = new Map();

  function fileOf(table) {
    if (!schemas[table]) throw new NotFoundError(`데이터 계약에 없는 테이블: ${table}`);
    return path.join(dir, `${table}.json`);
  }

  async function read(table) {
    try {
      return JSON.parse(await fs.readFile(fileOf(table), 'utf8'));
    } catch (err) {
      if (err.code === 'ENOENT') return [];
      throw err;
    }
  }

  async function write(table, rows) {
    await fs.mkdir(dir, { recursive: true });
    const file = fileOf(table);
    const tmp = `${file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, `${JSON.stringify(rows, null, 2)}\n`, 'utf8');
    await fs.rename(tmp, file); // 쓰는 도중 끊겨도 원본이 깨지지 않게
  }

  /** 같은 테이블 쓰기는 순서대로(동시 요청에서 마지막 쓰기가 앞선 쓰기를 덮지 않게). */
  function withLock(table, fn) {
    const prev = locks.get(table) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    locks.set(table, next.catch(() => {}));
    return next;
  }

  function nextId(table, rows) {
    const prefix = schemas[table]['x-idPrefix'];
    const pattern = new RegExp(`^${idNamespace}${prefix}_(\\d+)$`, 'u');
    const max = rows.reduce((m, r) => {
      const hit = pattern.exec(r.id);
      return hit ? Math.max(m, Number(hit[1])) : m;
    }, 0);
    return `${idNamespace}${prefix}_${String(max + 1).padStart(4, '0')}`;
  }

  function matches(record, filter) {
    return Object.entries(filter).every(([k, v]) => record[k] === v);
  }

  return {
    kind: 'local',
    dir,
    async list(table, filter = {}) {
      return (await read(table)).filter((r) => matches(r, filter));
    },
    async get(table, id) {
      return (await read(table)).find((r) => r.id === id) ?? null;
    },
    create(table, fields) {
      return withLock(table, async () => {
        const rows = await read(table);
        const stamp = now().toISOString();
        const record = { id: fields.id ?? nextId(table, rows), ...fields, createdAt: fields.createdAt ?? stamp };
        assertValid(schemas[table], record);
        rows.push(record);
        await write(table, rows);
        return record;
      });
    },
    update(table, id, fields) {
      return withLock(table, async () => {
        const rows = await read(table);
        const index = rows.findIndex((r) => r.id === id);
        if (index < 0) throw new NotFoundError(`${table}에 ${id} 레코드가 없습니다.`);
        const record = { ...rows[index], ...fields, id, updatedAt: now().toISOString() };
        assertValid(schemas[table], record);
        rows[index] = record;
        await write(table, rows);
        return record;
      });
    },
    /** 시드 적재용: 테이블 전체를 교체한다. */
    async replaceAll(table, rows) {
      for (const row of rows) assertValid(schemas[table], row);
      await withLock(table, () => write(table, rows));
    },
  };
}
