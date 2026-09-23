'use client';

import { Photo } from '@/components/Photo';
import { HOME_SECTION_LABELS } from '@/lib/contracts';
import { accentContrastColor, themeCssVariables } from '@/lib/theme';

import type { CustomizationDraft } from '../schema';

/**
 * 미리보기.
 *
 * 지금 고른 값을 **이 영역에만** 씌운다. 문서 전체(`ThemeScope`)나 공유 설정은 건드리지 않는다.
 * 그래서 미리보기 중에도 다른 화면·상대방 화면은 마지막으로 저장된 테마 그대로다.
 */
export function CustomizePreviewPanel({
  draft,
  coverSrc,
  spaceName,
  introduction,
}: {
  draft: CustomizationDraft;
  /** 초안 커버(대기 중 파일의 blob: 주소이거나 저장된 커버의 인증 경로). */
  coverSrc: string | null;
  spaceName: string;
  introduction: string;
}) {
  const visible = draft.sections.filter((section) => section.visible);

  return (
    <div
      data-testid="customize-preview"
      // 팔레트도 이 영역에서만 바꾼다(globals.css의 `[data-theme=...]`). 문서 루트는 건드리지 않는다.
      data-theme={draft.themeKey}
      style={themeCssVariables(draft.themeKey, draft.accentColor)}
      className="overflow-hidden rounded-card border border-border bg-background"
    >
      <div
        className="relative flex min-h-[132px] flex-col justify-end px-4 py-4"
        style={{ backgroundImage: 'var(--cover-gradient)' }}
      >
        {coverSrc ? (
          <>
            <div className="absolute inset-0">
              <Photo src={coverSrc} alt="" sizes="320px" />
            </div>
            <div
              aria-hidden
              className="absolute inset-0 bg-gradient-to-t from-[#fffdfa]/95 via-[#fffdfa]/55 to-[#fffdfa]/10"
            />
          </>
        ) : null}
        <p className="relative text-sm font-bold text-[#3a332e]">{spaceName}</p>
        {introduction ? (
          <p className="relative mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-[#584e46]">
            {introduction}
          </p>
        ) : null}
      </div>

      <div className="space-y-2 px-4 py-4">
        <span
          className="inline-flex min-h-[32px] items-center rounded-pill px-3 text-xs font-semibold"
          style={{
            backgroundColor: draft.accentColor,
            color: accentContrastColor(draft.accentColor),
          }}
        >
          버튼 미리보기
        </span>

        {visible.length === 0 ? (
          <p className="text-[11px] leading-relaxed text-muted">
            홈 섹션을 모두 숨겼습니다. 커버와 공간 정보만 보여요.
          </p>
        ) : (
          <ol className="space-y-1.5">
            {visible.map((section, index) => (
              <li
                key={section.key}
                className="flex items-center gap-2 rounded-lg bg-surface-muted px-2.5 py-1.5 text-[11px] font-semibold text-text"
              >
                <span aria-hidden className="text-muted">
                  {index + 1}
                </span>
                {HOME_SECTION_LABELS[section.key]}
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
