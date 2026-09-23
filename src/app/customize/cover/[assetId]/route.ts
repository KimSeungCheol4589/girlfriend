import type { SupabaseClient } from '@supabase/supabase-js';

import { getAppMode } from '@/features/auth/mode';
import { COVER_BUCKET, COVER_MAX_BYTES, COVER_PURPOSE } from '@/features/customize/constants';
import { isMemoryUploadMime } from '@/features/memories/live/constants';
import { isUuid } from '@/features/memories/live/ids';
import { isSupabaseConfigError } from '@/lib/supabase/config';
import { createSupabaseServerClient, getVerifiedUser } from '@/lib/supabase/server';

/**
 * 커버 사진 전달(인증된 다운로드). DESIGN.md 8.3의 기본안.
 *
 * - 요청한 사용자의 세션으로 asset 행과 Storage 객체를 **각각 RLS/Storage 정책으로** 읽는다.
 *   service_role·서명 URL·공개 URL·이미지 최적화 서버를 쓰지 않는다.
 * - 보이는 것: 업로더 본인의 자기 커버 파일, 같은 공간의 ready + 실제 커버로 붙은 파일.
 *   `deleting`은 누구에게도 안 보인다.
 * - 비로그인·외부 계정·상대의 미첨부 파일·**추억용 파일**·없는 ID·형식이 틀린 ID는 모두 같은 404다.
 *   (추억 사진은 `/memories/photos/...`로만 나간다. 두 경로가 서로의 용도를 대신 열어 주지 않는다.)
 * - 응답은 사용자별이므로 어떤 캐시에도 저장하지 않는다(`private, no-store`).
 */

export const dynamic = 'force-dynamic';

const PRIVATE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0, must-revalidate',
  Vary: 'Cookie',
  'X-Content-Type-Options': 'nosniff',
} as const;

function notFound(): Response {
  return new Response('Not Found', {
    status: 404,
    headers: { ...PRIVATE_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

type AssetRow = { id: string; object_path: string; state: string; mime_type: string; purpose: string };

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ assetId: string }> },
): Promise<Response> {
  if (getAppMode() !== 'live') return notFound();

  const { assetId } = await params;
  if (!isUuid(assetId)) return notFound();

  let client: SupabaseClient;
  try {
    client = await createSupabaseServerClient();
  } catch (error) {
    if (isSupabaseConfigError(error)) return notFound();
    throw error;
  }

  const user = await getVerifiedUser(client);
  if (!user) return notFound();

  const { data, error } = await client
    .from('assets')
    .select('id, object_path, state, mime_type, purpose')
    .eq('id', assetId)
    .maybeSingle();
  if (error || !data) return notFound();

  const asset = data as AssetRow;
  if (asset.state === 'deleting' || asset.purpose !== COVER_PURPOSE || !isMemoryUploadMime(asset.mime_type)) {
    return notFound();
  }

  // 사용자 세션으로 내려받는다. Storage SELECT 정책(app.can_read_object)이 다시 검사한다.
  const { data: blob, error: downloadError } = await client.storage
    .from(COVER_BUCKET)
    .download(asset.object_path);
  if (downloadError || !blob || blob.size === 0 || blob.size > COVER_MAX_BYTES) {
    return notFound();
  }

  return new Response(blob, {
    status: 200,
    headers: {
      ...PRIVATE_HEADERS,
      'Content-Type': asset.mime_type,
      'Content-Length': String(blob.size),
      'Content-Disposition': 'inline',
      // 이미지로만 쓰인다. 문서로 열려도 스크립트를 실행하지 못하게 한다.
      'Content-Security-Policy': "default-src 'none'; sandbox",
    },
  });
}
