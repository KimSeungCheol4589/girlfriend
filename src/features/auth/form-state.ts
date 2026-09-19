import type { AuthErrorCode, FieldErrors } from './errors';

/**
 * 폼 상태. `useActionState`가 이 값을 그대로 다음 렌더에 넘긴다.
 *
 * Server Action 파일('use server')은 async 함수만 내보낼 수 있어 타입·상수를 여기 둔다.
 */
export type AuthFormState = {
  status: 'idle' | 'success' | 'error';
  message?: string;
  code?: AuthErrorCode;
  fieldErrors?: FieldErrors;
  /** 포커스를 옮길 첫 오류 필드 이름. */
  firstField?: string | null;
  /** 초대 생성 성공 시 한 번만 내려오는 링크. 서버 로그·DB에는 남지 않는다. */
  inviteLink?: string;
  /** 초대 수락 성공 시 이동할 경로. */
  redirectTo?: string;
};

export const idleFormState: AuthFormState = { status: 'idle' };
