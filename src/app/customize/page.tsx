import type { Metadata } from 'next';

import { LivePageFrame } from '@/features/auth/components/LivePageFrame';
import { isDemoMode } from '@/features/auth/mode';
import { CustomizeView } from '@/features/customization/components/CustomizeView';
import { LiveCustomizeScreen } from '@/features/customize/components/LiveCustomizeScreen';

export const metadata: Metadata = {
  title: '꾸미기',
};

export const dynamic = 'force-dynamic';

export default function CustomizePage() {
  // 데모 모드에서는 예시 저장소를 쓰는 데모 꾸미기 화면을 그대로 보여 준다(실제 저장과 섞지 않는다).
  if (isDemoMode()) return <CustomizeView />;

  return (
    <LivePageFrame
      path="/customize"
      render={(context) => (
        <LiveCustomizeScreen
          spaceName={context.space.name}
          introduction={context.space.introduction}
        />
      )}
    />
  );
}
