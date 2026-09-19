import type { Metadata } from 'next';

import { LivePageFrame } from '@/features/auth/components/LivePageFrame';
import { LivePendingFeature } from '@/features/auth/components/LivePendingFeature';
import { isDemoMode } from '@/features/auth/mode';
import { CustomizeView } from '@/features/customization/components/CustomizeView';

export const metadata: Metadata = {
  title: '꾸미기',
};

export const dynamic = 'force-dynamic';

export default function CustomizePage() {
  if (isDemoMode()) return <CustomizeView />;

  return (
    <LivePageFrame
      path="/customize"
      render={() => (
        <LivePendingFeature
          title="꾸미기"
          summary="테마·포인트 색상·커버·홈 섹션 구성을 두 사람이 함께 쓰는 설정으로 저장하는 화면입니다. 실제 저장은 아직 만들지 않았습니다."
          plannedItems={[
            '테마 3종과 포인트 색상 저장 (space_settings)',
            '커버 이미지 업로드와 이전 커버 정리',
            '홈 섹션 순서·표시 여부 저장과 미리보기',
            '동시 수정 시 버전 충돌 안내',
          ]}
          taskNote="이 화면은 THEME-001 작업에서 만듭니다. 지금 화면에 적용된 테마는 공간 설정에 저장된 값입니다."
        />
      )}
    />
  );
}
