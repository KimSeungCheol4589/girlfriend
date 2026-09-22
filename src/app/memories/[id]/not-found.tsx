import Link from 'next/link';

/**
 * 추억 상세·편집의 404.
 * 없는 기록, 다른 공간의 기록, 형식이 틀린 주소를 모두 같은 화면으로 보여 준다(존재 여부를 구분하지 않는다).
 *
 * 이 경계는 페이지(앱 껍데기 포함)를 통째로 대신하므로 여기서 본문 랜드마크(`main`)를 직접 둔다.
 */
export default function MemoryNotFound() {
  return (
    <main id="main" className="app-container py-6 md:py-10">
      <div className="app-card px-6 py-14 text-center">
        <span aria-hidden className="text-2xl">
          🔍
        </span>
        <h1 className="mt-2 text-xl font-bold text-text">이 기록을 찾을 수 없어요</h1>
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted">
          지워졌거나 주소가 잘못됐을 수 있어요. 목록에서 다시 골라 주세요.
        </p>
        <Link href="/memories" className="btn-primary mt-6">
          추억 목록으로
        </Link>
      </div>
    </main>
  );
}
