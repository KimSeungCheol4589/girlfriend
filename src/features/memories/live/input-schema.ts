import { z } from 'zod';

import { MEMORY_LIMITS } from '@/lib/contracts';
import { isCalendarDate, todayInSeoul } from '@/lib/dates';

import { MEMORY_PHOTO_MAX_BYTES, MEMORY_UPLOAD_MIME_TYPES } from './constants';
import type { MemoryFieldErrors, MemoryFormField } from './errors';
import { UUID_PATTERN } from './ids';

/**
 * 서버 작업 입력 검증(Zod). 화면 검증과 같은 제한을 서버에서 다시 검사한다.
 * DB도 같은 규칙을 강제하므로 여기서 통과해도 DB 결과를 그대로 따른다.
 */

const uuid = z.string().regex(UUID_PATTERN);

export const tagsSchema = z
  .array(
    z
      .string()
      .trim()
      .min(1, '빈 태그는 저장할 수 없어요.')
      .max(MEMORY_LIMITS.tagMax, `태그 하나는 ${MEMORY_LIMITS.tagMax}자까지 입력할 수 있어요.`),
  )
  .max(MEMORY_LIMITS.tagCountMax, `태그는 최대 ${MEMORY_LIMITS.tagCountMax}개까지 붙일 수 있어요.`)
  .refine((tags) => new Set(tags).size === tags.length, '같은 태그를 두 번 쓸 수 없어요.');

export const saveMemoryInputSchema = z.object({
  memoryId: uuid.nullable(),
  title: z
    .string()
    .trim()
    .min(MEMORY_LIMITS.titleMin, '제목을 입력해 주세요.')
    .max(MEMORY_LIMITS.titleMax, `제목은 ${MEMORY_LIMITS.titleMax}자까지 입력할 수 있어요.`),
  body: z
    .string()
    .max(MEMORY_LIMITS.bodyMax, `본문은 ${MEMORY_LIMITS.bodyMax.toLocaleString('ko-KR')}자까지 입력할 수 있어요.`),
  memoryDate: z
    .string()
    .min(1, '날짜를 선택해 주세요.')
    .refine(isCalendarDate, '실제로 있는 날짜를 YYYY-MM-DD 형식으로 입력해 주세요.')
    // 한국 달력 날짜 기준. 문자열 비교가 날짜 순서와 같다(YYYY-MM-DD).
    .refine((value) => value <= todayInSeoul(), '오늘(한국 날짜)보다 뒤의 날짜는 저장할 수 없어요.'),
  location: z
    .string()
    .trim()
    .max(MEMORY_LIMITS.locationMax, `장소는 ${MEMORY_LIMITS.locationMax}자까지 입력할 수 있어요.`),
  tags: tagsSchema,
  photoAssetIds: z
    .array(uuid)
    .max(MEMORY_LIMITS.photoCountMax, `사진은 최대 ${MEMORY_LIMITS.photoCountMax}장까지 붙일 수 있어요.`)
    .refine((ids) => new Set(ids.map((id) => id.toLowerCase())).size === ids.length, '같은 사진이 두 번 들어 있어요.'),
  isPinned: z.boolean(),
  expectedVersion: z.number().int().min(0),
  requestId: uuid,
});

export type SaveMemoryInput = z.infer<typeof saveMemoryInputSchema>;

export const deleteMemoryInputSchema = z.object({
  memoryId: uuid,
  expectedVersion: z.number().int().min(1),
  requestId: uuid,
});

/**
 * 홈 고정/해제: 화면이 보고 있던 기록 스냅샷 전체 + 바뀐 `isPinned`.
 * 서버가 다시 읽지 않으므로 응답 유실 재시도가 같은 페이로드로 DB 멱등성에 합류한다.
 */
export const pinMemoryInputSchema = saveMemoryInputSchema.extend({
  memoryId: uuid,
  expectedVersion: z.number().int().min(1),
});

export const preparePhotoInputSchema = z.object({
  mimeType: z.enum(MEMORY_UPLOAD_MIME_TYPES),
  bytes: z.number().int().min(1).max(MEMORY_PHOTO_MAX_BYTES),
  requestId: uuid,
});

export const finalizePhotoInputSchema = z.object({
  assetId: uuid,
});

export const discardPhotoInputSchema = z.object({
  assetId: uuid,
  requestId: uuid,
});

export const loadMoreInputSchema = z.object({
  month: z.string().max(7).nullable(),
  tag: z.string().max(200).nullable(),
  cursor: z.string().max(64),
});

const PATH_TO_FIELD: Record<string, MemoryFormField> = {
  title: 'title',
  body: 'body',
  memoryDate: 'memoryDate',
  location: 'location',
  tags: 'tags',
  photoAssetIds: 'photos',
};

/** Zod 오류 → 폼 필드 오류. 폼에 없는 경로(requestId 등)는 버린다. */
export function toMemoryFieldErrors(error: z.ZodError): MemoryFieldErrors {
  const result: MemoryFieldErrors = {};
  for (const issue of error.issues) {
    const head = issue.path[0];
    if (typeof head !== 'string') continue;
    const field = PATH_TO_FIELD[head];
    if (field && result[field] === undefined) result[field] = issue.message;
  }
  return result;
}
