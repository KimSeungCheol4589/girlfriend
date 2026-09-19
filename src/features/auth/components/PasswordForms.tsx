'use client';

import Link from 'next/link';
import { useActionState } from 'react';

import { requestPasswordResetAction, updatePasswordAction } from '../actions';
import { idleFormState } from '../form-state';
import { PASSWORD_LIMITS } from '../schemas';

import { FieldError, FormFeedback, SubmitButton } from './FormFeedback';

/**
 * 비밀번호 재설정 메일 요청.
 * 계정이 있는지 알려 주지 않는다. 성공·실패 문구가 같다.
 */
export function PasswordResetRequestForm() {
  const [state, formAction] = useActionState(requestPasswordResetAction, idleFormState);

  return (
    <>
      <FormFeedback state={state} />

      {state.status === 'success' ? null : (
        <form action={formAction} className="space-y-4" noValidate>
          <div>
            <label htmlFor="email" className="field-label">
              이메일
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="username"
              inputMode="email"
              required
              className="field-input"
              aria-invalid={state.fieldErrors?.email ? true : undefined}
              aria-describedby={state.fieldErrors?.email ? 'email-error' : undefined}
            />
            <FieldError name="email" state={state} />
            <p className="field-hint">
              등록된 계정이면 재설정 링크가 담긴 메일이 갑니다. 링크는 요청한 브라우저에서 열어
              주세요.
            </p>
          </div>

          <SubmitButton pendingLabel="보내는 중…" className="btn-primary w-full">
            재설정 메일 보내기
          </SubmitButton>
        </form>
      )}

      <p className="mt-5 text-sm">
        <Link href="/login" className="text-accent underline-offset-4 hover:underline">
          로그인으로 돌아가기
        </Link>
      </p>
    </>
  );
}

/** 새 비밀번호 설정. 재설정 링크로 들어온 세션에서만 의미가 있다. */
export function NewPasswordForm() {
  const [state, formAction] = useActionState(updatePasswordAction, idleFormState);

  return (
    <>
      <FormFeedback state={state} />

      <form action={formAction} className="space-y-4" noValidate>
        <div>
          <label htmlFor="password" className="field-label">
            새 비밀번호
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={PASSWORD_LIMITS.min}
            maxLength={PASSWORD_LIMITS.max}
            className="field-input"
            aria-invalid={state.fieldErrors?.password ? true : undefined}
            aria-describedby={state.fieldErrors?.password ? 'password-error' : undefined}
          />
          <FieldError name="password" state={state} />
          <p className="field-hint">{PASSWORD_LIMITS.min}자 이상으로 정해 주세요.</p>
        </div>

        <div>
          <label htmlFor="passwordConfirm" className="field-label">
            새 비밀번호 확인
          </label>
          <input
            id="passwordConfirm"
            name="passwordConfirm"
            type="password"
            autoComplete="new-password"
            required
            className="field-input"
            aria-invalid={state.fieldErrors?.passwordConfirm ? true : undefined}
            aria-describedby={state.fieldErrors?.passwordConfirm ? 'passwordConfirm-error' : undefined}
          />
          <FieldError name="passwordConfirm" state={state} />
        </div>

        <SubmitButton pendingLabel="저장 중…" className="btn-primary w-full">
          새 비밀번호 저장
        </SubmitButton>
      </form>
    </>
  );
}
