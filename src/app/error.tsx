'use client';

import { useEffect } from 'react';

import { ErrorNotice } from '@/components/ErrorNotice';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // DESIGN.md 11: 로그에는 상관관계 ID 수준만 남기고 본문·개인 정보를 넣지 않는다.
    console.error('[ui] render failed', error.digest ?? 'no-digest');
  }, [error]);

  return (
    <ErrorNotice
      title="화면을 그리는 중 문제가 생겼어요"
      description="잠시 후 다시 시도해 주세요. 계속 같은 화면이 나오면 아래 번호와 함께 알려 주세요."
      // digest는 같은 오류를 서로 짚어볼 때 쓸 수 있는 값이라 남긴다.
      // 그 외 내부 오류 코드는 일반 화면에 노출하지 않는다.
      code={error.digest ? `문의 번호 ${error.digest}` : undefined}
    >
      <button type="button" onClick={reset} className="btn-primary">
        다시 시도
      </button>
    </ErrorNotice>
  );
}
