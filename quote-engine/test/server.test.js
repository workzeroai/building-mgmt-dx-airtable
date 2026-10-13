// 웹 API: 화면이 쓰는 흐름(사업부 → 건물 → 실시간 금액 → 견적 생성·다운로드)과 관리자 API
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { createApp } from '../src/server.js';
import { buildTemplateBuffer } from '../src/core/xlsx.js';
import { fakePdfConverter, testContext } from './helpers.js';

let server;
let base;
let ctx;

before(async () => {
  ({ ctx } = await testContext({ converter: fakePdfConverter() }));
  server = createApp(ctx).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const get = async (p) => {
  const res = await fetch(base + p);
  return { status: res.status, body: res.headers.get('content-type')?.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer()), res };
};
const send = async (method, p, body, headers = { 'Content-Type': 'application/json' }) => {
  const res = await fetch(base + p, { method, headers, body: Buffer.isBuffer(body) ? body : JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
};

test('화면 흐름: 사업부 3개 → 건물 조회 → 실시간 금액 → 견적 생성 → 엑셀·PDF 받기', async () => {
  const divisions = (await get('/api/divisions')).body;
  assert.deepEqual(divisions.map((d) => d.id), ['fire', 'telecom', 'mechanical']);
  assert.equal(divisions[0].calculateCosts, undefined, '계산 함수는 화면에 보내지 않는다');
  assert.equal((await get('/api/examples')).body.length, 5);
  assert.ok((await get('/api/customers')).body.length >= 20);
  assert.deepEqual((await get('/api/health')).body, { ok: true });

  const lookup = (await get(`/api/building?address=${encodeURIComponent('성남시 분당구 샘플로 45')}`)).body;
  assert.equal(lookup.building.dongCount, 2);
  const preview = await send('POST', '/api/quotes/preview', { divisionId: 'telecom', building: lookup.building, conditions: { lines: 180, switches: 8, terminalBoxes: 4 } });
  assert.equal(preview.status, 200);
  assert.equal(preview.body.total, 3902800);
  assert.ok(['store', 'cache'].includes(preview.body.pricingSource));

  const created = await send('POST', '/api/quotes', { divisionId: 'telecom', address: lookup.address.road, conditions: { lines: 180, switches: 8, terminalBoxes: 4 }, customerId: 'cus_0001' });
  assert.equal(created.status, 201);
  assert.equal(created.body.pdf.status, 'ok');
  assert.match(created.body.downloads.xlsx, /^\/files\/GW-TEL-\d{8}-001\.xlsx$/u);
  assert.deepEqual(created.body.steps.map((s) => s.name), ['주소 정규화·건물 조회', '단가·계산', '엑셀 양식 채움', 'PDF 변환(큐)', '기록']);

  const xlsx = await get(created.body.downloads.xlsx);
  assert.equal(xlsx.status, 200);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(xlsx.body);
  const cells = [];
  wb.getWorksheet('견적서').eachRow((row) => row.eachCell((c) => cells.push(c.value)));
  assert.ok(cells.includes(created.body.quote.quoteNo));
  assert.ok(cells.includes(3902800));
  assert.ok(!cells.some((v) => typeof v === 'string' && v.includes('{{')), '값 자리가 남지 않는다');
  assert.equal((await get(created.body.downloads.pdf)).status, 200);

  const list = (await get('/api/quotes?divisionId=telecom')).body;
  assert.equal(list[0].quoteNo, created.body.quote.quoteNo);
  const status = (await get('/api/status')).body;
  assert.equal(status.pdf.succeeded, 1);
  assert.equal(status.target, 'production');
  assert.equal(status.store, 'local', '저장소 종류가 엔진 상태에 덮이지 않는다');
  assert.equal(status.guard.target, 'production');
});

test('입력 오류는 400·404로 안내하고 알림을 보내지 않는다', async () => {
  const before = ctx.notifier.status().logged;
  assert.equal((await get('/api/building?address=')).status, 400);
  const missing = await get(`/api/building?address=${encodeURIComponent('서울 없는로 1')}`);
  assert.equal(missing.status, 404);
  assert.equal(missing.body.error.code, 'ADDRESS_NOT_FOUND');
  assert.equal((await send('POST', '/api/quotes/preview', { divisionId: 'fire' })).status, 400);
  assert.equal((await send('POST', '/api/quotes/preview', { divisionId: 'elevator', building: {} })).status, 404);
  assert.equal((await get('/files/..%2F..%2Fpackage.json')).status, 400);
  assert.equal((await get('/files/none.pdf')).status, 404);
  assert.equal(ctx.notifier.status().logged, before);
});

test('서버 오류(5xx)는 요약 알림을 남기고 내부 메시지는 숨긴다', async () => {
  const original = ctx.engine.preview;
  ctx.engine.preview = async () => { throw new TypeError('Cannot read properties of undefined'); };
  const res = await send('POST', '/api/quotes/preview', {});
  ctx.engine.preview = original;
  assert.equal(res.status, 500);
  assert.equal(res.body.error.message, '서버 오류가 발생했습니다.');
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(ctx.notifier.status().rules, 1);
});

test('관리자: 단가 조회·수정(형식 오류 거부), 양식 업로드 → 테스트 → 활성화 → 되돌리기', async () => {
  const pricing = (await get('/api/admin/pricing/fire')).body;
  assert.equal(pricing.record.source, '가상');
  assert.ok(pricing.keys.includes('areaBands'));
  const bad = await send('PUT', '/api/admin/pricing/fire', { data: { vatRate: 0.1 } });
  assert.equal(bad.status, 400);
  const ok = await send('PUT', '/api/admin/pricing/fire', { data: { ...pricing.record.data, undergroundPerFloor: 45000 }, version: '2026-10-13' });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.version, '2026-10-13');

  const upload = await send('POST', '/api/admin/templates/fire?note=v2', await buildTemplateBuffer(ctx.registry.get('fire')), { 'Content-Type': 'application/octet-stream' });
  assert.equal(upload.status, 201);
  assert.equal(upload.body.status, 'tested');
  const broken = await send('POST', '/api/admin/templates/fire', Buffer.from('not xlsx'), { 'Content-Type': 'application/octet-stream' });
  assert.equal(broken.body.status, 'failed');
  const refused = await send('POST', `/api/admin/template-versions/${broken.body.id}/activate`);
  assert.equal(refused.status, 422);

  assert.equal((await send('POST', `/api/admin/template-versions/${upload.body.id}/test`)).body.testReport.ok, true);
  assert.equal((await send('POST', `/api/admin/template-versions/${upload.body.id}/activate`)).body.status, 'active');
  const versions = (await get('/api/admin/templates/fire')).body;
  assert.deepEqual(versions.map((v) => `${v.version}:${v.status}`), ['3:failed', '2:active', '1:inactive']);
  const file = await get(`/api/admin/template-versions/${upload.body.id}/file`);
  assert.equal(file.status, 200);
  assert.equal((await get('/api/admin/template-versions/tpl_none/file')).status, 404);
  const rolled = await send('POST', '/api/admin/templates/fire/rollback');
  assert.deepEqual([rolled.body.from, rolled.body.to], [2, 1]);
});
