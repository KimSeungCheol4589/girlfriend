'use client';

import { useId, useRef } from 'react';

import { Photo } from '@/components/Photo';
import { MEMORY_LIMITS } from '@/lib/contracts';
import { validatePhotoSelection } from '@/features/memories/schema';
import type { DemoPhoto } from '@/lib/demo/types';

/**
 * 사진 선택과 미리보기.
 *
 * 브라우저 안에서 미리보기만 만든다. 업로드·재인코딩·EXIF 제거(DESIGN.md 8.2)는 아직 없다.
 * 장수·용량·형식 제한은 지금부터 같은 값으로 검사해 실제 구현과 어긋나지 않게 한다.
 */
export function PhotoUploader({
  photos,
  onChange,
  onCreateObjectUrls,
  rejected,
  onRejected,
}: {
  photos: DemoPhoto[];
  onChange: (next: DemoPhoto[]) => void;
  /**
   * 이 컴포넌트가 방금 만든 objectURL만 알린다.
   * 폼은 이 목록만 자기 소유로 보고 정리한다. 기존 기록에서 온 사진은 저장소가 계속 소유한다.
   */
  onCreateObjectUrls?: (urls: string[]) => void;
  rejected: { name: string; reason: string }[];
  onRejected: (next: { name: string; reason: string }[]) => void;
}) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;

    const files = Array.from(fileList);
    const result = validatePhotoSelection(
      photos.length,
      files.map((file) => ({ name: file.name, size: file.size, type: file.type })),
    );

    const acceptedNames = new Set(result.accepted.map((candidate) => candidate.name));
    const added: DemoPhoto[] = files
      .filter((file) => acceptedNames.has(file.name))
      .map((file, index) => ({
        id: `preview-${Date.now()}-${index}`,
        src: URL.createObjectURL(file),
        alt: `${file.name} 미리보기`,
      }));

    onRejected(result.rejected);
    if (added.length > 0) {
      onCreateObjectUrls?.(added.map((photo) => photo.src));
      onChange([...photos, ...added]);
    }

    // 같은 파일을 다시 고를 수 있도록 입력값을 비운다.
    if (inputRef.current) inputRef.current.value = '';
  };

  const removeAt = (index: number) => {
    // 여기서 objectURL을 해제하지 않는다.
    // 편집을 취소하면 이 사진은 저장소에 그대로 남아 있어야 하고,
    // 실제 해제는 저장(저장소) 또는 폼 언마운트 정리가 담당한다.
    onChange(photos.filter((_, i) => i !== index));
  };

  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= photos.length) return;
    const next = [...photos];
    const moved = next[index] as DemoPhoto;
    const displaced = next[target] as DemoPhoto;
    next[target] = moved;
    next[index] = displaced;
    onChange(next);
  };

  const atLimit = photos.length >= MEMORY_LIMITS.photoCountMax;

  return (
    <div>
      <p className="field-label" id={`${inputId}-label`}>
        사진 <span className="font-normal text-muted">(선택)</span>
      </p>

      {photos.length > 0 ? (
        <ul className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {photos.map((photo, index) => (
            <li key={photo.id} className="overflow-hidden rounded-xl border border-border">
              <div className="relative aspect-square w-full bg-surface-muted">
                <Photo src={photo.src} alt={photo.alt} sizes="180px" />
                {index === 0 ? (
                  <span className="absolute left-2 top-2 rounded-pill bg-[#2B2522]/70 px-2 py-0.5 text-[10px] font-semibold text-white">
                    대표
                  </span>
                ) : null}
              </div>
              <div className="flex items-center justify-between gap-1 bg-surface px-1.5 py-1">
                <div className="flex">
                  <button
                    type="button"
                    onClick={() => move(index, -1)}
                    disabled={index === 0}
                    aria-label={`${index + 1}번째 사진 앞으로`}
                    className="tap-target w-touch rounded-pill text-muted disabled:opacity-30"
                  >
                    ←
                  </button>
                  <button
                    type="button"
                    onClick={() => move(index, 1)}
                    disabled={index === photos.length - 1}
                    aria-label={`${index + 1}번째 사진 뒤로`}
                    className="tap-target w-touch rounded-pill text-muted disabled:opacity-30"
                  >
                    →
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => removeAt(index)}
                  className="tap-target rounded-pill px-3 text-xs font-semibold text-[#B3261E]"
                >
                  빼기
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      <input
        ref={inputRef}
        id={inputId}
        type="file"
        multiple
        accept="image/jpeg,image/png,image/webp"
        onChange={(event) => handleFiles(event.target.files)}
        className="sr-only"
      />
      <label
        htmlFor={inputId}
        aria-disabled={atLimit}
        className={`tap-target w-full cursor-pointer gap-2 rounded-xl border border-dashed border-border px-4 text-sm font-semibold text-muted transition-colors hover:bg-surface-muted ${
          atLimit ? 'pointer-events-none opacity-50' : ''
        }`}
      >
        <span aria-hidden>＋</span>
        사진 고르기 ({photos.length}/{MEMORY_LIMITS.photoCountMax})
      </label>

      <p className="field-hint">
        JPEG·PNG·WebP, 파일당 10MB까지. 지금은 이 브라우저에서 미리보기만 만들고 어디에도 올리지
        않습니다. iPhone HEIC 사진은 아직 지원하지 않아요.
      </p>

      {rejected.length > 0 ? (
        <ul className="mt-2 space-y-1" role="status">
          {rejected.map((item) => (
            <li key={`${item.name}-${item.reason}`} className="field-error">
              {item.name}: {item.reason}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
