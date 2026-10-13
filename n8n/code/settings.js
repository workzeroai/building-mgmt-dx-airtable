// n8n Code 노드 "동기화 설정" (Run Once for All Items)
// 가져온 뒤 아래 SETTINGS만 고친다. 다른 테이블(customers·staff)을 동기화하려면 워크플로를 복제해 tableKey만 바꾼다.

// ---- 여기만 고친다 ----
const SETTINGS = {
  hubBaseId: 'REPLACE_WITH_HUB_BASE_ID',
  divisionBaseId: 'REPLACE_WITH_DIVISION_BASE_ID',
  divisionId: 'fire',
  tableKey: 'buildings',
  label: 'GW 소방시설 점검',
};
// ---- 여기까지 ----

// ---- BEGIN GENERATED: config (npm run airtable:build) ----
const RULES = {
  "customers": {
    "key": "customers",
    "name": "고객",
    "sourceName": "고객",
    "fields": [
      "id",
      "name",
      "type",
      "region"
    ],
    "required": [
      "id",
      "name",
      "type"
    ],
    "idPattern": "^(stg_)?cus_[0-9a-z]+$",
    "kinds": {
      "id": "string",
      "name": "string",
      "type": "select",
      "region": "select"
    },
    "choices": {
      "type": [
        "법인",
        "관리단",
        "관리사무소",
        "개인사업자"
      ],
      "region": [
        "서울특별시",
        "부산광역시",
        "대구광역시",
        "인천광역시",
        "대전광역시",
        "경기도"
      ]
    },
    "links": {}
  },
  "buildings": {
    "key": "buildings",
    "name": "건물",
    "sourceName": "건물",
    "fields": [
      "id",
      "customerId",
      "roadAddress",
      "name",
      "mainPurpose",
      "totalArea",
      "groundFloors",
      "undergroundFloors"
    ],
    "required": [
      "id",
      "roadAddress",
      "name",
      "mainPurpose",
      "totalArea",
      "groundFloors",
      "undergroundFloors"
    ],
    "idPattern": "^(stg_)?bld_[0-9a-z]+$",
    "kinds": {
      "id": "string",
      "customerId": "string",
      "roadAddress": "string",
      "name": "string",
      "mainPurpose": "string",
      "totalArea": "number",
      "groundFloors": "integer",
      "undergroundFloors": "integer"
    },
    "choices": {},
    "links": {
      "customer": {
        "from": "customerId",
        "table": "customers"
      }
    }
  },
  "staff": {
    "key": "staff",
    "name": "담당자",
    "sourceName": "담당자",
    "fields": [
      "id",
      "name",
      "divisionId",
      "role",
      "active"
    ],
    "required": [
      "id",
      "name",
      "role",
      "active"
    ],
    "idPattern": "^(stg_)?stf_[0-9a-z]+$",
    "kinds": {
      "id": "string",
      "name": "string",
      "divisionId": "string",
      "role": "select",
      "active": "boolean"
    },
    "choices": {
      "role": [
        "점검원",
        "영업",
        "관리자"
      ]
    },
    "links": {}
  }
};
// ---- END GENERATED: config ----

const rule = RULES[SETTINGS.tableKey];
if (!rule) throw new Error(`동기화 규칙이 없는 테이블: ${SETTINGS.tableKey} (가능: ${Object.keys(RULES).join(', ')})`);
return [{
  json: {
    ...SETTINGS,
    sourceTable: rule.sourceName,
    targetTable: rule.name,
    runsTable: '동기화 기록',
    errorsTable: '자동화 오류',
    startedAt: new Date().toISOString(),
  },
}];
