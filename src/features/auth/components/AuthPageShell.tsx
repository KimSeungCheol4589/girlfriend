import Link from 'next/link';
import type { ReactNode } from 'react';

/**
 * 로그인·초대·온보딩처럼 아직 공간이 없는 화면의 껍데기.
 * 메뉴 없이 가운데 카드 하나만 보여 준다. 앱의 색·여백 규칙은 그대로 따른다.
 */
export function AuthPageShell({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <main id="main" className="app-container flex min-h-dvh flex-col justify-center py-10">
      <div className="mx-auto w-full max-w-md">
        <p className="mb-6 text-center text-sm font-semibold tracking-tight text-muted">
          둘이 쌓는 공간
        </p>

        <section className="app-card px-5 py-7 sm:px-7">
          <h1 className="text-xl font-bold text-text">{title}</h1>
          {description ? (
            <p className="mt-2 text-sm leading-relaxed text-muted">{description}</p>
          ) : null}
          <div className="mt-6">{children}</div>
        </section>

        {footer ? <div className="mt-4 text-center text-xs text-muted">{footer}</div> : null}
      </div>
    </main>
  );
}

/**
 * 데모 모드에서 인증 화면에 들어왔을 때. 로그인한 것처럼 보이게 하지 않는다.
 * 데모 껍데기가 이미 `<main>`을 그리므로 여기서는 카드만 그린다.
 */
export function DemoModeAuthNotice({ title }: { title: string }) {
  return (
    <section className="app-card px-5 py-7 sm:px-7">
      <span className="chip bg-accent-soft text-text">데모 모드</span>
      <h1 className="mt-3 text-xl font-bold text-text">{title}</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        지금 이 앱은 데모 모드로 실행 중입니다. 계정·세션·서버 저장이 없으므로 이 화면은 동작하지
        않습니다.
      </p>
      <p className="mt-4 text-sm leading-relaxed text-muted">
        실제 로그인을 쓰려면 Supabase 환경 변수를 설정하고 데모 모드를 끈 뒤 앱을 다시 시작해야
        합니다. 설정 방법은 저장소의 <code className="font-mono text-xs">.env.example</code>과 인증
        설정 문서를 참고해 주세요.
      </p>
      <Link href="/" className="btn-secondary mt-6">
        데모 홈으로
      </Link>
    </section>
  );
}
