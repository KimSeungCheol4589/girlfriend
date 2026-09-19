'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';

/** 대화상자가 열렸을 때 배경을 비활성화할 영역. AppShell이 이 id를 단다. */
export const APP_ROOT_ID = 'app-shell-root';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * 삭제·이탈 확인 대화상자.
 *
 * DESIGN.md 9: 대상 제목과 함께 지워지는 항목을 표시하고 Esc·취소로 되돌릴 수 있게 한다.
 * 접근성: 열릴 때 포커스를 안으로 옮기고 Tab을 대화상자 안에서만 돌린다.
 * 배경은 inert로 비활성화하고 스크롤을 잠그며, 닫을 때 원래 요소로 포커스를 되돌린다.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  details,
  confirmLabel,
  cancelLabel = '취소',
  tone = 'danger',
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description: string;
  details?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: 'danger' | 'neutral';
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const headingId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return undefined;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    const appRoot = document.getElementById(APP_ROOT_ID);
    const previousOverflow = document.body.style.overflow;

    appRoot?.setAttribute('inert', '');
    document.body.style.overflow = 'hidden';
    confirmRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCancel();
        return;
      }

      if (event.key !== 'Tab') return;

      const container = dialogRef.current;
      if (!container) return;

      const focusable = Array.from(
        container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      ).filter((element) => element.offsetParent !== null);
      if (focusable.length === 0) return;

      const first = focusable[0] as HTMLElement;
      const last = focusable[focusable.length - 1] as HTMLElement;
      const active = document.activeElement;

      // 대화상자 밖으로 나가지 않도록 양끝에서 순환시킨다.
      if (event.shiftKey && (active === first || !container.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !container.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);

    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      appRoot?.removeAttribute('inert');
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus?.();
    };
  }, [open, onCancel]);

  if (!open || !mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-[#2B2522]/40 p-4 sm:items-center">
      {/* 배경 클릭으로 닫는다. 포커스 순서에는 넣지 않는다. */}
      <div
        aria-hidden
        onClick={onCancel}
        className="absolute inset-0 h-full w-full cursor-default"
      />
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={headingId}
        aria-describedby={descriptionId}
        className="relative w-full max-w-md rounded-card border border-border bg-surface p-5 shadow-raised"
      >
        <h2 id={headingId} className="text-base font-bold text-text">
          {title}
        </h2>
        <p id={descriptionId} className="mt-2 text-sm leading-relaxed text-muted">
          {description}
        </p>
        {details ? <div className="mt-3">{details}</div> : null}
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={onCancel} className="btn-secondary">
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            className={
              tone === 'danger'
                ? 'tap-target gap-2 rounded-pill bg-[#B3261E] px-5 text-sm font-semibold text-white transition-opacity hover:opacity-90'
                : 'btn-primary'
            }
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
