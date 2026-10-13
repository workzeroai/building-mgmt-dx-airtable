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
export function addressKeyOf(raw) {
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
export function businessNoKey(raw) {
  const digits = String(raw || '').replace(/\D/gu, '');
  return digits.length === 10 ? digits : null;
}

/** 레코드의 비교 키 목록. kind: customers(사업자번호) | buildings(주소). */
export function duplicateKeys(kind, record) {
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
export function findCandidates(kind, target, records) {
  const keys = duplicateKeys(kind, target);
  if (keys.length === 0) return { keys, candidates: [] };
  const candidates = records
    .filter((r) => r.recId !== target.recId && duplicateKeys(kind, r).some((k) => keys.includes(k)))
    .map((r) => r.recId);
  return { keys, candidates };
}
