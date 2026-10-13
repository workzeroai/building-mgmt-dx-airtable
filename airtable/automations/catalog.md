# 자동화 패턴 카탈로그

> **자동 생성 문서** — [`catalog.yaml`](catalog.yaml)에서 `npm run airtable:build`로 만든다. 적힌 테이블·필드가 스키마에 없으면 테스트가 실패한다.
>
> 가상 회사 "그리드웰 빌딩서비스" 스키마 기준의 패턴 예시다. 회사에서 운영한 자동화(60여 개)를 옮긴 것이 아니라, 같은 방식(트리거 → 조건 → 액션 + 안전장치)을 가상 스키마로 다시 정리했다.

패턴 11개 중 4개는 이 저장소에 실행 가능한 스크립트가 있고 하네스 테스트로 검증한다. 나머지는 에어테이블 기본 액션(레코드 만들기·찾기·수정, 메일)으로 만드는 패턴이다.

![자동화 패턴](../../docs/diagrams/automation-pattern.png)

| ID | 자동화 | Base · 테이블 | 트리거 | 조건 | 액션 | 구현 | 안전장치 |
|---|---|---|---|---|---|---|---|
| A01 | 견적 수주 → 계약 생성 | 사업부 · 견적 | 레코드가 조건에 맞을 때: status = won | 연결된 계약이 없음(역방향 연결 '계약'이 비어 있음) | 계약 생성 — 견적의 ID·금액 복사, status=pending, 시작일=수주일+14일, 종료일=시작일+1년 | 기본 액션 | 계약이 이미 연결돼 있으면 만들지 않는다(같은 견적에서 계약 2건 방지) |
| A02 | 텍스트 ID → 연결 필드 채우기 | 사업부 · 견적 | 레코드가 만들어질 때(견적 엔진·동기화가 API로 넣은 레코드) | customerId·buildingId는 있는데 연결 필드가 비어 있음 | 고객·건물 사본에서 id가 같은 레코드를 찾아 customer·building 연결에 넣는다(계약·점검 일정·청구도 같은 패턴) | 기본 액션 | 못 찾으면 연결을 비워 두고 자동화 오류에 남긴다(엉뚱한 레코드에 잇지 않음) |
| A03 | 계약 활성화 → 점검 일정 생성 | 사업부 · 계약 | 레코드가 조건에 맞을 때: status = active | 점검 횟수 = 0 | 연간 방문 횟수만큼 점검 일정 생성 — 예정일 = 시작일 + k × (12 ÷ visitsPerYear)개월, 점검원 순번 배정 | 스크립트(패턴) | 이미 일정이 있으면 만들지 않는다. 시드 생성(airtable/lib/seed.js)과 같은 규칙 |
| A04 | 점검 D-7 담당자 알림 | 사업부 · 점검 일정 | 일정: 매일 08:00 | status = scheduled 이고 D-day ≤ 7 | 담당 점검원에게 방문 예정 메일(건물명·예정일) | 기본 액션 | 담당자가 비어 있으면 운영 관리자에게 보낸다 |
| A05 | 점검 결과 입력 → 청구 생성 | 사업부 · 점검 결과 | 레코드가 만들어질 때 | 결과가 pass 또는 actionRequired이고 연결된 청구가 없음 | 청구 생성 — 금액 = 연간 금액 ÷ 연간 방문 횟수, 발행일 = 오늘, 기한 = +30일, status=issued | 기본 액션 | 같은 결과에 청구가 있으면 건너뜀. 부적합(fail)은 재점검 뒤 청구 |
| A06 | 미수 경과 → overdue 전환·알림 | 사업부 · 청구 | 일정: 매일 09:00 | status = issued 이고 기한(dueDate)이 지남 | status를 overdue로 바꾸고 영업 담당에게 미수 목록 알림 | 기본 액션 | 상태 전이 가드(A07)가 issued → overdue만 허용. 입금(paid)된 건은 바뀌지 않음 |
| A07 | 상태 전이 가드 | 사업부 · 견적 | 레코드가 수정될 때(감시 필드 status) — 견적·계약·점검 일정·청구에 같은 스크립트 | statusConfirmed → status 전이가 규칙(docs/schema.md 상태 전이 표)에 없음 | 허용이면 statusConfirmed 갱신, 아니면 status를 되돌리고 statusNote에 사유 | [스크립트 status-guard.js](scripts/status-guard.js) | 되돌린 수정이 다시 트리거돼도 '변경 없음'으로 끝남(무한 반복 없음) |
| A08 | 고객·건물 중복 감지 | 허브 · 건물 | 레코드가 만들어지거나 roadAddress(고객은 businessNo)가 바뀔 때 | 정규화한 주소(고객은 사업자번호 숫자)가 같은 레코드가 있음 | 서로 dupCandidates로 잇고 dupStatus=후보 있음, addressKey 기록 | [스크립트 duplicate-detect.js](scripts/duplicate-detect.js) | 자동 병합·삭제 없음. 사람이 '검토 완료'로 바꾸면 같은 후보로 다시 띄우지 않음 |
| A09 | 허브 → 사업부 사본 동기화 | 사업부 · 건물 | 일정: 매시 정각 | 원본 건수가 직전 정상 실행 대비 30% 넘게 줄지 않음 | 검증 통과 건만 생성·수정, 사라진 건은 hubMissing 표시, 결과를 동기화 기록에 | [스크립트 sync-safety.js](scripts/sync-safety.js) · [n8n sync-safety.json](../../n8n/sync-safety.json) | 급감이면 반영 중단, 실패 건만 건너뛰고 기록 |
| A10 | 자동화 오류 요약 알림 | 사업부 · 자동화 오류 | 일정: 매시 10분(모든 Base에 같은 스크립트) | notified가 꺼진 오류가 있음 | 자동화별로 묶은 요약을 웹훅 1번으로 보내고 notified 켬 | [스크립트 error-alert.js](scripts/error-alert.js) | 발송 실패면 notified를 켜지 않아 다음 실행이 다시 보냄 |
| A11 | 계약 만료 60일 전 갱신 알림 | 사업부 · 계약 | 일정: 매주 월요일 09:00 | status = active 이고 종료일까지 60일 이하 | 영업 담당에게 갱신 대상 목록(미수금 함께) 알림 | 기본 액션 | 미수금이 있는 계약은 목록 맨 위에 표시 |

