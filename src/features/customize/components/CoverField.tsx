'use client';

import { useId, useRef } from 'react';

import { Photo } from '@/components/Photo';
import { ACCEPTED_IMAGE_MIME_TYPES } from '@/lib/contracts';

import { coverPhotoUrl } from '../constants';

import type { CoverUpload } from './use-cover-upload';

/**
 * 커버 사진 고르기.
 *
 * - 파일은 브라우저에서 정규화한 뒤 **한 번만** 올라간다(덮어쓰기 없음). 확정이 끝나야 초안 커버가 된다.
 * - 확정된 파일도 ‘저장’을 눌러야 공유 설정에 붙는다. 그 전까지는 내 화면에서만 보인다.
 * - 서버에 사진 확인 설정이 없으면 **새 업로드만** 막고, 기존 커버 유지·해제와 다른 설정 저장은 그대로 된다.
 */

const STATUS_TEXT: Record<string, string> = {
  processing: '사진을 준비하는 중…',
  preparing: '올릴 자리를 만드는 중…',
  uploading: '사진을 올리는 중…',
  verifying: '사진을 확인하는 중…',
};

export function CoverField({
  upload,
  draftCoverAssetId,
  savedCoverAssetId,
  coverUploadedByMe,
  photosEnabled,
  onRemove,
  onRestoreSaved,
}: {
  upload: CoverUpload;
  draftCoverAssetId: string | null;
  savedCoverAssetId: string | null;
  /** `null`은 모름. 모르는 것을 아는 척하지 않는다. */
  coverUploadedByMe: boolean | null;
  photosEnabled: boolean;
  onRemove: () => void;
  onRestoreSaved: () => void;
}) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  const showsSavedCover = draftCoverAssetId !== null && draftCoverAssetId === savedCoverAssetId;
  const previewSrc = upload.previewUrl ?? (showsSavedCover ? coverPhotoUrl(draftCoverAssetId) : null);
  const statusText = STATUS_TEXT[upload.status] ?? null;

  return (
    <section aria-labelledby="cover-heading" className="app-card px-4 py-5 sm:px-6">
      <h2 id="cover-heading" className="text-base font-bold text-text">
        커버 사진
      </h2>
      <p className="field-hint mt-0.5">
        홈 맨 위에 보이는 사진 한 장입니다. JPEG·PNG·WebP, 한 장에 10MB까지 올릴 수 있어요.
      </p>

      <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-start">
        <div
          className="relative aspect-[16/9] w-full shrink-0 overflow-hidden rounded-xl border border-border bg-surface-muted sm:w-64"
          style={{ backgroundImage: previewSrc ? undefined : 'var(--cover-gradient)' }}
        >
          {previewSrc ? (
            <Photo src={previewSrc} alt="커버 사진 미리보기" sizes="(min-width: 640px) 256px, 100vw" />
          ) : (
            <p className="absolute inset-0 flex items-center justify-center px-3 text-center text-xs text-muted">
              커버 사진이 없으면 테마 배경을 그대로 씁니다.
            </p>
          )}
        </div>

        <div className="min-w-0 flex-1 space-y-2">
          <label htmlFor={inputId} className="field-label">
            사진 고르기
          </label>
          <input
            ref={inputRef}
            id={inputId}
            type="file"
            accept={ACCEPTED_IMAGE_MIME_TYPES.join(',')}
            disabled={!photosEnabled || upload.busy}
            className="field-input file:mr-3 file:rounded-pill file:border-0 file:bg-surface-muted file:px-3 file:py-1.5 file:text-sm"
            onChange={(event) => {
              const file = event.target.files?.[0];
              // 같은 파일을 다시 고를 수 있도록 입력값을 비운다.
              event.target.value = '';
              if (file) upload.pick(file);
            }}
          />

          {!photosEnabled ? (
            <p className="field-hint">
              서버에 사진 확인 설정이 없어 지금은 <strong>새 커버만</strong> 올릴 수 없습니다. 이미 저장된
              커버는 그대로 보이고, 테마·포인트 색상·홈 섹션 저장과 커버 해제는 지금도 됩니다.
            </p>
          ) : null}

          {statusText ? (
            <p role="status" className="field-hint">
              {statusText}
            </p>
          ) : null}

          {upload.status === 'ready' ? (
            <p role="status" className="field-hint">
              사진 확인이 끝났어요{upload.fileName ? ` (${upload.fileName})` : ''}. 아직 저장하지 않았습니다 —
              아래 ‘꾸미기 저장’을 눌러야 상대방 화면에도 보여요.
            </p>
          ) : null}

          {upload.error ? (
            // 업로드 실패도 소리로 알린다(진행·완료만 알리면 실패를 놓친다).
            <p role="alert" className="field-error">
              {upload.error}
              {upload.retryable ? (
                <button type="button" className="btn-quiet !min-h-[32px] ml-2 text-xs" onClick={upload.retry}>
                  다시 시도
                </button>
              ) : null}
            </p>
          ) : null}

          <div className="flex flex-wrap gap-2 pt-1">
            {draftCoverAssetId !== null ? (
              <button type="button" className="btn-secondary !min-h-[36px] text-xs" onClick={onRemove}>
                커버 없애기
              </button>
            ) : null}
            {savedCoverAssetId !== null && draftCoverAssetId !== savedCoverAssetId ? (
              <button type="button" className="btn-quiet !min-h-[36px] text-xs" onClick={onRestoreSaved}>
                저장된 커버로 되돌리기
              </button>
            ) : null}
          </div>

          {savedCoverAssetId !== null && coverUploadedByMe !== true ? (
            <p className="field-hint">
              {coverUploadedByMe === false
                ? '지금 커버는 상대방이 올린 사진이에요. '
                : '지금 커버를 누가 올렸는지는 확인하지 못했어요. '}
              그대로 두거나 없앨 수 있고, 새 커버는 올린 사람만 지정할 수 있습니다.
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
