import { describe, expect, it } from 'vitest';

import {
  PHOTO_REJECT_MESSAGES,
  classifyDecodeError,
  exceedsPixelLimit,
  fitWithin,
  mimeForDecodedFormat,
  sniffImageType,
} from '@/features/memories/live/image-policy';

function bytes(...parts: (number[] | string)[]): Uint8Array {
  const out: number[] = [];
  for (const part of parts) {
    if (typeof part === 'string') for (const char of part) out.push(char.charCodeAt(0));
    else out.push(...part);
  }
  return Uint8Array.from(out);
}

describe('sniffImageType — 헤더 MIME·확장자가 아니라 실제 바이트로 판별', () => {
  it('JPEG·PNG·WebP', () => {
    expect(sniffImageType(bytes([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffImageType(bytes([0x89], 'PNG', [0x0d, 0x0a, 0x1a, 0x0a]))).toBe('image/png');
    expect(sniffImageType(bytes('RIFF', [0, 0, 0, 0], 'WEBPVP8 '))).toBe('image/webp');
  });

  it('HEIC·AVIF 계열은 따로 알려 안내와 함께 거부한다', () => {
    expect(sniffImageType(bytes([0, 0, 0, 24], 'ftypheic'))).toBe('image/heic');
    expect(sniffImageType(bytes([0, 0, 0, 24], 'ftypmif1'))).toBe('image/heic');
  });

  it('GIF·알 수 없는 형식·짧은 입력', () => {
    expect(sniffImageType(bytes('GIF89a'))).toBe('image/gif');
    expect(sniffImageType(bytes('<svg xmlns='))).toBeNull();
    expect(sniffImageType(bytes([0xff, 0xd8]))).toBeNull();
    expect(sniffImageType(new Uint8Array())).toBeNull();
  });

  it('RIFF지만 WEBP가 아니면(WAV 등) 거부', () => {
    expect(sniffImageType(bytes('RIFF', [0, 0, 0, 0], 'WAVEfmt '))).toBeNull();
  });
});

describe('mimeForDecodedFormat', () => {
  it('허용 형식만 MIME으로 바꾼다', () => {
    expect(mimeForDecodedFormat('jpeg')).toBe('image/jpeg');
    expect(mimeForDecodedFormat('png')).toBe('image/png');
    expect(mimeForDecodedFormat('webp')).toBe('image/webp');
    expect(mimeForDecodedFormat('gif')).toBeNull();
    expect(mimeForDecodedFormat('heif')).toBeNull();
    expect(mimeForDecodedFormat('svg')).toBeNull();
    expect(mimeForDecodedFormat(undefined)).toBeNull();
  });
});

describe('exceedsPixelLimit — 40MP', () => {
  it('정확히 40,000,000은 허용, 넘으면 거부', () => {
    expect(exceedsPixelLimit(8000, 5000)).toBe(false);
    expect(exceedsPixelLimit(8000, 5001)).toBe(true);
  });

  it('0·음수·NaN은 거부', () => {
    expect(exceedsPixelLimit(0, 10)).toBe(true);
    expect(exceedsPixelLimit(-1, 10)).toBe(true);
    expect(exceedsPixelLimit(Number.NaN, 10)).toBe(true);
  });
});

describe('fitWithin — 긴 변 2,048px', () => {
  it('큰 사진은 비율을 유지해 줄인다', () => {
    expect(fitWithin(4032, 3024)).toEqual({ width: 2048, height: 1536 });
    expect(fitWithin(3024, 4032)).toEqual({ width: 1536, height: 2048 });
  });

  it('작은 사진은 확대하지 않는다', () => {
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
  });

  it('아주 긴 사진도 한 변이 1px 아래로 내려가지 않는다', () => {
    expect(fitWithin(100000, 10)).toEqual({ width: 2048, height: 1 });
  });
});

describe('classifyDecodeError', () => {
  it('픽셀 상한·미지원 형식·그 밖의 디코딩 실패', () => {
    expect(classifyDecodeError(new Error('Input image exceeds pixel limit'))).toBe('too_many_pixels');
    expect(classifyDecodeError(new Error('Input buffer contains unsupported image format'))).toBe(
      'unsupported_format',
    );
    expect(classifyDecodeError(new Error('VipsJpeg: Premature end of input file'))).toBe('decode_failed');
    expect(classifyDecodeError('string')).toBe('decode_failed');
  });

  it('모든 사유에 사용자 문장이 있다', () => {
    for (const message of Object.values(PHOTO_REJECT_MESSAGES)) {
      expect(message.length).toBeGreaterThan(0);
    }
  });
});
