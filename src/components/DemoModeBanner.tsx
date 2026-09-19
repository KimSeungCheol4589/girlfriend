'use client';

import { useDemoStore } from '@/lib/demo/demo-store';

/**
 * 데모 모드 고지. 로그인·공유 저장·사진 업로드가 아직 구현되지 않았음을 화면에서 분명히 밝힌다.
 * 이 문구는 기능이 실제로 연결될 때 제거한다.
 */
export function DemoModeBanner() {
  const { isDirty, resetDemo } = useDemoStore();

  return (
    <div className="border-b border-border bg-surface-muted">
      <div className="app-container flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
        <span className="inline-flex items-center rounded-pill bg-accent px-2.5 py-0.5 text-[11px] font-bold tracking-wide text-accent-contrast">
          데모 모드
        </span>
        <p className="text-xs leading-relaxed text-muted">
          화면 확인용 예시 데이터입니다. 로그인·사진 업로드·두 사람 공유 저장은 아직 만들지
          않았고, 이 화면에서 바꾼 내용은 <strong className="font-semibold text-text">브라우저 메모리에만</strong>{' '}
          남아 새로고침하면 사라집니다.
        </p>
        {isDirty ? (
          <button type="button" onClick={resetDemo} className="btn-quiet ml-auto !min-h-[32px] !px-3 text-xs">
            예시 데이터로 되돌리기
          </button>
        ) : null}
      </div>
    </div>
  );
}
