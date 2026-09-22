import 'server-only';

import sharp, { type Metadata, type OutputInfo } from 'sharp';

import {
  MEMORY_PHOTO_MAX_BYTES,
  MEMORY_PHOTO_MAX_EDGE,
  MEMORY_PHOTO_MAX_PIXELS,
  type MemoryUploadMime,
} from '../live/constants';
import {
  classifyDecodeError,
  exceedsPixelLimit,
  mimeForDecodedFormat,
  sniffImageType,
  type PhotoRejectReason,
} from '../live/image-policy';

/**
 * 업로드된 사진의 **읽기 전용** 검증(DESIGN.md 8.2의 5단계).
 *
 * 정규화(방향 반영·긴 변 2,048px·재인코딩·EXIF 제거)는 브라우저가 첫 업로드 전에 한다.
 * 서버는 그 결과를 믿지 않고 실제 바이트를 끝까지 디코딩해 규칙을 지키는지만 확인한다.
 * **객체를 다시 쓰거나 덮어쓰지 않는다.** 그래서 재시도·동시 확정이 이미 확정된 바이트를 바꿀 수 없다.
 *
 *   1. 바이트 시그니처 = `prepare_upload` 때 선언한 형식(헤더 MIME·확장자 무시). HEIC·GIF·SVG 거부.
 *   2. sharp 메타데이터: 디코더 형식 = 선언 형식, 한 장(애니메이션 거부), 40MP 이하, 긴 변 2,048px 이하.
 *   3. 개인 정보가 될 수 있는 메타데이터(EXIF·XMP·IPTC·Photoshop·PNG 텍스트)가 있으면 거부.
 *      색 프로필(ICC)은 개인 정보가 아니므로 허용한다.
 *   4. 전체 픽셀 디코딩(`failOn: 'warning'`). 헤더만 멀쩡하고 본문이 깨진 파일은 여기서 실패한다.
 *
 * 결과 bytes/width/height는 저장된 객체 그대로의 실제 값이며 `finalize_upload`에 기록된다.
 * 같은 객체면 항상 같은 값이므로 확정 요청의 멱등 페이로드도 같다.
 */

export type VerifiedPhoto = {
  bytes: number;
  width: number;
  height: number;
  mime: MemoryUploadMime;
};

export type VerifyResult = { ok: true; photo: VerifiedPhoto } | { ok: false; reason: PhotoRejectReason };

const INPUT_OPTIONS = {
  limitInputPixels: MEMORY_PHOTO_MAX_PIXELS,
  failOn: 'warning' as const,
};

export function hasPrivateMetadata(meta: Metadata): boolean {
  return Boolean(
    meta.exif ||
      meta.xmp ||
      meta.iptc ||
      meta.tifftagPhotoshop ||
      meta.orientation !== undefined ||
      (meta.comments?.length ?? 0) > 0,
  );
}

export async function verifyMemoryPhoto(input: Uint8Array, declaredMime: MemoryUploadMime): Promise<VerifyResult> {
  if (input.byteLength === 0) return { ok: false, reason: 'empty' };
  if (input.byteLength > MEMORY_PHOTO_MAX_BYTES) return { ok: false, reason: 'too_large' };

  const sniffed = sniffImageType(input);
  if (sniffed === 'image/heic') return { ok: false, reason: 'heic' };
  if (sniffed === null || sniffed === 'image/gif') return { ok: false, reason: 'unsupported_format' };
  if (sniffed !== declaredMime) return { ok: false, reason: 'format_mismatch' };

  const buffer = Buffer.from(input.buffer, input.byteOffset, input.byteLength);

  let meta: Metadata;
  try {
    meta = await sharp(buffer, INPUT_OPTIONS).metadata();
  } catch (error) {
    return { ok: false, reason: classifyDecodeError(error) };
  }

  if (mimeForDecodedFormat(meta.format) !== declaredMime) return { ok: false, reason: 'format_mismatch' };
  if ((meta.pages ?? 1) > 1) return { ok: false, reason: 'animated' };
  if (exceedsPixelLimit(meta.width, meta.height)) return { ok: false, reason: 'too_many_pixels' };
  if (Math.max(meta.width, meta.height) > MEMORY_PHOTO_MAX_EDGE) return { ok: false, reason: 'dimensions_exceed' };
  if (hasPrivateMetadata(meta)) return { ok: false, reason: 'metadata_remaining' };

  let decoded: { info: OutputInfo };
  try {
    decoded = await sharp(buffer, INPUT_OPTIONS).raw().toBuffer({ resolveWithObject: true });
  } catch (error) {
    return { ok: false, reason: classifyDecodeError(error) };
  }
  if (decoded.info.width !== meta.width || decoded.info.height !== meta.height) {
    return { ok: false, reason: 'decode_failed' };
  }

  return {
    ok: true,
    photo: { bytes: input.byteLength, width: meta.width, height: meta.height, mime: declaredMime },
  };
}
