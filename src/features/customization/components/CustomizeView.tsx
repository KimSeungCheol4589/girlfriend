'use client';

import { useEffect, useRef, useState } from 'react';

import { ConfirmDialog } from '@/components/ConfirmDialog';
import { ErrorNotice } from '@/components/ErrorNotice';
import { CoverPicker } from '@/features/customization/components/CoverPicker';
import { CustomizePreview } from '@/features/customization/components/CustomizePreview';
import { isSameCover } from '@/features/customization/cover';
import {
  ACCENT_PRESETS,
  cloneCustomization,
  isSameCustomization,
  moveSection,
  toggleSection,
  validateCustomization,
} from '@/features/customization/schema';
import { useUnsavedGuard } from '@/components/UnsavedGuard';
import { HOME_SECTION_LABELS, type HomeSectionKey } from '@/lib/contracts';
import { useDemoStore } from '@/lib/demo/demo-store';
import type { DemoCoverPreview } from '@/lib/demo/types';
import { accentContrastColor, contrastRatio, isHexColor, THEME_PRESET_LIST } from '@/lib/theme';

/**
 * 데모 리셋('예시 데이터로 되돌리기')이 일어나면 편집기를 다시 마운트한다.
 * 편집기의 draft는 저장소 값을 복사한 로컬 state라 리셋과 자동으로 동기화되지 않고,
 * 리셋이 해제한 커버 objectURL이 draft에 남으면 깨진 이미지를 다시 적용할 수 있다.
 */
export function CustomizeView() {
  const { revision } = useDemoStore();
  return <CustomizeEditor key={revision} />;
}

