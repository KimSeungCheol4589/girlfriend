# 앱 환경 — ENV-APP-001

작성일: 2026-09-19 · 담당 브랜치: feat/ui-foundation · 기준 커밋: f073d1f
구현 세션 ID: `c11ca53a-79f5-4ea1-ab2c-6992f28faf08` (로컬 Claude Code 구현 세션)

이 문서는 저장소에 실제로 생성한 Next.js 앱의 환경 구성과 **직접 실행해서 확인한 결과**를 적는다.
실행하지 않은 검증은 아래 ‘미실행 검증’에 그대로 남긴다.

> 이 세션은 커밋·push를 하지 않았다. 아래 파일은 모두 작업 트리에 생성만 되어 있고 아직 커밋되지 않았다.
> `pnpm-lock.yaml`도 생성만 된 상태이며 커밋은 총괄이 수행한다.

## 1. 런타임과 패키지 매니저

| 항목 | 값 | 확인 방법 |
| --- | --- | --- |
| Node.js | v22.22.3 | `node --version` 실행 확인 |
| 패키지 매니저 | pnpm 11.19.0 | `package.json`의 `"packageManager": "pnpm@11.19.0"`, 로컬 pnpm 실행 확인 |
| lockfile | `pnpm-lock.yaml` 생성됨 (미커밋) | `pnpm install --frozen-lockfile --offline` 종료 코드 0 |
| node_modules | Worktree 안에 개별 설치 | 다른 Worktree와 공유·복사하지 않음 |
| store / cache | `.agent-runtime/` 아래 (Git 제외) | 설치 명령에 경로를 인자로 전달 |

전역 Node·npm·pnpm 설정은 바꾸지 않았다. 개인 절대 경로를 설정 파일에 넣지 않았다.

### 설치 명령

Worktree 루트에서 실행한다. store·cache 경로는 설정 파일 대신 인자로 넘긴다.

```powershell
node .agent-runtime/tools/node_modules/pnpm/bin/pnpm.cjs install `
  --store-dir .agent-runtime/pnpm-store `
  --cache-dir .agent-runtime/pnpm-cache `
  --config.state-dir=.agent-runtime/pnpm-state `
  --offline=false
```

> `pnpm run <script>`는 실행 전에 의존성 상태를 확인하면서 PATH의 다른 pnpm(내장 Node 24)을 불러
> `Unsupported engine` 경고와 modules 디렉터리 제거 확인을 띄운다.
> 이 세션의 검증은 `--config.verify-deps-before-run=false`를 붙여 Node 22.22.3에서 실행했다.

### 설치 스크립트 정책 — `pnpm-workspace.yaml`

pnpm 11부터 설치 스크립트 허용 여부는 `package.json`이 아니라 `pnpm-workspace.yaml`에서 읽는다.
기본값은 전부 차단이다. 이 저장소는 다음 한 건만 판단 대상이다.

```yaml
allowBuilds:
  unrs-resolver: false
```

`false`로 정한 근거:

- `unrs-resolver`는 `eslint-config-next`가 쓰는 import 해석기의 네이티브 모듈이다.
  플랫폼별 사전 빌드 바인딩(`@unrs/resolver-binding-*`)이 optionalDependencies로 lockfile에 함께 고정되므로
  설치 스크립트 없이도 해석기가 동작한다. 이 Worktree(win32 x64)에서 `pnpm lint`가 오류 0으로 통과하는 것을 확인했다.
- postinstall을 실행하지 않으면 설치 결과가 lockfile만으로 결정되어 frozen install의 재현성이 올라가고,
  설치 중 실행되는 코드도 줄어든다.
- 사전 빌드 바인딩이 없는 플랫폼에서는 lint가 해석기 로드 오류로 **눈에 띄게 실패**한다. 조용히 넘어가지 않는다.
  그런 플랫폼이 나오면 그때 `true`로 바꾼다.

이 값을 정하기 전에는 `pnpm install`이 `ERR_PNPM_IGNORED_BUILDS`로 종료 코드 1을 반환했다.
값을 확정한 뒤 `pnpm install --frozen-lockfile --offline`이 **종료 코드 0**으로 끝나는 것을 확인했다.

## 2. 패키지 버전과 선택 이유

