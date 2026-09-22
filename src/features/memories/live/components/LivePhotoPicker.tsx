'use client';

import { useId, useRef } from 'react';

import { Photo } from '@/components/Photo';
import { MEMORY_LIMITS } from '@/lib/contracts';

import type { NewPhotoStatus, PhotoItem } from './use-live-photos';

const STATUS_LABELS: Record<NewPhotoStatus, string> = {
  processing: '사진 정리 중',
  preparing: '올릴 준비 중',
  uploading: '올리는 중',
  verifying: '서버 확인 중',
  ready: '올림 완료',
  failed: '실패',
};

/**
 * 실제 추억 폼의 사진 선택·순서·재시도.
 *
 * 올리는 중이거나 실패한 사진도 목록에 그대로 둔다. 다시 시도하거나 뺄 수 있다.
 * 서버 설정이 없으면 새 사진을 고를 수 없음을 밝히고, 이미 붙은 사진은 순서 변경·빼기만 가능하다.
 */
export function LivePhotoPicker({
  items,
  rejected,
  enabled,
  disabled,
  onAddFiles,
  onRetry,
  onRemove,
  onMove,
}: {
  items: PhotoItem[];
  rejected: { name: string; reason: string }[];
  enabled: boolean;
  disabled: boolean;
  onAddFiles: (files: File[]) => void;
  onRetry: (key: string) => void;
  onRemove: (key: string) => void;
  onMove: (index: number, direction: -1 | 1) => void;
}) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const atLimit = items.length >= MEMORY_LIMITS.photoCountMax;
  const canAdd = enabled && !atLimit && !disabled;

  return (
    <div>
      <p className="field-label" id={`${inputId}-label`}>
        사진 <span className="font-normal text-muted">(선택)</span>
      </p>

      {items.length > 0 ? (
        <ul className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-3" aria-labelledby={`${inputId}-label`}>
          {items.map((item, index) => {
            const src = item.kind === 'existing' ? item.src : item.previewUrl;
            const alt = item.kind === 'existing' ? item.alt : `${item.fileName} 미리보기`;
            const status = item.kind === 'new' ? item.status : null;
            return (
              <li
                key={item.key}
                className="overflow-hidden rounded-xl border border-border"
                data-photo-status={status ?? 'attached'}
                data-asset-id={item.assetId ?? undefined}
              >
                <div className="relative aspect-square w-full bg-surface-muted">
                  {src ? (
                    <Photo src={src} alt={alt} sizes="180px" />
                  ) : (
                    <span className="flex h-full items-center justify-center px-2 text-center text-xs text-muted">
                      {item.kind === 'new' ? item.fileName : ''}
                    </span>
                  )}
                  {index === 0 ? (
                    <span className="absolute left-2 top-2 rounded-pill bg-[#2B2522]/70 px-2 py-0.5 text-[10px] font-semibold text-white">
                      대표
                    </span>
                  ) : null}
                  {status && status !== 'ready' ? (
                    <span
                      className={`absolute inset-x-2 bottom-2 rounded-pill px-2 py-0.5 text-center text-[11px] font-semibold ${
                        status === 'failed' ? 'bg-[#B3261E] text-white' : 'bg-[#2B2522]/70 text-white'
                      }`}
                    >
                      {STATUS_LABELS[status]}
                    </span>
                  ) : null}
                </div>
                {item.kind === 'new' && item.status === 'failed' && item.error ? (
                  <p className="field-error px-2" role="status">
                    {item.error}
                  </p>
                ) : null}
                <div className="flex items-center justify-between gap-1 bg-surface px-1.5 py-1">
                  <div className="flex">
                    <button
                      type="button"
                      onClick={() => onMove(index, -1)}
                      disabled={disabled || index === 0}
                      aria-label={`${index + 1}번째 사진 앞으로`}
                      className="tap-target w-touch rounded-pill text-muted disabled:opacity-30"
                    >
                      ←
                    </button>
                    <button
                      type="button"
                      onClick={() => onMove(index, 1)}
                      disabled={disabled || index === items.length - 1}
                      aria-label={`${index + 1}번째 사진 뒤로`}
                      className="tap-target w-touch rounded-pill text-muted disabled:opacity-30"
                    >
                      →
                    </button>
                  </div>
                  <div className="flex">
                    {item.kind === 'new' && item.status === 'failed' && item.retryable ? (
                      <button
                        type="button"
                        onClick={() => onRetry(item.key)}
                        disabled={disabled}
                        className="tap-target rounded-pill px-2 text-xs font-semibold text-text"
                      >
                        다시 시도
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => onRemove(item.key)}
                      disabled={disabled}
                      aria-label={`${index + 1}번째 사진 빼기`}
                      className="tap-target rounded-pill px-3 text-xs font-semibold text-[#B3261E] disabled:opacity-30"
                    >
                      빼기
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}

      <input
        ref={inputRef}
        id={inputId}
        type="file"
        multiple
        accept="image/jpeg,image/png,image/webp"
        disabled={!canAdd}
        onChange={(event) => {
          onAddFiles(Array.from(event.target.files ?? []));
          // 같은 파일을 다시 고를 수 있도록 입력값을 비운다.
          if (inputRef.current) inputRef.current.value = '';
        }}
        className="sr-only"
      />
      <label
        htmlFor={inputId}
        aria-disabled={!canAdd}
        className={`tap-target w-full cursor-pointer gap-2 rounded-xl border border-dashed border-border px-4 text-sm font-semibold text-muted transition-colors hover:bg-surface-muted ${
          canAdd ? '' : 'pointer-events-none opacity-50'
        }`}
      >
        <span aria-hidden>＋</span>
        사진 고르기 ({items.length}/{MEMORY_LIMITS.photoCountMax})
      </label>

      {enabled ? (
        <p className="field-hint">
          JPEG·PNG·WebP, 파일당 10MB까지. 올리기 전에 긴 변 2,048px로 줄이고 위치 등 사진 정보를
          지웁니다. 서버가 한 번 더 확인한 사진만 저장돼요. iPhone HEIC 사진은 아직 지원하지 않아요.
        </p>
      ) : (
        <p className="field-hint" role="status">
          서버에 사진 확인 설정이 없어 지금은 새 사진을 올릴 수 없습니다. 글은 그대로 저장할 수 있고,
          이미 붙은 사진은 순서를 바꾸거나 뺄 수 있어요.
        </p>
      )}

      {rejected.length > 0 ? (
        <ul className="mt-2 space-y-1" role="status">
          {rejected.map((item, index) => (
            <li key={`${item.name}-${index}`} className="field-error">
              {item.name}: {item.reason}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
