'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { ConfirmDialog } from '@/components/ConfirmDialog';
import { ErrorNotice } from '@/components/ErrorNotice';
import { useUnsavedGuard } from '@/components/UnsavedGuard';
import { PhotoUploader } from '@/features/memories/components/PhotoUploader';
import {
  MEMORY_FIELD_ORDER,
  normalizeTags,
  validateMemoryDraft,
  type MemoryDraft,
  type MemoryFieldErrors,
} from '@/features/memories/schema';
import { MEMORY_LIMITS } from '@/lib/contracts';
import { todayInSeoul } from '@/lib/dates';
import { useDemoStore } from '@/lib/demo/demo-store';
import type { DemoMemory, DemoPhoto } from '@/lib/demo/types';

type FormState = {
  title: string;
  body: string;
  memoryDate: string;
  location: string;
  tagsInput: string;
};

function initialFormState(memory: DemoMemory | undefined): FormState {
  if (!memory) {
    return {
      title: '',
      body: '',
      memoryDate: todayInSeoul(),
      location: '',
      tagsInput: '',
    };
  }
  return {
    title: memory.title,
    body: memory.body,
    memoryDate: memory.memoryDate,
    location: memory.location ?? '',
    tagsInput: memory.tags.join(', '),
  };
}

const FIELD_IDS = {
  title: 'memory-title',
  memoryDate: 'memory-date',
  location: 'memory-location',
  tags: 'memory-tags',
  body: 'memory-body',
  photoCount: 'memory-photos',
} as const satisfies Record<keyof MemoryDraft, string>;

