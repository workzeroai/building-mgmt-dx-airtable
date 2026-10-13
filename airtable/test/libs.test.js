// 자동화 공용 판정 코드: 상태 전이·중복 키(견적 엔진 주소 정규화와 일치)·오류 요약.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendNote, checkTransition } from '../automations/lib/status.js';
import { addressKeyOf, businessNoKey, duplicateKeys, findCandidates } from '../automations/lib/dedupe.js';
import { buildAlert } from '../automations/lib/alert.js';
import { normalizeAddress } from '../../quote-engine/src/core/normalize.js';
import { statusFlows } from '../lib/schema.js';
import { fakeBusinessNo, unit, visitsPerYear } from '../lib/seed.js';
import { model } from './helpers.js';

test('상태 전이 판정: 허용·거부·변경 없음·처음·비움·모르는 상태', () => {
  const t = statusFlows(model)['견적'].transitions;
  assert.equal(checkTransition(t, 'draft', 'sent').action, 'accept');
  assert.equal(checkTransition(t, 'won', 'lost').action, 'reject');
  assert.equal(checkTransition(t, 'sent', 'sent').action, 'noop');
  assert.equal(checkTransition(t, null, 'won').action, 'accept');
  assert.equal(checkTransition(t, 'sent', null).action, 'reject');
  assert.equal(checkTransition(t, null, null).action, 'noop');
  assert.match(checkTransition(t, 'draft', 'archived').reason, /정의되지 않은 상태/u);
  const note = Array.from({ length: 25 }, (_, i) => `줄 ${i}`).reduce((acc, line) => appendNote(acc, line), '');
  assert.equal(note.split('\n').length, 20);
  assert.ok(note.endsWith('줄 24'));
});

test('주소 키는 견적 엔진(6-1) normalizeAddress와 같은 규칙이다', () => {
  const inputs = [
    '서울 중구 예시로 12, 3층',
    '서울특별시  중구 예시로 12 (가상동)',
    '경기 성남시 분당구 샘플로 45 지하1층',
    '부산시 해운대구 연습로 60 302호',
    '대구광역시 군위군 군위읍 가상길 7 101동 1203',
    '세종 가상로 1',
    '제주도 제주시 가상로 3번지',
  ];
  for (const raw of inputs) assert.equal(addressKeyOf(raw), normalizeAddress(raw).key, raw);
  assert.equal(addressKeyOf(''), null);
  assert.equal(addressKeyOf(null), null);
});

test('중복 키: 사업자번호 숫자 10자리, 건물은 주소 키. 자기 자신은 후보가 아니다', () => {
  assert.equal(businessNoKey('000-12-34567'), '0001234567');
  assert.equal(businessNoKey('000 12 34567'), '0001234567');
  assert.equal(businessNoKey('12-34'), null);
  assert.deepEqual(duplicateKeys('customers', { businessNo: null }), []);
  const records = [
    { recId: 'a', roadAddress: '서울 중구 예시로 12' },
    { recId: 'b', roadAddress: '서울특별시 중구 예시로 12, 5층' },
    { recId: 'c', roadAddress: '서울특별시 중구 예시로 13' },
  ];
  assert.deepEqual(findCandidates('buildings', records[0], records), { keys: ['addr:서울특별시중구예시로12'], candidates: ['b'] });
  assert.deepEqual(findCandidates('buildings', { recId: 'z', roadAddress: '' }, records).candidates, []);
});

test('오류 요약: 자동화별로 묶고 최근 메시지 3건, 길면 자른다', () => {
  const errors = [
    ...Array.from({ length: 5 }, (_, i) => ({ automation: 'syncSafety', stage: 'skipped', tableName: '건물', recordId: `bld_000${i}`, message: `필수 값 없음 ${i}`, occurredAt: `2026-10-13T0${i}:00:00Z` })),
    { automation: 'statusGuard', stage: 'error', message: '규칙 없음' },
    { stage: 'error', message: '이름 없는 자동화' },
  ];
  const a = buildAlert(errors, { label: 'GW 허브' });
  assert.equal(a.count, 7);
  assert.equal(a.groups, 3);
  assert.match(a.text, /• syncSafety 5건 \(skipped 5\)/u);
  assert.match(a.text, /건물\/bld_0004: 필수 값 없음 4/u, '최근 것부터');
  assert.match(a.text, /외 2건/u);
  assert.match(a.text, /\(이름 없음\)/u);
  const long = buildAlert(Array.from({ length: 50 }, (_, i) => ({ automation: `auto${i}`, stage: 'error', message: 'x'.repeat(150) })), { label: 'L', maxChars: 500 });
  assert.ok(long.text.length <= 500);
  assert.match(long.text, /길어서 생략/u);
});

test('시드 도우미: 가상 사업자번호 형식, 고정 난수, 방문 횟수 규칙', () => {
  assert.match(fakeBusinessNo('cus_0001'), /^000-\d{2}-\d{5}$/u);
  assert.equal(unit('abc'), unit('abc'));
  assert.ok(unit('abc') >= 0 && unit('abc') < 1);
  const mech = model.divisions.find((d) => d.id === 'mechanical');
  assert.equal(visitsPerYear(mech, { conditions: { cycle: '분기' } }), 4);
  assert.equal(visitsPerYear(mech, { conditions: { cycle: '월' } }), 12);
  assert.equal(visitsPerYear(model.divisions[0], null), 2);
});
