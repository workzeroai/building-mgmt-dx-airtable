// n8n Code 노드 "반영 계획" (Run Once for All Items)
// 입력: "허브 원본 조회"·"사본 조회"(REST 응답 페이지들), "직전 동기화 기록 조회"(최근 정상 실행 1건)
// 출력:
//   - 원본 급감이면 {kind: 'abort'} 1건 → 반영하지 않고 중단 기록·알림
//   - 아니면 쓸 건마다 {kind: create|update|missing, body} + 마지막에 {kind: 'marker'}(변경 없음·건너뜀 집계, 결과 요약이 항상 돌게)
// 판정 코드(checkVolume·planSync)는 Airtable 스크립트(sync-safety.js)와 같은 lib/sync-core.js다.

// ---- BEGIN GENERATED: config (npm run airtable:build) ----
const SYNC = {
  "direction": "hub-to-division",
  "key": "id",
  "order": [
    "customers",
    "buildings",
    "staff"
  ],
  "maxDropRatio": 0.3,
  "batchSize": 50,
  "onMissing": "mark"
};
const RULES = {
  "customers": {
    "key": "customers",
    "name": "고객",
    "sourceName": "고객",
    "fields": [
      "id",
      "name",
      "type",
      "region"
    ],
    "required": [
      "id",
      "name",
      "type"
    ],
    "idPattern": "^(stg_)?cus_[0-9a-z]+$",
    "kinds": {
      "id": "string",
      "name": "string",
      "type": "select",
      "region": "select"
    },
    "choices": {
      "type": [
        "법인",
        "관리단",
        "관리사무소",
        "개인사업자"
      ],
      "region": [
        "서울특별시",
        "부산광역시",
        "대구광역시",
        "인천광역시",
        "대전광역시",
        "경기도"
      ]
    },
    "links": {}
  },
  "buildings": {
    "key": "buildings",
    "name": "건물",
    "sourceName": "건물",
    "fields": [
      "id",
      "customerId",
      "roadAddress",
      "name",
      "mainPurpose",
      "totalArea",
      "groundFloors",
      "undergroundFloors"
    ],
    "required": [
      "id",
      "roadAddress",
      "name",
      "mainPurpose",
      "totalArea",
      "groundFloors",
      "undergroundFloors"
    ],
    "idPattern": "^(stg_)?bld_[0-9a-z]+$",
    "kinds": {
      "id": "string",
      "customerId": "string",
      "roadAddress": "string",
      "name": "string",
      "mainPurpose": "string",
      "totalArea": "number",
      "groundFloors": "integer",
      "undergroundFloors": "integer"
    },
    "choices": {},
    "links": {
      "customer": {
        "from": "customerId",
        "table": "customers"
      }
    }
  },
  "staff": {
    "key": "staff",
    "name": "담당자",
    "sourceName": "담당자",
    "fields": [
      "id",
      "name",
      "divisionId",
      "role",
      "active"
    ],
    "required": [
      "id",
      "name",
      "role",
      "active"
    ],
    "idPattern": "^(stg_)?stf_[0-9a-z]+$",
    "kinds": {
      "id": "string",
      "name": "string",
      "divisionId": "string",
      "role": "select",
      "active": "boolean"
    },
    "choices": {
      "role": [
        "점검원",
        "영업",
        "관리자"
      ]
    },
    "links": {}
  }
};
// ---- END GENERATED: config ----

// ---- BEGIN GENERATED: lib/sync-core.js ----
// 허브 → 사업부 동기화 판정(순수 함수). import 없이 이 파일만으로 동작해야 한다.
// 빌드(npm run airtable:build)가 이 코드를 Airtable 스크립트(sync-safety.js)와 n8n Code 노드에 그대로 넣는다.
// → 같은 입력이면 두 실행 환경이 같은 판정을 낸다(테스트로 확인).

