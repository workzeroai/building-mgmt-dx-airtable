import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addressKey, normalizeAddress, pad4, registerKey, toRegisterQuery } from '../src/core/normalize.js';
import { createBuildingClient, extractRegisterItems, summarizeBuilding } from '../src/core/building-client.js';
import { mockFetch } from './helpers.js';

test('주소 정규화: 시도 약칭·상세 주소·괄호·공백을 정리한다', () => {
  assert.equal(normalizeAddress('서울 중구 예시로 12, 3층').normalized, '서울특별시 중구 예시로 12');
  assert.equal(normalizeAddress('  서울시   중구 예시로 12 (가상동) 302호').normalized, '서울특별시 중구 예시로 12');
  assert.equal(normalizeAddress('경북 군위군 가상길 7 101동 1203').normalized, '경상북도 군위군 가상길 7');
  assert.equal(normalizeAddress('부천시 중동 12').normalized, '부천시 중동 12', '법정동 이름(중동)은 지우지 않는다');
  assert.equal(normalizeAddress('서울 중구 가상동 45-3번지').normalized, '서울특별시 중구 가상동 45-3');
  assert.equal(normalizeAddress('서울 중구 예시로 12').sido, '서울특별시');
  assert.equal(normalizeAddress('중구 예시로 12').sido, null);
  assert.equal(addressKey('서울특별시 중구 예시로 12'), '서울특별시중구예시로12');
  assert.throws(() => normalizeAddress('   '), { code: 'VALIDATION_FAILED' });
  assert.throws(() => normalizeAddress(null), { code: 'VALIDATION_FAILED' });
});

test('도로명주소 응답 → 건축물대장 조회 조건(시군구·법정동·번·지 4자리)', () => {
  const q = toRegisterQuery({ admCd: '1114017400', mtYn: '0', lnbrMnnm: 45, lnbrSlno: 3 });
  assert.deepEqual(q, { sigunguCd: '11140', bjdongCd: '17400', platGbCd: '0', bun: '0045', ji: '0003' });
  assert.equal(registerKey(q), '11140-17400-0-0045-0003');
  assert.equal(toRegisterQuery({ admCd: '1114017400', mtYn: '1', lnbrMnnm: 1, lnbrSlno: 0 }).platGbCd, '1');
  assert.equal(pad4(undefined), '0000');
  assert.throws(() => toRegisterQuery({ admCd: '123' }), { code: 'VALIDATION_FAILED' });
});

test('가짜 응답으로 주소 → 건물 조회(도로명 끝부분만 입력해도 찾음)', async () => {
  const client = createBuildingClient();
  const r = await client.lookup('중구 예시로 12');
  assert.equal(r.address.road, '서울특별시 중구 예시로 12');
  assert.equal(r.building.mainPurpose, '업무시설');
  assert.equal(r.building.totalArea, 4850.12);
  assert.equal(r.building.groundFloors, 12);
  assert.equal(r.adminCodeFallback, null);
  assert.deepEqual(r.source, { address: 'fixture', register: 'fixture' });
  assert.deepEqual(client.mode, { address: 'fixture', register: 'fixture' });
});

test('여러 동은 연면적 합계·층수 최댓값·가장 큰 동의 주용도로 합친다', async () => {
  const r = await createBuildingClient().lookup('경기도 성남시 분당구 샘플로 45');
  assert.equal(r.building.dongCount, 2);
  assert.equal(r.building.totalArea, 12300.8);
  assert.equal(r.building.groundFloors, 8);
  assert.equal(r.building.undergroundFloors, 4);
  assert.equal(r.building.mainPurpose, '판매시설');
  assert.equal(summarizeBuilding([]), null);
});

test('행정구역 개편: 새 코드로 대장이 비면 구 코드로 다시 조회한다', async () => {
  const r = await createBuildingClient().lookup('대구광역시 군위군 군위읍 가상길 7');
  assert.deepEqual(r.adminCodeFallback, { from: '2772025021', to: '4772025021', reason: '경상북도 군위군 → 대구광역시 편입' });
  assert.equal(r.building.mainPurpose, '교육연구시설');
  assert.equal(r.address.admCd, '2772025021', '주소 응답의 새 코드는 그대로 둔다');
});

