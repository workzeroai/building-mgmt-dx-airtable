# 데이터 계약 (Data Contract)

견적 엔진(`quote-engine/`)과 에어테이블 데이터 설계(`airtable/`, 6-2)가 **같은 모양의 데이터**를 쓰도록 정한 약속이다.
원본은 [`data/schema/*.schema.json`](../data/schema/) (JSON Schema 2020-12 + `x-` 확장)이고, 이 문서는 그 요약이다. 둘이 다르면 스키마 파일이 맞다.

- 모든 데이터는 가상이다. 시드는 [`quote-engine/scripts/generate-data.js`](../quote-engine/scripts/generate-data.js)가 고정 시드로 만든다(`npm run data:generate`).
- 엔진의 저장소 어댑터(로컬 JSON·에어테이블)는 쓰기 전에 이 계약으로 레코드를 검사한다(`quote-engine/src/core/store/schema.js`). 계약에 없는 필드·타입 오류·허용 값 밖이면 쓰지 않는다.

## 1. 엔티티 한눈에 보기

```text
divisions ─┐ (코드 레지스트리의 사본)
           │
customers ─┼─< buildings ─┐
           │              │
           └──────────< quotes >── templateVersions
                          │
                          └──< contracts
pricing (사업부별 1건)
```

| 테이블 (`x-table`) | 이름 | ID 형식 | 에어테이블 테이블 | 기본(primary) 필드 | 연결(`x-links`) | 시드 건수 |
|---|---|---|---|---|---|---|
| `divisions` | 사업부 | `fire` 같은 폴더 이름 | 사업부 | `id` | — | 3 |
| `customers` | 고객 | `cus_0001` | 고객 | `id` | — | 24 |
| `buildings` | 건물 | `bld_0001` | 건물 | `id` | `customerId → customers` | 36 |
| `quotes` | 견적 | `quo_0001` | 견적 | `quoteNo` | `customerId → customers`, `buildingId → buildings`, `templateVersionId → templateVersions` | 86 |
| `contracts` | 계약 | `con_0001` | 계약 | `contractNo` | `quoteId → quotes`, `customerId → customers`, `buildingId → buildings` | 31 |
| `pricing` | 단가 | `prc_fire`(시드) · `prc_0001`(이후 생성) | 단가 | `id` | — | 3 |
| `templateVersions` | 양식 버전 | `tpl_0001` | 양식 버전 | `id` | — | 사업부당 1+ |

- `divisionId`는 모든 테이블에서 **코드가 정한 사업부 ID**(`fire`·`telecom`·`mechanical`)다. 환경(운영·스테이징)과 무관하게 같으므로 스테이징 ID 가드의 변환 대상이 아니다.
- 스테이징 저장소의 ID는 운영 ID 앞에 `stg_`가 붙는다(예: `stg_cus_0001`). 모든 `pattern`이 `^(stg_)?…`로 두 형태를 다 받는다.

## 2. 테이블별 필드

`*` = 필수. 타입은 JSON 기준(에어테이블 필드 유형 제안은 오른쪽 열).

### customers (고객) — 공통 엔티티

| 필드 | 타입 | 설명 | 에어테이블 유형(제안) |
|---|---|---|---|
| `id`* | string | `cus_` + 4자리 | 한 줄 텍스트(기본 필드) |
| `name`* | string | 고객명(가상) | 한 줄 텍스트 |
| `type`* | enum | 법인 · 관리단 · 관리사무소 · 개인사업자 | 단일 선택 |
| `region` | string\|null | 시도 | 단일 선택 |
| `contactEmail` | string\|null | `example.com`만 | 이메일 |
| `note` | string\|null | | 긴 텍스트 |
| `createdAt`* / `updatedAt` | string | ISO 8601 | 날짜(시간 포함) |

### buildings (건물) — 공통 엔티티

| 필드 | 타입 | 설명 |
|---|---|---|
| `id`* | string | `bld_` + 4자리 |
| `customerId` | string\|null | → customers.id (에어테이블에서는 연결 레코드) |
| `roadAddress`* | string | 도로명주소(건물 단위). 같은 주소면 같은 레코드를 다시 씀 |
| `jibunAddress` | string\|null | |
| `admCd`* | string(10) | 법정동코드 = 시군구 5 + 법정동 5 |
| `registerKey` | string\|null | 대장 조회 키 `sigunguCd-bjdongCd-platGbCd-bun-ji` |
| `adminCodeFallback` | object\|null | 구 행정코드로 재조회한 경우 `{from, to, reason}` (에어테이블: JSON 긴 텍스트) |
| `name`* · `mainPurpose`* | string | 건물명, 주용도(대장 `mainPurpsCdNm`) |
| `totalArea`* | number | 연면적 ㎡(여러 동은 합계) |
| `groundFloors`* · `undergroundFloors`* | integer | 층수(여러 동은 최댓값) |
| `dongCount` | integer | 대장 표제부 동 수 |
| `approvalDate` | string\|null | 사용승인일 `YYYYMMDD` |
| `source`* | enum | `fixture`(가짜 응답) · `live`(실제 API) · `seed`(생성 스크립트) |

