import { STATUS_ICONS, STATUS_LABELS, type RestaurantStatus } from '../constants';

/** 방문 상태 표시. 색만으로 구분하지 않고 기호와 글자를 함께 쓴다(PROJECT_PLAN 5). */
export function StatusBadge({ status }: { status: RestaurantStatus }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-pill px-2.5 py-1 text-xs font-semibold ${
        status === 'visited' ? 'bg-accent text-accent-contrast' : 'border border-border bg-surface text-text'
      }`}
    >
      <span aria-hidden>{STATUS_ICONS[status]}</span>
      {STATUS_LABELS[status]}
    </span>
  );
}
