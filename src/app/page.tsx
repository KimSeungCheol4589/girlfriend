import { LiveHome } from '@/features/auth/components/LiveHome';
import { LivePageFrame } from '@/features/auth/components/LivePageFrame';
import { isDemoMode } from '@/features/auth/mode';
import { HomeView } from '@/features/home/components/HomeView';
import { LiveMemorySummary } from '@/features/home/components/LiveMemorySummary';

// 로그인 상태에 따라 내용이 달라진다. 정적으로 미리 만들지 않는다.
export const dynamic = 'force-dynamic';

export default async function HomePage() {
  // 데모 모드에서는 예시 데이터를 쓰는 데모 홈을 그대로 보여 준다.
  if (isDemoMode()) return <HomeView />;

  return (
    <LivePageFrame
      path="/"
      render={(context) => <LiveHome context={context} memorySummary={<LiveMemorySummary />} />}
    />
  );
}
