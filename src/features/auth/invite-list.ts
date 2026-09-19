import { mapPostgrestError, type PostgresErrorLike } from './errors';

/**
 * 초대 목록 조회 결과.
 *
 * 조회에 실패했을 때 **빈 목록으로 보여 주지 않는다.** 활성 초대가 있는데도 "초대 없음"으로
 * 보이면, 사용자가 그 사실을 모른 채 새 초대를 만들어 이전 초대를 폐기하게 된다
 * (독립 검토 지적 7). 실패는 실패로 알리고 다시 시도하게 한다.
 *
 * 실패 메시지는 앱의 공통 매핑을 거친 문장만 쓴다. DB 원문·상세는 화면에 내보내지 않는다.
 */
export type InviteStatus = 'active' | 'accepted' | 'revoked' | 'expired';

export type InviteSummary = {
  inviteId: string;
  targetEmailMasked: string;
  status: InviteStatus;
  expiresAt: string;
  createdAt: string;
  acceptedAt: string | null;
};

export type InviteListResult =
  | { ok: true; invites: InviteSummary[] }
  | { ok: false; message: string };

type InviteRow = {
  invite_id: string;
  target_email_masked: string;
  status: string;
  expires_at: string;
  created_at: string;
  accepted_at: string | null;
};

const STATUSES: readonly InviteStatus[] = ['active', 'accepted', 'revoked', 'expired'];

function toStatus(value: string): InviteStatus {
  return (STATUSES as readonly string[]).includes(value) ? (value as InviteStatus) : 'expired';
}

/** `list_space_invites()` 응답을 화면에서 쓸 결과로 바꾼다. */
export function toInviteListResult(response: {
  data: unknown;
  error: PostgresErrorLike | null | undefined;
}): InviteListResult {
  if (response.error) {
    const failure = mapPostgrestError(response.error);
    return { ok: false, message: failure.message };
  }

  // 오류가 없는데 배열이 아니면 무엇이 왔는지 알 수 없다. 빈 목록으로 단정하지 않는다.
  if (!Array.isArray(response.data)) {
    return {
      ok: false,
      message: '초대 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.',
    };
  }

  const invites = (response.data as InviteRow[]).map((row) => ({
    inviteId: row.invite_id,
    targetEmailMasked: row.target_email_masked,
    status: toStatus(row.status),
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    acceptedAt: row.accepted_at,
  }));

  return { ok: true, invites };
}
