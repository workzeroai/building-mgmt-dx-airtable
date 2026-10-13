// [에어테이블 자동화 스크립트] 허브 → 사업부 동기화 안전장치 — 그리드웰 빌딩서비스(가상) 사업부 Base
//
// 트리거: 일정(예: 매시 정각) 또는 버튼
// 입력 변수(input.config):
//   divisionId = 이 Base의 사업부 ID(fire 등)
//   hubBaseId  = 허브 Base ID
//   hubToken   = 허브 읽기 전용 PAT(data.records:read, 허브 Base만). 스크립트에 적지 말고 입력 변수로 넣는다
// 동작(테이블마다: 고객 → 건물 → 담당자 순서):
//   1) 허브 원본을 REST API로 모두 읽는다(페이지 넘김)
//   2) 직전 정상 실행(ok·partial)의 원본 건수와 비교해 기준(maxDropRatio) 넘게 줄었으면 이 테이블은 반영하지 않는다
//      (원본 쪽 필터·권한·삭제 사고가 사본까지 번지지 않게)
//   3) 건마다 검증 → 통과한 건만 생성·수정. 묶음 쓰기가 실패하면 한 건씩 다시 써서 실패한 건만 건너뛴다
//   4) 허브에서 사라진 건은 지우지 않고 hubMissing만 표시한다
//   5) 결과를 동기화 기록에, 건너뜀·실패·중단을 자동화 오류에 남긴다(오류 알림 스크립트가 모아 보냄)
// 판정 로직(lib/sync-core.js)은 n8n 워크플로(n8n/sync-safety.json)의 Code 노드와 같은 코드다.

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

const AUTOMATION = 'syncSafety';
const MAX_ERROR_ROWS = 20; // 한 테이블에서 자동화 오류에 남기는 최대 건수(나머지는 요약 1건)
const newId = (prefix) => `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

async function fetchHub(hubBaseId, token, rule) {
  const rows = [];
  let offset = null;
  do {
    const query = ['pageSize=100', ...rule.fields.map((f) => `${encodeURIComponent('fields[]')}=${encodeURIComponent(f)}`)];
    if (offset) query.push(`offset=${encodeURIComponent(offset)}`);
    const res = await fetch(`https://api.airtable.com/v0/${hubBaseId}/${encodeURIComponent(rule.sourceName)}?${query.join('&')}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`허브 ${rule.sourceName} 조회 실패 HTTP ${res.status}`);
    const body = await res.json();
    for (const r of body.records) rows.push(r.fields);
    offset = body.offset || null;
  } while (offset);
  return rows;
}

async function previousCount(runsTable, key) {
  const q = await runsTable.selectRecordsAsync({
    fields: ['tableKey', 'status', 'sourceCount', 'startedAt'],
    sorts: [{ field: 'startedAt', direction: 'desc' }],
  });
  const prev = q.records.find((r) => r.getCellValueAsString('tableKey') === key && ['ok', 'partial'].includes(r.getCellValueAsString('status')));
  return prev ? prev.getCellValue('sourceCount') : null;
}

/** 평평한 값 → 에어테이블 셀 값(단일 선택은 {name}). */
function toCells(rule, record) {
  const out = {};
  for (const name of rule.fields) {
    const v = record[name];
    out[name] = rule.kinds[name] === 'select' ? (v === null ? null : { name: v }) : v;
  }
  return out;
}

/** 묶음으로 쓰고, 묶음이 실패하면 한 건씩 다시 쓴다. @returns {{ok: number, failures: {id, reason}[]}} */
async function writeAll(table, mode, items, batchSize) {
  let ok = 0;
  const failures = [];
  const writeOne = (x) => (mode === 'create' ? table.createRecordAsync(x.cells) : table.updateRecordAsync(x.recId, x.cells));
  for (const batch of chunk(items, batchSize)) {
    try {
      if (mode === 'create') await table.createRecordsAsync(batch.map((x) => ({ fields: x.cells })));
      else await table.updateRecordsAsync(batch.map((x) => ({ id: x.recId, fields: x.cells })));
      ok += batch.length;
    } catch {
      // 한 건 때문에 묶음 전체가 실패할 수 있다 → 한 건씩 다시 써서 실패한 건만 건너뛴다
      for (const x of batch) {
        try {
          await writeOne(x);
          ok += 1;
        } catch (e) {
          failures.push({ id: x.id, reason: e.message || String(e) });
        }
      }
    }
  }
  return { ok, failures };
}

async function idIndex(tableName) {
  const q = await base.getTable(tableName).selectRecordsAsync({ fields: ['id'] });
  return new Map(q.records.map((r) => [r.getCellValueAsString('id'), r.id]));
}

