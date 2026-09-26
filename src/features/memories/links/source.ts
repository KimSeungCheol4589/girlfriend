import { isUuid } from '../live/ids';

import { MEMORY_LINK_SOURCES, isMemoryLinkSource, type MemoryLinkSource } from './constants';

/**
 * `?source=&sourceId=` 검색 매개변수 해석 — 순수 함수.
 *
 * 규칙(DATE-001)
 *   - URL에는 **enum과 UUID만** 넣는다. 제목·본문·메모·사진·날짜·장소는 절대 넣지 않는다.
 *   - 같은 이름이 두 번 들어오면(배열) **정규화하지 않고 거부**한다. 어느 쪽을 골랐는지
 *     사용자가 알 수 없는 상태로 진행하지 않는다.
 *   - 한쪽만 있거나 형식이 틀리면 거부한다. 거부는 "연결 없음"과 구분해서 안내한다.
 *   - 로그인 후 돌아올 경로에는 **여기서 정규화한 값만** 넣는다(원문을 그대로 쓰지 않는다).
 */

export type MemorySourceRef = {
  source: MemoryLinkSource;
  sourceId: string;
};

export type SourceQueryRejection = 'duplicate' | 'incomplete' | 'source' | 'sourceId';

export type SourceQueryParse =
  | { status: 'absent' }
  | { status: 'invalid'; reason: SourceQueryRejection }
  | { status: 'ok'; ref: MemorySourceRef };

export type RawSearchValue = string | string[] | undefined;

function single(raw: RawSearchValue): { kind: 'absent' } | { kind: 'duplicate' } | { kind: 'value'; value: string } {
  if (raw === undefined) return { kind: 'absent' };
  if (Array.isArray(raw)) {
    // 값이 정확히 하나뿐인 배열도 실제로는 한 번만 들어온 것과 같다.
    if (raw.length === 0) return { kind: 'absent' };
    if (raw.length > 1) return { kind: 'duplicate' };
    const only = raw[0];
    if (only === undefined) return { kind: 'absent' };
    return only.trim() === '' ? { kind: 'absent' } : { kind: 'value', value: only };
  }
  return raw.trim() === '' ? { kind: 'absent' } : { kind: 'value', value: raw };
}

export function parseSourceQuery(input: {
  source?: RawSearchValue;
  sourceId?: RawSearchValue;
}): SourceQueryParse {
  const source = single(input.source);
  const sourceId = single(input.sourceId);

  if (source.kind === 'duplicate' || sourceId.kind === 'duplicate') {
    return { status: 'invalid', reason: 'duplicate' };
  }
  if (source.kind === 'absent' && sourceId.kind === 'absent') return { status: 'absent' };
  if (source.kind === 'absent' || sourceId.kind === 'absent') {
    return { status: 'invalid', reason: 'incomplete' };
  }
  if (!isMemoryLinkSource(source.value)) return { status: 'invalid', reason: 'source' };
  if (!isUuid(sourceId.value)) return { status: 'invalid', reason: 'sourceId' };

  return { status: 'ok', ref: { source: source.value, sourceId: sourceId.value } };
}

/** 정규화한 검색 문자열(`?source=...&sourceId=...`). 값이 없으면 빈 문자열이다. */
export function buildSourceQuery(ref: MemorySourceRef | null): string {
  if (!ref) return '';
  const params = new URLSearchParams();
  params.set('source', ref.source);
  params.set('sourceId', ref.sourceId);
  return `?${params.toString()}`;
}

/**
 * 로그인 복귀용 경로.
 *
 * `LivePageFrame.path`에 그대로 넘긴다. 허용 목록(`/memories`)을 통과하면 검색 문자열이 유지되므로
 * 로그인 뒤에도 같은 원본으로 돌아온다. 거부된 query는 붙이지 않는다(잘못된 값을 되돌려주지 않는다).
 */
export function newMemoryPath(parse: SourceQueryParse): string {
  return parse.status === 'ok' ? `/memories/new${buildSourceQuery(parse.ref)}` : '/memories/new';
}

/** 기존 추억에 연결하는 화면의 경로. 재시도용으로 원본을 이어 붙일 수 있다. */
export function memoryLinkPath(memoryId: string, ref: MemorySourceRef | null = null): string {
  return `/memories/${memoryId}/link${buildSourceQuery(ref)}`;
}

/** 거부된 query의 안내 문장. 왜 연결 없이 시작하는지 사용자에게 분명히 알린다. */
export const SOURCE_REJECTION_MESSAGES: Record<SourceQueryRejection, string> = {
  duplicate:
    '주소에 연결 정보가 여러 번 들어 있어 어떤 계획인지 확정할 수 없었어요. 연결 없이 시작합니다. 일정·위시 화면에서 다시 들어와 주세요.',
  incomplete:
    '주소의 연결 정보가 온전하지 않아 원본을 찾지 못했어요. 연결 없이 시작합니다. 일정·위시 화면에서 다시 들어와 주세요.',
  source:
    '알 수 없는 연결 종류예요. 연결 없이 시작합니다. 일정·위시 화면에서 다시 들어와 주세요.',
  sourceId:
    '연결 정보의 형식이 올바르지 않아요. 연결 없이 시작합니다. 일정·위시 화면에서 다시 들어와 주세요.',
};

/** 선택할 수 있는 원본 종류(화면의 탭 순서와 같다). */
export const SOURCE_TABS = MEMORY_LINK_SOURCES;
