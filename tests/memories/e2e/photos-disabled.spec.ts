import { expect, test } from '@playwright/test';

import { syntheticPng } from '../support/local-api';

import { countByTitle, openSession, requireEnv, runMarker, tokenFor, waitForMemoryDetail } from './helpers';

/**
 * 서버에 사진 확정 자격 증명이 없을 때(MEM_TEST_PHOTOS=off로 앱 서버를 띄운 실행에서만).
 * 사진 기능만 사실대로 꺼지고 글 저장은 그대로 된다. 가짜 업로드 성공을 보여 주지 않는다.
 *
 *   MEM_TEST_PHOTOS=off pnpm exec playwright test --config playwright.memories.config.ts photos-disabled.spec.ts
 */

test.skip(process.env.MEM_TEST_PHOTOS !== 'off', 'MEM_TEST_PHOTOS=off 실행에서만 확인한다.');

const { env, accounts } = requireEnv();
const RUN = runMarker();

test('사진 고르기는 꺼지고 이유를 밝히며, 글은 저장된다', async ({ browser }) => {
  const a = await openSession(browser, accounts.a);
  await a.page.goto('/memories/new');

  await expect(a.page.getByText('서버에 사진 확인 설정이 없어 지금은 새 사진을 올릴 수 없습니다.')).toBeVisible();
  await expect(a.page.locator('input[type=file]')).toBeDisabled();

  // 강제로 파일을 넣어도 업로드·완료 표시가 생기지 않는다.
  await a.page.locator('input[type=file]').setInputFiles({
    name: 'x.png',
    mimeType: 'image/png',
    buffer: syntheticPng(32, 32, [1, 1, 1]),
  }).catch(() => undefined);
  await expect(a.page.locator('li[data-photo-status]')).toHaveCount(0);

  const title = `사진 없이 ${RUN}`;
  await a.page.getByLabel('제목').fill(title);
  await a.page.getByRole('button', { name: '기록 저장' }).click();
  await waitForMemoryDetail(a.page, title);
  expect(await countByTitle(env, await tokenFor(env, accounts.a), title)).toBe(1);

  await a.context.close();
});
