// 스키마 YAML: 구조 검사, 데이터 계약(6-1)과의 일관성, 잘못 고쳤을 때 잡아내는지.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkContracts } from '../lib/contract.js';
import { expandSchema, loadRawSchema, stats, statusFlows, syncRules, validateModel, refFields, baseByKey, tableByKey } from '../lib/schema.js';
import { model } from './helpers.js';

const raw = loadRawSchema();
const contracts = model.contracts;
const mutate = (fn, c = contracts) => {
  const r = structuredClone(raw);
  fn(r);
  return expandSchema(r, { contracts: c });
};
const tableOf = (r, kind, key) => r.bases.find((b) => b.kind === kind).tables.find((t) => t.key === key);
const fieldOf = (t, name) => t.fields.find((f) => f.name === name);

test('스키마 YAML: 구조 검사·데이터 계약 일관성 통과, 규모', () => {
  assert.deepEqual(validateModel(model), []);
  assert.deepEqual(checkContracts(model), []);
  const s = stats(model);
  assert.equal(s.bases, 4);
  assert.equal(s.tables, 5 + 12 * 3);
  assert.ok(s.fields > 500);
  assert.equal(s.byOwner.contract + s.byOwner.ops + s.byOwner.copy + s.byOwner.link + s.byOwner.computed, s.fields);
  assert.deepEqual(model.bases.map((b) => b.key), ['hub', 'fire', 'telecom', 'mechanical']);
  assert.equal(baseByKey(model, 'fire').name, 'GW 소방시설 점검');
});

test('펼치기: 사본·확장·상태 가드 필드·역방향 연결·기본 필드 순서', () => {
  const fire = baseByKey(model, 'fire');
  const mech = baseByKey(model, 'mechanical');
  const copy = tableByKey(fire, 'buildings');
  assert.deepEqual(copy.fields.filter((f) => f.owner === 'copy').map((f) => f.name), ['id', 'customerId', 'roadAddress', 'name', 'mainPurpose', 'totalArea', 'groundFloors', 'undergroundFloors']);
  assert.equal(copy.idPattern, '^(stg_)?bld_[0-9a-z]+$', '사본 ID 형식은 계약의 x-idPrefix에서');
  assert.ok(tableByKey(fire, 'inspectionResults').fields.some((f) => f.name === 'extinguisherCount'), 'fire 확장');
  assert.ok(!tableByKey(mech, 'inspectionResults').fields.some((f) => f.name === 'extinguisherCount'), '다른 사업부에는 없음');
  assert.ok(tableByKey(mech, 'inspectionResults').fields.some((f) => f.name === 'boilerEfficiency'));
  const quotes = tableByKey(fire, 'quotes');
  assert.equal(quotes.fields[0].name, 'quoteNo', '기본 필드가 맨 앞');
  assert.ok(quotes.fields.some((f) => f.name === 'statusConfirmed' && f.auto === 'statusFlow'));
  const contractsT = tableByKey(fire, 'contracts');
  assert.ok(contractsT.fields.some((f) => f.name === '점검 일정' && f.inverseOf === 'inspections.contract'), '역방향 연결');
  assert.deepEqual(refFields(tableByKey(fire, 'inspectionResults')), { inspectionId: 'inspections', contractId: 'contracts' });
  assert.deepEqual(Object.keys(statusFlows(model)), ['견적', '계약', '점검 일정', '청구']);
  const r = syncRules(model);
  assert.deepEqual(r.order, ['customers', 'buildings', 'staff']);
  assert.deepEqual(r.tables.buildings.links, { customer: { from: 'customerId', table: 'customers' } });
  assert.equal(r.tables.staff.kinds.active, 'boolean');
});

