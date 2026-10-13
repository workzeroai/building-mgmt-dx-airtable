// airtable/ 단계(6-2)의 경로. 견적 엔진(6-1)의 경로 정의를 그대로 이어 쓴다.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATA_DIR, OUT_DIR, PRICING_DIR, REPO_ROOT, SCHEMA_DIR, SEED_DIR } from '../../quote-engine/src/core/paths.js';

const here = path.dirname(fileURLToPath(import.meta.url));

export { DATA_DIR, OUT_DIR, PRICING_DIR, REPO_ROOT, SCHEMA_DIR as CONTRACT_DIR, SEED_DIR };
export const AIRTABLE_DIR = path.resolve(here, '..');
export const SCHEMA_FILE = path.join(AIRTABLE_DIR, 'schema', 'gridwell.yaml');
export const AUTOMATIONS_DIR = path.join(AIRTABLE_DIR, 'automations');
export const SCRIPTS_DIR = path.join(AUTOMATIONS_DIR, 'scripts');
export const AUTOMATION_LIB_DIR = path.join(AUTOMATIONS_DIR, 'lib');
export const CATALOG_FILE = path.join(AUTOMATIONS_DIR, 'catalog.yaml');
export const N8N_DIR = path.join(REPO_ROOT, 'n8n');
export const DOCS_DIR = path.join(REPO_ROOT, 'docs');
export const DIAGRAMS_DIR = path.join(DOCS_DIR, 'diagrams');
export const OPS_SEED_DIR = path.join(SEED_DIR, 'ops');
export const CSV_DIR = path.join(SEED_DIR, 'csv');

/** 저장소 기준 상대 경로(슬래시) — 문서·출력에 쓴다. */
export const rel = (p) => path.relative(REPO_ROOT, p).split(path.sep).join('/');
