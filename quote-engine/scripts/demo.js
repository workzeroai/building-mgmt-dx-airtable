// npm run quote:demo — 3개 사업부 견적을 터미널에서 한 번에 만들고, 안전장치를 차례로 시연한다.
// 데모는 out/demo/ 아래 별도 저장소를 매번 새로 만들어 쓴다(서버용 data/store는 건드리지 않음).
// LibreOffice가 없으면 xlsx만 만들고 경고한 뒤 정상 종료한다.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createContext } from '../src/context.js';
import { OUT_DIR, REPO_ROOT } from '../src/core/paths.js';
import { createPricingService } from '../src/core/pricing.js';
import { createCircuitBreaker } from '../src/core/circuit-breaker.js';
import { createPdfQueue } from '../src/core/pdf-queue.js';
import { createCommandConverter } from '../src/core/soffice.js';
import { createNotifier } from '../src/core/notify.js';

const DEMO_DIR = path.join(OUT_DIR, 'demo');
const color = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code, s) => (color ? `\x1b[${code}m${s}\x1b[0m` : s);
const bold = (s) => c('1', s);
const dim = (s) => c('2', s);
const green = (s) => c('32', s);
const yellow = (s) => c('33', s);
const red = (s) => c('31', s);
const cyan = (s) => c('36', s);

const width = (s) => [...String(s)].reduce((w, ch) => w + (/[\u1100-\u11ff\u3000-\u303f\u3130-\u318f\uac00-\ud7af\uff00-\uffef]/u.test(ch) ? 2 : 1), 0);
const padEnd = (s, n) => `${s}${' '.repeat(Math.max(0, n - width(s)))}`;
const padStart = (s, n) => `${' '.repeat(Math.max(0, n - width(s)))}${s}`;
const won = (n) => `${n.toLocaleString('ko-KR')}원`;
const rel = (p) => (p ? path.relative(REPO_ROOT, p).split(path.sep).join('/') : '-');
const SOURCE = { store: '저장소', cache: '캐시', fallback: '기본값 폴백' };
const PDF = { ok: green('PDF 생성'), skipped: yellow('xlsx만(LibreOffice 없음)'), failed: red('PDF 실패 → xlsx만'), 'circuit-open': yellow('서킷 열림 → xlsx만') };
const silent = { info() {}, warn() {}, error() {} };

const CASES = [
  { divisionId: 'fire', address: '서울 중구 예시로 12, 3층', conditions: { grade: '종합' }, customerId: 'cus_0003' },
  { divisionId: 'telecom', address: '경기도 성남시 분당구 샘플로 45', conditions: { lines: 180, switches: 8, terminalBoxes: 4, contract: '연간' }, customerId: 'cus_0007' },
  { divisionId: 'mechanical', address: '대구광역시 군위군 군위읍 가상길 7', conditions: { boilers: 2, chillers: 1, ahus: 3, pumps: 6, fans: 8, cycle: '월' }, customerId: 'cus_0011' },
];

function section(title) {
  console.log(`\n${bold(cyan(`■ ${title}`))}`);
}

