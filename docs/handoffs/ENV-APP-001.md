# ENV-APP-001 실행 인계

- 작업: Node 22·pnpm 고정·Next.js 골격·Dev Container 설정·설치/build 검증
- 브랜치: feat/ui-foundation
- 기준 커밋: f073d1f (이 세션은 커밋하지 않았다)
- 구현 세션 ID: `c11ca53a-79f5-4ea1-ab2c-6992f28faf08` (로컬 Claude Code 구현 세션)
- 상태: **부분 완료.** Dev Container 항목만 도구 권한 거부로 미완료
- 독립 검토: **미실행.** 이 보고서는 구현 세션의 자기 보고이며 독립 검토가 아니다.

## 1. 변경 요약

빈 저장소에 Next.js App Router + TypeScript + Tailwind 앱의 기반을 만들었다.
UI 구현 내용은 [UI-001 보고서](./UI-001.md), 환경 상세는 [docs/environments/APP.md](../environments/APP.md)에 있다.

**커밋·push를 하지 않았다.** 아래 파일은 작업 트리에 존재만 하며 `pnpm-lock.yaml`도 아직 커밋되지 않았다. 커밋은 총괄이 수행한다.

## 2. 추가·변경한 파일 (환경 범위)

```text
package.json            스크립트·의존성·packageManager pnpm@11.19.0·engines node >=22
pnpm-lock.yaml          의존성 고정 (386 패키지, 미커밋)
pnpm-workspace.yaml     설치 스크립트 정책. allowBuilds.unrs-resolver: false 로 확정
tsconfig.json           strict, noUncheckedIndexedAccess, @/* 별칭
next.config.mjs         reactStrictMode, 원격 이미지 호스트 없음, build 중 lint 분리
tailwind.config.ts      CSS 변수 색상, max-w-content 1120px, spacing.touch 44px
postcss.config.mjs      tailwindcss + autoprefixer
eslint.config.mjs       flat config + next/core-web-vitals, next/typescript
vitest.config.ts        node 환경, tests/unit만 포함
playwright.config.ts    모바일/데스크톱 프로젝트, webServer로 next dev 3001 기동
tests/smoke/http-smoke.mjs   로컬 HTTP 상태 코드·문구 확인 스크립트
.gitignore              next-env.d.ts, /test-results, /playwright-report 등 추가

삭제: vitest.config.mts (중복 설정 파일)
미생성: .devcontainer/devcontainer.json (아래 4-1)
```

## 3. 실행한 검증과 결과

### 1차 (앱 골격·UI 구현 직후)

| 검증 | 결과 |
| --- | --- |
| `node --version` | v22.22.3 |
| 고정 pnpm 실행 | 11.19.0 |
| `pnpm install` | 386개 패키지 설치 성공 |
| `pnpm run typecheck` | 통과 (오류 0) |
| `pnpm run lint` | 통과 (오류·경고 0) |
| `pnpm run test` | **90개** 테스트 통과 |
| `pnpm run build` | 성공, 9개 라우트 |
| `pnpm run test:smoke` | **14건** 통과 |
| `pnpm run test:e2e` | 모바일·데스크톱 **14건** 통과 |
| `pnpm install --frozen-lockfile --offline` | 내용 통과, `allowBuilds` 미확정으로 종료 코드 1 |

### 2차 (설치 정책 확정·커버 미리보기·오류 코드 정리 후)

| 검증 | 결과 |
| --- | --- |
| `pnpm install --frozen-lockfile --offline` | **종료 코드 0** |
| `pnpm run typecheck` | 통과 (오류 0) |
| `pnpm run lint` | 통과 (오류·경고 0) |
| `pnpm run test` | 6개 파일 **107개** 테스트 통과 |
| `pnpm run build` | 성공, 9개 라우트 |
| `pnpm run test:smoke` | **14건** 통과 |
| `pnpm run test:e2e` | 모바일·데스크톱 **22건** 통과 |
| 서버 프로세스 정리 | 3001 리스너 종료 확인 |

### 미실행 검증 (통과로 취급하지 않음)

- **Dev Container 빌드·기동·볼륨·비루트 사용자·pnpm 고정 전부.** 설정 파일을 만들지 못해 검증 대상이 없다. Docker 명령도 실행하지 않았다.
- Firefox·WebKit, 실기기 브라우저, 접근성 자동 검사.
- Supabase·인증·업로드·배포·CI 관련 검증 전부. 이번 범위 밖이다.

## 4. 잔여 문제

### 4-1. `.devcontainer/devcontainer.json` 생성 거부 — 미완료

권한이 확장됐다는 안내를 받은 뒤 다시 시도했으나 동일하게 거부됐다. 지시에 따라 추가 시도를 중단했다.

```
Write  C:\Users\aica_\.codex\worktrees\863f\private\.devcontainer\devcontainer.json
→ Permission to use Write has been denied (don't ask mode)
```

총 3회 시도, 모두 거부. 작성하려던 파일 전문과 요구사항 대응표는
[APP.md 7-1](../environments/APP.md#7-1-devcontainerdevcontainerjson-미생성--여전히-차단됨)에 남겼다.
요약: 비루트 `node` 사용자, `${devcontainerId}`로 Worktree마다 갈리는 node_modules·pnpm 볼륨,
`sudo chown`으로 볼륨 쓰기 권한 확보, `corepack prepare pnpm@11.19.0 --activate`,
`pnpm install --frozen-lockfile`, 포트 3001, Docker 소켓·privileged 없음.

파일 생성 후 **실제 컨테이너 빌드·기동까지 수행해야** 이 항목을 완료로 볼 수 있다.

### 4-2. 해결된 항목

| 이전 문제 | 조치 |
| --- | --- |
| `pnpm-workspace.yaml` 자리표시자로 `pnpm install` 종료 코드 1 | `allowBuilds.unrs-resolver: false`로 확정. 근거는 APP.md 1절. frozen/offline 설치 종료 코드 0 확인 |
| `vitest.config.mts` 중복 파일 | 삭제. 실제 설정은 `vitest.config.ts` 하나 |

### 4-3. 참고 사항

- `vitest.config.ts`의 Vite CommonJS 경고가 남아 있다. 경고이며 실행에 영향 없음.
- 설치 시 `eslint@9.39.5` 지원 종료 안내가 출력된다. `eslint-config-next@15.5.25`의 peer 상한이 9라서 의도한 조합이다.
- `pnpm run <script>`는 PATH의 다른 pnpm(내장 Node 24)을 불러 `Unsupported engine` 경고를 낼 수 있다. 검증은 `--config.verify-deps-before-run=false`로 Node 22에서 실행했다.
- `test:e2e`는 `next dev`를 띄우므로 `.next`가 개발 빌드로 바뀐다. 이후 `start`를 쓰려면 `build`를 다시 실행해야 한다.

## 5. 후속 작업

1. 총괄이 `.devcontainer/devcontainer.json`을 만들고 컨테이너 빌드·기동을 검증한다.
2. 변경을 커밋한다(`pnpm-lock.yaml` 포함).
3. 고정된 base/head SHA로 별도 Claude 세션에 읽기 전용 독립 검토를 의뢰한다.

## 6. 통합 준비 여부

앱 골격·의존성·설치 정책·검증 스크립트는 통합 가능한 상태다.
**Dev Container 항목이 미완료이므로 ENV-APP-001 전체를 완료로 표시하면 안 된다.**
독립 검토도 아직 남아 있다.
