// PDF 변환 안전장치: 직렬 큐 · 건당 타임아웃과 프로세스 강제 정리 · 서킷브레이커 · LibreOffice 없음
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createPdfQueue } from '../src/core/pdf-queue.js';
import { createCircuitBreaker } from '../src/core/circuit-breaker.js';
import { createCommandConverter, createSofficeConverter, findSoffice, runWithTimeout } from '../src/core/soffice.js';
import { fakePdfConverter, isAlive, makeTmp, silent } from './helpers.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('직렬 큐: 동시에 5건 요청해도 한 번에 1건씩, 요청 순서대로 변환한다', async () => {
  const order = [];
  let running = 0;
  let peak = 0;
  const converter = {
    name: 'slow', available: true,
    async convert(xlsx) {
      running += 1;
      peak = Math.max(peak, running);
      order.push(`start:${xlsx}`);
      await sleep(15);
      order.push(`end:${xlsx}`);
      running -= 1;
      return `${xlsx}.pdf`;
    },
  };
  const queue = createPdfQueue({ converter, logger: silent });
  const results = await Promise.all(['a', 'b', 'c', 'd', 'e'].map((x) => queue.enqueue(x, '.')));
  assert.equal(peak, 1, '동시 실행은 최대 1건');
  assert.deepEqual(order, ['a', 'b', 'c', 'd', 'e'].flatMap((x) => [`start:${x}`, `end:${x}`]));
  assert.ok(results.every((r) => r.status === 'ok'));
  const s = queue.status();
  assert.equal(s.maxConcurrent, 1);
  assert.equal(s.succeeded, 5);
  assert.equal(s.queued, 0);
});

test('실제 자식 프로세스로 PDF 파일 생성(가짜 변환기)', async () => {
  const dir = makeTmp();
  const xlsx = path.join(dir, 'q.xlsx');
  fs.writeFileSync(xlsx, 'x');
  const r = await createPdfQueue({ converter: fakePdfConverter(), logger: silent }).enqueue(xlsx, dir);
  assert.equal(r.status, 'ok');
  assert.equal(fs.readFileSync(r.pdfPath, 'utf8'), '%PDF-1.4 fake');
});

test('타임아웃: 멈춘 변환 프로세스는 강제로 정리하고 PDF_TIMEOUT, 다음 건은 정상 진행', async () => {
  const dir = makeTmp();
  let pid = null;
  const hang = {
    name: 'hang', available: true,
    async convert(xlsx, outDir, { timeoutMs }) {
      try {
        await runWithTimeout(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { timeoutMs });
      } catch (err) {
        pid = err.details.pid;
        throw err;
      }
    },
  };
  const queue = createPdfQueue({ converter: hang, timeoutMs: 300, logger: silent });
  const started = Date.now();
  const r = await queue.enqueue(path.join(dir, 'a.xlsx'), dir);
  assert.equal(r.status, 'failed');
  assert.equal(r.code, 'PDF_TIMEOUT');
  assert.ok(Date.now() - started < 5000);
  assert.ok(pid > 0);
  await sleep(200);
  assert.equal(isAlive(pid), false, '타임아웃된 프로세스가 남아 있지 않다');
  assert.equal(queue.status().timeouts, 1);
});

test('서킷브레이커: 연속 실패 N회 → 열림(변환 호출 안 함, xlsx만) → 대기 후 반열림 → 성공하면 닫힘', async () => {
  let now = 0;
  const events = [];
  const breaker = createCircuitBreaker({ failureThreshold: 2, cooldownMs: 60_000, now: () => now, onStateChange: (e) => events.push(`${e.from}→${e.to}`) });
  let calls = 0;
  let mode = 'fail';
  const converter = {
    name: 'flaky', available: true,
    async convert() {
      calls += 1;
      if (mode === 'fail') throw Object.assign(new Error('변환 실패'), { code: 'PDF_CONVERT_FAILED' });
      return 'ok.pdf';
    },
  };
  const queue = createPdfQueue({ converter, breaker, logger: silent });
  assert.equal((await queue.enqueue('1', '.')).status, 'failed');
  assert.equal(breaker.status().state, 'closed');
  assert.equal((await queue.enqueue('2', '.')).status, 'failed');
  assert.equal(breaker.status().state, 'open');

  const blocked = await queue.enqueue('3', '.');
  assert.equal(blocked.status, 'circuit-open');
  assert.equal(blocked.retryAt, 60_000);
  assert.equal(calls, 2, '열린 동안에는 변환기를 부르지 않는다');

  now = 60_000;
  mode = 'ok';
  assert.equal((await queue.enqueue('4', '.')).status, 'ok', '대기 시간 뒤 시험 1건 허용');
  assert.equal(breaker.status().state, 'closed');
  assert.deepEqual(events, ['closed→open', 'open→half-open', 'half-open→closed']);
});

test('서킷브레이커: 반열림 시험이 실패하면 다시 열리고 대기 시간을 새로 센다', () => {
  let now = 0;
  const b = createCircuitBreaker({ failureThreshold: 1, cooldownMs: 100, now: () => now });
  b.recordFailure(new Error('x'));
  assert.equal(b.canRequest(), false);
  now = 100;
  assert.equal(b.canRequest(), true);
  assert.equal(b.status().state, 'half-open');
  now = 150;
  b.recordFailure(new Error('y'));
  assert.equal(b.status().state, 'open');
  assert.equal(b.status().retryAt, 250);
  assert.equal(b.status().lastError, 'y');
  now = 200;
  b.recordFailure(new Error('z'));
  assert.equal(b.status().retryAt, 250, '열린 상태에서 들어온 실패는 대기 시간을 늘리지 않는다');
});

test('LibreOffice가 없으면 변환을 건너뛰고 xlsx만(skipped)', async () => {
  const queue = createPdfQueue({ converter: { name: 'none', available: false }, logger: silent });
  const r = await queue.enqueue('a.xlsx', '.');
  assert.equal(r.status, 'skipped');
  assert.match(r.reason, /LibreOffice가 없어/u);
  assert.equal(queue.status().converter, 'none');
  const missing = createSofficeConverter({ sofficePath: null });
  assert.equal(missing.available, false);
  await assert.rejects(missing.convert('a', '.', { timeoutMs: 10 }), /찾지 못했습니다/u);
});

test('LibreOffice 찾기: SOFFICE_PATH → 플랫폼 기본 경로 → 없음', () => {
  assert.equal(findSoffice({ env: { SOFFICE_PATH: '/x/soffice' }, exists: (p) => p === '/x/soffice' }), '/x/soffice');
  assert.equal(findSoffice({ env: { SOFFICE_PATH: '/nope' }, exists: () => false }), null);
  assert.equal(findSoffice({ env: {}, platform: 'linux', exists: (p) => p === '/usr/bin/libreoffice' }), '/usr/bin/libreoffice');
  assert.equal(findSoffice({ env: {}, platform: 'win32', exists: () => false }), null);
});

test('변환 명령이 실패 코드로 끝나거나 실행할 수 없으면 PDF_CONVERT_FAILED', async () => {
  const dir = makeTmp();
  const fail = createCommandConverter({ command: process.execPath, args: ['-e', 'process.exit(2)'] });
  await assert.rejects(fail.convert(path.join(dir, 'a.xlsx'), dir, { timeoutMs: 5000 }), { code: 'PDF_CONVERT_FAILED' });
  await assert.rejects(runWithTimeout(path.join(dir, 'no-such-binary'), [], { timeoutMs: 1000 }), { code: 'PDF_CONVERT_FAILED' });
});
