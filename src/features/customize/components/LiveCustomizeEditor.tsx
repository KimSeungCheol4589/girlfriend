'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, useTransition } from 'react';

import { ConfirmDialog } from '@/components/ConfirmDialog';
import { ErrorNotice } from '@/components/ErrorNotice';
import { useUnsavedGuard } from '@/components/UnsavedGuard';
import { createRequestKeyTracker } from '@/features/memories/live/request-key';
import { HOME_SECTION_LABELS } from '@/lib/contracts';
import { accentContrastColor, contrastRatio, isHexColor, THEME_PRESET_LIST } from '@/lib/theme';

import { coverPhotoUrl } from '../constants';
import { savedNoticeText } from '../cover-pipeline';
import {
  CUSTOMIZE_CODE_MESSAGES,
  isDefinitiveCustomizeResult,
  type CustomizeErrorCode,
  type CustomizeResult,
} from '../errors';
import {
  ACCENT_PRESETS,
  customizationSignatureValues,
  sameCustomization,
  toDraft,
  type CustomizationDraft,
} from '../schema';
import { moveHomeSection, toggleHomeSection } from '../sections';
import { saveCustomizationAction } from '../server/actions';
import type {
  PinCandidatePage,
  QueryFailureCode,
  SaveCustomizationData,
  SavedCustomization,
} from '../types';

import { CoverField } from './CoverField';
import { CustomizePreviewPanel } from './CustomizePreviewPanel';
import { PinnedMemoryPanel } from './PinnedMemoryPanel';
import { useCoverUpload } from './use-cover-upload';

/**
 * 실제 꾸미기 편집기.
 *
 * - 미리보기는 **이 화면의 미리보기 영역에만** 적용한다. 공유 설정·문서 전체 테마는 ‘저장’ 후에 바뀐다.
 * - 저장은 `save_customization` 한 번이다. 버전이 이미 바뀌었으면 DB가 거부하고, 이 화면은
 *   고른 값을 그대로 둔 채 "최신 설정 불러오기"를 **사용자가 고르게** 한다(자동으로 덮지 않는다).
 * - 실패·충돌에서도 초안은 사라지지 않는다.
 * - 추억 고정은 아래 별도 패널에서 한 건씩 저장한다(같은 버튼으로 묶지 않는다).
 */
