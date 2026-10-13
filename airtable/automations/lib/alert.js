// 자동화 오류 요약 알림(순수 함수). 빌드가 error-alert.js와 n8n Code 노드에 넣는다.
// 메시지는 디스코드(content)·슬랙(text) 수신 웹훅 둘 다 받도록 같은 문장을 두 키에 담는다.

/**
 * @param {Array<{automation: string, stage: string, tableName?: string, recordId?: string, message: string, occurredAt?: string}>} errors
 * @param {{label: string, maxPerGroup?: number, maxChars?: number}} options
 */
export function buildAlert(errors, { label, maxPerGroup = 3, maxChars = 1800 }) {
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
