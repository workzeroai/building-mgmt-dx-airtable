// n8n Code 노드 흉내(테스트 전용): "Run Once for All Items" 모드의 $input·$('노드')·items를 주고 jsCode를 실행한다.
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;

const wrap = (list) => list.map((json) => ({ json }));

/**
 * @param {string} jsCode 워크플로 JSON의 parameters.jsCode
 * @param {{input?: object[], nodes?: Record<string, object[]>}} data input = 들어오는 항목 json들, nodes = 다른 노드 출력
 * @returns {Promise<object[]>} 출력 항목의 json 목록
 */
export async function runCodeNode(jsCode, { input = [], nodes = {} } = {}) {
  const items = wrap(input);
  const $input = { all: () => items, first: () => items[0], last: () => items.at(-1) };
  const $ = (name) => {
    if (!(name in nodes)) throw new Error(`실행되지 않은 노드를 참조: ${name}`);
    const list = wrap(nodes[name]);
    return { all: () => list, first: () => list[0], last: () => list.at(-1) };
  };
  const out = await new AsyncFunction('$input', '$', 'items', jsCode)($input, $, items);
  if (!Array.isArray(out)) throw new Error('Code 노드는 항목 배열을 돌려줘야 합니다');
  for (const o of out) if (!o || typeof o.json !== 'object') throw new Error('항목은 {json: {...}} 형식이어야 합니다');
  return out.map((o) => o.json);
}

/** 에어테이블 REST 목록 응답 페이지들(HTTP Request 노드가 페이지마다 항목 1개를 낸다). */
export function restPages(records, pageSize = 100) {
  const pages = [];
  for (let i = 0; i < Math.max(records.length, 1); i += pageSize) {
    const slice = records.slice(i, i + pageSize);
    pages.push({ records: slice, ...(i + pageSize < records.length ? { offset: String(i + pageSize) } : {}) });
  }
  return pages;
}
