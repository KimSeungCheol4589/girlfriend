'use server';

import { revalidatePath } from 'next/cache';

import { memoryFailure, type MemoryActionResult } from '../../live/errors';
import { requireMemberSession } from '../../server/member-session';
import { isMemoryLinkSource, type MemoryLinkSource } from '../constants';
import { linkFailure, logLinkFailure, mapLinkRpcError } from '../errors';
import {
  linkCandidatesInputSchema,
  linkMemoryInputSchema,
  unlinkMemoryInputSchema,
} from '../input-schema';
import type { LinkCandidateResult, LinkMemoryData, UnlinkMemoryData } from '../types';

import { listLinkCandidates } from './queries';

/**
 * 연결 Server Action (DATE-001).
 *
 * 공통 규칙
 *   - 매 호출마다 서버가 세션과 공간 소속을 다시 확인한다. 클라이언트가 보낸 사용자·공간 ID는 받지 않는다.
 *   - 사용자 작업은 **사용자 세션 클라이언트 + RLS + 전용 RPC**로만 한다. service_role은 쓰지 않는다.
 *   - 본문·사진 저장은 기존 `saveMemoryAction`이 한다. 이 파일은 **연결만** 다룬다.
 *     그래서 연결이 실패해도 이미 저장된 기록과 사진은 그대로 남는다(부분 성공을 화면이 알린다).
 *   - `requestId`는 연결 작업 **고유**의 키다. 본문 저장의 키를 그대로 쓰지 않는다
 *     (같은 키에 다른 입력이면 DB가 거부한다, CONTRACTS.md 0).
 *   - 로그에는 작업 이름·오류 코드·요청 ID만 남긴다. 제목·본문·원본 제목은 남기지 않는다.
 */

function revalidateLinkedScreens(): void {
  // 추억 상세·목록·홈이 같은 데이터를 쓴다. 이전 사용자의 화면을 재사용하지 않도록 전부 비운다.
  revalidatePath('/', 'layout');
}

export async function linkMemoryPlanAction(
  raw: unknown,
): Promise<MemoryActionResult<LinkMemoryData>> {
  const parsed = linkMemoryInputSchema.safeParse(raw);
  if (!parsed.success) return linkFailure('VALIDATION_ERROR');
  const input = parsed.data;

  const session = await requireMemberSession();
  if (!session.ok) return session;

  const { data, error } = await session.member.client.rpc('link_memory_plan', {
    p_memory_id: input.memoryId,
    p_source: input.source,
    p_source_id: input.sourceId,
    p_expected_version: input.expectedVersion,
    p_request_id: input.requestId,
  });

  if (error) {
    const failure = mapLinkRpcError(error);
    logLinkFailure('link', failure.code, input.requestId);
    return failure;
  }

  const result = (data ?? {}) as {
    memoryId?: unknown;
    version?: unknown;
    source?: unknown;
    sourceId?: unknown;
    replacedPreviousLink?: unknown;
    alreadyLinked?: unknown;
  };
  if (
    typeof result.memoryId !== 'string' ||
    typeof result.version !== 'number' ||
    !isMemoryLinkSource(result.source) ||
    typeof result.sourceId !== 'string'
  ) {
    logLinkFailure('link', 'UNKNOWN', input.requestId);
    return linkFailure('UNKNOWN');
  }

  revalidateLinkedScreens();
  return {
    ok: true,
    data: {
      memoryId: result.memoryId,
      version: result.version,
      source: result.source,
      sourceId: result.sourceId,
      replacedPreviousLink: result.replacedPreviousLink === true,
      alreadyLinked: result.alreadyLinked === true,
    },
  };
}

/**
 * 연결 해제. **명시적인 요청일 때만** 부른다.
 * 저장·고정처럼 연결을 보내지 않은 요청이 연결을 지우는 일은 없다(RPC도 그렇게 나뉘어 있다).
 */
export async function unlinkMemoryPlanAction(
  raw: unknown,
): Promise<MemoryActionResult<UnlinkMemoryData>> {
  const parsed = unlinkMemoryInputSchema.safeParse(raw);
  if (!parsed.success) return linkFailure('VALIDATION_ERROR');
  const input = parsed.data;

  const session = await requireMemberSession();
  if (!session.ok) return session;

  const { data, error } = await session.member.client.rpc('unlink_memory_plan', {
    p_memory_id: input.memoryId,
    p_expected_version: input.expectedVersion,
    p_request_id: input.requestId,
  });

  if (error) {
    const failure = mapLinkRpcError(error);
    logLinkFailure('unlink', failure.code, input.requestId);
    return failure;
  }

  const result = (data ?? {}) as {
    memoryId?: unknown;
    version?: unknown;
    source?: unknown;
    sourceId?: unknown;
  };
  if (
    typeof result.memoryId !== 'string' ||
    typeof result.version !== 'number' ||
    !isMemoryLinkSource(result.source) ||
    typeof result.sourceId !== 'string'
  ) {
    logLinkFailure('unlink', 'UNKNOWN', input.requestId);
    return linkFailure('UNKNOWN');
  }

  revalidateLinkedScreens();
  return {
    ok: true,
    data: {
      memoryId: result.memoryId,
      version: result.version,
      source: result.source,
      sourceId: result.sourceId,
    },
  };
}

/** 후보 목록의 다음 페이지. 조용히 자르지 않고 사용자가 더 불러온다. */
export async function loadMoreLinkCandidatesAction(raw: unknown): Promise<LinkCandidateResult> {
  const parsed = linkCandidatesInputSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, message: memoryFailure('VALIDATION_ERROR').message };
  }
  const source: MemoryLinkSource = parsed.data.source;
  return listLinkCandidates(source, parsed.data.cursor);
}
