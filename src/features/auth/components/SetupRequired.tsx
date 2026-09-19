import type { SupabaseConfigProblem } from '@/lib/supabase/config';

import { AuthPageShell } from './AuthPageShell';

const ISSUE_LABELS: Record<SupabaseConfigProblem['issue'], string> = {
  missing: '값이 없습니다',
  placeholder: '예시 값 그대로입니다',
  invalid: '형식이 올바르지 않습니다',
};

/**
 * 설정이 없을 때의 화면.
 *
 * 로그인 성공이나 데모로 조용히 넘어가지 않는다. 무엇이 없는지 **이름만** 알려 주고
 * 값은 절대 화면에 쓰지 않는다.
 */
export function SetupRequired({ problems }: { problems: SupabaseConfigProblem[] }) {
  return (
    <AuthPageShell
      title="설정이 필요합니다"
      description="이 앱을 실제로 쓰려면 Supabase 연결 설정이 있어야 합니다. 설정이 없으면 로그인·공간·초대 기능을 사용할 수 없습니다."
    >
      <h2 className="text-sm font-bold text-text">확인할 환경 변수</h2>
      <ul className="mt-2 space-y-1.5">
        {problems.map((problem) => (
          <li key={problem.variable} className="flex gap-2 text-sm leading-relaxed text-muted">
            <span aria-hidden className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
            <span>
              <code className="font-mono text-xs text-text">{problem.variable}</code> —{' '}
              {ISSUE_LABELS[problem.issue]}
            </span>
          </li>
        ))}
      </ul>

      <p className="mt-6 rounded-xl bg-surface-muted px-4 py-3 text-xs leading-relaxed text-muted">
        저장소의 <code className="font-mono">.env.example</code>을{' '}
        <code className="font-mono">.env.local</code>로 복사해 값을 채운 뒤 서버를 다시 시작해
        주세요. 실제 키는 저장소에 넣지 않습니다.
      </p>
    </AuthPageShell>
  );
}
