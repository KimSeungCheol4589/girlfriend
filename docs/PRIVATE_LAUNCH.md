# 두 사람 전용 비공개 출시

작성: 2026-09-26. 준비 기준: dev `d443ad2`. **아직 배포하지 않았다.**

사용자는 계정과 도메인이 없는 첫 프로젝트다. 이번 요청으로 비공개 출시 준비·배포가 새 범위에 포함됐다. 기존 MVP의 배포 금지는 이전 작업 범위였으며, 유료 구매·무제한 공개 가입·main 자동 승격을 허용한 것은 아니다.

## 현재 상태

- 완료: 로컬 MVP 구현·독립 검토·QA, 운영 설정 항목 조사, migration 22개 확인.
- 대기: 사용자의 Vercel·Supabase 계정 가입 및 로그인. 약관 동의·새 인증정보 입력은 사용자가 직접 한다.
- 미실행: 클라우드 프로젝트 생성, 운영 DB 적용, 계정 두 개 준비, SMTP, 웹 배포, 운영 접근 차단 및 실기기 확인.
- 별도 도메인 구매 없이 호스팅 기본 HTTPS 주소로 시작한다. 무료 범위를 우선하며 유료 전환은 별도 결정한다.

## 계정 준비

1. https://vercel.com/signup 에서 본인 계정으로 가입한다. GitHub 연결이 필요하면 girlfriend 저장소에 필요한 범위만 확인한다.
2. https://supabase.com/dashboard 에서 본인 계정으로 가입한다.
3. 비밀번호·복구 코드·API 키는 대화나 저장소에 적지 않는다. 필요한 비밀은 서비스의 환경 변수 입력란에서 설정한다.

두 사람의 앱 로그인 계정은 위 개발 서비스 계정과 별개다. 상대방에게 Vercel/Supabase 관리자 권한을 줄 필요는 없다.

## 배포 구성

- Vercel: Next.js, Node 22.x, 저장소의 pnpm 11.19.0 및 frozen lockfile을 유지한다. Corepack 사용 방식과 실제 빌드 로그의 버전을 확인한다. `>=22`만 보고 최신 Node를 자동 선택하지 않는다.
- 새 Supabase 운영 프로젝트: 로컬 개발 DB와 분리한다. 기존 사용자 데이터나 테스트 fixture를 복사하지 않는다.
- `supabase/migrations`의 22개 SQL을 파일명 순으로 검토·적용하고 적용 이력을 확인한다. 최초 파일은 `20260919120100_foundation.sql`, 마지막은 `20260925120100_memory_links_date001.sql`이다. 기존 프로젝트로 변경되면 빈 DB라고 가정하지 않는다.
- 운영 코드 후보는 검증된 커밋으로 고정한다. main 승격과 자동 배포 브랜치 정책은 배포 전에 명시적으로 확정한다. Preview에는 운영 비밀을 제공하지 않는다.

| 운영 환경 변수 | 설정 |
| --- | --- |
| NEXT_PUBLIC_SUPABASE_URL | 새 운영 프로젝트 API URL |
| NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY | 해당 프로젝트 공개용 키 |
| NEXT_PUBLIC_SITE_URL | 실제 배포의 정규 HTTPS 출처 |
| MEM_SUPABASE_SERVICE_ROLE_KEY | 사진 확정·정리용 서버 비밀; Production 범위에만 설정 |
| NEXT_PUBLIC_DEMO_MODE | true 금지; 미설정 또는 false |

AUTH_TEST_* 등 테스트 전용 키·픽스처는 운영에 넣지 않는다. 미리보기와 운영 주소를 혼용하지 않는다.

## 두 사람만 접근하도록 설정

