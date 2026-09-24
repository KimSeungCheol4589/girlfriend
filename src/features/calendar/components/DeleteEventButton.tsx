'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useRef, useState, useTransition } from 'react';

import { ConfirmDialog } from '@/components/ConfirmDialog';

import { deleteCalendarEventAction } from '../actions';
import { confirmedActionMessage } from '../errors';

import { FormNotice, type Notice } from './FormNotice';
import { useCalendarMutation } from './use-calendar-mutation';
import { useHydrated } from './use-hydrated';

/**
 * 일정 삭제. 항상 확인을 받는다(DESIGN 9).
 *
 * 기준 버전은 확인 창에 보인 상태의 버전이다. 그 사이 상대방이 내용이나 상태를 바꿨다면
 * DB가 아무것도 지우지 않고 CONFLICT로 거부한다. 그때는 최신 내용을 불러와 다시 확인을 받는다.
 */
export function DeleteEventButton({
  eventId,
  eventTitle,
  version,
  calendarHref,
}: {
  eventId: string;
  eventTitle: string;
  version: number;
  /** 삭제 후 돌아갈 목록 주소(보고 있던 달·필터를 유지한다). */
  calendarHref: string;
}) {
  const router = useRouter();
  const noticeRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [showReload, setShowReload] = useState(false);
  const [gone, setGone] = useState(false);
  const [refreshing, startRefresh] = useTransition();
  // 성공하면 목록으로 이동한다. 이동이 끝날 때까지 잠가 두 번째 삭제 요청을 보내지 않는다.
  const { run, pending, locked } = useCalendarMutation(
    'deleteCalendarEvent',
    deleteCalendarEventAction,
    { lockOnSuccess: true },
  );
  const hydrated = useHydrated();

  const close = useCallback(() => setOpen(false), []);

  async function onConfirm() {
    setOpen(false);
    const result = await run({ eventId, expectedVersion: version });
    if (result === null) return;

    if (result.ok) {
      router.replace(calendarHref);
      router.refresh();
      return;
    }

    setNotice({ tone: 'error', message: confirmedActionMessage(result) });
    setShowReload(result.code === 'CONFLICT');
    setGone(result.code === 'NOT_FOUND');
    // 버전 충돌: 아무것도 지워지지 않았다. 최신 내용·버전을 바로 불러와 다시 확인받는다.
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
            <Link href={calendarHref} className="btn-secondary !min-h-[36px] !px-3 text-xs">
              캘린더로
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
        {pending ? '삭제 중…' : locked ? '삭제했어요. 이동 중…' : '일정 삭제'}
      </button>

      <ConfirmDialog
        open={open}
        title={`‘${eventTitle}’ 일정을 삭제할까요?`}
        description="두 사람 모두의 캘린더에서 사라지고 되돌릴 수 없어요. 연결한 위시는 지워지지 않아요."
        confirmLabel="삭제"
        onCancel={close}
        onConfirm={() => void onConfirm()}
      />
    </div>
  );
}
