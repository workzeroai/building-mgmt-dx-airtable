// 스키마 YAML → 파생 산출물 전체(경로 → 내용). airtable/build.mjs와 테스트가 같은 함수를 쓴다.
import path from 'node:path';
import { loadCatalog, renderCatalog, validateCatalog } from './catalog.js';
import { checkContracts } from './contract.js';
import { importOrder, loadDataset, renderCsv, validateDataset } from './dataset.js';
import { renderSchemaDoc } from './docs.js';
import { erdOutputs } from './erd.js';
import { WORKFLOW_FILE, codeOutputs, renderWorkflow } from './n8n.js';
import { AUTOMATIONS_DIR, CSV_DIR, DIAGRAMS_DIR, DOCS_DIR, OPS_SEED_DIR } from './paths.js';
import { loadModel, stats, validateModel } from './schema.js';
import { scriptOutputs } from './scripts.js';

const json = (v) => `${JSON.stringify(v, null, 2)}\n`;

export async function buildAll({ model = loadModel() } = {}) {
  const problems = [...validateModel(model), ...checkContracts(model)];
  const outputs = new Map();
  if (problems.length) return { model, outputs, problems, summary: '' };

  const { rows, ops } = await loadDataset(model);
  problems.push(...validateDataset(model, rows));
  const catalog = loadCatalog();
  problems.push(...validateCatalog(model, catalog, { generated: [path.basename(WORKFLOW_FILE)] }));
  if (problems.length) return { model, outputs, problems, summary: '' };

  for (const [name, data] of Object.entries(ops)) outputs.set(path.join(OPS_SEED_DIR, `${name}.json`), json(data));
  for (const base of model.bases) {
    importOrder(base).forEach((table, i) => {
      if ((rows.get(base.key).get(table.key) ?? []).length === 0) return;
      outputs.set(path.join(CSV_DIR, base.key, `${String(i + 1).padStart(2, '0')}-${table.key}.csv`), renderCsv(base, table, rows.get(base.key)));
    });
  }
  outputs.set(path.join(DOCS_DIR, 'schema.md'), renderSchemaDoc(model, rows));
  for (const [name, text] of erdOutputs(model)) outputs.set(path.join(DIAGRAMS_DIR, `${name}.yaml`), text);
  for (const [file, text] of scriptOutputs(model)) outputs.set(file, text);
  outputs.set(path.join(AUTOMATIONS_DIR, 'catalog.md'), renderCatalog(model, catalog));
  for (const [file, text] of codeOutputs(model)) outputs.set(file, text);
  outputs.set(WORKFLOW_FILE, renderWorkflow(model));

  const s = stats(model);
  return { model, rows, outputs, problems, summary: `Base ${s.bases} · 테이블 ${s.tables} · 필드 ${s.fields} · 연결 ${s.links}` };
}
