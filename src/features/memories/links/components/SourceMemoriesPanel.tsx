import Link from 'next/link';

import { ErrorNotice } from '@/components/ErrorNotice';
import { formatKoreanDate } from '@/lib/dates';

import { SOURCE_ICONS, SOURCE_LABELS, type MemoryLinkSource } from '../constants';
import { buildSourceQuery } from '../source';

import type { SourceMemoriesResult } from '../types';

/**
 * 원본(완료한 일정·해낸 위시) 상세에 붙는 "데이트 기록" 칸 — 표시 전용 컴포넌트.
 *
 * 하는 일은 세 가지다.
 *   1. 완료한 원본에서 **사진이 있는 추억 작성으로 들어가는 입구**를 준다(DESIGN 3·8).
 *      제목·날짜·장소는 URL에 싣지 않는다. `?source=&sourceId=`만 넘기고 서버가 원본을 다시 읽는다.
 *   2. 이 원본으로 남긴 기록을 **찾아볼 수 있게** 한다.
 *   3. 기록이 있으면 원본 삭제가 거부된다는 사실을 미리 알린다
 *      (DB가 `GF409 ..._has_memories`로 거부한다. 문구만 띄우고 끝내지 않도록 목록을 함께 보여 준다).
 *
 * 아직 완료하지 않은 원본에는 입구를 만들지 않는다. DB 트리거도 완료가 아닌 원본과의 연결을
 * 거부하므로(`..._not_done`), 화면에서 먼저 막아 헛걸음을 줄인다.
 */
export function SourceMemoriesPanel({
  source,
  sourceId,
  done,
  result,
}: {
  source: MemoryLinkSource;
  sourceId: string;
  /** 원본이 완료 상태인지(`일정: done`, `위시: done`). */
  done: boolean;
  /** 조회 결과. 실패는 빈 목록으로 바꾸지 않고 그대로 알린다. */
  result: SourceMemoriesResult;
}) {
  const newMemoryHref = `/memories/new${buildSourceQuery({ source, sourceId })}`;
  const items = result.ok ? result.items : [];

  return (
    <section aria-labelledby="source-memories-heading" className="app-card px-5 py-5 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="source-memories-heading" className="text-sm font-bold text-text">
          <span aria-hidden className="mr-1">
            📷
          </span>
          데이트 기록
        </h2>
        {done ? (
          <Link href={newMemoryHref} className="btn-primary !min-h-[40px] text-sm">
            이 {SOURCE_LABELS[source].replace(/^(완료한|해낸)\s*/, '')}으로 기록 남기기
          </Link>
        ) : null}
      </div>

      {!done ? (
        <p className="mt-3 text-sm leading-relaxed text-muted">
          <span aria-hidden className="mr-1">
            {SOURCE_ICONS[source]}
          </span>
          완료로 표시한 뒤에 사진과 함께 데이트 기록을 남길 수 있어요.
        </p>
      ) : null}

      {!result.ok ? (
        <div className="mt-3">
          <ErrorNotice
            title="연결된 기록을 불러오지 못했어요"
            description={`${result.message} 이 칸만 불러오지 못했고, 위의 내용은 정상이에요.`}
          />
        </div>
      ) : items.length === 0 ? (
        <p className="mt-3 text-sm leading-relaxed text-muted">
          {done
            ? '아직 남긴 기록이 없어요. 사진과 이야기를 더하면 여기에서 바로 찾아볼 수 있어요.'
            : '연결된 기록이 없어요.'}
        </p>
      ) : (
        <>
          <ul className="mt-3 space-y-2">
            {items.map((item) => (
              <li key={item.memoryId}>
                <Link
                  href={`/memories/${item.memoryId}`}
                  className="flex items-center justify-between gap-3 rounded-xl border border-border px-3 py-2.5 text-sm hover:bg-surface-alt"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-text">{item.title}</span>
                    <span className="mt-0.5 block text-xs text-muted">
                      <time dateTime={item.memoryDate}>{formatKoreanDate(item.memoryDate)}</time>
                      {item.photoCount > 0 ? ` · 사진 ${item.photoCount}장` : ' · 사진 없음'}
                    </span>
                  </span>
                  <span aria-hidden className="shrink-0 text-muted">
                    →
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs leading-relaxed text-muted">
            연결된 기록이 있으면 이 항목은 지울 수 없어요. 먼저 위 기록에서 연결을 해제하거나 기록을
            지운 뒤에 다시 시도해 주세요.
          </p>
        </>
      )}
    </section>
  );
}