| 패키지 | 버전 | 선택 이유 |
| --- | --- | --- |
| next | 15.5.25 | 유지보수 중인 15.5 안정 라인. Node 22 지원(`engines: >=20`). 16.3.5도 공개돼 있으나 이번 작업은 검증된 라인을 택했다 |
| react / react-dom | 19.3.0 | Next 15.5의 기본 React 19 라인 |
| zod | 4.6.5 | 입력 검증. TECH_STACK.md 2 |
| typescript | 5.9.3 | 5.x 최신 안정. 7.0.x는 도구 호환을 확인하지 않아 제외 |
| tailwindcss | 3.4.19 | `v3-lts` 태그. `tailwind.config.ts` + PostCSS 구성이 필요해 v3를 유지 |
| postcss / autoprefixer | 8.5.28 / 10.6.1 | Tailwind 3 표준 조합 |
| eslint | 9.39.5 | `eslint-config-next@15.5.25`의 peer 범위가 `^7.23 \|\| ^8 \|\| ^9`라 9가 상한이다. 설치 시 ESLint 자체의 지원 종료 안내가 출력되지만 동작에는 문제가 없었다 |
| eslint-config-next | 15.5.25 | next 버전과 맞춤 |
| vitest | 4.1.11 | 날짜·검증 단위 테스트 |
| @playwright/test | 1.63.0 | 모바일·데스크톱 뷰포트 UI 테스트 |

## 3. 스크립트

| 스크립트 | 명령 | 용도 |
| --- | --- | --- |
| `dev` | `next dev --port 3001` | UI 검증 포트 3001 (총괄 통합 앱은 3000) |
| `build` | `next build` | production build |
| `start` | `next start --port 3001` | build 결과 실행 |
| `lint` | `eslint .` | flat config. `next lint`는 쓰지 않는다 |
| `typecheck` | `tsc --noEmit` | 앱과 테스트 전체 |
| `test` | `vitest run` | `tests/unit/**` 단위 테스트 |
| `test:e2e` | `playwright test` | `tests/e2e/**`. 브라우저 설치 필요 |
| `test:smoke` | `node tests/smoke/http-smoke.mjs [baseUrl]` | 이미 떠 있는 서버에 HTTP 요청 |

`next.config.mjs`에서 `eslint.ignoreDuringBuilds: true`로 두어 build가 lint 실패를 가리지 않게 했다. lint는 별도 스크립트로 반드시 실행한다.

> `test:e2e`는 `next dev`를 띄우므로 `.next`가 개발 빌드로 바뀐다.
> 그 뒤에 `start`로 production 서버를 쓰려면 `build`를 다시 실행해야 한다.

## 4. 설정 파일

```text
package.json          스크립트·의존성·packageManager·engines
pnpm-lock.yaml        의존성 고정 (미커밋)
pnpm-workspace.yaml   설치 스크립트 허용 정책 (allowBuilds.unrs-resolver: false)
tsconfig.json         strict + noUncheckedIndexedAccess, @/* 별칭
next.config.mjs       strict mode, 원격 이미지 호스트 없음
tailwind.config.ts    CSS 변수 기반 색상, max-w-content(1120px), spacing.touch(44px)
postcss.config.mjs    tailwindcss + autoprefixer
eslint.config.mjs     flat config + next/core-web-vitals, next/typescript
vitest.config.ts      node 환경, tests/unit만 포함
playwright.config.ts  mobile(Pixel 7) / desktop 프로젝트, webServer로 next dev 기동
```

`.env.example`은 만들지 않았다. 이번 범위에는 환경 변수가 하나도 필요 없고, 환경 변수 예제와 설정 안내는 TASKS.md에서 AUTH-001 담당 범위로 지정돼 있다.

## 5. 실제 실행한 검증

모두 이 Worktree(`feat/ui-foundation`)에서 직접 실행했다.

### 1차 (앱 골격·UI 구현 직후)

| 검증 | 결과 |
| --- | --- |
| `pnpm install` | 386개 패키지 설치 성공 |
| `pnpm run typecheck` | 통과, 오류 0 |
| `pnpm run lint` | 통과, 경고·오류 0 |
| `pnpm run test` | 5개 파일 **90개 테스트** 통과 |
| `pnpm run build` | 성공, 9개 라우트 |
| `pnpm run test:smoke` | **14건** 통과 |
| `pnpm run test:e2e` | Chromium 모바일(Pixel 7)·데스크톱 **14건** 통과 |
| `pnpm install --frozen-lockfile --offline` | 내용은 통과, `allowBuilds` 미확정으로 종료 코드 1 |

### 2차 (커버 미리보기·오류 코드 정리·설치 정책 확정 후)

| 검증 | 결과 |
| --- | --- |
| `pnpm install --frozen-lockfile --offline` | **종료 코드 0** (`allowBuilds` 확정 후) |
| `pnpm run typecheck` | 통과, 오류 0 |
| `pnpm run lint` | 통과, 경고·오류 0 |
| `pnpm run test` | 6개 파일 **107개 테스트** 통과 (커버 17개 추가) |
| `pnpm run build` | 성공, 9개 라우트 |
| `pnpm run test:smoke` | **14건** 통과 (production 서버 재빌드 후) |
| `pnpm run test:e2e` | Chromium 모바일·데스크톱 **22건** 통과 (커버 3건, 가로 넘침 1건 추가) |
| 검증 후 서버 프로세스 정리 | 3001 리스너 종료 확인 |

