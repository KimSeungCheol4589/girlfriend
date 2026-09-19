import type { Metadata } from 'next';

import { UpcomingNotice } from '@/components/UpcomingNotice';
import { LivePageFrame } from '@/features/auth/components/LivePageFrame';
import { SettingsPanel } from '@/features/auth/components/SettingsPanel';
import { isDemoMode } from '@/features/auth/mode';

export const metadata: Metadata = {
  title: '설정',
};

export const dynamic = 'force-dynamic';

export default function SettingsPage() {
  if (isDemoMode()) {
    return (
      <UpcomingNotice
        title="설정"
        summary="닉네임, 공간 이름·소개·관계 시작일, 구성원과 초대를 관리하는 화면입니다. 데모 모드에는 계정이 없어 동작하지 않습니다."
        plannedItems={[
          '내 닉네임 수정',
          '공간 이름·한 줄 소개·관계 시작일 수정 (시작일은 미래 날짜를 거부)',
          '구성원 확인과 일회용 초대 링크 발급, 정원 두 명 제한 안내',
          '로그아웃과 개인 화면 상태 정리',
        ]}
        taskNote="이 화면의 실제 동작은 Supabase 설정을 넣고 데모 모드를 끈 뒤에 쓸 수 있습니다. 데모 모드에서는 로그인·세션이 없으므로 누구나 이 예시 화면을 볼 수 있습니다."
      />
    );
  }

  return <LivePageFrame path="/settings" render={(context) => <SettingsPanel context={context} />} />;
}
