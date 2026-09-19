import Link from 'next/link';

import { daysTogether, formatKoreanDate } from '@/lib/dates';

import type { MemberContext } from '../guards';

/**
 * 로그인한 두 사람의 홈.
 *
 * 이번 작업(AUTH-001)의 범위는 로그인·공간·초대까지다. 추억·맛집·꾸미기의 실제 저장은
 * 아직 없으므로 **예시 데이터를 대신 보여 주지 않고** 준비 중임을 분명히 적는다.
 */
export function LiveHome({ context }: { context: MemberContext }) {
  const { space, members, profile } = context;
  const dayCount = daysTogether(space.relationshipStartDate);

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-card border border-border shadow-card">
        <div
          className="flex min-h-[168px] flex-col justify-end px-5 py-6 sm:min-h-[220px] sm:px-8"
          style={{ backgroundImage: 'var(--cover-gradient)' }}
        >
          <h1 className="text-2xl font-bold tracking-tight text-text sm:text-3xl">{space.name}</h1>
          {space.introduction ? (
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-text/80">
              {space.introduction}
            </p>
          ) : null}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {dayCount.status === 'ok' ? (
              <span className="chip bg-surface text-text">
                함께한 지 {dayCount.days.toLocaleString('ko-KR')}일
              </span>
            ) : null}
            {space.relationshipStartDate && dayCount.status === 'ok' ? (
              <span className="chip bg-surface text-muted">
                {formatKoreanDate(space.relationshipStartDate)}부터
              </span>
            ) : null}
          </div>
        </div>
      </section>

      <section className="app-card px-5 py-5 sm:px-6">
        <h2 className="text-sm font-bold text-text">우리 공간 구성원</h2>
        <ul className="mt-3 space-y-2">
          {members.map((member) => (
            <li key={member.userId} className="flex items-center gap-3">
              <span
                aria-hidden
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-soft text-sm font-bold text-text"
              >
                {(member.nickname ?? '?').slice(0, 1)}
              </span>
              <span className="text-sm text-text">
                {member.nickname ?? '닉네임 없음'}
                {member.isSelf ? <span className="ml-2 chip">나</span> : null}
              </span>
            </li>
          ))}
        </ul>
        {members.length < 2 ? (
          <p className="mt-4 rounded-xl bg-surface-muted px-4 py-3 text-xs leading-relaxed text-muted">
            아직 혼자입니다. 설정 화면에서 상대방 이메일로 일회용 초대 링크를 만들 수 있어요.
            공간에는 최대 두 명만 참여합니다.
          </p>
        ) : null}
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href="/settings" className="btn-secondary">
            설정 열기
          </Link>
        </div>
      </section>

      <section className="app-card px-5 py-5 sm:px-6">
        <span className="chip bg-accent-soft text-text">준비 중</span>
        <h2 className="mt-3 text-sm font-bold text-text">아직 만들지 않은 기능</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          로그인과 공간·초대까지 연결했습니다. 추억 기록, 사진 업로드, 맛집, 꾸미기의 실제 저장은
          다음 작업에서 붙입니다. 지금은 저장할 수 있는 화면이 없으므로 예시 데이터를 실제 기록처럼
          보여 주지 않습니다.
        </p>
        <ul className="mt-3 space-y-1.5">
          {[
            '추억 작성·목록·상세 (MEM-001)',
            '맛집 목록과 두 사람의 후기 (FOOD-001)',
            '테마·커버·홈 구성 저장 (THEME-001)',
          ].map((item) => (
            <li key={item} className="flex gap-2 text-sm leading-relaxed text-muted">
              <span aria-hidden className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </section>

      {profile === null ? (
        <p className="rounded-card border border-border bg-surface-muted px-4 py-3 text-xs leading-relaxed text-muted">
          아직 닉네임을 정하지 않았습니다. 설정에서 닉네임을 저장하면 상대방 화면에도 같은 이름이
          보입니다.
        </p>
      ) : null}
    </div>
  );
}
