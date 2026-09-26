'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { ConfirmDialog } from '@/components/ConfirmDialog';
import { ErrorNotice } from '@/components/ErrorNotice';
import { useUnsavedGuard } from '@/components/UnsavedGuard';
import { normalizeTags, validateMemoryDraft } from '@/features/memories/schema';
import { MEMORY_LIMITS } from '@/lib/contracts';
import { todayInSeoul } from '@/lib/dates';

import { SourceDraftCard } from '../../links/components/SourceDraftCard';
import { LINK_CODE_MESSAGES } from '../../links/errors';
import { shouldAttemptLink } from '../../links/link-attempt';
import type { MemoryPrefill } from '../../links/prefill';
import { linkMemoryPlanAction } from '../../links/server/actions';
import { memoryLinkPath, type MemorySourceRef } from '../../links/source';
import type { LinkMemoryData } from '../../links/types';
import { saveMemoryAction } from '../../server/actions';
import {
  MEMORY_CODE_MESSAGES,
  isDefinitiveMemoryResult,
  type MemoryActionResult,
  type MemoryErrorCode,
  type MemoryFieldErrors,
  type MemoryFormField,
} from '../errors';
import { createRequestKeyTracker } from '../request-key';
import type { SaveMemoryData } from '../types';

import { LivePhotoPicker } from './LivePhotoPicker';
import { existingPhotoItems, useLivePhotos } from './use-live-photos';

/**
 * 완료한 일정·위시에서 들어왔을 때 서버가 만들어 주는 초안.
 * 제목·날짜·장소만 채우고 본문은 사용자의 글이다(DATE-001).
 */
export type LinkDraft = {
  ref: MemorySourceRef;
  prefill: MemoryPrefill;
  /** 원본 제목 원문(줄이지 않은 값). 카드 표시에만 쓴다. */
  sourceTitle: string;
  sourceSummary: string;
  sourceHref: string;
};

export type EditableMemory = {
  id: string;
  version: number;
  title: string;
  body: string;
  memoryDate: string;
  location: string | null;
  tags: string[];
  isPinned: boolean;
  photoAssetIds: string[];
};

type FormState = {
  title: string;
  body: string;
  memoryDate: string;
  location: string;
  tagsInput: string;
  isPinned: boolean;
};

function initialFormState(
  memory: EditableMemory | undefined,
  link: LinkDraft | undefined,
): FormState {
  if (!memory) {
    // 연결 초안이 있으면 제목·날짜·장소만 채운다. 본문은 언제나 사용자가 쓴 글이다.
    return {
      title: link?.prefill.title ?? '',
      body: '',
      memoryDate: link?.prefill.memoryDate ?? todayInSeoul(),
      location: link?.prefill.location ?? '',
      tagsInput: '',
      isPinned: false,
    };
  }
  return {
    title: memory.title,
    body: memory.body,
    memoryDate: memory.memoryDate,
    location: memory.location ?? '',
    tagsInput: memory.tags.join(', '),
    isPinned: memory.isPinned,
  };
}

const FIELD_IDS: Record<MemoryFormField, string> = {
  title: 'memory-title',
  memoryDate: 'memory-date',
  location: 'memory-location',
  tags: 'memory-tags',
  body: 'memory-body',
  photos: 'memory-photos',
};

const FIELD_ORDER: MemoryFormField[] = ['title', 'memoryDate', 'location', 'tags', 'body', 'photos'];

type SaveProblem = { code: MemoryErrorCode; message: string };

/** 본문·사진 저장이 끝난 뒤의 복구 지점. 연결만 다시 시도할 때 쓴다. */
type SavedMemory = { id: string; version: number; cleanup: SaveMemoryData['cleanup'] };

