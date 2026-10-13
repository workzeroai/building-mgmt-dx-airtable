// 공공 API 클라이언트: 도로명주소 검색 → 건축물대장 표제부 조회.
// - 응답 "형식"은 실제 API를 따른다. 기본은 fixtures의 가짜 응답, 키가 있으면 실제 호출.
// - 행정구역 개편으로 법정동코드가 바뀐 지역은 새 코드로 대장이 비어 나올 수 있다.
//   이때 구 코드 표(legacy-admin-codes.json)로 한 번 더 조회한다.
import fs from 'node:fs/promises';
import path from 'node:path';
import { FIXTURES_DIR } from './paths.js';
import { addressKey, normalizeAddress, registerKey, toRegisterQuery } from './normalize.js';
import { AddressNotFoundError, BuildingNotFoundError, ExternalApiError } from './errors.js';

const JUSO_URL = 'https://business.juso.go.kr/addrlink/addrLinkApi.do';
const REGISTER_URL = 'https://apis.data.go.kr/1613000/BldRgstHubService/getBrTitleInfo';

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

/** 건축물대장 응답의 items.item은 0건이면 "", 1건이면 객체, 여러 건이면 배열이다. */
export function extractRegisterItems(response) {
  const header = response?.response?.header;
  if (header && header.resultCode !== '00') {
    throw new ExternalApiError(`건축물대장 조회 오류: ${header.resultMsg ?? header.resultCode}`, header);
  }
  const item = response?.response?.body?.items?.item;
  if (!item) return [];
  return Array.isArray(item) ? item : [item];
}

export function extractJusoItems(response) {
  const common = response?.results?.common;
  if (common && common.errorCode !== '0') {
    throw new ExternalApiError(`주소 검색 오류: ${common.errorMessage}`, common);
  }
  return response?.results?.juso ?? [];
}

/**
 * 표제부 여러 동(棟)을 건물 하나로 합친다.
 * 연면적은 합계, 층수는 최댓값, 이름·주용도는 가장 큰 동 기준.
 */
export function summarizeBuilding(items) {
  if (items.length === 0) return null;
  const sorted = [...items].sort((a, b) => Number(b.totArea) - Number(a.totArea));
  const main = sorted[0];
  const totalArea = items.reduce((sum, it) => sum + Number(it.totArea || 0), 0);
  return {
    name: main.bldNm || '(건물명 없음)',
    mainPurpose: main.mainPurpsCdNm || '기타',
    totalArea: Math.round(totalArea * 100) / 100,
    groundFloors: Math.max(...items.map((it) => Number(it.grndFlrCnt || 0))),
    undergroundFloors: Math.max(...items.map((it) => Number(it.ugrndFlrCnt || 0))),
    approvalDate: main.useAprDay || null,
    structure: main.strctCdNm || null,
    households: items.reduce((sum, it) => sum + Number(it.hhldCnt || 0), 0),
    dongCount: items.length,
    sigunguCd: main.sigunguCd,
    bjdongCd: main.bjdongCd,
    bun: main.bun,
    ji: main.ji,
  };
}

/**
 * @param {object} options
 * @param {'fake'|'live'} [options.mode] fake면 키가 있어도 가짜 응답만 쓴다.
 * @param {string} [options.jusoKey]
 * @param {string} [options.registerKey]
 * @param {typeof fetch} [options.fetchImpl]
 * @param {string} [options.fixturesDir]
 * @param {number} [options.timeoutMs]
 */
