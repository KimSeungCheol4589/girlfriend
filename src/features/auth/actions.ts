'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { isSupabaseConfigError } from '@/lib/supabase/config';
import { createSupabaseServerClient, getVerifiedUser } from '@/lib/supabase/server';

import {
  failure,
  logFailure,
  mapAuthError,
  mapPostgrestError,
  messageForCode,
  type ActionFailure,
} from './errors';
import { buildInviteLink } from './invite-token';
import { buildAuthRedirectUrl, resolveAppOrigin, safeNextPath } from './redirects';
import { isRequestId, newRequestId } from './request-id';
import {
  inviteCreateSchema,
  inviteTokenSchema,
  newPasswordSchema,
  passwordResetRequestSchema,
  profileSchema,
  signInSchema,
  spaceProfileSchema,
  toNullableDate,
  validateWith,
  type FieldErrorMap,
} from './schemas';

import type { AuthFormState } from './form-state';

/**
 * 인증·공간 Server Action.
 *
 * 공통 규칙
 *   - 사용자·공간은 서버가 세션에서 확인한다. 클라이언트가 보낸 ID를 신뢰하지 않는다.
 *   - 변경은 전용 RPC로만 한다. 테이블 직접 쓰기 권한은 어떤 역할에도 없다.
 *   - 실패는 코드·메시지로 돌려주고, 로그에는 작업명과 코드만 남긴다.
 *   - 초대 토큰·비밀번호·이메일은 로그·리다이렉트 쿼리에 넣지 않는다.
 */

function toFormState(result: ActionFailure): AuthFormState {
  const state: AuthFormState = {
    status: 'error',
    code: result.code,
    message: result.message,
  };
  if (result.fieldErrors) {
    state.fieldErrors = result.fieldErrors;
    state.firstField = Object.keys(result.fieldErrors)[0] ?? null;
  }
  return state;
}

function validationState(fieldErrors: FieldErrorMap, firstField: string | null): AuthFormState {
  return {
    status: 'error',
    code: 'VALIDATION_ERROR',
    message: messageForCode('VALIDATION_ERROR'),
    fieldErrors,
    firstField,
  };
}

const CONFIG_STATE: AuthFormState = {
  status: 'error',
  code: 'CONFIG_ERROR',
  message: messageForCode('CONFIG_ERROR'),
};

async function getClient() {
  try {
    return { ok: true as const, client: await createSupabaseServerClient() };
  } catch (error) {
    if (isSupabaseConfigError(error)) return { ok: false as const };
    throw error;
  }
}

/** 요청 키는 클라이언트가 만든다. 형식이 맞지 않으면 서버가 새로 만든다. */
function readRequestId(formData: FormData): string {
  const raw = formData.get('requestId');
  return isRequestId(raw) ? raw : newRequestId();
}

function readField(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
}

/** 인증 메일 링크가 돌아올 절대 주소의 출처. */
async function getRequestOrigin(): Promise<string> {
  const headerList = await headers();
  const origin = headerList.get('origin');
  if (origin) return origin;

  const host = headerList.get('x-forwarded-host') ?? headerList.get('host') ?? 'localhost:3000';
  const proto = headerList.get('x-forwarded-proto') ?? 'http';
  return `${proto}://${host}`;
}

// ---------------------------------------------------------------------------
// 로그인 / 로그아웃 / 비밀번호
// ---------------------------------------------------------------------------

export async function signInAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = validateWith(signInSchema, {
    email: readField(formData, 'email'),
    password: readField(formData, 'password'),
  });
  if (!parsed.ok) return validationState(parsed.fieldErrors, parsed.firstField);

  const next = safeNextPath(formData.get('next'));

  const client = await getClient();
  if (!client.ok) return CONFIG_STATE;

  const { error } = await client.client.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error) {
    const result = mapAuthError(error);
    logFailure('signIn', result);
    return toFormState(result);
  }

  // 로그인 성공 후에는 서버 렌더 결과를 새로 만든다(이전 사용자 화면 재사용 방지).
  revalidatePath('/', 'layout');
  redirect(next);
}

export async function signOutAction(): Promise<void> {
  const client = await getClient();
  if (client.ok) {
    // 이 브라우저 세션만 종료한다. 다른 기기의 로그인은 유지한다.
    await client.client.auth.signOut({ scope: 'local' });
  }
  revalidatePath('/', 'layout');
  redirect('/login?signedOut=1');
}

