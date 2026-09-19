import type { Metadata } from 'next';

import { UpcomingNotice } from '@/components/UpcomingNotice';

export const metadata: Metadata = {
  title: '설정',
};

export default function SettingsPage() {
  return (
    <UpcomingNotice
      title="설정"
      summary="닉네임, 공간 이름·소개·관계 시작일, 구성원과 초대를 관리하는 화면입니다. 로그인과 공간 권한이 붙은 뒤에 만듭니다."
      plannedItems={[
        '내 닉네임 수정',
        '공간 이름·한 줄 소개·관계 시작일 수정 (시작일은 미래 날짜를 거부)',
        '구성원 확인과 일회용 초대 링크 발급, 정원 두 명 제한 안내',
        '로그아웃과 개인 화면 상태 정리',
      ]}
      taskNote="이 화면은 AUTH-001 이후 작업에서 만듭니다. 지금은 로그인·초대·세션이 전혀 구현되어 있지 않아 누구나 이 데모 화면을 볼 수 있습니다."
    />
  );
}
