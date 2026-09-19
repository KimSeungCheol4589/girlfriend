/**
 * 로컬 Supabase Auth 관리 API 호출.
 *
 * 앱 코드가 아니라 **테스트 픽스처 전용**이다. 서비스 키는 이 파일에서만 쓰고
 * 어떤 출력에도 넣지 않는다. 앱은 사용자 세션과 RLS만 사용한다.
 *
 * 의존성을 더 넣지 않기 위해 supabase-js 대신 fetch를 직접 쓴다.
 */

import { isSyntheticEmail, fail } from './env.mjs';

function adminHeaders(serviceRoleKey) {
  return {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    'Content-Type': 'application/json',
  };
}

async function request(config, path, init = {}) {
  const response = await fetch(`${config.supabaseUrl}${path}`, {
    ...init,
    headers: { ...adminHeaders(config.serviceRoleKey), ...(init.headers ?? {}) },
  });

  if (!response.ok) {
    // 응답 본문에 토큰이 들어갈 수 있으므로 상태 코드와 경로만 남긴다.
    fail(`Auth 관리 API 실패: ${init.method ?? 'GET'} ${path} → HTTP ${response.status}`);
  }

  if (response.status === 204) return null;
  const text = await response.text();
  if (text.length === 0) return null;
  return JSON.parse(text);
}

/** 이메일 확인이 끝난 합성 계정을 만든다. 이미 있으면 비밀번호만 바꾼다. */
export async function ensureUser(config, email, password) {
  if (!isSyntheticEmail(email)) fail('합성 계정(.invalid) 이메일만 만들 수 있습니다.');

  const existing = await findUserByEmail(config, email);
  if (existing) {
    await request(config, `/auth/v1/admin/users/${existing.id}`, {
      method: 'PUT',
      body: JSON.stringify({ password, email_confirm: true }),
    });
    return existing.id;
  }

  const created = await request(config, '/auth/v1/admin/users', {
    method: 'POST',
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  return created?.id ?? null;
}

export async function findUserByEmail(config, email) {
  const target = email.toLowerCase();
  for (let page = 1; page <= 20; page += 1) {
    const result = await request(config, `/auth/v1/admin/users?page=${page}&per_page=200`);
    const users = result?.users ?? [];
    const match = users.find((user) => (user.email ?? '').toLowerCase() === target);
    if (match) return match;
    if (users.length < 200) return null;
  }
  return null;
}

/** 합성 계정만 지운다. 다른 계정이면 멈춘다. */
export async function deleteUserByEmail(config, email) {
  if (!isSyntheticEmail(email)) fail('합성 계정(.invalid)만 삭제할 수 있습니다.');

  const user = await findUserByEmail(config, email);
  if (!user) return false;

  await request(config, `/auth/v1/admin/users/${user.id}`, { method: 'DELETE' });
  return true;
}