export function LiveCustomizeEditor({
  saved: serverSaved,
  pinCandidates,
  pinFailureCode,
  photosEnabled,
  spaceName,
  introduction,
}: {
  saved: SavedCustomization;
  pinCandidates: PinCandidatePage | null;
  pinFailureCode: QueryFailureCode | null;
  photosEnabled: boolean;
  spaceName: string;
  introduction: string;
}) {
  const router = useRouter();
  const [saved, setSaved] = useState<SavedCustomization>(serverSaved);
  const [draft, setDraft] = useState<CustomizationDraft>(() => toDraft(serverSaved));
  const [accentInput, setAccentInput] = useState(serverSaved.accentColor);
  const [problem, setProblem] = useState<{ code: CustomizeErrorCode; message: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [resetSignal, setResetSignal] = useState(0);
  const [pinDirty, setPinDirty] = useState(false);
  const [refreshing, startRefresh] = useTransition();
  const tracker = useRef(createRequestKeyTracker());
  const inFlight = useRef(false);
  /** 사용자가 "최신 설정 불러오기"를 고른 뒤 도착한 서버 값만 받아들인다. */
  const adoptServerValue = useRef(false);

  const handleCoverReady = useCallback((assetId: string) => {
    setDraft((current) => ({ ...current, coverAssetId: assetId }));
    setNotice(null);
  }, []);

  const upload = useCoverUpload({
    enabled: photosEnabled,
    savedCoverAssetId: saved.coverAssetId,
    onReady: handleCoverReady,
  });

  const settingsDirty = !sameCustomization(draft, toDraft(saved));
  const dirty = settingsDirty || pinDirty;

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
    title: '저장하지 않은 꾸미기 변경이 있어요',
    description:
      '지금 고른 테마·포인트 색상·커버·섹션과 저장하지 않은 고정 변경은 사라집니다. 이동할까요?',
    confirmLabel: '이동하기',
    cancelLabel: '계속 꾸미기',
  });

  // 사용자가 명시적으로 고른 "최신 설정 불러오기" 뒤에만 서버 값으로 바꾼다.
  // 그렇지 않으면 충돌 때 초안을 조용히 덮어써 사용자가 고른 값을 잃는다.
  useEffect(() => {
    if (!adoptServerValue.current) return;
    adoptServerValue.current = false;
    setSaved(serverSaved);
    setDraft(toDraft(serverSaved));
    setAccentInput(serverSaved.accentColor);
    setProblem(null);
    setNotice('최신 설정을 불러왔어요. 고르던 값 대신 저장된 값을 보여 줍니다.');
  }, [serverSaved]);

  const patch = (next: Partial<CustomizationDraft>) => {
    setDraft((current) => ({ ...current, ...next }));
    setNotice(null);
  };

  const handleAccentInput = (value: string) => {
    setAccentInput(value);
    if (isHexColor(value)) patch({ accentColor: value.toLowerCase() });
  };

  const restore = () => {
    // 저장된 값으로 되돌린다. 아직 저장하지 않은 커버 파일은 버리고, **이미 저장된 커버는 그대로** 둔다.
    upload.clearPending();
    setDraft(toDraft(saved));
    setAccentInput(saved.accentColor);
    setProblem(null);
    setNotice(null);
    setCancelOpen(false);
    // 저장하지 않은 고정 초안만 되돌린다(이미 저장한 고정은 유지된다).
    setResetSignal((value) => value + 1);
  };

  const handleSave = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setSaving(true);
    setProblem(null);
    setNotice(null);
    upload.setSaveInFlight(true);

    const signature = customizationSignatureValues(draft, saved.version);
    const requestId = tracker.current.keyFor(signature);

    let result: CustomizeResult<SaveCustomizationData>;
    try {
      result = await saveCustomizationAction({
        themeKey: draft.themeKey,
        accentColor: draft.accentColor,
        coverAssetId: draft.coverAssetId,
        sections: draft.sections,
        expectedVersion: saved.version,
        requestId,
      });
    } catch {
      result = { ok: false, code: 'RETRYABLE_ERROR', message: CUSTOMIZE_CODE_MESSAGES.RETRYABLE_ERROR };
    }

    tracker.current.settle(isDefinitiveCustomizeResult(result));
    inFlight.current = false;
    setSaving(false);

    if (!result.ok) {
      // 초안은 그대로 둔다. 무엇이 저장되지 않았는지만 알린다.
      upload.setSaveInFlight(false);
      setProblem({ code: result.code, message: result.message });
      return;
    }

    const coverAssetId = result.data.coverAssetId;
    upload.settleSave(result.data);

    setSaved({
      themeKey: draft.themeKey,
      accentColor: draft.accentColor,
      coverAssetId,
      sections: draft.sections.map((section) => ({ ...section })),
      version: result.data.version,
      // 커버가 바뀌었다면 방금 내가 올린 파일이다. 그대로면 알고 있던 값을 유지한다(모르면 모르는 채로).
      coverUploadedByMe:
        coverAssetId === null ? null : coverAssetId === saved.coverAssetId ? saved.coverUploadedByMe : true,
    });
    setDraft((current) => ({ ...current, coverAssetId }));
    setNotice(savedNoticeText(result.data));
    // 저장된 테마를 껍데기·홈에도 반영한다(서버가 이미 캐시를 비웠다).
    startRefresh(() => router.refresh());
  };

  const reloadSaved = () => {
    adoptServerValue.current = true;
    startRefresh(() => router.refresh());
  };

  const ratio = contrastRatio(accentContrastColor(draft.accentColor), draft.accentColor);
  const previewCoverSrc =
    upload.previewUrl !== null && draft.coverAssetId !== null && draft.coverAssetId !== saved.coverAssetId
      ? upload.previewUrl
      : draft.coverAssetId !== null
        ? coverPhotoUrl(draft.coverAssetId)
        : null;

  const busy = saving || refreshing || upload.busy;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-text">꾸미기</h1>
        <p className="mt-1 text-sm leading-relaxed text-muted">
          테마와 포인트 색상, 커버, 홈 섹션 순서를 정합니다. 미리보기는 지금 고른 값만 보여 주고,
          ‘꾸미기 저장’을 눌러야 두 사람이 함께 쓰는 설정으로 저장됩니다.
        </p>
      </div>

      {notice ? (
        <p
          role="status"
          className="rounded-card border border-border bg-surface-muted px-4 py-3 text-sm leading-relaxed text-text"
        >
          {notice}
        </p>
      ) : null}

      {problem ? (
        <ErrorNotice
          title={problem.code === 'CONFLICT' ? '상대방이 먼저 저장했어요' : '저장하지 못했어요'}
          description={problem.message}
        >
          {problem.code === 'CONFLICT' || problem.code === 'NOT_FOUND' ? (
            <button
              type="button"
              className="btn-secondary !min-h-[36px] text-xs"
              disabled={refreshing}
              onClick={reloadSaved}
            >
              {refreshing ? '불러오는 중…' : '최신 설정 불러오기 (고른 값은 사라져요)'}
            </button>
          ) : null}
        </ErrorNotice>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-6">
          <section aria-labelledby="theme-heading" className="app-card px-4 py-5 sm:px-6">
            <h2 id="theme-heading" className="text-base font-bold text-text">
              테마
            </h2>
            <p className="field-hint mt-0.5">배경과 커버 분위기를 바꿉니다.</p>
            {/* 포인트 색상 프리셋에 같은 이름(세이지·로즈)이 있어 영역을 구분해 둔다. */}
            <ul data-testid="theme-picker" className="mt-4 grid gap-3 sm:grid-cols-3">
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

            <ul data-testid="accent-picker" className="mt-4 flex flex-wrap gap-2">
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
                  placeholder="#8b435a"
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
              <p className="field-error">#RRGGBB 형식으로 입력해 주세요. 예: #8b435a</p>
            ) : (
              <p className="field-hint">
                글자색은 대비에 맞춰 자동으로 고릅니다. 현재 대비 {ratio ? ratio.toFixed(1) : '-'}:1
                {ratio !== null && ratio < 4.5
                  ? ' — 작은 글자에는 조금 약해요. 더 진하거나 더 연한 색을 권합니다.'
                  : ''}
              </p>
            )}
          </section>

          <CoverField
            upload={upload}
            draftCoverAssetId={draft.coverAssetId}
            savedCoverAssetId={saved.coverAssetId}
            coverUploadedByMe={saved.coverUploadedByMe}
            photosEnabled={photosEnabled}
            onRemove={() => {
              upload.clearPending();
              patch({ coverAssetId: null });
            }}
            onRestoreSaved={() => {
              upload.clearPending();
              patch({ coverAssetId: saved.coverAssetId });
            }}
          />

          <section aria-labelledby="sections-heading" className="app-card px-4 py-5 sm:px-6">
            <h2 id="sections-heading" className="text-base font-bold text-text">
              홈 섹션 순서와 표시
            </h2>
            <p className="field-hint mt-0.5">
              세 섹션의 순서만 바꿀 수 있고 새로 추가하거나 지울 수는 없어요. 숨기면 홈에서 그 섹션만 빠집니다.
            </p>

            <ol className="mt-4 space-y-2">
              {draft.sections.map((section, index) => (
                <li
                  key={section.key}
                  className="flex flex-wrap items-center gap-2 rounded-xl border border-border px-3 py-2"
                >
                  <span className="text-xs font-bold text-muted">{index + 1}</span>
                  <span className="flex-1 text-sm font-semibold text-text">
                    {HOME_SECTION_LABELS[section.key]}
                  </span>

                  <button
                    type="button"
                    onClick={() => patch({ sections: moveHomeSection(draft.sections, section.key, 'up') })}
                    disabled={index === 0}
                    aria-label={`${HOME_SECTION_LABELS[section.key]} 위로`}
                    className="tap-target w-touch rounded-pill border border-border text-muted disabled:opacity-30"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => patch({ sections: moveHomeSection(draft.sections, section.key, 'down') })}
                    disabled={index === draft.sections.length - 1}
                    aria-label={`${HOME_SECTION_LABELS[section.key]} 아래로`}
                    className="tap-target w-touch rounded-pill border border-border text-muted disabled:opacity-30"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    onClick={() => patch({ sections: toggleHomeSection(draft.sections, section.key) })}
                    aria-pressed={section.visible}
                    aria-label={`${HOME_SECTION_LABELS[section.key]} ${section.visible ? '숨기기' : '표시하기'}`}
                    className={`tap-target rounded-pill border px-3 text-xs font-semibold ${
                      section.visible ? 'border-accent bg-accent-soft text-text' : 'border-border text-muted'
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
          <CustomizePreviewPanel
            draft={draft}
            coverSrc={previewCoverSrc}
            spaceName={spaceName}
            introduction={introduction}
          />
          <p className="text-[11px] leading-relaxed text-muted">
            미리보기는 이 화면에서만 적용됩니다. 저장하기 전에는 다른 화면과 상대방 화면 모두 마지막으로
            저장된 설정 그대로예요.
          </p>
        </aside>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-5">
        <button type="button" onClick={() => void handleSave()} disabled={!settingsDirty || busy} className="btn-primary">
          {saving ? '저장하는 중…' : '꾸미기 저장'}
        </button>
        <button
          type="button"
          onClick={() => (dirty ? setCancelOpen(true) : restore())}
          disabled={!dirty || saving}
          className="btn-secondary"
        >
          취소하고 되돌리기
        </button>
        {settingsDirty ? (
          <span className="text-xs font-semibold text-muted">아직 저장하지 않은 변경이 있어요.</span>
        ) : null}
      </div>

      <PinnedMemoryPanel
        initial={pinCandidates}
        failureCode={pinFailureCode}
        resetSignal={resetSignal}
        onDirtyChange={setPinDirty}
      />

      <ConfirmDialog
        open={cancelOpen}
        tone="neutral"
        title="마지막으로 저장한 설정으로 되돌릴까요?"
        description="지금 고른 테마·색상·커버·섹션과 저장하지 않은 고정 변경이 사라집니다. 이미 저장한 값은 그대로 남아요."
        confirmLabel="되돌리기"
        cancelLabel="계속 고르기"
        onCancel={() => setCancelOpen(false)}
        onConfirm={restore}
      />
    </div>
  );
}
