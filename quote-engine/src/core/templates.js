// 양식 버전 관리: 업로드 → 테스트 렌더 → 활성화(사업부별 1개) → 필요하면 이전 버전으로 되돌리기.
// 양식 변경 장애(셀 위치·시트 이름이 바뀐 양식이 바로 운영에 쓰이는 문제)를 운영 절차로 막는다.
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildTemplateBuffer, inspectTemplate, renderTemplate } from './xlsx.js';
import { NotFoundError, TemplateError, ValidationError } from './errors.js';

export const PRICING_SOURCE_LABEL = { store: '저장소', cache: '저장소(캐시)', fallback: '번들 기본값(폴백)' };

/** 견적 결과 + 머리글 정보 → 양식 값(공통 값 자리 + 사업부 excelMapping 값). */
export function buildTemplateValues({ division, result, header, pricing, templateVersion }) {
  const mapping = division.excelMapping(result);
  const b = header.building ?? {};
  return {
    values: {
      quoteNo: header.quoteNo,
      quoteDate: header.quoteDate,
      validUntil: header.validUntil,
      customerName: header.customerName ?? '(고객 미지정)',
      address: header.address,
      buildingName: b.name ?? '',
      mainPurpose: b.mainPurpose ?? '',
      totalArea: b.totalArea ?? null,
      floors: `지상 ${b.groundFloors ?? 0}층 / 지하 ${b.undergroundFloors ?? 0}층`,
      divisionName: division.name,
      subtotal: result.subtotal,
      vat: result.vat,
      total: result.total,
      pricingSource: PRICING_SOURCE_LABEL[pricing.source] ?? pricing.source,
      pricingVersion: pricing.version ?? '-',
      templateVersion: templateVersion ?? '-',
      ...mapping.fields,
    },
    items: mapping.items,
  };
}

