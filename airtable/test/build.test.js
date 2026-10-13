// 스키마 하나 → 문서·ERD 사양·시드(JSON·CSV)·스크립트 설정·카탈로그·n8n이 일관되게 나오고, 저장소의 파일이 최신인지.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { buildAll } from '../lib/build.js';
import { main as buildMain } from '../build.mjs';
import { csvColumns, importOrder, validateDataset, validateRow } from '../lib/dataset.js';
import { loadCatalog, renderCatalog, validateCatalog } from '../lib/catalog.js';
import { injectBlocks, libSource } from '../lib/inline.js';
import { erdOutputs } from '../lib/erd.js';
import { CSV_DIR, rel } from '../lib/paths.js';
import { baseByKey, tableByKey } from '../lib/schema.js';
import { dataset, makeTmp, model } from './helpers.js';
import { createContext } from '../../quote-engine/src/context.js';

test('빌드: 스키마 검사 통과, 커밋된 파생 산출물이 모두 최신', async () => {
  const { outputs, problems } = await buildAll({ model });
  assert.deepEqual(problems, []);
  const stale = [...outputs].filter(([file, content]) => !fs.existsSync(file) || fs.readFileSync(file, 'utf8').replace(/\r\n/gu, '\n') !== content).map(([f]) => rel(f));
  assert.deepEqual(stale, [], 'npm run airtable:build 를 다시 실행하세요');
  const lines = [];
  assert.equal(await buildMain(['--check'], (l) => lines.push(l)), 0);
  assert.match(lines.join('\n'), /모두 최신 \(Base 4 · 테이블 41/u);
});

test('가상 데이터: 모든 Base·테이블 행이 스키마를 지키고, 연결 ID가 같은 Base 안에 있다', async () => {
  const { rows } = await dataset();
  assert.deepEqual(validateDataset(model, rows), []);
  const fire = rows.get('fire');
  assert.ok(fire.get('quotes').every((q) => q.divisionId === 'fire'));
  assert.equal(fire.get('customers').length, 24, '사본은 허브 전체');
  assert.ok(fire.get('customers').every((c) => /^[0-9a-f]{8}$/u.test(c.syncHash)), '사본 지문은 동기화와 같은 함수');
  const hubCustomers = rows.get('hub').get('customers');
  assert.ok(hubCustomers.every((c) => /^000-\d{2}-\d{5}$/u.test(c.businessNo)), '가상 사업자번호는 000으로 시작');
  const invoices = [...model.bases].filter((b) => b.kind === 'division').flatMap((b) => rows.get(b.key).get('invoices'));
  assert.ok(invoices.some((i) => i.status === 'overdue') && invoices.some((i) => i.status === 'paid'));
  // 잘못된 행을 잡는다
  const quotes = tableByKey(baseByKey(model, 'fire'), 'quotes');
  const bad = { ...fire.get('quotes')[0], status: 'archived', extra: 1, total: 1.5, createdAt: 'x' };
  const errors = validateRow(quotes, bad);
  assert.ok(errors.some((e) => /extra: 테이블에 없는/u.test(e)));
  assert.ok(errors.some((e) => /status: 선택지 밖/u.test(e)));
  assert.ok(errors.some((e) => /total/u.test(e)));
  assert.ok(errors.some((e) => /createdAt/u.test(e)));
  const broken = new Map([...rows].map(([k, v]) => [k, new Map(v)]));
  broken.get('fire').set('contracts', [{ ...fire.get('contracts')[0], quoteId: 'quo_9999' }]);
  assert.ok(validateDataset(model, broken).some((e) => /quotes에 없는 quo_9999/u.test(e)));
});

test('CSV: 열 = 스키마의 데이터 필드 + 정방향 연결, 행 수 = 가상 데이터, 연결 값은 대상의 기본 필드', async () => {
  const { rows } = await dataset();
  for (const base of model.bases) {
    importOrder(base).forEach((table, i) => {
      const file = path.join(CSV_DIR, base.key, `${String(i + 1).padStart(2, '0')}-${table.key}.csv`);
      const n = rows.get(base.key).get(table.key).length;
      if (n === 0) return assert.ok(!fs.existsSync(file));
      const lines = fs.readFileSync(file, 'utf8').trimEnd().split('\n');
      assert.equal(lines[0], csvColumns(table).join(','), rel(file));
      assert.equal(lines.length - 1 >= n, true);
      return undefined;
    });
  }
  const contractsCsv = fs.readFileSync(path.join(CSV_DIR, 'fire', '06-contracts.csv'), 'utf8').split('\n');
  const header = contractsCsv[0].split(',');
  const first = contractsCsv[1].split(',');
  assert.match(first[header.indexOf('quote')], /^GW-FIRE-\d{8}-\d{3}$/u, '연결 열에는 견적번호(기본 필드)를 넣어 가져오기 때 연결된다');
  const order = importOrder(baseByKey(model, 'fire')).map((t) => t.key);
  assert.ok(order.indexOf('customers') < order.indexOf('quotes') && order.indexOf('quotes') < order.indexOf('contracts'), '연결 대상이 먼저');
});

test('견적 엔진 로컬 저장소가 새 시드(고객 이름 수정 포함)로 그대로 동작한다', async () => {
  const dir = makeTmp();
  const ctx = await createContext({ storeDir: path.join(dir, 'store'), outDir: path.join(dir, 'out'), env: {}, quiet: true, llm: null, converter: { name: 'none', available: false } });
  const customers = await ctx.store.list('customers');
  assert.equal(customers.length, 24);
  assert.ok(customers.every((c) => !/ 운영$|제조동/u.test(c.name)), '어색한 가상 이름이 없다');
  const r = await ctx.engine.createQuote({ divisionId: 'mechanical', address: '서울 중구 예시로 12', conditions: { boilers: 1, chillers: 1, ahus: 2, pumps: 4, fans: 4, cycle: '분기' }, customerId: 'cus_0003' });
  assert.match(r.quote.quoteNo, /^GW-MECH-/u);
  assert.equal(r.quote.customerId, 'cus_0003');
});

test('ERD 사양: 스키마의 테이블이 모두 상자로, 연결이 화살표로 나온다', () => {
  const [[, overviewText], [, divisionText]] = erdOutputs(model);
  const overview = YAML.parse(overviewText);
  const division = YAML.parse(divisionText);
  const fire = baseByKey(model, 'fire');
  assert.deepEqual(division.nodes.map((n) => n.id).sort(), fire.tables.map((t) => t.key).sort());
  assert.ok(division.edges.some((e) => e.from === 'contracts' && e.to === 'inspections'));
  assert.ok(!division.edges.some((e) => e.from === 'customers' && e.to === 'contracts'), '생략 목록의 연결은 그리지 않는다');
  assert.ok(overview.nodes.some((n) => n.id === 'fire-ext' && /extinguisherCount/u.test(n.label)));
  assert.equal(overview.zones.length, 4);
  for (const n of [...overview.nodes, ...division.nodes]) assert.ok(n.label.split('\n').every((l) => l.length <= 34), `상자 글자가 너무 김: ${n.label}`);
});

test('카탈로그: 적힌 테이블·필드가 스키마에 있고, 없는 필드를 적으면 잡는다', () => {
  const patterns = loadCatalog();
  assert.ok(patterns.length >= 10);
  assert.deepEqual(validateCatalog(model, patterns, { generated: ['sync-safety.json'] }), []);
  const broken = structuredClone(patterns);
  broken[0].reads.push('없는필드');
  broken[1].writes.quotes.push('고객명');
  broken[2].table = 'nope';
  const errors = validateCatalog(model, broken);
  assert.ok(errors.some((e) => /없는필드 필드가 없습니다/u.test(e)));
  assert.ok(errors.some((e) => /고객명은\(는\) 쓸 수 없는 필드/u.test(e)));
  assert.ok(errors.some((e) => /division\.nope 테이블이 스키마에 없습니다/u.test(e)));
  assert.match(renderCatalog(model, patterns), /\| A07 \| 상태 전이 가드 \|/u);
});

test('생성 구간 끼워 넣기: 표시가 없으면 실패, lib는 import 금지', () => {
  assert.throws(() => injectBlocks('no markers', { config: 'x' }), /생성 구간 표시를 찾지 못했습니다/u);
  const out = injectBlocks('// ---- BEGIN GENERATED: config (x) ----\nold\n// ---- END GENERATED: config ----\n', { config: 'const A = 1;' });
  assert.equal(out, '// ---- BEGIN GENERATED: config (x) ----\nconst A = 1;\n// ---- END GENERATED: config ----\n');
  const dir = makeTmp();
  fs.writeFileSync(path.join(dir, 'bad.js'), "import fs from 'node:fs';\nexport const a = 1;\n");
  assert.throws(() => libSource('bad.js', dir), /import를 쓸 수 없습니다/u);
  assert.doesNotMatch(libSource('sync-core.js'), /^export /mu);
});
