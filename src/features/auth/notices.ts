/** 콜백이 붙여 보내는 오류 표시. 상세 사유·토큰은 쿼리에 싣지 않는다. */
export function authErrorMessage(value: unknown): string | null {
  if (value === 'link') {
    return '인증 링크가 만료됐거나 이미 사용됐습니다. 링크를 다시 요청해 주세요.';
  }
  if (value === 'config') {
    return '서버에 인증 설정이 없어 처리하지 못했습니다. 운영자에게 알려 주세요.';
  }
  return null;
}

export function firstParam(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}
