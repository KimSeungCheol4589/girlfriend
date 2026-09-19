import { describe, expect, it } from 'vitest';

import { toInviteListResult } from '@/features/auth/invite-list';

const ROW = {
  invite_id: '11111111-1111-4111-8111-111111111111',
  target_email_masked: 'b*******@test.invalid',
  status: 'active',
  expires_at: '2026-09-21T00:00:00Z',
  created_at: '2026-09-20T00:00:00Z',
  accepted_at: null,
};

describe('toInviteListResult', () => {
  it('정상 응답을 목록으로 바꾼다', () => {
    const result = toInviteListResult({ data: [ROW], error: null });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.invites).toHaveLength(1);
    expect(result.invites[0]?.status).toBe('active');
    expect(result.invites[0]?.targetEmailMasked).toBe('b*******@test.invalid');
  });

  it('빈 배열은 "초대 없음"으로 그대로 둔다', () => {
    const result = toInviteListResult({ data: [], error: null });
    expect(result).toEqual({ ok: true, invites: [] });
  });

  it('조회 실패를 빈 목록으로 바꾸지 않는다', () => {
    const result = toInviteListResult({
      data: null,
      error: { code: '42501', message: 'permission denied for function list_space_invites' },
    });
    expect(result.ok).toBe(false);
  });

  it('실패 메시지에 DB 원문을 넣지 않는다', () => {
    const result = toInviteListResult({
      data: null,
      error: {
        code: '42501',
        message: 'permission denied for function list_space_invites',
        details: 'relation "space_invites" internal detail',
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).not.toContain('permission denied');
    expect(result.message).not.toContain('space_invites');
    expect(result.message.length).toBeGreaterThan(0);
  });

  it('재시도 가능한 실패는 재시도를 안내한다', () => {
    const result = toInviteListResult({
      data: null,
      error: { code: 'GF503', details: '{"requestId":"in_progress"}' },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('다시 시도');
  });

  it('오류가 없어도 배열이 아니면 실패로 다룬다', () => {
    expect(toInviteListResult({ data: null, error: null }).ok).toBe(false);
    expect(toInviteListResult({ data: undefined, error: undefined }).ok).toBe(false);
    expect(toInviteListResult({ data: { rows: [] }, error: null }).ok).toBe(false);
  });

  it('모르는 상태 값은 만료로 보수적으로 처리한다', () => {
    const result = toInviteListResult({ data: [{ ...ROW, status: 'weird' }], error: null });
    expect(result.ok && result.invites[0]?.status).toBe('expired');
  });
});
