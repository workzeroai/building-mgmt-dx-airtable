# 사업부 추가하기 — mechanical은 파일 2개로 붙었다

견적 엔진은 **공통 엔진(core) + 사업부 설정(config.js) + 데이터(단가·양식)** 3층으로 나뉜다.
core는 사업부 이름을 모른다. 레지스트리가 `quote-engine/src/divisions/*/config.js`를 훑어 등록하므로, 새 사업부는 폴더와 단가 파일만 추가하면 된다.

이 문서는 세 번째 사업부 **기계설비 유지관리(mechanical)** 를 붙인 과정을 그대로 적는다. 모든 단가·계수는 지어낸 값이다(가상 회사 "그리드웰 빌딩서비스").

| 순서 | 사업부 | 계산 방식 |
|---|---|---|
| 1 | 소방시설 점검 `fire` | 연면적 구간 × 용도 계수 × 점검 등급 + 층수 가산 |
| 2 | 통신설비 점검 `telecom` | 설비 수량 × 단가 × 건물 규모 계수, 연간 계약 할인 |
| 3 | 기계설비 유지관리 `mechanical` | 설비 종류별 수량 × 단가 × 방문 횟수 + 출동비 − 방문 주기 할인 |

## 바뀐 파일

```text
quote-engine/src/divisions/mechanical/config.js   ← 새 파일 1
data/pricing/mechanical.json                      ← 새 파일 2
quote-engine/src/core/**                          ← 변경 없음
```

테스트가 이것을 증명한다: [`quote-engine/test/registry.test.js`](../quote-engine/test/registry.test.js)
- `core는 사업부 이름을 하나도 모른다` — core 코드에 사업부 ID·이름이 한 줄도 없다.
- `3번째 사업부: …mechanical 폴더만 추가 → core 그대로 견적 생성` — 사업부 2개로 운영 중인 저장소에 `mechanical/config.js`만 복사해 넣고 다시 시작하면, 사업부 테이블·단가·기본 양식이 자동으로 생기고 견적이 나온다. 테스트 전후 core 파일 전체의 해시가 같다.

## 1단계 — 단가 파일 만들기: `data/pricing/mechanical.json`

현업이 코드 없이 고치는 값이다. 엔진은 이 파일을 **번들 기본값**으로 쓰고(저장소 장애 시 폴백), 처음 시작할 때 저장소 `pricing` 테이블에 한 번 적재한다. 이후 수정은 관리자 화면(`/admin.html`)에서 한다.

```json
{
  "divisionId": "mechanical",
  "version": "2026-10-01",
  "source": "가상",
  "vatRate": 0.1,
  "rounding": 1000,
  "unitPerVisit": { "boilers": 42000, "chillers": 65000, "ahus": 28000, "pumps": 9000, "fans": 6000 },
  "visitFee": 30000,
  "cycles": {
    "월":   { "visitsPerYear": 12, "discountRate": 0.1 },
    "분기": { "visitsPerYear": 4,  "discountRate": 0 }
  }
}
```

## 2단계 — 설정 파일 만들기: `quote-engine/src/divisions/mechanical/config.js`

설정은 다른 파일을 import하지 않는 순수한 객체다. 레지스트리가 아래 키를 검사하고, 빠졌거나 형식이 틀리면 어떤 키가 왜 틀렸는지 알려 주며 시작을 멈춘다.

