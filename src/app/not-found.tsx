import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="app-card px-6 py-14 text-center">
      <span aria-hidden className="text-2xl">
        🔍
      </span>
      <h1 className="mt-2 text-xl font-bold text-text">찾는 화면이 없어요</h1>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted">
        주소가 바뀌었거나 아직 만들지 않은 화면일 수 있어요. 홈에서 다시 시작해 주세요.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <Link href="/" className="btn-primary">
          홈으로
        </Link>
        <Link href="/memories" className="btn-secondary">
          추억 목록
        </Link>
      </div>
    </div>
  );
}