### HTTP smoke 대상

`/`, `/memories`, `/memories?month=2026-09`, `/memories?month=not-a-month`, `/memories/new`,
`/memories/demo-memory-1`, `/memories/demo-memory-1/edit`, `/memories/does-not-exist`,
`/customize`, `/restaurants`, `/settings`, `/artwork/memory-01.svg`, `/icon.svg`, `/no-such-page`(404).

### build 결과 라우트

```text
○ /                     정적
○ /_not-found           정적
○ /customize            정적
ƒ /memories             동적 (검색 매개변수 사용)
ƒ /memories/[id]        동적
ƒ /memories/[id]/edit   동적
○ /memories/new         정적
○ /restaurants          정적
○ /settings             정적
```

Playwright 브라우저는 `pnpm exec playwright install chromium`으로 내려받았다. 저장 위치는 Playwright 기본 사용자 캐시(`%LOCALAPPDATA%\ms-playwright`)이며 저장소와 전역 도구 설정은 바꾸지 않았다.

## 6. 미실행 검증

아래 항목은 **실행하지 않았다.** 통과로 취급하지 않는다.

| 항목 | 이유 / 재개 조건 |
| --- | --- |
| **Dev Container 전체 (빌드·기동·볼륨·비루트 사용자·pnpm 고정)** | `.devcontainer/devcontainer.json` 파일을 끝내 만들지 못했다(아래 7-1). 설정 파일이 없으므로 Docker 검증도 수행하지 않았다. Docker 엔진 자체의 가용 여부와 무관하게 검증 대상이 존재하지 않는다 |
| Firefox·WebKit | Chromium만 설치·실행했다 |
| 실기기 모바일 확인 | 에뮬레이션 뷰포트(Pixel 7, 1280×900)만 사용했다 |
| 접근성 자동 검사(axe 등)·스크린 리더 | 도구를 도입하지 않았다. 포커스·라벨·대비는 코드와 단위 테스트 수준까지만 확인 |
| Supabase 연동, 로그인, 사진·커버 업로드, 공유 저장 | 이번 작업 범위 밖이다. 앱은 데모 모드다 |
| 보안·권한 검증(RLS, 비로그인 차단 등) | 서버·DB가 없어 검증 대상 자체가 없다 |
| Vercel 배포, CI 파이프라인 | 실행하지 않았다 |
| Node 22 이외 런타임 | 확인하지 않았다 |

## 7. 남은 문제와 후속 작업

### 7-1. `.devcontainer/devcontainer.json` 미생성 — 여전히 차단됨

권한이 열렸다는 안내를 받은 뒤 한 번 더 시도했으나 같은 이유로 거부됐다.
지시에 따라 이 경로에 대한 추가 시도는 중단했다.

```
Write  C:\Users\aica_\.codex\worktrees\863f\private\.devcontainer\devcontainer.json
→ Permission to use Write has been denied (don't ask mode)
```

총 3회 시도, 모두 거부. 파일이 없으므로 컨테이너 빌드·기동 검증도 하지 않았다.

작성하려던 내용은 아래와 같다. 요구사항 대응을 확인할 수 있도록 전문을 남긴다.

