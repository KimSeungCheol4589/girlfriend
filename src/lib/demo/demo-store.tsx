'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { DEMO_STATE } from '@/lib/demo/fixtures';
import type {
  DemoCoverPreview,
  DemoCustomization,
  DemoMemory,
  DemoPhoto,
  DemoResult,
  DemoState,
} from '@/lib/demo/types';

/**
 * 데모 모드 상태 저장소.
 *
 * 이 저장소는 브라우저 메모리에만 존재한다. 새로고침하면 예시 데이터로 되돌아간다.
 * 로그인·공유 저장·사진 업로드는 아직 구현하지 않았으므로, 여기서 성공을 돌려줘도
 * 서버에 저장됐다는 뜻이 아니다. 화면 문구도 그렇게 쓰지 않는다.
 *
 * 실제 구현(AUTH-001 이후)에서는 이 파일 대신 DESIGN.md 7의 서버 작업을 호출한다.
 */

export const DEMO_MODE = true;

export type MemoryInput = {
  title: string;
  body: string;
  memoryDate: string;
  location: string;
  tags: string[];
  photos: DemoPhoto[];
};

type DemoStoreValue = {
  state: DemoState;
  /** 예시 데이터에서 바뀐 부분이 있는지. 안내 문구에 사용한다. */
  isDirty: boolean;
  createMemory: (input: MemoryInput) => DemoResult<{ id: string }>;
  updateMemory: (id: string, input: MemoryInput) => DemoResult<{ id: string }>;
  deleteMemory: (id: string) => DemoResult<{ id: string }>;
  toggleMemoryPin: (id: string) => DemoResult<{ id: string; isPinned: boolean }>;
  /** 꾸미기 설정과 데모 커버 미리보기를 함께 반영한다. 커버는 계약과 분리된 값이다. */
  applyCustomization: (
    next: DemoCustomization,
    coverPreview: DemoCoverPreview | null,
  ) => DemoResult<DemoCustomization>;
  resetDemo: () => void;
};

const DemoStoreContext = createContext<DemoStoreValue | null>(null);

function cloneInitialState(): DemoState {
  return {
    space: { ...DEMO_STATE.space },
    customization: {
      ...DEMO_STATE.customization,
      sections: DEMO_STATE.customization.sections.map((section) => ({ ...section })),
    },
    coverPreview: null,
    memories: DEMO_STATE.memories.map((memory) => ({
      ...memory,
      tags: [...memory.tags],
      photos: memory.photos.map((photo) => ({ ...photo })),
    })),
    restaurants: DEMO_STATE.restaurants.map((restaurant) => ({ ...restaurant })),
  };
}

let localIdCounter = 0;
function nextLocalId(prefix: string): string {
  localIdCounter += 1;
  return `${prefix}-local-${localIdCounter}`;
}

/** 폼에서 만든 미리보기 URL만 정리한다. public/ 아래 합성 SVG 경로는 건드리지 않는다. */
function revokePreviewUrl(src: string): void {
  if (src.startsWith('blob:') && typeof URL.revokeObjectURL === 'function') {
    URL.revokeObjectURL(src);
  }
}

function releasePhotos(previous: readonly DemoPhoto[], next: readonly DemoPhoto[]): void {
  const keep = new Set(next.map((photo) => photo.src));
  for (const photo of previous) {
    if (!keep.has(photo.src)) revokePreviewUrl(photo.src);
  }
}

