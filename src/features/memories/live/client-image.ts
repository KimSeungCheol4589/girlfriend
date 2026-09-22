'use client';

import { MEMORY_PHOTO_MAX_BYTES, type MemoryUploadMime } from './constants';
import { fitWithin, sniffImageType, PHOTO_REJECT_MESSAGES } from './image-policy';

/**
 * 브라우저 전처리(DESIGN.md 8.2의 1~2단계).
 *
 * - 파일 앞부분 바이트로 형식을 다시 확인한다(선택 창의 MIME·확장자만 믿지 않는다). HEIC는 안내와 함께 거부.
 * - 방향 정보를 반영해 그린 뒤 긴 변 2,048px 이하로 줄여 WebP(지원 안 되면 JPEG)로 다시 인코딩한다.
 *   캔버스로 다시 그린 결과에는 EXIF(위치 등)가 남지 않는다.
 * - 이 결과가 Storage에 한 번만 올라가는 최종 파일이다(이후 아무도 덮어쓰지 않는다).
 *   서버 확정기는 이 파일을 믿지 않고 형식·치수·메타데이터 부재·전체 디코딩을 읽기 전용으로 검증한다.
 */

export type ProcessedPhoto = {
  blob: Blob;
  mime: MemoryUploadMime;
  width: number;
  height: number;
};

export type ProcessResult = { ok: true; photo: ProcessedPhoto } | { ok: false; message: string };

const QUALITY = 0.86;

async function sniffFile(file: Blob): Promise<ReturnType<typeof sniffImageType>> {
  const head = new Uint8Array(await file.slice(0, 32).arrayBuffer());
  return sniffImageType(head);
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), type, QUALITY));
}

async function decode(file: Blob): Promise<ImageBitmap | null> {
  try {
    // 'from-image': EXIF 방향을 반영해 그린다.
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    return null;
  }
}

export async function processPhotoForUpload(file: File): Promise<ProcessResult> {
  if (file.size === 0) return { ok: false, message: PHOTO_REJECT_MESSAGES.empty };
  if (file.size > MEMORY_PHOTO_MAX_BYTES) return { ok: false, message: PHOTO_REJECT_MESSAGES.too_large };

  const sniffed = await sniffFile(file);
  if (sniffed === 'image/heic') return { ok: false, message: PHOTO_REJECT_MESSAGES.heic };
  if (sniffed !== 'image/jpeg' && sniffed !== 'image/png' && sniffed !== 'image/webp') {
    return { ok: false, message: PHOTO_REJECT_MESSAGES.unsupported_format };
  }

  const bitmap = await decode(file);
  if (!bitmap) return { ok: false, message: PHOTO_REJECT_MESSAGES.decode_failed };

  try {
    const target = fitWithin(bitmap.width, bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = target.width;
    canvas.height = target.height;
    const context = canvas.getContext('2d');
    if (!context) return { ok: false, message: PHOTO_REJECT_MESSAGES.reencode_failed };

    context.drawImage(bitmap, 0, 0, target.width, target.height);
    let blob = await canvasToBlob(canvas, 'image/webp');
    let mime: MemoryUploadMime = 'image/webp';

    // WebP 인코딩을 지원하지 않는 브라우저는 PNG를 돌려준다. 그때는 흰 배경 JPEG로 만든다.
    if (!blob || blob.type !== 'image/webp') {
      context.globalCompositeOperation = 'destination-over';
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, target.width, target.height);
      blob = await canvasToBlob(canvas, 'image/jpeg');
      mime = 'image/jpeg';
      if (!blob || blob.type !== 'image/jpeg') {
        return { ok: false, message: PHOTO_REJECT_MESSAGES.reencode_failed };
      }
    }

    if (blob.size === 0) return { ok: false, message: PHOTO_REJECT_MESSAGES.reencode_failed };
    if (blob.size > MEMORY_PHOTO_MAX_BYTES) return { ok: false, message: PHOTO_REJECT_MESSAGES.too_large };

    return { ok: true, photo: { blob, mime, width: target.width, height: target.height } };
  } finally {
    bitmap.close();
  }
}
