// 공통 견적 흐름: 주소 정규화 → 건물 조회 → 단가 → 사업부 계산 → 엑셀 양식 채움 → PDF(큐) → 저장.
// 사업부마다 다른 것은 레지스트리에서 받은 config(입력 항목·계산 함수·엑셀 매핑)뿐이다.
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildTemplateValues } from './templates.js';
import { renderTemplate } from './xlsx.js';
import { ValidationError, QuoteEngineError } from './errors.js';

/** config.inputs 기준으로 조건값을 채우고 검사한다(기본값 → 형 변환 → 범위·선택지). */
export function resolveConditions(division, raw = {}) {
  const out = {};
  const errors = [];
  for (const input of division.inputs) {
    let value = raw[input.key];
    if (value === undefined || value === null || value === '') value = input.default;
    if (input.type === 'number') {
      const n = Number(value);
      if (!Number.isFinite(n)) errors.push(`${input.label}: 숫자여야 합니다`);
      else if (input.min !== undefined && n < input.min) errors.push(`${input.label}: ${input.min} 이상`);
      else if (input.max !== undefined && n > input.max) errors.push(`${input.label}: ${input.max} 이하`);
      value = Number.isInteger(input.step ?? 1) ? Math.round(n) : n;
    } else if (input.type === 'select' && !input.options.includes(value)) {
      errors.push(`${input.label}: ${input.options.join('/')} 중 하나`);
    }
    out[input.key] = value;
  }
  if (errors.length) throw new ValidationError(`입력 조건 오류: ${errors.join(', ')}`, { errors });
  return out;
}

/** 사업부 계산 결과가 공통 규칙(항목 합 = 공급가액, 합계 = 공급가액 + 부가세)을 지키는지 확인. */
export function checkResult(division, result) {
  const sum = result.items.reduce((s, it) => s + it.amount, 0);
  if (sum !== result.subtotal || result.subtotal + result.vat !== result.total) {
    throw new QuoteEngineError(`${division.id} 계산 결과 합계가 맞지 않습니다(항목 ${sum}, 공급가액 ${result.subtotal}).`, { code: 'CALC_MISMATCH' });
  }
  for (const it of result.items) {
    if (!Number.isInteger(it.amount)) throw new QuoteEngineError(`${division.id} 항목 금액이 정수가 아닙니다: ${it.name}`, { code: 'CALC_MISMATCH' });
  }
  return result;
}

