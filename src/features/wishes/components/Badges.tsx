import {
  CATEGORY_ICONS,
  CATEGORY_LABELS,
  STATUS_ICONS,
  STATUS_LABELS,
  type WishCategory,
  type WishStatus,
} from '../constants';

/** 상태 표시. 색만으로 구분하지 않고 기호와 글자를 함께 쓴다(PROJECT_PLAN 5). */
export function StatusBadge({ status }: { status: WishStatus }) {
  const tone =
    status === 'done'
      ? 'bg-accent text-accent-contrast'
      : status === 'planned'
        ? 'bg-accent-soft text-text'
        : 'border border-border bg-surface text-text';
  return (
    <span className={`inline-flex items-center gap-1 rounded-pill px-2.5 py-1 text-xs font-semibold ${tone}`}>
      <span aria-hidden>{STATUS_ICONS[status]}</span>
      {STATUS_LABELS[status]}
    </span>
  );
}

/** 분류 표시. 기호는 장식이고 글자가 본문이다. */
export function CategoryBadge({ category }: { category: WishCategory }) {
  return (
    <span className="chip">
      <span aria-hidden>{CATEGORY_ICONS[category]} </span>
      {CATEGORY_LABELS[category]}
    </span>
  );
}
