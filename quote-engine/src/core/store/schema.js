// 데이터 계약(data/schema/*.schema.json)을 읽고 레코드를 검사한다.
// JSON Schema 전체가 아니라 이 저장소에서 쓰는 부분(type·enum·pattern·minimum·required·additionalProperties)만 지원한다.
import fs from 'node:fs';
import path from 'node:path';
import { SCHEMA_DIR } from '../paths.js';
import { ValidationError } from '../errors.js';

/** @returns {Record<string, object>} 테이블 이름 → 스키마 */
export function loadSchemas(dir = SCHEMA_DIR) {
  const schemas = {};
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.schema.json')).sort()) {
    const schema = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    schemas[schema['x-table']] = schema;
  }
  return schemas;
}

function typeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (Number.isInteger(value)) return 'integer';
  return typeof value;
}

function matchesType(value, expected) {
  const actual = typeOf(value);
  const list = Array.isArray(expected) ? expected : [expected];
  return list.some((t) => t === actual || (t === 'number' && actual === 'integer'));
}

/** @returns {string[]} 오류 메시지 목록(비어 있으면 통과) */
export function validateRecord(schema, record) {
  const errors = [];
  for (const key of schema.required ?? []) {
    if (record[key] === undefined) errors.push(`${key}: 필수 필드 없음`);
  }
  for (const [key, value] of Object.entries(record)) {
    const prop = schema.properties?.[key];
    if (!prop) {
      if (schema.additionalProperties === false) errors.push(`${key}: 계약에 없는 필드`);
      continue;
    }
    if (value === undefined) continue;
    if (prop.type && !matchesType(value, prop.type)) {
      errors.push(`${key}: ${JSON.stringify(prop.type)} 타입이어야 함(실제 ${typeOf(value)})`);
      continue;
    }
    if (prop.enum && !prop.enum.includes(value)) errors.push(`${key}: 허용 값 ${prop.enum.join('|')} 중 하나여야 함`);
    if (prop.pattern && typeof value === 'string' && !new RegExp(prop.pattern, 'u').test(value)) {
      errors.push(`${key}: 형식 ${prop.pattern} 불일치`);
    }
    if (prop.minimum !== undefined && typeof value === 'number' && value < prop.minimum) {
      errors.push(`${key}: ${prop.minimum} 이상이어야 함`);
    }
  }
  return errors;
}

export function assertValid(schema, record) {
  const errors = validateRecord(schema, record);
  if (errors.length > 0) {
    throw new ValidationError(`${schema.title}(${schema['x-table']}) 레코드가 데이터 계약과 다릅니다: ${errors.join(', ')}`, { errors });
  }
}

/** 테이블의 연결 필드 목록 { field: targetTable } */
export function linksOf(schema) {
  return schema?.['x-links'] ?? {};
}
