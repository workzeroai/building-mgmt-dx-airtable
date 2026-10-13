# 장애 회고 4건 — 장애를 사람이 아니라 구조로 막기

회사에서 견적 도구를 운영하며 겪은 장애 유형 4가지를 **가상 회사 "그리드웰 빌딩서비스" 맥락으로 일반화**해 적었다. 날짜·피해 건수·고객 정보는 적지 않는다. 아래의 해결 코드는 회사 코드가 아니라 이 저장소에서 처음부터 다시 구현한 것이고, 각 장치에는 그 장애를 다시 일으켜 보는 테스트가 붙어 있다.

| # | 장애 | 한 줄 원인 | 막는 장치 | 코드 | 테스트 |
|---|---|---|---|---|---|
| 1 | PDF 동시 요청으로 변환이 멈춤 | 변환 프로그램을 동시에 여러 개 띄움, 시간 제한 없음 | 직렬 큐 · 건당 타임아웃·강제 종료 · 서킷브레이커 | [`pdf-queue.js`](../quote-engine/src/core/pdf-queue.js) | [`pdf-queue.test.js`](../quote-engine/test/pdf-queue.test.js) |
| 2 | 단가가 바뀔 때마다 배포 | 단가가 코드 안의 상수 | 단가 외부화 · 5분 캐시 · 번들 기본값 폴백 | [`pricing.js`](../quote-engine/src/core/pricing.js) | [`pricing.test.js`](../quote-engine/test/pricing.test.js) |
| 3 | 양식을 고친 뒤 값이 엉뚱한 칸에 | 셀 위치를 코드가 직접 가리킴, 양식이 검증 없이 바로 운영에 | 값 자리(`{{키}}`) · 업로드 → 테스트 렌더 → 활성화 · 되돌리기 | [`templates.js`](../quote-engine/src/core/templates.js) | [`templates.test.js`](../quote-engine/test/templates.test.js) |
| 4 | 행정구역 개편 지역만 "건물 없음" | 새 법정동코드로 대장을 조회했는데 대장은 아직 구 코드 | 새 코드로 비면 구 코드로 재조회 · 기록 · 화면 안내 | [`building-client.js`](../quote-engine/src/core/building-client.js) | [`building-client.test.js`](../quote-engine/test/building-client.test.js) |

