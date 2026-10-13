// n8n/sync-safety.json 생성: Code 노드 JS(n8n/code/*.js)에 스키마의 동기화 규칙과 공용 판정 코드를 넣어 워크플로 하나로 조립한다.
// - 자격증명은 비워 둔다(가져온 뒤 HTTP 노드마다 Airtable Personal Access Token 자격증명을 고른다)
// - 노드 id는 이름에서 만든 UUIDv5라 다시 만들어도 같은 파일이 나온다
// - 에어테이블 호출은 모두 HTTP Request(REST)로 한다: 응답 모양({records, offset})이 분명하고 Code 노드가 그대로 읽는다
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { N8N_DIR } from './paths.js';
import { constDecl, injectBlocks, libSource } from './inline.js';
import { syncRules } from './schema.js';

export const WORKFLOW_FILE = path.join(N8N_DIR, 'sync-safety.json');
export const WEBHOOK_PLACEHOLDER = 'https://hooks.example.com/REPLACE_WITH_YOUR_WEBHOOK';
const NS = '3b0f6a52-9c1e-4d7a-8f20-5e6b7c8d9a01';
const API = 'https://api.airtable.com/v0/';

/** RFC 4122 UUIDv5(SHA-1). */
export function uuid5(name, namespace = NS) {
  const ns = Buffer.from(namespace.replace(/-/gu, ''), 'hex');
  const hash = crypto.createHash('sha1').update(Buffer.concat([ns, Buffer.from(name, 'utf8')])).digest();
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const h = hash.subarray(0, 16).toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function codeNodeSources(model, dir = path.join(N8N_DIR, 'code')) {
  const { tables, ...sync } = syncRules(model);
  const config = `${constDecl('SYNC', sync)}\n${constDecl('RULES', tables)}`;
  const core = libSource('sync-core.js');
  const read = (f) => fs.readFileSync(path.join(dir, f), 'utf8');
  return {
    settings: injectBlocks(read('settings.js'), { config: constDecl('RULES', tables) }),
    plan: injectBlocks(read('plan.js'), { config, 'lib/sync-core.js': core }),
    summary: injectBlocks(read('summary.js'), { config: constDecl('RULES', tables), 'lib/sync-core.js': core }),
    errorRows: read('error-rows.js').replace(/\r\n/gu, '\n'),
  };
}

/** Code 노드 원본 파일에도 같은 생성 구간을 채워 둔다(읽기·린트용. 워크플로 JSON의 jsCode와 같은 코드). */
export function codeOutputs(model, dir = path.join(N8N_DIR, 'code')) {
  const src = codeNodeSources(model, dir);
  return new Map([
    [path.join(dir, 'settings.js'), src.settings],
    [path.join(dir, 'plan.js'), src.plan],
    [path.join(dir, 'summary.js'), src.summary],
  ]);
}

const cfg = (key) => `$('동기화 설정').first().json.${key}`;
const tableUrl = (baseKey, tableKey) => `={{ '${API}' + ${cfg(baseKey)} + '/' + encodeURIComponent(${cfg(tableKey)}) }}`;

function node(name, type, typeVersion, position, parameters, extra = {}) {
  return { parameters, id: uuid5(name), name, type, typeVersion, position, ...extra };
}

function airtableHttp(name, position, { method = 'GET', url, query = null, body = null, paginate = false, batching = false }, extra = {}) {
  const parameters = {
    method,
    url,
    authentication: 'predefinedCredentialType',
    nodeCredentialType: 'airtableTokenApi',
  };
  if (query) {
    parameters.sendQuery = true;
    parameters.queryParameters = { parameters: query.map(([n, v]) => ({ name: n, value: v })) };
  }
  if (body) {
    parameters.sendBody = true;
    parameters.specifyBody = 'json';
    parameters.jsonBody = body;
  }
  parameters.options = {};
  if (paginate) {
    parameters.options.pagination = {
      pagination: {
        parameters: { parameters: [{ type: 'qs', name: 'offset', value: '={{ $response.body.offset }}' }] },
        paginationCompleteWhen: 'other',
        completeExpression: '={{ $response.body.offset === undefined }}',
      },
    };
  }
  if (batching) parameters.options.batching = { batch: { batchSize: 5, batchInterval: 1100 } }; // 에어테이블 한도 초당 5회
  return node(name, 'n8n-nodes-base.httpRequest', 4.2, position, parameters, extra);
}

function webhook(name, position, textExpr) {
  return node(name, 'n8n-nodes-base.httpRequest', 4.2, position, {
    method: 'POST',
    url: WEBHOOK_PLACEHOLDER,
    sendBody: true,
    specifyBody: 'json',
    jsonBody: `={{ JSON.stringify({ content: ${textExpr}, text: ${textExpr} }) }}`,
    options: {},
  }, { onError: 'continueRegularOutput' });
}

function ifNode(name, position, leftValue, operation, rightValue) {
  return node(name, 'n8n-nodes-base.if', 2, position, {
    conditions: {
      options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
      conditions: [{ id: uuid5(`${name}-cond`), leftValue, rightValue, operator: { type: 'string', operation } }],
      combinator: 'and',
    },
    options: {},
  });
}

function setNode(name, position, assignments) {
  return node(name, 'n8n-nodes-base.set', 3.4, position, {
    mode: 'manual',
    assignments: { assignments: assignments.map(([n, v]) => ({ id: uuid5(`${name}-${n}`), name: n, value: v, type: 'string' })) },
    includeOtherFields: false,
    options: {},
  });
}

function sticky(name, position, content, width, height, color) {
  return node(name, 'n8n-nodes-base.stickyNote', 1, position, { content, height, width, color });
}

const code = (name, position, jsCode) => node(name, 'n8n-nodes-base.code', 2, position, { mode: 'runOnceForAllItems', jsCode });

export function buildWorkflow(model) {
  const src = codeNodeSources(model);
  const rules = syncRules(model);
  const pct = Math.round(rules.maxDropRatio * 100);
  const loopItem = (k) => `={{ $('건별 반영').item.json.${k} }}`;
  const nodes = [
    sticky('안내', [-40, -500], `## 허브 → 사업부 동기화 안전장치 (그리드웰 빌딩서비스, 가상)\n일정 → 허브 원본 조회 → **건수 급감 검사** → **건 단위 반영**(실패 건은 별도 분기) → 동기화 기록 + 결과 요약 알림\n\n가져온 뒤 할 일: ① "동기화 설정" Code 노드의 SETTINGS(Base ID·사업부·테이블) ② 에어테이블을 부르는 HTTP 노드 8개에 Airtable Personal Access Token 자격증명 ③ 알림 노드 2개의 웹훅 URL\n\n판정 코드는 에어테이블 스크립트(airtable/automations/scripts/sync-safety.js)와 같다.`, 820, 240, 5),
    sticky('안전장치', [1240, -500], `### 안전장치\n- 원본 건수가 직전 정상 실행 대비 **${pct}% 넘게 줄면 반영 중단** + 기록 + 알림\n- 검증 실패 건은 쓰지 않고 건너뜀으로 기록\n- 쓰기 실패 건은 **오류 출력**으로 빠져 나머지는 계속 반영\n- 허브에서 사라진 건은 지우지 않고 hubMissing 표시\n- 결과는 동기화 기록(다음 실행의 비교 기준)과 자동화 오류에 남김`, 640, 240, 3),
    node('매시 실행', 'n8n-nodes-base.scheduleTrigger', 1.2, [0, 0], { rule: { interval: [{ field: 'hours', hoursInterval: 1 }] } }),
    code('동기화 설정', [220, 0], src.settings),
    airtableHttp('직전 동기화 기록 조회', [440, 0], {
      url: tableUrl('divisionBaseId', 'runsTable'),
      query: [
        ['filterByFormula', `={{ "AND({tableKey}='" + ${cfg('tableKey')} + "', OR({status}='ok', {status}='partial'))" }}`],
        ['sort[0][field]', 'startedAt'],
        ['sort[0][direction]', 'desc'],
        ['maxRecords', '1'],
      ],
    }, { alwaysOutputData: true }),
    airtableHttp('허브 원본 조회', [660, 0], { url: tableUrl('hubBaseId', 'sourceTable'), query: [['pageSize', '100']], paginate: true }, { executeOnce: true }),
    airtableHttp('사본 조회', [880, 0], {
      url: tableUrl('divisionBaseId', 'targetTable'),
      query: [['pageSize', '100'], ['fields[]', 'id'], ['fields[]', 'syncHash'], ['fields[]', 'hubMissing']],
      paginate: true,
    }, { executeOnce: true, alwaysOutputData: true }),
    code('반영 계획', [1100, 0], src.plan),
    ifNode('반영 중단?', [1320, 0], '={{ $json.kind }}', 'equals', 'abort'),
    airtableHttp('중단 기록', [1540, -200], { method: 'POST', url: tableUrl('divisionBaseId', 'runsTable'), body: '={{ JSON.stringify($json.runBody) }}' }),
    airtableHttp('중단 오류 기록', [1760, -200], { method: 'POST', url: tableUrl('divisionBaseId', 'errorsTable'), body: "={{ JSON.stringify($('반영 계획').first().json.errorBody) }}" }),
    webhook('중단 알림', [1980, -200], "$('반영 계획').first().json.alertText"),
    node('건별 반영', 'n8n-nodes-base.splitInBatches', 3, [1540, 200], { batchSize: 10, options: {} }),
    ifNode('쓸 건?', [1760, 340], '={{ $json.kind }}', 'notEquals', 'marker'),
    airtableHttp('사본 반영', [1980, 320], { method: 'PATCH', url: tableUrl('divisionBaseId', 'targetTable'), body: '={{ JSON.stringify($json.body) }}', batching: true }, { onError: 'continueErrorOutput' }),
    setNode('반영 완료 표시', [2200, 240], [['outcome', 'done'], ['kind', loopItem('kind')], ['id', loopItem('id')]]),
    setNode('반영 실패 표시', [2200, 420], [['outcome', 'failed'], ['kind', loopItem('kind')], ['id', loopItem('id')], ['reason', "={{ $json.error ? ($json.error.message || JSON.stringify($json.error)) : '쓰기 실패' }}"]]),
    code('결과 요약', [1760, 620], src.summary),
    airtableHttp('동기화 기록 저장', [1980, 560], { method: 'POST', url: tableUrl('divisionBaseId', 'runsTable'), body: '={{ JSON.stringify($json.runBody) }}' }),
    webhook('결과 알림', [2200, 560], "$('결과 요약').first().json.alertText"),
    code('오류 행 만들기', [1980, 720], src.errorRows),
    airtableHttp('오류 기록', [2200, 720], { method: 'POST', url: tableUrl('divisionBaseId', 'errorsTable'), body: '={{ JSON.stringify($json.body) }}', batching: true }),
  ];
  const link = (to, index = 0) => ({ node: to, type: 'main', index });
  const connections = {
    '매시 실행': { main: [[link('동기화 설정')]] },
    '동기화 설정': { main: [[link('직전 동기화 기록 조회')]] },
    '직전 동기화 기록 조회': { main: [[link('허브 원본 조회')]] },
    '허브 원본 조회': { main: [[link('사본 조회')]] },
    '사본 조회': { main: [[link('반영 계획')]] },
    '반영 계획': { main: [[link('반영 중단?')]] },
    '반영 중단?': { main: [[link('중단 기록')], [link('건별 반영')]] },
    '중단 기록': { main: [[link('중단 오류 기록')]] },
    '중단 오류 기록': { main: [[link('중단 알림')]] },
    '건별 반영': { main: [[link('결과 요약')], [link('쓸 건?')]] },
    '쓸 건?': { main: [[link('사본 반영')], [link('건별 반영')]] },
    '사본 반영': { main: [[link('반영 완료 표시')], [link('반영 실패 표시')]] },
    '반영 완료 표시': { main: [[link('건별 반영')]] },
    '반영 실패 표시': { main: [[link('건별 반영')]] },
    '결과 요약': { main: [[link('동기화 기록 저장'), link('오류 행 만들기')]] },
    '동기화 기록 저장': { main: [[link('결과 알림')]] },
    '오류 행 만들기': { main: [[link('오류 기록')]] },
  };
  return {
    name: '허브 → 사업부 동기화 안전장치 (가상: 그리드웰 빌딩서비스)',
    nodes,
    pinData: {},
    connections,
    active: false,
    settings: { executionOrder: 'v1' },
    tags: [],
  };
}

export const renderWorkflow = (model) => `${JSON.stringify(buildWorkflow(model), null, 2)}\n`;