## 읽고 쓰는 필드

| ID | 감시 | 읽기 | 쓰기 |
|---|---|---|---|
| A01 | status | 계약, id, quoteNo, customerId, buildingId, divisionId, total | contracts: contractNo, id, quoteId, customerId, buildingId, divisionId, startDate, endDate, annualAmount, status, createdAt |
| A02 | customerId, buildingId | customerId, buildingId, customer, building | quotes: customer, building |
| A03 | status | 점검 횟수, id, buildingId, divisionId, startDate, endDate, visitsPerYear | inspections: id, divisionId, contractId, buildingId, assigneeId, scheduledDate, visitNo, status, createdAt |
| A04 | — | status, D-day, assignee, 건물명 | —(알림만) |
| A05 | result | result, 청구, id, contractId, divisionId | invoices: invoiceNo, id, divisionId, contractId, resultId, amount, issuedAt, dueDate, paidAmount, status, createdAt |
| A06 | — | status, dueDate, 경과일, 미수액, contract | invoices: status |
| A07 | status | status, statusConfirmed, statusNote | quotes: status, statusConfirmed, statusNote |
| A08 | roadAddress | id, roadAddress, dupCandidates, dupStatus | buildings: dupCandidates, dupStatus, dupCheckedAt, addressKey |
| A09 | — | id, syncHash, hubMissing | buildings: id, customerId, roadAddress, name, mainPurpose, totalArea, groundFloors, undergroundFloors, syncHash, syncedAt, hubMissing, customer / syncRuns: id, divisionId, runner, tableKey, startedAt, finishedAt, sourceCount, previousCount, status, note |
| A10 | — | automation, stage, tableName, recordId, message, occurredAt, notified | automationErrors: notified, notifiedAt |
| A11 | — | status, endDate, contractNo, 미수금, customer | —(알림만) |

## 운영 원칙

- **자동화는 지우지 않는다.** 사라진 원본은 표시만 하고(hubMissing), 중복은 후보만 띄운다(dupCandidates). 삭제·병합은 사람이 한다.
- **한 건의 실패가 전체를 멈추지 않게.** 묶음 쓰기가 실패하면 한 건씩 다시 쓰고 실패한 건만 기록한다.
- **이상하면 멈춘다.** 원본 건수가 갑자기 줄면 필터·권한 사고로 보고 반영하지 않는다.
- **실패는 한곳에 모아 한 번에 알린다.** 모든 자동화가 자동화 오류 테이블에 쓰고, 알림 스크립트가 묶어 보낸다(알림 폭주 방지).
- **상태는 규칙대로만 움직인다.** 상태 전이 가드가 표에 없는 전이를 되돌린다. 사람이 실수로 고쳐도, 자동화가 잘못 고쳐도 같다.
