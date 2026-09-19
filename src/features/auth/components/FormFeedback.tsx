'use client';

import { useEffect, useRef } from 'react';
import { useFormStatus } from 'react-dom';

import { ErrorNotice } from '@/components/ErrorNotice';

import type { AuthFormState } from '../form-state';

/**
 * 폼 상단 요약.
 *
 * 실패는 사람이 읽는 문장만 보여 준다. 내부 오류 코드는 화면에 쓰지 않는다(UI-001의 규칙).
 * 첫 오류 필드가 있으면 그 필드로, 없으면 이 요약으로 포커스를 옮긴다(DESIGN.md 9).
 */
export function FormFeedback({ state }: { state: AuthFormState }) {
  const summaryRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (state.status === 'idle') return;

    if (state.status === 'error' && state.firstField) {
      const field = document.querySelector<HTMLElement>(`[name="${CSS.escape(state.firstField)}"]`);
      if (field) {
        field.focus();
        if (document.activeElement === field) return;
      }
    }
    summaryRef.current?.focus();
  }, [state]);

  if (state.status === 'idle' || !state.message) return null;

  return (
    <div ref={summaryRef} tabIndex={-1} className="mb-4 outline-none">
      {state.status === 'error' ? (
        <ErrorNotice title="처리하지 못했어요" description={state.message} />
      ) : (
        <p
          role="status"
          className="rounded-card border border-border bg-surface-muted px-4 py-3 text-sm leading-relaxed text-text"
        >
          {state.message}
        </p>
      )}
    </div>
  );
}

/** 제출 중에는 버튼을 비활성화한다. 중복 요청은 서버의 requestId로도 막는다. */
export function SubmitButton({
  children,
  pendingLabel,
  className = 'btn-primary',
}: {
  children: React.ReactNode;
  pendingLabel?: string;
  className?: string;
}) {
  const { pending } = useFormStatus();

  return (
    <button type="submit" className={className} disabled={pending} aria-busy={pending}>
      {pending ? (pendingLabel ?? '처리 중…') : children}
    </button>
  );
}

/** 필드 아래 오류 문구. */
export function FieldError({ name, state }: { name: string; state: AuthFormState }) {
  const message = state.fieldErrors?.[name];
  if (!message) return null;
  return (
    <p id={`${name}-error`} className="field-error">
      {message}
    </p>
  );
}
