# 기술 스택 제안

작성일: 2026-09-19 · 대상: 두 사람이 사용하는 비공개 추억·맛집 홈페이지

## 1. 추천 조합

**Next.js + TypeScript + Tailwind CSS + Supabase + Vercel**을 기본안으로 추천한다. 화면과 서버 처리를 한 프로젝트에서 관리하고, 인증·데이터베이스·사진 저장은 관리형 서비스를 이용해 개인 프로젝트의 운영 부담을 줄인다.

이 문서는 도입 제안이며 아직 프로젝트 생성이나 서비스 가입·배포를 진행한 상태는 아니다. 패키지 버전은 구현 시작 시 호환되는 안정 버전으로 정하고 lockfile로 고정한다.

## 2. 필수 기술

| 역할 | 추천 기술 | 사용하는 이유 |
| --- | --- | --- |
| 웹 프레임워크 | Next.js App Router / React | 페이지, 공통 레이아웃, 조회와 서버 처리를 하나의 프로젝트에서 구성 |
| 개발 언어 | TypeScript | 기록·맛집·테마 데이터의 타입을 일관되게 관리 |
| 스타일 | Tailwind CSS + CSS 변수 | 반응형 화면과 테마 색상 구현 |
| UI 구성 요소 | shadcn/ui 선택 도입 | 필요한 버튼·대화상자·폼을 프로젝트 스타일에 맞게 구성 |
| 데이터베이스 | Supabase PostgreSQL | 공유 공간, 추억, 맛집, 사용자별 후기의 관계와 제약 관리 |
| 인증 | Supabase Auth | 각자의 계정 로그인과 세션 관리 |
| 사진 저장 | Supabase Storage | 사진 파일을 DB와 분리해 저장하고 접근 권한 적용 |
| 입력 검증 | Zod | 제목·날짜·별점·지도 URL 등을 서버에서 검증 |
| 배포 | Vercel | Next.js 앱 배포와 변경 사항 미리보기 |
| 코드 관리 | Git + GitHub 비공개 저장소 | 변경 이력과 배포 소스 관리 |

