import { z } from 'zod';

import { SPACE_LIMITS } from '@/lib/contracts';
import { isCalendarDate, todayInSeoul, compareCalendarDates } from '@/lib/dates';

import { isInviteTokenShape } from './invite-token';

/**
 * 인증·공간 설정 입력 검증.
 *
 * 화면과 Server Action이 같은 스키마를 쓴다. DB 함수도 같은 제한을 다시 검사하므로
 * 이 검증은 "먼저 걸러 주는 안내"이고 최종 방어는 DB다(CONTRACTS.md).
 */

/** Supabase Auth의 bcrypt 입력 한계(72바이트)를 넘지 않게 한다. */
export const PASSWORD_LIMITS = { min: 8, max: 72 } as const;
export const NICKNAME_LIMITS = { min: 1, max: 20 } as const;

const emailField = z
  .string()
  .trim()
  .min(1, '이메일을 입력해 주세요.')
  .max(254, '이메일이 너무 깁니다.')
  .toLowerCase()
  .refine((value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value), '이메일 형식을 확인해 주세요.');

const passwordField = z
  .string()
  .min(PASSWORD_LIMITS.min, `비밀번호는 ${PASSWORD_LIMITS.min}자 이상이어야 해요.`)
  .max(PASSWORD_LIMITS.max, `비밀번호는 ${PASSWORD_LIMITS.max}자까지 쓸 수 있어요.`);

export const signInSchema = z.object({
  email: emailField,
  // 로그인 입력은 길이 상한만 확인한다. 기존 계정의 비밀번호를 여기서 막지 않는다.
  password: z.string().min(1, '비밀번호를 입력해 주세요.').max(PASSWORD_LIMITS.max),
});

export const passwordResetRequestSchema = z.object({
  email: emailField,
});

export const newPasswordSchema = z
  .object({
    password: passwordField,
    passwordConfirm: z.string(),
  })
  .refine((value) => value.password === value.passwordConfirm, {
    message: '두 번 입력한 비밀번호가 서로 달라요.',
    path: ['passwordConfirm'],
  });

const spaceNameField = z
  .string()
  .trim()
  .min(SPACE_LIMITS.nameMin, '공간 이름을 입력해 주세요.')
  .max(SPACE_LIMITS.nameMax, `공간 이름은 ${SPACE_LIMITS.nameMax}자까지 입력할 수 있어요.`);

const introductionField = z
  .string()
  .trim()
  .max(SPACE_LIMITS.introductionMax, `한 줄 소개는 ${SPACE_LIMITS.introductionMax}자까지 쓸 수 있어요.`);

/** 빈 문자열은 "미설정"이다. 미래 날짜는 거부한다(DESIGN.md 9). */
const relationshipStartDateField = z
  .string()
  .trim()
  .refine((value) => value === '' || isCalendarDate(value), '실제로 있는 날짜를 골라 주세요.')
  .refine(
    // 앞의 형식 검사가 실패해도 이 검사는 실행된다. 날짜가 아닌 값은 여기서 통과시키고
    // 형식 오류 하나만 보여 준다(달력 비교 함수는 형식이 아닌 값에 예외를 던진다).
    (value) => value === '' || !isCalendarDate(value) || compareCalendarDates(value, todayInSeoul()) <= 0,
    '함께한 날짜는 오늘보다 뒤일 수 없어요.',
  );

export const spaceProfileSchema = z.object({
  name: spaceNameField,
  introduction: introductionField,
  relationshipStartDate: relationshipStartDateField,
});

export const profileSchema = z.object({
  nickname: z
    .string()
    .trim()
    .min(NICKNAME_LIMITS.min, '닉네임을 입력해 주세요.')
    .max(NICKNAME_LIMITS.max, `닉네임은 ${NICKNAME_LIMITS.max}자까지 입력할 수 있어요.`),
});

export const inviteCreateSchema = z.object({
  targetEmail: emailField,
});

export const inviteTokenSchema = z.object({
  token: z.string().refine(isInviteTokenShape, '초대 링크가 올바르지 않습니다.'),
});

export type SignInInput = z.infer<typeof signInSchema>;
export type PasswordResetRequestInput = z.infer<typeof passwordResetRequestSchema>;
export type NewPasswordInput = z.infer<typeof newPasswordSchema>;
export type SpaceProfileInput = z.infer<typeof spaceProfileSchema>;
export type ProfileInput = z.infer<typeof profileSchema>;
export type InviteCreateInput = z.infer<typeof inviteCreateSchema>;

export type FieldErrorMap = Record<string, string>;

export type ValidationOutcome<T> =
  | { ok: true; data: T }
  | { ok: false; fieldErrors: FieldErrorMap; firstField: string | null };

/** zod 결과를 폼에서 바로 쓸 수 있는 형태로 바꾼다. 첫 오류 필드는 포커스 이동에 쓴다. */
export function validateWith<T>(schema: z.ZodType<T>, input: unknown): ValidationOutcome<T> {
  const parsed = schema.safeParse(input);
  if (parsed.success) return { ok: true, data: parsed.data };

  const fieldErrors: FieldErrorMap = {};
  let firstField: string | null = null;

  for (const issue of parsed.error.issues) {
    const field = issue.path[0];
    const key = typeof field === 'string' ? field : '_form';
    if (fieldErrors[key] === undefined) {
      fieldErrors[key] = issue.message;
      if (firstField === null) firstField = key;
    }
  }

  return { ok: false, fieldErrors, firstField };
}

/** 빈 문자열은 DB에 NULL로 보낸다(관계 시작일 미설정). */
export function toNullableDate(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}