export async function requestPasswordResetAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = validateWith(passwordResetRequestSchema, { email: readField(formData, 'email') });
  if (!parsed.ok) return validationState(parsed.fieldErrors, parsed.firstField);

  const client = await getClient();
  if (!client.ok) return CONFIG_STATE;

  const redirectTo = buildAuthRedirectUrl({
    requestOrigin: await getRequestOrigin(),
    siteUrl: process.env.NEXT_PUBLIC_SITE_URL,
    path: '/auth/callback',
    next: '/reset-password',
  });

  const { error } = await client.client.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo,
  });

  if (error) {
    const result = mapAuthError(error);
    logFailure('requestPasswordReset', result);
    // 계정 존재 여부를 알리지 않는다. 발송 한도 등 재시도 가능한 오류만 그대로 알린다.
    if (result.code === 'RETRYABLE_ERROR') return toFormState(result);
  }

  return {
    status: 'success',
    message:
      '재설정 안내를 보냈습니다. 등록된 계정이라면 메일이 도착합니다. 메일의 링크를 열어 새 비밀번호를 정해 주세요.',
  };
}

export async function updatePasswordAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = validateWith(newPasswordSchema, {
    password: readField(formData, 'password'),
    passwordConfirm: readField(formData, 'passwordConfirm'),
  });
  if (!parsed.ok) return validationState(parsed.fieldErrors, parsed.firstField);

  const client = await getClient();
  if (!client.ok) return CONFIG_STATE;

  const user = await getVerifiedUser(client.client);
  if (!user) {
    return toFormState(
      failure(
        'UNAUTHENTICATED',
        '비밀번호를 바꿀 수 있는 세션이 없습니다. 메일의 재설정 링크를 다시 열어 주세요.',
      ),
    );
  }

  const { error } = await client.client.auth.updateUser({ password: parsed.data.password });
  if (error) {
    const result = mapAuthError(error);
    logFailure('updatePassword', result);
    return toFormState(result);
  }

  revalidatePath('/', 'layout');
  redirect('/?passwordUpdated=1');
}

// ---------------------------------------------------------------------------
// 공간 생성 / 초대
// ---------------------------------------------------------------------------

export async function createSpaceAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = validateWith(spaceProfileSchema, {
    name: readField(formData, 'name'),
    introduction: readField(formData, 'introduction'),
    relationshipStartDate: readField(formData, 'relationshipStartDate'),
  });
  if (!parsed.ok) return validationState(parsed.fieldErrors, parsed.firstField);

  const client = await getClient();
  if (!client.ok) return CONFIG_STATE;

  const requestId = readRequestId(formData);
  const { error } = await client.client.rpc('create_space', {
    p_name: parsed.data.name,
    p_introduction: parsed.data.introduction,
    p_relationship_start_date: toNullableDate(parsed.data.relationshipStartDate),
    p_request_id: requestId,
  });

  if (error) {
    const result = mapPostgrestError(error);
    logFailure('createSpace', result, requestId);
    return toFormState(result);
  }

  revalidatePath('/', 'layout');
  redirect('/');
}

export async function createInviteAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = validateWith(inviteCreateSchema, {
    targetEmail: readField(formData, 'targetEmail'),
  });
  if (!parsed.ok) return validationState(parsed.fieldErrors, parsed.firstField);

  const client = await getClient();
  if (!client.ok) return CONFIG_STATE;

  const requestId = readRequestId(formData);
  const { data, error } = await client.client.rpc('create_invite', {
    p_target_email: parsed.data.targetEmail,
    p_request_id: requestId,
  });

  if (error) {
    const result = mapPostgrestError(error);
    logFailure('createInvite', result, requestId);
    return toFormState(result);
  }

  const payload = (data ?? {}) as { token?: string | null; tokenIssued?: boolean };
  revalidatePath('/settings');

  if (!payload.tokenIssued || !payload.token) {
    // 같은 요청 키로 다시 부른 경우다. 토큰은 저장하지 않으므로 다시 만들 수 없다.
    return {
      status: 'error',
      code: 'CONFLICT',
      message:
        '이미 만든 초대의 링크는 다시 볼 수 없습니다. 링크를 잃어버렸다면 아래에서 초대를 새로 만들어 주세요. 새 초대를 만들면 이전 초대는 폐기됩니다.',
    };
  }

  const origin = resolveAppOrigin(process.env.NEXT_PUBLIC_SITE_URL, await getRequestOrigin());
  if (!origin) {
    return {
      status: 'error',
      code: 'CONFIG_ERROR',
      message:
        '초대는 만들었지만 링크 주소를 구성하지 못했습니다. 앱 주소(NEXT_PUBLIC_SITE_URL) 설정을 고친 뒤 초대를 다시 만들어 주세요. 이 초대의 링크는 다시 볼 수 없습니다.',
    };
  }

  const inviteLink = buildInviteLink(origin, payload.token);
  return {
    status: 'success',
    message: '초대 링크를 만들었습니다. 이 화면에서만 볼 수 있으니 지금 상대방에게 전달해 주세요.',
    inviteLink,
  };
}

