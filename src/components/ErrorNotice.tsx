import type { ReactNode } from 'react';

/**
 * 실패 안내.
 *
 * 기본은 사람이 읽는 제목·설명만 보여 주는 것이다.
 * `code`는 사용자가 실제로 쓸 수 있는 값(예: 오류 digest)에만 넘긴다.
 * DESIGN.md 7의 내부 오류 코드는 일반 화면에 노출하지 않는다.
 */
export function ErrorNotice({
  title,
  description,
  code,
  children,
  role = 'alert',
}: {
  title: string;
  description?: string;
  code?: string;
  children?: ReactNode;
  role?: 'alert' | 'status';
}) {
  return (
    <div
      role={role}
      className="rounded-card border border-[#E7C3C0] bg-[#FDF2F1] px-4 py-3.5 text-[#7A2E28]"
    >
      <div className="flex items-start gap-2.5">
        <span aria-hidden className="mt-0.5 text-base leading-none">
          ⚠️
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold">{title}</p>
          {description ? (
            <p className="mt-1 text-sm leading-relaxed text-[#8A453E]">{description}</p>
          ) : null}
          {code ? (
            <p className="mt-1.5 font-mono text-[11px] tracking-wide text-[#A2655F]">
              {code}
            </p>
          ) : null}
          {children ? <div className="mt-3">{children}</div> : null}
        </div>
      </div>
    </div>
  );
}
