# ENV-APP-001 실행 인계

- 작업: Node 22·pnpm 고정·Next.js 골격·Dev Container 설정·설치/build 검증
- 브랜치: feat/ui-foundation
- 상태: 구현·실제 컨테이너 검증·독립 검토 승인 완료, 통합 준비
- 최종 환경 코드 검토 대상: d429216a9d68f67b13fbb76f6c5d6df9f9d7a641
- 기존 Claude 구현 세션: c11ca53a-79f5-4ea1-ab2c-6992f28faf08

## 변경과 검증

Next.js 앱 골격·lockfile·검사 스크립트와 홈·추억·꾸미기 데모 UI는 앞선 제출에서 완료했다. 이번 후속 제품 변경은 .devcontainer/devcontainer.json 하나다. 실제 설정 파일을 기존 Claude가 작성했고, Codex가 파일별 정상 승인과 검증·커밋을 관리했다. Codex가 제품 코드를 대신 작성하지 않았다.

보호 경로에 대한 dontAsk 거부 원인을 확인했다. 대화형 CLI는 초기 환경 설정 화면에서 종료하고 공식 SDK 기본 권한 모드의 개별 승인 요청을 사용했다. 정확한 Write/Edit 내용을 검토해 일회 승인했으며 호스트 전역 설정이나 권한 우회 플래그를 사용하지 않았다. 입력이 닫힌 최초 SDK 실행은 파일 승인 전에 종료했다. 원시 실행·승인 로그는 git에서 제외한 .agent-runtime에 있다.

초기 실제 기동에서 pnpm store가 호스트로 유출되는 문제를 발견해 컨테이너 전용 storeDir로 고쳤다. 이후 초기화 중 발견한 PNPM_HOME/bin PATH 누락도 Claude가 수정했다. 최종 설정으로 새 컨테이너를 생성해 재검증했다.

| 검증 | 결과 |
| --- | --- |
| Docker / Dev Container CLI | 29.6.1 / 0.89.0, 생성·기동·lifecycle 모두 성공 |
| 사용자 / Node / pnpm | node UID 1000 / 22.16.0 / 11.19.0 |
| 설치 | frozen 신규 설치와 frozen/offline 재설치 통과 |
| store 격리 | /home/node/.pnpm/store/v11, 호스트 .pnpm-store 없음 |
| 타입·lint·단위 테스트·production build | 통과, 단위 테스트 110개 |
| production HTTP smoke | 14개 통과, 검증 서버 종료 |
| 컨테이너 실제 설정 | 비루트, privileged=false, 소켓 마운트 없음, 호스트 포트 publish 없음 |

상세 실행·재개 방법과 범위는 [앱 환경 문서 10절](../environments/APP.md)에 있다. 첫 실행에서 생성된 호스트 캐시는 무시된 임시 폴더에 보관했다. 다른 작업의 DB 컨테이너는 변경하지 않았다.

## 검토 이력

- UI 기반 1·2차 독립 검토에서 발견한 문제를 수정했다. 상세는 [UI-001](./UI-001.md).
- UI 최종 제품 87d99e4ab6f87da70e9a551efb2f280dda3f8268은 새 읽기 전용 Claude 세션 cd237114-7d04-438b-ba4f-5ee44d47e9d5가 승인했다.
- 이번 컨테이너 변경은 기준 95221682e5c3dc00562f4de0a245dc5f581b6c52부터 최종 d429216a9d68f67b13fbb76f6c5d6df9f9d7a641까지 별도 새 읽기 전용 Claude 호출로 검토 중이다.

## 미실행·제한

- Dockerfile을 별도로 빌드하는 구성이 아니라 공식 Node 22 이미지를 사용한다. 이미지 digest는 고정하지 않아 향후 Node 패치 버전은 달라질 수 있다.
- 컨테이너 내부 Playwright 브라우저, VS Code 확장 설치 및 실제 포트 포워딩은 미검증이다. UI의 기존 호스트 Chromium 검증과 구분한다.
- Windows worktree 외부 Git 메타데이터를 마운트하지 않는다. Git 작업은 호스트에서 수행한다.
- 로그인·실제 저장·사진 업로드·배포는 이번 후속 범위 밖이다.
- Vite 설정의 기존 CommonJS 경고는 남아 있으나 테스트는 통과한다.

## 통합 준비

컨테이너 구현과 필수 실행 검증, 별도 독립 검토 승인을 완료했다. 총괄 통합 검토에 제출 가능하며 main/dev 직접 통합은 수행하지 않는다.

1차 환경 독립 검토 ecffae53-1747-4bf2-b50b-abe9db5204fa의 P2 4건은 설치 명령별 confirmModulesPurge 옵션, .next 전용 볼륨, fallback store 무시 및 문서 정리로 처리했다. 추천된 전역 confirmModulesPurge 설정은 pnpm 11이 거부해 명령 옵션으로 수정하고 실제 지원을 확인했다. 기존 볼륨을 유지한 최종 컨테이너 재생성·lifecycle이 통과했다. 수정본은 별도의 새 읽기 전용 검토 대상으로 제출한다.

## 최종 독립 검토 승인

새 읽기 전용 Claude 세션 0535630f-1df7-498b-805e-c149990fae08이 검토 head 9e97aa27b072ebdd49e76d788ce06870c16c841a(제품 코드 d429216a9d68f67b13fbb76f6c5d6df9f9d7a641)를 APPROVE, 차단 결함 없음으로 판정했다. ENV-3-1~4 해결을 코드·실제 검증 로그와 대조했다. 검토자의 직접 Docker 재실행은 없었고 Codex 실행 로그를 읽었다.

최종 .next 격리 후 build·typecheck·HTTP 14개를 다시 통과했다. 컨테이너 빌드 전후 호스트 BUILD_ID의 SHA-256이 동일했다. 컨테이너 실제 마운트 3개(node_modules, pnpm, .next), 비루트·privileged=false·호스트 publish 없음 확인 후 이 작업의 앱 컨테이너만 중지했고 볼륨은 유지했다.

비차단 검토 의견: 기존 볼륨 rebuild는 통과했으나 설정 불일치로 purge가 실제 발동하는 분기는 별도 재현하지 않았다. 최초 기동 뒤 검사 전에 build 1회를 수행한다. UI 인계의 과거 차단 두 문장은 대체했다. 이번 승인 뒤 변경은 이 검토 결과와 안내를 기록하는 문서뿐이다.