export async function revokeInviteAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const inviteId = readField(formData, 'inviteId');
  if (inviteId.length === 0) {
    return validationState({ inviteId: '폐기할 초대를 찾지 못했습니다.' }, 'inviteId');
  }

  const client = await getClient();
  if (!client.ok) return CONFIG_STATE;

  const requestId = readRequestId(formData);
  const { error } = await client.client.rpc('revoke_invite', {
    p_invite_id: inviteId,
    p_request_id: requestId,
  });

  if (error) {
    const result = mapPostgrestError(error);
    logFailure('revokeInvite', result, requestId);
    return toFormState(result);
  }

  revalidatePath('/settings');
  return { status: 'success', message: '초대를 폐기했습니다. 이 링크는 더 이상 쓸 수 없습니다.' };
}

export async function acceptInviteAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = validateWith(inviteTokenSchema, { token: readField(formData, 'token') });
  if (!parsed.ok) {
    return {
      status: 'error',
      code: 'INVITE_INVALID',
      message:
        '초대 링크를 확인하지 못했습니다. 메일이나 메신저로 받은 링크를 다시 열어 주세요. 링크가 없다면 상대방에게 새 초대를 요청해 주세요.',
    };
  }

  const client = await getClient();
  if (!client.ok) return CONFIG_STATE;

  const requestId = readRequestId(formData);
  const { data, error } = await client.client.rpc('accept_invite', {
    p_token: parsed.data.token,
    p_request_id: requestId,
  });

  if (error) {
    const result = mapPostgrestError(error);
    // 토큰은 어떤 형태로도 로그에 남기지 않는다.
    logFailure('acceptInvite', result, requestId);
    return toFormState(result);
  }

  const payload = (data ?? {}) as { alreadyAccepted?: boolean };
  revalidatePath('/', 'layout');

  return {
    status: 'success',
    message: payload.alreadyAccepted
      ? '이미 참여한 공간입니다. 홈으로 이동합니다.'
      : '초대를 수락했습니다. 이제 두 사람이 같은 공간을 씁니다.',
    redirectTo: '/',
  };
}

// ---------------------------------------------------------------------------
// 설정
// ---------------------------------------------------------------------------

export async function updateProfileAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = validateWith(profileSchema, { nickname: readField(formData, 'nickname') });
  if (!parsed.ok) return validationState(parsed.fieldErrors, parsed.firstField);

  const client = await getClient();
  if (!client.ok) return CONFIG_STATE;

  const expectedVersion = Number.parseInt(readField(formData, 'expectedVersion'), 10);
  const requestId = readRequestId(formData);

  const { error } = await client.client.rpc('update_profile', {
    p_nickname: parsed.data.nickname,
    p_expected_version: Number.isFinite(expectedVersion) ? expectedVersion : 0,
    p_request_id: requestId,
  });

  if (error) {
    const result = mapPostgrestError(error);
    logFailure('updateProfile', result, requestId);
    return toFormState(result);
  }

  revalidatePath('/', 'layout');
  return { status: 'success', message: '닉네임을 저장했습니다.' };
}

export async function updateSpaceAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = validateWith(spaceProfileSchema, {
    name: readField(formData, 'name'),
    introduction: readField(formData, 'introduction'),
    relationshipStartDate: readField(formData, 'relationshipStartDate'),
  });
  if (!parsed.ok) return validationState(parsed.fieldErrors, parsed.firstField);

  const client = await getClient();
  if (!client.ok) return CONFIG_STATE;

  const expectedVersion = Number.parseInt(readField(formData, 'expectedVersion'), 10);
  const requestId = readRequestId(formData);

  const { error } = await client.client.rpc('update_space', {
    p_name: parsed.data.name,
    p_introduction: parsed.data.introduction,
    p_relationship_start_date: toNullableDate(parsed.data.relationshipStartDate),
    p_expected_version: Number.isFinite(expectedVersion) ? expectedVersion : 0,
    p_request_id: requestId,
  });

  if (error) {
    const result = mapPostgrestError(error);
    logFailure('updateSpace', result, requestId);
    return toFormState(result);
  }

  revalidatePath('/', 'layout');
  return { status: 'success', message: '공간 정보를 저장했습니다.' };
}
