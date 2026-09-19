import { z } from 'zod';

import { MEMORY_LIMITS } from '@/lib/contracts';
import { isCalendarDate } from '@/lib/dates';
import { checkImageCandidate, type ImageCandidate } from '@/lib/images';

/**
 * 추억 입력 검증. DESIGN.md 5.2의 제한값을 그대로 따른다.
 * 이 스키마는 화면 입력용이며, 실제 서버 작업(`saveMemory`)에서도 같은 제한을 다시 검사해야 한다.
 */

export const memoryDraftSchema = z.object({
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
    .refine(isCalendarDate, '실제로 있는 날짜를 YYYY-MM-DD 형식으로 입력해 주세요.'),
  location: z
    .string()
    .trim()
    .max(MEMORY_LIMITS.locationMax, `장소는 ${MEMORY_LIMITS.locationMax}자까지 입력할 수 있어요.`),
  tags: z
    .array(
      z
        .string()
        .trim()
        .min(1, '빈 태그는 저장할 수 없어요.')
        .max(MEMORY_LIMITS.tagMax, `태그 하나는 ${MEMORY_LIMITS.tagMax}자까지 입력할 수 있어요.`),
    )
    .max(MEMORY_LIMITS.tagCountMax, `태그는 최대 ${MEMORY_LIMITS.tagCountMax}개까지 붙일 수 있어요.`),
  photoCount: z
    .number()
    .int()
    .min(0)
    .max(
      MEMORY_LIMITS.photoCountMax,
      `사진은 최대 ${MEMORY_LIMITS.photoCountMax}장까지 올릴 수 있어요.`,
    ),
});

export type MemoryDraft = z.infer<typeof memoryDraftSchema>;

/** 폼 필드 이름 → 첫 오류 메시지. 상단 요약과 각 필드 표시에 함께 쓴다. */
export type MemoryFieldErrors = Partial<Record<keyof MemoryDraft, string>>;

export type MemoryValidationResult =
  | { ok: true; data: MemoryDraft }
  | { ok: false; fieldErrors: MemoryFieldErrors; order: (keyof MemoryDraft)[] };

/** DESIGN.md 9: 첫 오류 필드로 포커스를 옮기기 위해 폼에 보이는 순서를 고정한다. */
export const MEMORY_FIELD_ORDER: (keyof MemoryDraft)[] = [
  'title',
  'memoryDate',
  'location',
  'tags',
  'body',
  'photoCount',
];

export function validateMemoryDraft(input: unknown): MemoryValidationResult {
  const parsed = memoryDraftSchema.safeParse(input);
  if (parsed.success) {
    return { ok: true, data: parsed.data };
  }

  const fieldErrors: MemoryFieldErrors = {};
  for (const issue of parsed.error.issues) {
    const field = issue.path[0];
    if (typeof field !== 'string') continue;
    const key = field as keyof MemoryDraft;
    if (fieldErrors[key] === undefined) {
      fieldErrors[key] = issue.message;
    }
  }

  const order = MEMORY_FIELD_ORDER.filter((field) => fieldErrors[field] !== undefined);
  return { ok: false, fieldErrors, order };
}

/**
 * 쉼표·줄바꿈으로 구분한 태그 입력을 정규화한다.
 * 앞의 `#`를 떼고 공백을 정리하며 대소문자를 구분하지 않고 중복을 제거한다.
 */
export function normalizeTags(raw: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const piece of raw.split(/[,\n]/)) {
    const tag = piece.trim().replace(/^#+/, '').trim();
    if (tag.length === 0) continue;
    const dedupeKey = tag.toLocaleLowerCase('ko-KR');
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    result.push(tag);
  }

  return result;
}

export type PhotoCandidate = ImageCandidate;

export type PhotoSelectionResult = {
  accepted: PhotoCandidate[];
  rejected: { name: string; reason: string }[];
};

/**
 * 사진 선택을 검증한다. DESIGN.md 1·8.2의 장수·용량·형식 제한을 적용한다.
 * 실제 업로드는 아직 구현하지 않았고, 여기서 통과한 파일도 브라우저 미리보기까지만 쓴다.
 */
export function validatePhotoSelection(
  currentCount: number,
  candidates: readonly PhotoCandidate[],
): PhotoSelectionResult {
  const accepted: PhotoCandidate[] = [];
  const rejected: { name: string; reason: string }[] = [];
  let total = currentCount;

  for (const candidate of candidates) {
    const problem = checkImageCandidate(candidate);
    if (problem !== null) {
      rejected.push({ name: candidate.name, reason: problem });
      continue;
    }

    if (total >= MEMORY_LIMITS.photoCountMax) {
      rejected.push({
        name: candidate.name,
        reason: `사진은 최대 ${MEMORY_LIMITS.photoCountMax}장까지 올릴 수 있어요.`,
      });
      continue;
    }

    accepted.push(candidate);
    total += 1;
  }

  return { accepted, rejected };
}