1. 공개 신규 가입과 익명 로그인을 끄고, 사용하지 않는 OAuth 제공자는 활성화하지 않는다. 직접 Auth API 가입도 차단되는지 확인한다.
2. 운영자가 지정된 두 사용자만 준비한다. 새 비밀번호 설정·이메일 확인은 당사자가 수행한다.
3. 첫 사용자만 bootstrap creator로 허용하고, 공간 생성 후 그 권한을 회수한다. 상대 계정은 기존 일회용 초대로 참여한다. 시작일은 2025-01-27이다.
4. Storage `space-assets`는 비공개이며 RLS와 두 명 정원을 확인한다. 로그인 화면은 인터넷에 보일 수 있지만 기록·사진은 인증된 구성원만 볼 수 있어야 한다.
5. Supabase Site URL과 `/auth/callback`, `/auth/confirm`의 정확한 redirect 주소를 설정한다.

세부 절차는 [인증 설정](auth/SETUP.md)을 따른다. 서비스 가입을 막는 것과 사진 접근 권한을 검증하는 것은 별도다.

## 이메일과 운영 점검

Supabase 기본 메일은 프로젝트 팀 주소로 수신이 제한되므로 두 앱 사용자의 비밀번호 재설정 수단으로 가정하지 않는다. custom SMTP 및 발신자 검증을 준비하고 실제 수신·링크 복귀를 확인한다. 서비스 관리자 권한을 상대에게 주는 방식으로 제한을 우회하지 않는다. SMTP 제공자의 도메인 요구·무료 범위·비용을 확인한 뒤 결정한다.

출시 판정은 다음 확인 후 기록한다.

- 두 실제 기기의 로그인·로그아웃·재로그인 및 비밀번호 복구.
- 서로 기록·사진·일정 조회, 개인 일정 수정 권한, 공동 수정 및 충돌 처리.
- 비로그인·외부 사용자에 대한 데이터/사진 접근 차단, 직접 가입 차단, 세 번째 구성원 거부.
- 합성 사진으로 업로드·보기·삭제, 실패 안내, 휴대폰 사진 형식 확인.
- 운영 DB와 Storage의 별도 백업 보관 위치·담당·복원 절차 확정. 자동 복원 도구의 ACL 표현 비교 미완료를 운영 자동 복구 성공으로 취급하지 않는다.
- 업로드 잔여물 정리는 [기존 수동 절차](memories/CLEANUP.md)부터 적용한다. 정리 대상·백업 확인 없이 전역 삭제를 실행하지 않는다.
- 배포 SHA, 주소, 설정 확인 결과와 미실행 항목을 기록한 뒤 사용 시작을 안내한다.

## 확인한 공식 문서

- [Vercel package managers](https://vercel.com/docs/package-managers)
- [Supabase 가입 설정](https://supabase.com/docs/guides/auth/general-configuration)
- [Supabase SMTP](https://supabase.com/docs/guides/auth/auth-smtp)

계정·인증 준비 전에는 배포 완료로 표시하지 않는다. 후속 공개 가입 확장은 별도 작업이다.

## 2026-09-26 사용자 승인에 따른 출시 진행

- 사용자가 Vercel/Supabase 가입·프로젝트 생성을 완료했다. Vercel `ksclove4589-1067/girlfriend`, Supabase `geufwhgbchcouqwtehld`.
- 사용자의 명시적 main 승격 승인 후 검증된 MVP와 준비 문서 `e2a447b1ff3e9c9f37ea789307ed3a6e34b38f65`를 원격 main에 fast-forward push했다. 개발 checkout은 dev 유지.
- Vercel Framework Next.js 저장 확인, Node22 설정 저장. 실제 빌드 런타임은 package.json engines 범위 때문에 별도 확인 필요.
- Supabase 공개 신규 가입 OFF 저장 및 재조회 확인. 운영 migration·키 연결·두 사용자 계정·SMTP·접근 제어 실검증은 미완료.
- Vercel 빌드 `Dxdv1xNg9ZWzu1pHmuac1NxDkYtJ` 생성 확인. 배포 성공과 서비스 출시 완료는 별도 판정한다.
- 배포 결과: Ready, 약 1분17초. https://girlfriend-ruddy.vercel.app 에서 실제 앱의 ‘설정이 필요합니다’ 화면 확인. 운영 Supabase URL/공개 키가 없어 로그인·공간 사용은 차단됨. 배포 성공이며 아직 서비스 출시 완료 아님.
