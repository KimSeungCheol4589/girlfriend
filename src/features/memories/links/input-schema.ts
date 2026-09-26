import { z } from 'zod';

import { UUID_PATTERN } from '../live/ids';

import { LINK_CURSOR_MAX_LENGTH, MEMORY_LINK_SOURCES } from './constants';

/**
 * 연결 Server Action 입력 검증(Zod). 화면 검증과 같은 제한을 서버에서 다시 검사하고,
 * 최종 방어는 DB 함수다(CONTRACTS.md 0).
 *
 * 클라이언트가 보낸 사용자·공간 ID는 **받지 않는다.** 서버가 세션으로 확인한다.
 */

const uuid = z.string().regex(UUID_PATTERN);

export const linkMemoryInputSchema = z.object({
  memoryId: uuid,
  source: z.enum(MEMORY_LINK_SOURCES),
  sourceId: uuid,
  // 저장된 추억만 연결한다. 새 기록은 버전 1 이상이므로 0은 받지 않는다.
  expectedVersion: z.number().int().min(1),
  requestId: uuid,
});

export type LinkMemoryInput = z.infer<typeof linkMemoryInputSchema>;

export const unlinkMemoryInputSchema = z.object({
  memoryId: uuid,
  expectedVersion: z.number().int().min(1),
  requestId: uuid,
});

export type UnlinkMemoryInput = z.infer<typeof unlinkMemoryInputSchema>;

export const linkCandidatesInputSchema = z.object({
  source: z.enum(MEMORY_LINK_SOURCES),
  cursor: z.string().max(LINK_CURSOR_MAX_LENGTH).nullable(),
});

export type LinkCandidatesInput = z.infer<typeof linkCandidatesInputSchema>;
