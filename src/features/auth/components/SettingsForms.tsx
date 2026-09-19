'use client';

import { useActionState, useEffect, useState } from 'react';

import { SPACE_LIMITS } from '@/lib/contracts';
import { todayInSeoul } from '@/lib/dates';

import {
  createInviteAction,
  revokeInviteAction,
  updateProfileAction,
  updateSpaceAction,
} from '../actions';
import { idleFormState } from '../form-state';
import { NICKNAME_LIMITS } from '../schemas';

import { FieldError, FormFeedback, SubmitButton } from './FormFeedback';
import { useStableRequestId } from './use-stable-request-id';

/** 내 닉네임. 본인만 바꿀 수 있다(CONTRACTS.md 5). */
export function ProfileForm({
  initialNickname,
  expectedVersion,
}: {
  initialNickname: string;
  /** 프로필이 아직 없으면 0을 보낸다. */
  expectedVersion: number;
}) {
  const [state, formAction] = useActionState(updateProfileAction, idleFormState);
  const [nickname, setNickname] = useState(initialNickname);
  const requestId = useStableRequestId({ nickname, expectedVersion });

  return (
    <section className="app-card px-5 py-5 sm:px-6">
      <h2 className="text-sm font-bold text-text">내 프로필</h2>
      <p className="mt-1 text-xs leading-relaxed text-muted">
        닉네임은 상대방 화면에도 보입니다. 상대방의 닉네임은 바꿀 수 없어요.
      </p>

      <div className="mt-4">
        <FormFeedback state={state} />

        <form action={formAction} className="space-y-4" noValidate>
          <input type="hidden" name="requestId" value={requestId} />
          <input type="hidden" name="expectedVersion" value={expectedVersion} />

          <div>
            <label htmlFor="nickname" className="field-label">
              닉네임
            </label>
            <input
              id="nickname"
              name="nickname"
              value={nickname}
              onChange={(event) => setNickname(event.target.value)}
              maxLength={NICKNAME_LIMITS.max}
              required
              className="field-input"
              aria-invalid={state.fieldErrors?.nickname ? true : undefined}
              aria-describedby={state.fieldErrors?.nickname ? 'nickname-error' : undefined}
            />
            <FieldError name="nickname" state={state} />
          </div>

          <SubmitButton pendingLabel="저장 중…">닉네임 저장</SubmitButton>
        </form>
      </div>
    </section>
  );
}

/** 공유 공간 정보. 두 사람 모두 바꿀 수 있고 버전으로 충돌을 잡는다. */
export function SpaceForm({
  initialName,
  initialIntroduction,
  initialStartDate,
  expectedVersion,
}: {
  initialName: string;
  initialIntroduction: string;
  initialStartDate: string;
  expectedVersion: number;
}) {
  const [state, formAction] = useActionState(updateSpaceAction, idleFormState);
  const [name, setName] = useState(initialName);
  const [introduction, setIntroduction] = useState(initialIntroduction);
  const [relationshipStartDate, setRelationshipStartDate] = useState(initialStartDate);
  const requestId = useStableRequestId({
    name,
    introduction,
    relationshipStartDate,
    expectedVersion,
  });

  return (
    <section className="app-card px-5 py-5 sm:px-6">
      <h2 className="text-sm font-bold text-text">우리 공간</h2>
      <p className="mt-1 text-xs leading-relaxed text-muted">
        두 사람이 함께 쓰는 정보입니다. 상대방이 먼저 저장했다면 다시 불러온 뒤 저장해 주세요.
      </p>

      <div className="mt-4">
        <FormFeedback state={state} />

        <form action={formAction} className="space-y-4" noValidate>
          <input type="hidden" name="requestId" value={requestId} />
          <input type="hidden" name="expectedVersion" value={expectedVersion} />

          <div>
            <label htmlFor="space-name" className="field-label">
              공간 이름
            </label>
            <input
              id="space-name"
              name="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={SPACE_LIMITS.nameMax}
              required
              className="field-input"
              aria-invalid={state.fieldErrors?.name ? true : undefined}
              aria-describedby={state.fieldErrors?.name ? 'name-error' : undefined}
            />
            <FieldError name="name" state={state} />
          </div>

          <div>
            <label htmlFor="space-introduction" className="field-label">
              한 줄 소개
            </label>
            <input
              id="space-introduction"
              name="introduction"
              value={introduction}
              onChange={(event) => setIntroduction(event.target.value)}
              maxLength={SPACE_LIMITS.introductionMax}
              className="field-input"
              aria-invalid={state.fieldErrors?.introduction ? true : undefined}
              aria-describedby={state.fieldErrors?.introduction ? 'introduction-error' : undefined}
            />
            <FieldError name="introduction" state={state} />
          </div>

          <div>
            <label htmlFor="space-start-date" className="field-label">
              함께한 날짜
            </label>
            <input
              id="space-start-date"
              name="relationshipStartDate"
              type="date"
              value={relationshipStartDate}
              onChange={(event) => setRelationshipStartDate(event.target.value)}
              max={todayInSeoul()}
              className="field-input"
              aria-invalid={state.fieldErrors?.relationshipStartDate ? true : undefined}
              aria-describedby={
                state.fieldErrors?.relationshipStartDate ? 'relationshipStartDate-error' : undefined
              }
            />
            <FieldError name="relationshipStartDate" state={state} />
            <p className="field-hint">비워 두면 함께한 날짜 배지를 숨깁니다.</p>
          </div>

          <SubmitButton pendingLabel="저장 중…">공간 정보 저장</SubmitButton>
        </form>
      </div>
    </section>
  );
}

