import { describe, expect, it } from 'vitest';

import {
  inviteCreateSchema,
  inviteTokenSchema,
  newPasswordSchema,
  profileSchema,
  signInSchema,
  spaceProfileSchema,
  toNullableDate,
  validateWith,
} from '@/features/auth/schemas';
import { todayInSeoul } from '@/lib/dates';

describe('signInSchema', () => {
  it('이메일을 소문자로 정규화한다', () => {
    const result = validateWith(signInSchema, { email: '  A@Example.COM ', password: 'secret1234' });
    expect(result.ok && result.data.email).toBe('a@example.com');
  });

  it('형식이 아닌 이메일을 거부하고 첫 오류 필드를 알려 준다', () => {
    const result = validateWith(signInSchema, { email: 'not-an-email', password: 'secret1234' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.firstField).toBe('email');
      expect(result.fieldErrors.email).toBeTruthy();
    }
  });

  it('빈 비밀번호를 거부한다', () => {
    const result = validateWith(signInSchema, { email: 'a@example.com', password: '' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors.password).toBeTruthy();
  });
});

describe('newPasswordSchema', () => {
  it('두 입력이 다르면 확인 필드에 오류를 붙인다', () => {
    const result = validateWith(newPasswordSchema, {
      password: 'password123',
      passwordConfirm: 'password124',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors.passwordConfirm).toBeTruthy();
  });

  it('너무 짧은 비밀번호를 거부한다', () => {
    const result = validateWith(newPasswordSchema, { password: 'short', passwordConfirm: 'short' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors.password).toBeTruthy();
  });

  it('같은 값이고 길이를 만족하면 통과한다', () => {
    const result = validateWith(newPasswordSchema, {
      password: 'password123',
      passwordConfirm: 'password123',
    });
    expect(result.ok).toBe(true);
  });
});

describe('spaceProfileSchema', () => {
  it('이름 길이 제한을 적용한다 (DESIGN 5.2)', () => {
    expect(
      validateWith(spaceProfileSchema, { name: '', introduction: '', relationshipStartDate: '' }).ok,
    ).toBe(false);
    expect(
      validateWith(spaceProfileSchema, {
        name: 'x'.repeat(31),
        introduction: '',
        relationshipStartDate: '',
      }).ok,
    ).toBe(false);
    expect(
      validateWith(spaceProfileSchema, {
        name: 'x'.repeat(30),
        introduction: 'y'.repeat(200),
        relationshipStartDate: '',
      }).ok,
    ).toBe(true);
  });

  it('미래 시작일을 거부한다', () => {
    const result = validateWith(spaceProfileSchema, {
      name: '우리 공간',
      introduction: '',
      relationshipStartDate: '2999-01-01',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors.relationshipStartDate).toBeTruthy();
  });

  it('오늘은 허용한다 (시작 당일이 1일)', () => {
    const result = validateWith(spaceProfileSchema, {
      name: '우리 공간',
      introduction: '',
      relationshipStartDate: todayInSeoul(),
    });
    expect(result.ok).toBe(true);
  });

  it('없는 날짜를 거부한다', () => {
    const result = validateWith(spaceProfileSchema, {
      name: '우리 공간',
      introduction: '',
      relationshipStartDate: '2026-02-30',
    });
    expect(result.ok).toBe(false);
  });

  it('빈 날짜는 미설정으로 통과하고 NULL로 보낸다', () => {
    const result = validateWith(spaceProfileSchema, {
      name: '우리 공간',
      introduction: '',
      relationshipStartDate: '',
    });
    expect(result.ok).toBe(true);
    expect(toNullableDate('')).toBeNull();
    expect(toNullableDate('2026-01-01')).toBe('2026-01-01');
  });
});

describe('profileSchema', () => {
  it('닉네임 1~20자를 적용한다', () => {
    expect(validateWith(profileSchema, { nickname: '' }).ok).toBe(false);
    expect(validateWith(profileSchema, { nickname: 'x'.repeat(21) }).ok).toBe(false);
    expect(validateWith(profileSchema, { nickname: '  보리  ' }).ok).toBe(true);
  });
});

describe('inviteCreateSchema', () => {
  it('이메일 형식만 받는다', () => {
    expect(validateWith(inviteCreateSchema, { targetEmail: 'b@example.com' }).ok).toBe(true);
    expect(validateWith(inviteCreateSchema, { targetEmail: 'b@example' }).ok).toBe(false);
    expect(validateWith(inviteCreateSchema, { targetEmail: '' }).ok).toBe(false);
  });
});

describe('inviteTokenSchema', () => {
  it('짧거나 형식이 다른 토큰을 거부한다', () => {
    expect(validateWith(inviteTokenSchema, { token: 'a'.repeat(43) }).ok).toBe(true);
    expect(validateWith(inviteTokenSchema, { token: 'a'.repeat(10) }).ok).toBe(false);
    expect(validateWith(inviteTokenSchema, { token: '' }).ok).toBe(false);
  });
});
