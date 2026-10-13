// docs/schema.md 생성: 스키마 YAML → 테이블·필드 표. 직접 고치지 않는다(npm run airtable:build).
import { COMPUTED_TYPES, OWNER_LABEL, OWNERS, stats, syncRules } from './schema.js';

const esc = (s) => String(s ?? '').replace(/\|/gu, '\\|').replace(/\n/gu, ' ');
const code = (s) => `\`${String(s).replace(/`/gu, "'")}\``;

function typeLabel(f, base) {
  const target = (key) => base.tables.find((t) => t.key === key)?.name ?? key;
  switch (f.type) {
    case 'number':
      return f.integer ? 'number(정수)' : 'number';
    case 'currency':
      return 'currency(원)';
    case 'singleSelect':
      return `singleSelect: ${f.choices.join(' · ')}`;
    case 'multilineText':
      return f.json ? 'multilineText(JSON)' : 'multilineText';
    case 'link':
      return `link → ${target(f.to)}${f.from ? ` (← ${code(f.from)})` : ''}${f.inverseOf ? ' · 역방향' : ''}`;
    case 'lookup':
      return `lookup: ${f.via}.${f.field}`;
    case 'rollup':
      return `rollup: ${f.via}.${f.field} → ${code(f.fn)}`;
    case 'count':
      return `count: ${f.via}`;
    case 'formula':
      return `formula: ${code(f.formula)}`;
    default:
      return f.type;
  }
}

function fieldDesc(f, table, contracts) {
  if (f.desc) return f.desc;
  const schemaName = table.contract ?? table.copyContract;
  const d = schemaName ? contracts[schemaName]?.properties?.[f.name]?.description : null;
  return d ?? '';
}

function fieldTable(table, base, contracts, { skipExtensions = false } = {}) {
  const lines = ['| 필드 | 타입 | 소유 | 설명 |', '|---|---|---|---|'];
  for (const f of table.fields) {
    if (skipExtensions && f.extension) continue;
    const name = f.name === table.primary ? `**${f.name}** (기본)` : f.name;
    lines.push(`| ${esc(name)} | ${esc(typeLabel(f, base))} | ${OWNER_LABEL[f.owner]} | ${esc(fieldDesc(f, table, contracts))} |`);
  }
  return lines.join('\n');
}

function tableHeading(table) {
  const tags = [];
  if (table.contract) tags.push(`데이터 계약 ${code(table.contract)}`);
  if (table.copyOf) tags.push(`허브 ${code(table.copyOf.table)}의 사본`);
  if (table.common) tags.push('모든 Base 공통');
  if (table.idPrefix) tags.push(`ID ${code(`${table.idPrefix}_…`)}`);
  return `#### ${table.name} (${code(table.key)})${tags.length ? ` — ${tags.join(' · ')}` : ''}`;
}

/**
 * @param {object} model
 * @param {Map<string, Map<string, object[]>>} rows 시드 레코드(건수 표시용)
 */