const pad = (n, w = 2) => String(n).padStart(w, '0');
const ymd = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function createQuoteEngine({
  registry, buildingClient, pricing, templates, pdfQueue, store, outDir, repoRoot, now = () => new Date(),
}) {
  const rel = (p) => (p ? path.relative(repoRoot ?? outDir, p).split(path.sep).join('/') : null);

  async function calculate(divisionId, building, rawConditions) {
    const division = registry.get(divisionId);
    const conditions = resolveConditions(division, rawConditions);
    const price = await pricing.get(divisionId);
    const result = checkResult(division, division.calculateCosts({ building, conditions }, price.data));
    return { division, conditions, price, result };
  }

  async function nextQuoteNo(division, date) {
    const prefix = `GW-${division.code}-${ymd(date)}-`;
    const today = (await store.list('quotes', { divisionId: division.id })).filter((q) => q.quoteNo.startsWith(prefix));
    return `${prefix}${pad(today.length + 1, 3)}`;
  }

  async function upsertBuilding(lookup, customerId) {
    const b = lookup.building;
    const registerKey = [b.sigunguCd, b.bjdongCd, '0', b.bun, b.ji].join('-');
    const [existing] = await store.list('buildings', { roadAddress: lookup.address.road });
    const fields = {
      customerId: customerId ?? existing?.customerId ?? null,
      roadAddress: lookup.address.road, jibunAddress: lookup.address.jibun ?? null, admCd: lookup.address.admCd,
      registerKey, adminCodeFallback: lookup.adminCodeFallback, name: b.name, mainPurpose: b.mainPurpose,
      totalArea: b.totalArea, groundFloors: b.groundFloors, undergroundFloors: b.undergroundFloors,
      dongCount: b.dongCount, approvalDate: b.approvalDate, source: lookup.source.register,
    };
    return existing ? store.update('buildings', existing.id, fields) : store.create('buildings', fields);
  }

  return {
    lookupBuilding: (address) => buildingClient.lookup(address),

    /** 화면 실시간 요약용: 파일·저장 없이 금액만. */
    async preview({ divisionId, building, conditions }) {
      if (!building) throw new ValidationError('건물 정보가 필요합니다(주소 조회 먼저).');
      const { division, conditions: resolved, price, result } = await calculate(divisionId, building, conditions);
      return {
        divisionId: division.id, conditions: resolved, ...result,
        pricingSource: price.source, pricingVersion: price.version, pricingWarning: price.warning ?? null,
      };
    },

    /** 견적 1건 전체 흐름. PDF가 실패해도 xlsx와 기록은 남긴다. */
    async createQuote({ divisionId, address, conditions, customerId = null, customerName = null }) {
      const steps = [];
      const step = async (name, fn) => {
        const t = Date.now();
        const value = await fn();
        steps.push({ name, ms: Date.now() - t });
        return value;
      };
      const division = registry.get(divisionId);
      const lookup = await step('주소 정규화·건물 조회', () => buildingClient.lookup(address));
      const calc = await step('단가·계산', () => calculate(divisionId, lookup.building, conditions));
      const { price, result } = calc;

      const customer = customerId ? await store.get('customers', customerId) : null;
      if (customerId && !customer) throw new ValidationError(`고객을 찾지 못했습니다: ${customerId}`);
      const date = now();
      const quoteNo = await nextQuoteNo(division, date);
      const validUntil = new Date(date.getTime() + 30 * 86_400_000);

      const { record: tpl, buffer: tplBuffer } = await templates.getActive(divisionId);
      const xlsxPath = path.join(outDir, `${quoteNo}.xlsx`);
      await step('엑셀 양식 채움', async () => {
        const { values, items } = buildTemplateValues({
          division, result, pricing: price, templateVersion: tpl.version,
          header: {
            quoteNo, quoteDate: isoDate(date), validUntil: isoDate(validUntil),
            customerName: customer?.name ?? customerName, address: lookup.address.road, building: lookup.building,
          },
        });
        const { buffer } = await renderTemplate(tplBuffer, { sheetName: division.outputSheet, values, items });
        await fs.mkdir(outDir, { recursive: true });
        await fs.writeFile(xlsxPath, buffer);
      });
      const pdf = await step('PDF 변환(큐)', () => pdfQueue.enqueue(xlsxPath, outDir));

      const record = await step('기록', async () => {
        const building = await upsertBuilding(lookup, customer?.id ?? null);
        return store.create('quotes', {
          quoteNo, divisionId, customerId: customer?.id ?? null, buildingId: building.id,
          conditions: calc.conditions, items: result.items, subtotal: result.subtotal, vat: result.vat, total: result.total,
          pricingSource: price.source, pricingVersion: price.version ?? null,
          templateVersionId: tpl.id, templateVersion: tpl.version,
          files: { xlsx: rel(xlsxPath), pdf: rel(pdf.pdfPath) }, pdfStatus: pdf.status, status: 'draft',
        });
      });

      return {
        quote: record,
        division: { id: division.id, name: division.name },
        address: lookup.address,
        building: lookup.building,
        adminCodeFallback: lookup.adminCodeFallback,
        result,
        pricingSource: price.source,
        pricingVersion: price.version,
        pricingWarning: price.warning ?? null,
        template: { id: tpl.id, version: tpl.version },
        files: { xlsx: xlsxPath, pdf: pdf.pdfPath ?? null },
        pdf,
        steps,
      };
    },

    status: () => ({ pdf: pdfQueue.status(), pricing: pricing.status(), guard: store.guardStatus?.() ?? { target: 'production' } }),
  };
}
