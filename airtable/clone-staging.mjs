// 스테이징 Base 준비: 복제한 Base의 ID를 stg_로 바꾸고 견적 엔진 가드용 매핑표(id-map.json)를 만든다.
//
// 흐름
//   1) 에어테이블 화면에서 운영 Base 4개를 "Duplicate base(레코드 포함)"로 복제 → 스테이징 Base 4개
//   2) 이 스크립트로 각 스테이징 Base의 id·텍스트 ID 참조에 stg_를 붙인다(PATCH, 10건씩)
//   3) 매핑표를 data/store/staging/id-map.json(엔진이 읽는 위치)이나 --out 경로에 쓴다
//
//   node airtable/clone-staging.mjs --dry-run                 가상 시드로 계획만 출력, 매핑표는 out/staging/id-map.json
//   node airtable/clone-staging.mjs --dry-run --out <파일>
//   AIRTABLE_TOKEN=pat… node airtable/clone-staging.mjs --base fire --staging-base-id app… --apply --out data/store/staging/id-map.json
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadDataset } from './lib/dataset.js';
import { OUT_DIR, rel } from './lib/paths.js';
import { loadModel } from './lib/schema.js';
import { applyStaging, idMapFrom, planBaseStaging, renderStagingPlan } from './lib/staging.js';

const HELP = '사용: node airtable/clone-staging.mjs [--base hub|fire|telecom|mechanical|all] [--dry-run | --apply --staging-base-id app…] [--out id-map.json]';

export function parseArgs(argv) {
  const args = { base: 'all', apply: false, out: path.join(OUT_DIR, 'staging', 'id-map.json'), stagingBaseId: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--base') args.base = argv[++i];
    else if (a === '--staging-base-id') args.stagingBaseId = argv[++i];
    else if (a === '--out') args.out = path.resolve(argv[++i]);
    else if (a === '--apply') args.apply = true;
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--help' || a === '-h') args.help = true;
    else throw new Error(`알 수 없는 옵션: ${a}`);
  }
  if (args.apply && args.dryRun) throw new Error('--apply와 --dry-run은 함께 쓸 수 없습니다.');
  return args;
}

/** 이미 있는 매핑표에 합친다(Base를 하나씩 실행해도 한 파일에 모이게). */
function mergeIdMap(file, next) {
  let prev = { tables: {}, created: {} };
  if (fs.existsSync(file)) prev = JSON.parse(fs.readFileSync(file, 'utf8'));
  const tables = { ...(prev.tables ?? {}) };
  for (const [t, m] of Object.entries(next.tables)) tables[t] = { ...(tables[t] ?? {}), ...m };
  return { tables, created: prev.created ?? {} };
}

export async function main(argv = process.argv.slice(2), { env = process.env, fetchImpl = globalThis.fetch, log = console.log, delayMs } = {}) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (e) {
    log(`${e.message}\n${HELP}`);
    return 2;
  }
  if (args.help) {
    log(HELP);
    return 0;
  }
  const model = loadModel();
  const bases = args.base === 'all' ? model.bases : model.bases.filter((b) => b.key === args.base);
  if (!bases.length) {
    log(`없는 Base: ${args.base}`);
    return 2;
  }

  let plans;
  if (!args.apply) {
    // dry-run: 가상 시드를 "복제 직후 스테이징 Base의 레코드"로 보고 계획을 만든다
    const { rows } = await loadDataset(model);
    plans = bases.map((b) => planBaseStaging(b, new Map([...rows.get(b.key)].map(([k, list]) => [k, list.map((fields, i) => ({ recId: `rec${b.key}${i}`, fields }))]))));
    log('[dry-run] 스테이징 ID 변경 계획 — 아무것도 보내지 않습니다(가상 시드 기준).');
  } else {
    if (bases.length !== 1) {
      log('--apply는 Base 하나씩 실행합니다: --base hub|fire|telecom|mechanical');
      return 2;
    }
    try {
      const r = await applyStaging(bases[0], { baseId: args.stagingBaseId, token: env.AIRTABLE_TOKEN, fetchImpl, ...(delayMs !== undefined ? { delayMs } : {}) });
      log(`반영: ${r.patched}건 수정`);
      plans = [r];
    } catch (e) {
      log(`실패: ${e.message}`);
      return 1;
    }
  }
  for (const p of plans) log(renderStagingPlan(p));
  // 실제 실행은 Base를 하나씩 하므로 기존 매핑표에 합치고, dry-run은 매번 새로 쓴다
  const idMap = args.apply ? mergeIdMap(args.out, idMapFrom(plans)) : idMapFrom(plans);
  fs.mkdirSync(path.dirname(args.out), { recursive: true });
  fs.writeFileSync(args.out, `${JSON.stringify(idMap, null, 2)}\n`, 'utf8');
  const size = Object.values(idMap.tables).reduce((n, m) => n + Object.keys(m).length, 0);
  log(`매핑표 → ${rel(args.out)} (테이블 ${Object.keys(idMap.tables).length} · ID ${size}개, 견적 엔진 6-1 형식 {tables, created})`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}