### quotes (견적) — 공통 필드 + 사업부 확장

| 필드 | 타입 | 설명 |
|---|---|---|
| `id`* | string | `quo_` + 4자리 |
| `quoteNo`* | string | `GW-{사업부코드}-{YYYYMMDD}-{일련번호 3자리}` 예: `GW-TEL-20261013-001` |
| `divisionId`* | string | 사업부 ID |
| `customerId` | string\|null | → customers.id |
| `buildingId`* | string | → buildings.id |
| `conditions`* | object | **사업부 확장**: `config.inputs` 값. fire `{grade}`, telecom `{lines, switches, terminalBoxes, contract}`, mechanical `{boilers, chillers, ahus, pumps, fans, cycle}` |
| `items`* | array | **사업부 확장**: `[{code, name, basis, amount}]` 산출 항목 |
| `subtotal`* · `vat`* · `total`* | integer | 원. `Σ items.amount = subtotal`, `subtotal + vat = total`(엔진이 검사) |
| `pricingSource`* | enum | `store` · `cache` · `fallback` — 계산에 쓴 단가의 출처 |
| `pricingVersion` | string\|null | 단가표 버전 |
| `templateVersionId` · `templateVersion` | string\|null · integer\|null | 견적서를 만든 양식 버전(생성 스크립트로 만든 과거 견적은 null) |
| `files` | object\|null | `{xlsx, pdf}` 저장소 기준 상대 경로 |
| `pdfStatus` | enum\|null | `ok` · `skipped`(LibreOffice 없음) · `circuit-open` · `failed` |
| `status`* | enum | `draft` · `sent` · `won` · `lost` |

에어테이블에서는 `conditions`·`items`·`files`를 **JSON 긴 텍스트**로 저장한다(`x-airtable.jsonFields`). 사업부별로 자주 보는 값(예: fire 점검 등급)은 6-2에서 수식 필드로 꺼내 보는 것을 권한다.

### contracts (계약)

| 필드 | 타입 | 설명 |
|---|---|---|
| `id`* | string | `con_` + 4자리 |
| `contractNo`* | string | `GW-C-{YYYY}-{일련번호}` |
| `quoteId`* | string | → quotes.id (수주 `won` 견적에서만 생성) |
| `customerId` · `buildingId`* · `divisionId`* | string | 견적에서 복사 |
| `startDate`* · `endDate`* | string | `YYYY-MM-DD`, 기본 12개월 |
| `annualAmount`* | integer | 연간 금액(원, VAT 포함) |
| `status`* | enum | `pending` · `active` · `expired` · `terminated` |

### pricing (단가) — 사업부당 1건

| 필드 | 타입 | 설명 |
|---|---|---|
| `id`* | string | `prc_…` |
| `divisionId`* | string | 사업부 ID(조회 키) |
| `version`* | string | 단가표 버전(날짜 문자열 권장) |
| `source`* | `"가상"` | 모든 단가는 지어낸 값 |
| `data`* | object | 사업부마다 모양이 다른 단가표. 필수 키는 각 `config.pricingKeys`. 번들 기본값 = `data/pricing/<id>.json` |
| `updatedBy` · `updatedAt`* | | 관리자 화면에서 고친 사람·시각 |

### templateVersions (양식 버전)

| 필드 | 타입 | 설명 |
|---|---|---|
| `id`* | string | `tpl_` + 4자리 |
| `divisionId`* | string | 사업부 ID |
| `version`* | integer | 사업부별 1부터 증가 |
| `status`* | enum | `uploaded` → `tested`/`failed` → `active` ↔ `inactive`. 사업부별 `active`는 1개 |
| `sha256`* · `size` | | 업로드 파일 지문 |
| `filePath`* | string | 저장소 폴더 기준 상대 경로(`templates/<division>/v2-xxxxxxxx.xlsx`) |
| `testReport` | object\|null | `{ok, errors[], warnings[], capacity, testedAt}` |
| `uploadedBy`·`uploadedAt`*·`activatedAt`·`deactivatedAt`·`note` | | 운영 기록 |

### divisions (사업부)

`id`*, `code`*(견적번호 코드 FIRE·TEL·MECH), `name`*, `order`*(확산 순서), `description`. 원본은 코드(`quote-engine/src/divisions/<id>/config.js`)이고, 엔진이 시작할 때 없는 사업부를 이 테이블에 추가한다.

## 3. 키와 규칙

