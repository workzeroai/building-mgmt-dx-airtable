// 오류 요약 알림.
// - 서버 오류의 스택을 3줄로 요약해 웹훅(디스코드 형식)으로 보낸다. 웹훅이 없으면 콘솔에만 남긴다.
// - 기본은 규칙 기반 요약. ANTHROPIC_API_KEY가 있을 때만 LLM 요약을 시도하고, 실패하면 규칙 기반으로 돌아간다.
//   알림에는 어떤 방식으로 요약했는지(summarySource)를 그대로 적는다.
// - 같은 오류가 짧은 시간에 반복되면 한 번만 보내고 건수만 센다(1인 운영에서 알림 폭주 방지).
import path from 'node:path';
import { REPO_ROOT } from './paths.js';

const HINTS = {
  STAGING_ID_GUARD: '스테이징 매핑표(id-map.json)에 해당 ID가 있는지 확인',
  PDF_TIMEOUT: 'LibreOffice 프로세스 상태와 변환 큐 확인(xlsx는 정상 제공됨)',
  PDF_CONVERT_FAILED: 'LibreOffice 설치·글꼴 확인(xlsx는 정상 제공됨)',
  TEMPLATE_INVALID: '활성 양식 버전과 테스트 렌더 결과 확인, 필요하면 이전 버전으로 되돌리기',
  EXTERNAL_API_FAILED: '외부 API 키·응답 상태 확인',
  ENOENT: '파일 경로 확인',
  ETIMEDOUT: '외부 호출 시간 초과, 재시도 또는 상대 서비스 상태 확인',
};

/** 토큰·키처럼 보이는 값과 절대 경로를 가린다. */
export function sanitize(text, root = REPO_ROOT) {
  let out = String(text ?? '');
  const roots = [root, root.split(path.sep).join('/')].filter(Boolean);
  for (const r of roots) out = out.split(r).join('.');
  return out
    .replace(/(key|token|secret|password|serviceKey|confmKey)=([^&\s]+)/giu, '$1=***')
    .replace(/Bearer\s+[\w.-]+/gu, 'Bearer ***')
    .replace(/sk-[\w-]{10,}/gu, 'sk-***');
}

function firstAppFrame(stack) {
  const lines = String(stack ?? '').split('\n').slice(1).map((l) => l.trim());
  const frame = lines.find((l) => l.startsWith('at ') && !l.includes('node_modules') && !l.includes('node:'));
  return frame ? frame.replace(/^at\s+/u, '') : null;
}

export function summarizeByRules(err, context = {}) {
  const name = err?.name ?? 'Error';
  const message = String(err?.message ?? err).slice(0, 160);
  const where = firstAppFrame(err?.stack);
  const hint = HINTS[err?.code] ?? HINTS[err?.cause?.code] ?? '스택 전체는 서버 로그 확인';
  const request = context.method ? `${context.method} ${context.path}` : (context.where ?? '백그라운드 작업');
  return [
    `${name}${err?.code ? `(${err.code})` : ''}: ${message}`,
    `위치: ${where ?? '알 수 없음'} · 요청: ${request}`,
    `조치: ${hint}`,
  ].map((l) => sanitize(l));
}

/**
 * LLM 요약(선택). 키가 있을 때만 쓴다. 응답이 이상하면 null → 규칙 기반으로 대체.
 * @param {object} client Anthropic SDK 클라이언트(테스트에서 가짜 주입)
 */
