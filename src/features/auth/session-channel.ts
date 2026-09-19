/**
 * 같은 브라우저의 다른 탭에 "로그아웃됨"을 알린다.
 *
 * 왜 필요한가: 로그아웃은 **서버 액션이 쿠키를 지우는 방식**이다. 쿠키 저장소에는 탭 간 알림이
 * 없어서 다른 탭의 Supabase 브라우저 클라이언트는 `SIGNED_OUT`을 받지 못한다.
 * 그래서 "로그아웃하면 보관한 초대 토큰을 지운다"는 약속이 그 탭에서 지켜지지 않았고,
 * 열려 있던 개인 화면도 그대로 남아 있었다(독립 검토 지적 6).
 *
 * 규칙:
 *   - **서버가 로그아웃을 끝낸 뒤에만** 알린다(로그인 화면으로 돌아온 시점).
 *   - 알림에는 비밀이 없다. 종류와 시각뿐이다.
 *   - 같은 출처 안에서만 전달한다(BroadcastChannel, 없으면 localStorage 이벤트).
 *   - 알림은 화면 정리용이다. **접근 차단은 여전히 화면마다 서버가 확인한다.**
 */

export const SESSION_CHANNEL_NAME = 'gf.auth.session';
export const SESSION_SIGNAL_STORAGE_KEY = 'gf.auth.signal';

export type SessionSignal = { type: 'signed-out'; at: number };

export function createSignedOutSignal(now: number = Date.now()): SessionSignal {
  return { type: 'signed-out', at: now };
}

/** 받은 값이 우리가 보낸 신호인지 확인한다. 그 밖의 메시지는 무시한다. */
export function parseSessionSignal(raw: unknown): SessionSignal | null {
  if (raw === null || typeof raw !== 'object') return null;
  const { type, at } = raw as Partial<SessionSignal>;
  if (type !== 'signed-out') return null;
  if (typeof at !== 'number' || !Number.isFinite(at)) return null;
  return { type, at };
}

export function parseSessionSignalJson(raw: string | null): SessionSignal | null {
  if (!raw) return null;
  try {
    return parseSessionSignal(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** 로그아웃 완료를 다른 탭에 알린다. 브라우저에서만 동작한다. */
export function broadcastSignedOut(now: number = Date.now()): void {
  if (typeof window === 'undefined') return;
  const signal = createSignedOutSignal(now);

  try {
    if (typeof BroadcastChannel === 'function') {
      const channel = new BroadcastChannel(SESSION_CHANNEL_NAME);
      channel.postMessage(signal);
      channel.close();
    }
  } catch {
    // 지원하지 않는 브라우저. 아래 저장소 신호로 대신한다.
  }

  try {
    // storage 이벤트는 **다른 탭에서만** 발생한다. 값이 매번 달라야 이벤트가 보장된다.
    window.localStorage.setItem(SESSION_SIGNAL_STORAGE_KEY, JSON.stringify(signal));
  } catch {
    // 저장소를 쓸 수 없는 브라우저. BroadcastChannel만으로 동작한다.
  }
}

/** 다른 탭의 로그아웃 알림을 구독한다. 정리 함수를 돌려준다. */
export function subscribeSignedOut(handler: () => void): () => void {
  if (typeof window === 'undefined') return () => {};

  const cleanups: (() => void)[] = [];

  try {
    if (typeof BroadcastChannel === 'function') {
      const channel = new BroadcastChannel(SESSION_CHANNEL_NAME);
      channel.onmessage = (event: MessageEvent) => {
        if (parseSessionSignal(event.data)) handler();
      };
      cleanups.push(() => channel.close());
    }
  } catch {
    // 무시하고 저장소 이벤트만 쓴다.
  }

  const onStorage = (event: StorageEvent) => {
    if (event.key !== SESSION_SIGNAL_STORAGE_KEY) return;
    if (parseSessionSignalJson(event.newValue)) handler();
  };
  window.addEventListener('storage', onStorage);
  cleanups.push(() => window.removeEventListener('storage', onStorage));

  return () => {
    for (const cleanup of cleanups) cleanup();
  };
}
