// ERD 도면 사양(excalidraw_kit YAML) 생성: 스키마가 바뀌면 도면 사양도 같이 바뀐다.
//   docs/diagrams/erd-overview.yaml  허브-사업부 전체 구조
//   docs/diagrams/erd-division.yaml  사업부 Base 상세(테이블·연결)
// 사양 → 그림: python ../_design/excalidraw_kit.py docs/diagrams/erd-overview.yaml --out docs/diagrams --export
import YAML from 'yaml';
import { forwardLinks } from './schema.js';

/** 상자에 보여 줄 대표 필드(없는 필드를 적으면 빌드가 실패한다 → 스키마와 도면이 어긋나지 않는다). */
const HIGHLIGHT = {
  divisions: ['code', 'name'],
  customers: ['businessNo', 'type'],
  'copy:customers': ['name', 'type'],
  buildings: ['roadAddress', 'totalArea'],
  staff: ['role', 'divisionId'],
  quotes: ['status', 'total', 'conditions'],
  contracts: ['status', 'startDate', 'annualAmount'],
  pricing: ['version', 'data'],
  templateVersions: ['version', 'status'],
  inspections: ['scheduledDate', 'status'],
  inspectionResults: ['result', 'defects'],
  invoices: ['status', 'amount', 'dueDate'],
  syncRuns: ['sourceCount', 'status'],
  automationErrors: ['stage', 'notified'],
};

/** 상세 도면에서 생략하는 연결(고객·건물은 여러 테이블에 이어져 선이 겹친다 — 부제에 명시). */
const HIDDEN_LINKS = ['contracts.customer', 'contracts.building', 'inspections.building'];

function highlights(table) {
  const names = (table.copyOf ? HIGHLIGHT[`copy:${table.key}`] : null) ?? HIGHLIGHT[table.key] ?? table.fields.slice(1, 3).map((f) => f.name);
  for (const n of names) {
    if (!table.fields.some((f) => f.name === n)) throw new Error(`ERD 대표 필드 ${table.key}.${n}이(가) 스키마에 없습니다`);
  }
  return names;
}

function label(table, { extensions = [] } = {}) {
  const lines = [`${table.name} · ${table.key}`, `${table.primary} (기본)`];
  const hs = highlights(table).filter((n) => n !== table.primary);
  lines.push(hs.join(' · '));
  const links = forwardLinks(table).filter((f) => f.to !== table.key);
  if (links.length) lines.push(`연결 ${links.map((f) => f.name).join(' · ')}`);
  if (extensions.length) lines.push(`+ 확장 ${extensions.length}`);
  return lines.join('\n');
}

/** 이름들을 ' · '로 이어 한 줄 maxLen자 안으로 나눈다. */
function packLines(names, maxLen = 30) {
  const lines = [];
  for (const n of names) {
    const last = lines.at(-1);
    if (last && `${last} · ${n}`.length <= maxLen) lines[lines.length - 1] = `${last} · ${n}`;
    else lines.push(n);
  }
  return lines;
}

const header = (name) => `# 자동 생성: npm run airtable:build (airtable/lib/erd.js ← airtable/schema/gridwell.yaml). 직접 고치지 않는다.\n# 그림: python ../../../_design/excalidraw_kit.py ${name}.yaml --out . --export\n`;

export function overviewSpec(model) {
  const hub = model.bases.find((b) => b.kind === 'hub');
  const divisions = model.bases.filter((b) => b.kind === 'division');
  const tpl = divisions[0];
  const W = 260;
  const nodes = [];
  const edges = [];
  const zones = [];
  // 동기화 대상(고객·건물·담당자)을 오른쪽 열에 세로로 두어 동기화 상자로 가는 선이 다른 상자를 지나지 않게 한다
  const hubPos = { customers: [340, -40], buildings: [340, 220], staff: [340, 480], divisions: [0, 480] };
  for (const [key, [x, y]] of Object.entries(hubPos)) {
    const t = hub.tables.find((x2) => x2.key === key);
    if (!t) throw new Error(`허브에 ${key} 테이블이 없습니다`);
    nodes.push({ id: `hub-${key}`, label: label(t), role: 'primary', x, y, width: W, fontSize: 16 });
  }
  for (const t of hub.tables) {
    for (const f of forwardLinks(t)) {
      if (hubPos[t.key] && hubPos[f.to] && f.to !== t.key) edges.push({ from: `hub-${f.to}`, to: `hub-${t.key}` });
    }
  }
  zones.push({ id: 'hub', label: `${hub.name} — 원본(공통 엔티티)`, nodes: Object.keys(hubPos).map((k) => `hub-${k}`), role: 'primary' });

  const syncCopies = model.sync.tables.map((k) => tpl.tables.find((t) => t.key === k));
  nodes.push({
    id: 'sync', role: 'info', x: 720, y: 200, width: 280, fontSize: 16,
    label: `동기화 안전장치\n허브 → 사업부 단방향\n급감 ${Math.round(model.sync.maxDropRatio * 100)}% 초과 시 중단\n실패 건은 건너뛰고 기록`,
  });
  for (const t of syncCopies) edges.push({ from: `hub-${t.copyOf.table}`, to: 'sync', style: 'dashed', ...(t.copyOf.table === 'buildings' ? {} : { route: 'elbow' }) });

  const work = tpl.tables.filter((t) => !t.copyOf && !t.common && t.key !== 'syncRuns');
  const chain = ['quotes', 'contracts', 'inspections', 'inspectionResults', 'invoices'].map((k) => work.find((t) => t.key === k)?.name).filter(Boolean);
  const others = work.filter((t) => !['quotes', 'contracts', 'inspections', 'inspectionResults', 'invoices'].includes(t.key)).map((t) => t.name);
  divisions.forEach((b, i) => {
    const y = 220 + (i - (divisions.length - 1) / 2) * 300; // 가운데 사업부가 동기화 상자와 같은 높이
    const ext = b.tables.flatMap((t) => t.fields.filter((f) => f.extension).map((f) => f.name));
    nodes.push({ id: `${b.key}-copy`, role: 'info', x: 1180, y, width: W, fontSize: 16, label: `허브 사본 ${syncCopies.length}\n${syncCopies.map((t) => t.name).join(' · ')}\n읽기 전용` });
    nodes.push({ id: `${b.key}-work`, role: 'secondary', x: 1540, y, width: 300, fontSize: 16, label: `업무 ${work.length}\n${chain.slice(0, 3).join(' → ')}\n→ ${chain.slice(3).join(' → ')}\n${others.join(' · ')}` });
    nodes.push({ id: `${b.key}-ext`, role: 'accent', x: 1940, y, width: W, fontSize: 16, label: `확장 필드 ${ext.length}\n${packLines(ext).join('\n')}` });
    const middle = i === (divisions.length - 1) / 2;
    // 위·아래 사업부로는 곡선으로 돌아가 가운데 상자를 지나지 않게
    edges.push({ from: 'sync', to: `${b.key}-copy`, ...(middle ? { label: '사본' } : { curve: i < (divisions.length - 1) / 2 ? 0.25 : -0.25 }) });
    edges.push({ from: `${b.key}-copy`, to: `${b.key}-work`, label: i === 0 ? '연결' : undefined });
    edges.push({ from: `${b.key}-work`, to: `${b.key}-ext`, style: 'dashed' });
    zones.push({ id: `zone-${b.key}`, label: `${b.name} — 사업부 Base ${b.division.order}`, nodes: [`${b.key}-copy`, `${b.key}-work`, `${b.key}-ext`], role: 'secondary' });
  });
  for (const e of edges) if (e.label === undefined) delete e.label;
  return {
    name: 'erd-overview',
    title: '허브 1 + 사업부 Base 3 — 공통 엔티티와 사업부 확장',
    subtitle: `Base ${model.bases.length} · 테이블 ${model.bases.reduce((n, b) => n + b.tables.length, 0)} (가상 회사 그리드웰 빌딩서비스). 사업부 Base는 같은 틀 + 확장 필드만 다르다`,
    layout: 'manual',
    nodes,
    edges,
    zones,
  };
}

