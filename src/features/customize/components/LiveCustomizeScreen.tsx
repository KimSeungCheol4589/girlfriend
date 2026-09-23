import { QueryFailure } from '@/features/memories/live/components/QueryFailure';
import { isPhotoPipelineConfigured } from '@/features/memories/server/service-client';

import { getPinCandidates, getSavedCustomization } from '../server/queries';

import { LiveCustomizeEditor } from './LiveCustomizeEditor';

/**
 * 실제 꾸미기 화면(서버).
 *
 * 저장된 설정을 사용자 세션 + RLS로 읽어 편집기에 넘긴다. 조회에 실패하면 기본값으로 편집을
 * 시작하지 않는다. 기본값에서 저장하면 상대가 저장해 둔 설정을 모른 채 덮어쓰게 된다.
 *
 * 고정 후보 조회만 실패하면 꾸미기 저장은 그대로 쓸 수 있게 두고, 그 패널만 실패를 알린다.
 */
export async function LiveCustomizeScreen({
  spaceName,
  introduction,
}: {
  spaceName: string;
  introduction: string;
}) {
  const [settings, pins] = await Promise.all([getSavedCustomization(), getPinCandidates()]);

  if (!settings.ok) {
    return <QueryFailure code={settings.code} title="꾸미기 설정을 불러오지 못했어요" />;
  }

  return (
    <LiveCustomizeEditor
      saved={settings.data}
      pinCandidates={pins.ok ? pins.data : null}
      pinFailureCode={pins.ok ? null : pins.code}
      // 서버 키가 없으면 새 커버 업로드만 막는다. 나머지 저장과 기존 커버 유지는 그대로 된다.
      photosEnabled={isPhotoPipelineConfigured()}
      spaceName={spaceName}
      introduction={introduction}
    />
  );
}
