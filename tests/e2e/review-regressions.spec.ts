import { expect, test, type Page } from '@playwright/test';

/**
 * 독립 검토(ID 0754e14e-3e39-4c98-bb31-5f2042f6cef1, head 240a783)에서 지적한
 * P2-1~P2-4 재현 절차와 대화상자 키보드 동작에 대한 회귀 테스트.
 *
 * 각 테스트는 검토 보고서의 재현 단계를 그대로 따라간다.
 */

/** 1x1 PNG. 외부 파일을 받지 않고 테스트 안에서 만든 최소 이미지다. */
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const CREAM_BACKGROUND = 'rgb(251, 247, 241)';
const ROSE_BACKGROUND = 'rgb(253, 245, 245)';

function previewBackground(page: Page) {
  return page
    .getByTestId('customize-preview')
    .evaluate((element) => getComputedStyle(element).backgroundColor);
}

function pickCover(page: Page, name = 'our-cover.png', mimeType = 'image/png') {
  return page.locator('input[type="file"]').setInputFiles({ name, mimeType, buffer: TINY_PNG });
}

/** 사진 n장짜리 기록을 만들고 상세 화면까지 이동한다. */
async function createMemoryWithPhotos(page: Page, title: string, count: number) {
  await page.goto('/memories/new');
  await page.getByLabel(/제목/).fill(title);
  await page.getByLabel(/날짜/).fill('2026-09-19');
  await page.locator('input[type="file"]').setInputFiles(
    Array.from({ length: count }, (_, index) => ({
      name: `photo-${index}.png`,
      mimeType: 'image/png',
      buffer: TINY_PNG,
    })),
  );
  await page.getByRole('button', { name: '기록 추가' }).click();
  await page.getByRole('link', { name: '이 기록 보기' }).click();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
}

/** 상세 화면 갤러리의 썸네일까지 포함해 실제로 디코딩된 이미지 폭을 모은다. */
function loadedImageWidths(page: Page): Promise<number[]> {
  return page
    .locator('figure img')
    .evaluateAll((elements) =>
      elements.map((element) => (element as HTMLImageElement).naturalWidth),
    );
}

/**
 * 상세 화면이 쓰는 blob 주소가 아직 살아 있는지 확인한다.
 *
 * 이미 디코딩된 <img>는 주소가 해제돼도 naturalWidth가 남으므로,
 * 해제 여부는 주소를 실제로 가져와 봐야 알 수 있다.
 */
async function blobSourcesAlive(page: Page): Promise<boolean> {
  const sources = await page
    .locator('figure img')
    .evaluateAll((elements) =>
      elements
        .map((element) => (element as HTMLImageElement).src)
        .filter((src) => src.startsWith('blob:')),
    );

  if (sources.length === 0) return false;

  return page.evaluate(async (urls) => {
    for (const url of urls) {
      try {
        const response = await fetch(url);
        if (!response.ok) return false;
      } catch {
        return false;
      }
    }
    return true;
  }, sources);
}

test.describe('P2-1 테마 미리보기 팔레트', () => {
  test('로즈를 적용한 뒤 크림을 고르면 미리보기가 크림 팔레트로 바뀐다', async ({ page }) => {
    await page.goto('/customize');

    await expect.poll(() => previewBackground(page)).toBe(CREAM_BACKGROUND);

    // 로즈 선택 → 적용 (문서 전체 테마가 로즈가 된다)
    await page.getByRole('button', { name: /^로즈 따뜻한 장밋빛/ }).click();
    await expect.poll(() => previewBackground(page)).toBe(ROSE_BACKGROUND);
    await page.getByRole('button', { name: '적용', exact: true }).click();

    // 다시 크림 선택 → 미리보기는 크림 팔레트여야 한다 (검토 전에는 로즈가 남았다)
    await page.getByRole('button', { name: /^크림 아이보리 배경/ }).click();
    await expect.poll(() => previewBackground(page)).toBe(CREAM_BACKGROUND);
  });
});