test('없는 주소는 예시 주소 목록과 함께 ADDRESS_NOT_FOUND', async () => {
  await assert.rejects(createBuildingClient().lookup('서울 강남구 없는로 1'), (err) => {
    assert.equal(err.code, 'ADDRESS_NOT_FOUND');
    assert.equal(err.status, 404);
    assert.ok(err.details.examples.includes('서울특별시 중구 예시로 12'));
    return true;
  });
});

test('주소는 있는데 대장(새 코드·구 코드 모두)에 없으면 BUILDING_NOT_FOUND', async () => {
  const fetchImpl = mockFetch((url) => {
    if (url.includes('addrLinkApi')) {
      return { results: { common: { errorCode: '0', errorMessage: '정상' }, juso: [{ roadAddrPart1: '세종특별자치시 가상로 1', jibunAddr: 'x', admCd: '3611010100', mtYn: '0', lnbrMnnm: 1, lnbrSlno: 0 }] } };
    }
    return { response: { header: { resultCode: '00' }, body: { items: '' } } };
  });
  const client = createBuildingClient({ mode: 'live', jusoKey: 'k', registerKey: 'k', fetchImpl });
  await assert.rejects(client.lookup('세종 가상로 1'), { code: 'BUILDING_NOT_FOUND' });
});

test('실제 호출 모드: 키가 있으면 공공 API 형식으로 호출하고 단일 객체 item도 처리한다', async () => {
  const fetchImpl = mockFetch((url) => {
    if (url.includes('addrLinkApi')) {
      return { results: { common: { errorCode: '0', errorMessage: '정상' }, juso: [{ roadAddr: '인천광역시 연수구 테스트로 3', jibunAddr: 'j', admCd: '2818510600', mtYn: '0', lnbrMnnm: 77, lnbrSlno: 1, siNm: '인천광역시', sggNm: '연수구' }] } };
    }
    return { response: { header: { resultCode: '00' }, body: { items: { item: { bldNm: 'A', mainPurpsCdNm: '공장', totArea: 100.5, grndFlrCnt: 2, ugrndFlrCnt: 0, sigunguCd: '28185', bjdongCd: '10600', bun: '0077', ji: '0001' } } } } };
  });
  const client = createBuildingClient({ mode: 'live', jusoKey: 'JUSO', registerKey: 'REG', fetchImpl });
  const r = await client.lookup('인천 연수구 테스트로 3');
  assert.equal(r.building.totalArea, 100.5);
  assert.deepEqual(r.source, { address: 'live', register: 'live' });
  assert.match(fetchImpl.calls[0].url, /confmKey=JUSO.*resultType=json/u);
  assert.match(fetchImpl.calls[1].url, /getBrTitleInfo\?serviceKey=REG&sigunguCd=28185&bjdongCd=10600&platGbCd=0&bun=0077&ji=0001/u);
});

test('fake 모드는 키가 있어도 실제 호출을 하지 않는다', async () => {
  const fetchImpl = mockFetch(() => { throw new Error('호출되면 안 됨'); });
  const client = createBuildingClient({ mode: 'fake', jusoKey: 'k', registerKey: 'k', fetchImpl });
  await client.lookup('서울 중구 예시로 12');
  assert.equal(fetchImpl.calls.length, 0);
});

test('공공 API 오류: HTTP 오류·네트워크 오류·결과 코드 오류를 EXTERNAL_API_FAILED로', async () => {
  const http = createBuildingClient({ mode: 'live', jusoKey: 'k', fetchImpl: mockFetch(() => ({ status: 500, body: {} })) });
  await assert.rejects(http.lookup('서울 중구 예시로 12'), { code: 'EXTERNAL_API_FAILED' });
  const net = createBuildingClient({ mode: 'live', jusoKey: 'k', fetchImpl: mockFetch(() => new Error('ECONNRESET')) });
  await assert.rejects(net.lookup('서울 중구 예시로 12'), /공공 API 호출 실패/u);
  const juso = createBuildingClient({ mode: 'live', jusoKey: 'k', fetchImpl: mockFetch(() => ({ results: { common: { errorCode: 'E0001', errorMessage: '승인되지 않은 KEY' } } })) });
  await assert.rejects(juso.lookup('서울 중구 예시로 12'), /승인되지 않은 KEY/u);
  assert.throws(() => extractRegisterItems({ response: { header: { resultCode: '30', resultMsg: 'SERVICE KEY IS NOT REGISTERED' } } }), /SERVICE KEY/u);
});