/**
 * 실제 추억 작성·수정 폼.
 *
 * - 저장은 서버가 세션·공간을 다시 확인한 뒤 `save_memory` RPC로 한다. 성공 응답을 받기 전에는
 *   "저장됨"을 표시하지 않는다.
 * - 실패(네트워크·검증·충돌·업로드)해도 입력한 글과 이미 올린 사진을 그대로 둔다.
 * - 같은 입력의 재시도는 같은 requestId, 입력을 고치면 새 requestId(중복 저장 방지는 DB도 한다).
 * - 저장 중에는 버튼을 막아 두 번 제출되지 않게 한다.
 *
 * ## 연결(DATE-001)은 2단계다
 *
 * 1) 기존 `save_memory`로 본문·사진을 **원자적으로** 저장한다(이 경로는 그대로 재사용한다).
 * 2) 반환받은 memoryId·version으로 `link_memory_plan`을 부른다.
 *
 * 연결만 실패하면 **이미 저장된 기록과 사진은 그대로 남는다.** 그래서 화면이 부분 성공을
 * 분명히 알리고 **연결만** 다시 시도하게 한다. 저장을 다시 눌러 같은 기록이 두 번 생기지 않도록,
 * 1)이 끝난 뒤의 제출은 2)만 실행한다. 저장된 기록 ID는 화면에 링크로 남겨 두어 이 화면을
 * 떠나거나 다시 로그인해도 상세 화면에서 연결을 이어 할 수 있다.
 * 두 단계는 서로 **다른 requestId**를 쓴다(같은 키에 다른 입력이면 DB가 거부한다).
 */
