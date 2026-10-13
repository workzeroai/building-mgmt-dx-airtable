// 공통 견적 흐름: 기록·번호·건물 재사용·단가 출처·PDF 상태가 견적 레코드에 남는다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadSchemas, validateRecord } from '../src/core/store/schema.js';
import { createPricingService } from '../src/core/pricing.js';
import { createContext } from '../src/context.js';
import { airtableFake, makeTmp, noConverter, silent, testContext } from './helpers.js';
import path from 'node:path';

const schemas = loadSchemas();

test('견적 기록: 데이터 계약을 지키고 단가 출처·양식 버전·파일 경로·PDF 상태를 남긴다', async () => {
  const { ctx } = await testContext();
  const r = await ctx.engine.createQuote({ divisionId: 'fire', address: '서울 중구 예시로 12', conditions: { grade: '종합' }, customerId: 'cus_0003' });
  assert.deepEqual(validateRecord(schemas.quotes, r.quote), []);
  assert.equal(r.quote.customerId, 'cus_0003');
  assert.equal(r.quote.templateVersion, 1);
  assert.equal(r.quote.pdfStatus, 'skipped');
  assert.match(r.quote.files.xlsx, /GW-FIRE-\d{8}-001\.xlsx$/u);
  assert.equal(r.quote.files.pdf, null);
  assert.ok(fs.existsSync(r.files.xlsx));
  assert.equal(r.result.total, 1383800);

  const building = await ctx.store.get('buildings', r.quote.buildingId);
  assert.equal(building.roadAddress, '서울특별시 중구 예시로 12');
  assert.equal(building.customerId, 'cus_0003');
});

test('같은 날 두 번째 견적은 번호가 이어지고, 같은 주소의 건물 레코드는 다시 쓴다', async () => {
  const { ctx } = await testContext();
  const a = await ctx.engine.createQuote({ divisionId: 'mechanical', address: '대구 군위군 군위읍 가상길 7' });
  const b = await ctx.engine.createQuote({ divisionId: 'mechanical', address: '대구광역시 군위군 군위읍 가상길 7 (동부리)', conditions: { cycle: '분기' } });
  assert.match(a.quote.quoteNo, /-001$/u);
  assert.match(b.quote.quoteNo, /-002$/u);
  assert.equal(a.quote.buildingId, b.quote.buildingId);
  const bld = await ctx.store.get('buildings', a.quote.buildingId);
  assert.equal(bld.adminCodeFallback.to, '4772025021', '구 코드 재조회 사실을 건물 레코드에 남긴다');
});

test('저장소 단가 장애 중에도 견적은 나가고, 레코드에 pricingSource=fallback이 남는다', async () => {
  const { ctx } = await testContext();
  const failing = { ...ctx.store, list: async (table, filter) => { if (table === 'pricing') throw new Error('저장소 다운'); return ctx.store.list(table, filter); } };
  const engineCtx = await import('../src/core/pipeline.js');
  const pricing = createPricingService({ store: failing, registry: ctx.registry, logger: silent });
  const engine = engineCtx.createQuoteEngine({ ...ctx, pricing, outDir: ctx.outDir });
  const r = await engine.createQuote({ divisionId: 'telecom', address: '경기도 성남시 분당구 샘플로 45' });
  assert.equal(r.pricingSource, 'fallback');
  assert.equal(r.quote.pricingSource, 'fallback');
  assert.match(r.pricingWarning, /저장소 다운/u);
});

test('미리보기 입력 오류와 없는 고객은 VALIDATION_FAILED', async () => {
  const { ctx } = await testContext();
  await assert.rejects(ctx.engine.preview({ divisionId: 'fire', conditions: {} }), { code: 'VALIDATION_FAILED' });
  await assert.rejects(ctx.engine.createQuote({ divisionId: 'fire', address: '서울 중구 예시로 12', customerId: 'cus_9999' }), { code: 'VALIDATION_FAILED' });
  await assert.rejects(ctx.engine.createQuote({ divisionId: 'fire', address: '서울 중구 예시로 12', conditions: { grade: '정밀' } }), /작동\/종합 중 하나/u);
  const s = ctx.engine.status();
  assert.equal(s.guard.target, 'production');
  assert.equal(s.pdf.converter, 'none');
});

test('에어테이블 어댑터로도 같은 흐름이 돈다(STORE_ADAPTER=airtable, 가짜 API)', async () => {
  const dir = makeTmp();
  const fetchImpl = airtableFake();
  const ctx = await createContext({
    storeDir: path.join(dir, 'store'), outDir: path.join(dir, 'out'), quiet: true, llm: null, converter: noConverter, fetchImpl,
    env: { STORE_ADAPTER: 'airtable', AIRTABLE_TOKEN: 'pat-test', AIRTABLE_BASE_ID: 'appTEST' }, // qa-scan: allow
  });
  assert.equal(ctx.store.kind, 'airtable');
  assert.equal((await ctx.store.list('divisions')).length, 3, '사업부·단가·양식 버전을 에어테이블에 동기화');
  const r = await ctx.engine.createQuote({ divisionId: 'fire', address: '서울 중구 예시로 12' });
  assert.match(r.quote.id, /^quo_/u);
  assert.equal(r.pricingSource, 'cache');
  assert.ok(fetchImpl.calls.every((c) => c.url.startsWith('https://api.airtable.com/v0/appTEST/')));
});
