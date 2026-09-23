import Link from 'next/link';

import { formatKoreanDate } from '@/lib/dates';

import { safeLinkHref } from '../schema';

import { CategoryBadge, StatusBadge } from './Badges';
import { DeleteWishButton } from './DeleteWishButton';
import { WishStatusPanel } from './WishStatusPanel';

import type { WishDetail } from '../types';

/**
 * 위시 상세. 사용자 입력(제목·메모)은 일반 텍스트로만 그린다(DESIGN 5.3).
 * 링크는 규칙을 통과한 https 주소일 때만 링크로 만들고 새 창에서 연다. 서버가 내용을 가져오지 않는다.
 */
export function WishDetailView({ wish }: { wish: WishDetail }) {
  const linkHref = safeLinkHref(wish.linkUrl);

  return (
    <div className="space-y-6">
      <Link href="/wishes" className="btn-quiet !px-0 text-sm">
        ← 하고 싶은 일 목록
      </Link>

      <article className="app-card px-5 py-6 sm:px-6">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
          <StatusBadge status={wish.status} />
          <CategoryBadge category={wish.category} />
        </div>
        <h1 className="mt-3 break-words text-2xl font-bold text-text">{wish.title}</h1>
        {wish.plannedDate ? (
          <p className="mt-1 text-sm text-muted">
            {wish.status === 'done'
              ? `${formatKoreanDate(wish.plannedDate)}에 해냈어요`
              : `${formatKoreanDate(wish.plannedDate)}에 하기로 했어요`}
          </p>
        ) : null}

        <dl className="mt-5 space-y-3 text-sm">
          <div>
            <dt className="font-semibold text-text">링크</dt>
            <dd className="mt-0.5 text-muted">
              {linkHref ? (
                <a
                  href={linkHref}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  referrerPolicy="no-referrer"
                  className="break-all text-accent underline underline-offset-2"
                >
                  링크 열기
                  <span className="sr-only"> (새 창)</span>
                </a>
              ) : wish.linkUrl ? (
                '저장된 링크가 안전하게 열 수 있는 주소가 아니라 열 수 없어요. 수정 화면에서 다시 넣어 주세요.'
              ) : (
                '등록한 링크가 없어요.'
              )}
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-text">메모</dt>
            <dd className="mt-0.5 whitespace-pre-line break-words text-text">
              {wish.memo ? wish.memo : <span className="text-muted">메모가 없어요.</span>}
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-text">적은 사람</dt>
            <dd className="mt-0.5 text-muted">{wish.createdByLabel}</dd>
          </div>
        </dl>

        <div className="mt-6 flex flex-wrap items-start justify-between gap-3 border-t border-border pt-4">
          <Link href={`/wishes/${wish.id}/edit`} className="btn-secondary">
            내용 수정
          </Link>
          <DeleteWishButton wishId={wish.id} wishTitle={wish.title} version={wish.version} />
        </div>
      </article>

      <WishStatusPanel
        wishId={wish.id}
        status={wish.status}
        plannedDate={wish.plannedDate}
        version={wish.version}
      />
    </div>
  );
}
