// 주소 정규화: 사람이 입력한 주소를 조회용 형태로 맞춘다.
// - 시도 약칭을 정식 명칭으로("서울시" → "서울특별시")
// - 괄호 안 참고항목, 쉼표, 연속 공백 제거
// - 동·층·호 같은 상세 주소 제거(건물 단위 조회이므로)
import { ValidationError } from './errors.js';

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
  /\s+(지하\s*)?\d+\s*층.*$/u, // 3층, 지하1층 …
  /\s+\d+\s*호.*$/u, // 302호 …
  /\s+[A-Za-z]?\d+\s*동(\s+\d+.*)?$/u, // 101동 1203 … (법정동 이름 "중동 12"는 건드리지 않음)
];

/**
 * @param {string} raw
 * @returns {{ input: string, normalized: string, key: string, sido: string | null }}
 */
export function normalizeAddress(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new ValidationError('주소를 입력해 주세요.', { field: 'address' });
  }
  let s = raw.normalize('NFC');
  s = s.replace(/\([^)]*\)/gu, ' ');
  s = s.replace(/[,·]/gu, ' ');
  s = s.replace(/\s+/gu, ' ').trim();
  for (const pattern of DETAIL_PATTERNS) s = s.replace(pattern, '');
  s = s.replace(/(\d+)\s*번지$/u, '$1');

  const tokens = s.split(' ');
  if (SIDO_ALIASES[tokens[0]]) tokens[0] = SIDO_ALIASES[tokens[0]];
  const normalized = tokens.join(' ');
  const sido = /(특별시|광역시|특별자치시|특별자치도|도)$/u.test(tokens[0]) ? tokens[0] : null;

  return { input: raw, normalized, key: addressKey(normalized), sido };
}

/** 비교용 키: 공백 제거. "서울특별시 중구 예시로 12" → "서울특별시중구예시로12" */
export function addressKey(text) {
  return String(text).normalize('NFC').replace(/\s+/gu, '');
}

export function pad4(value) {
  const n = String(value ?? '0').replace(/\D/gu, '') || '0';
  return n.padStart(4, '0').slice(-4);
}

/**
 * 도로명주소 API 응답 1건 → 건축물대장 표제부 조회 조건.
 * admCd(법정동코드 10자리) = 시군구코드 5자리 + 법정동코드 5자리.
 */
export function toRegisterQuery(juso) {
  const admCd = String(juso.admCd ?? '');
  if (!/^\d{10}$/u.test(admCd)) {
    throw new ValidationError('주소 응답에 법정동코드(admCd)가 없습니다.', { admCd });
  }
  return {
    sigunguCd: admCd.slice(0, 5),
    bjdongCd: admCd.slice(5),
    platGbCd: String(juso.mtYn) === '1' ? '1' : '0',
    bun: pad4(juso.lnbrMnnm),
    ji: pad4(juso.lnbrSlno),
  };
}

export function registerKey(query) {
  return [query.sigunguCd, query.bjdongCd, query.platGbCd, query.bun, query.ji].join('-');
}