test.describe('P2-2 데모 리셋과 draft 동기화', () => {
  test('커버 적용 후 예시 데이터로 되돌리면 꾸미기 draft도 초기화된다', async ({ page }) => {
    await page.goto('/customize');

    await pickCover(page);
    await page.getByRole('button', { name: '적용', exact: true }).click();
    await expect(page.getByText('아직 적용하지 않은 변경이 있어요.')).toBeHidden();

    await page.getByRole('button', { name: '예시 데이터로 되돌리기' }).click();

    // 해제된 blob 주소가 draft에 남지 않는다.
    await expect(page.getByText('고른 커버 이미지가 없습니다')).toBeVisible();
    // 사용자가 아무것도 고르지 않았으므로 미저장 경고도 뜨지 않는다.
    await expect(page.getByText('아직 적용하지 않은 변경이 있어요.')).toBeHidden();
    await expect(page.getByRole('button', { name: '적용', exact: true })).toBeDisabled();
  });
});

test.describe('P2-3 사진 objectURL 소유권', () => {
  test('편집에서 사진을 빼고 취소하면 저장된 사진이 그대로 보인다', async ({ page }) => {
    await page.goto('/memories/new');

    await page.getByLabel(/제목/).fill('사진 소유권 확인');
    await page.getByLabel(/날짜/).fill('2026-09-19');
    await pickCover(page, 'photo.png');
    await page.getByRole('button', { name: '기록 추가' }).click();

    await page.getByRole('link', { name: '이 기록 보기' }).click();
    await expect(page.getByRole('heading', { name: '사진 소유권 확인' })).toBeVisible();

    await page.getByRole('link', { name: '수정', exact: true }).click();
    await page.getByRole('button', { name: '빼기' }).click();

    // 저장하지 않고 나간다. (폼 자체의 이탈 확인)
    await page.getByRole('button', { name: '취소', exact: true }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: '나가기' }).click();

    await expect(page.getByRole('heading', { name: '사진 소유권 확인' })).toBeVisible();

    // blob이 해제됐다면 이미지 로드에 실패해 naturalWidth가 0이 된다.
    const image = page.locator('figure img').first();
    await expect(image).toBeVisible();
    await expect
      .poll(() => image.evaluate((element) => (element as HTMLImageElement).naturalWidth))
      .toBeGreaterThan(0);
  });

  test('사진 순서만 바꿔도 미저장 변경으로 잡힌다', async ({ page }) => {
    await createMemoryWithPhotos(page, '순서 변경 확인', 2);
    await page.getByRole('link', { name: '수정', exact: true }).click();

    // 장수는 그대로 두고 순서만 바꾼다.
    await page.getByRole('button', { name: '1번째 사진 뒤로' }).click();

    await page.getByRole('button', { name: '취소', exact: true }).click();
    await expect(page.getByRole('alertdialog')).toBeVisible();
    await expect(page.getByText('쓰던 내용을 두고 나갈까요?')).toBeVisible();
  });
});

/**
 * R-1 (2차 검토 84164c00-37ae-4dd1-a783-3de8a797d534 / head 9889af5).
 *
 * 폼이 저장소 소유 objectURL까지 자기 것으로 등록해, 편집을 취소하면
 * 이미 저장된 사진이 해제되던 결함. 사진 2장 기록에서 순서 변경·빼기·추가 세 경우를
 * 모두 '나가기'까지 진행한 뒤 원래 사진이 살아 있는지 확인한다.
 */
