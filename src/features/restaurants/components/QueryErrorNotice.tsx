'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

import { ErrorNotice } from '@/components/ErrorNotice';

/**
 * 조회 실패 안내. 실패를 빈 목록이나 "없음"으로 바꾸지 않고 다시 시도를 제공한다(DESIGN 9).
 */
export function QueryErrorNotice({
  title = '불러오지 못했어요',
  message,
  unauthenticated = false,
  loginNext,
}: {
  title?: string;
  message: string;
  unauthenticated?: boolean;
  loginNext?: string;
}) {
  const router = useRouter();
  const [retrying, startRetry] = useTransition();

  return (
    <ErrorNotice title={title} description={message}>
      <div className="flex flex-wrap gap-2">
        {unauthenticated ? (
          <Link
            href={loginNext ? `/login?next=${encodeURIComponent(loginNext)}` : '/login'}
            className="btn-primary"
          >
            다시 로그인
          </Link>
        ) : (
          <button
            type="button"
            className="btn-primary"
            disabled={retrying}
            aria-busy={retrying}
            onClick={() => startRetry(() => router.refresh())}
          >
            {retrying ? '다시 불러오는 중…' : '다시 시도'}
          </button>
        )}
      </div>
    </ErrorNotice>
  );
}
