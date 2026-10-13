// 양식 버전 관리: 업로드 → 테스트 렌더 → 활성화(통과한 것만) → 되돌리기
import { test } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { buildTemplateBuffer, inspectTemplate, renderTemplate } from '../src/core/xlsx.js';
import { testContext } from './helpers.js';

/** 기본 양식을 만든 뒤 셀 하나를 바꿔 "현업이 잘못 고친 양식"을 흉내 낸다. */
async function editedTemplate(division, edit) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await buildTemplateBuffer(division));
  edit(wb);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

function findCell(ws, text) {
  let found = null;
  ws.eachRow((row) => row.eachCell((cell) => { if (cell.value === text) found = cell; }));
  return found;
}

test('시작 시 사업부마다 기본 양식 v1이 테스트를 통과해 활성화된다', async () => {
  const { ctx } = await testContext();
  for (const id of ctx.registry.ids()) {
    const versions = await ctx.templates.versions(id);
    assert.equal(versions.length, 1);
    assert.equal(versions[0].status, 'active');
    assert.equal(versions[0].testReport.ok, true);
    assert.match(versions[0].sha256, /^[0-9a-f]{64}$/u);
  }
  await ctx.templates.ensureDefaults();
  assert.equal((await ctx.templates.versions('fire')).length, 1, '두 번 실행해도 중복 생성하지 않는다');
});

test('테스트 렌더 실패 양식(필수 값 자리 삭제·오타)은 활성화를 거부한다', async () => {
  const { ctx } = await testContext();
  const fire = ctx.registry.get('fire');
  const typo = await editedTemplate(fire, (wb) => { findCell(wb.getWorksheet('견적서'), '{{total}}').value = '{{totl}}'; });
  const uploaded = await ctx.templates.upload('fire', typo, { note: '합계 칸 오타' });
  assert.equal(uploaded.version, 2);
  assert.equal(uploaded.status, 'uploaded');

  const tested = await ctx.templates.testRender(uploaded.id);
  assert.equal(tested.status, 'failed');
  assert.ok(tested.testReport.errors.some((e) => e.includes('{{total}}')));
  await assert.rejects(ctx.templates.activate(uploaded.id), (err) => {
    assert.equal(err.code, 'TEMPLATE_INVALID');
    assert.match(err.message, /테스트 렌더를 통과하지 않은 양식/u);
    return true;
  });
  const { record } = await ctx.templates.getActive('fire');
  assert.equal(record.version, 1, '운영 양식은 그대로 v1');

  // 테스트를 아예 안 돌린 양식도 활성화 불가
  const untested = await ctx.templates.upload('fire', await buildTemplateBuffer(fire));
  await assert.rejects(ctx.templates.activate(untested.id), (err) => err.details.errors[0] === '테스트 렌더를 먼저 실행하세요.');
});

test('시트 이름이 바뀐 양식·알 수 없는 값 자리·깨진 파일도 테스트에서 걸린다', async () => {
  const { ctx } = await testContext();
  const telecom = ctx.registry.get('telecom');
  const renamed = await editedTemplate(telecom, (wb) => { wb.getWorksheet('견적서').name = 'Sheet1'; });
  const r1 = await ctx.templates.testRender((await ctx.templates.upload('telecom', renamed)).id);
  assert.match(r1.testReport.errors[0], /"견적서" 시트가 없습니다/u);

  const unknown = await editedTemplate(telecom, (wb) => { wb.getWorksheet('견적서').getCell('D1').value = '담당 {{salesRep}}'; });
  const r2 = await ctx.templates.testRender((await ctx.templates.upload('telecom', unknown)).id);
  assert.ok(r2.testReport.errors.some((e) => e.includes('{{salesRep}}')));

  const garbage = await ctx.templates.testRender((await ctx.templates.upload('telecom', Buffer.from('not an xlsx'))).id);
  assert.equal(garbage.status, 'failed');
  await assert.rejects(ctx.templates.upload('telecom', Buffer.alloc(0)), { code: 'VALIDATION_FAILED' });
});