export function DemoStoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DemoState>(cloneInitialState);
  const [isDirty, setIsDirty] = useState(false);

  const createMemory = useCallback(
    (input: MemoryInput): DemoResult<{ id: string }> => {
      const id = nextLocalId('memory');
      const memory: DemoMemory = {
        id,
        title: input.title,
        body: input.body,
        memoryDate: input.memoryDate,
        location: input.location.length > 0 ? input.location : null,
        tags: [...input.tags],
        isPinned: false,
        photos: input.photos.map((photo) => ({ ...photo })),
        authorName: '나',
      };

      setState({ ...state, memories: [memory, ...state.memories] });
      setIsDirty(true);
      return { ok: true, data: { id } };
    },
    [state],
  );

  const updateMemory = useCallback(
    (id: string, input: MemoryInput): DemoResult<{ id: string }> => {
      const target = state.memories.find((memory) => memory.id === id);
      if (!target) {
        return { ok: false, code: 'NOT_FOUND', message: '수정하려는 기록을 찾지 못했어요.' };
      }

      releasePhotos(target.photos, input.photos);
      const memories = state.memories.map((memory) =>
        memory.id === id
          ? {
              ...memory,
              title: input.title,
              body: input.body,
              memoryDate: input.memoryDate,
              location: input.location.length > 0 ? input.location : null,
              tags: [...input.tags],
              photos: input.photos.map((photo) => ({ ...photo })),
            }
          : memory,
      );

      setState({ ...state, memories });
      setIsDirty(true);
      return { ok: true, data: { id } };
    },
    [state],
  );

  const deleteMemory = useCallback(
    (id: string): DemoResult<{ id: string }> => {
      const target = state.memories.find((memory) => memory.id === id);
      if (!target) {
        return { ok: false, code: 'NOT_FOUND', message: '삭제하려는 기록을 찾지 못했어요.' };
      }

      releasePhotos(target.photos, []);
      setState({
        ...state,
        memories: state.memories.filter((memory) => memory.id !== id),
      });
      setIsDirty(true);
      return { ok: true, data: { id } };
    },
    [state],
  );

  const toggleMemoryPin = useCallback(
    (id: string): DemoResult<{ id: string; isPinned: boolean }> => {
      const target = state.memories.find((memory) => memory.id === id);
      if (!target) {
        return { ok: false, code: 'NOT_FOUND', message: '고정하려는 기록을 찾지 못했어요.' };
      }

      const nextPinned = !target.isPinned;
      setState({
        ...state,
        memories: state.memories.map((memory) => {
          if (memory.id === id) return { ...memory, isPinned: nextPinned };
          // 홈에 고정하는 추억은 하나만 유지한다.
          return memory.isPinned ? { ...memory, isPinned: false } : memory;
        }),
      });
      setIsDirty(true);
      return { ok: true, data: { id, isPinned: nextPinned } };
    },
    [state],
  );

  const applyCustomization = useCallback(
    (
      next: DemoCustomization,
      coverPreview: DemoCoverPreview | null,
    ): DemoResult<DemoCustomization> => {
      const applied: DemoCustomization = {
        themeKey: next.themeKey,
        accentColor: next.accentColor,
        // 데모에서는 업로드가 없으므로 asset ID를 만들지 않는다.
        // 브라우저 미리보기 주소를 여기에 넣지 않는다.
        coverAssetId: next.coverAssetId,
        sections: next.sections.map((section) => ({ ...section })),
      };

      // 더 이상 쓰지 않는 이전 커버 미리보기를 정리한다.
      const previous = state.coverPreview;
      if (previous && previous.objectUrl !== coverPreview?.objectUrl) {
        revokePreviewUrl(previous.objectUrl);
      }

      setState({
        ...state,
        customization: applied,
        coverPreview: coverPreview ? { ...coverPreview } : null,
      });
      setIsDirty(true);
      return { ok: true, data: applied };
    },
    [state],
  );

  const resetDemo = useCallback(() => {
    for (const memory of state.memories) {
      releasePhotos(memory.photos, []);
    }
    if (state.coverPreview) revokePreviewUrl(state.coverPreview.objectUrl);
    setState(cloneInitialState());
    setIsDirty(false);
  }, [state]);

  const value = useMemo<DemoStoreValue>(
    () => ({
      state,
      isDirty,
      createMemory,
      updateMemory,
      deleteMemory,
      toggleMemoryPin,
      applyCustomization,
      resetDemo,
    }),
    [
      state,
      isDirty,
      createMemory,
      updateMemory,
      deleteMemory,
      toggleMemoryPin,
      applyCustomization,
      resetDemo,
    ],
  );

  return <DemoStoreContext.Provider value={value}>{children}</DemoStoreContext.Provider>;
}

export function useDemoStore(): DemoStoreValue {
  const value = useContext(DemoStoreContext);
  if (!value) {
    throw new Error('useDemoStore는 DemoStoreProvider 안에서만 사용할 수 있습니다.');
  }
  return value;
}
