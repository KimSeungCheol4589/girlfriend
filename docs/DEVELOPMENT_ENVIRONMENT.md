# 격리 개발환경과 작업 배분

## 환경 구성

이 프로젝트는 Next.js/TypeScript 웹 앱이므로 Node.js 의존성과 파일 작업 공간을 분리한다. Python venv는 필요하지 않다.

| 계층 | 구성 | 목적·현재 상태 |
| --- | --- | --- |
| 소스 분리 | 총괄 checkout + UI/DB Worktree | 구성 완료, 각자 브랜치에서 작업 |
| 로컬 런타임 | Node.js 22 | 이 PC의 v22.22.3 실행 확인 |
| 패키지 격리 | Worktree별 node_modules·고정 pnpm | UI 환경 담당이 실제 설치·실행 검증 |
| 재현 가능한 컨테이너 | .devcontainer 구성 | Claude ENV-APP-001에 구현 배정 |
| 로컬 DB | Docker 기반 Supabase 테스트 환경 | Docker 설치 확인, 엔진 실행 가능 여부를 DB 담당이 검증 |
| 운영 데이터 | 개발 환경에서 사용하지 않음 | 테스트 데이터와 로컬 설정으로 진행 |

Worktree는 파일 작업을 분리하며 OS 보안 격리를 제공하지 않는다. Dev Container가 Node 실행 환경을 재현하도록 구성하고, 실제 컨테이너 실행 가능 여부는 별도 검증한다.

## 작업별 담당

- 총괄: 공통 계약, 작업 상태·의존성, 검증·통합, 15분 진행 확인.
- Codex ‘홈, 추억, 꾸미기’: Node·패키지 매니저·포트·실행 검증 준비. 제품 코드는 작성하지 않는다.
- Codex ‘DB’: Docker 엔진·로컬 테스트 DB 실행 환경·도구 확인. 제품 SQL은 작성하지 않는다.
- 지정 Claude ‘구현, 검토’: Dev Container·Next.js 골격부터 구현하고 이후 홈·추억·꾸미기 초기 화면을 작성한다.

외부 Claude 실행 환경과 로컬 Worktree는 같은 파일 시스템이라고 가정하지 않는다. 코드 전달은 GitHub 기능 브랜치·커밋으로 하고, 총괄이 로컬에서 실제 검증한 뒤 dev에 통합한다. main은 사용자 결정이 완료된 범위만 승격한다.

## 앱 환경 계약

- Node 22에 호환되는 안정 Next.js/React/TypeScript 버전을 확인해 설치한다.
- pnpm 버전을 packageManager 필드에 정확히 고정하고 pnpm-lock.yaml을 커밋한다.
- 각 Worktree는 독립적인 node_modules를 사용한다. 컨테이너 의존성 볼륨도 workspace별로 분리한다.
- 전역 Node·npm·pnpm 설정은 수정하지 않는다. 개인 경로는 설정 파일에 하드코딩하지 않는다.
- .env.example은 설정 이름과 예시만 포함하며 실제 .env.local은 커밋하지 않는다.
- `dev`, `lint`, `typecheck`, `build` 스크립트를 제공한다.
- 제안 포트는 통합 앱 3000, UI 검증 3001이다. 실제 포트 점유를 확인하고 충돌 시 명시적으로 다른 포트를 사용한다.
- 기본 Dev Container는 앱 런타임용이다. Docker 소켓을 무조건 마운트하거나 privileged 모드를 사용하지 않는다.

## 검증·완료 기준

1. Node와 고정 패키지 매니저가 실제 실행된다.
2. 프로젝트에 의존성을 설치할 수 있다.
3. Next.js 골격의 타입·lint·production build가 통과한다.
4. 개발 서버가 로컬 HTTP 요청에 응답한다.
5. Dev Container는 빌드·기동을 수행했을 때만 검증 완료로 표시한다.
6. DB는 컨테이너 엔진뿐 아니라 실제 로컬 서비스 준비와 SQL 접속까지 확인해야 실행 준비 완료다.

소스가 아직 없는 단계의 런타임 smoke test를 앱 build 성공과 혼동하지 않는다. 설치되지 않은 도구·사용자 재부팅·가상화 설정이 필요하면 가능한 준비를 완료하고 구체적인 재개 조건을 보고한다.

세부 결과는 docs/environments/UI.md, DB.md, APP.md에 담당별로 작성한다. 아직 파일이 없으면 결과 미제출 상태다.

## 공식 참고

- [Next.js 설치 요구사항](https://nextjs.org/docs/app/getting-started/installation)
- [Supabase 로컬 개발 CLI](https://supabase.com/docs/guides/local-development/cli/getting-started)
