'use client';

import Image from 'next/image';
import { useState } from 'react';

import { coverPhotoUrl } from '../constants';

/**
 * 홈 커버 사진.
 *
 * 저장된 커버가 있을 때만 그린다. 인증된 경로를 그대로 쓰고 이미지 최적화 서버를 거치지 않는다
 * (`no-store` 응답을 캐시하지 않기 위해). 불러오지 못하면 조용히 비워 테마 배경이 그대로 보이게 한다.
 * 어떤 사진이 와도 제목·소개 글이 읽히도록 밝은 막을 덮는다.
 */
export function HomeCover({ assetId, alt }: { assetId: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;

  return (
    <>
      {/* 검증에서 "커버가 아예 없는 것"과 "불러오지 못해 숨긴 것"을 구분할 수 있도록 표식을 둔다. */}
      <div data-testid="home-cover" className="absolute inset-0">
        <Image
          src={coverPhotoUrl(assetId)}
          alt={alt}
          fill
          unoptimized
          priority
          sizes="(min-width: 768px) 1120px, 100vw"
          className="object-cover"
          onError={() => setFailed(true)}
        />
      </div>
      <div
        aria-hidden
        className="absolute inset-0 bg-gradient-to-t from-[#fffdfa]/95 via-[#fffdfa]/60 to-[#fffdfa]/20"
      />
    </>
  );
}
