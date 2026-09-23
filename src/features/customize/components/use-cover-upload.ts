'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { newRequestId } from '@/features/auth/request-id';
import { processPhotoForUpload, type ProcessedPhoto } from '@/features/memories/live/client-image';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';

import { pendingAfterSave, planPendingCoverDiscard } from '../cover-pipeline';
import { CUSTOMIZE_CODE_MESSAGES, type CustomizeResult } from '../errors';
import {
  discardCoverPhotoAction,
  finalizeCoverPhotoAction,
  prepareCoverPhotoAction,
} from '../server/actions';
import type { PreparedCover, SaveCustomizationData } from '../types';

/**
 * 커버 사진 한 장의 업로드 파이프라인.
 *
 * 추억 사진과 **같은 절차**를 쓴다(브라우저 정규화 → prepare_upload → 사용자 세션으로 표준 업로드
 * 1회(upsert 없음, 이후 객체 불변) → 서버의 읽기 전용 검증 확정). 다른 점은 한 장만 들고,
 * 확정된 파일이 **저장을 눌러야** 공유 설정에 붙는다는 것이다.
 *
 * 정리 규칙은 `cover-pipeline.ts`에 모아 두었다.
 *   - 교체·해제·화면 이탈: 아직 저장되지 않은 내 파일만 `discard_upload`로 돌린다(최선 노력).
 *   - 저장 성공: 그 파일의 소유권은 설정으로 넘어간다. 정리 대상에서 뺀다.
 *   - 저장 진행 중: 결과를 모르므로 정리하지 않는다.
 *   - 탭 닫기·새로고침처럼 페이지가 통째로 내려가면 요청이 끝난다는 보장이 없다. 그 경우는
 *     24시간 만료 정리에 맡긴다(docs/memories/CLEANUP.md와 같은 경로).
 *
 * 정리는 **파이프라인 단위**로 한다. "지금 대기 중인 파일"을 지우면, 빠르게 교체했을 때 이전
 * 파이프라인의 뒤늦은 취소가 방금 올린 새 파일을 지울 수 있다.
 */

export type CoverUploadStatus =
  | 'idle'
  | 'processing'
  | 'preparing'
  | 'uploading'
  | 'verifying'
  | 'ready'
  | 'failed';

type Pipeline = {
  file: File;
  processed: ProcessedPhoto | null;
  prepareRequestId: string | null;
  prepared: PreparedCover | null;
  uploaded: boolean;
  finalized: boolean;
  running: boolean;
  cancelled: boolean;
};

async function callAction<T>(run: () => Promise<CustomizeResult<T>>): Promise<CustomizeResult<T>> {
  try {
    return await run();
  } catch {
    // Server Action 자체가 실패하면 "처리 여부를 모름"으로 본다.
    return { ok: false, code: 'RETRYABLE_ERROR', message: CUSTOMIZE_CODE_MESSAGES.RETRYABLE_ERROR };
  }
}

function isDuplicateUpload(error: unknown): boolean {
  const shape = error as { statusCode?: string | number; status?: number; message?: string } | null;
  if (!shape) return false;
  return (
    String(shape.statusCode ?? '') === '409' ||
    shape.status === 409 ||
    /already exists|duplicate/i.test(shape.message ?? '')
  );
}

export type CoverUpload = {
  status: CoverUploadStatus;
  fileName: string | null;
  previewUrl: string | null;
  error: string | null;
  retryable: boolean;
  busy: boolean;
  pick: (file: File) => void;
  retry: () => void;
  /** 대기 중인 파일을 버린다(교체·해제·취소). 저장된 커버는 건드리지 않는다. */
  clearPending: () => void;
  /** 저장 결과 반영. 서버가 받아들인 파일이면 정리 대상에서 뺀다. */
  settleSave: (result: SaveCustomizationData) => void;
  /** 저장 요청 중에는 정리하지 않는다. */
  setSaveInFlight: (inFlight: boolean) => void;
};

