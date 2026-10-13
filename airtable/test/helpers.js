// airtable/ 테스트 공용: 스키마 모델·가상 데이터·하네스 준비.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadModel, baseByKey, syncRules } from '../lib/schema.js';
import { loadDataset } from '../lib/dataset.js';
import { SCRIPTS_DIR } from '../lib/paths.js';
import { createFakeBase } from '../automations/harness/airtable-harness.js';

export const model = loadModel();
export const rules = syncRules(model);
let datasetPromise;
export const dataset = () => {
  datasetPromise ??= loadDataset(model);
  return datasetPromise;
};
export const script = (name) => path.join(SCRIPTS_DIR, name);
export const makeTmp = (prefix = 'at-test-') => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

/** 가상 시드를 넣은 가짜 Base. tables: 넣을 테이블 key 목록(기본: 전부) */
export async function seededBase(baseKey, { tables = null, failOn = null } = {}) {
  const base = createFakeBase(baseByKey(model, baseKey), { failOn });
  const { rows } = await dataset();
  const baseModel = baseByKey(model, baseKey);
  // 연결 대상이 먼저 들어가게 순서대로
  const order = ['divisions', 'customers', 'staff', 'buildings', 'templateVersions', 'quotes', 'contracts', 'pricing', 'inspections', 'inspectionResults', 'invoices', 'syncRuns', 'automationErrors'];
  for (const key of order) {
    if (tables && !tables.includes(key)) continue;
    const table = baseModel.tables.find((t) => t.key === key);
    if (!table) continue;
    const list = rows.get(baseKey).get(key) ?? [];
    const links = {};
    for (const f of table.fields.filter((x) => x.type === 'link' && x.from && !x.inverseOf)) {
      if (tables && !tables.includes(f.to)) continue;
      links[f.name] = (row) => (row[f.from] ? [row[f.from]] : []);
    }
    base.seed(table.name, list, { links });
  }
  return base;
}

export const silentLog = () => {};
