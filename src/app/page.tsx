import { LiveHome } from '@/features/auth/components/LiveHome';
import { LivePageFrame } from '@/features/auth/components/LivePageFrame';
import type { MemberContext } from '@/features/auth/guards';
import { isDemoMode } from '@/features/auth/mode';
import { HomeCover } from '@/features/customize/components/HomeCover';
import { defaultHomeSections } from '@/features/customize/sections';
import { getSavedCustomization } from '@/features/customize/server/queries';
import { HomeView } from '@/features/home/components/HomeView';
import { LiveMemorySummary } from '@/features/home/components/LiveMemorySummary';

// 로그인 상태에 따라 내용이 달라진다. 정적으로 미리 만들지 않는다.
export const dynamic = 'force-dynamic';

/**
 * 저장된 꾸미기 설정을 홈에 연결한다(THEME-001).
 * 설정을 읽지 못하면 기본 순서·커버 없음으로 그린다. 홈은 읽기만 하므로 상대 설정을 덮어쓸 위험은 없다.
 */
async function LiveHomeWithCustomization({ context }: { context: MemberContext }) {
  const settings = await getSavedCustomization();
  const sections = settings.ok ? settings.data.sections : defaultHomeSections();
  const coverAssetId = settings.ok ? settings.data.coverAssetId : null;

  return (
    <LiveHome
      context={context}
      cover={
        coverAssetId ? (
          <HomeCover assetId={coverAssetId} alt={`${context.space.name} 커버 사진`} />
        ) : null
      }
      memorySummary={<LiveMemorySummary sections={sections} />}
    />
  );
}

export default async function HomePage() {
  // 데모 모드에서는 예시 데이터를 쓰는 데모 홈을 그대로 보여 준다.
  if (isDemoMode()) return <HomeView />;

  return <LivePageFrame path="/" render={(context) => <LiveHomeWithCustomization context={context} />} />;
}
