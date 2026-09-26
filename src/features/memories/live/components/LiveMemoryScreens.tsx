import { notFound } from 'next/navigation';

import type { MemberContext } from '@/features/auth/guards';

import {
  LINK_CANDIDATE_PAGE_SIZE,
  SOURCE_LABELS,
  sourceDetailHref,
  type MemoryLinkSource,
} from '../../links/constants';
import { MemoryLinkPicker } from '../../links/components/MemoryLinkPicker';
import { buildMemoryPrefill } from '../../links/prefill';
import {
  getMemoryLink,
  listLinkCandidates,
  loadLinkSourceSummary,
  loadLinkedSourceView,
} from '../../links/server/queries';
import { SOURCE_REJECTION_MESSAGES, type SourceQueryParse } from '../../links/source';
import type { LinkedSourceView } from '../../links/types';
import { getMemoryById } from '../../server/queries';
import { isPhotoPipelineConfigured } from '../../server/service-client';

import { LiveMemoryDetail, type DetailNotice } from './LiveMemoryDetail';
import { LiveMemoryForm, type LinkDraft } from './LiveMemoryForm';
import { QueryFailure } from './QueryFailure';

/**
 * 상세·편집·작성 화면(서버). 사용자 세션 + RLS로 한 기록을 읽는다.
 * 없는 기록·다른 공간의 기록·형식이 틀린 ID는 모두 같은 404(`notFound`)다.
 */

function authorNameOf(context: MemberContext, authorId: string): string {
  const member = context.members.find((item) => item.userId === authorId);
  if (!member) return '이전 구성원';
  return member.nickname ?? (member.isSelf ? '나' : '상대방');
}

const DETAIL_NOTICES = [
  'saved',
  'saved-cleanup-pending',
  'saved-linked',
  'saved-linked-cleanup-pending',
  'linked',
  'unlinked',
] as const;

export function parseDetailNotice(raw: string | string[] | undefined): DetailNotice {
  const value = Array.isArray(raw) ? raw[0] : raw;
  for (const notice of DETAIL_NOTICES) {
    if (value === notice) return notice;
  }
  return null;
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

  // 연결 조회는 **본문과 분리**한다. 연결을 읽지 못해도 글·사진은 그대로 보여 주고,
  // "연결 없음"이라고 말하지 않는다(DATE-001).
  const linkResult = await getMemoryLink(memory.id);
  let linkView: LinkedSourceView | null = null;
  if (linkResult.status === 'linked') {
    linkView = await loadLinkedSourceView(linkResult.link);
  }

  return (
    <LiveMemoryDetail
      // 새 버전을 받으면 화면 상태(오류·진행 표시)를 새로 시작한다.
      key={`${memory.id}:${memory.version}`}
      memory={memory}
      authorName={authorNameOf(context, memory.authorId)}
      notice={notice}
      linkView={linkView}
      linkQueryError={linkResult.status === 'error' ? linkResult.message : null}
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

/** 원본 한 줄 요약. 카드에만 쓰는 표시 문구다(날짜는 초안 안내에서 따로 보여 준다). */
function summaryOf(
  source: MemoryLinkSource,
  detail: { location: string | null; allDay: boolean },
): string {
  const parts: string[] = [SOURCE_LABELS[source]];
  if (detail.allDay) parts.push('종일');
  if (detail.location) parts.push(detail.location);
  return parts.join(' · ');
}

/**
 * 새 기록 화면.
 *
 * `source`/`sourceId`가 있으면 **서버가** 원본을 세션·RLS로 조회해 초안을 만든다.
 * 클라이언트가 보낸 제목·날짜·장소를 원본의 사실로 신뢰하지 않는다.
 */
export async function LiveMemoryCreateScreen({ source }: { source: SourceQueryParse }) {
  const photosEnabled = isPhotoPipelineConfigured();

  if (source.status === 'absent') {
    return <LiveMemoryForm photosEnabled={photosEnabled} />;
  }
  if (source.status === 'invalid') {
    // 거부한 query는 정규화해서 진행하지 않는다. 왜 연결 없이 시작하는지 알린다.
    return (
      <LiveMemoryForm
        photosEnabled={photosEnabled}
        sourceNotice={SOURCE_REJECTION_MESSAGES[source.reason]}
      />
    );
  }

  const ref = source.ref;
  const loaded = await loadLinkSourceSummary(ref.source, ref.sourceId);

  if (loaded.status === 'not_found') {
    return (
      <LiveMemoryForm
        photosEnabled={photosEnabled}
        sourceNotice="연결하려던 계획을 찾을 수 없어요. 이미 지워졌거나 다른 공간의 계획입니다."
      />
    );
  }
  if (loaded.status === 'error') {
    // 조회 실패를 "연결 없음"으로 바꾸지 않는다. 실패를 그대로 알린다.
    return <LiveMemoryForm photosEnabled={photosEnabled} sourceNotice={loaded.message} />;
  }

  const summary = loaded.summary;
  if (!summary.done) {
    // 완료한 계획만 연결할 수 있다. 초안도 만들지 않는다(잘못된 날짜·제목을 넣지 않기 위해).
    return (
      <LiveMemoryForm
        photosEnabled={photosEnabled}
        sourceNotice={
          ref.source === 'event'
            ? '이 일정을 아직 완료로 표시하지 않았어요. 캘린더에서 완료 체크한 뒤 다시 들어와 주세요.'
            : '이 위시를 아직 완료로 표시하지 않았어요. 위시 화면에서 완료로 바꾼 뒤 다시 들어와 주세요.'
        }
      />
    );
  }

  const link: LinkDraft = {
    ref,
    prefill: buildMemoryPrefill(summary),
    sourceTitle: summary.title,
    sourceSummary: summaryOf(ref.source, summary),
    sourceHref: sourceDetailHref(ref.source, ref.sourceId),
  };

  return <LiveMemoryForm photosEnabled={photosEnabled} link={link} />;
}

/** 기존 추억에 연결할 계획을 고르는 화면. 완료한 일정·위시만 보여 준다. */
export async function LiveMemoryLinkScreen({
  memoryId,
  source,
}: {
  memoryId: string;
  /** 첫 탭. 재시도 경로로 들어오면 그 종류를 먼저 보여 준다. */
  source: SourceQueryParse;
}) {
  const result = await getMemoryById(memoryId);
  if (!result.ok) return <QueryFailure code={result.code} title="기록을 불러오지 못했어요" />;
  if (!result.data) notFound();

  const memory = result.data;
  const initialSource: MemoryLinkSource = source.status === 'ok' ? source.ref.source : 'event';

  const [linkResult, candidates] = await Promise.all([
    getMemoryLink(memory.id),
    listLinkCandidates(initialSource, null, LINK_CANDIDATE_PAGE_SIZE),
  ]);

  return (
    <MemoryLinkPicker
      key={`${memory.id}:${memory.version}`}
      memoryId={memory.id}
      memoryTitle={memory.title}
      memoryVersion={memory.version}
      initialSource={initialSource}
      initialCandidates={candidates.ok ? candidates.items : []}
      initialCursor={candidates.ok ? candidates.nextCursor : null}
      initialError={candidates.ok ? null : candidates.message}
      currentSourceId={linkResult.status === 'linked' ? linkResult.link.sourceId : null}
    />
  );
}
