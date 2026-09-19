import Link from 'next/link';

/**
 * 실제(live) 모드에서 아직 만들지 않은 기능 화면.
 *
 * 데모 화면의 예시 데이터를 여기에 보여 주지 않는다. 로그인한 사용자가
 * "저장된 기록"으로 오해할 수 있기 때문이다.
 */
export function LivePendingFeature({
  title,
  summary,
  plannedItems,
  taskNote,
}: {
  title: string;
  summary: string;
  plannedItems: string[];
  taskNote: string;
}) {
  return (
    <section className="app-card px-5 py-8 sm:px-8">
      <span className="chip bg-accent-soft text-text">준비 중</span>
      <h1 className="mt-3 text-xl font-bold text-text sm:text-2xl">{title}</h1>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">{summary}</p>

      <h2 className="mt-6 text-sm font-bold text-text">이 화면에서 만들 것</h2>
      <ul className="mt-2 space-y-1.5">
        {plannedItems.map((item) => (
          <li key={item} className="flex gap-2 text-sm leading-relaxed text-muted">
            <span aria-hidden className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
            <span>{item}</span>
          </li>
        ))}
      </ul>

      <p className="mt-6 rounded-xl bg-surface-muted px-4 py-3 text-xs leading-relaxed text-muted">
        {taskNote}
      </p>

      <div className="mt-6 flex flex-wrap gap-2">
        <Link href="/" className="btn-secondary">
          홈으로
        </Link>
        <Link href="/settings" className="btn-primary">
          설정 열기
        </Link>
      </div>
    </section>
  );
}