export function createTemplateService({ store, registry, pricing, filesDir, baseDir, now = () => new Date() }) {
  const relative = (p) => path.relative(baseDir ?? filesDir, p).split(path.sep).join('/');
  const absolute = (p) => path.resolve(baseDir ?? filesDir, p);

  async function getRecord(id) {
    const record = await store.get('templateVersions', id);
    if (!record) throw new NotFoundError(`양식 버전이 없습니다: ${id}`);
    return record;
  }

  async function versions(divisionId) {
    return (await store.list('templateVersions', { divisionId })).sort((a, b) => a.version - b.version);
  }

  /** 사업부 sample 입력으로 실제 견적과 같은 경로를 태워 본다(엄격 모드: 남는 값 자리도 실패). */
  async function testRenderBuffer(division, buffer, version) {
    const errors = [];
    const warnings = [];
    const inspection = await inspectTemplate(buffer, division.outputSheet).catch((err) => {
      errors.push(err.message);
      return null;
    });
    if (inspection) errors.push(...inspection.errors);
    if (errors.length === 0) {
      try {
        const price = await pricing.get(division.id);
        const result = division.calculateCosts(division.sample, price.data);
        const { values, items } = buildTemplateValues({
          division, result, pricing: price, templateVersion: version,
          header: {
            quoteNo: 'GW-TEST-00000000-000', quoteDate: '2026-01-01', validUntil: '2026-01-31',
            customerName: '테스트 고객', address: '테스트 주소', building: division.sample.building,
          },
        });
        await renderTemplate(buffer, { sheetName: division.outputSheet, values, items, strict: true });
        if (inspection.capacity < items.length + 2) warnings.push(`항목 칸 여유가 적습니다(칸 ${inspection.capacity}, 샘플 항목 ${items.length}).`);
      } catch (err) {
        errors.push(err.message);
      }
    }
    return { ok: errors.length === 0, errors, warnings, capacity: inspection?.capacity ?? 0, testedAt: now().toISOString() };
  }

  const service = {
    versions,

    async upload(divisionId, buffer, { uploadedBy = '관리자', note = null } = {}) {
      registry.get(divisionId);
      if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new ValidationError('업로드한 양식 파일이 비어 있습니다.');
      const sha256 = createHash('sha256').update(buffer).digest('hex');
      const existing = await versions(divisionId);
      const version = (existing.at(-1)?.version ?? 0) + 1;
      const file = path.join(filesDir, divisionId, `v${version}-${sha256.slice(0, 8)}.xlsx`);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, buffer);
      return store.create('templateVersions', {
        divisionId, version, status: 'uploaded', sha256, size: buffer.length, filePath: relative(file),
        note, uploadedBy, uploadedAt: now().toISOString(), testReport: null, activatedAt: null, deactivatedAt: null,
      });
    },

    async testRender(id) {
      const record = await getRecord(id);
      const division = registry.get(record.divisionId);
      const buffer = await fs.readFile(absolute(record.filePath));
      const report = await testRenderBuffer(division, buffer, record.version);
      const status = record.status === 'active' || record.status === 'inactive'
        ? record.status // 이미 쓰던 버전은 상태를 바꾸지 않고 결과만 기록
        : report.ok ? 'tested' : 'failed';
      return store.update('templateVersions', id, { testReport: report, status });
    },

    /** 테스트 렌더를 통과한 버전만 활성화한다. 기존 활성 버전은 inactive로 내린다. */
    async activate(id) {
      const record = await getRecord(id);
      if (record.status === 'active') return record;
      if (!record.testReport?.ok) {
        throw new TemplateError(`테스트 렌더를 통과하지 않은 양식은 활성화할 수 없습니다(v${record.version}, 상태 ${record.status}).`, {
          errors: record.testReport?.errors ?? ['테스트 렌더를 먼저 실행하세요.'],
        });
      }
      const stamp = now().toISOString();
      for (const v of await versions(record.divisionId)) {
        if (v.status === 'active') await store.update('templateVersions', v.id, { status: 'inactive', deactivatedAt: stamp });
      }
      return store.update('templateVersions', id, { status: 'active', activatedAt: stamp, deactivatedAt: null });
    },

    /** 직전에 활성이었던(테스트 통과) 버전으로 되돌린다. */
    async rollback(divisionId) {
      const all = await versions(divisionId);
      const current = all.find((v) => v.status === 'active');
      const previous = all
        .filter((v) => v.status === 'inactive' && v.activatedAt && v.testReport?.ok)
        .sort((a, b) => String(b.deactivatedAt).localeCompare(String(a.deactivatedAt)) || b.version - a.version)[0];
      if (!previous) throw new TemplateError(`되돌릴 이전 활성 버전이 없습니다(${divisionId}).`);
      const activated = await service.activate(previous.id);
      return { from: current?.version ?? null, to: activated.version, record: activated };
    },

    async getActive(divisionId) {
      const record = (await versions(divisionId)).find((v) => v.status === 'active');
      if (!record) throw new TemplateError(`활성 양식이 없습니다(${divisionId}). 관리자 화면에서 양식을 테스트·활성화하세요.`);
      return { record, buffer: await fs.readFile(absolute(record.filePath)) };
    },

    /** 양식이 하나도 없는 사업부에 기본 양식 v1을 만들어 업로드 → 테스트 → 활성화한다. */
    async ensureDefaults() {
      const created = [];
      for (const division of registry.list()) {
        if ((await versions(division.id)).length > 0) continue;
        const buffer = await buildTemplateBuffer(division);
        const uploaded = await service.upload(division.id, buffer, { uploadedBy: 'system', note: '기본 양식(생성 스크립트)' });
        const tested = await service.testRender(uploaded.id);
        if (!tested.testReport.ok) throw new TemplateError(`${division.id} 기본 양식 테스트 실패: ${tested.testReport.errors.join('; ')}`);
        created.push(await service.activate(uploaded.id));
      }
      return created;
    },

    readFile: async (record) => fs.readFile(absolute(record.filePath)),
  };
  return service;
}