test('새 양식 v2 활성화 → v1은 비활성 → 되돌리기로 v1 복귀', async () => {
  let t = Date.UTC(2026, 9, 13, 9);
  const { ctx } = await testContext();
  // 시계를 흐르게 해 활성화 순서를 분명히 한다
  const { createTemplateService } = await import('../src/core/templates.js');
  const path = await import('node:path');
  const dir = path.join(ctx.outDir, '..', 'store', 'production');
  const templates = createTemplateService({ store: ctx.store, registry: ctx.registry, pricing: ctx.pricing, filesDir: path.join(dir, 'templates'), baseDir: dir, now: () => new Date((t += 1000)) });

  const mech = ctx.registry.get('mechanical');
  const v2 = await templates.upload('mechanical', await editedTemplate(mech, (wb) => {
    wb.getWorksheet('견적서').getCell('A1').value = '그리드웰 빌딩서비스 · 기계설비팀';
  }), { note: '머리글 변경' });
  assert.equal((await templates.testRender(v2.id)).status, 'tested');
  const active = await templates.activate(v2.id);
  assert.equal(active.status, 'active');
  const versions = await templates.versions('mechanical');
  assert.deepEqual(versions.map((v) => v.status), ['inactive', 'active'], '활성 양식은 사업부마다 1개');

  const r = await ctx.engine.createQuote({ divisionId: 'mechanical', address: '대구 군위군 군위읍 가상길 7', conditions: {} });
  assert.equal(r.template.version, 2, '다음 견적부터 새 양식 사용');

  const back = await templates.rollback('mechanical');
  assert.deepEqual([back.from, back.to], [2, 1]);
  assert.equal((await templates.getActive('mechanical')).record.version, 1);
  await assert.rejects(templates.rollback('fire'), /되돌릴 이전 활성 버전이 없습니다/u);

  // 이미 쓰던 버전을 다시 테스트해도 상태는 유지(결과만 기록)
  assert.equal((await templates.testRender(v2.id)).status, 'inactive');
  assert.equal((await templates.activate(back.record.id)).status, 'active', '이미 활성인 버전 활성화는 그대로');
});

test('렌더: 숫자는 숫자로, 항목은 정해진 칸에, 칸을 넘으면 오류', async () => {
  const { ctx } = await testContext();
  const fire = ctx.registry.get('fire');
  const buffer = await buildTemplateBuffer(fire);
  const info = await inspectTemplate(buffer, '견적서');
  assert.deepEqual(info.errors, []);
  assert.equal(info.capacity, 8);
  assert.deepEqual(info.itemColumns, ['name', 'basis', 'amount']);

  const values = { quoteNo: 'Q-1', quoteDate: 'd', customerName: 'c', address: 'a', subtotal: 1000, vat: 100, total: 1100 };
  const items = [{ name: '항목1', basis: '근거', amount: 1000 }];
  const { buffer: out, unresolved } = await renderTemplate(buffer, { sheetName: '견적서', values, items });
  assert.ok(unresolved.includes('validUntil'), '엄격 모드가 아니면 남은 자리를 알려만 준다');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(out);
  const ws = wb.getWorksheet('견적서');
  let totalCell = null;
  ws.eachRow((row) => row.eachCell((cell) => { if (cell.value === 1100) totalCell = cell; }));
  assert.ok(totalCell, '합계는 숫자 1100으로 들어간다');
  assert.equal(findCell(ws, '{{/items}}'), null, '항목 끝 표식은 지운다');

  const many = Array.from({ length: 9 }, (_, i) => ({ name: `i${i}`, basis: '', amount: 1 }));
  await assert.rejects(renderTemplate(buffer, { sheetName: '견적서', values, items: many }), /항목이 9개인데 양식 항목 칸은 8개/u);
  await assert.rejects(renderTemplate(buffer, { sheetName: '견적서', values, items, strict: true }), /채우지 못한 값 자리/u);
  const noItems = await editedTemplate(fire, (wb2) => { findCell(wb2.getWorksheet('견적서'), '{{/items}}').value = null; });
  await assert.rejects(renderTemplate(noItems, { sheetName: '견적서', values, items }), /항목 표 영역/u);
  assert.ok((await inspectTemplate(noItems, '견적서')).errors.includes('항목 표 끝({{/items}}) 없음'));
});
