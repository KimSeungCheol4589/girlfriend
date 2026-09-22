import { createHash } from 'node:crypto';

import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { verifyMemoryPhoto } from '@/features/memories/server/image-verify';

import { syntheticPng, withExifOrientation6 } from '../support/local-api';

/**
 * 서버 확정 검증기(읽기 전용)의 실제 디코딩 검증. 입력 이미지는 테스트 안에서 만든다(실제 사진 없음).
 * 모의 디코더를 쓰지 않는다. 검증기는 입력을 바꾸거나 새 바이트를 만들지 않는다.
 */

async function solid(width: number, height: number, format: 'jpeg' | 'png' | 'webp'): Promise<Buffer> {
  const image = sharp({ create: { width, height, channels: 3, background: { r: 200, g: 120, b: 90 } } });
  if (format === 'jpeg') return image.jpeg({ quality: 80 }).toBuffer();
  if (format === 'png') return image.png().toBuffer();
  return image.webp({ quality: 80 }).toBuffer();
}

function sha(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

describe('verifyMemoryPhoto — 규칙에 맞는 파일', () => {
  it.each(['jpeg', 'png', 'webp'] as const)('%s: 실제 바이트 수·치수를 그대로 돌려주고 입력을 바꾸지 않는다', async (format) => {
    const input = await solid(640, 480, format);
    const before = sha(input);
    const result = await verifyMemoryPhoto(input, `image/${format}`);
    expect(result).toEqual({
      ok: true,
      photo: { bytes: input.byteLength, width: 640, height: 480, mime: `image/${format}` },
    });
    expect(sha(input)).toBe(before);
  });

  it('같은 파일은 항상 같은 결과(확정 페이로드가 결정적)', async () => {
    const input = await solid(300, 200, 'webp');
    expect(await verifyMemoryPhoto(input, 'image/webp')).toEqual(await verifyMemoryPhoto(input, 'image/webp'));
  });

  it('긴 변 정확히 2,048px은 허용', async () => {
    const input = await solid(2048, 100, 'png');
    expect((await verifyMemoryPhoto(input, 'image/png')).ok).toBe(true);
  });
});

describe('verifyMemoryPhoto — 거부(서버는 다시 인코딩하지 않는다)', () => {
  it('EXIF(방향 포함)가 남은 JPEG', async () => {
    const input = withExifOrientation6(await solid(400, 200, 'jpeg'));
    expect(await verifyMemoryPhoto(input, 'image/jpeg')).toEqual({ ok: false, reason: 'metadata_remaining' });
  });

  it('sharp로 EXIF를 붙인 WebP', async () => {
    const input = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#123456' } })
      .withExif({ IFD0: { Copyright: 'synthetic' } })
      .webp()
      .toBuffer();
    expect(await verifyMemoryPhoto(input, 'image/webp')).toEqual({ ok: false, reason: 'metadata_remaining' });
  });

  it('텍스트 청크가 든 PNG', async () => {
    const input = syntheticPng(32, 32, [1, 2, 3], 'GPS 37.5,127.0');
    expect(await verifyMemoryPhoto(input, 'image/png')).toEqual({ ok: false, reason: 'metadata_remaining' });
  });

  it('긴 변이 2,048px을 넘으면', async () => {
    const input = await solid(2049, 100, 'png');
    expect(await verifyMemoryPhoto(input, 'image/png')).toEqual({ ok: false, reason: 'dimensions_exceed' });
  });

  it('40MP를 넘으면', async () => {
    const input = await solid(8000, 5001, 'png');
    expect(await verifyMemoryPhoto(input, 'image/png')).toEqual({ ok: false, reason: 'too_many_pixels' });
  });

  it('선언과 실제 형식이 다르면', async () => {
    const png = await solid(64, 64, 'png');
    expect(await verifyMemoryPhoto(png, 'image/webp')).toEqual({ ok: false, reason: 'format_mismatch' });
  });

  it('잘린 JPEG·잘린 WebP', async () => {
    for (const format of ['jpeg', 'webp'] as const) {
      const full = await solid(640, 480, format);
      const truncated = full.subarray(0, Math.floor(full.length / 2));
      const result = await verifyMemoryPhoto(truncated, `image/${format}`);
      expect(result.ok, format).toBe(false);
      if (!result.ok) expect(['decode_failed', 'unsupported_format'], format).toContain(result.reason);
    }
  });

  it('HEIC 시그니처', async () => {
    const fakeHeic = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypheic', 'latin1'), Buffer.alloc(64)]);
    expect(await verifyMemoryPhoto(fakeHeic, 'image/jpeg')).toEqual({ ok: false, reason: 'heic' });
  });

  it('SVG·빈 파일·10MiB 초과', async () => {
    expect(await verifyMemoryPhoto(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'image/png')).toEqual({
      ok: false,
      reason: 'unsupported_format',
    });
    expect(await verifyMemoryPhoto(new Uint8Array(), 'image/png')).toEqual({ ok: false, reason: 'empty' });
    expect(await verifyMemoryPhoto(new Uint8Array(10 * 1024 * 1024 + 1), 'image/jpeg')).toEqual({
      ok: false,
      reason: 'too_large',
    });
  });

  it('움직이는 WebP', async () => {
    const frame = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#ff0000' } }).png().toBuffer();
    const other = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#00ff00' } }).png().toBuffer();
    const animated = await sharp([frame, other], { join: { animated: true } }).webp().toBuffer();
    expect((await sharp(animated).metadata()).pages).toBe(2);
    expect(await verifyMemoryPhoto(animated, 'image/webp')).toEqual({ ok: false, reason: 'animated' });
  });
});
