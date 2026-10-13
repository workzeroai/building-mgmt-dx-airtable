// 단가 외부화: 단가는 코드가 아니라 데이터 저장소(pricing 테이블)에서 읽는다.
// - 5분 TTL 캐시(같은 사업부 견적이 몰려도 저장소를 매번 부르지 않음)
// - 저장소 조회 실패·레코드 없음·형식 오류 → 번들 기본값(data/pricing/<id>.json)으로 폴백
// - 응답에 pricingSource: "store" | "cache" | "fallback"을 붙여 어떤 단가로 계산했는지 남긴다.
import fs from 'node:fs/promises';
import path from 'node:path';
import { PRICING_DIR } from './paths.js';
import { NotFoundError, ValidationError } from './errors.js';

export const DEFAULT_TTL_MS = 5 * 60 * 1000;

export async function loadBundledPricing(divisionId, dir = PRICING_DIR) {
  try {
    return JSON.parse(await fs.readFile(path.join(dir, `${divisionId}.json`), 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') throw new NotFoundError(`번들 단가 파일이 없습니다: data/pricing/${divisionId}.json`);
    throw err;
  }
}

/** 사업부 config.pricingKeys에 적힌 키가 모두 있는지 확인한다. */
export function checkPricingShape(division, data) {
  const missing = (division.pricingKeys ?? []).filter((k) => data?.[k] === undefined);
  return missing.length ? [`단가표에 필요한 키가 없습니다: ${missing.join(', ')}`] : [];
}

/**
 * @param {object} options
 * @param {object} options.store 데이터 저장소 어댑터
 * @param {object} options.registry 사업부 레지스트리
 * @param {string} [options.bundledDir]
 * @param {number} [options.ttlMs]
 * @param {() => number} [options.now]
 */
export function createPricingService({ store, registry, bundledDir = PRICING_DIR, ttlMs = DEFAULT_TTL_MS, now = Date.now, logger = console }) {
  const cache = new Map();
  const stats = { store: 0, cache: 0, fallback: 0, lastError: null };

  async function fromStore(divisionId) {
    const [record] = await store.list('pricing', { divisionId });
    if (!record) throw new NotFoundError(`저장소에 ${divisionId} 단가 레코드가 없습니다.`);
    const errors = checkPricingShape(registry.get(divisionId), record.data);
    if (errors.length) throw new ValidationError(errors[0]);
    return record;
  }

  return {
    /** @returns {Promise<{ data: object, version: string, source: 'store'|'cache'|'fallback', fetchedAt: number, warning?: string }>} */
    async get(divisionId) {
      registry.get(divisionId); // 없는 사업부면 여기서 에러
      const hit = cache.get(divisionId);
      if (hit && now() - hit.fetchedAt < ttlMs) {
        stats.cache += 1;
        return { ...hit, source: 'cache' };
      }
      try {
        const record = await fromStore(divisionId);
        const entry = { data: record.data, version: record.version, recordId: record.id, fetchedAt: now() };
        cache.set(divisionId, entry);
        stats.store += 1;
        return { ...entry, source: 'store' };
      } catch (err) {
        // 폴백은 캐시에 넣지 않는다: 저장소가 살아나면 다음 요청부터 바로 저장소 단가를 쓴다.
        stats.fallback += 1;
        stats.lastError = err.message;
        logger.warn?.(`[pricing] ${divisionId} 저장소 단가 조회 실패 → 번들 기본값 사용: ${err.message}`);
        const bundled = await loadBundledPricing(divisionId, bundledDir);
        return { data: bundled, version: bundled.version, fetchedAt: now(), source: 'fallback', warning: err.message };
      }
    },
    invalidate(divisionId) {
      if (divisionId) cache.delete(divisionId);
      else cache.clear();
    },
    /** 관리자 화면에서 단가 저장. 형식 검사 후 저장하고 캐시를 비운다. */
    async update(divisionId, data, { updatedBy = '관리자', version } = {}) {
      const division = registry.get(divisionId);
      if (typeof data !== 'object' || data === null || Array.isArray(data)) throw new ValidationError('단가는 JSON 객체여야 합니다.');
      const errors = checkPricingShape(division, data);
      if (errors.length) throw new ValidationError(errors[0], { errors });
      const nextVersion = version ?? new Date(now()).toISOString().slice(0, 10);
      const [existing] = await store.list('pricing', { divisionId });
      const fields = { divisionId, version: nextVersion, source: '가상', data, updatedBy, updatedAt: new Date(now()).toISOString() };
      const saved = existing ? await store.update('pricing', existing.id, fields) : await store.create('pricing', fields);
      cache.delete(divisionId);
      return saved;
    },
    status() {
      return {
        ttlMs,
        cached: [...cache.entries()].map(([id, e]) => ({ divisionId: id, version: e.version, ageMs: now() - e.fetchedAt })),
        ...stats,
      };
    },
  };
}