export function divisionSpec(model) {
  const b = model.bases.find((x) => x.kind === 'division');
  const W = 280;
  // 위치는 선이 상자를 지나지 않게 고른 값: 위아래 상자는 가로 범위가 겹쳐 곧은 세로선, 같은 줄은 곧은 가로선
  const Y = [0, 260, 520, 780];
  const pos = {
    customers: [0, 0], buildings: [380, 0], staff: [950, 0],
    templateVersions: [-190, 1], quotes: [190, 1], contracts: [570, 1], inspections: [950, 1], inspectionResults: [1330, 1],
    pricing: [-190, 2], invoices: [570, 2],
    syncRuns: [-190, 3], automationErrors: [190, 3],
  };
  const CURVED = { 'invoices.result': 0.2 }; // 점검 결과 → 청구는 대각선이라 아래로 휘게
  const roleOf = (t) => (t.copyOf ? 'info' : t.common || t.key === 'syncRuns' ? 'neutral' : 'secondary');
  const nodes = [];
  let extra = 0;
  for (const t of b.tables) {
    const [x, r] = pos[t.key] ?? [380 * extra++, 4];
    const ext = t.fields.filter((f) => f.extension);
    nodes.push({ id: t.key, label: label(t, { extensions: ext }), role: roleOf(t), x, y: Y[r] ?? r * 260, width: W, fontSize: 16 });
  }
  for (const h of HIDDEN_LINKS) {
    const [tk, fk] = h.split('.');
    if (!b.tables.find((t) => t.key === tk)?.fields.some((f) => f.name === fk)) throw new Error(`ERD 생략 연결 ${h}이(가) 스키마에 없습니다`);
  }
  const edges = [];
  for (const t of b.tables) {
    for (const f of forwardLinks(t)) {
      if (f.to === t.key || HIDDEN_LINKS.includes(`${t.key}.${f.name}`)) continue;
      const curve = CURVED[`${t.key}.${f.name}`];
      edges.push({ from: f.to, to: t.key, ...(curve ? { curve } : {}) });
    }
  }
  const keysBy = (pred) => b.tables.filter(pred).map((t) => t.key);
  return {
    name: 'erd-division',
    title: `사업부 Base 상세 — ${b.tables.length}개 테이블 (${model.divisions.map((d) => d.id).join('·')} 공통 틀)`,
    subtitle: `화살표 = 연결(부모 → 자식, 1:N). 계약·점검 일정의 고객·건물 연결은 선이 겹쳐 생략. "+ 확장 n" = ${b.division.name} 확장 필드`,
    layout: 'manual',
    nodes,
    edges,
    zones: [
      { id: 'copies', label: '허브 사본(읽기 전용, 동기화만 씀)', nodes: keysBy((t) => t.copyOf), role: 'info' },
      { id: 'work', label: '업무: 견적 → 계약 → 점검 → 청구', nodes: keysBy((t) => !t.copyOf && !t.common && t.key !== 'syncRuns'), role: 'secondary' },
      { id: 'ops', label: '운영 기록', nodes: keysBy((t) => t.common || t.key === 'syncRuns'), role: 'neutral' },
    ],
  };
}

export function erdOutputs(model) {
  return [overviewSpec(model), divisionSpec(model)].map((spec) => [spec.name, `${header(spec.name)}${YAML.stringify(spec, { lineWidth: 0 })}`]);
}