async function main() {
  await fs.rm(DEMO_DIR, { recursive: true, force: true });
  const storeDir = path.join(DEMO_DIR, 'store');
  const ctx = await createContext({ storeDir, outDir: DEMO_DIR, quiet: true, llm: null, env: { ...process.env, ERROR_WEBHOOK_URL: '' } });
  const pdf0 = ctx.pdfQueue.status();

  console.log(bold('그리드웰 빌딩서비스(가상 회사) · 견적 엔진 데모'));
  console.log(dim(`저장소 ${ctx.store.kind}/${ctx.target} · 공공 API ${ctx.buildingClient.mode.address === 'live' ? '실제 호출' : '가짜 응답(fixtures)'} · PDF 변환 ${pdf0.converter === 'none' ? '없음(xlsx만)' : 'LibreOffice'} · 사업부 ${ctx.registry.ids().join(', ')}`));
  if (pdf0.converter === 'none') console.log(yellow('! LibreOffice를 찾지 못했습니다. 견적은 xlsx로만 만듭니다(SOFFICE_PATH로 경로 지정 가능).'));

  section('1. 견적 3건 (사업부 3개, 같은 core)');
  ctx.pricing.invalidate(); // 시작 시 양식 테스트에서 채운 캐시를 비워 저장소 조회부터 보이게
  const results = [];
  for (const job of CASES) {
    const r = await ctx.engine.createQuote(job);
    results.push(r);
    const b = r.building;
    console.log(`${bold(padEnd(r.division.name, 18))} ${r.quote.quoteNo}`);
    console.log(`  건물   ${r.address.road} · ${b.mainPurpose} · ${b.totalArea.toLocaleString('ko-KR')}㎡ · 지상 ${b.groundFloors}/지하 ${b.undergroundFloors}${b.dongCount > 1 ? ` · ${b.dongCount}개 동 합산` : ''}`);
    if (r.adminCodeFallback) console.log(`  ${yellow('구 코드 재조회')} ${r.adminCodeFallback.from} → ${r.adminCodeFallback.to} (${r.adminCodeFallback.reason})`);
    for (const it of r.result.items) console.log(dim(`  ${padEnd(it.name, 18)}${padStart(won(it.amount), 14)}  ${it.basis}`));
    console.log(`  합계   ${bold(won(r.result.total))} ${dim(`(공급가액 ${won(r.result.subtotal)} + 부가세 ${won(r.result.vat)})`)}`);
    console.log(`  단가   ${SOURCE[r.pricingSource]} v${r.pricingVersion} · 양식 v${r.template.version} · ${PDF[r.pdf.status]}${r.pdf.ms ? dim(` ${r.pdf.ms}ms`) : ''}`);
    console.log(`  파일   ${rel(r.files.xlsx)}${r.files.pdf ? `  ${rel(r.files.pdf)}` : ''}`);
  }

  section('2. 단가 캐시 · 폴백');
  const again = await ctx.engine.preview({ divisionId: 'fire', building: results[0].building, conditions: { grade: '종합' } });
  console.log(`  같은 사업부 다시 계산      → 단가 출처 ${green(SOURCE[again.pricingSource])} (5분 TTL, 저장소 호출 없음)`);
  const broken = createPricingService({
    store: { list: async () => { throw new Error('저장소 연결 실패(시뮬레이션)'); } },
    registry: ctx.registry, logger: silent,
  });
  const fb = await broken.get('telecom');
  console.log(`  저장소 장애 상황에서 조회  → 단가 출처 ${yellow(SOURCE[fb.source])} v${fb.version} (견적은 계속 나감, 사유: ${fb.warning})`);

  section('3. 스테이징 ID 매핑 가드');
  const staging = await createContext({ storeDir, outDir: DEMO_DIR, target: 'staging', quiet: true, llm: null, env: {} });
  const ok = await staging.store.update('customers', 'cus_0001', { note: '스테이징 테스트 수정' });
  console.log(`  운영 ID cus_0001 → 매핑표로 ${green(ok.id)} 에 씀 (매핑 ${staging.idMap.size()}개)`);
  try {
    await staging.store.create('quotes', { ...results[0].quote, id: undefined, customerId: 'cus_9999', quoteNo: 'GW-FIRE-20261013-900' });
  } catch (err) {
    console.log(`  매핑 없는 ID cus_9999    → ${red('차단')} ${dim(`[${err.code}] ${err.message}`)}`);
  }

  section('4. PDF 변환: 직렬 큐 · 타임아웃 · 서킷브레이커');
  const breaker = createCircuitBreaker({ name: 'pdf-demo', failureThreshold: 2, cooldownMs: 60_000 });
  const hang = createCommandConverter({ name: 'hang', command: process.execPath, args: ['-e', 'setTimeout(() => {}, 60000)'] });
  const fail = createCommandConverter({ name: 'fail', command: process.execPath, args: ['-e', 'process.exit(3)'] });
  const sim = { name: 'simulated', available: true, convert: (x, o, opt) => (sim.next === 'hang' ? hang : fail).convert(x, o, opt) };
  const q = createPdfQueue({ converter: sim, timeoutMs: 800, breaker, logger: silent });
  sim.next = 'hang';
  const t1 = q.enqueue(results[0].files.xlsx, DEMO_DIR);
  const r1 = await t1;
  sim.next = 'fail';
  const [r2, r3] = await Promise.all([q.enqueue(results[1].files.xlsx, DEMO_DIR), q.enqueue(results[2].files.xlsx, DEMO_DIR)]);
  console.log(`  변환 1 (멈춘 프로세스)      → ${red(r1.code)} ${dim(`${r1.ms}ms 후 프로세스 강제 종료`)}`);
  console.log(`  변환 2 (변환 실패)          → ${red(r2.code)} · 연속 실패 2회 → 서킷 ${red(breaker.status().state)}`);
  console.log(`  변환 3                      → ${yellow(r3.status)} · LibreOffice를 부르지 않고 xlsx만 반환`);
  console.log(dim(`  큐 최대 동시 실행 ${q.status().maxConcurrent}건(직렬) · 실제 데모 큐: 성공 ${ctx.pdfQueue.status().succeeded} · 실패 ${ctx.pdfQueue.status().failed} · 건너뜀 ${ctx.pdfQueue.status().skipped}`));

  section('5. 오류 요약 알림 (규칙 기반, LLM 키 없음)');
  const notifier = createNotifier({ logger: silent });
  let guardError;
  try {
    await staging.store.update('customers', 'cus_9999', { note: 'x' });
  } catch (e) {
    guardError = e;
  }
  const sent = await notifier.notifyError(guardError, { method: 'POST', path: '/api/quotes' });
  for (const line of sent.payload.embeds[0].description.split('\n')) console.log(`  ${line}`);
  console.log(dim(`  → 웹훅 미설정이라 콘솔에 기록 · 요약 방식: ${sent.summarySource === 'llm' ? 'LLM' : '규칙 기반'}`));

  const pdfCount = results.filter((r) => r.pdf.status === 'ok').length;
  console.log(`\n${green('완료')} 견적 ${results.length}건 · xlsx ${results.length}개 · PDF ${pdfCount}개 → ${rel(DEMO_DIR)}/  ${dim('(모든 값은 가상 데이터 기준)')}`);
}

main().catch((err) => {
  console.error(red(`데모 실패: ${err.message}`));
  console.error(err.stack);
  process.exit(1);
});
