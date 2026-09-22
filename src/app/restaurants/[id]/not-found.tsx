import Link from 'next/link';

/** 없거나 볼 수 없는 맛집. 존재 여부를 구분하지 않고 같은 화면을 보여 준다(DESIGN 3·7). */
export default function RestaurantNotFound() {
  return (
    <div className="app-card px-6 py-14 text-center">
      <span aria-hidden className="text-2xl">
        🔍
      </span>
      <h1 className="mt-2 text-xl font-bold text-text">이 맛집을 찾지 못했어요</h1>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted">
        삭제됐거나 볼 수 없는 맛집이에요. 목록에서 다시 골라 주세요.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <Link href="/restaurants" className="btn-primary">
          맛집 목록
        </Link>
      </div>
    </div>
  );
}
