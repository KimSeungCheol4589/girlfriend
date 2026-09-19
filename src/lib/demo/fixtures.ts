import { DEFAULT_ACCENT_COLOR } from '@/lib/contracts';
import type { DemoState } from '@/lib/demo/types';

/**
 * 데모용 합성 데이터다. 실제 사진·이메일·개인 정보를 포함하지 않는다.
 * 실제 서비스 데이터는 Supabase 연동(AUTH-001 이후)에서 가져온다. 이 파일은 그때 삭제 대상이다.
 */
export const DEMO_STATE: DemoState = {
  space: {
    name: '둘이 쌓는 공간',
    introduction: '사진 한 장과 짧은 문장으로 남기는 우리 기록.',
    relationshipStartDate: '2024-11-09',
  },
  customization: {
    themeKey: 'cream',
    accentColor: DEFAULT_ACCENT_COLOR,
    // 커버 업로드를 구현하기 전까지 항상 null이다.
    coverAssetId: null,
    sections: [
      { key: 'pinned', visible: true },
      { key: 'recentMemories', visible: true },
      { key: 'wishlist', visible: true },
    ],
  },
  coverPreview: null,
  memories: [
    {
      id: 'demo-memory-1',
      title: '한강 노을 산책',
      body: '퇴근하고 만나서 아무 계획 없이 걷기만 했는데, 하늘색이 계속 바뀌는 걸 보느라 두 시간이 지나 있었다. 다음엔 돗자리를 챙겨오기로 했다.',
      memoryDate: '2026-09-12',
      location: '서울 한강공원',
      tags: ['산책', '노을'],
      isPinned: true,
      photos: [
        { id: 'demo-photo-1', src: '/artwork/memory-01.svg', alt: '노을빛 강가를 그린 합성 일러스트' },
        { id: 'demo-photo-2', src: '/artwork/memory-04.svg', alt: '밤바다 불빛을 그린 합성 일러스트' },
      ],
      authorName: '나',
    },
    {
      id: 'demo-memory-2',
      title: '창가 자리에서 두 시간',
      body: '비 오는 날 카페에 앉아 각자 책을 읽었다. 말이 없어도 어색하지 않은 시간이 좋다.',
      memoryDate: '2026-08-30',
      location: '성수동',
      tags: ['카페', '비'],
      isPinned: false,
      photos: [
        { id: 'demo-photo-3', src: '/artwork/memory-02.svg', alt: '창가 자리의 커피 두 잔을 그린 합성 일러스트' },
        { id: 'demo-photo-4', src: '/artwork/memory-06.svg', alt: '비 오는 날 우산을 그린 합성 일러스트' },
      ],
      authorName: '너',
    },
    {
      id: 'demo-memory-3',
      title: '같이 구운 첫 케이크',
      body: '반죽이 두 번 실패했지만 세 번째는 그럴듯했다. 초를 꽂는 순간이 제일 좋았다.',
      memoryDate: '2026-08-14',
      location: null,
      tags: ['기념일', '요리'],
      isPinned: false,
      photos: [
        { id: 'demo-photo-5', src: '/artwork/memory-05.svg', alt: '함께 만든 케이크를 그린 합성 일러스트' },
      ],
      authorName: '나',
    },
    {
      id: 'demo-memory-4',
      title: '늦게 잡은 봄 약속',
      body: '벚꽃이 다 질 때쯤 겨우 시간이 맞았다. 늦어도 안 가는 것보다 낫다는 말을 그날 처음 이해했다.',
      memoryDate: '2026-04-11',
      location: '석촌호수',
      tags: ['봄', '산책'],
      isPinned: false,
      photos: [
        { id: 'demo-photo-6', src: '/artwork/memory-03.svg', alt: '벚꽃길을 그린 합성 일러스트' },
      ],
      authorName: '너',
    },
    {
      id: 'demo-memory-5',
      title: '사진 없는 날의 기록',
      body: '통화만 오래 한 날. 남길 사진은 없지만 이 날도 적어둔다.',
      memoryDate: '2026-03-02',
      location: null,
      tags: ['일상'],
      isPinned: false,
      photos: [],
      authorName: '나',
    },
  ],
  restaurants: [
    {
      id: 'demo-restaurant-1',
      name: '골목 안 국숫집',
      area: '망원동',
      category: '한식',
      status: 'wishlist',
      memo: '평일 낮에만 연다고 함. 휴가 때 가보기.',
    },
    {
      id: 'demo-restaurant-2',
      name: '2층 통창 파스타',
      area: '연남동',
      category: '양식',
      status: 'wishlist',
      memo: '창가 자리 예약 필요.',
    },
    {
      id: 'demo-restaurant-3',
      name: '오래된 중국집',
      area: '을지로',
      category: '중식',
      status: 'visited',
      memo: '탕수육이 기대 이상이었다.',
    },
  ],
};
