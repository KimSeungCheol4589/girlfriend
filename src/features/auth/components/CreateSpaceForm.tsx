'use client';

import { useActionState, useState } from 'react';

import { SPACE_LIMITS } from '@/lib/contracts';
import { todayInSeoul } from '@/lib/dates';

import { createSpaceAction } from '../actions';
import { idleFormState } from '../form-state';

import { FieldError, FormFeedback, SubmitButton } from './FormFeedback';
import { useStableRequestId } from './use-stable-request-id';

/**
 * 최초 공간 만들기.
 *
 * 운영자가 허용한 계정만 만들 수 있다(DB의 `bootstrap_creators`). 권한이 없으면
 * 서버가 FORBIDDEN을 돌려주고 화면은 그 사유를 그대로 안내한다.
 */
export function CreateSpaceForm() {
  const [state, formAction] = useActionState(createSpaceAction, idleFormState);
  const [name, setName] = useState('');
  const [introduction, setIntroduction] = useState('');
  const [relationshipStartDate, setRelationshipStartDate] = useState('');

  // 같은 입력으로 재시도하면 같은 키가 유지된다. 내용을 고치면 새 키가 만들어진다.
  const requestId = useStableRequestId({ name, introduction, relationshipStartDate });

  return (
    <>
      <FormFeedback state={state} />

      <form action={formAction} className="space-y-4" noValidate>
        <input type="hidden" name="requestId" value={requestId} />

        <div>
          <label htmlFor="name" className="field-label">
            공간 이름
          </label>
          <input
            id="name"
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
          <p className="field-hint">{SPACE_LIMITS.nameMax}자까지 쓸 수 있어요.</p>
        </div>

        <div>
          <label htmlFor="introduction" className="field-label">
            한 줄 소개 <span className="font-normal text-muted">(선택)</span>
          </label>
          <input
            id="introduction"
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
          <label htmlFor="relationshipStartDate" className="field-label">
            함께한 날짜 <span className="font-normal text-muted">(선택)</span>
          </label>
          <input
            id="relationshipStartDate"
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
          <p className="field-hint">시작한 당일을 1일로 셉니다. 미래 날짜는 고를 수 없어요.</p>
        </div>

        <SubmitButton pendingLabel="만드는 중…" className="btn-primary w-full">
          공간 만들기
        </SubmitButton>
      </form>
    </>
  );
}
