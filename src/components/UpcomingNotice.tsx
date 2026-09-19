import Link from 'next/link';

/**
 * 아직 만들지 않은 화면을 위한 안내.
 * 기능이 있는 것처럼 보이지 않도록 무엇이 없는지와 어떤 작업에서 만들지를 함께 적는다.
 */
export function UpcomingNotice({
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
        <Link href="/memories" className="btn-primary">
          추억 보러 가기
        </Link>
      </div>
    </section>
  );
}
