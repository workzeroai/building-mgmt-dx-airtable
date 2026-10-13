// [에어테이블 자동화 스크립트] 중복 감지 — 그리드웰 빌딩서비스(가상) 허브 Base
//
// 트리거: 고객·건물 레코드가 만들어지거나 businessNo·roadAddress가 바뀔 때
// 입력 변수(input.config): tableName = '고객' 또는 '건물', recordId = 트리거 레코드 ID
// 동작:
//   - 고객은 사업자등록번호(숫자만), 건물은 정규화한 도로명주소(시도 정식 명칭·층/호 제거·공백 제거)로 비교한다
//   - 같은 키를 가진 레코드를 dupCandidates에 서로 연결하고 dupStatus를 '후보 있음'으로 둔다
//   - 자동 병합·삭제는 하지 않는다. 사람이 확인하고 '검토 완료'로 바꾸면 같은 후보로는 다시 띄우지 않는다
//   - 건물은 계산한 주소 키를 addressKey에 남긴다(뷰에서 그룹으로 보기 좋게)

// ---- BEGIN GENERATED: config (npm run airtable:build) ----
const KINDS = {
  "고객": "customers",
  "건물": "buildings"
};
// ---- END GENERATED: config ----

// ---- BEGIN GENERATED: lib/dedupe.js ----
// 중복 감지 키(순수 함수). 빌드가 duplicate-detect.js에 그대로 넣는다.
// 주소 정규화 규칙은 견적 엔진(quote-engine/src/core/normalize.js)과 같아야 한다(테스트로 대조).

const SIDO_ALIASES = {
  서울: '서울특별시', 서울시: '서울특별시',
  부산: '부산광역시', 부산시: '부산광역시',
  대구: '대구광역시', 대구시: '대구광역시',
  인천: '인천광역시', 인천시: '인천광역시',
  광주: '광주광역시', 광주시: '광주광역시',
  대전: '대전광역시', 대전시: '대전광역시',
  울산: '울산광역시', 울산시: '울산광역시',
  세종: '세종특별자치시', 세종시: '세종특별자치시',
  경기: '경기도',
  강원: '강원특별자치도', 강원도: '강원특별자치도',
  충북: '충청북도', 충남: '충청남도',
  전북: '전북특별자치도', 전라북도: '전북특별자치도', 전남: '전라남도',
  경북: '경상북도', 경남: '경상남도',
  제주: '제주특별자치도', 제주도: '제주특별자치도',
};

const DETAIL_PATTERNS = [
  /\s+(지하\s*)?\d+\s*층.*$/u,
  /\s+\d+\s*호.*$/u,
  /\s+[A-Za-z]?\d+\s*동(\s+\d+.*)?$/u,
];

/** 주소 → 비교 키(시도 정식 명칭, 괄호·쉼표·층·호 제거, 공백 제거). 빈 값이면 null. */
function addressKeyOf(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  let s = raw.normalize('NFC');
  s = s.replace(/\([^)]*\)/gu, ' ');
  s = s.replace(/[,·]/gu, ' ');
  s = s.replace(/\s+/gu, ' ').trim();
  for (const pattern of DETAIL_PATTERNS) s = s.replace(pattern, '');
  s = s.replace(/(\d+)\s*번지$/u, '$1');
  const tokens = s.split(' ');
  if (SIDO_ALIASES[tokens[0]]) tokens[0] = SIDO_ALIASES[tokens[0]];
  return tokens.join(' ').replace(/\s+/gu, '');
}

/** 사업자등록번호 → 숫자 10자리. 형식이 아니면 null. */
function businessNoKey(raw) {
  const digits = String(raw || '').replace(/\D/gu, '');
  return digits.length === 10 ? digits : null;
}

/** 레코드의 비교 키 목록. kind: customers(사업자번호) | buildings(주소). */
function duplicateKeys(kind, record) {
  if (kind === 'customers') {
    const k = businessNoKey(record.businessNo);
    return k ? [`biz:${k}`] : [];
  }
  const k = addressKeyOf(record.roadAddress);
  return k ? [`addr:${k}`] : [];
}

