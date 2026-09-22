/**
 * UUID 형식 검사.
 *
 * URL의 기록 ID·asset ID는 DB에 보내기 전에 형식부터 확인한다.
 * 형식이 틀린 값도 "없음"과 같은 404로 다룬다(존재 여부를 구분해 알리지 않는다).
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

export { UUID_PATTERN };
