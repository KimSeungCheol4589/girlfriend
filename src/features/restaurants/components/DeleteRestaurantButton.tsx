'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useRef, useState, useTransition } from 'react';

import { ConfirmDialog } from '@/components/ConfirmDialog';

import { deleteRestaurantAction } from '../actions';
import { confirmedActionMessage } from '../errors';

import { FormNotice, type Notice } from './FormNotice';
import { ReviewDeletionList } from './ReviewDeletionList';
import { useHydrated } from './use-hydrated';
import { useRestaurantMutation } from './use-restaurant-mutation';

import type { ReviewView } from '../types';

/**
 * 맛집 삭제. 항상 확인을 받고, 함께 지워질 후기를 보여 준다(DESIGN 6·9).
 * 후기가 있으면 확인 플래그를 보내고, 없으면 보내지 않는다. 기준 버전은 확인 창에 보인 상태의 버전이며,
 * 후기 저장·수정·삭제도 맛집 버전을 올리므로 그 사이 후기가 생기거나 바뀌거나 지워졌다면
 * DB가 아무것도 지우지 않고 CONFLICT로 거부한다. 그때는 최신 내용을 불러와 다시 확인을 받는다.
 */
export function DeleteRestaurantButton({
  restaurantId,
  restaurantName,
  version,
  reviews,
}: {
  restaurantId: string;
  restaurantName: string;
  version: number;
  reviews: ReviewView[];
}) {
  const router = useRouter();
  const noticeRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [showReload, setShowReload] = useState(false);
  const [gone, setGone] = useState(false);
  const [refreshing, startRefresh] = useTransition();
  // 성공하면 목록으로 이동한다. 이동이 끝날 때까지 잠가 두 번째 삭제 요청을 보내지 않는다.
  const { run, pending, locked } = useRestaurantMutation('deleteRestaurant', deleteRestaurantAction, {
    lockOnSuccess: true,
  });
  const hydrated = useHydrated();

  const close = useCallback(() => setOpen(false), []);

  async function onConfirm() {
    setOpen(false);
    const result = await run({
      restaurantId,
      confirmDeleteReviews: reviews.length > 0,
      expectedVersion: version,
    });
    if (result === null) return;

    if (result.ok) {
      router.replace('/restaurants');
      router.refresh();
      return;
    }

    setNotice({ tone: 'error', message: confirmedActionMessage(result) });
    setShowReload(result.code === 'CONFLICT');
    setGone(result.code === 'NOT_FOUND');
    // 버전 충돌·확인 필요: 아무것도 지워지지 않았다. 최신 후기 목록·버전을 바로 불러와 다시 확인받는다.
    if (result.code === 'CONFLICT') startRefresh(() => router.refresh());
    window.setTimeout(() => noticeRef.current?.focus(), 0);
  }

  return (
    <div className="space-y-3">
      <FormNotice ref={noticeRef} notice={notice}>
        <div className="flex flex-wrap gap-2">
          {showReload ? (
            <button
              type="button"
              className="btn-secondary !min-h-[36px] !px-3 text-xs"
              disabled={refreshing}
              onClick={() => startRefresh(() => router.refresh())}
            >
              {refreshing ? '불러오는 중…' : '최신 내용 불러오기'}
            </button>
          ) : null}
          {gone ? (
            <Link href="/restaurants" className="btn-secondary !min-h-[36px] !px-3 text-xs">
              맛집 목록으로
            </Link>
          ) : null}
        </div>
      </FormNotice>

      <button
        type="button"
        className="btn-quiet text-[#B3261E]"
        // 하이드레이션 전에는 눌러도 아무 일이 없으므로 막는다.
        disabled={pending || locked || !hydrated}
        aria-busy={pending}
        onClick={() => setOpen(true)}
      >
        {pending ? '삭제 중…' : locked ? '삭제했어요. 이동 중…' : '맛집 삭제'}
      </button>

      <ConfirmDialog
        open={open}
        title={`‘${restaurantName}’을(를) 삭제할까요?`}
        description={
          reviews.length > 0
            ? `두 사람 모두의 목록에서 사라지고, 후기 ${reviews.length}개도 함께 삭제돼요. 되돌릴 수 없어요.`
            : '두 사람 모두의 목록에서 사라지고 되돌릴 수 없어요. 연결된 후기는 없어요.'
        }
        details={<ReviewDeletionList reviews={reviews} />}
        confirmLabel={reviews.length > 0 ? `후기 ${reviews.length}개와 함께 삭제` : '삭제'}
        onCancel={close}
        onConfirm={() => void onConfirm()}
      />
    </div>
  );
}
