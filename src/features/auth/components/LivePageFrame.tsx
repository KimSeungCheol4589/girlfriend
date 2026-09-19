import type { ReactNode } from 'react';

import { requireMember, type MemberContext } from '../guards';

import { LiveAppShell } from './LiveAppShell';
import { SetupRequired } from './SetupRequired';

/**
 * 로그인·공간 소속이 필요한 화면의 공통 틀.
 *
 * 화면마다 서버에서 세션을 다시 확인한다(미들웨어 통과 여부에 기대지 않는다).
 * 설정이 없으면 "설정 필요"를 그리고, 비로그인·공간 없음은 각각 다른 화면으로 보낸다.
 */
export async function LivePageFrame({
  path,
  render,
}: {
  /** 로그인 후 돌아올 현재 경로. 허용 목록으로 검증한다. */
  path: string;
  render: (context: MemberContext) => ReactNode;
}) {
  const result = await requireMember(path);

  if (result.kind === 'unconfigured') {
    return <SetupRequired problems={result.problems} />;
  }

  return (
    <LiveAppShell spaceName={result.context.space.name} settings={result.context.settings}>
      {render(result.context)}
    </LiveAppShell>
  );
}
