import { describe, expect, it } from 'vitest';

import { parseSafeNextPath } from '@/features/auth/redirects';
import {
  SOURCE_REJECTION_MESSAGES,
  buildSourceQuery,
  memoryLinkPath,
  newMemoryPath,
  parseSourceQuery,
} from '@/features/memories/links/source';

/**
 * DATE-001 `?source=&sourceId=` 해석.
 *
 * 지키려는 것
 *   1. URL에는 **enum과 UUID만** 들어간다. 비공개 텍스트(제목·본문·메모)가 주소에 실리지 않는다.
 *   2. 같은 이름이 두 번 들어오면 "어느 쪽을 골랐는지 모르는 상태"로 진행하지 않는다.
 *   3. 로그인 후 돌아올 경로는 **정규화한 값**으로만 만들고, 인증 허용 목록을 통과해야 한다.
 *      그래야 로그인 왕복 뒤에도 같은 원본으로 돌아온다.
 */

const UUID = '11111111-2222-4333-8444-555555555555';
const OTHER_UUID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

describe('parseSourceQuery', () => {
  it('둘 다 없으면 연결 없음(absent)이다', () => {
    expect(parseSourceQuery({})).toEqual({ status: 'absent' });
    expect(parseSourceQuery({ source: undefined, sourceId: undefined })).toEqual({
      status: 'absent',
    });
  });

  it('빈 문자열은 없는 것과 같다', () => {
    expect(parseSourceQuery({ source: '', sourceId: '' })).toEqual({ status: 'absent' });
    expect(parseSourceQuery({ source: '   ', sourceId: '  ' })).toEqual({ status: 'absent' });
  });

  it('일정·위시 두 종류를 읽는다', () => {
    expect(parseSourceQuery({ source: 'event', sourceId: UUID })).toEqual({
      status: 'ok',
      ref: { source: 'event', sourceId: UUID },
    });
    expect(parseSourceQuery({ source: 'wish', sourceId: UUID })).toEqual({
      status: 'ok',
      ref: { source: 'wish', sourceId: UUID },
    });
  });

  it('대문자 UUID도 그대로 받는다(DB가 대소문자를 구분하지 않는다)', () => {
    const upper = UUID.toUpperCase();
    expect(parseSourceQuery({ source: 'event', sourceId: upper })).toEqual({
      status: 'ok',
      ref: { source: 'event', sourceId: upper },
    });
  });

  it('값이 두 번 들어오면 거부한다(어느 쪽인지 고르지 않는다)', () => {
    expect(parseSourceQuery({ source: ['event', 'wish'], sourceId: UUID })).toEqual({
      status: 'invalid',
      reason: 'duplicate',
    });
    expect(parseSourceQuery({ source: 'event', sourceId: [UUID, OTHER_UUID] })).toEqual({
      status: 'invalid',
      reason: 'duplicate',
    });
  });

  it('한 번만 들어온 배열은 정상으로 읽는다', () => {
    expect(parseSourceQuery({ source: ['wish'], sourceId: [UUID] })).toEqual({
      status: 'ok',
      ref: { source: 'wish', sourceId: UUID },
    });
  });

  it('한쪽만 있으면 거부한다', () => {
    expect(parseSourceQuery({ source: 'event' })).toEqual({
      status: 'invalid',
      reason: 'incomplete',
    });
    expect(parseSourceQuery({ sourceId: UUID })).toEqual({
      status: 'invalid',
      reason: 'incomplete',
    });
  });

  it('알 수 없는 종류는 거부한다', () => {
    expect(parseSourceQuery({ source: 'restaurant', sourceId: UUID })).toEqual({
      status: 'invalid',
      reason: 'source',
    });
    expect(parseSourceQuery({ source: 'EVENT', sourceId: UUID })).toEqual({
      status: 'invalid',
      reason: 'source',
    });
  });

  it('UUID가 아닌 ID는 거부한다', () => {
    for (const bad of ['1', 'not-a-uuid', `${UUID}x`, `${UUID} `, '../../etc']) {
      expect(parseSourceQuery({ source: 'event', sourceId: bad })).toEqual({
        status: 'invalid',
        reason: 'sourceId',
      });
    }
  });

  it('거부 이유마다 안내 문장이 있다', () => {
    for (const reason of ['duplicate', 'incomplete', 'source', 'sourceId'] as const) {
      expect(SOURCE_REJECTION_MESSAGES[reason].length).toBeGreaterThan(10);
      // 연결이 없다는 뜻이 아니라 "확인하지 못했다"는 뜻임을 알린다.
      expect(SOURCE_REJECTION_MESSAGES[reason]).toContain('연결');
    }
  });
});

describe('buildSourceQuery', () => {
  it('정규화한 query만 만든다', () => {
    expect(buildSourceQuery({ source: 'event', sourceId: UUID })).toBe(
      `?source=event&sourceId=${UUID}`,
    );
  });

  it('없으면 빈 문자열이다', () => {
    expect(buildSourceQuery(null)).toBe('');
  });

  it('제목·본문 같은 다른 값은 절대 담지 않는다', () => {
    const params = new URLSearchParams(buildSourceQuery({ source: 'wish', sourceId: UUID }).slice(1));
    expect([...params.keys()].sort()).toEqual(['source', 'sourceId']);
  });
});

describe('로그인 복귀 경로', () => {
  it('원본이 유효하면 정규화한 query를 붙인다', () => {
    const path = newMemoryPath(parseSourceQuery({ source: 'event', sourceId: UUID }));
    expect(path).toBe(`/memories/new?source=event&sourceId=${UUID}`);
  });

  it('거부된 query는 되돌려주지 않는다', () => {
    expect(newMemoryPath({ status: 'invalid', reason: 'sourceId' })).toBe('/memories/new');
    expect(newMemoryPath({ status: 'absent' })).toBe('/memories/new');
  });

  it('인증 허용 목록을 통과해 query까지 유지된다(로그인 왕복 뒤 같은 원본)', () => {
    const path = newMemoryPath(parseSourceQuery({ source: 'wish', sourceId: UUID }));
    expect(parseSafeNextPath(path)).toBe(path);
  });

  it('연결 선택 화면의 경로도 허용 목록을 통과한다', () => {
    const plain = memoryLinkPath(OTHER_UUID);
    expect(plain).toBe(`/memories/${OTHER_UUID}/link`);
    expect(parseSafeNextPath(plain)).toBe(plain);

    const withSource = memoryLinkPath(OTHER_UUID, { source: 'event', sourceId: UUID });
    expect(withSource).toBe(`/memories/${OTHER_UUID}/link?source=event&sourceId=${UUID}`);
    expect(parseSafeNextPath(withSource)).toBe(withSource);
  });
});
