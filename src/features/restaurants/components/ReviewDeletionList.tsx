import type { ReviewView } from '../types';

/** 확인 대화상자 안에 "함께 지워지는 후기"를 보여 준다(DESIGN 9). 본문은 일반 텍스트로만 그린다. */
export function ReviewDeletionList({ reviews }: { reviews: ReviewView[] }) {
  if (reviews.length === 0) return null;
  return (
    <ul className="space-y-1.5 rounded-xl bg-surface-muted px-3.5 py-3 text-sm text-text">
      {reviews.map((review) => (
        <li key={review.id} className="break-words">
          <span className="font-semibold">{review.isMine ? `내 후기 (${review.authorLabel})` : `${review.authorLabel}의 후기`}</span>
          <span className="text-muted"> · 별점 {review.rating}점</span>
          {review.comment ? <span className="block text-muted">“{review.comment}”</span> : null}
        </li>
      ))}
    </ul>
  );
}