async function syncTable(cfg, key, startedAt) {
  const rule = RULES[key];
  const table = base.getTable(rule.name);
  const runs = base.getTable('동기화 기록');
  const errors = base.getTable('자동화 오류');
  const source = await fetchHub(cfg.hubBaseId, cfg.hubToken, rule);
  const previous = await previousCount(runs, key);
  const volume = checkVolume({ current: source.length, previous, maxDropRatio: SYNC.maxDropRatio });
  const errorRows = [];
  const pushError = (stage, recordId, message) => errorRows.push({
    id: newId('err'), automation: AUTOMATION, stage: { name: stage }, tableName: rule.name, recordId, message,
    occurredAt: new Date().toISOString(), notified: false,
  });

  let summary;
  if (volume.verdict === 'abort') {
    pushError('aborted', null, volume.reason);
    summary = summarizeRun({ aborted: true });
  } else {
    const q = await table.selectRecordsAsync({ fields: ['id', 'syncHash', 'hubMissing'] });
    const target = q.records.map((r) => ({ recId: r.id, fields: { id: r.getCellValueAsString('id'), syncHash: r.getCellValueAsString('syncHash'), hubMissing: r.getCellValue('hubMissing') === true } }));
    const plan = planSync({ rule, source, target });
    const now = new Date().toISOString();
    const linkMaps = {};
    for (const [field, link] of Object.entries(rule.links)) linkMaps[field] = { from: link.from, map: await idIndex(RULES[link.table] ? RULES[link.table].name : link.table) };
    const cellsOf = (item) => {
      const cells = { ...toCells(rule, item.fields), syncHash: item.hash, syncedAt: now, hubMissing: false };
      for (const [field, { from, map }] of Object.entries(linkMaps)) {
        const recId = item.fields[from] ? map.get(item.fields[from]) : null;
        cells[field] = recId ? [{ id: recId }] : [];
      }
      return cells;
    };
    const created = await writeAll(table, 'create', plan.create.map((x) => ({ id: x.id, cells: cellsOf(x) })), SYNC.batchSize);
    const updated = await writeAll(table, 'update', plan.update.map((x) => ({ id: x.id, recId: x.recId, cells: cellsOf(x) })), SYNC.batchSize);
    const missing = await writeAll(table, 'update', plan.missing.map((x) => ({ id: x.id, recId: x.recId, cells: { hubMissing: true, syncedAt: now } })), SYNC.batchSize);
    const failures = [...created.failures, ...updated.failures, ...missing.failures];
    for (const s of plan.skipped) pushError('skipped', s.id === null || s.id === undefined ? null : String(s.id), s.reason);
    for (const f of failures) pushError('failed', f.id, f.reason);
    summary = summarizeRun({
      created: created.ok, updated: updated.ok, unchanged: plan.unchanged.length,
      skipped: plan.skipped.length, failed: failures.length, missing: missing.ok,
    });
  }

  await runs.createRecordAsync({
    id: newId('syn'), divisionId: cfg.divisionId, runner: { name: 'airtable-script' }, tableKey: key,
    startedAt, finishedAt: new Date().toISOString(), sourceCount: source.length, previousCount: previous,
    created: summary.created, updated: summary.updated, unchanged: summary.unchanged, skipped: summary.skipped,
    failed: summary.failed, missing: summary.missing, status: { name: summary.status },
    note: volume.verdict === 'abort' ? volume.reason : `${volume.reason} · ${summary.text}`,
  });
  if (errorRows.length > MAX_ERROR_ROWS) {
    const rest = errorRows.length - MAX_ERROR_ROWS;
    errorRows.length = MAX_ERROR_ROWS;
    errorRows.push({ ...errorRows[0], id: newId('err'), recordId: null, message: `외 ${rest}건(동기화 기록 참고)` });
  }
  for (const batch of chunk(errorRows, SYNC.batchSize)) await errors.createRecordsAsync(batch.map((fields) => ({ fields })));
  return { key, volume: volume.verdict, ...summary };
}

const cfg = input.config();
if (!cfg.hubBaseId || !cfg.hubToken || !cfg.divisionId) throw new Error('입력 변수 divisionId·hubBaseId·hubToken이 필요합니다.');
const startedAt = new Date().toISOString();
const results = [];
for (const key of SYNC.order) {
  try {
    results.push(await syncTable(cfg, key, startedAt));
  } catch (e) {
    // 원본 조회 실패 등: 이 테이블은 건드리지 않고 다음 테이블로
    await base.getTable('자동화 오류').createRecordAsync({
      id: newId('err'), automation: AUTOMATION, stage: { name: 'error' }, tableName: RULES[key].name, recordId: null,
      message: e.message || String(e), occurredAt: new Date().toISOString(), notified: false,
    });
    results.push({ key, volume: 'error', status: 'error', text: e.message });
  }
}
for (const r of results) console.log(`${r.key}: ${r.status} — ${r.text}`);
output.set('results', results);
output.set('status', results.every((r) => r.status === 'ok') ? 'ok' : results.some((r) => r.status === 'ok' || r.status === 'partial') ? 'partial' : 'failed');
