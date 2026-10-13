// PDF 변환 직렬 큐.
// LibreOffice는 같은 프로필로 동시에 여러 개를 띄우면 멈추거나 빈 파일을 낸다(동시 요청 장애).
// 그래서 한 번에 한 건만 변환하고, 건당 타임아웃·강제 정리·서킷브레이커로 묶는다.
// 어떤 경우에도 견적은 xlsx로 끝까지 나간다. PDF는 "되면 붙이는" 산출물이다.
import { createCircuitBreaker } from './circuit-breaker.js';

/**
 * @param {object} options
 * @param {{ available: boolean, name: string, convert: Function }} options.converter
 * @param {number} [options.timeoutMs] 건당 타임아웃(기본 90초)
 * @param {ReturnType<typeof createCircuitBreaker>} [options.breaker]
 * @param {{ warn: Function }} [options.logger]
 */
export function createPdfQueue({ converter, timeoutMs = 90_000, breaker, logger = console } = {}) {
  const circuit = breaker ?? createCircuitBreaker({ name: 'pdf' });
  let tail = Promise.resolve();
  const stats = { queued: 0, running: 0, maxConcurrent: 0, succeeded: 0, failed: 0, timeouts: 0, skipped: 0 };

  async function run(xlsxPath, outDir) {
    if (!converter?.available) {
      stats.skipped += 1;
      return { status: 'skipped', reason: 'LibreOffice가 없어 xlsx만 만들었습니다.' };
    }
    if (!circuit.canRequest()) {
      stats.skipped += 1;
      const { retryAt } = circuit.status();
      return {
        status: 'circuit-open',
        reason: `PDF 변환이 연속 실패해 잠시 멈췄습니다. xlsx만 제공합니다(재시도 ${new Date(retryAt).toLocaleTimeString('ko-KR')}).`,
        retryAt,
      };
    }
    stats.running += 1;
    stats.maxConcurrent = Math.max(stats.maxConcurrent, stats.running);
    const started = Date.now();
    try {
      const pdfPath = await converter.convert(xlsxPath, outDir, { timeoutMs });
      circuit.recordSuccess();
      stats.succeeded += 1;
      return { status: 'ok', pdfPath, ms: Date.now() - started };
    } catch (err) {
      circuit.recordFailure(err);
      stats.failed += 1;
      if (err.code === 'PDF_TIMEOUT') stats.timeouts += 1;
      logger.warn?.(`[pdf] 변환 실패 → xlsx만 제공: ${err.message}`);
      return { status: 'failed', reason: err.message, code: err.code, ms: Date.now() - started };
    } finally {
      stats.running -= 1;
    }
  }

  return {
    /** 변환 요청을 큐 끝에 붙인다. 앞선 작업이 끝나야 시작한다. 절대 reject하지 않는다. */
    enqueue(xlsxPath, outDir) {
      stats.queued += 1;
      const job = tail.then(() => run(xlsxPath, outDir)).finally(() => { stats.queued -= 1; });
      tail = job.catch(() => {});
      return job;
    },
    status() {
      return {
        converter: converter?.available ? converter.name : 'none',
        timeoutMs,
        pending: stats.queued,
        ...stats,
        breaker: circuit.status(),
      };
    },
    breaker: circuit,
  };
}
