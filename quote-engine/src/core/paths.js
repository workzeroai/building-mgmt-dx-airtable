// 저장소 기준 경로. 모든 경로는 테스트에서 덮어쓸 수 있도록 기본값으로만 쓴다.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const ENGINE_DIR = path.resolve(here, '..', '..');
export const REPO_ROOT = path.resolve(ENGINE_DIR, '..');
export const DIVISIONS_DIR = path.join(ENGINE_DIR, 'src', 'divisions');
export const FIXTURES_DIR = path.join(ENGINE_DIR, 'fixtures');
export const DATA_DIR = path.join(REPO_ROOT, 'data');
export const SCHEMA_DIR = path.join(DATA_DIR, 'schema');
export const SEED_DIR = path.join(DATA_DIR, 'seed');
export const PRICING_DIR = path.join(DATA_DIR, 'pricing');
export const STORE_DIR = path.join(DATA_DIR, 'store');
export const OUT_DIR = path.join(REPO_ROOT, 'out');