test.describe('R-1 저장소 소유 사진 URL 보존', () => {
  for (const scenario of [
    { name: '순서만 바꾸고 취소', action: '1번째 사진 뒤로', kind: 'move' as const },
    { name: '한 장 빼고 취소', kind: 'remove' as const },
    { name: '한 장 추가하고 취소', kind: 'add' as const },
  ]) {
    test(`사진 2장 기록에서 ${scenario.name}해도 원래 사진이 살아 있다`, async ({ page }) => {
      const title = `R1 ${scenario.kind}`;
      await createMemoryWithPhotos(page, title, 2);
      await page.getByRole('link', { name: '수정', exact: true }).click();

      if (scenario.kind === 'move') {
        await page.getByRole('button', { name: '1번째 사진 뒤로' }).click();
      } else if (scenario.kind === 'remove') {
        await page.getByRole('button', { name: '빼기' }).first().click();
      } else {
        await page
          .locator('input[type="file"]')
          .setInputFiles({ name: 'extra.png', mimeType: 'image/png', buffer: TINY_PNG });
      }

      // 저장하지 않고 실제로 나간다.
      await page.getByRole('button', { name: '취소', exact: true }).click();
      await page.getByRole('alertdialog').getByRole('button', { name: '나가기' }).click();

      await expect(page.getByRole('heading', { name: title })).toBeVisible();

      // 저장된 사진(본 이미지 + 썸네일)이 모두 디코딩돼야 한다.
      await expect
        .poll(async () => {
          const widths = await loadedImageWidths(page);
          return widths.length >= 2 && widths.every((width) => width > 0);
        })
        .toBe(true);

      // 그리고 그 주소들이 아직 해제되지 않았어야 한다.
      // (이미 디코딩된 이미지는 해제 후에도 naturalWidth가 남으므로 이 확인이 핵심이다.)
      expect(await blobSourcesAlive(page)).toBe(true);
    });
  }

  test('저장하지 않은 새 사진의 미리보기 주소는 나갈 때 정리된다', async ({ page }) => {
    await page.goto('/memories/new');

    await page.getByLabel(/제목/).fill('정리 확인');
    await page.getByLabel(/날짜/).fill('2026-09-19');
    await page
      .locator('input[type="file"]')
      .setInputFiles({ name: 'temp.png', mimeType: 'image/png', buffer: TINY_PNG });

    const previewUrl = await page
      .locator('form img')
      .first()
      .evaluate((element) => (element as HTMLImageElement).src);
    expect(previewUrl.startsWith('blob:')).toBe(true);

    await page.getByRole('button', { name: '취소', exact: true }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: '나가기' }).click();
    await expect(page.getByRole('heading', { name: '추억', exact: true })).toBeVisible();

    // 해제된 주소는 더 이상 가져올 수 없다.
    const stillUsable = await page.evaluate(async (url) => {
      try {
        const response = await fetch(url);
        return response.ok;
      } catch {
        return false;
      }
    }, previewUrl);
    expect(stillUsable).toBe(false);
  });
});

