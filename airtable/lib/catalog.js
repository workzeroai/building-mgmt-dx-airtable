// 자동화 카탈로그(airtable/automations/catalog.yaml) 검사와 catalog.md 생성.
import fs from 'node:fs';
import YAML from 'yaml';
import { CATALOG_FILE } from './paths.js';
import { COMPUTED_TYPES } from './schema.js';

export function loadCatalog(file = CATALOG_FILE) {
  return YAML.parse(fs.readFileSync(file, 'utf8')).patterns ?? [];
}

const IMPL_LABEL = (impl) => String(impl).split(' · ').map((part) => {
  if (part === 'builtin') return '기본 액션';
  if (part === 'script') return '스크립트(패턴)';
  const [kind, file] = part.split(':');
  if (kind === 'script') return `[스크립트 ${file}](scripts/${file})`;
  if (kind === 'n8n') return `[n8n ${file}](../../n8n/${file})`;
  return part;
}).join(' · ');

/** @returns {string[]} 오류 목록 */
export function validateCatalog(model, patterns, { generated = [] } = {}) {
  const errors = [];
  const ids = new Set();
  for (const p of patterns) {
    const where = p.id ?? '(id 없음)';
    if (ids.has(p.id)) errors.push(`${where}: id 중복`);
    ids.add(p.id);
    for (const k of ['name', 'base', 'table', 'trigger', 'condition', 'action', 'impl', 'guard']) if (!p[k]) errors.push(`${where}: ${k} 없음`);
    const base = model.bases.find((b) => b.kind === p.base);
    const table = base?.tables.find((t) => t.key === p.table);
    if (!table) {
      errors.push(`${where}: ${p.base}.${p.table} 테이블이 스키마에 없습니다`);
      continue;
    }
    for (const f of [...(p.watch ?? []), ...(p.reads ?? [])]) {
      if (!table.fields.some((x) => x.name === f)) errors.push(`${where}: ${table.name}에 ${f} 필드가 없습니다`);
    }
    for (const [tk, fields] of Object.entries(p.writes ?? {})) {
      const t = base.tables.find((x) => x.key === tk);
      if (!t) {
        errors.push(`${where}: 쓰는 테이블 ${tk}이(가) 없습니다`);
        continue;
      }
      for (const f of fields) {
        const field = t.fields.find((x) => x.name === f);
        if (!field) errors.push(`${where}: ${t.name}에 ${f} 필드가 없습니다`);
        else if (COMPUTED_TYPES.includes(field.type) || field.inverseOf) errors.push(`${where}: ${t.name}.${f}은(는) 쓸 수 없는 필드(계산·역방향)`);
      }
    }
    for (const part of String(p.impl).split(' · ')) {
      const [kind, file] = part.split(':');
      if (kind === 'script' && file && !fs.existsSync(new URL(`../automations/scripts/${file}`, import.meta.url))) errors.push(`${where}: 스크립트 ${file} 없음`);
      if (kind === 'n8n' && file && !generated.includes(file) && !fs.existsSync(new URL(`../../n8n/${file}`, import.meta.url))) errors.push(`${where}: n8n ${file} 없음`);
    }
  }
  return errors;
}

const esc = (s) => String(s ?? '').replace(/\|/gu, '\\|').replace(/\n/gu, ' ');

export function renderCatalog(model, patterns) {
  const tableName = (p) => {
    const base = model.bases.find((b) => b.kind === p.base);
    return `${p.base === 'hub' ? '허브' : '사업부'} · ${base.tables.find((t) => t.key === p.table).name}`;
  };
  const scripts = patterns.filter((p) => String(p.impl).includes('script:')).length;
  const lines = [
    '# 자동화 패턴 카탈로그',
    '',
    '> **자동 생성 문서** — [`catalog.yaml`](catalog.yaml)에서 `npm run airtable:build`로 만든다. 적힌 테이블·필드가 스키마에 없으면 테스트가 실패한다.',
    '>',
    '> 가상 회사 "그리드웰 빌딩서비스" 스키마 기준의 패턴 예시다. 회사에서 운영한 자동화(60여 개)를 옮긴 것이 아니라, 같은 방식(트리거 → 조건 → 액션 + 안전장치)을 가상 스키마로 다시 정리했다.',
    '',
    `패턴 ${patterns.length}개 중 ${scripts}개는 이 저장소에 실행 가능한 스크립트가 있고 하네스 테스트로 검증한다. 나머지는 에어테이블 기본 액션(레코드 만들기·찾기·수정, 메일)으로 만드는 패턴이다.`,
    '',
    '![자동화 패턴](../../docs/diagrams/automation-pattern.png)',
    '',
    '| ID | 자동화 | Base · 테이블 | 트리거 | 조건 | 액션 | 구현 | 안전장치 |',
    '|---|---|---|---|---|---|---|---|',
  ];
  for (const p of patterns) {
    lines.push(`| ${p.id} | ${esc(p.name)} | ${esc(tableName(p))} | ${esc(p.trigger)} | ${esc(p.condition)} | ${esc(p.action)} | ${IMPL_LABEL(p.impl)} | ${esc(p.guard)} |`);
  }
  lines.push('', '## 읽고 쓰는 필드', '', '| ID | 감시 | 읽기 | 쓰기 |', '|---|---|---|---|');
  for (const p of patterns) {
    const writes = Object.entries(p.writes ?? {}).map(([t, fs2]) => `${t}: ${fs2.join(', ')}`).join(' / ');
    lines.push(`| ${p.id} | ${esc((p.watch ?? []).join(', ') || '—')} | ${esc((p.reads ?? []).join(', '))} | ${esc(writes || '—(알림만)')} |`);
  }
  lines.push(
    '',
    '## 운영 원칙',
    '',
    '- **자동화는 지우지 않는다.** 사라진 원본은 표시만 하고(hubMissing), 중복은 후보만 띄운다(dupCandidates). 삭제·병합은 사람이 한다.',
    '- **한 건의 실패가 전체를 멈추지 않게.** 묶음 쓰기가 실패하면 한 건씩 다시 쓰고 실패한 건만 기록한다.',
    '- **이상하면 멈춘다.** 원본 건수가 갑자기 줄면 필터·권한 사고로 보고 반영하지 않는다.',
    '- **실패는 한곳에 모아 한 번에 알린다.** 모든 자동화가 자동화 오류 테이블에 쓰고, 알림 스크립트가 묶어 보낸다(알림 폭주 방지).',
    '- **상태는 규칙대로만 움직인다.** 상태 전이 가드가 표에 없는 전이를 되돌린다. 사람이 실수로 고쳐도, 자동화가 잘못 고쳐도 같다.',
    '',
  );
  return `${lines.join('\n')}`;
}
