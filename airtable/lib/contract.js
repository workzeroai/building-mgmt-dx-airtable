// 스키마 YAML ↔ 견적 엔진 데이터 계약(data/schema/*.schema.json) 일관성 검사.
//
// 두 정의가 각자 진화하다 어긋나면, 엔진이 쓰는 필드가 에어테이블에 없거나(쓰기 실패)
// 선택지가 달라(typecast로 엉뚱한 선택지가 생김) 운영 데이터가 조용히 틀어진다.
// 그래서 계약에 연결된 테이블(contract:)은 아래를 모두 대조하고, 하나라도 다르면 테스트·빌드가 실패한다.
//   - 테이블 이름 = x-airtable.table, 기본 필드 = x-airtable.primaryField, Base 종류 = x-airtable.base
//   - owner: contract 필드 집합 = 계약 properties 키 집합
//   - 타입 호환(아래 표), enum = 단일 선택 choices, JSON 필드 = x-airtable.jsonFields
//   - x-links의 각 텍스트 ID 필드마다, 그 ID로 채우는 연결 필드(from)가 대상 계약 테이블로 이어진다
//   - 허브 사본(copyOf)은 계약 필드의 부분집합이고 타입이 같다
import { allTables } from './schema.js';

const COMPAT = {
  string: ['singleLineText', 'multilineText', 'email', 'url', 'date', 'dateTime', 'singleSelect'],
  integer: ['number', 'currency'],
  number: ['number', 'currency', 'percent'],
  boolean: ['checkbox'],
  object: ['multilineText'],
  array: ['multilineText'],
};

const typesOf = (prop) => (Array.isArray(prop.type) ? prop.type : [prop.type]).filter((t) => t !== 'null');

function fieldMatchesProp(field, prop) {
  const errors = [];
  const types = typesOf(prop);
  const main = types[0];
  if (types.length !== 1) errors.push(`계약 타입 ${JSON.stringify(prop.type)}은(는) null 외에 하나여야 합니다`);
  if (!COMPAT[main]?.includes(field.type)) errors.push(`타입 불일치: 계약 ${main} ↔ 에어테이블 ${field.type}`);
  if (main === 'integer' && field.type === 'number' && !field.integer) errors.push('정수 필드는 integer: true(소수점 0자리)여야 합니다');
  if ((main === 'object' || main === 'array') && !field.json) errors.push('객체·배열은 json: true 긴 텍스트여야 합니다');
  if (field.json && !(main === 'object' || main === 'array')) errors.push('json 필드인데 계약 타입이 객체·배열이 아닙니다');
  const enumValues = prop.enum?.filter((v) => v !== null);
  if (enumValues) {
    if (field.type !== 'singleSelect') errors.push('계약 enum은 단일 선택이어야 합니다');
    else if (JSON.stringify([...enumValues].sort()) !== JSON.stringify([...field.choices].sort())) {
      errors.push(`선택지 불일치: 계약 [${enumValues.join(', ')}] ↔ 에어테이블 [${field.choices.join(', ')}]`);
    }
  } else if (field.type === 'singleSelect' && field.owner === 'contract' && !field.choices?.length) {
    errors.push('enum 없는 문자열을 단일 선택으로 쓰려면 choices가 필요합니다');
  }
  return errors;
}

/**
 * @param {object} model expandSchema() 결과
 * @param {Record<string, object>} [contracts] 테이블 이름 → JSON Schema (기본: model.contracts)
 * @returns {string[]} 불일치 목록(비어 있으면 일치)
 */
export function checkContracts(model, contracts = model.contracts) {
  const errors = [];
  const covered = new Set();
  for (const { base, table } of allTables(model)) {
    const where = `${base.key}.${table.key}`;
    if (table.copyOf && table.copyContract) {
      const schema = contracts[table.copyContract];
      for (const f of table.fields.filter((x) => x.owner === 'copy')) {
        const prop = schema?.properties?.[f.name];
        if (!prop) errors.push(`${where}.${f.name}: 허브 사본 필드가 계약 ${table.copyContract}에 없습니다`);
        else for (const e of fieldMatchesProp(f, prop)) errors.push(`${where}.${f.name}: ${e}`);
      }
      continue;
    }
    if (!table.contract) {
      if (table.fields.some((f) => f.owner === 'contract')) errors.push(`${where}: contract 없는 테이블에 owner: contract 필드가 있습니다`);
      continue;
    }
    const schema = contracts[table.contract];
    if (!schema) {
      errors.push(`${where}: 데이터 계약 ${table.contract}이(가) 없습니다`);
      continue;
    }
    covered.add(table.contract);
    const at = schema['x-airtable'] ?? {};
    if (at.table !== table.name) errors.push(`${where}: 테이블 이름 ${table.name} ↔ 계약 x-airtable.table ${at.table}`);
    if (at.primaryField !== table.primary) errors.push(`${where}: 기본 필드 ${table.primary} ↔ 계약 ${at.primaryField}`);
    if (at.base !== base.kind) errors.push(`${where}: Base 종류 ${base.kind} ↔ 계약 x-airtable.base ${at.base}`);

    const contractFields = table.fields.filter((f) => f.owner === 'contract');
    const yamlKeys = new Set(contractFields.map((f) => f.name));
    const schemaKeys = new Set(Object.keys(schema.properties ?? {}));
    for (const k of schemaKeys) if (!yamlKeys.has(k)) errors.push(`${where}: 계약 필드 ${k}이(가) 스키마 YAML에 없습니다`);
    for (const k of yamlKeys) if (!schemaKeys.has(k)) errors.push(`${where}: YAML 필드 ${k}이(가) 계약에 없습니다(운영 필드면 owner: ops)`);
    for (const f of contractFields) {
      const prop = schema.properties?.[f.name];
      if (prop) for (const e of fieldMatchesProp(f, prop)) errors.push(`${where}.${f.name}: ${e}`);
    }
    const jsonYaml = contractFields.filter((f) => f.json).map((f) => f.name).sort();
    const jsonContract = [...(at.jsonFields ?? [])].sort();
    if (JSON.stringify(jsonYaml) !== JSON.stringify(jsonContract)) {
      errors.push(`${where}: JSON 필드 [${jsonYaml.join(', ')}] ↔ 계약 jsonFields [${jsonContract.join(', ')}]`);
    }
    for (const [idField, targetContract] of Object.entries(schema['x-links'] ?? {})) {
      const link = table.fields.find((f) => f.type === 'link' && f.from === idField);
      if (!link) {
        errors.push(`${where}: 계약 연결 ${idField} → ${targetContract}에 대응하는 연결 필드(from: ${idField})가 없습니다`);
        continue;
      }
      const target = base.tables.find((t) => t.key === link.to);
      const targetContractOf = target?.contract ?? target?.copyContract;
      if (targetContractOf !== targetContract) {
        errors.push(`${where}.${link.name}: ${idField}는 ${targetContract}를 가리켜야 하는데 연결 대상은 ${link.to}(${targetContractOf})입니다`);
      }
    }
  }
  for (const name of Object.keys(contracts)) {
    if (!covered.has(name)) errors.push(`계약 ${name}을(를) 담는 테이블이 스키마 YAML에 없습니다`);
  }
  return errors;
}
