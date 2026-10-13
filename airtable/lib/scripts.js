// 자동화 스크립트 4개의 생성 구간(설정 + 공용 코드)을 스키마에서 만든다.
import fs from 'node:fs';
import path from 'node:path';
import { SCRIPTS_DIR } from './paths.js';
import { constDecl, injectBlocks, libSource } from './inline.js';
import { statusFlows, syncRules } from './schema.js';

export const SCRIPT_FILES = ['status-guard.js', 'duplicate-detect.js', 'sync-safety.js', 'error-alert.js'];

/** 허브에서 중복 감지 대상(dupCandidates 필드가 있는 테이블) { 테이블 이름: key } */
export function duplicateKinds(model) {
  const hub = model.bases.find((b) => b.kind === 'hub');
  return Object.fromEntries(hub.tables.filter((t) => t.fields.some((f) => f.name === 'dupCandidates')).map((t) => [t.name, t.key]));
}

export function scriptBlocks(model) {
  const rules = syncRules(model);
  const { tables, ...sync } = rules;
  return {
    'status-guard.js': {
      config: constDecl('FLOWS', statusFlows(model)),
      'lib/status.js': libSource('status.js'),
    },
    'duplicate-detect.js': {
      config: constDecl('KINDS', duplicateKinds(model)),
      'lib/dedupe.js': libSource('dedupe.js'),
    },
    'sync-safety.js': {
      config: `${constDecl('SYNC', sync)}\n${constDecl('RULES', tables)}`,
      'lib/sync-core.js': libSource('sync-core.js'),
    },
    'error-alert.js': {
      config: constDecl('DEFAULT_LABEL', model.company),
      'lib/alert.js': libSource('alert.js'),
    },
  };
}

/** @returns {Map<string, string>} 절대 경로 → 내용 */
export function scriptOutputs(model, dir = SCRIPTS_DIR) {
  const out = new Map();
  for (const [file, blocks] of Object.entries(scriptBlocks(model))) {
    const p = path.join(dir, file);
    out.set(p, injectBlocks(fs.readFileSync(p, 'utf8'), blocks));
  }
  return out;
}
