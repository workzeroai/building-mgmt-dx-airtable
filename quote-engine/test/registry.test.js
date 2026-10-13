// 레지스트리: 3번째 사업부(mechanical)가 core 수정 없이 "폴더 + 단가 파일"만으로 동작함을 증명한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRegistry, loadDivisions, validateDivisionConfig } from '../src/core/registry.js';
import { DIVISIONS_DIR, ENGINE_DIR } from '../src/core/paths.js';
import { makeTmp, testContext } from './helpers.js';

const CORE_DIR = path.join(ENGINE_DIR, 'src', 'core');
const coreFiles = () => fs.readdirSync(CORE_DIR, { recursive: true }).filter((f) => f.endsWith('.js')).map((f) => path.join(CORE_DIR, f));
const coreDigest = () => createHash('sha256').update(coreFiles().sort().map((f) => fs.readFileSync(f)).join('\n')).digest('hex');

function copyDivision(id, toDir) {
  fs.mkdirSync(path.join(toDir, id), { recursive: true });
  fs.copyFileSync(path.join(DIVISIONS_DIR, id, 'config.js'), path.join(toDir, id, 'config.js'));
}

test('divisions/ 폴더의 사업부 3개를 확산 순서대로 등록한다', async () => {
  const registry = await loadDivisions();
  assert.deepEqual(registry.ids(), ['fire', 'telecom', 'mechanical']);
  assert.equal(registry.get('mechanical').order, 3);
  assert.throws(() => registry.get('elevator'), { code: 'NOT_FOUND' });
});

test('core는 사업부 이름을 하나도 모른다(코드에 사업부 ID·이름 없음)', () => {
  const forbidden = /\b(fire|telecom|mechanical)\b|소방|통신설비|기계설비/u;
  for (const file of coreFiles()) {
    const hit = fs.readFileSync(file, 'utf8').split('\n').findIndex((line) => forbidden.test(line));
    assert.equal(hit, -1, `${path.relative(ENGINE_DIR, file)}:${hit + 1}에 사업부 이름이 있음`);
  }
});

test('3번째 사업부: 사업부 2개로 운영 중인 저장소에 mechanical 폴더만 추가 → core 그대로 견적 생성', async () => {
  const before = coreDigest();
  const dir = makeTmp();
  const divisionsDir = path.join(dir, 'divisions');
  copyDivision('fire', divisionsDir);
  copyDivision('telecom', divisionsDir);

  // 1) 사업부 2개로 시작
  const first = await testContext({ dir, divisionsDir });
  assert.deepEqual(first.ctx.registry.ids(), ['fire', 'telecom']);
  assert.deepEqual((await first.ctx.store.list('divisions')).map((d) => d.id).sort(), ['fire', 'telecom']);
  await assert.rejects(first.ctx.engine.preview({ divisionId: 'mechanical', building: {}, conditions: {} }), { code: 'NOT_FOUND' });

  // 2) 설정 파일 추가(config.js — 단가 파일 data/pricing/mechanical.json은 이미 저장소에 있음)
  copyDivision('mechanical', divisionsDir);
  const second = await testContext({ dir, divisionsDir });
  const { ctx } = second;
  assert.deepEqual(ctx.registry.ids(), ['fire', 'telecom', 'mechanical']);
  assert.ok((await ctx.store.list('divisions')).some((d) => d.id === 'mechanical'), '사업부 테이블에 자동 추가');
  assert.equal((await ctx.store.list('pricing', { divisionId: 'mechanical' })).length, 1, '번들 단가를 저장소에 자동 적재');
  const [tpl] = await ctx.templates.versions('mechanical');
  assert.equal(tpl.status, 'active', '기본 양식 v1 생성 → 테스트 렌더 → 활성화');

  const r = await ctx.engine.createQuote({ divisionId: 'mechanical', address: '대구 군위군 군위읍 가상길 7', conditions: { cycle: '분기' } });
  assert.match(r.quote.quoteNo, /^GW-MECH-\d{8}-001$/u);
  assert.equal(r.pdf.status, 'skipped');
  assert.ok(fs.existsSync(r.files.xlsx));
  assert.equal(coreDigest(), before, 'core 파일은 한 글자도 바뀌지 않았다');
});

test('설정 형식 오류는 어떤 키가 왜 틀렸는지 알려 준다', async () => {
  const errors = validateDivisionConfig({ id: 'x', code: 'X', name: 'x', order: 1, inputs: [{ key: 'a', label: 'A', type: 'select', options: ['1'], default: '2' }, { key: 'b' }] }, 'y');
  assert.ok(errors.some((e) => e.includes('calculateCosts')));
  assert.ok(errors.some((e) => e.includes('폴더 이름 "y"')));
  assert.ok(errors.some((e) => e.includes('기본값이 선택지에 없음')));
  assert.ok(errors.some((e) => e.includes('inputs 항목 형식 오류')));

  const dir = makeTmp();
  fs.mkdirSync(path.join(dir, 'broken'));
  fs.writeFileSync(path.join(dir, 'broken', 'config.js'), "export default { id: 'broken' };\n");
  await assert.rejects(loadDivisions(dir), /divisions\/broken\/config\.js 형식 오류/u);
  assert.throws(() => createRegistry([{ id: 'a', order: 1 }, { id: 'a', order: 2 }]), /중복/u);
});
