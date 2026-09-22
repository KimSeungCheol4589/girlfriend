'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { newRequestId } from '@/features/auth/request-id';
import { validatePhotoSelection } from '@/features/memories/schema';
import { MEMORY_LIMITS } from '@/lib/contracts';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';

import {
  discardMemoryPhotoAction,
  finalizeMemoryPhotoAction,
  prepareMemoryPhotoAction,
} from '../../server/actions';
import { processPhotoForUpload, type ProcessedPhoto } from '../client-image';
import { memoryPhotoUrl } from '../constants';
import { MEMORY_CODE_MESSAGES, type MemoryActionResult } from '../errors';
import type { PreparedPhoto } from '../types';

/**
 * 추억 폼의 사진 목록과 업로드 파이프라인.
 *
 * 한 장마다: 브라우저 정규화(방향·축소·재인코딩·EXIF 제거) → prepare_upload → 사용자 세션으로
 * 표준 업로드 1회(upsert 없음, 이후 객체 불변) → 서버의 읽기 전용 검증 확정.
 *   - 실패해도 목록에서 사라지지 않는다. 이미 성공한 단계는 다시 하지 않고 실패한 단계부터 재시도한다.
 *   - 준비 요청은 같은 사진이면 같은 requestId를 쓴다(응답 유실 후 재시도가 asset을 두 번 만들지 않게).
 *   - 서버가 확정을 거부하면 그 asset은 서버에서 정리되므로 새 asset으로 처음부터 다시 올린다.
 *   - 빼거나 화면을 떠나면 아직 기록에 붙지 않은 자기 파일을 `discard_upload`로 돌린다.
 *
 * 미리보기 objectURL은 이 훅이 만든 것만 이 훅이 해제한다(기존 사진은 인증 경로 URL이라 해제할 것이 없다).
 */

export type NewPhotoStatus = 'processing' | 'preparing' | 'uploading' | 'verifying' | 'ready' | 'failed';

export type PhotoItem =
  | { key: string; kind: 'existing'; assetId: string; src: string; alt: string }
  | {
      key: string;
      kind: 'new';
      fileName: string;
      previewUrl: string | null;
      status: NewPhotoStatus;
      assetId: string | null;
      error: string | null;
      retryable: boolean;
    };

type Pipeline = {
  file: File;
  processed: ProcessedPhoto | null;
  prepareRequestId: string | null;
  prepared: PreparedPhoto | null;
  uploaded: boolean;
  finalized: boolean;
  running: boolean;
  cancelled: boolean;
};

let keySeed = 0;
function nextKey(prefix: string): string {
  keySeed += 1;
  return `${prefix}-${Date.now().toString(36)}-${keySeed}`;
}