/** 원본 건수 급감 검사: 직전 정상 실행 대비 maxDropRatio 넘게 줄면 반영을 멈춘다. */
function checkVolume({ current, previous, maxDropRatio }) {
  if (previous === null || previous === undefined) {
    return { verdict: 'proceed', current, previous: null, dropRatio: null, reason: '첫 동기화(비교 기준 없음)' };
  }
  if (previous > 0 && current === 0) {
    return { verdict: 'abort', current, previous, dropRatio: 1, reason: `원본 0건(직전 ${previous}건): 원본 조회 오류로 보고 반영 중단` };
  }
  const dropRatio = previous > 0 ? Math.max(0, (previous - current) / previous) : 0;
  const pct = (x) => `${Math.round(x * 1000) / 10}%`;
  if (dropRatio > maxDropRatio) {
    return { verdict: 'abort', current, previous, dropRatio, reason: `원본 ${previous}→${current}건(${pct(dropRatio)} 감소, 기준 ${pct(maxDropRatio)}): 반영 중단` };
  }
  return { verdict: 'proceed', current, previous, dropRatio, reason: `원본 ${previous}→${current}건(감소 ${pct(dropRatio)}, 기준 ${pct(maxDropRatio)} 이내)` };
}

/** 원본 값(REST 응답의 fields 등)을 규칙의 필드 목록·종류에 맞춰 정리한다. 없으면 null, 체크박스 없음은 false. */
function normalizeSource(rule, fields) {
  const out = {};
  for (const name of rule.fields) {
    let v = fields ? fields[name] : undefined;
    if (v && typeof v === 'object' && !Array.isArray(v) && 'name' in v) v = v.name; // 단일 선택 셀 {name}
    if (v === undefined || v === '') v = null;
    if (rule.kinds[name] === 'boolean') v = v === true;
    out[name] = v;
  }
  return out;
}

/** 원본 레코드 1건 검증. @returns {{ok: true} | {ok: false, reason: string}} */
function validateSourceRecord(rule, record) {
  const id = record ? record.id : null;
  if (typeof id !== 'string' || !new RegExp(rule.idPattern, 'u').test(id)) {
    return { ok: false, reason: `id 형식 오류(${id === null || id === undefined ? '없음' : JSON.stringify(id)})` };
  }
  for (const name of rule.required) {
    if (record[name] === null || record[name] === undefined) return { ok: false, reason: `필수 값 없음: ${name}` };
  }
  for (const name of rule.fields) {
    const v = record[name];
    if (v === null || v === undefined) continue;
    const kind = rule.kinds[name];
    if ((kind === 'number' || kind === 'integer') && (typeof v !== 'number' || !Number.isFinite(v))) return { ok: false, reason: `숫자가 아님: ${name}` };
    if (kind === 'integer' && !Number.isInteger(v)) return { ok: false, reason: `정수가 아님: ${name}` };
    if (kind === 'number' && v < 0) return { ok: false, reason: `음수: ${name}` };
    if (kind === 'select' && !(rule.choices[name] || []).includes(v)) return { ok: false, reason: `허용되지 않은 선택지: ${name}=${v}` };
    if (kind === 'string' && typeof v !== 'string') return { ok: false, reason: `문자열이 아님: ${name}` };
  }
  return { ok: true };
}

