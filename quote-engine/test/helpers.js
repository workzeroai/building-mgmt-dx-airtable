// 테스트 공용 도구: 임시 폴더, 가짜 PDF 변환기, 격리된 실행 환경.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createContext } from '../src/context.js';
import { createCommandConverter } from '../src/core/soffice.js';

export function makeTmp(prefix = 'qe-test-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export const silent = { info() {}, warn() {}, error() {} };

/** 실제 자식 프로세스로 PDF 파일을 "만드는" 변환기(LibreOffice 없이 큐 경로 전체를 탄다). */
export function fakePdfConverter() {
  return createCommandConverter({
    name: 'fake-pdf',
    command: process.execPath,
    args: ['-e', "require('fs').writeFileSync(process.argv[2], '%PDF-1.4 fake')"],
  });
}

export const noConverter = { name: 'none', available: false };

/** 임시 저장소를 쓰는 실행 환경. */
export async function testContext(options = {}) {
  const dir = options.dir ?? makeTmp();
  const ctx = await createContext({
    storeDir: path.join(dir, 'store'),
    outDir: path.join(dir, 'out'),
    env: {},
    quiet: true,
    llm: null,
    converter: noConverter,
    ...options,
  });
  return { ctx, dir };
}

/** fetch 가짜: (url, init) => 응답 객체를 돌려주는 함수를 받아 호출 기록을 남긴다. */
export function mockFetch(handler) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const out = await handler(String(url), init, calls.length);
    if (out instanceof Error) throw out;
    const status = out?.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => out?.body ?? out,
      text: async () => JSON.stringify(out?.body ?? out),
    };
  };
  fn.calls = calls;
  return fn;
}

export function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** 에어테이블 REST API 흉내(필터 수식 {필드}='값', offset 페이지 넘김, POST·PATCH). */
export function airtableFake() {
  const tables = {};
  return mockFetch((url, init) => {
    const u = new URL(url);
    const table = decodeURIComponent(u.pathname.split('/').pop());
    tables[table] ??= [];
    if (init.method === 'GET') {
      const formula = u.searchParams.get('filterByFormula') ?? '';
      const conds = [...formula.matchAll(/\{(\w+)\}='([^']*)'/gu)].map((m) => [m[1], m[2]]);
      const rows = tables[table].filter((r) => conds.every(([k, v]) => String(r.fields[k]) === v));
      // 첫 페이지는 1건만 주고 offset으로 나머지를 받게 해 페이지 넘김을 확인
      if (!u.searchParams.get('offset') && rows.length > 1) return { records: rows.slice(0, 1), offset: 'p2' };
      return { records: u.searchParams.get('offset') ? rows.slice(1) : rows };
    }
    const body = JSON.parse(init.body);
    if (init.method === 'POST') {
      const rec = { id: `rec${tables[table].length + 1}`, fields: body.records[0].fields };
      tables[table].push(rec);
      return { records: [rec] };
    }
    const rec = tables[table].find((r) => r.id === body.records[0].id);
    Object.assign(rec.fields, body.records[0].fields);
    return { records: [rec] };
  });
}
