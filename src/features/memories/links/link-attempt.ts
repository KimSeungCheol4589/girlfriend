/**
 * "연결을 실제로 시도하는가"를 한 곳에서 정한다 — 순수 함수.
 *
 * 왜 따로 두는가(독립 검토 P1):
 *   저장 성공 뒤에 `savedMemory`를 두면 화면이 **부분 성공**(본문·사진은 저장됨, 연결만 남음)
 *   상태가 된다. 그 상태에서는 다시 제출하면 저장 대신 **연결**을 시도한다.
 *   그래서 이 값을 연결과 무관한 저장에서도 두면 두 가지가 잘못된다.
 *     1. 연결할 계획이 없는데 "연결만 다시 시도" 안내가 뜬다.
 *     2. 사용자가 "연결 없이 기록하기"를 골랐는데도 재시도 버튼으로 연결이 생긴다.
 *
 *   두 조건(연결 대상이 있다 / 사용자가 연결을 켜 두었다)을 두 곳에서 따로 판단하면
 *   한쪽만 고쳐져 다시 어긋난다. 한 함수로 묶고 테스트로 고정한다.
 */

export type LinkAttemptInput = {
  /** 이 화면이 들고 온 연결 대상(`?source=&sourceId=`)이 유효한가. */
  hasLink: boolean;
  /** 사용자가 "연결 없이 기록하기"로 끄지 않았는가. */
  linkEnabled: boolean;
};

/**
 * 연결을 시도할지 여부.
 *
 * 부분 성공 상태(`savedMemory`)로 들어가는 조건도 **이것과 같다**. 연결을 시도하지 않는 저장은
 * 부분 성공이 될 수 없기 때문이다.
 */
export function shouldAttemptLink({ hasLink, linkEnabled }: LinkAttemptInput): boolean {
  return hasLink && linkEnabled;
}