test.describe('P2-4 앱 내부 이동 확인', () => {
  test('꾸미기가 미저장이면 메뉴 이동 전에 확인한다', async ({ page }) => {
    await page.goto('/customize');

    await page.getByRole('button', { name: /^세이지 차분한 연녹색/ }).click();
    await expect(page.getByText('아직 적용하지 않은 변경이 있어요.')).toBeVisible();

    // 헤더의 공간 이름 링크로 이동 시도 → 확인 대화상자
    await page.getByRole('link', { name: '둘이 쌓는 공간' }).click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toBeVisible();
    await expect(page.getByText('적용하지 않은 꾸미기 설정이 있어요')).toBeVisible();

    // 계속 꾸미기 → 그대로 남고 선택도 유지된다.
    await dialog.getByRole('button', { name: '계속 꾸미기' }).click();
    await expect(page).toHaveURL(/\/customize$/);
    await expect(page.getByText('아직 적용하지 않은 변경이 있어요.')).toBeVisible();

    // 이동하기 → 홈으로 나간다.
    await page.getByRole('link', { name: '둘이 쌓는 공간' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: '이동하기' }).click();
    await expect(page).toHaveURL(/\/$/);
  });

  /**
   * R-2 (2차 검토 84164c00-37ae-4dd1-a783-3de8a797d534 / head 9889af5).
   *
   * 현재 경로로의 이동을 확인 대상으로 잡은 뒤 가드를 전역 해제해,
   * 그 다음 이동이 무확인으로 통과하던 결함.
   */
  test('현재 경로 메뉴를 눌러도 draft가 유지되고 이후 이동에는 확인이 필요하다', async ({
    page,
  }) => {
    await page.goto('/customize');

    await page.getByRole('button', { name: /^세이지 차분한 연녹색/ }).click();
    await expect(page.getByText('아직 적용하지 않은 변경이 있어요.')).toBeVisible();

    // 지금 보고 있는 화면과 같은 경로(꾸미기) 메뉴를 누른다.
    await page.getByRole('link', { name: '꾸미기' }).filter({ visible: true }).click();

    // 화면을 떠나지 않으므로 확인할 것이 없고, 고른 값도 그대로다.
    await expect(page.getByRole('alertdialog')).toBeHidden();
    await expect(page).toHaveURL(/\/customize$/);
    await expect(page.getByText('아직 적용하지 않은 변경이 있어요.')).toBeVisible();
    await expect(page.getByRole('button', { name: /^세이지 차분한 연녹색/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    // 다른 경로로 이동할 때는 여전히 확인을 받아야 한다.
    await page.getByRole('link', { name: '둘이 쌓는 공간' }).click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toBeVisible();

    // 취소하면 draft가 남는다.
    await dialog.getByRole('button', { name: '계속 꾸미기' }).click();
    await expect(page).toHaveURL(/\/customize$/);
    await expect(page.getByText('아직 적용하지 않은 변경이 있어요.')).toBeVisible();

    // 명시적으로 나갈 때만 이동한다.
    await page.getByRole('link', { name: '둘이 쌓는 공간' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: '이동하기' }).click();
    await expect(page).toHaveURL(/\/$/);
  });

  test('적용한 뒤에는 확인 없이 이동한다', async ({ page }) => {
    await page.goto('/customize');

    await page.getByRole('button', { name: /^세이지 차분한 연녹색/ }).click();
    await page.getByRole('button', { name: '적용', exact: true }).click();

    await page.getByRole('link', { name: '둘이 쌓는 공간' }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('alertdialog')).toBeHidden();
  });
});

test.describe('확인 대화상자 키보드 동작', () => {
  test('포커스를 가두고 Esc로 닫으며 원래 버튼으로 되돌린다', async ({ page }) => {
    await page.goto('/memories/demo-memory-1');

    const deleteButton = page.getByRole('button', { name: '삭제' });
    await deleteButton.click();

    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toBeVisible();

    // 열리면 확인 버튼에 포커스가 간다.
    await expect(dialog.getByRole('button', { name: '삭제' })).toBeFocused();

    // Tab을 여러 번 눌러도 포커스가 대화상자 밖으로 나가지 않는다.
    for (let i = 0; i < 6; i += 1) {
      await page.keyboard.press('Tab');
      const inside = await dialog.evaluate((element) =>
        element.contains(document.activeElement),
      );
      expect(inside).toBe(true);
    }

    // Shift+Tab도 마찬가지다.
    for (let i = 0; i < 3; i += 1) {
      await page.keyboard.press('Shift+Tab');
      const inside = await dialog.evaluate((element) =>
        element.contains(document.activeElement),
      );
      expect(inside).toBe(true);
    }

    // Esc로 닫으면 열었던 버튼으로 포커스가 돌아간다.
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(deleteButton).toBeFocused();

    // 기록은 지워지지 않았다.
    await expect(page.getByRole('heading', { name: '한강 노을 산책' })).toBeVisible();
  });

  test('대화상자가 열리면 배경이 inert가 되고 스크롤이 잠긴다', async ({ page }) => {
    await page.goto('/memories/demo-memory-1');
    await page.getByRole('button', { name: '삭제' }).click();

    await expect(page.locator('#app-shell-root')).toHaveAttribute('inert', '');
    await expect
      .poll(() => page.evaluate(() => document.body.style.overflow))
      .toBe('hidden');

    await page.keyboard.press('Escape');

    await expect(page.locator('#app-shell-root')).not.toHaveAttribute('inert', '');
    await expect
      .poll(() => page.evaluate(() => document.body.style.overflow))
      .not.toBe('hidden');
  });
});