- **조회 키**: 고객·건물·견적·계약은 `id`, 단가는 `divisionId`, 양식 버전은 `divisionId` + `status = active`, 건물 재사용은 `roadAddress`.
- **번호 규칙**: `quoteNo`는 사업부·날짜별 일련번호, `contractNo`는 연도별 일련번호.
- **금액 규칙**: 모든 금액은 정수(원). 항목 합 = 공급가액, 공급가액 + 부가세 = 합계(엔진의 `checkResult`가 검사).
- **시간**: ISO 8601 UTC 문자열.

## 4. 스테이징 ID 매핑표

스테이징 저장소(복제 베이스)는 레코드 ID가 운영과 다르다. 운영 ID를 들고 스테이징에 쓰지 않도록, 매핑표에 없는 ID로 쓰면 에러로 막는다(`quote-engine/src/core/store/guard.js`).

```json
// data/store/staging/id-map.json
{
  "tables": { "customers": { "cus_0001": "stg_cus_0001" }, "quotes": { "quo_0001": "stg_quo_0001" } },
  "created": { "quotes": ["stg_quo_0087"] }
}
```

- `tables`: 운영 ID → 스테이징 ID. 스테이징 쓰기에서 운영 ID가 오면 변환하고, 없으면 `STAGING_ID_GUARD`(409)로 차단.
- `created`: 스테이징에서 새로 만든 레코드. 이후 수정을 허용한다.
- 운영 쓰기에서 스테이징 ID가 섞이면 반대로 차단한다.
- 6-2의 에어테이블 베이스 복제 스크립트는 같은 형식의 매핑표를 만들어야 한다(운영 rec ID 대신 이 계약의 `id` 필드 값을 키로 쓴다).

## 5. 저장 위치

| 어댑터 | 위치 | 비고 |
|---|---|---|
| 로컬(기본) | `data/store/<production\|staging>/<table>.json` | 깃 제외. `npm run setup -- --reset`으로 다시 만든다 |
| 로컬 양식 파일 | `data/store/<target>/templates/<division>/v<n>-<sha8>.xlsx` | 메타데이터는 `templateVersions` |
| 에어테이블(선택) | `STORE_ADAPTER=airtable`, `AIRTABLE_TOKEN`, `AIRTABLE_BASE_ID` | 테이블 이름은 `x-airtable.table`, 우리 ID는 `id` 필드에 저장 |
| 시드 | `data/seed/{customers,buildings,quotes,contracts}.json` | 생성 스크립트 산출물(커밋) |
| 번들 단가 | `data/pricing/<division>.json` | 저장소 단가 조회 실패 시 폴백 |

## 6. 에어테이블 설계(airtable/)와의 관계

6-2에서 이 계약을 그대로 이어 에어테이블 구조를 만들었다. 단일 출처는 [`airtable/schema/gridwell.yaml`](../airtable/schema/gridwell.yaml)이고, 표는 [`docs/schema.md`](schema.md)(자동 생성).

1. **같은 이름·필드.** 7개 계약 테이블은 YAML에 `contract:`로 연결돼 있고, `airtable/lib/contract.js`가 테이블 이름(`x-airtable.table`)·기본 필드·필드 집합·타입·선택지(`enum`)·JSON 필드(`x-airtable.jsonFields`)·연결(`x-links` ↔ 연결 필드의 `from`)을 대조한다. 어긋나면 `npm test`가 실패한다.
2. **Base 배치(`x-airtable.base`).** `hub`(사업부·고객·건물)는 허브 Base, `division`(견적·계약·단가·양식 버전)은 사업부별 Base에 둔다. 견적 엔진은 `AIRTABLE_HUB_BASE_ID`·`AIRTABLE_BASE_ID_<사업부>`를 주면 이 배치대로 읽고 쓴다(`quote-engine/src/core/store/airtable-multi.js`). `AIRTABLE_BASE_ID` 하나만 주면 예전처럼 Base 하나에 7개 테이블.
3. **텍스트 ID + 연결.** 어댑터가 쓰는 텍스트 ID 필드(`customerId` 등)는 그대로 두고, 같은 Base 안에서 사람이 따라가는 연결 필드(`customer` 등)를 따로 둔다. 연결은 자동화가 텍스트 ID로 채운다.
4. **에어테이블 전용 필드.** 연결·룩업·수식·운영 필드(`businessNo`, `statusConfirmed` 등)는 계약 밖이다. 에어테이블 어댑터는 읽을 때 계약에 없는 필드를 버린다(그래야 `update`의 계약 검사를 통과한다).
5. **스테이징 매핑표.** `airtable/clone-staging.mjs`가 복제한 스테이징 Base의 ID에 `stg_`를 붙이고 §4와 같은 형식의 매핑표를 만든다(운영 rec ID가 아니라 이 계약의 `id` 값을 키로). 값이 `toStaging()`과 같은지 테스트로 확인한다.
6. **시드.** `data/seed/*.json`(이 계약을 지키는 가상 데이터)을 그대로 쓰고, 에어테이블 CSV(`data/seed/csv/`)와 운영 테이블 시드(`data/seed/ops/`)는 여기서 이어 만든다.