Next.js App Router는 서버·클라이언트 컴포넌트를 조합할 수 있다. 조회 화면은 서버 중심으로, 폼·사진 미리보기·꾸미기 상호작용은 클라이언트에서 처리하는 구성을 제안한다. [Next.js 공식 문서](https://nextjs.org/docs/app/getting-started/server-and-client-components)

## 3. 구조

```text
두 사람의 모바일 / PC 브라우저
           │ HTTPS
           ▼
Next.js 앱 — Vercel
  ├─ 페이지·테마·입력 화면
  ├─ 서버 입력 검증·권한 확인·저장 처리
  └─ Supabase 연동
       ├─ Auth: 로그인·세션
       ├─ PostgreSQL: 공간·추억·맛집·설정
       └─ Storage: 비공개 사진 파일
```

초기에는 별도 Express/NestJS 서버, Redis, 마이크로서비스, 실시간 협업 서버를 추가하지 않는다. 서버에서 저장한 뒤 관련 화면을 갱신하는 방식이면 초기 사용 흐름을 구현할 수 있다.

대용량 파일을 앱 서버에 그대로 통과시키기보다, 인증된 사용자가 Storage 권한 정책에 따라 직접 업로드하는 방식을 기본으로 검토한다. 업로드 성공 후 파일 메타데이터를 기록하고 중도 실패한 파일은 정리한다.

## 4. 데이터 모델 초안

기본 키는 UUID, 생성·수정 시각은 타임존을 포함한 시각 값으로 관리한다. 추억 날짜·관계 시작일·방문일은 달력 날짜로 저장한다.

| 테이블 | 주요 필드 | 역할 |
| --- | --- | --- |
| profiles | id(Auth 사용자 ID), nickname, avatar_path | 사용자 프로필 |
| spaces | id, name, introduction, relationship_start_date | 두 사람의 공유 공간 |
| space_members | space_id, user_id, joined_at | 공간 소속, 공간·사용자 조합 중복 금지 |
| space_invites | id, space_id, token_hash, expires_at, accepted_at | 만료·일회성 초대 |
| space_settings | space_id, theme_key, accent_color, cover_path, home_sections, version | 공간당 하나의 꾸미기 설정 |
| memories | id, space_id, author_id, title, body, memory_date, location, tags, is_pinned, version | 추억 본문과 분류 |
| memory_photos | id, memory_id, object_path, sort_order, width, height | 사진 경로·순서·크기 |
| restaurants | id, space_id, created_by, name, area, category, map_url, memo, status, visited_date, version | 가고 싶은 곳·방문 완료 관리 |
| restaurant_reviews | id, restaurant_id, user_id, rating, comment | 맛집별·사용자별 후기 하나, 별점 1~5 |

`home_sections`는 허용된 섹션 키·순서·표시 여부만 저장하는 JSON으로 관리한다. 임의 HTML이나 스크립트를 저장하는 편집기는 도입하지 않는다. `tags`는 초기에는 문자열 배열로 시작하고 필요할 때 별도 테이블로 분리한다.

주요 조회 인덱스는 `memories(space_id, memory_date)`, `restaurants(space_id, status)`에 둔다. 공간 구성원 최대 두 명 제한과 초대 수락은 DB 트랜잭션에서 처리해 동시 요청에도 정원을 넘기지 않게 한다.

## 5. 비공개 공간과 데이터 보호

로그인 여부만 확인하는 것으로는 충분하지 않다. 요청한 사용자가 해당 공간의 구성원인지 확인하고 데이터베이스에도 동일한 접근 정책을 적용한다.

- 모든 공유 데이터에 공간 구성원 기반 Row Level Security(RLS)를 적용한다.
- 사진 메타데이터와 후기처럼 공간 ID가 직접 없는 테이블은 부모 기록의 공간 소속을 확인한다.
- 개인 후기의 쓰기는 본인만 허용하고, 조회는 두 구성원에게 허용한다.
- 초대 토큰 원문은 저장하지 않고 해시·만료 시각을 관리한다. 토큰 조회·수락 권한을 별도로 제한한다.
- 사진은 private bucket에 보관하고 로그인 권한 또는 만료 시간이 있는 서명 URL로 제공한다.
- 서명 URL은 만료 전까지 URL을 가진 사람이 사용할 수 있으므로 짧게 발급하고 공유·로그 노출을 피한다.
- 관리자 키는 브라우저에 전달하지 않는다. 서버에서도 일반 사용자 요청은 사용자 세션과 RLS를 사용하는 것을 기본으로 한다.
- 사용자별 비공개 응답이 다른 사용자에게 캐시로 재사용되지 않도록 조회·사진 전달 경로를 검토한다.

Supabase는 Auth와 RLS를 결합한 데이터 접근 제어를 지원한다. private bucket은 다운로드에도 접근 권한을 요구하며 서명 URL 방식도 제공한다. [RLS 공식 문서](https://supabase.com/docs/guides/database/postgres/row-level-security), [Storage 접근 제어](https://supabase.com/docs/guides/storage/security/access-control), [비공개 버킷](https://supabase.com/docs/guides/storage/buckets/fundamentals)

## 6. 사진·공동 편집 구현 원칙

### 사진

- 허용 MIME 유형과 파일 크기를 제한하고, 파일명 대신 임의 ID로 저장한다.
- 표시용 사진은 업로드 전에 크기를 줄이되 처리 실패 시 사용자에게 안내한다.
- 기본안은 압축본 보관이다. 원본 보존을 선택하면 저장 공간·백업 비용을 다시 계산한다.
- 위치 등 EXIF 메타데이터는 제거하고 회전 정보는 화면에 올바르게 반영한다.
- 파일 정리 실패에 대비해 DB 기록과 파일 목록을 대조하는 정리 절차를 둔다.
- HEIC 지원은 실제 사용 기기의 사진으로 검증한 후 변환 라이브러리 또는 별도 처리 도입을 결정한다.

### 공동 편집

- `version` 값을 함께 보내 변경 전 버전이 일치할 때만 저장한다.
- 버전이 다르면 상대방의 변경을 다시 불러오도록 안내한다.
- 초기에는 저장·새로고침으로 공유한다. 자동 갱신이 실제로 필요해지면 Supabase Realtime을 검토한다.

## 7. 맛집 지도 연동

첫 버전은 사용자가 네이버지도·카카오맵 등의 공유 링크를 붙여 넣고 외부 지도를 여는 방식으로 만든다. 장소 정보는 직접 입력하며 링크의 내용을 서버에서 자동 수집하지 않는다.

지도 내 검색·마커 표시는 후속 기능으로 둔다. 도입 시 국내 장소 검색 품질, 제공자 약관, 호출 한도·요금, 도메인·키 제한을 확인한 뒤 하나의 제공자를 선택한다. 현재 기획에는 지도 SDK나 검색 API 비용을 필수 항목으로 넣지 않는다.

## 8. 개발 도구와 검증

| 항목 | 제안 |
| --- | --- |
| 런타임·패키지 관리 | 구현 시 Next.js 지원 범위에 맞는 Node.js LTS + pnpm |
| 정적 검사 | TypeScript 타입 검사 + ESLint |
| 핵심 로직 테스트 | Vitest: 날짜 계산, 입력 검증, 수정 충돌 등 |
| 실제 사용자 흐름 | Playwright: 로그인, 추억 등록, 맛집 방문 처리 |
| 권한 검증 | 비로그인·구성원·외부 계정으로 DB와 Storage 직접 접근 테스트 |
| 배포 전 검사 | 타입 검사, lint, 핵심 테스트, production build |
| DB 변경 이력 | SQL migration 파일을 저장소에서 관리 |

초기 상태 관리는 React의 기본 기능으로 시작한다. 폼이 복잡해지면 React Hook Form을 추가하고, 서버 데이터 캐싱 요구가 커질 때 TanStack Query를 검토한다.

개발·미리보기 환경에는 실제 두 사람의 사진 대신 테스트 데이터를 사용하고, 운영 DB·사진 저장소와 분리한다.

## 9. 비용과 운영

Vercel과 Supabase의 무료 플랜 적용 가능 여부를 확인해 시작한다. 사진이 누적되면 저장 공간과 다운로드 트래픽이 비용을 결정하므로 **영구 무료를 전제로 설계하지 않는다**. Vercel Hobby는 개인·비상업 용도를 대상으로 하므로 현재 기획과 부합하지만, 운영 방식이 바뀌면 다시 검토한다. [Vercel Hobby 정책](https://vercel.com/docs/plans/hobby)

| 비용 요소 | 계획 |
| --- | --- |
| 웹 호스팅 | 무료 플랜 검토, 배포 시 최신 한도 확인 |
| DB·인증·사진 저장 | Supabase 플랜별 한도·백업 기능 확인 |
| 도메인 | 초기 기본 주소 사용, 개인 도메인은 선택 |
| 인증 이메일 | 실제 이메일 전달과 발송 한도 확인, 필요 시 SMTP 서비스 연결 |
| 백업 | DB와 사진 파일을 각각 내보내 안전한 별도 위치에 보관 |

예를 들어 사진 2,000장을 평균 1MB로 저장하면 파일만 약 2GB가 필요하다. 썸네일·원본·트래픽은 별도다. 이는 사용량 예시이며 요금 견적은 아니다.

운영 초기에는 주 1회 DB·사진 백업을 기본 목표로 삼고 실제 복원도 확인한다. 무료 플랜의 자동 백업 제공 여부를 가정하지 않으며, 파일 없는 DB 백업만으로 사진을 복구할 수 없다는 점을 운영 절차에 반영한다. 원본을 저장하지 않는 경우 사용자가 가진 사진 원본은 별도로 보관한다.

## 10. 선택 이유와 조정 조건

추천안은 한 명이 화면·데이터·배포를 관리하는 상황을 기준으로 한다. 기존에 Spring Boot나 Django에 익숙하다면 해당 서버와 PostgreSQL을 사용하는 선택도 가능하지만, 인증·사진 저장·배포 운영을 직접 구성할 범위가 늘어난다.

초기에는 서비스 기능을 만드는 데 집중하고, 기술 추가는 실제 필요가 생길 때 결정한다. 구현 시작 순서는 **로그인·공간 권한 → 사진 한 장이 포함된 추억 등록 → 두 계정 조회 → 맛집 → 꾸미기**를 권장한다.

서비스 요구사항과 출시 범위는 [PROJECT_PLAN.md](./PROJECT_PLAN.md)를 참고한다.
