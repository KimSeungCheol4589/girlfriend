'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

import { ErrorNotice } from '@/components/ErrorNotice';

/**
 * 조회 실패 안내. 빈 목록으로 대신하지 않고 실패를 그대로 알린 뒤 다시 불러오게 한다.
 * `router.refresh()`는 서버에서 세션을 다시 확인하고 새로 조회한다.
 */
export function QueryFailure({
  title = '기록을 불러오지 못했어요',
  code,
}: {
  title?: string;
  code: 'UNAUTHENTICATED' | 'CONFIG_ERROR' | 'RETRYABLE_ERROR';
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const description =
    code === 'UNAUTHENTICATED'
      ? '로그인이 끝났습니다. 다시 로그인해 주세요.'
      : code === 'CONFIG_ERROR'
        ? '서버 설정이 없어 불러올 수 없습니다.'
        : '일시적인 문제일 수 있어요. 잠시 후 다시 불러와 주세요.';

  return (
    <ErrorNotice title={title} description={description}>
      {code === 'UNAUTHENTICATED' ? (
        <a href="/login" className="btn-secondary !min-h-[36px] text-xs">
          로그인 화면으로
        </a>
      ) : (
        <button
          type="button"
          className="btn-secondary !min-h-[36px] text-xs"
          disabled={pending}
          onClick={() => startTransition(() => router.refresh())}
        >
          {pending ? '다시 불러오는 중…' : '다시 불러오기'}
        </button>
      )}
    </ErrorNotice>
  );
}