/**
 * 대상 레코드와 키가 같은 다른 레코드를 찾는다. 병합·삭제는 하지 않는다(사람이 판단).
 * @param {'customers'|'buildings'} kind
 * @param {{recId: string}} target
 * @param {Array<{recId: string}>} records 같은 테이블 전체
 * @returns {{keys: string[], candidates: string[]}} candidates = recId 목록
 */
function findCandidates(kind, target, records) {
  const keys = duplicateKeys(kind, target);
  if (keys.length === 0) return { keys, candidates: [] };
  const candidates = records
    .filter((r) => r.recId !== target.recId && duplicateKeys(kind, r).some((k) => keys.includes(k)))
    .map((r) => r.recId);
  return { keys, candidates };
}
// ---- END GENERATED: lib/dedupe.js ----

const AUTOMATION = 'duplicateDetect';

function plain(record, fields) {
  const out = { recId: record.id };
  for (const f of fields) out[f] = record.getCellValueAsString(f) || null;
  return out;
}

const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));

async function main() {
  const { tableName, recordId } = input.config();
  const kind = KINDS[tableName];
  if (!kind) throw new Error(`중복 감지 대상이 아닌 테이블: ${tableName}`);
  const table = base.getTable(tableName);
  const keyField = kind === 'customers' ? 'businessNo' : 'roadAddress';
  const query = await table.selectRecordsAsync({ fields: ['id', keyField, 'dupCandidates', 'dupStatus'] });
  const records = query.records.map((r) => plain(r, ['id', keyField]));
  const target = records.find((r) => r.recId === recordId);
  if (!target) {
    output.set('result', 'missing');
    return;
  }
  const { keys, candidates } = findCandidates(kind, target, records);
  const now = new Date().toISOString();
  const linked = (rec) => (rec.getCellValue('dupCandidates') || []).map((x) => x.id);
  const targetRecord = query.getRecord(recordId);
  const previous = linked(targetRecord);
  const reviewed = targetRecord.getCellValueAsString('dupStatus') === '검토 완료' && sameSet(previous, candidates);

  const updates = [{
    id: recordId,
    fields: {
      dupCandidates: candidates.map((id) => ({ id })),
      dupStatus: { name: reviewed ? '검토 완료' : candidates.length ? '후보 있음' : '후보 없음' },
      dupCheckedAt: now,
      ...(kind === 'buildings' ? { addressKey: keys.length ? keys[0].replace(/^addr:/u, '') : null } : {}),
    },
  }];
  // 상대 레코드에도 서로 연결(자기 테이블 연결은 반대쪽이 자동으로 채워지지 않는다)
  for (const id of candidates) {
    const rec = query.getRecord(id);
    const theirs = linked(rec);
    if (theirs.includes(recordId)) continue;
    updates.push({
      id,
      fields: {
        dupCandidates: [...theirs, recordId].map((x) => ({ id: x })),
        ...(rec.getCellValueAsString('dupStatus') === '검토 완료' ? {} : { dupStatus: { name: '후보 있음' } }),
        dupCheckedAt: now,
      },
    });
  }
  for (let i = 0; i < updates.length; i += 50) await table.updateRecordsAsync(updates.slice(i, i + 50));

  output.set('keys', keys);
  output.set('candidates', candidates.map((id) => query.getRecord(id).getCellValueAsString('id')));
  output.set('result', candidates.length ? 'candidates' : 'none');
}

try {
  await main();
} catch (e) {
  const { tableName, recordId } = input.config();
  try {
    await base.getTable('자동화 오류').createRecordAsync({
      id: `err_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      automation: AUTOMATION, stage: { name: 'error' }, tableName, recordId, message: e.message,
      occurredAt: new Date().toISOString(), notified: false,
    });
  } catch (inner) {
    console.error(`자동화 오류 기록 실패: ${inner.message}`);
  }
  throw e;
}
