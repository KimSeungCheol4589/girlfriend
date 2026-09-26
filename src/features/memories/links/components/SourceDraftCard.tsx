import { formatKoreanDate } from '@/lib/dates';

import { SOURCE_ICONS, SOURCE_LABELS, type MemoryLinkSource } from '../constants';
import { DATE_ORIGIN_NOTICES, type MemoryPrefill } from '../prefill';

/**
 * 새 기록 화면 위에 놓는 "무엇을 기록하는지" 카드.
 *
 * 규칙
 *   - 원본 제목·요약은 **글자로만** 그린다(저장된 문자열을 HTML로 해석하지 않는다).
 *   - 초안을 손댄 사실(제목 줄임·임시 날짜·여러 날 일정·장소 없음)을 숨기지 않고 모두 적는다.
 *   - 원본을 바꾸지 않는다는 점을 문장으로 분명히 한다.
 */
export function SourceDraftCard({
  source,
  sourceHref,
  sourceTitle,
  sourceSummary,
  prefill,
  linkEnabled,
  onDisableLink,
  disabled,
}: {
  source: MemoryLinkSource;
  sourceHref: string;
  /** 원본 제목 원문(줄이지 않은 값). */
  sourceTitle: string;
  /** 한 줄 요약(일정은 기간·시각, 위시는 분류·계획일). */
  sourceSummary: string;
  prefill: MemoryPrefill;
  linkEnabled: boolean;
  onDisableLink: () => void;
  disabled: boolean;
}) {
  const dateNotice = DATE_ORIGIN_NOTICES[prefill.dateOrigin];

  return (
    <section
      aria-label="연결할 계획"
      className="app-card space-y-3 border-accent/40 px-4 py-4 sm:px-6"
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
        <span className="chip">
          <span aria-hidden>{SOURCE_ICONS[source]}</span> {SOURCE_LABELS[source]}
        </span>
        {linkEnabled ? (
          <span>저장하면 이 계획과 연결돼요.</span>
        ) : (
          <span>연결하지 않고 기록만 남깁니다.</span>
        )}
      </div>

      <div className="min-w-0">
        <p className="truncate text-[15px] font-bold text-text">{sourceTitle}</p>
        {sourceSummary ? <p className="mt-0.5 text-sm text-muted">{sourceSummary}</p> : null}
      </div>

      <ul className="space-y-1.5 text-xs leading-relaxed text-muted">
        <li>
          기록 날짜는 <b className="text-text">{formatKoreanDate(prefill.memoryDate)}</b>로 채웠어요.
          {prefill.dateOrigin === 'source' ? ' 필요하면 바꿀 수 있어요.' : ''}
        </li>
        {dateNotice ? <li className="text-[#8A453E]">{dateNotice}</li> : null}
        {prefill.spansMultipleDays && prefill.sourceEndDate ? (
          <li>
            여러 날에 걸친 일정이라 <b className="text-text">시작일</b>을 넣었어요(
            {formatKoreanDate(prefill.sourceEndDate)}까지 이어지는 일정이에요).
          </li>
        ) : null}
        {prefill.titleTruncated ? (
          <li>제목이 추억의 80자 상한을 넘어 줄여 넣었어요. 그대로 쓰거나 고쳐 주세요.</li>
        ) : null}
        {source === 'wish' ? (
          <li>위시에는 장소 정보가 없어 장소는 비워 두었어요. 직접 적어 주세요.</li>
        ) : null}
        <li>내용은 직접 적어 주세요. 계획의 메모를 옮겨 적지 않았어요.</li>
        <li>이 계획의 날짜·상태는 바뀌지 않아요.</li>
      </ul>

      <div className="flex flex-wrap gap-2">
        <a
          href={sourceHref}
          target="_blank"
          rel="noopener"
          className="btn-quiet !min-h-[36px] text-xs"
        >
          계획 새 탭에서 보기
        </a>
        {linkEnabled ? (
          <button
            type="button"
            onClick={onDisableLink}
            disabled={disabled}
            className="btn-quiet !min-h-[36px] text-xs"
          >
            연결 없이 기록하기
          </button>
        ) : null}
      </div>
    </section>
  );
}