export function LiveMemoryForm({
  memory,
  photosEnabled,
  link,
  sourceNotice,
}: {
  memory?: EditableMemory;
  photosEnabled: boolean;
  /** 완료한 일정·위시에서 들어온 경우의 초안. 없으면 기존 흐름과 완전히 같다. */
  link?: LinkDraft;
  /** 원본을 확인하지 못했거나 query를 거부했을 때의 안내. 연결 없음과 구분해 보여 준다. */
  sourceNotice?: string | null;
}) {
  const isEdit = memory !== undefined;
  const router = useRouter();

  const [form, setForm] = useState<FormState>(() => initialFormState(memory, link));
  const photos = useLivePhotos(
    existingPhotoItems(memory?.photoAssetIds ?? [], memory?.title ?? '기록'),
    photosEnabled,
  );
  const [fieldErrors, setFieldErrors] = useState<MemoryFieldErrors>({});
  const [problem, setProblem] = useState<SaveProblem | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [saved, setSaved] = useState(false);
  const [leaveDialogOpen, setLeaveDialogOpen] = useState(false);
  const inFlight = useRef(false);
  const tracker = useRef(createRequestKeyTracker());
  const summaryRef = useRef<HTMLDivElement>(null);
  const [summaryFocusTick, setSummaryFocusTick] = useState(0);

  // 연결 상태. `link`가 없으면 아래 값들은 쓰이지 않는다(기존 흐름과 같다).
  const [linkEnabled, setLinkEnabled] = useState(link !== undefined);
  const [savedMemory, setSavedMemory] = useState<SavedMemory | null>(null);
  const [linkProblem, setLinkProblem] = useState<SaveProblem | null>(null);
  const linkTracker = useRef(createRequestKeyTracker());

  useEffect(() => {
    if (summaryFocusTick === 0) return;
    summaryRef.current?.focus();
  }, [summaryFocusTick]);

  const baseline = useRef(
    JSON.stringify({ form: initialFormState(memory, link), photos: memory?.photoAssetIds ?? [] }),
  );
  const isDirty =
    !saved &&
    JSON.stringify({ form, photos: photos.items.map((item) => item.assetId ?? item.key) }) !==
      baseline.current;

  useEffect(() => {
    if (!isDirty) return undefined;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  useUnsavedGuard(isDirty, {
    title: '저장하지 않은 기록이 있어요',
    description: '쓰던 제목·내용과 올린 사진은 저장되지 않습니다. 임시 저장은 아직 없습니다. 이동할까요?',
    confirmLabel: '이동하기',
    cancelLabel: '계속 쓰기',
  });

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  // 본문이 이미 저장됐다면 "취소"는 저장된 기록으로 간다(쓴 내용을 버리는 것이 아니다).
  const leaveTarget = savedMemory
    ? `/memories/${savedMemory.id}`
    : isEdit
      ? `/memories/${memory.id}`
      : '/memories';

  const focusFirstError = (errors: MemoryFieldErrors) => {
    const first = FIELD_ORDER.find((field) => errors[field] !== undefined);
    const target = first ? document.getElementById(FIELD_IDS[first]) : null;
    target?.focus();
    if (!target || document.activeElement !== target) setSummaryFocusTick((tick) => tick + 1);
  };

  const noticeFor = (saved: SavedMemory, linked: boolean): string => {
    if (linked) {
      return saved.cleanup === 'pending' ? 'saved-linked-cleanup-pending' : 'saved-linked';
    }
    return saved.cleanup === 'pending' ? 'saved-cleanup-pending' : 'saved';
  };

  /**
   * 2단계 중 두 번째. **본문·사진 저장이 끝난 뒤에만** 부른다.
   * 실패하면 저장된 기록을 지우지 않고 그대로 두고, 연결만 다시 시도할 수 있게 한다.
   */
  const runLink = async (saved: SavedMemory): Promise<void> => {
    // 방어 분기. 연결 대상이 없거나 사용자가 "연결 없이 기록하기"를 고른 상태에서는
    // 연결을 만들지 않는다. 여기서 그냥 돌아가면 submitting이 켜진 채로 남아 버튼이 잠기므로
    // 반드시 되돌린다.
    if (!link || !shouldAttemptLink({ hasLink: true, linkEnabled })) {
      setSubmitting(false);
      return;
    }
    const input = {
      memoryId: saved.id,
      source: link.ref.source,
      sourceId: link.ref.sourceId,
      expectedVersion: saved.version,
    };
    // 본문 저장과 **다른** 키다. 같은 키에 다른 입력을 보내면 DB가 거부한다.
    const requestId = linkTracker.current.keyFor(input);

    setLinkProblem(null);
    let result: MemoryActionResult<LinkMemoryData>;
    try {
      result = await linkMemoryPlanAction({ ...input, requestId });
    } catch {
      result = { ok: false, code: 'RETRYABLE_ERROR', message: LINK_CODE_MESSAGES.RETRYABLE_ERROR };
    }
    linkTracker.current.settle(isDefinitiveMemoryResult(result));

    if (result.ok) {
      // 연결이 추억 version을 올렸다. 복구 지점을 최신 값으로 맞춘다.
      setSavedMemory({ ...saved, version: result.data.version });
      router.push(`/memories/${saved.id}?notice=${noticeFor(saved, true)}`);
      return;
    }
    setSubmitting(false);
    setLinkProblem({ code: result.code, message: result.message });
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (inFlight.current) return;

    // 본문·사진이 이미 저장됐다면 저장을 **다시 하지 않는다**(같은 기록이 두 번 생기지 않게).
    if (savedMemory) {
      inFlight.current = true;
      setSubmitting(true);
      await runLink(savedMemory);
      inFlight.current = false;
      return;
    }

    const tags = normalizeTags(form.tagsInput);
    const draft = validateMemoryDraft({
      title: form.title,
      body: form.body,
      memoryDate: form.memoryDate,
      location: form.location,
      tags,
      photoCount: photos.items.length,
    });

    if (!draft.ok) {
      const errors: MemoryFieldErrors = {
        title: draft.fieldErrors.title,
        memoryDate: draft.fieldErrors.memoryDate,
        location: draft.fieldErrors.location,
        tags: draft.fieldErrors.tags,
        body: draft.fieldErrors.body,
        photos: draft.fieldErrors.photoCount,
      };
      for (const key of FIELD_ORDER) if (errors[key] === undefined) delete errors[key];
      setFieldErrors(errors);
      setProblem(null);
      focusFirstError(errors);
      return;
    }

    if (!photos.allReady) {
      const errors: MemoryFieldErrors = {
        photos: photos.failed
          ? '올리지 못한 사진이 있어요. 다시 시도하거나 빼고 저장해 주세요.'
          : '사진을 올리는 중이에요. 끝난 뒤 저장해 주세요.',
      };
      setFieldErrors(errors);
      focusFirstError(errors);
      return;
    }

    setFieldErrors({});
    setProblem(null);

    const payload = {
      memoryId: isEdit ? memory.id : null,
      title: draft.data.title,
      body: draft.data.body,
      memoryDate: draft.data.memoryDate,
      location: draft.data.location,
      tags: draft.data.tags,
      photoAssetIds: photos.assetIds,
      isPinned: form.isPinned,
      expectedVersion: isEdit ? memory.version : 0,
    };
    const requestId = tracker.current.keyFor(payload);

    inFlight.current = true;
    setSubmitting(true);
    let result: MemoryActionResult<SaveMemoryData>;
    try {
      result = await saveMemoryAction({ ...payload, requestId });
    } catch {
      result = { ok: false, code: 'RETRYABLE_ERROR', message: MEMORY_CODE_MESSAGES.RETRYABLE_ERROR };
    }
    tracker.current.settle(isDefinitiveMemoryResult(result));

    if (result.ok) {
      photos.markSaved();
      setSaved(true);
      const saved: SavedMemory = {
        id: result.data.memoryId,
        version: result.data.version,
        cleanup: result.data.cleanup,
      };
      // `savedMemory`는 **연결을 실제로 시도하는 경우에만** 둔다.
      // 이 값이 있으면 화면이 부분 성공(저장됨 + 연결 남음) 상태가 되고 다시 제출하면
      // 연결을 시도한다. 연결 없는 저장이나 사용자가 연결을 끈 저장에서 이 값을 두면
      // 원하지 않은 연결이 생기거나 부분 성공 안내가 잘못 뜬다.
      if (link && shouldAttemptLink({ hasLink: true, linkEnabled })) {
        setSavedMemory(saved);
        await runLink(saved);
        inFlight.current = false;
        return;
      }
      inFlight.current = false;
      router.push(`/memories/${saved.id}?notice=${noticeFor(saved, false)}`);
      return;
    }

    inFlight.current = false;
    setSubmitting(false);
    setProblem({ code: result.code, message: result.message });
    if (result.fieldErrors) {
      setFieldErrors(result.fieldErrors);
      focusFirstError(result.fieldErrors);
    } else {
      setSummaryFocusTick((tick) => tick + 1);
    }
  };

  const leave = async () => {
    setSaved(true); // 가드를 내리고 이동한다(이 화면은 곧 사라진다).
    await photos.discardUnsaved();
    router.push(leaveTarget);
  };

  const errorEntries = FIELD_ORDER.flatMap((field) =>
    fieldErrors[field] ? [[field, fieldErrors[field]] as const] : [],
  );
  const tagPreview = normalizeTags(form.tagsInput);
  const disabled = submitting || saved;

  return (
    <>
      <form onSubmit={handleSubmit} noValidate className="space-y-6" aria-busy={submitting}>
        <div>
          <h1 className="text-2xl font-bold text-text">{isEdit ? '기록 수정' : '새 추억'}</h1>
          <p className="mt-1 text-sm text-muted">
            제목과 날짜만 있어도 저장할 수 있어요. 저장하면 두 사람 모두에게 보입니다.
          </p>
        </div>

        {/* 원본 query를 거부했거나 원본을 읽지 못한 경우. "연결 없음"과 구분해 알린다. */}
        {sourceNotice ? (
          <ErrorNotice role="status" title="연결할 계획을 확인하지 못했어요" description={sourceNotice}>
            <p className="text-xs">기록은 그대로 남길 수 있어요. 나중에 상세 화면에서 연결할 수 있습니다.</p>
          </ErrorNotice>
        ) : null}

        {link ? (
          <SourceDraftCard
            source={link.ref.source}
            sourceHref={link.sourceHref}
            sourceTitle={link.sourceTitle}
            sourceSummary={link.sourceSummary}
            prefill={link.prefill}
            linkEnabled={linkEnabled}
            onDisableLink={() => setLinkEnabled(false)}
            disabled={disabled}
          />
        ) : null}

        {errorEntries.length > 0 || problem ? (
          <div ref={summaryRef} tabIndex={-1} className="space-y-3">
            {errorEntries.length > 0 ? (
              <ErrorNotice title={`입력을 ${errorEntries.length}곳 확인해 주세요`}>
                <ul className="list-disc space-y-1 pl-4 text-sm">
                  {errorEntries.map(([field, message]) => (
                    <li key={field}>{message}</li>
                  ))}
                </ul>
              </ErrorNotice>
            ) : null}
            {problem ? <SaveProblemNotice problem={problem} isEdit={isEdit} memoryId={memory?.id} /> : null}
          </div>
        ) : null}

        <div className="app-card space-y-5 px-4 py-5 sm:px-6">
          <div>
            <label htmlFor={FIELD_IDS.title} className="field-label">
              제목 <span className="text-[#B3261E]">*</span>
            </label>
            <input
              id={FIELD_IDS.title}
              disabled={disabled}
              name="title"
              value={form.title}
              onChange={(event) => update('title', event.target.value)}
              maxLength={MEMORY_LIMITS.titleMax}
              aria-invalid={fieldErrors.title !== undefined}
              aria-describedby={fieldErrors.title ? `${FIELD_IDS.title}-error` : undefined}
              placeholder="예: 한강 노을 산책"
              className="field-input"
            />
            {fieldErrors.title ? (
              <p id={`${FIELD_IDS.title}-error`} className="field-error">
                {fieldErrors.title}
              </p>
            ) : (
              <p className="field-hint">
                {form.title.length}/{MEMORY_LIMITS.titleMax}자
              </p>
            )}
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <label htmlFor={FIELD_IDS.memoryDate} className="field-label">
                날짜 <span className="text-[#B3261E]">*</span>
              </label>
              <input
                id={FIELD_IDS.memoryDate}
              disabled={disabled}
                name="memoryDate"
                type="date"
                value={form.memoryDate}
                max={todayInSeoul()}
                onChange={(event) => update('memoryDate', event.target.value)}
                aria-invalid={fieldErrors.memoryDate !== undefined}
                aria-describedby={fieldErrors.memoryDate ? `${FIELD_IDS.memoryDate}-error` : undefined}
                className="field-input"
              />
              {fieldErrors.memoryDate ? (
                <p id={`${FIELD_IDS.memoryDate}-error`} className="field-error">
                  {fieldErrors.memoryDate}
                </p>
              ) : (
                <p className="field-hint">한국 시간 기준 달력 날짜로 저장합니다.</p>
              )}
            </div>

            <div>
              <label htmlFor={FIELD_IDS.location} className="field-label">
                장소 <span className="font-normal text-muted">(선택)</span>
              </label>
              <input
                id={FIELD_IDS.location}
              disabled={disabled}
                name="location"
                value={form.location}
                onChange={(event) => update('location', event.target.value)}
                maxLength={MEMORY_LIMITS.locationMax}
                aria-invalid={fieldErrors.location !== undefined}
                aria-describedby={fieldErrors.location ? `${FIELD_IDS.location}-error` : undefined}
                placeholder="예: 성수동"
                className="field-input"
              />
              {fieldErrors.location ? (
                <p id={`${FIELD_IDS.location}-error`} className="field-error">
                  {fieldErrors.location}
                </p>
              ) : null}
            </div>
          </div>

          <div>
            <label htmlFor={FIELD_IDS.tags} className="field-label">
              태그 <span className="font-normal text-muted">(선택)</span>
            </label>
            <input
              id={FIELD_IDS.tags}
              disabled={disabled}
              name="tags"
              value={form.tagsInput}
              onChange={(event) => update('tagsInput', event.target.value)}
              aria-invalid={fieldErrors.tags !== undefined}
              aria-describedby={`${FIELD_IDS.tags}-hint`}
              placeholder="산책, 노을"
              className="field-input"
            />
            {fieldErrors.tags ? (
              <p id={`${FIELD_IDS.tags}-error`} className="field-error">
                {fieldErrors.tags}
              </p>
            ) : null}
            <p id={`${FIELD_IDS.tags}-hint`} className="field-hint">
              쉼표로 구분해 최대 {MEMORY_LIMITS.tagCountMax}개, 하나당 {MEMORY_LIMITS.tagMax}자까지. 앞의
              #은 자동으로 떼고 같은 태그는 한 번만 남겨요.
            </p>
            {tagPreview.length > 0 ? (
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {tagPreview.map((tag) => (
                  <li key={tag} className="chip">
                    #{tag}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          <div>
            <label htmlFor={FIELD_IDS.body} className="field-label">
              내용 <span className="font-normal text-muted">(선택)</span>
            </label>
            <textarea
              id={FIELD_IDS.body}
              disabled={disabled}
              name="body"
              value={form.body}
              onChange={(event) => update('body', event.target.value)}
              rows={7}
              maxLength={MEMORY_LIMITS.bodyMax}
              aria-invalid={fieldErrors.body !== undefined}
              aria-describedby={fieldErrors.body ? `${FIELD_IDS.body}-error` : undefined}
              placeholder="그날 기억에 남은 장면을 적어 보세요."
              className="field-input resize-y"
            />
            {fieldErrors.body ? (
              <p id={`${FIELD_IDS.body}-error`} className="field-error">
                {fieldErrors.body}
              </p>
            ) : (
              <p className="field-hint">
                {form.body.length.toLocaleString('ko-KR')}/{MEMORY_LIMITS.bodyMax.toLocaleString('ko-KR')}자
                · 입력한 글은 그대로 글자로만 보여 줍니다.
              </p>
            )}
          </div>

          <div id={FIELD_IDS.photos} tabIndex={-1}>
            <LivePhotoPicker
              items={photos.items}
              rejected={photos.rejected}
              enabled={photosEnabled}
              disabled={disabled}
              onAddFiles={photos.addFiles}
              onRetry={photos.retry}
              onRemove={photos.remove}
              onMove={photos.move}
            />
            {fieldErrors.photos ? <p className="field-error">{fieldErrors.photos}</p> : null}
          </div>

          <label className="flex min-h-[44px] items-center gap-3 text-sm text-text">
            <input
              type="checkbox"
              checked={form.isPinned}
              disabled={disabled}
              onChange={(event) => update('isPinned', event.target.checked)}
              className="h-5 w-5 accent-accent"
            />
            홈에 고정하기
          </label>
        </div>

        {savedMemory ? (
          <PartialLinkNotice
            memoryId={savedMemory.id}
            problem={linkProblem}
            submitting={submitting}
            retryHref={link ? memoryLinkPath(savedMemory.id, link.ref) : null}
          />
        ) : (
          <div className="flex flex-wrap gap-2">
            <button type="submit" className="btn-primary" disabled={disabled || photos.busy}>
              {submitting
                ? link && linkEnabled
                  ? '저장하고 연결하는 중…'
                  : '저장하는 중…'
                : isEdit
                  ? '수정 내용 저장'
                  : link && linkEnabled
                    ? '기록 저장하고 연결'
                    : '기록 저장'}
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={() => {
                if (isDirty) {
                  setLeaveDialogOpen(true);
                  return;
                }
                void leave();
              }}
              className="btn-secondary"
            >
              취소
            </button>
          </div>
        )}

        {photos.busy ? (
          <p className="text-xs leading-relaxed text-muted" role="status">
            사진을 올리는 중이에요. 끝나면 저장할 수 있어요.
          </p>
        ) : null}
      </form>

      <ConfirmDialog
        open={leaveDialogOpen}
        tone="neutral"
        title="쓰던 내용을 두고 나갈까요?"
        description="저장하지 않은 제목·내용은 사라지고, 이번에 올린 사진은 정리됩니다. 임시 저장은 아직 없습니다."
        confirmLabel="나가기"
        cancelLabel="계속 쓰기"
        onCancel={() => setLeaveDialogOpen(false)}
        onConfirm={() => {
          setLeaveDialogOpen(false);
          void leave();
        }}
      />
    </>
  );
}

/**
 * 부분 성공 안내 — 본문·사진은 저장됐고 연결만 남았을 때.
 *
 * 이 화면은 "모두 저장했어요"라고 말하지 않는다. 무엇이 끝났고 무엇이 남았는지 나눠서 적고,
 * **연결만** 다시 시도하게 한다. 저장을 다시 눌러 같은 기록이 두 번 생기는 경로는 없다.
 * 이 화면을 떠나거나 다시 로그인해도 상세 화면에서 연결을 이어 할 수 있도록 두 링크를 남긴다.
 */
function PartialLinkNotice({
  memoryId,
  problem,
  submitting,
  retryHref,
}: {
  memoryId: string;
  problem: SaveProblem | null;
  submitting: boolean;
  /** 상세 화면의 연결 선택으로 이어 가는 경로(원본을 그대로 들고 간다). */
  retryHref: string | null;
}) {
  return (
    <ErrorNotice
      role={problem ? 'alert' : 'status'}
      title="기록과 사진은 저장했어요"
      description={
        problem
          ? `계획과의 연결만 마치지 못했어요. ${problem.message}`
          : '연결을 마무리하는 중이에요.'
      }
    >
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <button type="submit" className="btn-primary !min-h-[36px] text-xs" disabled={submitting}>
            {submitting ? '연결하는 중…' : '연결만 다시 시도'}
          </button>
          {retryHref ? (
            <a href={retryHref} className="btn-secondary !min-h-[36px] text-xs">
              저장한 기록에서 연결 이어 하기
            </a>
          ) : null}
          <a href={`/memories/${memoryId}`} className="btn-quiet !min-h-[36px] text-xs">
            연결 없이 저장한 기록 보기
          </a>
        </div>
        <p className="text-xs leading-relaxed">
          다시 시도해도 같은 기록이 두 번 생기지 않아요. 이 화면을 닫거나 다시 로그인한 뒤에도
          저장한 기록의 상세 화면에서 연결을 이어 할 수 있습니다.
        </p>
        <p className="text-xs leading-relaxed">
          제목·날짜·장소·태그·이야기·사진·고정은 이미 저장돼 이 화면에서는 더 고칠 수 없어요. 내용을{' '}
          <a href={`/memories/${memoryId}/edit`} className="underline">
            저장한 기록의 수정 화면
          </a>
          에서 바꿔 주세요. 여기서 입력을 바꿔도 저장되지 않습니다.
        </p>
      </div>
    </ErrorNotice>
  );
}

function SaveProblemNotice({
  problem,
  isEdit,
  memoryId,
}: {
  problem: SaveProblem;
  isEdit: boolean;
  memoryId: string | undefined;
}) {
  if (problem.code === 'CONFLICT' && isEdit && memoryId) {
    return (
      <ErrorNotice title="상대방이 먼저 저장했어요" description={problem.message}>
        <div className="flex flex-wrap gap-2">
          <a
            href={`/memories/${memoryId}`}
            target="_blank"
            rel="noopener"
            className="btn-secondary !min-h-[36px] text-xs"
          >
            최신 내용 새 탭에서 보기
          </a>
          {/* 전체 새로고침으로 최신 버전을 다시 읽는다. 떠나기 전에 브라우저가 한 번 더 확인한다. */}
          <a href={`/memories/${memoryId}/edit`} className="btn-quiet !min-h-[36px] text-xs">
            최신 내용으로 다시 편집(쓰던 내용 버림)
          </a>
        </div>
      </ErrorNotice>
    );
  }
  if (problem.code === 'NOT_FOUND' && isEdit) {
    return (
      <ErrorNotice title="이 기록을 더 이상 찾을 수 없어요" description={problem.message}>
        <p className="text-xs">쓰던 내용은 이 화면에 남아 있어요. 필요하면 복사해 두세요.</p>
      </ErrorNotice>
    );
  }
  if (problem.code === 'UNAUTHENTICATED') {
    return (
      <ErrorNotice title="로그인이 필요해요" description={problem.message}>
        <a href="/login" target="_blank" rel="noopener" className="btn-secondary !min-h-[36px] text-xs">
          새 탭에서 로그인
        </a>
      </ErrorNotice>
    );
  }
  return (
    <ErrorNotice
      title={problem.code === 'RETRYABLE_ERROR' ? '저장하지 못했어요. 다시 시도해 주세요' : '저장하지 못했어요'}
      description={problem.message}
    />
  );
}
