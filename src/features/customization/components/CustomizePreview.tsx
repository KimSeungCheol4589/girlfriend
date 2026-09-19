'use client';

import { Photo } from '@/components/Photo';
import { HOME_SECTION_LABELS } from '@/lib/contracts';
import { daysTogether } from '@/lib/dates';
import { themeCssVariables } from '@/lib/theme';
import type { DemoCoverPreview, DemoCustomization, DemoSpace } from '@/lib/demo/types';

/**
 * 미리보기는 이 영역 안에서만 CSS 변수를 바꾼다.
 * DESIGN.md 4.2: 미리보기는 브라우저 상태에만 적용하고 저장할 때 공유 설정을 바꾼다.
 */
export function CustomizePreview({
  customization,
  coverPreview,
  space,
}: {
  customization: DemoCustomization;
  coverPreview: DemoCoverPreview | null;
  space: DemoSpace;
}) {
  const dayCount = daysTogether(space.relationshipStartDate);
  const visible = customization.sections.filter((section) => section.visible);

  return (
    <div
      data-theme={customization.themeKey}
      style={themeCssVariables(customization.themeKey, customization.accentColor)}
      className="overflow-hidden rounded-card border border-border bg-background shadow-card"
    >
      <div
        className="relative overflow-hidden"
        style={{ backgroundImage: 'var(--cover-gradient)' }}
      >
        {coverPreview ? (
          <>
            <div className="absolute inset-0">
              <Photo src={coverPreview.objectUrl} alt={coverPreview.alt} sizes="320px" />
            </div>
            <div
              aria-hidden
              className="absolute inset-0 bg-gradient-to-t from-[#fffdfa]/95 via-[#fffdfa]/60 to-[#fffdfa]/20"
            />
          </>
        ) : null}

        <div className="relative flex min-h-[132px] flex-col justify-end gap-1 px-4 py-4">
          <p className="text-base font-bold text-[#3a332e]">{space.name}</p>
          <p className="line-clamp-1 text-xs text-[#584e46]">{space.introduction}</p>
          {dayCount.status === 'ok' ? (
            <span className="w-fit rounded-pill bg-[#fffdfa]/85 px-2.5 py-1 text-[11px] font-semibold text-[#3a332e]">
              함께한 지 {dayCount.days.toLocaleString('ko-KR')}일
            </span>
          ) : null}
        </div>
      </div>

      <div className="space-y-2.5 p-4">
        {visible.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border px-3 py-6 text-center text-xs text-muted">
            표시할 섹션이 없습니다. 홈이 커버만 남아요.
          </p>
        ) : (
          visible.map((section) => (
            <div key={section.key} className="rounded-xl border border-border bg-surface px-3 py-2.5">
              <p className="text-xs font-bold text-text">{HOME_SECTION_LABELS[section.key]}</p>
              <div className="mt-2 flex gap-1.5">
                <span className="h-8 flex-1 rounded-lg bg-surface-muted" />
                <span className="h-8 flex-1 rounded-lg bg-surface-muted" />
                <span className="h-8 w-8 rounded-lg bg-accent-soft" />
              </div>
            </div>
          ))
        )}

        <button
          type="button"
          disabled
          className="pointer-events-none w-full rounded-pill bg-accent px-4 py-2 text-xs font-semibold text-accent-contrast"
        >
          새 추억 쓰기
        </button>
      </div>
    </div>
  );
}