export function renderSchemaDoc(model, rows) {
  const s = stats(model);
  const hub = model.bases.find((b) => b.kind === 'hub');
  const divisionBases = model.bases.filter((b) => b.kind === 'division');
  const tpl = divisionBases[0];
  const rules = syncRules(model);
  const out = [];
  const push = (...l) => out.push(...l);

  push(
    '# 에어테이블 스키마',
    '',
    '> **자동 생성 문서** — [`airtable/schema/gridwell.yaml`](../airtable/schema/gridwell.yaml)에서 `npm run airtable:build`로 만든다. 직접 고치지 않는다. CI가 `npm run airtable:check`로 최신 여부를 확인한다.',
    '>',
    '> 가상 회사 "그리드웰 빌딩서비스" 기준이며 실제 회사의 Base·테이블·필드와 무관하다. 시드 건수는 가상 데이터 기준.',
    '',
    '## 한눈에 보기',
    '',
    '| 항목 | 값 |',
    '|---|---|',
    `| Base | ${s.bases}개 (허브 1 + 사업부 ${divisionBases.length}: ${divisionBases.map((b) => b.division.name).join(' · ')}) |`,
    `| 테이블 | ${s.tables}개 (허브 ${hub.tables.length} + 사업부 Base당 ${tpl.tables.length}) |`,
    `| 필드 | ${s.fields}개 (${OWNERS.map((o) => `${OWNER_LABEL[o]} ${s.byOwner[o]}`).join(' · ')}) |`,
    `| 연결 | 정방향 ${s.links}개 (역방향은 에어테이블이 자동 생성) |`,
    `| 계산 필드 | ${s.computed}개 (수식·룩업·롤업·개수 — Meta API로 만들 수 없어 수동 추가) |`,
    '',
    '![허브-사업부 구조](diagrams/erd-overview.png)',
    '',
    '| Base | 이름 | 테이블 | 필드 | 시드 레코드 |',
    '|---|---|---|---|---|',
  );
  for (const b of model.bases) {
    const n = [...(rows.get(b.key)?.values() ?? [])].reduce((sum, list) => sum + list.length, 0);
    push(`| ${code(b.key)} | ${b.name} | ${b.tables.length} | ${b.tables.reduce((x, t) => x + t.fields.length, 0)} | ${n.toLocaleString('ko-KR')} |`);
  }

  push(
    '',
    '## 필드 소유 구분',
    '',
    '필드 이름만 보고 "누가 쓰는 필드인지" 알 수 있게 나눴다. 코드(견적 엔진·자동화 스크립트·n8n)가 읽고 쓰는 필드는 영문 camelCase로 고정하고, 사람이 화면에서 보는 파생 필드만 한국어로 짓는다. 한국어 필드는 이름을 바꿔도 코드가 깨지지 않는다.',
    '',
    '| 소유 | 이름 규칙 | 누가 쓰나 | 예 |',
    '|---|---|---|---|',
    `| ${OWNER_LABEL.contract} | 영문 camelCase = 데이터 계약 키 | 견적 엔진(${code('data/schema/*.schema.json')}과 일치 검사) | ${code('quoteNo')} ${code('total')} |`,
    `| ${OWNER_LABEL.ops} | 영문 camelCase | 자동화 스크립트·사람 | ${code('businessNo')} ${code('statusConfirmed')} |`,
    `| ${OWNER_LABEL.copy} | 허브와 같은 이름 | 동기화만 | 사업부 Base의 고객·건물·담당자 |`,
    `| ${OWNER_LABEL.link} | 정방향 영문(${code('customer')}), 역방향 한국어(테이블 이름) | 자동화가 텍스트 ID로 채움 | ${code('customer')} ← ${code('customerId')} |`,
    `| ${OWNER_LABEL.computed} | 한국어 | 에어테이블(사람이 봄) | 미수금, 점검 등급 |`,
    '',
    '## 허브 ↔ 사업부 동기화',
    '',
    `- 방향: **허브 → 사업부 단방향**. 사업부 Base의 사본 테이블(${rules.order.map((k) => rules.tables[k].name).join('·')})은 읽기 전용이고, 고칠 일은 허브에서 고친다.`,
    `- 키: ${code(rules.key)}(데이터 계약 ID). 에어테이블 레코드 ID(${code('rec…')})는 Base마다 달라 키로 쓰지 않는다.`,
    `- 안전장치: 원본 건수가 직전 정상 실행 대비 **${Math.round(rules.maxDropRatio * 100)}% 넘게 줄면 반영 중단**, 검증 실패·쓰기 실패는 **건 단위로 건너뛰고 기록**, 허브에서 사라진 건은 지우지 않고 ${code('hubMissing')} 표시, 쓰기 묶음 ${rules.batchSize}건.`,
    '- 구현: 에어테이블 스크립트 [`sync-safety.js`](../airtable/automations/scripts/sync-safety.js) 또는 n8n [`sync-safety.json`](../n8n/sync-safety.json). 판정 코드는 같다.',
    '',
    '| 사본 테이블 | 원본(허브) | 동기화 필드 | 필수 | ID 형식 |',
    '|---|---|---|---|---|',
  );
  for (const key of rules.order) {
    const r = rules.tables[key];
    push(`| ${r.name} | ${r.sourceName} | ${r.fields.map(code).join(' ')} | ${r.required.map(code).join(' ')} | ${code(r.idPattern)} |`);
  }

  push('', '## 상태 전이', '', '상태 전이 가드 스크립트([`status-guard.js`](../airtable/automations/scripts/status-guard.js))가 아래 표에 없는 전이를 되돌리고 사유를 남긴다.', '', '| 테이블 | 상태 | 갈 수 있는 상태 |', '|---|---|---|');
  for (const t of tpl.tables.filter((x) => x.statusFlow)) {
    for (const [from, tos] of Object.entries(t.statusFlow.transitions)) push(`| ${t.name} | ${code(from)} | ${tos.length ? tos.map(code).join(' · ') : '— (종료)'} |`);
  }

  push('', '## 사업부 확장 필드', '', '공통 틀(견적·점검 결과 등)은 사업부마다 같고, 사업부 고유 값만 덧붙인다. 새 사업부는 `divisions`와 `extensions`에 항목을 추가하면 Base 생성 요청·문서·시드가 함께 나온다.', '', '| 사업부 | 테이블 | 필드 | 타입 | 설명 |', '|---|---|---|---|---|');
  for (const b of divisionBases) {
    for (const t of b.tables) {
      for (const f of t.fields.filter((x) => x.extension)) push(`| ${b.division.name} | ${t.name} | ${esc(f.name)} | ${esc(typeLabel(f, b))} | ${esc(f.desc ?? '')} |`);
    }
  }

  push('', '## 수동으로 추가할 계산 필드', '', 'Meta API는 수식·룩업·롤업·개수 필드를 만들지 못한다. `create-base.mjs`가 테이블·일반 필드·연결을 만든 뒤, 아래 필드는 에어테이블 화면에서 추가한다(`--dry-run` 출력 끝에도 같은 목록이 나온다).', '', '| Base | 테이블 | 필드 | 정의 |', '|---|---|---|---|');
  const seen = new Set();
  for (const b of model.bases) {
    for (const t of b.tables) {
      for (const f of t.fields.filter((x) => COMPUTED_TYPES.includes(x.type))) {
        const label = b.kind === 'division' && !f.extension ? '사업부 Base 공통' : b.name;
        const k = `${label}|${t.name}|${f.name}`;
        if (seen.has(k)) continue;
        seen.add(k);
        push(`| ${label} | ${t.name} | ${esc(f.name)} | ${esc(typeLabel(f, b))} |`);
      }
    }
  }

  push('', '## Base별 테이블', '', `### ${hub.name} (${code('hub')})`, '', hub.description, '');
  for (const t of hub.tables) push(tableHeading(t), '', t.description, '', fieldTable(t, hub, model.contracts), '');
  push(
    `### 사업부 Base 틀 (${divisionBases.map((b) => code(b.key)).join(' · ')})`,
    '',
    `${tpl.description} 아래는 공통 틀이고(확장 필드 제외), 연결 대상은 같은 Base 안의 테이블이다.`,
    '',
    '![사업부 Base 상세](diagrams/erd-division.png)',
    '',
  );
  for (const t of tpl.tables) push(tableHeading(t), '', t.description, '', fieldTable(t, tpl, model.contracts, { skipExtensions: true }), '');
  return `${out.join('\n').replace(/\n{3,}/gu, '\n\n').trimEnd()}\n`;
}