/**
 * 초대 만들기.
 *
 * 토큰은 이 응답에서 딱 한 번 나온다(CONTRACTS.md 1). 서버 로그·DB에 남지 않으므로
 * 링크를 잃어버리면 새로 만들어야 한다. 화면에서도 그 점을 분명히 알린다.
 */
export function InviteCreateForm({ canInvite }: { canInvite: boolean }) {
  const [state, formAction] = useActionState(createInviteAction, idleFormState);
  const [targetEmail, setTargetEmail] = useState('');
  const requestId = useStableRequestId({ targetEmail });
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2500);
    return () => window.clearTimeout(timer);
  }, [copied]);

  return (
    <div>
      <FormFeedback state={state} />

      {state.status === 'success' && state.inviteLink ? (
        <div className="mb-4 rounded-card border border-border bg-surface-muted px-4 py-3">
          <p className="text-xs font-semibold text-text">초대 링크 (이 화면에서만 보입니다)</p>
          <input
            readOnly
            value={state.inviteLink}
            aria-label="초대 링크"
            className="field-input mt-2 font-mono text-xs"
            onFocus={(event) => event.currentTarget.select()}
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="btn-secondary !min-h-[36px] !px-3 text-xs"
              onClick={() => {
                const link = state.inviteLink;
                if (!link) return;
                void navigator.clipboard?.writeText(link).then(
                  () => setCopied(true),
                  () => setCopied(false),
                );
              }}
            >
              링크 복사
            </button>
            {copied ? (
              <span role="status" className="text-xs text-muted">
                복사했습니다.
              </span>
            ) : null}
          </div>
          <p className="mt-2 text-xs leading-relaxed text-muted">
            24시간 뒤 만료되고 한 번만 쓸 수 있습니다. 링크를 잃어버리면 다시 볼 수 없으니 새
            초대를 만들어 주세요.
          </p>
        </div>
      ) : null}

      <form action={formAction} className="space-y-4" noValidate>
        <input type="hidden" name="requestId" value={requestId} />

        <div>
          <label htmlFor="targetEmail" className="field-label">
            상대방 이메일
          </label>
          <input
            id="targetEmail"
            name="targetEmail"
            type="email"
            inputMode="email"
            value={targetEmail}
            onChange={(event) => setTargetEmail(event.target.value)}
            required
            disabled={!canInvite}
            className="field-input"
            aria-invalid={state.fieldErrors?.targetEmail ? true : undefined}
            aria-describedby={state.fieldErrors?.targetEmail ? 'targetEmail-error' : undefined}
          />
          <FieldError name="targetEmail" state={state} />
          <p className="field-hint">
            이 주소로 로그인한 계정만 초대를 수락할 수 있어요. 새 초대를 만들면 이전 초대는
            폐기됩니다.
          </p>
        </div>

        {canInvite ? (
          <SubmitButton pendingLabel="만드는 중…">초대 링크 만들기</SubmitButton>
        ) : (
          <p className="rounded-xl bg-surface-muted px-4 py-3 text-xs leading-relaxed text-muted">
            이미 두 사람이 참여해 정원이 찼습니다. 새 초대를 만들 수 없어요.
          </p>
        )}
      </form>
    </div>
  );
}

/** 활성 초대 폐기. */
export function RevokeInviteForm({ inviteId }: { inviteId: string }) {
  const [state, formAction] = useActionState(revokeInviteAction, idleFormState);
  const requestId = useStableRequestId({ inviteId });

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="inviteId" value={inviteId} />
      <input type="hidden" name="requestId" value={requestId} />
      <SubmitButton pendingLabel="폐기 중…" className="btn-quiet !min-h-[36px] !px-3 text-xs">
        폐기하기
      </SubmitButton>
      {state.status !== 'idle' && state.message ? (
        <span
          role={state.status === 'error' ? 'alert' : 'status'}
          className={`text-xs ${state.status === 'error' ? 'text-[#B3261E]' : 'text-muted'}`}
        >
          {state.message}
        </span>
      ) : null}
    </form>
  );
}
