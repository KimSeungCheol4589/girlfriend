/**
 * Vitest(node)에서 서버 전용 모듈을 직접 불러오기 위한 빈 모듈.
 * `server-only` 패키지는 react-server 조건이 아니면 import만으로 예외를 던진다.
 * 앱 번들에서는 쓰이지 않는다(tests/memories/vitest.config.ts의 alias로만 연결).
 */
export {};
