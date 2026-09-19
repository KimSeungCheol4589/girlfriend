import {
  ACCEPTED_IMAGE_MIME_TYPES,
  MEMORY_LIMITS,
  REJECTED_IMAGE_MIME_TYPES,
} from '@/lib/contracts';

/**
 * 브라우저에서 고른 이미지 파일의 형식·용량 검사.
 * 추억 사진과 커버가 같은 규칙을 쓰도록 한곳에 둔다. DESIGN.md 1·8.2
 *
 * 여기서 통과해도 업로드하지 않는다. 현재는 브라우저 미리보기까지만 만든다.
 * 실제 업로드를 붙일 때 서버에서 같은 검사를 다시 해야 한다(헤더의 MIME만 믿지 않는다).
 */
export type ImageCandidate = {
  name: string;
  size: number;
  type: string;
};

const HEIC_EXTENSION_PATTERN = /\.(heic|heif)$/i;

/**
 * HEIC 판정.
 * 브라우저·OS에 따라 `.heic` 파일의 MIME이 빈 문자열로 오는 경우가 있어
 * 그때는 파일명 확장자로 보완한다. 그래야 일반 형식 오류 대신 HEIC 전용 안내가 나간다.
 */
function looksLikeHeic(candidate: ImageCandidate, mime: string): boolean {
  if ((REJECTED_IMAGE_MIME_TYPES as readonly string[]).includes(mime)) return true;
  if (mime.length > 0) return false;
  return HEIC_EXTENSION_PATTERN.test(candidate.name);
}

/** 문제가 있으면 사용자에게 보여 줄 이유를, 없으면 null을 돌려준다. */
export function checkImageCandidate(candidate: ImageCandidate): string | null {
  const mime = candidate.type.toLowerCase();

  if (looksLikeHeic(candidate, mime)) {
    return 'iPhone HEIC 사진은 아직 지원하지 않아요. JPEG·PNG·WebP로 바꿔서 올려 주세요.';
  }

  if (!(ACCEPTED_IMAGE_MIME_TYPES as readonly string[]).includes(mime)) {
    return 'JPEG·PNG·WebP 이미지만 올릴 수 있어요.';
  }

  if (candidate.size > MEMORY_LIMITS.photoBytesMax) {
    return '파일 하나는 10MB까지 올릴 수 있어요.';
  }

  return null;
}

/** 브라우저에서 만든 임시 미리보기 주소인지. 저장 계약에 넣으면 안 되는 값이다. */
export function isLocalPreviewUrl(url: string): boolean {
  return url.startsWith('blob:');
}
