import { MEMORY_PHOTO_MAX_EDGE, MEMORY_PHOTO_MAX_PIXELS, type MemoryUploadMime } from './constants';

/**
 * 사진 검증 규칙 중 라이브러리 없이 판단할 수 있는 부분(순수 함수).
 *
 * 서버 확정 검증기(`server/image-verify.ts`)와 브라우저 전처리(`client-image.ts`)가 함께 쓴다.
 * 정규화(방향·축소·재인코딩·EXIF 제거)는 브라우저가 첫 업로드 **전에** 하고, 서버는 결과를 읽기만 해 검증한다.
 * 파일 헤더의 MIME·확장자는 신뢰하지 않는다. 실제 바이트의 시그니처를 본다.
 */

export type SniffedImageType = MemoryUploadMime | 'image/heic' | 'image/gif' | null;

function ascii(bytes: Uint8Array, start: number, length: number): string {
  let text = '';
  for (let i = start; i < start + length && i < bytes.length; i += 1) {
    text += String.fromCharCode(bytes[i] ?? 0);
  }
  return text;
}

const HEIF_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1', 'avif']);

/** 파일 앞부분 바이트로 형식을 판별한다. 모르는 형식이면 null. */
export function sniffImageType(bytes: Uint8Array): SniffedImageType {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    ascii(bytes, 1, 3) === 'PNG' &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') {
    return 'image/webp';
  }
  if (bytes.length >= 12 && ascii(bytes, 4, 4) === 'ftyp' && HEIF_BRANDS.has(ascii(bytes, 8, 4))) {
    return 'image/heic';
  }
  if (bytes.length >= 6 && (ascii(bytes, 0, 6) === 'GIF87a' || ascii(bytes, 0, 6) === 'GIF89a')) {
    return 'image/gif';
  }
  return null;
}

/** sharp의 `format` 이름 → 업로드 MIME. 허용하지 않는 형식이면 null. */
export function mimeForDecodedFormat(format: string | undefined): MemoryUploadMime | null {
  if (format === 'jpeg' || format === 'jpg') return 'image/jpeg';
  if (format === 'png') return 'image/png';
  if (format === 'webp') return 'image/webp';
  return null;
}

export function exceedsPixelLimit(width: number, height: number, limit = MEMORY_PHOTO_MAX_PIXELS): boolean {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) return true;
  return width * height > limit;
}

/** 긴 변을 `maxEdge` 이하로 줄인 크기. 이미 작으면 그대로 둔다(확대하지 않는다). */
export function fitWithin(
  width: number,
  height: number,
  maxEdge = MEMORY_PHOTO_MAX_EDGE,
): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return { width, height };
  const scale = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** 확정 실패 사유. 사용자 문장과 1:1로 대응한다. 내부 오류 원문은 담지 않는다. */
export type PhotoRejectReason =
  | 'empty'
  | 'too_large'
  | 'format_mismatch'
  | 'unsupported_format'
  | 'heic'
  | 'animated'
  | 'too_many_pixels'
  | 'dimensions_exceed'
  | 'decode_failed'
  | 'metadata_remaining'
  | 'reencode_failed';

export const PHOTO_REJECT_MESSAGES: Record<PhotoRejectReason, string> = {
  empty: '빈 파일이라 올릴 수 없어요.',
  too_large: '파일 하나는 10MB까지 올릴 수 있어요.',
  format_mismatch: '파일 형식이 확인한 내용과 달라요. 사진을 다시 골라 주세요.',
  unsupported_format: 'JPEG·PNG·WebP 이미지만 올릴 수 있어요.',
  heic: 'iPhone HEIC 사진은 아직 지원하지 않아요. JPEG·PNG·WebP로 바꿔서 올려 주세요.',
  animated: '움직이는 이미지는 올릴 수 없어요. 한 장짜리 사진을 골라 주세요.',
  too_many_pixels: '4천만 화소를 넘는 사진은 올릴 수 없어요.',
  dimensions_exceed: '긴 변이 2,048px를 넘는 사진은 받지 않아요. 사진을 다시 골라 주세요.',
  decode_failed: '사진을 읽지 못했어요. 손상된 파일일 수 있어요.',
  metadata_remaining: '사진 정보(위치 등)가 남아 있어 올리지 않았어요. 사진을 다시 골라 주세요.',
  reencode_failed: '사진을 변환하지 못했어요. 다른 사진을 골라 주세요.',
};

/**
 * sharp 오류를 사유로 바꾼다. 메시지 원문은 로그·화면에 쓰지 않고 분류에만 쓴다.
 * (라이브러리 메시지 형식에 기대는 유일한 곳이다. 모르면 decode_failed로 둔다.)
 */
export function classifyDecodeError(error: unknown): PhotoRejectReason {
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  if (message.includes('pixel limit')) return 'too_many_pixels';
  if (message.includes('unsupported image format')) return 'unsupported_format';
  return 'decode_failed';
}