function CustomizeEditor() {
  const { state, applyCustomization } = useDemoStore();
  const saved = state.customization;
  const savedCover = state.coverPreview;

  const [draft, setDraft] = useState(() => cloneCustomization(saved));
  const [draftCover, setDraftCover] = useState<DemoCoverPreview | null>(savedCover);
  const [accentInput, setAccentInput] = useState(saved.accentColor);
  const [error, setError] = useState<string | null>(null);
  const [applied, setApplied] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);

  const dirty = !isSameCustomization(draft, saved) || !isSameCover(draftCover, savedCover);

  /**
   * 아직 적용하지 않은 커버 미리보기 주소를 정리하기 위해 최신 값을 참조로 들고 있는다.
   * 적용한 커버는 저장소가 소유하므로 여기서 해제하지 않는다.
   */
  const pendingCoverRef = useRef<{ draft: DemoCoverPreview | null; saved: DemoCoverPreview | null }>({
    draft: savedCover,
    saved: savedCover,
  });
  pendingCoverRef.current = { draft: draftCover, saved: savedCover };

  useEffect(() => {
    return () => {
      const { draft: pending, saved: current } = pendingCoverRef.current;
      if (pending && !isSameCover(pending, current)) {
        URL.revokeObjectURL(pending.objectUrl);
      }
    };
  }, []);

  /** 적용하지 않은 커버 미리보기를 버린다. */
  const discardDraftCover = (next: DemoCoverPreview | null) => {
    const pending = pendingCoverRef.current.draft;
    if (pending && !isSameCover(pending, savedCover) && !isSameCover(pending, next)) {
      URL.revokeObjectURL(pending.objectUrl);
    }
  };

  // DESIGN.md 4.2: 미저장 상태에서 화면을 벗어나려 하면 확인한다.
  // 탭 닫기·새로고침은 beforeunload가, 앱 안의 메뉴 이동은 아래 가드가 맡는다.
  // 브라우저 뒤로/앞으로 가기 버튼은 두 방법 모두로 막을 수 없다.
  useEffect(() => {
    if (!dirty) return undefined;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  useUnsavedGuard(dirty, {
    title: '적용하지 않은 꾸미기 설정이 있어요',
    description:
      '지금 고른 테마·포인트 색상·커버·섹션 설정은 적용하지 않으면 사라집니다. 이동할까요?',
    confirmLabel: '이동하기',
    cancelLabel: '계속 꾸미기',
  });

  const patch = (next: Partial<typeof draft>) => {
    setDraft((current) => ({ ...current, ...next }));
    setApplied(false);
    setError(null);
  };

  const handleAccentInput = (value: string) => {
    setAccentInput(value);
    if (isHexColor(value)) patch({ accentColor: value });
  };

  const handleCoverChange = (next: DemoCoverPreview | null) => {
    discardDraftCover(next);
    setDraftCover(next);
    setApplied(false);
    setError(null);
  };

  const restore = () => {
    discardDraftCover(savedCover);
    setDraft(cloneCustomization(saved));
    setDraftCover(savedCover);
    setAccentInput(saved.accentColor);
    setError(null);
    setApplied(false);
    setCancelOpen(false);
  };

  const handleApply = () => {
    const result = validateCustomization(draft);
    if (!result.ok) {
      setError(result.message);
      setApplied(false);
      return;
    }
    // 커버 미리보기는 계약(coverAssetId)이 아니라 별도 값으로 넘긴다.
    const outcome = applyCustomization(draft, draftCover);
    if (!outcome.ok) {
      setError(outcome.message);
      return;
    }
    setError(null);
    setApplied(true);
  };

  const ratio = contrastRatio(accentContrastColor(draft.accentColor), draft.accentColor);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-text">꾸미기</h1>
        <p className="mt-1 text-sm leading-relaxed text-muted">
          테마와 포인트 색상, 커버, 홈 섹션 순서를 정해 보세요. 미리보기는 지금 고른 값만
          보여 주고, ‘적용’을 눌러야 이 브라우저의 홈 화면에 반영됩니다.
        </p>
      </div>

      {error ? <ErrorNotice title="설정을 확인해 주세요" description={error} /> : null}

      {applied && !dirty ? (
        <div
          role="status"
          className="rounded-card border border-border bg-surface-muted px-4 py-3 text-sm leading-relaxed text-text"
        >
          이 브라우저의 홈 화면에 적용했어요. 상대방 화면으로 전달하는 공유 저장은 아직 만들지
          않았고, 새로고침하면 기본 테마로 돌아갑니다.
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-6">
          <section aria-labelledby="theme-heading" className="app-card px-4 py-5 sm:px-6">
            <h2 id="theme-heading" className="text-base font-bold text-text">
              테마
            </h2>
            <p className="field-hint mt-0.5">배경과 커버 분위기를 바꿉니다.</p>
            <ul className="mt-4 grid gap-3 sm:grid-cols-3">
              {THEME_PRESET_LIST.map((preset) => {
                const active = draft.themeKey === preset.key;
                return (
                  <li key={preset.key}>
                    <button
                      type="button"
                      onClick={() => patch({ themeKey: preset.key })}
                      aria-pressed={active}
                      className={`w-full rounded-xl border-2 p-2.5 text-left transition-colors ${
                        active ? 'border-accent bg-accent-soft' : 'border-border hover:bg-surface-muted'
                      }`}
                    >
                      <span
                        aria-hidden
                        className="block h-16 w-full rounded-lg"
                        style={{ backgroundImage: preset.coverGradient }}
                      />
                      <span className="mt-2 block text-sm font-bold text-text">{preset.label}</span>
                      <span className="mt-0.5 block text-[11px] leading-relaxed text-muted">
                        {preset.description}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>

          <section aria-labelledby="accent-heading" className="app-card px-4 py-5 sm:px-6">
            <h2 id="accent-heading" className="text-base font-bold text-text">
              포인트 색상
            </h2>
            <p className="field-hint mt-0.5">버튼과 강조 표시에 쓰입니다.</p>

            <ul className="mt-4 flex flex-wrap gap-2">
              {ACCENT_PRESETS.map((preset) => {
                const active = draft.accentColor.toLowerCase() === preset.value.toLowerCase();
                return (
                  <li key={preset.value}>
                    <button
                      type="button"
                      onClick={() => {
                        patch({ accentColor: preset.value });
                        setAccentInput(preset.value);
                      }}
                      aria-pressed={active}
                      className={`tap-target gap-2 rounded-pill border-2 px-3 text-sm font-medium ${
                        active ? 'border-accent text-text' : 'border-border text-muted'
                      }`}
                    >
                      <span
                        aria-hidden
                        className="h-4 w-4 rounded-full border border-black/10"
                        style={{ backgroundColor: preset.value }}
                      />
                      {preset.label}
                    </button>
                  </li>
                );
              })}
            </ul>

            <div className="mt-4 flex flex-wrap items-end gap-3">
              <div>
                <label htmlFor="accent-hex" className="field-label">
                  직접 입력
                </label>
                <input
                  id="accent-hex"
                  value={accentInput}
                  onChange={(event) => handleAccentInput(event.target.value)}
                  placeholder="#8B435A"
                  spellCheck={false}
                  aria-invalid={!isHexColor(accentInput)}
                  className="field-input w-40 font-mono"
                />
              </div>
              <span
                className="tap-target rounded-pill px-4 text-sm font-semibold"
                style={{
                  backgroundColor: draft.accentColor,
                  color: accentContrastColor(draft.accentColor),
                }}
              >
                버튼 미리보기
              </span>
            </div>

            {!isHexColor(accentInput) ? (
              <p className="field-error">#RRGGBB 형식으로 입력해 주세요. 예: #8B435A</p>
            ) : (
              <p className="field-hint">
                글자색은 대비에 맞춰 자동으로 고릅니다. 현재 대비 {ratio ? ratio.toFixed(1) : '-'}:1
                {ratio !== null && ratio < 4.5
                  ? ' — 작은 글자에는 조금 약해요. 더 진하거나 더 연한 색을 권합니다.'
                  : ''}
              </p>
            )}
          </section>

          <CoverPicker cover={draftCover} onChange={handleCoverChange} />

          <section aria-labelledby="sections-heading" className="app-card px-4 py-5 sm:px-6">
            <h2 id="sections-heading" className="text-base font-bold text-text">
              홈 섹션 순서와 표시
            </h2>
            <p className="field-hint mt-0.5">
              세 섹션의 순서만 바꿀 수 있고 새로 추가하거나 지울 수는 없어요.
            </p>

            <ol className="mt-4 space-y-2">
              {draft.sections.map((section, index) => (
                <li
                  key={section.key}
                  className="flex flex-wrap items-center gap-2 rounded-xl border border-border px-3 py-2"
                >
                  <span className="text-xs font-bold text-muted">{index + 1}</span>
                  <span className="flex-1 text-sm font-semibold text-text">
                    {HOME_SECTION_LABELS[section.key as HomeSectionKey]}
                  </span>

                  <button
                    type="button"
                    onClick={() => patch({ sections: moveSection(draft.sections, section.key, 'up') })}
                    disabled={index === 0}
                    aria-label={`${HOME_SECTION_LABELS[section.key]} 위로`}
                    className="tap-target w-touch rounded-pill border border-border text-muted disabled:opacity-30"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      patch({ sections: moveSection(draft.sections, section.key, 'down') })
                    }
                    disabled={index === draft.sections.length - 1}
                    aria-label={`${HOME_SECTION_LABELS[section.key]} 아래로`}
                    className="tap-target w-touch rounded-pill border border-border text-muted disabled:opacity-30"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    onClick={() => patch({ sections: toggleSection(draft.sections, section.key) })}
                    aria-pressed={section.visible}
                    className={`tap-target rounded-pill border px-3 text-xs font-semibold ${
                      section.visible
                        ? 'border-accent bg-accent-soft text-text'
                        : 'border-border text-muted'
                    }`}
                  >
                    {section.visible ? '표시 중' : '숨김'}
                  </button>
                </li>
              ))}
            </ol>
          </section>
        </div>

        <aside className="space-y-3 lg:sticky lg:top-24 lg:self-start">
          <h2 className="text-sm font-bold text-text">미리보기</h2>
          <CustomizePreview customization={draft} coverPreview={draftCover} space={state.space} />
          <p className="text-[11px] leading-relaxed text-muted">
            미리보기는 지금 고른 값만 보여 줍니다. 홈 화면은 ‘적용’ 후에 바뀝니다.
          </p>
        </aside>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-5">
        <button type="button" onClick={handleApply} disabled={!dirty} className="btn-primary">
          적용
        </button>
        <button
          type="button"
          onClick={() => (dirty ? setCancelOpen(true) : restore())}
          disabled={!dirty}
          className="btn-secondary"
        >
          취소하고 되돌리기
        </button>
        {dirty ? (
          <span className="text-xs font-semibold text-muted">아직 적용하지 않은 변경이 있어요.</span>
        ) : null}
      </div>

      <p className="text-xs leading-relaxed text-muted">
        데모 모드입니다. ‘적용’은 이 브라우저 세션에만 반영되고 두 사람이 공유하는 저장은 아직
        구현하지 않았습니다.
      </p>

      <ConfirmDialog
        open={cancelOpen}
        tone="neutral"
        title="마지막 적용 상태로 되돌릴까요?"
        description="지금 고른 테마·색상·섹션 설정은 사라지고 마지막으로 적용한 값으로 돌아갑니다."
        confirmLabel="되돌리기"
        cancelLabel="계속 고르기"
        onCancel={() => setCancelOpen(false)}
        onConfirm={restore}
      />
    </div>
  );
}