| 키 | 하는 일 | mechanical 값 |
|---|---|---|
| `id`·`code`·`name`·`order` | 폴더 이름과 같은 ID, 견적번호 코드, 표시 이름, 확산 순서 | `mechanical` · `MECH` · 기계설비 유지관리 · 3 |
| `inputs` | 화면 조건 입력 칸(숫자·선택). **화면이 이 목록으로 입력 폼을 만든다** | 보일러·냉동기·공조기·펌프·급배기팬 대수, 방문 주기(월/분기) |
| `pricingKeys` | 단가표에 꼭 있어야 하는 키. 없으면 저장소 단가 대신 번들값으로 폴백하고, 관리자 저장도 거부 | `unitPerVisit`, `visitFee`, `cycles`, `vatRate`, `rounding` |
| `outputSheet` | 엑셀 양식의 시트 이름 | `견적서` |
| `template` | 기본 양식 사양(제목, 사업부 값 자리, 항목 칸 수, 주석) | 제목 "기계설비 유지관리 견적서", `{{cycle}}`·`{{period}}`, 9칸 |
| `sample` | 양식 **테스트 렌더**에 쓰는 샘플 입력 | 교육시설 2,100㎡, 설비 21대, 월 방문 |
| `calculateCosts(input, pricing)` | 금액 계산. `{items[{code,name,basis,amount}], subtotal, vat, total, meta}` | 아래 |
| `excelMapping(result)` | 계산 결과 → 양식 값 자리 `{fields, items}` | `cycle: "월 1회 (연 12회)"` 등 |

```js
calculateCosts({ conditions }, pricing) {
  const { visitsPerYear: visits, discountRate } = pricing.cycles[conditions.cycle];
  const items = EQUIPMENT.filter((e) => conditions[e.key] > 0).map((e) => ({
    code: e.key, name: `${e.label} 점검`,
    basis: `${conditions[e.key]}대 × ${won(pricing.unitPerVisit[e.key])} × 연 ${visits}회`,
    amount: conditions[e.key] * pricing.unitPerVisit[e.key] * visits,
  }));
  items.push({ code: 'visit', name: '출동비', basis: `…`, amount: pricing.visitFee * visits });
  // 방문 주기 할인 → subtotal · vat · total
}
```

core가 공통으로 지키게 하는 것(사업부가 신경 쓰지 않아도 됨):
- 조건값 검사: `inputs`의 기본값·숫자 범위·선택지(`resolveConditions`)
- 금액 검사: 항목 합 = 공급가액, 공급가액 + 부가세 = 합계, 금액은 정수(`checkResult`)
- 공통 값 자리: 견적번호·견적일·고객·주소·건물명·연면적·층수·공급가액·부가세·합계·단가 출처·양식 버전

## 3단계 — 시작하면 자동으로 되는 일

`npm start` 또는 `npm run quote:demo`를 실행하면 엔진이 새 사업부를 발견하고:

1. `divisions` 테이블에 `mechanical` 레코드를 추가한다(`syncDivisions`).
2. `pricing` 테이블에 `data/pricing/mechanical.json`을 적재한다(`syncPricing`).
3. `template` 사양으로 기본 양식 v1을 만들어 **업로드 → 테스트 렌더(샘플로 실제 채움) → 활성화**한다(`ensureDefaults`). 테스트에 실패하면 시작을 멈춘다.
4. 화면 사업부 목록에 3번째 타일이 생기고, 조건 입력 칸이 `inputs`대로 그려진다.

## 4단계 — 검증

```bash
npm test                 # 사업부별 계산 테스트 + 레지스트리(core 무변경) 테스트
npm run quote:demo       # 3개 사업부 견적 xlsx·PDF
```

계산 테스트는 손으로 계산한 금액을 고정한다([`divisions.test.js`](../quote-engine/test/divisions.test.js)). 예: 보일러 2·냉동기 1·공조기 3·펌프 6·급배기팬 8, 월 방문 → 공급가액 3,942,000원, 합계 4,336,200원(가상 단가 기준).

## 네 번째 사업부를 붙일 때 체크리스트

- [ ] `quote-engine/src/divisions/<id>/config.js` — 폴더 이름 = `id`, `code`는 대문자 2~6자
- [ ] `data/pricing/<id>.json` — `pricingKeys`의 키가 모두 있음, `"source": "가상"`
- [ ] `inputs`의 select 기본값이 선택지 안에 있음
- [ ] `excelMapping().fields`가 `template.fields`의 키를 모두 채움, 항목 수 ≤ `template.itemRows`
- [ ] `quote-engine/test/divisions.test.js`에 손계산 금액 테스트 추가
- [ ] core 파일은 열지 않는다
