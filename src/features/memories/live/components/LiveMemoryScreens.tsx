import { notFound } from 'next/navigation';

import type { MemberContext } from '@/features/auth/guards';

import { getMemoryById } from '../../server/queries';
import { isPhotoPipelineConfigured } from '../../server/service-client';

import { LiveMemoryDetail, type DetailNotice } from './LiveMemoryDetail';
import { LiveMemoryForm } from './LiveMemoryForm';
import { QueryFailure } from './QueryFailure';

/**
 * 상세·편집 화면(서버). 사용자 세션 + RLS로 한 기록을 읽는다.
 * 없는 기록·다른 공간의 기록·형식이 틀린 ID는 모두 같은 404(`notFound`)다.
 */

function authorNameOf(context: MemberContext, authorId: string): string {
  const member = context.members.find((item) => item.userId === authorId);
  if (!member) return '이전 구성원';
  return member.nickname ?? (member.isSelf ? '나' : '상대방');
}

export function parseDetailNotice(raw: string | string[] | undefined): DetailNotice {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value === 'saved' || value === 'saved-cleanup-pending' ? value : null;
}

export async function LiveMemoryDetailScreen({
  memoryId,
  context,
  notice,
}: {
  memoryId: string;
  context: MemberContext;
  notice: DetailNotice;
}) {
  const result = await getMemoryById(memoryId);
  if (!result.ok) return <QueryFailure code={result.code} title="기록을 불러오지 못했어요" />;
  if (!result.data) notFound();

  const memory = result.data;
  return (
    <LiveMemoryDetail
      // 새 버전을 받으면 화면 상태(오류·진행 표시)를 새로 시작한다.
      key={`${memory.id}:${memory.version}`}
      memory={memory}
      authorName={authorNameOf(context, memory.authorId)}
      notice={notice}
    />
  );
}

export async function LiveMemoryEditScreen({ memoryId }: { memoryId: string }) {
  const result = await getMemoryById(memoryId);
  if (!result.ok) return <QueryFailure code={result.code} title="수정할 기록을 불러오지 못했어요" />;
  if (!result.data) notFound();

  const memory = result.data;
  return (
    <LiveMemoryForm
      key={`${memory.id}:${memory.version}`}
      photosEnabled={isPhotoPipelineConfigured()}
      memory={{
        id: memory.id,
        version: memory.version,
        title: memory.title,
        body: memory.body,
        memoryDate: memory.memoryDate,
        location: memory.location,
        tags: memory.tags,
        isPinned: memory.isPinned,
        photoAssetIds: memory.photos.map((photo) => photo.assetId),
      }}
    />
  );
}

export function LiveMemoryCreateScreen() {
  return <LiveMemoryForm photosEnabled={isPhotoPipelineConfigured()} />;
}
