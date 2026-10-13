// 데이터 계약: 생성 데이터가 스키마를 지키고, 연결 ID가 모두 존재하며, 생성 스크립트가 결정적이다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadSchemas, validateRecord } from '../src/core/store/schema.js';
import { SEED_DIR } from '../src/core/paths.js';
import { generate, main as writeSeed } from '../scripts/generate-data.js';
import { toStaging } from '../src/core/store/seed.js';
import { makeTmp } from './helpers.js';

const schemas = loadSchemas();
const seed = Object.fromEntries(['customers', 'buildings', 'quotes', 'contracts'].map((t) => [t, JSON.parse(fs.readFileSync(path.join(SEED_DIR, `${t}.json`), 'utf8'))]));

test('데이터 계약 7개 엔티티: ID 접두어·연결·에어테이블 테이블 이름이 정의돼 있다', () => {
  assert.deepEqual(Object.keys(schemas).sort(), ['buildings', 'contracts', 'customers', 'divisions', 'pricing', 'quotes', 'templateVersions']);
  for (const [table, s] of Object.entries(schemas)) {
    assert.ok(s['x-airtable']?.table, `${table} x-airtable.table`);
    assert.ok(s.required.includes('id'), `${table} id 필수`);
    for (const target of Object.values(s['x-links'])) assert.ok(schemas[target], `${table} → ${target}`);
  }
});

test('시드 데이터는 모두 계약을 지키고 연결 ID가 실제로 있다', () => {
  for (const [table, rows] of Object.entries(seed)) {
    assert.ok(rows.length > 0);
    for (const row of rows) assert.deepEqual(validateRecord(schemas[table], row), [], `${table}/${row.id}`);
  }
  const ids = Object.fromEntries(Object.entries(seed).map(([t, rows]) => [t, new Set(rows.map((r) => r.id))]));
  for (const [table, rows] of Object.entries(seed)) {
    for (const [field, target] of Object.entries(schemas[table]['x-links'])) {
      if (!ids[target]) continue;
      for (const row of rows) if (row[field]) assert.ok(ids[target].has(row[field]), `${table}/${row.id}.${field} → ${row[field]}`);
    }
  }
  assert.ok(seed.contracts.every((c) => seed.quotes.find((q) => q.id === c.quoteId).status === 'won'), '계약은 수주 견적에서만');
  assert.equal(new Set(seed.quotes.map((q) => q.quoteNo)).size, seed.quotes.length, '견적번호 중복 없음');
});

test('생성 스크립트는 결정적이다(커밋된 시드와 같은 결과)', async () => {
  const tables = await generate();
  for (const [table, rows] of Object.entries(tables)) assert.deepEqual(rows, seed[table], table);
  const dir = makeTmp();
  const log = console.log;
  console.log = () => {};
  try {
    await writeSeed(dir);
  } finally {
    console.log = log;
  }
  assert.equal(fs.readFileSync(path.join(dir, 'quotes.json'), 'utf8'), fs.readFileSync(path.join(SEED_DIR, 'quotes.json'), 'utf8'));
});

test('스테이징 복제: 모든 ID·연결 ID에 접두어, 사업부 ID는 그대로, 매핑표 생성', () => {
  const { tables, idMap } = toStaging({ ...seed, divisions: [{ id: 'fire' }] }, schemas);
  assert.equal(tables.quotes[0].id, `stg_${seed.quotes[0].id}`);
  assert.equal(tables.quotes[0].buildingId, `stg_${seed.quotes[0].buildingId}`);
  assert.equal(tables.quotes[0].divisionId, seed.quotes[0].divisionId);
  assert.equal(tables.divisions[0].id, 'fire');
  assert.equal(idMap.tables.customers.cus_0001, 'stg_cus_0001');
  assert.equal(Object.keys(idMap.tables.quotes).length, seed.quotes.length);
});
