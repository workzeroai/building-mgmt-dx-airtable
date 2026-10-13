// 실행 환경 조립: 환경변수 → 저장소·가드·단가·양식·PDF 큐·알림·공공 API 클라이언트·엔진.
// 서버(server.js)와 데모 CLI(scripts/demo.js)가 같은 조립을 쓴다.
import path from 'node:path';
import { DIVISIONS_DIR, OUT_DIR, PRICING_DIR, REPO_ROOT, SCHEMA_DIR, STORE_DIR } from './core/paths.js';
import { loadDivisions } from './core/registry.js';
import { loadSchemas } from './core/store/schema.js';
import { createLocalAdapter } from './core/store/local.js';
import { createAirtableAdapter } from './core/store/airtable.js';
import { basesFromEnv, createMultiBaseAirtableAdapter } from './core/store/airtable-multi.js';
import { loadIdMap, withStagingGuard } from './core/store/guard.js';
import { seedLocalStore, syncDivisions, syncPricing } from './core/store/seed.js';
import { createPricingService } from './core/pricing.js';
import { createTemplateService } from './core/templates.js';
import { createCircuitBreaker } from './core/circuit-breaker.js';
import { createPdfQueue } from './core/pdf-queue.js';
import { createSofficeConverter, findSoffice } from './core/soffice.js';
import { createLlmFromEnv, createNotifier } from './core/notify.js';
import { createBuildingClient } from './core/building-client.js';
import { createQuoteEngine } from './core/pipeline.js';

const quietLogger = { info() {}, warn() {}, error() {} };

/**
 * @param {object} [options] 테스트에서 경로·변환기·fetch·시계를 바꿔 끼운다.
 */
export async function createContext(options = {}) {
  const {
    env = process.env,
    storeDir = STORE_DIR,
    outDir = OUT_DIR,
    divisionsDir = DIVISIONS_DIR,
    pricingDir = PRICING_DIR,
    schemaDir = SCHEMA_DIR,
    seedDir,
    converter,
    fetchImpl = globalThis.fetch,
    logger = console,
    quiet = false,
  } = options;
  const log = quiet ? quietLogger : logger;
  const target = options.target ?? (env.STORE_TARGET === 'staging' ? 'staging' : 'production');
  const schemas = loadSchemas(schemaDir);
  const registry = await loadDivisions(divisionsDir);
  const idNamespace = target === 'staging' ? 'stg_' : '';

  let base;
  if ((options.adapter ?? env.STORE_ADAPTER) === 'airtable') {
    // 허브 Base ID가 있으면 허브 + 사업부 Base 구성(airtable/ 설계), 없으면 Base 하나에 7개 테이블
    const bases = basesFromEnv(env, registry.ids());
    base = bases
      ? createMultiBaseAirtableAdapter({ token: env.AIRTABLE_TOKEN, bases, schemas, fetchImpl, idNamespace })
      : createAirtableAdapter({ token: env.AIRTABLE_TOKEN, baseId: env.AIRTABLE_BASE_ID, schemas, fetchImpl, idNamespace });
  } else {
    await seedLocalStore({ storeDir, target, schemas, registry, pricingDir, ...(seedDir ? { seedDir } : {}) });
    base = createLocalAdapter({ dir: path.join(storeDir, target), schemas, idNamespace });
  }
  // 운영 대상에서도 매핑표를 읽어 둔다: 스테이징 ID가 운영 쓰기에 섞이는 것을 막기 위해.
  const idMap = await loadIdMap(path.join(storeDir, 'staging', 'id-map.json'));
  const store = withStagingGuard(base, { target, idMap, schemas });

  const notifier = createNotifier({
    webhookUrl: env.ERROR_WEBHOOK_URL ?? '',
    fetchImpl,
    llm: options.llm !== undefined ? options.llm : await createLlmFromEnv(env),
    logger: log,
  });
  const breaker = createCircuitBreaker({
    name: 'pdf',
    failureThreshold: Number(env.PDF_BREAKER_THRESHOLD ?? 3),
    cooldownMs: Number(env.PDF_BREAKER_COOLDOWN_MS ?? 60_000),
    onStateChange: (e) => {
      const level = e.to === 'open' ? 'danger' : e.to === 'closed' ? 'success' : 'info';
      notifier.notifyEvent(`PDF 서킷브레이커 ${e.from} → ${e.to}`, `${e.reason}${e.retryAt ? ` · 재시도 ${new Date(e.retryAt).toISOString()}` : ''}`, level);
    },
  });
  const pdfQueue = createPdfQueue({
    converter: converter ?? createSofficeConverter({ sofficePath: findSoffice({ env }) }),
    timeoutMs: Number(env.PDF_TIMEOUT_MS ?? 90_000),
    breaker,
    logger: log,
  });

  const pricing = createPricingService({ store, registry, bundledDir: pricingDir, logger: log });
  const targetDir = path.join(storeDir, target);
  const templates = createTemplateService({ store, registry, pricing, filesDir: path.join(targetDir, 'templates'), baseDir: targetDir });

  await syncDivisions(store, registry);
  await syncPricing(store, registry, pricingDir);
  await templates.ensureDefaults();

  const buildingClient = createBuildingClient({
    mode: env.DEMO_MODE === 'live' ? 'live' : 'fake',
    jusoKey: env.JUSO_API_KEY,
    registerKey: env.BUILDING_REGISTER_API_KEY,
    fetchImpl,
  });
  const engine = createQuoteEngine({ registry, buildingClient, pricing, templates, pdfQueue, store, outDir, repoRoot: REPO_ROOT });

  return { env, target, schemas, registry, store, idMap, pricing, templates, pdfQueue, notifier, buildingClient, engine, outDir, logger: log };
}
