// 생성 블록 끼워 넣기: Airtable 스크립트·n8n Code 노드는 import를 못 하므로
// 공용 판정 코드(automations/lib/*.js)와 스키마에서 뽑은 설정을 파일 안의 표시 구간에 그대로 넣는다.
//   // ---- BEGIN GENERATED: <이름> ... ----
//   (빌드가 채우는 내용)
//   // ---- END GENERATED: <이름> ----
import fs from 'node:fs';
import path from 'node:path';
import { AUTOMATION_LIB_DIR } from './paths.js';

/** lib 파일을 스크립트에 넣을 수 있는 형태로: 맨 위 설명 주석은 두고 export 키워드만 뗀다. */
export function libSource(name, dir = AUTOMATION_LIB_DIR) {
  const text = fs.readFileSync(path.join(dir, name), 'utf8').replace(/\r\n/gu, '\n');
  if (/^\s*import\s/mu.test(text)) throw new Error(`${name}: 끼워 넣는 공용 코드는 import를 쓸 수 없습니다`);
  return text.replace(/^export /gmu, '').trimEnd();
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

/**
 * @param {string} source 파일 내용
 * @param {Record<string, string>} blocks 이름 → 넣을 내용
 * @returns {string}
 */
export function injectBlocks(source, blocks) {
  let out = source.replace(/\r\n/gu, '\n');
  for (const [name, body] of Object.entries(blocks)) {
    const re = new RegExp(`(// ---- BEGIN GENERATED: ${escapeRe(name)}[^\\n]*\\n)[\\s\\S]*?(// ---- END GENERATED: ${escapeRe(name)} ----)`, 'u');
    if (!re.test(out)) throw new Error(`생성 구간 표시를 찾지 못했습니다: ${name}`);
    out = out.replace(re, (_, begin, end) => `${begin}${body.trimEnd()}\n${end}`);
  }
  return out;
}

/** JS 상수 선언(값은 JSON — 그대로 유효한 JS). */
export const constDecl = (name, value) => `const ${name} = ${JSON.stringify(value, null, 2)};`;
