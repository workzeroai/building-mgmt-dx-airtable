// 스키마 YAML → 에어테이블 Base에 테이블·필드·연결 생성(Meta API).
//
//   node airtable/create-base.mjs --dry-run                 4개 Base 요청을 출력만(기본값, 토큰 불필요)
//   node airtable/create-base.mjs --base fire --dry-run     한 Base만
//   node airtable/create-base.mjs --base hub --json         요청 계획을 JSON으로
//   AIRTABLE_TOKEN=pat… node airtable/create-base.mjs --base hub --base-id app… --apply
//       빈 Base에 실제로 만든다. PAT 권한: schema.bases:read, schema.bases:write (해당 Base만)
//
// 이미 있는 테이블·필드는 건너뛰므로 다시 실행해도 안전하다. 수식·룩업·롤업·개수 필드는 API로 만들 수 없어
// 마지막에 "수동 추가" 목록을 출력한다(docs/schema.md에도 같은 목록).
import { pathToFileURL } from 'node:url';
import { applyPlan, planBase, renderPlan } from './lib/meta-api.js';
import { checkContracts } from './lib/contract.js';
import { loadModel, validateModel } from './lib/schema.js';

export function parseArgs(argv) {
  const args = { base: 'all', dryRun: true, apply: false, json: false, baseId: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--base') args.base = argv[++i];
    else if (a === '--base-id') args.baseId = argv[++i];
    else if (a === '--apply') {
      args.apply = true;
      args.dryRun = false;
    } else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--json') args.json = true;
    else if (a === '--help' || a === '-h') args.help = true;
    else throw new Error(`알 수 없는 옵션: ${a}`);
  }
  if (args.apply && args.dryRun && argv.includes('--dry-run')) throw new Error('--apply와 --dry-run은 함께 쓸 수 없습니다.');
  return args;
}

const HELP = `사용: node airtable/create-base.mjs [--base hub|fire|telecom|mechanical|all] [--dry-run | --apply --base-id app…] [--json]`;

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
  const problems = [...validateModel(model), ...checkContracts(model)];
  if (problems.length) {
    log(`스키마 검사 실패 — 요청을 만들지 않습니다:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    return 1;
  }
  const bases = args.base === 'all' ? model.bases : model.bases.filter((b) => b.key === args.base);
  if (bases.length === 0) {
    log(`없는 Base: ${args.base} (가능: ${model.bases.map((b) => b.key).join(', ')}, all)`);
    return 2;
  }
  const plans = bases.map((b) => planBase(model, b));

  if (!args.apply) {
    if (args.json) {
      log(JSON.stringify(plans.map((p) => ({ base: p.base.key, name: p.base.name, steps: p.steps, manual: p.manual })), null, 2));
      return 0;
    }
    log('[dry-run] 에어테이블 Meta API 요청 계획 — 아무것도 보내지 않습니다. {baseId}·{tableId:…}는 실행할 때 실제 ID로 바뀝니다.');
    for (const p of plans) log(`\n${renderPlan(p)}`);
    const total = plans.reduce((n, p) => n + p.steps.length, 0);
    log(`\n합계: Base ${plans.length} · 요청 ${total}건 · 수동 추가 ${plans.reduce((n, p) => n + p.manual.length, 0)}건. 실제로 만들려면 --base <키> --base-id app… --apply (AIRTABLE_TOKEN 필요)`);
    return 0;
  }

  if (plans.length !== 1) {
    log('--apply는 Base 하나씩 실행합니다: --base hub|fire|telecom|mechanical');
    return 2;
  }
  try {
    const r = await applyPlan(plans[0], { baseId: args.baseId, token: env.AIRTABLE_TOKEN, fetchImpl, log, ...(delayMs !== undefined ? { delayMs } : {}) });
    log(`완료: 테이블 ${r.createdTables} · 필드 ${r.createdFields} · 연결 ${r.createdLinks} · 역방향 이름 ${r.renamed} · 건너뜀 ${r.skipped} · 수동 추가 남음 ${r.manual}`);
    for (const m of plans[0].manual) log(`  수동: ${m.table}.${m.field} (${m.type}) ${m.definition}`);
    return 0;
  } catch (e) {
    log(`실패: ${e.message}`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}
