'use client';

import { useId, useRef, useState } from 'react';

import { Photo } from '@/components/Photo';
import { createCoverPreview } from '@/features/customization/cover';
import type { DemoCoverPreview } from '@/lib/demo/types';

/**
 * 커버 이미지 고르기 (데모 범위).
 *
 * 고른 파일은 브라우저 안에서 미리보기만 만든다. 어디에도 올리지 않는다.
 * 형식·용량 규칙은 추억 사진과 같다(JPEG·PNG·WebP, 파일당 10MiB).
 * 만든 objectURL은 다시 고르거나 뺄 때, 그리고 적용하지 않고 화면을 떠날 때 해제한다.
 */
export function CoverPicker({
  cover,
  onChange,
}: {
  cover: DemoCoverPreview | null;
  onChange: (next: DemoCoverPreview | null) => void;
}) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [rejection, setRejection] = useState<{ name: string; reason: string } | null>(null);

  const handleFile = (fileList: FileList | null) => {
    const file = fileList?.[0];
    if (!file) return;

    const objectUrl = URL.createObjectURL(file);
    const result = createCoverPreview(
      { name: file.name, size: file.size, type: file.type },
      objectUrl,
      `cover-preview-${Date.now()}`,
    );

    if (!result.ok) {
      // 쓰지 않을 주소는 즉시 해제한다.
      URL.revokeObjectURL(objectUrl);
      setRejection({ name: file.name, reason: result.reason });
    } else {
      setRejection(null);
      onChange(result.preview);
    }

    // 같은 파일을 다시 고를 수 있도록 입력값을 비운다.
    if (inputRef.current) inputRef.current.value = '';
  };

  const remove = () => {
    setRejection(null);
    onChange(null);
  };

  return (
    <section aria-labelledby="cover-heading" className="app-card px-4 py-5 sm:px-6">
      <h2 id="cover-heading" className="text-base font-bold text-text">
        커버 이미지
      </h2>
      <p className="field-hint mt-0.5">
        고르지 않으면 테마별 합성 배경을 씁니다.
      </p>

      {cover ? (
        <figure className="mt-4">
          <div className="relative aspect-[16/9] w-full overflow-hidden rounded-xl border border-border bg-surface-muted">
            <Photo
              src={cover.objectUrl}
              alt={cover.alt}
              sizes="(min-width: 768px) 640px, 100vw"
            />
          </div>
          <figcaption className="mt-2 break-all text-xs text-muted">{cover.fileName}</figcaption>
        </figure>
      ) : (
        <div className="mt-4 flex aspect-[16/9] w-full items-center justify-center rounded-xl border border-dashed border-border bg-surface-muted text-xs text-muted">
          고른 커버 이미지가 없습니다
        </div>
      )}

      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={(event) => handleFile(event.target.files)}
        className="sr-only"
      />

      <div className="mt-3 flex flex-wrap gap-2">
        <label htmlFor={inputId} className="btn-secondary cursor-pointer">
          {cover ? '다른 이미지 고르기' : '커버 이미지 고르기'}
        </label>
        {cover ? (
          <button type="button" onClick={remove} className="btn-quiet">
            커버 빼기
          </button>
        ) : null}
      </div>

      {rejection ? (
        <p role="status" className="field-error">
          {rejection.name}: {rejection.reason}
        </p>
      ) : null}

      <p className="field-hint">
        JPEG·PNG·WebP, 파일당 10MB까지. 고른 이미지는 이 브라우저에서만 보이고 어디에도 올리지
        않습니다. 상대방 화면에는 나타나지 않고, 새로고침하면 사라집니다.
      </p>
    </section>
  );
}
