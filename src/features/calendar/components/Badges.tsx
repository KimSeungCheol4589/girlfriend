import {
  KIND_ICONS,
  KIND_LABELS,
  STATUS_ICONS,
  STATUS_LABELS,
  type EventKind,
  type EventStatus,
} from '../constants';

/** 상태 표시. 색만으로 구분하지 않고 기호와 글자를 함께 쓴다(PROJECT_PLAN 5). */
export function StatusBadge({ status }: { status: EventStatus }) {
  const tone =
    status === 'done'
      ? 'bg-accent text-accent-contrast'
      : status === 'cancelled'
        ? 'border border-border bg-surface-muted text-muted line-through'
        : 'border border-border bg-surface text-text';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-pill px-2.5 py-1 text-xs font-semibold ${tone}`}
    >
      <span aria-hidden>{STATUS_ICONS[status]}</span>
      {STATUS_LABELS[status]}
    </span>
  );
}

/**
 * 누구의 일정인지 표시.
 * `ownerLabel`은 조회에서 정한 값이다(`내 일정`·상대 닉네임·`함께`).
 */
export function OwnerBadge({ kind, ownerLabel }: { kind: EventKind; ownerLabel: string }) {
  return (
    <span className="chip">
      <span aria-hidden>{KIND_ICONS[kind]} </span>
      {ownerLabel}
    </span>
  );
}

export function KindBadge({ kind }: { kind: EventKind }) {
  return (
    <span className="chip">
      <span aria-hidden>{KIND_ICONS[kind]} </span>
      {KIND_LABELS[kind]}
    </span>
  );
}
