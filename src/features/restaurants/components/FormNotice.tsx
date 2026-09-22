'use client';

import { forwardRef, type ReactNode } from 'react';

import { ErrorNotice } from '@/components/ErrorNotice';

export type Notice =
  | { tone: 'error'; title?: string; message: string }
  | { tone: 'success'; message: string };

/**
 * 폼 상단 요약. 내부 오류 코드는 보여 주지 않는다.
 * 포커스를 받을 수 있게 tabIndex=-1을 둔다(첫 오류 필드가 없을 때 이곳으로 옮긴다, DESIGN 9).
 */
export const FormNotice = forwardRef<HTMLDivElement, { notice: Notice | null; children?: ReactNode }>(
  function FormNotice({ notice, children }, ref) {
    return (
      <div ref={ref} tabIndex={-1} className="outline-none">
        {notice === null ? null : notice.tone === 'error' ? (
          <ErrorNotice title={notice.title ?? '처리하지 못했어요'} description={notice.message}>
            {children}
          </ErrorNotice>
        ) : (
          <p
            role="status"
            className="rounded-card border border-border bg-surface-muted px-4 py-3 text-sm leading-relaxed text-text"
          >
            {notice.message}
          </p>
        )}
      </div>
    );
  },
);

/** 필드 이름 → 입력 요소 id. 오류가 난 첫 필드로 포커스를 옮길 때 쓴다. */
export function focusFirstField(
  fieldErrors: Record<string, string> | undefined,
  idFor: (field: string) => string,
  fallback: HTMLElement | null,
): void {
  const first = fieldErrors ? Object.keys(fieldErrors).find((key) => key !== '_form') : undefined;
  if (first) {
    const element = document.getElementById(idFor(first));
    if (element) {
      element.focus();
      if (document.activeElement === element) return;
    }
  }
  fallback?.focus();
}
