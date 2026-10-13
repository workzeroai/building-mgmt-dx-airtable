// 서킷브레이커: 연속 실패가 기준에 닿으면 "열림"으로 바꿔 일정 시간 호출을 막는다.
// 닫힘(closed) → 연속 실패 N회 → 열림(open) → 대기 시간 경과 → 반열림(half-open, 시험 1건)
//   시험 성공 → 닫힘 / 시험 실패 → 다시 열림
export function createCircuitBreaker({
  name = 'breaker',
  failureThreshold = 3,
  cooldownMs = 60_000,
  now = Date.now,
  onStateChange = () => {},
} = {}) {
  let state = 'closed';
  let failures = 0;
  let openedAt = null;
  let lastError = null;

  function transition(next, reason) {
    if (next === state) return;
    const prev = state;
    state = next;
    onStateChange({ name, from: prev, to: next, reason, failures, retryAt: retryAt() });
  }

  function retryAt() {
    return state === 'open' && openedAt !== null ? openedAt + cooldownMs : null;
  }

  return {
    /** 지금 호출해도 되는가. 열림 상태에서 대기 시간이 지났으면 반열림으로 바꾸고 true. */
    canRequest() {
      if (state === 'open' && now() >= openedAt + cooldownMs) {
        transition('half-open', '대기 시간 경과, 시험 호출 허용');
      }
      return state !== 'open';
    },
    recordSuccess() {
      failures = 0;
      lastError = null;
      openedAt = null;
      transition('closed', '호출 성공');
    },
    recordFailure(error) {
      failures += 1;
      lastError = error?.message ?? String(error);
      if (state === 'half-open' || failures >= failureThreshold) {
        if (state === 'open') return; // 이미 열린 상태의 늦은 실패는 대기 시간을 늘리지 않는다
        openedAt = now(); // 반열림 시험 실패면 대기 시간을 새로 센다
        transition('open', `연속 실패 ${failures}회: ${lastError}`);
      }
    },
    status() {
      return { name, state, failures, failureThreshold, cooldownMs, openedAt, retryAt: retryAt(), lastError };
    },
  };
}
