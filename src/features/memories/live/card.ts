import type { MemoryCardData } from '@/components/MemoryCard';

import { memoryPhotoUrl } from './constants';
import type { LiveMemory } from './types';

/** 실제 기록 → 카드. 사진은 인증된 사진 경로로만 가리킨다. */
export function toMemoryCardData(memory: LiveMemory): MemoryCardData {
  return {
    id: memory.id,
    title: memory.title,
    body: memory.body,
    memoryDate: memory.memoryDate,
    location: memory.location,
    tags: memory.tags,
    isPinned: memory.isPinned,
    photos: memory.photos.map((photo, index) => ({
      id: photo.assetId,
      src: memoryPhotoUrl(photo.assetId),
      alt: `${memory.title} 사진 ${index + 1}`,
    })),
  };
}
