// [에어테이블 자동화 스크립트] 상태 전이 가드 — 그리드웰 빌딩서비스(가상) 사업부 Base
//
// 트리거: 견적·계약·점검 일정·청구에서 레코드가 수정될 때(감시 필드: status)
// 입력 변수(input.config): tableName = 트리거 테이블 이름, recordId = 트리거 레코드 ID
// 동작:
//   - 허용된 전이(예: 견적 draft → sent)면 statusConfirmed에 새 상태를 기록한다
//   - 허용되지 않은 전이(예: 견적 won → draft)면 status를 statusConfirmed로 되돌리고 statusNote에 사유를 남긴다
//   - 되돌리면 이 자동화가 한 번 더 돌지만 "변경 없음"으로 끝난다(무한 반복 없음)
//   - 스크립트 자체가 실패하면 자동화 오류 테이블에 남기고 실패로 끝낸다(오류 알림 스크립트가 모아 보냄)
// 에어테이블에는 "이전 값"이 없어서, 가드가 마지막으로 허용한 상태를 statusConfirmed에 따로 둔다.

// ---- BEGIN GENERATED: config (npm run airtable:build) ----
const FLOWS = {
  "견적": {
    "field": "status",
    "transitions": {
      "draft": [
        "sent",
        "lost"
      ],
      "sent": [
        "won",
        "lost",
        "draft"
      ],
      "won": [],
      "lost": [
        "draft"
      ]
    }
  },
  "계약": {
    "field": "status",
    "transitions": {
      "pending": [
        "active",
        "terminated"
      ],
      "active": [
        "expired",
        "terminated"
      ],
      "expired": [],
      "terminated": []
    }
  },
  "점검 일정": {
    "field": "status",
    "transitions": {
      "scheduled": [
        "done",
        "missed",
        "cancelled"
      ],
      "missed": [
        "scheduled",
        "cancelled"
      ],
      "done": [],
      "cancelled": []
    }
  },
  "청구": {
    "field": "status",
    "transitions": {
      "issued": [
        "paid",
        "overdue",
        "void"
      ],
      "overdue": [
        "paid",
        "void"
      ],
      "paid": [],
      "void": []
    }
  }
};
// ---- END GENERATED: config ----

// ---- BEGIN GENERATED: lib/status.js ----
// 상태 전이 판정(순수 함수). 빌드가 status-guard.js에 그대로 넣는다.

/**
 * @param {Record<string, string[]>} transitions { 현재 상태: [갈 수 있는 상태…] }
 * @param {string|null} confirmed 가드가 마지막으로 허용한 상태(처음이면 null)
 * @param {string|null} current 지금 셀 값
 * @returns {{action: 'accept'|'reject'|'noop', reason: string}}
 */
function checkTransition(transitions, confirmed, current) {
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
function appendNote(previous, line, maxLines = 20) {
  const lines = String(previous || '').split('\n').filter(Boolean);
  lines.push(line);
  return lines.slice(-maxLines).join('\n');
}
// ---- END GENERATED: lib/status.js ----

const AUTOMATION = 'statusGuard';

async function recordError(tableName, recordId, message) {
  try {
    await base.getTable('자동화 오류').createRecordAsync({
      id: `err_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      automation: AUTOMATION,
      stage: { name: 'error' },
      tableName,
      recordId,
      message,
      occurredAt: new Date().toISOString(),
      notified: false,
    });
  } catch (e) {
    console.error(`자동화 오류 기록 실패: ${e.message}`);
  }
}

async function main() {
  const { tableName, recordId } = input.config();
  const flow = FLOWS[tableName];
  if (!flow) throw new Error(`상태 전이 규칙이 없는 테이블: ${tableName}`);
  const table = base.getTable(tableName);
  const record = await table.selectRecordAsync(recordId, { fields: ['id', flow.field, 'statusConfirmed', 'statusNote'] });
  if (!record) {
    output.set('verdict', 'missing');
    return;
  }
  const current = record.getCellValueAsString(flow.field) || null;
  const confirmed = record.getCellValueAsString('statusConfirmed') || null;
  const verdict = checkTransition(flow.transitions, confirmed, current);
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');

  if (verdict.action === 'accept') {
    await table.updateRecordAsync(record.id, {
      statusConfirmed: current,
      statusNote: appendNote(record.getCellValueAsString('statusNote'), `${stamp} 허용: ${verdict.reason}`),
    });
  } else if (verdict.action === 'reject') {
    await table.updateRecordAsync(record.id, {
      [flow.field]: confirmed ? { name: confirmed } : null,
      statusNote: appendNote(record.getCellValueAsString('statusNote'), `${stamp} 되돌림: ${verdict.reason}`),
    });
  }
  output.set('verdict', verdict.action);
  output.set('reason', verdict.reason);
  output.set('recordKey', record.getCellValueAsString('id'));
}

try {
  await main();
} catch (e) {
  const cfg = input.config();
  await recordError(cfg.tableName, cfg.recordId, e.message);
  throw e;
}