export function createBuildingClient(options = {}) {
  const {
    mode = 'fake',
    jusoKey = '',
    registerKey: registerApiKey = '',
    fetchImpl = globalThis.fetch,
    fixturesDir = FIXTURES_DIR,
    timeoutMs = 8000,
  } = options;

  const liveJuso = mode === 'live' && Boolean(jusoKey);
  const liveRegister = mode === 'live' && Boolean(registerApiKey);
  let fixtureCache;

  async function fixtures() {
    if (!fixtureCache) {
      const [juso, register, legacy] = await Promise.all([
        readJson(path.join(fixturesDir, 'juso-responses.json')),
        readJson(path.join(fixturesDir, 'building-register-responses.json')),
        readJson(path.join(fixturesDir, 'legacy-admin-codes.json')),
      ]);
      fixtureCache = { juso, register, legacy };
    }
    return fixtureCache;
  }

  async function getJson(url) {
    let res;
    try {
      res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) {
      throw new ExternalApiError(`공공 API 호출 실패: ${err.message}`, { cause: err.name });
    }
    if (!res.ok) throw new ExternalApiError(`공공 API 응답 오류 HTTP ${res.status}`);
    return res.json();
  }

  async function searchAddress(address) {
    const norm = normalizeAddress(address);
    let response;
    if (liveJuso) {
      const params = new URLSearchParams({
        confmKey: jusoKey, currentPage: '1', countPerPage: '5', keyword: norm.normalized, resultType: 'json',
      });
      response = await getJson(`${JUSO_URL}?${params}`);
    } else {
      const { juso } = await fixtures();
      // 가짜 응답: 도로명·지번 주소 끝부분이 입력과 같으면 일치로 본다("중구 예시로 12"도 찾음).
      response = Object.values(juso.responses).find((r) => r.results.juso.some((j) =>
        addressKey(j.roadAddrPart1 ?? j.roadAddr).endsWith(norm.key) || addressKey(j.jibunAddr).endsWith(norm.key)));
      response ??= juso.empty;
    }
    const items = extractJusoItems(response);
    if (items.length === 0) {
      const hint = liveJuso ? '' : ' 가짜 모드에서는 예시 주소만 조회됩니다.';
      throw new AddressNotFoundError(`주소를 찾지 못했습니다: ${norm.normalized}.${hint}`, {
        normalized: norm.normalized,
        examples: liveJuso ? undefined : await exampleAddresses(),
      });
    }
    return { normalized: norm, juso: items[0], source: liveJuso ? 'live' : 'fixture' };
  }

  async function getTitleInfo(query) {
    if (liveRegister) {
      const params = new URLSearchParams({
        serviceKey: registerApiKey, ...query, _type: 'json', numOfRows: '50', pageNo: '1',
      });
      return extractRegisterItems(await getJson(`${REGISTER_URL}?${params}`));
    }
    const { register } = await fixtures();
    return extractRegisterItems(register.responses[registerKey(query)] ?? register.empty);
  }

  async function legacyCodeFor(query) {
    const { legacy } = await fixtures();
    const full = `${query.sigunguCd}${query.bjdongCd}`;
    const exact = legacy.codes.find((c) => c.newCode === full);
    if (exact) return { ...exact, oldSigunguCd: exact.oldCode.slice(0, 5), oldBjdongCd: exact.oldCode.slice(5) };
    const bySigungu = legacy.codes.find((c) => c.newCode === query.sigunguCd);
    if (bySigungu) return { ...bySigungu, oldSigunguCd: bySigungu.oldCode, oldBjdongCd: query.bjdongCd };
    return null;
  }

  async function exampleAddresses() {
    const { juso } = await fixtures();
    return Object.values(juso.responses).map((r) => r.results.juso[0].roadAddrPart1);
  }

  /** 주소 하나 → 주소 응답 + 건물 요약(+ 구 코드 재조회 기록). */
  async function lookup(address) {
    const { normalized, juso, source } = await searchAddress(address);
    const query = toRegisterQuery(juso);
    let items = await getTitleInfo(query);
    let adminCodeFallback = null;

    if (items.length === 0) {
      const legacy = await legacyCodeFor(query);
      if (legacy) {
        const oldQuery = { ...query, sigunguCd: legacy.oldSigunguCd, bjdongCd: legacy.oldBjdongCd };
        items = await getTitleInfo(oldQuery);
        if (items.length > 0) {
          adminCodeFallback = {
            from: `${query.sigunguCd}${query.bjdongCd}`,
            to: `${oldQuery.sigunguCd}${oldQuery.bjdongCd}`,
            reason: legacy.reason,
          };
        }
      }
    }
    if (items.length === 0) {
      throw new BuildingNotFoundError(`건축물대장에 건물이 없습니다: ${juso.roadAddr}`, { query });
    }
    return {
      normalized: normalized.normalized,
      address: {
        road: juso.roadAddrPart1 ?? juso.roadAddr,
        jibun: juso.jibunAddr,
        zipNo: juso.zipNo,
        admCd: juso.admCd,
        sido: juso.siNm,
        sigungu: juso.sggNm,
      },
      building: summarizeBuilding(items),
      adminCodeFallback,
      source: { address: source, register: liveRegister ? 'live' : 'fixture' },
    };
  }

  return {
    mode: { address: liveJuso ? 'live' : 'fixture', register: liveRegister ? 'live' : 'fixture' },
    lookup,
    searchAddress,
    getTitleInfo,
    exampleAddresses,
  };
}
