'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { ConfirmDialog } from '@/components/ConfirmDialog';
import { ErrorNotice } from '@/components/ErrorNotice';
import { useUnsavedGuard } from '@/components/UnsavedGuard';
import { normalizeTags, validateMemoryDraft } from '@/features/memories/schema';
import { MEMORY_LIMITS } from '@/lib/contracts';
import { todayInSeoul } from '@/lib/dates';

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

function initialFormState(memory: EditableMemory | undefined): FormState {
  if (!memory) {
    return { title: '', body: '', memoryDate: todayInSeoul(), location: '', tagsInput: '', isPinned: false };
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

/**
 * 실제 추억 작성·수정 폼.
 *
 * - 저장은 서버가 세션·공간을 다시 확인한 뒤 `save_memory` RPC로 한다. 성공 응답을 받기 전에는
 *   "저장됨"을 표시하지 않는다.
 * - 실패(네트워크·검증·충돌·업로드)해도 입력한 글과 이미 올린 사진을 그대로 둔다.
 * - 같은 입력의 재시도는 같은 requestId, 입력을 고치면 새 requestId(중복 저장 방지는 DB도 한다).
 * - 저장 중에는 버튼을 막아 두 번 제출되지 않게 한다.
 */
export function LiveMemoryForm({
  memory,
  photosEnabled,
}: {
  memory?: EditableMemory;
  photosEnabled: boolean;
}) {
  const isEdit = memory !== undefined;
  const router = useRouter();

  const [form, setForm] = useState<FormState>(() => initialFormState(memory));
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

  useEffect(() => {
    if (summaryFocusTick === 0) return;
    summaryRef.current?.focus();
  }, [summaryFocusTick]);

  const baseline = useRef(
    JSON.stringify({ form: initialFormState(memory), photos: memory?.photoAssetIds ?? [] }),
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

  const leaveTarget = isEdit ? `/memories/${memory.id}` : '/memories';

  const focusFirstError = (errors: MemoryFieldErrors) => {
    const first = FIELD_ORDER.find((field) => errors[field] !== undefined);
    const target = first ? document.getElementById(FIELD_IDS[first]) : null;
    target?.focus();
    if (!target || document.activeElement !== target) setSummaryFocusTick((tick) => tick + 1);
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (inFlight.current) return;

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
    inFlight.current = false;

    if (result.ok) {
      photos.markSaved();
      setSaved(true);
      const notice = result.data.cleanup === 'pending' ? 'saved-cleanup-pending' : 'saved';
      router.push(`/memories/${result.data.memoryId}?notice=${notice}`);
      return;
    }

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
              onChange={(event) => update('isPinned', event.target.checked)}
              className="h-5 w-5 accent-accent"
            />
            홈에 고정하기
          </label>
        </div>

        <div className="flex flex-wrap gap-2">
          <button type="submit" className="btn-primary" disabled={disabled || photos.busy}>
            {submitting ? '저장하는 중…' : isEdit ? '수정 내용 저장' : '기록 저장'}
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