export function useCoverUpload({
  enabled,
  savedCoverAssetId,
  onReady,
}: {
  /** 서버에 사진 확정 설정이 없으면 새 업로드를 시작하지 않는다. */
  enabled: boolean;
  savedCoverAssetId: string | null;
  /** 확정이 끝나 초안 커버로 쓸 수 있게 된 순간. */
  onReady: (assetId: string) => void;
}): CoverUpload {
  const [status, setStatus] = useState<CoverUploadStatus>('idle');
  const [fileName, setFileName] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryable, setRetryable] = useState(false);

  const pipeline = useRef<Pipeline | null>(null);
  /** 지금 초안 커버로 쓰이는 파일(저장 결과 판단용). */
  const pendingAssetId = useRef<string | null>(null);
  const createdUrls = useRef(new Set<string>());
  const saveInFlight = useRef(false);
  const savedRef = useRef(savedCoverAssetId);
  savedRef.current = savedCoverAssetId;

  const revoke = useCallback((url: string | null) => {
    if (url && createdUrls.current.has(url)) {
      URL.revokeObjectURL(url);
      createdUrls.current.delete(url);
    }
  }, []);

  /**
   * **그 파이프라인이 만든** 파일만 되돌린다. 저장에 쓰였거나 저장 결과를 모르는 동안에는 두고,
   * 결과와 무관하게 사용자 흐름을 막지 않는다(남은 파일은 만료 정리 대상이 된다).
   */
  const discardPipeline = useCallback((target: Pipeline | null) => {
    const prepared = target?.prepared ?? null;
    if (target) target.prepared = null; // 같은 파이프라인이 두 번 취소하지 않게 한다.
    if (!prepared) return;

    const plan = planPendingCoverDiscard({
      pendingAssetId: prepared.assetId,
      savedCoverAssetId: savedRef.current,
      saveInFlight: saveInFlight.current,
    });
    const assetId = plan.discard;
    if (assetId === null) return;

    if (pendingAssetId.current === assetId) pendingAssetId.current = null;
    void callAction(() => discardCoverPhotoAction({ assetId, requestId: newRequestId() }));
  }, []);

  const run = useCallback(async () => {
    const current = pipeline.current;
    if (!current || current.running || current.cancelled) return;
    current.running = true;

    const fail = (message: string, canRetry: boolean) => {
      setStatus('failed');
      setError(message);
      setRetryable(canRetry);
    };

    try {
      if (!current.processed) {
        setStatus('processing');
        setError(null);
        const processed = await processPhotoForUpload(current.file);
        if (!processed.ok) return fail(processed.message, false);
        current.processed = processed.photo;
        const url = URL.createObjectURL(processed.photo.blob);
        createdUrls.current.add(url);
        setPreviewUrl((previous) => {
          revoke(previous);
          return url;
        });
      }
      if (current.cancelled) return;

      const photo = current.processed;
      if (!photo) return;

      if (!current.prepared) {
        setStatus('preparing');
        setError(null);
        current.prepareRequestId ??= newRequestId();
        const requestId = current.prepareRequestId;
        const response = await callAction(() =>
          prepareCoverPhotoAction({ mimeType: photo.mime, bytes: photo.blob.size, requestId }),
        );
        if (!response.ok) {
          const unknownOutcome = response.code === 'RETRYABLE_ERROR' || response.code === 'UNKNOWN';
          // 확정 응답이면 다음 시도는 새 키. 모르는 결과면 같은 키로 재시도해 asset 중복을 막는다.
          if (!unknownOutcome) current.prepareRequestId = null;
          return fail(
            response.message,
            response.code !== 'PHOTOS_DISABLED' && response.code !== 'VALIDATION_ERROR',
          );
        }
        current.prepared = response.data;
        if (pipeline.current === current) pendingAssetId.current = response.data.assetId;
      }
      if (current.cancelled) return;

      const prepared = current.prepared;
      if (!prepared) return;

      if (!current.uploaded) {
        setStatus('uploading');
        setError(null);
        let uploadError: unknown = null;
        try {
          const { error: storageError } = await getSupabaseBrowserClient()
            .storage.from(prepared.bucket)
            .upload(prepared.objectPath, photo.blob, { upsert: false, contentType: photo.mime });
          uploadError = storageError;
        } catch (thrown) {
          uploadError = thrown ?? new Error('upload');
        }
        // 이전 시도가 실제로는 올라갔는데 응답만 잃었으면 같은 경로가 이미 있다. 덮어쓰지 않고
        // 다음 단계(서버 검증 확정)로 넘긴다. 그 객체가 규칙에 맞지 않으면 서버가 거부한다.
        if (uploadError && !isDuplicateUpload(uploadError)) {
          return fail('커버 사진을 올리지 못했어요. 연결을 확인한 뒤 다시 시도해 주세요.', true);
        }
        current.uploaded = true;
      }
      if (current.cancelled) return;

      if (!current.finalized) {
        setStatus('verifying');
        setError(null);
        const finalized = await callAction(() => finalizeCoverPhotoAction({ assetId: prepared.assetId }));
        if (!finalized.ok) {
          if (finalized.retryStage === 'upload') {
            // 객체가 아직 없다. 같은 pending asset·같은 경로로 다시 올린다(덮어쓰기 없음).
            current.uploaded = false;
            return fail(finalized.message, true);
          }
          if (finalized.code === 'UPLOAD_FAILED' || finalized.code === 'NOT_FOUND') {
            // 서버가 이 asset을 정리했다. 다음 시도는 새 asset으로 처음부터.
            current.prepared = null;
            current.prepareRequestId = null;
            current.uploaded = false;
            if (pendingAssetId.current === prepared.assetId) pendingAssetId.current = null;
            return fail(finalized.message, true);
          }
          return fail(finalized.message, finalized.code !== 'PHOTOS_DISABLED');
        }
        current.finalized = true;
      }

      if (current.cancelled) return;
      setStatus('ready');
      setError(null);
      setRetryable(false);
      onReady(prepared.assetId);
    } finally {
      current.running = false;
      if (current.cancelled) discardPipeline(current);
    }
  }, [discardPipeline, onReady, revoke]);

  const pick = useCallback(
    (file: File) => {
      if (!enabled) return;

      // 이전 대기 파일은 교체 시점에 버린다(저장된 커버는 그대로 둔다).
      const previous = pipeline.current;
      pipeline.current = {
        file,
        processed: null,
        prepareRequestId: null,
        prepared: null,
        uploaded: false,
        finalized: false,
        running: false,
        cancelled: false,
      };
      pendingAssetId.current = null;
      if (previous) {
        previous.cancelled = true;
        // 실행 중이면 그 단계가 끝난 뒤 자기 파일을 스스로 정리한다.
        if (!previous.running) discardPipeline(previous);
      }

      setFileName(file.name);
      setPreviewUrl((current) => {
        revoke(current);
        return null;
      });
      setStatus('processing');
      setError(null);
      setRetryable(false);
      void run();
    },
    [discardPipeline, enabled, revoke, run],
  );

  const retry = useCallback(() => void run(), [run]);

  const clearPending = useCallback(() => {
    const current = pipeline.current;
    pipeline.current = null;
    pendingAssetId.current = null;
    if (current) {
      current.cancelled = true;
      if (!current.running) discardPipeline(current);
    }

    setStatus('idle');
    setFileName(null);
    setPreviewUrl((url) => {
      revoke(url);
      return null;
    });
    setError(null);
    setRetryable(false);
  }, [discardPipeline, revoke]);

  const settleSave = useCallback((result: SaveCustomizationData) => {
    saveInFlight.current = false;
    savedRef.current = result.coverAssetId;
    // 서버가 이 파일을 커버로 받아들였으면 소유권이 설정으로 넘어간다. 정리 대상에서 뺀다.
    const next = pendingAfterSave(pendingAssetId.current, result);
    if (next === null && pipeline.current) pipeline.current.prepared = null;
    pendingAssetId.current = next;
  }, []);

  const setSaveInFlight = useCallback((inFlight: boolean) => {
    saveInFlight.current = inFlight;
  }, []);

  useEffect(() => {
    const urls = createdUrls.current;
    return () => {
      for (const url of urls) URL.revokeObjectURL(url);
      urls.clear();
      // 앱 안에서 저장하지 않고 떠날 때의 최선 정리. 실행 중이면 그 단계가 끝난 뒤 finally가 맡는다.
      const current = pipeline.current;
      pipeline.current = null;
      if (current) {
        current.cancelled = true;
        if (!current.running) discardPipeline(current);
      }
    };
  }, [discardPipeline]);

  return {
    status,
    fileName,
    previewUrl,
    error,
    retryable,
    busy: status === 'processing' || status === 'preparing' || status === 'uploading' || status === 'verifying',
    pick,
    retry,
    clearPending,
    settleSave,
    setSaveInFlight,
  };
}