test('구조 검사가 잘못된 수정을 잡는다', () => {
  const cases = [
    [(r) => { tableOf(r, 'hub', 'buildings').fields.find((f) => f.name === 'customer').to = 'nope'; }, /연결 대상 테이블 nope/u],
    [(r) => { tableOf(r, 'division', 'contracts').fields.find((f) => f.name === '미수금').formula = '{없는 필드} - 1'; }, /없는 필드 \{없는 필드\}/u],
    [(r) => { tableOf(r, 'division', 'quotes').statusFlow.transitions.draft.push('archived'); }, /없는 상태/u],
    [(r) => { delete tableOf(r, 'division', 'invoices').statusFlow.transitions.void; }, /상태 목록이 선택지와 다릅니다/u],
    [(r) => { tableOf(r, 'hub', 'staff').fields.push({ name: 'Bad Name', type: 'singleLineText' }); }, /영문 camelCase/u],
    [(r) => { tableOf(r, 'hub', 'staff').fields.push({ name: 'x', type: 'singleSelect', choices: [] }); }, /choices/u],
    [(r) => { tableOf(r, 'hub', 'staff').fields.push({ name: 'y', type: 'rich' }); }, /알 수 없는 타입/u],
    [(r) => { tableOf(r, 'division', 'quotes').fields.push({ name: 'z', type: 'lookup', via: 'customer', field: '없음' }); }, /없음 필드가 없습니다/u],
    [(r) => { tableOf(r, 'division', 'quotes').fields.push({ name: 'w', type: 'count', via: 'customerId' }); }, /연결 필드여야/u],
    [(r) => { tableOf(r, 'division', 'customers').copyOf.fields.push('ghost'); }, /copyOf 원본/u],
    [(r) => { tableOf(r, 'division', 'inspections').fields = tableOf(r, 'division', 'inspections').fields.filter((f) => f.name !== 'divisionId'); }, /divisionId가 필요/u],
    [(r) => { r.sync.tables.push('quotes'); }, /허브 사본 테이블이 없습니다/u],
    [(r) => { r.sync.maxDropRatio = 2; }, /maxDropRatio/u],
    [(r) => { tableOf(r, 'division', 'inspectionResults').fields.find((f) => f.name === 'contractId').ref = 'nowhere'; }, /ref 대상 nowhere/u],
    [(r) => { tableOf(r, 'hub', 'staff').primary = 'division'; }, /기본 필드/u],
    [(r) => { tableOf(r, 'division', 'quotes').fields.push({ name: '건물', type: 'link', to: 'buildings', inverse: '견적' }); }, /역방향 연결 이름이 기존 필드와 겹칩니다/u],
  ];
  for (const [fn, re] of cases) {
    const errors = validateModel(mutate(fn));
    assert.ok(errors.some((e) => re.test(e)), `${re} 를 기대했지만: ${errors.join(' / ') || '(오류 없음)'}`);
  }
});

test('데이터 계약 검사: 6-1 JSON Schema와 YAML이 어긋나면 잡는다', () => {
  const withContract = (name, fn) => {
    const c = structuredClone(contracts);
    fn(c[name]);
    return c;
  };
  const cases = [
    [mutate(() => {}, withContract('quotes', (s) => { s.properties.discount = { type: 'integer' }; })), /계약 필드 discount이\(가\) 스키마 YAML에 없습니다/u],
    [mutate((r) => { tableOf(r, 'division', 'quotes').fields.push({ name: 'discount', type: 'number', owner: 'contract' }); }), /YAML 필드 discount이\(가\) 계약에 없습니다/u],
    [mutate(() => {}, withContract('quotes', (s) => { s.properties.status.enum.push('archived'); })), /선택지 불일치/u],
    [mutate(() => {}, withContract('customers', (s) => { s['x-airtable'].table = '거래처'; })), /테이블 이름 고객 ↔ 계약 x-airtable\.table 거래처/u],
    [mutate(() => {}, withContract('contracts', (s) => { s['x-airtable'].base = 'hub'; })), /Base 종류 division ↔ 계약 x-airtable\.base hub/u],
    [mutate(() => {}, withContract('pricing', (s) => { s['x-airtable'].jsonFields = []; })), /JSON 필드/u],
    [mutate((r) => { fieldOf(tableOf(r, 'division', 'quotes'), 'total').type = 'singleLineText'; }), /타입 불일치: 계약 integer ↔ 에어테이블 singleLineText/u],
    [mutate((r) => { fieldOf(tableOf(r, 'hub', 'buildings'), 'groundFloors').integer = false; }), /정수 필드/u],
    [mutate((r) => { const t = tableOf(r, 'division', 'quotes'); t.fields = t.fields.filter((f) => f.name !== 'building'); t.fields = t.fields.filter((f) => f.name !== '건물명'); }), /buildingId → buildings에 대응하는 연결 필드/u],
    [mutate((r) => { fieldOf(tableOf(r, 'division', 'contracts'), 'quote').to = 'templateVersions'; }), /quoteId는 quotes를 가리켜야/u],
    [mutate(() => {}, { ...contracts, invoices: { title: 'x', properties: {}, 'x-airtable': { table: '없음' } } }), /계약 invoices을\(를\) 담는 테이블이 스키마 YAML에 없습니다/u],
  ];
  for (const [m, re] of cases) {
    const errors = checkContracts(m, m.contracts);
    assert.ok(errors.some((e) => re.test(e)), `${re} 를 기대했지만: ${errors.join(' / ') || '(오류 없음)'}`);
  }
});
