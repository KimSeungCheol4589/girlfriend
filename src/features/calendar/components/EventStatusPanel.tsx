'use client';

import { useRouter } from 'next/navigation';
import { useId, useRef, useState, useTransition } from 'react';

import { setCalendarEventStatusAction } from '../actions';
import {
  nextStatusChoices,
  STATUS_ACTION_LABELS,
  STATUS_ICONS,
  STATUS_LABELS,
  type EventStatus,
} from '../constants';

import { FormNotice, type Notice } from './FormNotice';
import { useCalendarMutation } from './use-calendar-mutation';
import { useHydrated } from './use-hydrated';

/**
 * 상태(예정 · 완료 · 취소) 체크.
 *
 * - 완료 체크는 삭제와 다르다. 완료한 일정은 남아 데이트 기록 작성 대상이 된다(DESIGN 5.3).
 * - 공동 일정은 두 사람 모두, 개인 일정은 소유자만 바꾼다. 바꿀 수 없으면 버튼을 두지 않고 이유를 알린다.
 * - 기준 버전은 서버가 이 화면을 그릴 때의 값이다. 그 사이 상대방이 바꿨으면 DB가 CONFLICT로
 *   아무것도 바꾸지 않는다. 그때는 최신 내용을 다시 불러온다.
 */
export function EventStatusPanel({
  eventId,
  status,
  version,
  canEdit,
}: {
  eventId: string;
  status: EventStatus;
  version: number;
  canEdit: boolean;
}) {
  const router = useRouter();
  const panelId = useId();
  const noticeRef = useRef<HTMLDivElement>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [showReload, setShowReload] = useState(false);
  const [refreshing, startRefresh] = useTransition();
  const { run, pending } = useCalendarMutation(
    'setCalendarEventStatus',
    setCalendarEventStatusAction,
  );
  const hydrated = useHydrated();

  /**
   * 서버 상태 따라가기(위시 상세의 P2 수정과 같은 이유).
   *
   * 저장에 성공하면 서버가 다시 그린 결과(prop)는 **응답보다 조금 뒤에** 도착한다. 그 사이 다음 전환을
   * 누르면 낡은 `version`을 expectedVersion으로 보내 **자기 변경**을 상대방 충돌로 오인한다.
   * 그래서 "서버가 가진 버전"을 따로 들고 다니고, 저장 성공 응답으로 즉시 갱신한다.
   *
   * 상태(`status`)도 같이 들고 다닌다. 버전만 갱신하면 그 짧은 창에서 "완료로 표시했어요" 알림과
   * "지금 상태: 예정" 표시, 그리고 아직 렌더된 "완료로 바꾸기" 버튼이 함께 보여 화면이 자기모순이
   * 된다(독립 검토 P3-5). 두 값을 한 번에 맞춰 표시와 버튼 목록이 언제나 서로 맞게 한다.
   *
   * prop은 이 클라이언트의 저장이 만든 재검증이나 사용자가 부른 새로 고침으로만 바뀐다(서버가 미는
   * 경로가 없다). 그래서 prop 변화를 그대로 받아들여도 상대방의 변경을 모르고 덮어쓰는 일은 없다.
   */
  const [serverVersion, setServerVersion] = useState(version);
  const [serverStatus, setServerStatus] = useState(status);
  const [versionSnapshot, setVersionSnapshot] = useState(version);
  const [statusSnapshot, setStatusSnapshot] = useState(status);
  if (versionSnapshot !== version) {
    setVersionSnapshot(version);
    setServerVersion(version);
  }
  // 상태는 버전과 따로 본다. 내용만 고쳐도 버전은 오르지만 상태는 그대로일 수 있다.
  if (statusSnapshot !== status) {
    setStatusSnapshot(status);
    setServerStatus(status);
  }

  async function submit(next: EventStatus) {
    setShowReload(false);

    const result = await run({
      eventId,
      status: next,
      // prop이 아니라 우리가 아는 서버 버전을 보낸다. 방금 저장한 내 변경을 충돌로 오인하지 않는다.
      expectedVersion: serverVersion,
    });
    if (result === null) return;

    if (result.ok) {
      // 표시·버튼 목록이 알림과 어긋나지 않게 버전과 상태를 함께 갱신한다.
      setServerVersion(result.data.version);
      setServerStatus(result.data.status);
      setNotice({
        tone: 'success',
        message:
          result.data.status === 'done'
            ? '완료로 표시했어요.'
            : result.data.status === 'cancelled'
              ? '취소한 일정으로 표시했어요. 일정은 지워지지 않아요.'
              : '예정으로 되돌렸어요.',
      });
      return;
    }

    setNotice({ tone: 'error', message: result.message });
    if (result.code === 'NOT_FOUND') setShowReload(true);
    // 버전 충돌: 아무것도 바뀌지 않았다. 최신 상태·버전을 바로 불러온다.
    // 이 패널에는 사용자 입력이 없어 새로 고침으로 잃는 내용이 없다.
    if (result.code === 'CONFLICT') startRefresh(() => router.refresh());
    noticeRef.current?.focus();
  }

  return (
    <section aria-labelledby={`${panelId}-heading`} className="app-card px-5 py-5 sm:px-6">
      <h2 id={`${panelId}-heading`} className="text-base font-bold text-text">
        상태
      </h2>
      <p className="mt-1 text-sm text-muted">
        지금 상태:{' '}
        <strong className="font-semibold text-text" data-testid="event-status">
          <span aria-hidden>{STATUS_ICONS[serverStatus]} </span>
          {STATUS_LABELS[serverStatus]}
        </strong>
      </p>

      <div className="mt-4">
        <FormNotice ref={noticeRef} notice={notice}>
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
        </FormNotice>
      </div>

      {canEdit ? (
        // 하이드레이션 전에는 버튼을 막는다(누른 것이 조용히 사라지지 않게).
        <fieldset
          disabled={!hydrated}
          aria-busy={!hydrated || undefined}
          className="mt-3 min-w-0 border-0 p-0"
        >
          <legend className="sr-only">상태 바꾸기</legend>
          <div className="flex flex-wrap items-center gap-2">
            {nextStatusChoices(serverStatus).map((value) => (
              <button
                key={value}
                type="button"
                className={value === 'done' ? 'btn-primary' : 'btn-secondary'}
                disabled={pending}
                aria-busy={pending}
                onClick={() => void submit(value)}
              >
                {STATUS_ACTION_LABELS[value]}
              </button>
            ))}
          </div>
          <p className="field-hint">완료해도 일정은 남아요. 지우려면 아래에서 삭제해 주세요.</p>
        </fieldset>
      ) : (
        <p
          className="mt-3 rounded-xl bg-surface-muted px-4 py-3 text-xs leading-relaxed text-muted"
          data-testid="event-readonly-notice"
        >
          상대방의 개인 일정이라 보기만 할 수 있어요. 완료 체크와 수정은 만든 사람만 할 수 있어요.
        </p>
      )}
    </section>
  );
}