공통 순서는 같다. **알림으로 먼저 알고 → 원인을 하나로 좁히고 → 사람이 조심하는 대신 코드가 막게 하고 → 그 장애를 재현하는 테스트를 남긴다.** 알림 경로는 [운영 방식](operations.md#5-장애는-알림--회고--장치로) 참고.

---

## 1. PDF 동시 요청으로 변환이 멈춤

| | |
|---|---|
| **증상** | 여러 사람이 비슷한 시간에 견적서를 만들면 PDF가 빈 파일로 나오거나, 변환이 끝나지 않아 견적 화면이 응답하지 않았다. 한 번 멈추면 뒤에 들어온 요청도 같이 막혔다. |
| **원인** | 엑셀 → PDF 변환에 LibreOffice를 쓰는데, 같은 사용자 프로필로 동시에 여러 개를 띄우면 서로 충돌한다. 변환 프로세스에 시간 제한이 없어 멈춘 프로세스가 남아 있었다. |
| **해결** | ① 변환을 **직렬 큐**로 돌린다(동시 1건, 요청 순서대로). ② 건당 **타임아웃**(기본 90초)이 지나면 프로세스 트리를 **강제 종료**하고 다음 건으로 넘어간다. ③ 연속 3회 실패하면 **서킷브레이커**가 열려 60초 동안 변환을 부르지 않고, 그 뒤 1건만 시험해 성공하면 닫힌다. |
| **재발 방지** | PDF를 "되면 붙이는" 산출물로 바꿨다. 변환이 실패하거나 서킷이 열려 있어도 **견적은 xlsx로 끝까지 나가고**, 응답에 `pdfStatus`(`ok`·`failed`·`circuit-open`·`skipped`)가 남는다. 서킷 상태가 바뀌면 알림이 간다. |

- 코드: [`core/pdf-queue.js`](../quote-engine/src/core/pdf-queue.js) `createPdfQueue` · [`core/soffice.js`](../quote-engine/src/core/soffice.js) `runWithTimeout`·`killTree` · [`core/circuit-breaker.js`](../quote-engine/src/core/circuit-breaker.js)
- 테스트: [`pdf-queue.test.js`](../quote-engine/test/pdf-queue.test.js) — 동시에 5건 요청해도 한 번에 1건씩, 멈춘 프로세스는 정리되고 다음 건은 정상, 열림 → 반열림 → 닫힘·재열림
- 시연: `npm run quote:demo`의 "4. PDF 변환" 단락(멈춘 프로세스 → `PDF_TIMEOUT`, 변환 실패 → 서킷 open → xlsx만)

## 2. 단가가 바뀔 때마다 배포해야 함

| | |
|---|---|
| **증상** | 단가·할인율이 바뀌면 코드 수정 → 배포를 거쳐야 했다. 요청과 배포 사이에는 옛 단가로 견적이 나갔고, 현업은 바뀌었는지 확인할 방법이 없었다. |
| **원인** | 단가가 코드 안의 상수였다. 바꿀 사람(현업)과 바꿀 수 있는 사람(개발자)이 달랐다. |
| **해결** | 단가를 **저장소(에어테이블) 단가 테이블로 외부화**하고, 관리자 화면에서 고치게 했다(사업부 설정의 `pricingKeys`로 필수 키 검사, 저장하면 캐시를 비움). 계산할 때는 **5분 캐시**를 거쳐 읽는다. |
| **재발 방지** | 저장소를 못 읽으면 견적을 멈추지 않고 **번들 기본값으로 폴백**한다(폴백은 캐시하지 않아 저장소가 돌아오면 바로 복구). 견적 기록과 견적서 주석에 **단가 출처(`pricingSource`)·단가 버전**이 남아, 어떤 단가로 계산했는지 나중에 확인할 수 있다. |

- 코드: [`core/pricing.js`](../quote-engine/src/core/pricing.js) `createPricingService`·`checkPricingShape` · 번들 단가 [`data/pricing/`](../data/pricing/) · 관리자 API `PUT /api/admin/pricing/:divisionId`([`server.js`](../quote-engine/src/server.js))
- 테스트: [`pricing.test.js`](../quote-engine/test/pricing.test.js) — 저장소 → 캐시 → TTL 만료 후 다시 저장소, 저장소 오류·형식 깨짐이면 폴백, 관리자 수정 후 캐시 비움
- 시연: `npm run quote:demo`의 "2. 단가 캐시 · 폴백" 단락

## 3. 양식을 고친 뒤 값이 엉뚱한 칸에 들어감

| | |
|---|---|
| **증상** | 견적서 엑셀 양식에 행을 하나 넣거나 머리글을 바꾼 뒤부터 금액이 다른 칸에 들어가거나 합계 칸이 빈 채로 나갔다. 견적서를 받은 쪽에서 먼저 발견했다. |
| **원인** | 코드가 `D25` 같은 셀 주소를 직접 가리켰다. 양식 파일은 누구나 고칠 수 있었고, 고친 파일이 검증 없이 바로 운영에 쓰였다. |
| **해결** | ① 셀 주소 대신 **값 자리**(`{{quoteNo}}`, `{{total}}` …)를 양식에 적고, 코드는 값 자리를 찾아 채운다. 행을 넣어도 값 자리를 따라간다. ② 양식은 **업로드 → 테스트 렌더 → 활성화** 순서로만 바뀐다. 테스트 렌더는 사업부 설정의 샘플 견적으로 실제로 채워 보고 필수 값 자리·시트 이름·항목 칸 수·남는 값 자리를 검사한다. ③ 활성화한 양식이 문제면 **이전 버전으로 되돌리기**. |
| **재발 방지** | 테스트 렌더를 통과하지 않은 양식은 **활성화 버튼 자체가 거부**한다. 견적 기록에 양식 버전이 남는다. |

![관리자 화면: 합계 값 자리를 수식으로 바꾼 v3는 테스트 실패로 활성화할 수 없다](shots/03-admin.png)

- 코드: [`core/templates.js`](../quote-engine/src/core/templates.js) `upload`·`testRender`·`activate`·`rollback` · [`core/xlsx.js`](../quote-engine/src/core/xlsx.js) `REQUIRED_PLACEHOLDERS`
- 테스트: [`templates.test.js`](../quote-engine/test/templates.test.js) — 필수 값 자리 삭제·오타·시트 이름 변경·깨진 파일은 활성화 거부, v2 활성화 → 되돌리기로 v1 복귀

## 4. 행정구역 개편 지역만 "건물 없음"

| | |
|---|---|
| **증상** | 특정 지역 주소만 견적 화면에서 "건축물대장에 건물이 없습니다"가 나왔다. 주소 검색은 정상이었다. |
| **원인** | 도로명주소 응답의 법정동코드는 개편 뒤의 **새 코드**인데, 건축물대장은 개편 직후 한동안 **구 코드**로만 조회되는 경우가 있었다. (가상 예: 군위군의 경상북도 → 대구광역시 편입, `47720` → `27720`) |
| **해결** | 새 코드로 대장이 비면 **새 코드 → 구 코드 표**에서 찾아 다시 조회한다. 재조회했다는 사실(`adminCodeFallback`: 어느 코드에서 어느 코드로, 사유)을 결과에 남기고 화면에 안내한다. |
| **재발 방지** | 새 개편이 생기면 코드 대신 표([`legacy-admin-codes.json`](../quote-engine/fixtures/legacy-admin-codes.json))에 한 줄을 더한다. 새 코드·구 코드 모두 비면 `BUILDING_NOT_FOUND`로 명확히 실패한다. |

![행정구역 코드 재조회 안내](shots/02-legacy-code.png)

- 코드: [`core/building-client.js`](../quote-engine/src/core/building-client.js) `lookup`·`legacyCodeFor`
- 테스트: [`building-client.test.js`](../quote-engine/test/building-client.test.js) — 새 코드로 비면 구 코드로 재조회, 둘 다 없으면 `BUILDING_NOT_FOUND`
- 시연: `npm run quote:demo`의 기계설비 견적("구 코드 재조회 2772025021 → 4772025021")

---

## 장애 뒤에 같이 바꾼 것

- **오류를 늦게 알던 문제.** 서버 오류 스택을 3줄(무엇이·어디서·조치)로 요약해 웹훅으로 보낸다. 경로·키는 가리고, 같은 오류가 10분 안에 반복되면 한 번만 보낸다. 요약은 규칙 기반이 기본이고, `ANTHROPIC_API_KEY`가 있을 때만 LLM 요약을 시도한 뒤 실패하면 규칙 기반으로 돌아간다 → [`core/notify.js`](../quote-engine/src/core/notify.js), [`notify.test.js`](../quote-engine/test/notify.test.js)
- **스테이징에서 시험하다 운영 데이터를 건드릴 위험.** 스테이징 Base의 ID에 `stg_`를 붙이고, 매핑표에 없는 ID로 쓰면 에러로 막는다 → [`core/store/guard.js`](../quote-engine/src/core/store/guard.js), [에어테이블 설계 원칙 6장](../airtable/principles.md#6-스테이징-base와-id-매핑-가드)
- **동기화가 사본을 비워 버릴 위험.** 허브 원본이 직전 정상 실행보다 30% 넘게 줄면 반영을 멈춘다 → [`sync-safety.js`](../airtable/automations/scripts/sync-safety.js), [`n8n/`](../n8n/)
