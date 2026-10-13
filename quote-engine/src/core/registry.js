// 사업부 레지스트리: divisions/<id>/config.js를 찾아 읽는다.
// core는 사업부 이름을 하나도 모른다. 새 사업부는 폴더(config.js) + 단가 파일(data/pricing/<id>.json)만 추가한다.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { DIVISIONS_DIR } from './paths.js';
import { NotFoundError, ValidationError } from './errors.js';

const REQUIRED = {
  id: 'string', code: 'string', name: 'string', order: 'number',
  outputSheet: 'string', inputs: 'array', items: 'array', template: 'object', sample: 'object',
  calculateCosts: 'function', excelMapping: 'function',
};

/** config 모양 검사. 틀리면 어떤 키가 왜 틀렸는지 모두 모아 알려 준다. */
export function validateDivisionConfig(config, folderName) {
  const errors = [];
  for (const [key, type] of Object.entries(REQUIRED)) {
    const value = config?.[key];
    const ok = type === 'array' ? Array.isArray(value) : typeof value === type && value !== null;
    if (!ok) errors.push(`${key}(${type}) 없음`);
  }
  if (config?.id && folderName && config.id !== folderName) errors.push(`id "${config.id}"가 폴더 이름 "${folderName}"과 다름`);
  for (const input of config?.inputs ?? []) {
    if (!input.key || !input.label || !['number', 'select'].includes(input.type)) {
      errors.push(`inputs 항목 형식 오류: ${JSON.stringify(input)}`);
    }
    if (input.type === 'select' && !(input.options ?? []).includes(input.default)) {
      errors.push(`inputs.${input.key}: 기본값이 선택지에 없음`);
    }
  }
  return errors;
}

export function createRegistry(divisions) {
  const byId = new Map();
  for (const d of [...divisions].sort((a, b) => a.order - b.order)) {
    if (byId.has(d.id)) throw new ValidationError(`사업부 ID 중복: ${d.id}`);
    byId.set(d.id, d);
  }
  return {
    list: () => [...byId.values()],
    ids: () => [...byId.keys()],
    has: (id) => byId.has(id),
    get(id) {
      const d = byId.get(id);
      if (!d) throw new NotFoundError(`등록되지 않은 사업부: ${id}`, { available: [...byId.keys()] });
      return d;
    },
  };
}

/** 폴더를 훑어 config.js가 있는 하위 폴더를 모두 등록한다. */
export async function loadDivisions(dir = DIVISIONS_DIR) {
  const folders = fs.readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(dir, e.name, 'config.js')))
    .map((e) => e.name);
  const divisions = [];
  for (const folder of folders) {
    const mod = await import(pathToFileURL(path.join(dir, folder, 'config.js')).href);
    const config = mod.default;
    const errors = validateDivisionConfig(config, folder);
    if (errors.length) throw new ValidationError(`divisions/${folder}/config.js 형식 오류: ${errors.join('; ')}`, { errors });
    divisions.push(config);
  }
  return createRegistry(divisions);
}