export function MemoryForm({ memory }: { memory?: DemoMemory }) {
  const isEdit = memory !== undefined;
  const router = useRouter();
  const { createMemory, updateMemory } = useDemoStore();

  const [form, setForm] = useState<FormState>(() => initialFormState(memory));
  const [photos, setPhotos] = useState<DemoPhoto[]>(() =>
    memory ? memory.photos.map((photo) => ({ ...photo })) : [],
  );
  const [rejectedPhotos, setRejectedPhotos] = useState<{ name: string; reason: string }[]>([]);
  const [fieldErrors, setFieldErrors] = useState<MemoryFieldErrors>({});
  const [errorOrder, setErrorOrder] = useState<string[]>([]);
  // 사용자에게는 사람이 읽는 문장만 보여 준다. 오류 코드는 화면에 노출하지 않는다.
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [leaveDialogOpen, setLeaveDialogOpen] = useState(false);

  const summaryRef = useRef<HTMLDivElement>(null);

  // 사진 목록은 개수가 아니라 id 순서로 비교한다.
  // 그래야 순서 변경이나 '1장 빼고 1장 추가'처럼 개수가 같은 변경도 미저장으로 잡힌다.
  const baseline = useRef(
    JSON.stringify({
      form: initialFormState(memory),
      photoIds: (memory?.photos ?? []).map((photo) => photo.id),
    }),
  );

  const isDirty =
    savedId === null &&
    JSON.stringify({ form, photoIds: photos.map((photo) => photo.id) }) !== baseline.current;

  /**
   * 이 폼이 만든 미리보기 objectURL의 소유권 추적.
   *
   * created: 이 폼에서 새로 만든 주소. saved: 저장에 성공해 저장소로 넘긴 주소.
   * 언마운트 시 created 중 저장소로 넘어가지 않은 것만 해제한다.
   * 기존 기록에서 온 사진은 created에 없으므로, 편집을 취소해도 해제되지 않는다.
   */
  const createdUrlsRef = useRef<Set<string>>(new Set());
  const handedToStoreRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const created = createdUrlsRef.current;
    const handed = handedToStoreRef.current;
    return () => {
      for (const url of created) {
        if (!handed.has(url)) URL.revokeObjectURL(url);
      }
    };
  }, []);

  const handlePhotosChange = (next: DemoPhoto[]) => {
    for (const photo of next) {
      if (photo.src.startsWith('blob:')) createdUrlsRef.current.add(photo.src);
    }
    setPhotos(next);
  };

  // DESIGN.md 9: 브라우저를 닫으면 미저장 글은 사라진다. 최소한 확인은 띄운다.
  // 앱 안의 메뉴 이동은 아래 가드가 맡는다. 브라우저 뒤로/앞으로 가기 버튼은 막을 수 없다.
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
    description: '쓰던 제목·내용·사진 선택은 사라집니다. 임시 저장은 아직 없습니다. 이동할까요?',
    confirmLabel: '이동하기',
    cancelLabel: '계속 쓰기',
  });

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setSaveError(null);
  };

  /**
   * 취소 시 이동할 곳.
   * history.back()은 이 폼이 첫 진입 페이지일 때 앱 밖으로 나가므로 쓰지 않는다.
   */
  const leave = () => {
    router.push(isEdit ? `/memories/${memory.id}` : '/memories');
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const tags = normalizeTags(form.tagsInput);
    const result = validateMemoryDraft({
      title: form.title,
      body: form.body,
      memoryDate: form.memoryDate,
      location: form.location,
      tags,
      photoCount: photos.length,
    });

    if (!result.ok) {
      setFieldErrors(result.fieldErrors);
      setErrorOrder(result.order);
      // DESIGN.md 9: 상단 요약을 보여 주고 첫 오류 필드로 포커스를 옮긴다.
      const firstField = MEMORY_FIELD_ORDER.find((field) => result.fieldErrors[field] !== undefined);
      const elementId = firstField ? FIELD_IDS[firstField] : undefined;
      const target = elementId ? document.getElementById(elementId) : null;
      target?.focus();
      // 사진 영역처럼 포커스를 받지 못하는 대상이면 상단 요약으로 되돌린다.
      if (!target || document.activeElement !== target) {
        summaryRef.current?.focus();
      }
      return;
    }

    setFieldErrors({});
    setErrorOrder([]);

    const input = {
      title: result.data.title,
      body: result.data.body,
      memoryDate: result.data.memoryDate,
      location: result.data.location,
      tags: result.data.tags,
      photos,
    };

    const saved = isEdit ? updateMemory(memory.id, input) : createMemory(input);

    if (!saved.ok) {
      setSaveError(saved.message);
      return;
    }

    // 저장에 성공한 주소는 저장소가 소유한다. 언마운트 정리 대상에서 뺀다.
    for (const photo of photos) {
      if (photo.src.startsWith('blob:')) handedToStoreRef.current.add(photo.src);
    }
    setSavedId(saved.data.id);
  };

  if (savedId !== null) {
    return (
      <div className="app-card px-5 py-8 text-center sm:px-8">
        <span className="chip bg-accent-soft text-text">데모 모드</span>
        <h1 className="mt-3 text-xl font-bold text-text">
          {isEdit ? '수정한 내용을 화면에 반영했어요' : '새 기록을 화면에 추가했어요'}
        </h1>
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted">
          지금은 이 브라우저 메모리에만 남습니다. 서버 저장과 상대방 공유는 아직 만들지 않았고,
          새로고침하면 예시 데이터로 돌아갑니다.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Link href={`/memories/${savedId}`} className="btn-primary">
            이 기록 보기
          </Link>
          <Link href="/memories" className="btn-secondary">
            목록으로
          </Link>
        </div>
      </div>
    );
  }

  const errorCount = Object.keys(fieldErrors).length;

  return (
    <>
      <form onSubmit={handleSubmit} noValidate className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-text">{isEdit ? '기록 수정' : '새 추억'}</h1>
          <p className="mt-1 text-sm text-muted">
            제목과 날짜만 있어도 저장할 수 있어요. 사진과 태그는 나중에 채워도 됩니다.
          </p>
        </div>

        {errorCount > 0 ? (
          <div ref={summaryRef} tabIndex={-1}>
            <ErrorNotice title={`입력을 ${errorCount}곳 확인해 주세요`}>
              <ul className="list-disc space-y-1 pl-4 text-sm">
                {errorOrder.map((field) => (
                  <li key={field}>{fieldErrors[field as keyof MemoryFieldErrors]}</li>
                ))}
              </ul>
            </ErrorNotice>
          </div>
        ) : null}

        {saveError ? (
          <ErrorNotice title="기록을 반영하지 못했어요" description={saveError} />
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
                onChange={(event) => update('memoryDate', event.target.value)}
                aria-invalid={fieldErrors.memoryDate !== undefined}
                aria-describedby={
                  fieldErrors.memoryDate ? `${FIELD_IDS.memoryDate}-error` : undefined
                }
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
                aria-describedby={
                  fieldErrors.location ? `${FIELD_IDS.location}-error` : undefined
                }
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
              쉼표로 구분해 최대 {MEMORY_LIMITS.tagCountMax}개, 하나당 {MEMORY_LIMITS.tagMax}자까지.
              앞의 #은 자동으로 떼고 같은 태그는 한 번만 남겨요.
            </p>
            {normalizeTags(form.tagsInput).length > 0 ? (
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {normalizeTags(form.tagsInput).map((tag) => (
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
                {form.body.length.toLocaleString('ko-KR')}/
                {MEMORY_LIMITS.bodyMax.toLocaleString('ko-KR')}자 · 입력한 글은 그대로 글자로만
                보여 줍니다.
              </p>
            )}
          </div>

          <div id={FIELD_IDS.photoCount}>
            <PhotoUploader
              photos={photos}
              onChange={handlePhotosChange}
              rejected={rejectedPhotos}
              onRejected={setRejectedPhotos}
            />
            {fieldErrors.photoCount ? (
              <p className="field-error">{fieldErrors.photoCount}</p>
            ) : null}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button type="submit" className="btn-primary">
            {isEdit ? '수정 내용 반영' : '기록 추가'}
          </button>
          <button
            type="button"
            onClick={() => {
              if (isDirty) {
                setLeaveDialogOpen(true);
                return;
              }
              leave();
            }}
            className="btn-secondary"
          >
            취소
          </button>
        </div>

        <p className="text-xs leading-relaxed text-muted">
          데모 모드입니다. ‘{isEdit ? '수정 내용 반영' : '기록 추가'}’을 눌러도 서버에 저장되지 않고
          이 브라우저 메모리에만 남습니다.
        </p>
      </form>

      <ConfirmDialog
        open={leaveDialogOpen}
        tone="neutral"
        title="쓰던 내용을 두고 나갈까요?"
        description="저장하지 않은 제목·내용·사진 선택은 사라집니다. 임시 저장은 아직 없습니다."
        confirmLabel="나가기"
        cancelLabel="계속 쓰기"
        onCancel={() => setLeaveDialogOpen(false)}
        onConfirm={() => {
          setLeaveDialogOpen(false);
          leave();
        }}
      />
    </>
  );
}