export async function summarizeByLlm(client, model, err, context = {}) {
  const stack = sanitize(String(err?.stack ?? err)).slice(0, 4000);
  const response = await client.messages.create({
    model,
    max_tokens: 1024,
    output_config: { effort: 'low' },
    system: '너는 사내 견적 서버의 오류 알림을 쓰는 도우미다. 한국어로 정확히 3줄만 쓴다. 1줄: 무슨 오류인지, 2줄: 어디서(파일·요청), 3줄: 먼저 확인할 것. 추측은 "추정"이라고 쓴다.',
    messages: [{ role: 'user', content: `요청: ${context.method ?? '-'} ${context.path ?? '-'}\n오류 코드: ${err?.code ?? '-'}\n스택:\n${stack}` }],
  });
  if (response.stop_reason === 'refusal') return null;
  const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  const lines = text.split('\n').map((l) => l.replace(/^[-*\d.\s]+/u, '').trim()).filter(Boolean).slice(0, 3);
  return lines.length === 3 ? lines.map((l) => sanitize(l)) : null;
}

export function createNotifier({
  webhookUrl = '', fetchImpl = globalThis.fetch, llm = null, logger = console, dedupeMs = 10 * 60 * 1000, now = Date.now,
} = {}) {
  const recent = new Map();
  const stats = { sent: 0, suppressed: 0, logged: 0, llm: 0, rules: 0 };

  async function deliver(payload) {
    if (!webhookUrl) {
      stats.logged += 1;
      logger.error?.(`[알림] ${payload.embeds[0].title}\n${payload.embeds[0].description}`);
      return { delivered: false, channel: 'console' };
    }
    try {
      const res = await fetchImpl(webhookUrl, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
        signal: AbortSignal.timeout(5000),
      });
      stats.sent += 1;
      return { delivered: res.ok, channel: 'webhook', status: res.status };
    } catch (e) {
      logger.error?.(`[알림] 웹훅 전송 실패: ${e.message}`);
      return { delivered: false, channel: 'webhook', error: e.message };
    }
  }

  return {
    async summarize(err, context) {
      if (llm?.client) {
        try {
          const lines = await summarizeByLlm(llm.client, llm.model, err, context);
          if (lines) {
            stats.llm += 1;
            return { lines, source: 'llm' };
          }
        } catch (e) {
          logger.warn?.(`[알림] LLM 요약 실패 → 규칙 기반 요약: ${e.message}`);
        }
      }
      stats.rules += 1;
      return { lines: summarizeByRules(err, context), source: 'rules' };
    },

    async notifyError(err, context = {}) {
      const signature = `${err?.name}:${err?.code}:${String(err?.message).slice(0, 80)}`;
      const last = recent.get(signature);
      if (last && now() - last.at < dedupeMs) {
        last.count += 1;
        stats.suppressed += 1;
        return { suppressed: true, count: last.count };
      }
      recent.set(signature, { at: now(), count: 1 });
      const { lines, source } = await this.summarize(err, context);
      const payload = {
        username: 'quote-engine',
        embeds: [{
          title: `견적 서버 오류 · ${err?.code ?? err?.name ?? 'Error'}`,
          description: lines.join('\n'),
          color: 0xb91c1c,
          fields: [{ name: '요약 방식', value: source === 'llm' ? 'LLM 요약' : '규칙 기반 요약', inline: true }],
          timestamp: new Date(now()).toISOString(),
        }],
      };
      return { ...(await deliver(payload)), payload, summarySource: source };
    },

    /** 서킷브레이커 상태 변경 같은 운영 이벤트. */
    async notifyEvent(title, description, level = 'warning') {
      const color = { info: 0x0369a1, warning: 0xb45309, danger: 0xb91c1c, success: 0x15803d }[level] ?? 0x334155;
      return deliver({ username: 'quote-engine', embeds: [{ title, description: sanitize(description), color, timestamp: new Date(now()).toISOString() }] });
    },

    status: () => ({ channel: webhookUrl ? 'webhook' : 'console', llm: Boolean(llm?.client), ...stats }),
  };
}

/** 키가 있을 때만 SDK를 불러 LLM 요약기를 만든다. 없으면 null(규칙 기반만 사용). */
export async function createLlmFromEnv(env = process.env) {
  if (!env.ANTHROPIC_API_KEY) return null;
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  return { client: new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 1, timeout: 20_000 }), model: env.ANTHROPIC_MODEL || 'claude-opus-5-5' };
}