/** 변경 감지용 지문(FNV-1a 32비트). 실행 환경(Airtable·n8n·Node)과 무관하게 같은 값. */
function recordHash(rule, record) {
  const text = JSON.stringify(rule.fields.map((name) => (record[name] === undefined ? null : record[name])));
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/**
 * 반영 계획. 실제 쓰기는 실행 환경(스크립트·n8n)이 하고, 여기서는 무엇을 할지만 정한다.
 * @param {object} p
 * @param {object} p.rule syncRules().tables[key]
 * @param {Array<object>} p.source 원본 레코드(평평한 객체, normalizeSource 전이어도 됨)
 * @param {Array<{recId: string, fields: object}>} p.target 사본 레코드
 * @returns {{create: object[], update: object[], unchanged: string[], skipped: {id: any, reason: string}[], missing: object[]}}
 */
function planSync({ rule, source, target }) {
  const plan = { create: [], update: [], unchanged: [], skipped: [], missing: [] };
  const byId = new Map();
  for (const t of target) {
    const id = t.fields ? t.fields.id : null;
    if (id) byId.set(id, t);
  }
  const seen = new Set();
  for (const raw of source) {
    const record = normalizeSource(rule, raw);
    const check = validateSourceRecord(rule, record);
    if (!check.ok) {
      plan.skipped.push({ id: record.id, reason: check.reason });
      continue;
    }
    if (seen.has(record.id)) {
      plan.skipped.push({ id: record.id, reason: '원본에 같은 id가 두 번 있음(두 번째 건 건너뜀)' });
      continue;
    }
    seen.add(record.id);
    const hash = recordHash(rule, record);
    const existing = byId.get(record.id);
    if (!existing) plan.create.push({ id: record.id, fields: record, hash });
    else if (existing.fields.syncHash !== hash || existing.fields.hubMissing === true) {
      plan.update.push({ id: record.id, recId: existing.recId, fields: record, hash });
    } else plan.unchanged.push(record.id);
  }
  for (const [id, t] of byId) {
    if (!seen.has(id) && t.fields.hubMissing !== true && !plan.skipped.some((s) => s.id === id)) plan.missing.push({ id, recId: t.recId });
  }
  return plan;
}

/** 실행 결과 → 상태. aborted > (건너뜀·실패가 있으면) partial > ok */
function summarizeRun({ aborted = false, created = 0, updated = 0, unchanged = 0, skipped = 0, failed = 0, missing = 0 }) {
  const status = aborted ? 'aborted' : skipped > 0 || failed > 0 ? 'partial' : 'ok';
  const parts = [`생성 ${created}`, `수정 ${updated}`, `변경 없음 ${unchanged}`, `건너뜀 ${skipped}`, `실패 ${failed}`, `사라짐 표시 ${missing}`];
  return { status, created, updated, unchanged, skipped, failed, missing, text: aborted ? '반영 중단' : parts.join(' · ') };
}

/** 배열을 n개씩 자른다(에어테이블 쓰기 한도: 스크립트 50건, REST 10건). */
function chunk(list, n) {
  const out = [];
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
  return out;
}
// ---- END GENERATED: lib/sync-core.js ----

const cfg = $('동기화 설정').first().json;
const rule = RULES[cfg.tableKey];
const records = (node) => $(node).all().flatMap((page) => (page.json && page.json.records) || []);

const source = records('허브 원본 조회').map((r) => r.fields || {});
const target = records('사본 조회').map((r) => ({
  recId: r.id,
  fields: { id: (r.fields || {}).id || null, syncHash: (r.fields || {}).syncHash || '', hubMissing: (r.fields || {}).hubMissing === true },
}));
let previous = null;
const runs = records('직전 동기화 기록 조회');
if (runs.length && typeof runs[0].fields.sourceCount === 'number') previous = runs[0].fields.sourceCount;

const volume = checkVolume({ current: source.length, previous, maxDropRatio: SYNC.maxDropRatio });
const now = new Date().toISOString();
const runFields = (extra) => ({
  id: `syn_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
  divisionId: cfg.divisionId, runner: 'n8n', tableKey: cfg.tableKey, startedAt: cfg.startedAt, finishedAt: now,
  sourceCount: source.length, previousCount: previous, ...extra,
});

if (volume.verdict === 'abort') {
  return [{
    json: {
      kind: 'abort',
      volume,
      runBody: { records: [{ fields: runFields({ created: 0, updated: 0, unchanged: 0, skipped: 0, failed: 0, missing: 0, status: 'aborted', note: volume.reason }) }], typecast: true },
      errorBody: {
        records: [{ fields: { id: `err_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, automation: 'n8n:syncSafety', stage: 'aborted', tableName: rule.name, message: volume.reason, occurredAt: now, notified: false } }],
        typecast: true,
      },
      alertText: `[${cfg.label}] ${rule.name} 동기화 중단 — ${volume.reason}`,
    },
  }];
}

const plan = planSync({ rule, source, target });
const cells = (x) => ({ ...x.fields, syncHash: x.hash, syncedAt: now, hubMissing: false });
const upsert = (x) => ({ performUpsert: { fieldsToMergeOn: ['id'] }, records: [{ fields: cells(x) }], typecast: true });
const out = [
  ...plan.create.map((x) => ({ json: { kind: 'create', id: x.id, body: upsert(x) } })),
  ...plan.update.map((x) => ({ json: { kind: 'update', id: x.id, body: { records: [{ id: x.recId, fields: cells(x) }], typecast: true } } })),
  ...plan.missing.map((x) => ({ json: { kind: 'missing', id: x.id, body: { records: [{ id: x.recId, fields: { hubMissing: true, syncedAt: now } }] } } })),
];
out.push({ json: { kind: 'marker', volume, unchanged: plan.unchanged.length, skipped: plan.skipped, runFields: runFields({}) } });
return out;
