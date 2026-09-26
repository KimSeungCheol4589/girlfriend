import { expect, test } from '@playwright/test';

import {
  anonClient,
  assertRpcFailed,
  assertRpcOk,
  callRpc,
  createDoneEvent,
  createDoneWish,
  loadDateAccounts,
  newRequestId,
  userClient,
} from './helpers';

/**
 * 연결된 원본의 삭제 계약(DATE-001) — RPC 층에서 직접 확인한다.
 *
 * 확인하려는 계약
 *   1. 연결된 데이트 기록이 있는 위시·일정은 **삭제를 거부**한다(`GF409 has_memories`).
 *      연쇄 삭제하지 않는다. 원본은 기록의 출처로 남아야 한다.
 *   2. 추억을 지우면 **링크만 사라지고 원본은 남는다**.
 *   3. 연결이 사라진 뒤에는 원본을 지울 수 있다.
 *   4. 다른 공간 계정과 비로그인은 연결을 만들 수도, 볼 수도 없다.
 *
 * 화면이 아니라 RPC로 확인하는 이유: 삭제 거부는 DB가 보장하는 계약이고, 버튼을 숨기는 것으로
 * 접근 제어를 대신하지 않는다는 이 저장소의 원칙(AGENTS.md)과 같은 방향이다.
 */

const accounts = loadDateAccounts();

async function createMemory(account: typeof accounts.a, title: string): Promise<{ id: string; version: number }> {
  const client = await userClient(account);
  const saved = await callRpc(client, 'save_memory', {
    p_memory_id: null,
    p_title: title,
    p_body: '',
    p_memory_date: new Date().toISOString().slice(0, 10),
    p_location: null,
    p_tags: [],
    p_photo_asset_ids: [],
    p_is_pinned: false,
    p_expected_version: 0,
    p_request_id: newRequestId(),
  });
  const data = assertRpcOk(saved, '추억 생성') as unknown as { memoryId: string; version: number };
  return { id: data.memoryId, version: data.version };
}

test('연결된 기록이 있으면 위시를 지울 수 없고, 기록을 지우면 위시는 남는다', async () => {
  const client = await userClient(accounts.a);
  const wishId = await createDoneWish(accounts.a, `D1 삭제계약 위시 ${newRequestId().slice(0, 8)}`);
  const memory = await createMemory(accounts.a, `D1 삭제계약 기록 ${newRequestId().slice(0, 8)}`);

  const linked = await callRpc(client, 'link_memory_plan', {
    p_memory_id: memory.id,
    p_source: 'wish',
    p_source_id: wishId,
    p_expected_version: memory.version,
    p_request_id: newRequestId(),
  });
  const linkedVersion = (assertRpcOk(linked, '완료한 위시에 연결') as unknown as { version: number })
    .version;

  // 1. 연결이 있는 동안에는 위시 삭제가 거부된다.
  const blocked = await callRpc(client, 'delete_wish', {
    p_wish_id: wishId,
    p_expected_version: 1,
    p_request_id: newRequestId(),
  });
  const blockedFailure = assertRpcFailed(blocked, '연결된 위시 삭제');
  expect(blockedFailure.code, 'GF409로 거부한다').toBe('GF409');
  expect(blockedFailure.details).toContain('has_memories');

  // 2. 추억을 지우면 링크만 사라지고 위시는 남는다.
  const removed = await callRpc(client, 'delete_memory', {
    p_memory_id: memory.id,
    p_expected_version: linkedVersion,
    p_request_id: newRequestId(),
  });
  assertRpcOk(removed, '추억 삭제');

  const wishStillThere = await client.from('wish_items').select('id').eq('id', wishId);
  expect(wishStillThere.error).toBeNull();
  expect(wishStillThere.data ?? []).toHaveLength(1);

  // 3. 연결이 없어졌으므로 이제 지울 수 있다.
  const deleted = await callRpc(client, 'delete_wish', {
    p_wish_id: wishId,
    p_expected_version: 1,
    p_request_id: newRequestId(),
  });
  assertRpcOk(deleted, '연결이 사라진 뒤 위시 삭제');
});

test('연결된 기록이 있으면 일정도 지울 수 없다', async () => {
  const client = await userClient(accounts.a);
  const eventId = await createDoneEvent(accounts.a, `D1 삭제계약 일정 ${newRequestId().slice(0, 8)}`);
  const memory = await createMemory(accounts.a, `D1 삭제계약 기록2 ${newRequestId().slice(0, 8)}`);

  const linked = await callRpc(client, 'link_memory_plan', {
    p_memory_id: memory.id,
    p_source: 'event',
    p_source_id: eventId,
    p_expected_version: memory.version,
    p_request_id: newRequestId(),
  });
  assertRpcOk(linked, '완료한 일정에 연결');

  const blocked = await callRpc(client, 'delete_calendar_event', {
    p_event_id: eventId,
    p_expected_version: 2,
    p_request_id: newRequestId(),
  });
  const failure = assertRpcFailed(blocked, '연결된 일정 삭제');
  expect(failure.code).toBe('GF409');
  expect(failure.details).toContain('has_memories');
});

test('다른 공간 계정과 비로그인은 연결을 만들 수도 볼 수도 없다', async () => {
  const owner = await userClient(accounts.a);
  const wishId = await createDoneWish(accounts.a, `D1 격리 위시 ${newRequestId().slice(0, 8)}`);
  const memory = await createMemory(accounts.a, `D1 격리 기록 ${newRequestId().slice(0, 8)}`);
  const linked = await callRpc(owner, 'link_memory_plan', {
    p_memory_id: memory.id,
    p_source: 'wish',
    p_source_id: wishId,
    p_expected_version: memory.version,
    p_request_id: newRequestId(),
  });
  assertRpcOk(linked, '연결 생성');

  // 다른 공간 계정(c): 존재를 알리지 않는다.
  const outsider = await userClient(accounts.c);
  const outsiderRead = await outsider.from('memory_links').select('memory_id');
  expect(outsiderRead.error).toBeNull();
  expect(outsiderRead.data ?? [], '다른 공간의 연결은 한 줄도 보이지 않는다').toHaveLength(0);

  const outsiderLink = await callRpc(outsider, 'link_memory_plan', {
    p_memory_id: memory.id,
    p_source: 'wish',
    p_source_id: wishId,
    p_expected_version: 1,
    p_request_id: newRequestId(),
  });
  const outsiderFailure = assertRpcFailed(outsiderLink, '다른 공간 계정의 연결 시도');
  expect(outsiderFailure.code, '존재를 숨기고 NOT_FOUND로 통일한다').toBe('GF404');

  // 비로그인: 테이블을 읽을 권한 자체가 없다.
  const anon = anonClient();
  const anonRead = await anon.from('memory_links').select('memory_id');
  expect(anonRead.error, '비로그인은 거부된다').not.toBeNull();
});
