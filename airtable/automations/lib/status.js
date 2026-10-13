// 상태 전이 판정(순수 함수). 빌드가 status-guard.js에 그대로 넣는다.

/**
 * @param {Record<string, string[]>} transitions { 현재 상태: [갈 수 있는 상태…] }
 * @param {string|null} confirmed 가드가 마지막으로 허용한 상태(처음이면 null)
 * @param {string|null} current 지금 셀 값
 * @returns {{action: 'accept'|'reject'|'noop', reason: string}}
 */
export function checkTransition(transitions, confirmed, current) {
  if (!current) {
    return confirmed
      ? { action: 'reject', reason: `상태를 비울 수 없습니다(마지막 상태 ${confirmed})` }
      : { action: 'noop', reason: '상태 없음' };
  }
  if (!(current in transitions)) return { action: 'reject', reason: `정의되지 않은 상태 ${current}` };
  if (!confirmed) return { action: 'accept', reason: `기준 상태 기록: ${current}` };
  if (confirmed === current) return { action: 'noop', reason: '변경 없음' };
  const allowed = transitions[confirmed] || [];
  if (allowed.includes(current)) return { action: 'accept', reason: `${confirmed} → ${current} 허용` };
  const next = allowed.length ? allowed.join('|') : '없음(종료 상태)';
  return { action: 'reject', reason: `${confirmed} → ${current} 불가. ${confirmed}에서 갈 수 있는 상태: ${next}` };
}

/** 상태 기록 한 줄을 붙인다. 오래된 줄은 버려 긴 텍스트가 끝없이 자라지 않게 한다. */
export function appendNote(previous, line, maxLines = 20) {
  const lines = String(previous || '').split('\n').filter(Boolean);
  lines.push(line);
  return lines.slice(-maxLines).join('\n');
}
