'use client';

import Link from 'next/link';
import { useActionState } from 'react';

import { signInAction } from '../actions';
import { idleFormState } from '../form-state';

import { FieldError, FormFeedback, SubmitButton } from './FormFeedback';

/**
 * 이메일·비밀번호 로그인.
 *
 * 공개 가입은 제공하지 않는다(DESIGN.md 1). 계정은 운영자가 미리 만들고,
 * 두 번째 사람은 초대 링크로 들어온다.
 */
export function LoginForm({ next, signedOut }: { next: string; signedOut: boolean }) {
  const [state, formAction] = useActionState(signInAction, idleFormState);

  return (
    <>
      {signedOut && state.status === 'idle' ? (
        <p
          role="status"
          className="mb-4 rounded-card border border-border bg-surface-muted px-4 py-3 text-sm leading-relaxed text-text"
        >
          로그아웃했습니다. 이 브라우저의 로그인 상태를 지웠어요.
        </p>
      ) : null}

      <FormFeedback state={state} />

      <form action={formAction} className="space-y-4" noValidate>
        <input type="hidden" name="next" value={next} />

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
        </div>

        <div>
          <label htmlFor="password" className="field-label">
            비밀번호
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            className="field-input"
            aria-invalid={state.fieldErrors?.password ? true : undefined}
            aria-describedby={state.fieldErrors?.password ? 'password-error' : undefined}
          />
          <FieldError name="password" state={state} />
        </div>

        <SubmitButton pendingLabel="로그인 중…" className="btn-primary w-full">
          로그인
        </SubmitButton>
      </form>

      <div className="mt-5 space-y-2 text-sm">
        <Link href="/reset-password" className="text-accent underline-offset-4 hover:underline">
          비밀번호를 잊으셨나요?
        </Link>
        <p className="text-xs leading-relaxed text-muted">
          이 서비스는 두 사람만 쓰는 비공개 공간이라 공개 가입을 받지 않습니다. 계정이 필요하면
          운영자에게 요청하고, 초대를 받았다면 받은 초대 링크를 열어 주세요.
        </p>
      </div>
    </>
  );
}
