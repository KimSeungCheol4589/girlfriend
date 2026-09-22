/**
 * storage-js는 브라우저에서 Blob을 올릴 때 `multipart/form-data`로 보낸다
 * (`cacheControl` 필드 + 이름이 빈 파일 파트). 업로드 본문을 바꿔치기하는 테스트는
 * **파일 파트의 내용만** 바꾸고 경계·다른 파트·파트 헤더는 그대로 둬야 한다.
 */

export function multipartBoundary(contentType: string | undefined): string | null {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType ?? '');
  return match ? (match[1] ?? match[2] ?? '').trim() || null : null;
}

/** 파일 파트(헤더에 `filename=`이 있는 파트)의 내용만 바꾼다. 찾지 못하면 null. */
export function replaceMultipartFile(
  body: Buffer,
  boundary: string,
  replace: (original: Buffer) => Buffer,
): { body: Buffer; original: Buffer; replaced: Buffer } | null {
  const delimiter = Buffer.from(`--${boundary}`, 'latin1');
  const closing = Buffer.from(`\r\n--${boundary}`, 'latin1');
  const headerEndMarker = Buffer.from('\r\n\r\n', 'latin1');

  let cursor = body.indexOf(delimiter);
  while (cursor !== -1) {
    const partStart = cursor + delimiter.length;
    // 마지막 경계(`--boundary--`)면 끝
    if (body.subarray(partStart, partStart + 2).toString('latin1') === '--') return null;
    const headerEnd = body.indexOf(headerEndMarker, partStart);
    if (headerEnd === -1) return null;
    const headers = body.subarray(partStart, headerEnd).toString('latin1');
    const contentStart = headerEnd + headerEndMarker.length;
    const contentEnd = body.indexOf(closing, contentStart);
    if (contentEnd === -1) return null;

    if (/filename=/i.test(headers)) {
      const original = Buffer.from(body.subarray(contentStart, contentEnd));
      const replaced = replace(original);
      return {
        body: Buffer.concat([body.subarray(0, contentStart), replaced, body.subarray(contentEnd)]),
        original,
        replaced,
      };
    }
    cursor = contentEnd + 2; // 다음 `--boundary`
  }
  return null;
}
