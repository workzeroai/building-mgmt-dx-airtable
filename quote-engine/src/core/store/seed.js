// 로컬 저장소 초기 적재.
// - production: data/seed/*.json(생성 스크립트 산출 가상 데이터) + data/pricing/*.json(번들 단가)
// - staging: 같은 데이터를 ID만 바꿔(stg_ 접두어) 복제하고, 운영 ID → 스테이징 ID 매핑표(id-map.json)를 만든다.
//   실제 에어테이블에서 베이스를 복제하면 레코드 ID가 모두 새로 생기는 것과 같은 상황을 흉내 낸다.
import fs from 'node:fs/promises';
import path from 'node:path';
import { PRICING_DIR, SEED_DIR } from '../paths.js';
import { createLocalAdapter } from './local.js';
import { linksOf } from './schema.js';

const SEED_TABLES = ['customers', 'buildings', 'quotes', 'contracts'];

async function readJsonOr(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    throw err;
  }
}

export async function pricingRecords(registry, pricingDir = PRICING_DIR, stamp = '2026-10-01T00:00:00.000Z') {
  const rows = [];
  for (const division of registry.list()) {
    const data = JSON.parse(await fs.readFile(path.join(pricingDir, `${division.id}.json`), 'utf8'));
    rows.push({ id: `prc_${division.id}`, divisionId: division.id, version: data.version, source: '가상', data, updatedBy: 'seed', createdAt: stamp, updatedAt: stamp });
  }
  return rows;
}

export function divisionRecords(registry, stamp = '2026-10-01T00:00:00.000Z') {
  return registry.list().map((d) => ({ id: d.id, code: d.code, name: d.name, order: d.order, description: d.description ?? '', createdAt: stamp }));
}

/** 시드 레코드의 ID·연결 ID에 접두어를 붙이고 매핑표를 만든다. */
export function toStaging(tables, schemas, prefix = 'stg_') {
  const map = {};
  const idOf = (table, id) => (id === null || id === undefined ? id : `${prefix}${id}`);
  const out = {};
  for (const [table, rows] of Object.entries(tables)) {
    if (table === 'divisions') {
      out[table] = rows; // 사업부 ID는 코드에서 오므로 환경과 무관하게 같다
      continue;
    }
    map[table] = {};
    out[table] = rows.map((row) => {
      const copy = { ...row, id: idOf(table, row.id) };
      map[table][row.id] = copy.id;
      for (const [field, target] of Object.entries(linksOf(schemas[table]))) {
        if (field in copy && target !== 'divisions') copy[field] = idOf(target, copy[field]);
      }
      return copy;
    });
  }
  return { tables: out, idMap: { tables: map, created: {} } };
}

/**
 * 비어 있는 로컬 저장소에만 적재한다(.seeded 표식). 이미 있으면 아무것도 하지 않는다.
 * @returns {Promise<boolean>} 새로 적재했으면 true
 */
export async function seedLocalStore({ storeDir, target, schemas, registry, seedDir = SEED_DIR, pricingDir = PRICING_DIR }) {
  const dir = path.join(storeDir, target);
  const marker = path.join(dir, '.seeded');
  if (await readJsonOr(marker, null)) return false;

  const tables = { divisions: divisionRecords(registry), pricing: await pricingRecords(registry, pricingDir) };
  for (const t of SEED_TABLES) tables[t] = await readJsonOr(path.join(seedDir, `${t}.json`), []);

  let finalTables = tables;
  if (target === 'staging') {
    const staged = toStaging(tables, schemas);
    finalTables = staged.tables;
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'id-map.json'), `${JSON.stringify(staged.idMap, null, 2)}\n`, 'utf8');
  }
  const adapter = createLocalAdapter({ dir, schemas });
  for (const [table, rows] of Object.entries(finalTables)) await adapter.replaceAll(table, rows);
  await fs.writeFile(marker, `${JSON.stringify({ seededAt: new Date().toISOString(), target })}\n`, 'utf8');
  return true;
}

/** 레지스트리에 새로 생긴 사업부를 divisions 테이블에 추가한다(코드가 원본, 저장소는 사본). */
export async function syncDivisions(store, registry) {
  const existing = new Set((await store.list('divisions')).map((d) => d.id));
  const added = [];
  for (const record of divisionRecords(registry, new Date().toISOString())) {
    if (!existing.has(record.id)) added.push(await store.create('divisions', record));
  }
  return added;
}

/** 단가 레코드가 없는 사업부에 번들 단가를 넣는다(새 사업부 추가 직후). */
export async function syncPricing(store, registry, pricingDir = PRICING_DIR) {
  const added = [];
  for (const row of await pricingRecords(registry, pricingDir, new Date().toISOString())) {
    const [existing] = await store.list('pricing', { divisionId: row.divisionId });
    if (!existing) {
      const { id: _ignored, ...fields } = row;
      added.push(await store.create('pricing', fields));
    }
  }
  return added;
}
