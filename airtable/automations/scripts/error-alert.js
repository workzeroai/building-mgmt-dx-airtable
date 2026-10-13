// [에어테이블 자동화 스크립트] 자동화 오류 요약 알림 — 그리드웰 빌딩서비스(가상) 모든 Base
//
// 트리거: 일정(예: 매시 10분)
// 입력 변수(input.config): webhookUrl = 디스코드·슬랙 수신 웹훅, label = Base 표시 이름(예: GW 소방시설 점검)
// 동작:
//   - 자동화 오류 테이블에서 아직 알리지 않은(notified 꺼짐) 건을 모은다
//   - 자동화별 건수·단계·최근 메시지 3건으로 요약해 웹훅 1번만 보낸다(건마다 알림을 쏘지 않는다)
//   - 발송이 성공했을 때만 notified를 켠다. 실패하면 그대로 두어 다음 실행이 다시 보낸다

// ---- BEGIN GENERATED: config (npm run airtable:build) ----
const DEFAULT_LABEL = "그리드웰 빌딩서비스(가상)";
// ---- END GENERATED: config ----

// ---- BEGIN GENERATED: lib/alert.js ----
// 자동화 오류 요약 알림(순수 함수). 빌드가 error-alert.js와 n8n Code 노드에 넣는다.
// 메시지는 디스코드(content)·슬랙(text) 수신 웹훅 둘 다 받도록 같은 문장을 두 키에 담는다.

/**
 * @param {Array<{automation: string, stage: string, tableName?: string, recordId?: string, message: string, occurredAt?: string}>} errors
 * @param {{label: string, maxPerGroup?: number, maxChars?: number}} options
 */
function buildAlert(errors, { label, maxPerGroup = 3, maxChars = 1800 }) {
  const groups = new Map();
  for (const e of errors) {
    const key = e.automation || '(이름 없음)';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  }
  const lines = [`[${label}] 자동화 오류 ${errors.length}건`];
  for (const [name, list] of [...groups.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))) {
    const stages = {};
    for (const e of list) stages[e.stage] = (stages[e.stage] || 0) + 1;
    lines.push(`• ${name} ${list.length}건 (${Object.entries(stages).map(([s, n]) => `${s} ${n}`).join(', ')})`);
    const recent = [...list].sort((a, b) => String(b.occurredAt || '').localeCompare(String(a.occurredAt || ''))).slice(0, maxPerGroup);
    for (const e of recent) {
      const where = [e.tableName, e.recordId].filter(Boolean).join('/');
      lines.push(`   - ${where ? `${where}: ` : ''}${String(e.message || '').replace(/\s+/gu, ' ').slice(0, 160)}`);
    }
    if (list.length > maxPerGroup) lines.push(`   - 외 ${list.length - maxPerGroup}건`);
  }
  let text = lines.join('\n');
  if (text.length > maxChars) text = `${text.slice(0, maxChars - 20)}\n… (길어서 생략)`;
  return { content: text, text, count: errors.length, groups: groups.size };
}
// ---- END GENERATED: lib/alert.js ----

const { webhookUrl, label } = input.config();
if (!webhookUrl) throw new Error('입력 변수 webhookUrl이 필요합니다.');
const table = base.getTable('자동화 오류');
const query = await table.selectRecordsAsync({ fields: ['automation', 'stage', 'tableName', 'recordId', 'message', 'occurredAt', 'notified'] });
const pending = query.records.filter((r) => r.getCellValue('notified') !== true);

if (pending.length === 0) {
  output.set('sent', 0);
} else {
  const errors = pending.map((r) => ({
    automation: r.getCellValueAsString('automation'),
    stage: r.getCellValueAsString('stage'),
    tableName: r.getCellValueAsString('tableName'),
    recordId: r.getCellValueAsString('recordId'),
    message: r.getCellValueAsString('message'),
    occurredAt: r.getCellValueAsString('occurredAt'),
  }));
  const payload = buildAlert(errors, { label: label || DEFAULT_LABEL });
  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: payload.content, text: payload.text }),
  });
  if (!res.ok) throw new Error(`웹훅 발송 실패 HTTP ${res.status} — notified를 켜지 않았습니다(다음 실행에서 다시 보냄)`);
  const now = new Date().toISOString();
  const updates = pending.map((r) => ({ id: r.id, fields: { notified: true, notifiedAt: now } }));
  for (let i = 0; i < updates.length; i += 50) await table.updateRecordsAsync(updates.slice(i, i + 50));
  output.set('sent', pending.length);
  output.set('groups', payload.groups);
}