```jsonc
{
  "name": "girlfriend app (Node 22)",
  "image": "mcr.microsoft.com/devcontainers/typescript-node:1-22-bookworm",

  // 비루트 사용자. Docker 소켓 마운트·privileged·추가 capability를 쓰지 않는다.
  "remoteUser": "node",
  "containerUser": "node",
  "updateRemoteUserUID": true,

  // node_modules와 pnpm 데이터는 호스트와 공유하지 않는다.
  // ${devcontainerId}는 workspace 경로에서 파생되므로 Worktree마다 볼륨 이름이 다르다.
  "mounts": [
    {
      "source": "girlfriend-node-modules-${devcontainerId}",
      "target": "${containerWorkspaceFolder}/node_modules",
      "type": "volume"
    },
    {
      "source": "girlfriend-pnpm-${devcontainerId}",
      "target": "/home/node/.pnpm",
      "type": "volume"
    }
  ],

  "containerEnv": {
    "PNPM_HOME": "/home/node/.pnpm/home",
    "COREPACK_HOME": "/home/node/.pnpm/corepack",
    "COREPACK_ENABLE_DOWNLOAD_PROMPT": "0",
    "NEXT_TELEMETRY_DISABLED": "1",
    "CI": "true"
  },
  "remoteEnv": {
    "PATH": "${containerEnv:PNPM_HOME}:${containerEnv:PATH}"
  },

  // 1) 새 볼륨은 root 소유로 마운트된다. 설치 전에 소유자를 node로 바꿔 쓰기 가능하게 한다.
  // 2) packageManager 필드의 pnpm@11.19.0을 corepack으로 고정한다. 전역 npm 설치를 쓰지 않는다.
  "onCreateCommand": "sudo chown -R node:node '${containerWorkspaceFolder}/node_modules' /home/node/.pnpm && mkdir -p \"$PNPM_HOME\" \"$COREPACK_HOME\" && corepack enable --install-directory \"$PNPM_HOME\" && corepack prepare pnpm@11.19.0 --activate && pnpm --version",

  "updateContentCommand": "pnpm install --frozen-lockfile",
  "postCreateCommand": "pnpm exec next --version && pnpm exec tsc --version",

  "forwardPorts": [3001],
  "portsAttributes": { "3001": { "label": "next dev (UI)", "onAutoForward": "notify" } },

  "customizations": {
    "vscode": {
      "extensions": ["dbaeumer.vscode-eslint", "bradlc.vscode-tailwindcss"],
      "settings": {
        "typescript.tsdk": "node_modules/typescript/lib",
        "eslint.useFlatConfig": true
      }
    }
  }
}
```

요구사항 대응:

| 요구사항 | 대응 |
| --- | --- |
| 비루트 Node 22 | `typescript-node:1-22-bookworm` + `remoteUser`/`containerUser: node`, `updateRemoteUserUID` |
| Worktree별 고유 볼륨 | `girlfriend-node-modules-${devcontainerId}`, `girlfriend-pnpm-${devcontainerId}` |
| 볼륨 쓰기 권한 | `onCreateCommand`의 `sudo chown -R node:node` (새 볼륨은 root 소유로 마운트되므로 필요) |
| pnpm 고정 기동 | `corepack prepare pnpm@11.19.0 --activate` 후 `pnpm --version` 확인 |
| 신뢰 가능한 의존성 초기화 | `updateContentCommand: pnpm install --frozen-lockfile`, `postCreateCommand`로 실행 확인 |
| Docker 소켓·privileged 없음 | `mounts`에 소켓 없음, `runArgs`·`privileged` 항목 자체가 없음 |

이 파일을 만든 뒤 **실제 컨테이너 빌드·기동까지 수행해야** ENV-APP-001의 Dev Container 항목을 완료로 볼 수 있다.

### 7-2. 해결된 항목

- `pnpm-workspace.yaml`의 `allowBuilds.unrs-resolver`를 `false`로 확정했다. `pnpm install --frozen-lockfile --offline` 종료 코드 0을 확인했다. (1절 참고)
- 중복 설정 파일 `vitest.config.mts`를 삭제했다. 실제 설정은 `vitest.config.ts` 하나다.

### 7-3. 남은 참고 사항

- `vitest.config.ts:1:1`에 Vite의 `configLoader: 'native'` 관련 CommonJS 경고가 남아 있다. 경고일 뿐 테스트 실행에는 영향이 없다. 없애려면 설정을 `.mts`로 옮기거나 `package.json`에 `"type": "module"`을 넣어야 하는데, 다른 설정 파일 로딩에 영향을 주므로 이번에는 건드리지 않았다.
- 설치 시 `eslint@9.39.5` 지원 종료 안내가 출력된다. `eslint-config-next@15.5.25`의 peer 상한이 9라서 의도한 조합이다. Next 16으로 올릴 때 ESLint 메이저와 함께 올린다.
- 포트는 조회 시점 기준으로만 비어 있음을 확인한 것이다. 3001은 이 세션의 검증에서 사용했고 종료 시 프로세스를 정리했다.

## 8. 기존 문서와의 관계

- [UI 환경 문서](./UI.md)의 “실제 앱 의존성 설치, Next.js 개발 서버·브라우저 UI, lint·타입·build는 앱 미생성으로 미실행”이라는 기록은 ENV-UI-001 시점 상태다. 이 문서의 5절 결과가 그 이후 상태다. UI.md는 이 작업의 소유 범위가 아니어서 수정하지 않았다.
- [개발환경 문서](../DEVELOPMENT_ENVIRONMENT.md)의 ‘재현 가능한 컨테이너’ 항목은 여전히 미완료다. 6·7절을 참고한다.

## 9. 공식 참고

- [Next.js 설치 요구사항](https://nextjs.org/docs/app/getting-started/installation)
- [Dev Container 설정 참조](https://containers.dev/implementors/json_reference/)
- [pnpm 설정 위치 변경](https://pnpm.io/settings)