/** 네트워크 오류로 Server Action 자체가 실패하면 "처리 여부를 모름"으로 본다. */
async function callAction<T>(run: () => Promise<MemoryActionResult<T>>): Promise<MemoryActionResult<T>> {
  try {
    return await run();
  } catch {
    return { ok: false, code: 'RETRYABLE_ERROR', message: MEMORY_CODE_MESSAGES.RETRYABLE_ERROR };
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

export function existingPhotoItems(assetIds: readonly string[], title: string): PhotoItem[] {
  return assetIds.map((assetId, index) => ({
    key: `existing-${assetId}`,
    kind: 'existing' as const,
    assetId,
    src: memoryPhotoUrl(assetId),
    alt: `${title} 사진 ${index + 1}`,
  }));
}

export function useLivePhotos(initial: PhotoItem[], enabled: boolean) {
  const [items, setItems] = useState<PhotoItem[]>(initial);
  const [rejected, setRejected] = useState<{ name: string; reason: string }[]>([]);
  const pipelines = useRef(new Map<string, Pipeline>());
  const createdUrls = useRef(new Set<string>());

  const patch = useCallback((key: string, changes: Partial<Extract<PhotoItem, { kind: 'new' }>>) => {
    setItems((current) =>
      current.map((item) => (item.key === key && item.kind === 'new' ? { ...item, ...changes } : item)),
    );
  }, []);

  const discard = useCallback(async (pipeline: Pipeline) => {
    const assetId = pipeline.prepared?.assetId;
    if (!assetId) return;
    pipeline.prepared = null;
    // 결과와 무관하게 사용자 흐름을 막지 않는다. 남은 파일은 만료 정리 대상이 된다.
    await callAction(() => discardMemoryPhotoAction({ assetId, requestId: newRequestId() }));
  }, []);

  const run = useCallback(
    async (key: string) => {
      const pipeline = pipelines.current.get(key);
      if (!pipeline || pipeline.running || pipeline.cancelled) return;
      pipeline.running = true;

      const fail = (message: string, retryable: boolean) =>
        patch(key, { status: 'failed', error: message, retryable });

      try {
        if (!pipeline.processed) {
          patch(key, { status: 'processing', error: null });
          const processed = await processPhotoForUpload(pipeline.file);
          if (!processed.ok) return fail(processed.message, false);
          pipeline.processed = processed.photo;
          const url = URL.createObjectURL(processed.photo.blob);
          createdUrls.current.add(url);
          patch(key, { previewUrl: url });
        }
        if (pipeline.cancelled) return;

        const photo = pipeline.processed;
        if (!photo) return;

        if (!pipeline.prepared) {
          patch(key, { status: 'preparing', error: null });
          pipeline.prepareRequestId ??= newRequestId();
          const requestId = pipeline.prepareRequestId;
          const response = await callAction(() =>
            prepareMemoryPhotoAction({ mimeType: photo.mime, bytes: photo.blob.size, requestId }),
          );
          if (!response.ok) {
            const unknownOutcome = response.code === 'RETRYABLE_ERROR' || response.code === 'UNKNOWN';
            // 확정 응답이면 다음 시도는 새 키. 모르는 결과면 같은 키로 재시도해 asset 중복을 막는다.
            if (!unknownOutcome) pipeline.prepareRequestId = null;
            return fail(
              response.message,
              response.code !== 'PHOTOS_DISABLED' && response.code !== 'VALIDATION_ERROR',
            );
          }
          pipeline.prepared = response.data;
          patch(key, { assetId: response.data.assetId });
        }
        if (pipeline.cancelled) return;

        const prepared = pipeline.prepared;
        if (!prepared) return;

        if (!pipeline.uploaded) {
          patch(key, { status: 'uploading', error: null });
          let uploadError: unknown = null;
          try {
            const { error } = await getSupabaseBrowserClient()
              .storage.from(prepared.bucket)
              .upload(prepared.objectPath, photo.blob, { upsert: false, contentType: photo.mime });
            uploadError = error;
          } catch (error) {
            uploadError = error ?? new Error('upload');
          }
          // 이전 시도가 실제로는 올라갔는데 응답만 잃었으면 같은 경로가 이미 있다. 덮어쓰지 않고
          // 다음 단계(서버 검증 확정)로 넘긴다. 그 객체가 규칙에 맞지 않으면 서버가 거부한다.
          if (uploadError && !isDuplicateUpload(uploadError)) {
            return fail('사진을 올리지 못했어요. 연결을 확인한 뒤 다시 시도해 주세요.', true);
          }
          pipeline.uploaded = true;
        }
        if (pipeline.cancelled) return;

        if (!pipeline.finalized) {
          patch(key, { status: 'verifying', error: null });
          const assetId = prepared.assetId;
          const finalized = await callAction(() => finalizeMemoryPhotoAction({ assetId }));
          if (!finalized.ok) {
            if (finalized.retryStage === 'upload') {
              // 객체가 아직 없다. 같은 pending asset·같은 경로로 다시 올린다(덮어쓰기 없음).
              pipeline.uploaded = false;
              return fail(finalized.message, true);
            }
            if (finalized.code === 'UPLOAD_FAILED' || finalized.code === 'NOT_FOUND') {
              // 서버가 이 asset을 정리했다. 다음 시도는 새 asset으로 처음부터.
              pipeline.prepared = null;
              pipeline.prepareRequestId = null;
              pipeline.uploaded = false;
              patch(key, { assetId: null });
              return fail(finalized.message, true);
            }
            return fail(finalized.message, finalized.code !== 'PHOTOS_DISABLED');
          }
          pipeline.finalized = true;
        }

        patch(key, { status: 'ready', error: null, retryable: false });
      } finally {
        pipeline.running = false;
        if (pipeline.cancelled) await discard(pipeline);
      }
    },
    [discard, patch],
  );

  const addFiles = useCallback(
    (files: File[]) => {
      if (!enabled || files.length === 0) return;
      // 파일마다 따로 검사한다(같은 이름의 파일이 섞여 있어도 정확히 짝지어진다).
      const rejectedNow: { name: string; reason: string }[] = [];
      const added: PhotoItem[] = [];
      for (const file of files) {
        const result = validatePhotoSelection(items.length + added.length, [
          { name: file.name, size: file.size, type: file.type },
        ]);
        if (result.accepted.length === 0) {
          rejectedNow.push(...result.rejected);
          continue;
        }
        const key = nextKey('new');
        pipelines.current.set(key, {
          file,
          processed: null,
          prepareRequestId: null,
          prepared: null,
          uploaded: false,
          finalized: false,
          running: false,
          cancelled: false,
        });
        added.push({
          key,
          kind: 'new',
          fileName: file.name,
          previewUrl: null,
          status: 'processing',
          assetId: null,
          error: null,
          retryable: false,
        });
      }
      setRejected(rejectedNow);
      if (added.length === 0) return;
      setItems((current) => [...current, ...added].slice(0, MEMORY_LIMITS.photoCountMax));
      for (const item of added) void run(item.key);
    },
    [enabled, items.length, run],
  );

  const retry = useCallback((key: string) => void run(key), [run]);

  const remove = useCallback(
    (key: string) => {
      setItems((current) => current.filter((item) => item.key !== key));
      const pipeline = pipelines.current.get(key);
      if (!pipeline) return;
      pipeline.cancelled = true;
      pipelines.current.delete(key);
      // 실행 중이면 파이프라인이 끝날 때 정리한다.
      if (!pipeline.running) void discard(pipeline);
    },
    [discard],
  );

  const move = useCallback((index: number, direction: -1 | 1) => {
    setItems((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      const moved = next[index] as PhotoItem;
      next[index] = next[target] as PhotoItem;
      next[target] = moved;
      return next;
    });
  }, []);

  /** 저장하지 않고 떠날 때. 아직 기록에 붙지 않은 자기 파일만 정리한다. */
  const discardUnsaved = useCallback(async () => {
    const pending = [...pipelines.current.values()];
    pipelines.current.clear();
    await Promise.allSettled(
      pending.map((pipeline) => {
        pipeline.cancelled = true;
        return pipeline.running ? Promise.resolve() : discard(pipeline);
      }),
    );
  }, [discard]);

  /** 저장 성공 후. 붙은 파일은 기록 소유가 되므로 정리 대상에서 뺀다. */
  const markSaved = useCallback(() => {
    pipelines.current.clear();
  }, []);

  useEffect(() => {
    const urls = createdUrls.current;
    const owned = pipelines.current;
    return () => {
      for (const url of urls) URL.revokeObjectURL(url);
      urls.clear();
      // 저장하지 않고 앱 안에서 떠날 때(메뉴 이동·뒤로 가기 등 클라이언트 라우팅)의 최선 정리.
      //   - 실행 중인 파이프라인: 취소 표시 → 현재 단계가 끝나면 finally에서 자기 asset을 취소한다.
      //   - 멈춰 있는 파이프라인(ready·실패·pending): 여기서 바로 자기 asset을 취소한다.
      //   - 저장에 성공한 사진은 markSaved가 이미 목록에서 뺐다. 응답 유실로 남았더라도 DB가
      //     첨부된 asset의 취소를 거부한다(`discard_upload` → CONFLICT).
      // 탭 닫기·새로고침·로그아웃처럼 페이지가 통째로 내려가면 요청이 끝난다는 보장이 없다.
      // 그 경우는 24시간 만료 정리(docs/memories/CLEANUP.md)에 맡긴다.
      for (const pipeline of owned.values()) {
        pipeline.cancelled = true;
        if (!pipeline.running) void discard(pipeline);
      }
      owned.clear();
    };
  }, [discard]);

  const busy = items.some((item) => item.kind === 'new' && item.status !== 'ready' && item.status !== 'failed');
  const failed = items.some((item) => item.kind === 'new' && item.status === 'failed');
  const assetIds = items.flatMap((item) => (item.assetId ? [item.assetId] : []));
  const allReady = items.every((item) => item.kind === 'existing' || item.status === 'ready');

  return { items, rejected, setRejected, addFiles, retry, remove, move, discardUnsaved, markSaved, busy, failed, allReady, assetIds };
}
