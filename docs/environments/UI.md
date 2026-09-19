# UI 개발환경 — ENV-UI-001

검증일: 2026-09-19. 담당 브랜치: feat/ui-foundation.
현재 환경은 Windows PowerShell의 기존 Node 런타임과 독립 Git Worktree다. 별도 VM·컨테이너를 생성하지 않았다. 제품 구현은 총괄이 지정 Claude 세션에 전달하며 이 작업에서는 Claude를 호출하지 않았다.

## 준비 결과

- 깨끗한 작업 트리에서 main 70bef23을 병합했다. 병합 커밋: 2dc691f9a4467934389a55a4ec9bc50989b0715b.
- 시스템 Node v22.22.3, npm 10.9.8 실제 실행 확인.
- Codex fallback pnpm은 11.19.0으로 실제 실행 가능했다. 경로는 `Get-Command pnpm`으로 확인한다.
- fallback 경로 수명에 의존하지 않도록 pnpm 11.19.0을 `.agent-runtime/tools`에 정확한 버전으로 설치했다. 글로벌 설치·설정 변경 없음.
- 임시 설치·캐시·store·lockfile은 모두 Git 제외 대상 `.agent-runtime/` 아래에 둔다.
- 앱 루트 package.json, lockfile, src, node_modules는 생성하지 않았다.

## 재현 명령

모든 명령은 **담당 Worktree 루트**에서 실행한다. 실행 전 위치·브랜치·상태를 확인한다.

```powershell
Get-Location
git status --short
git branch --show-current
node --version
npm --version
pnpm --version

npm install --prefix .agent-runtime/tools pnpm@11.19.0 --save-exact --ignore-scripts --no-audit --no-fund --cache .agent-runtime/npm-cache --offline=false --fetch-retries=0 --fetch-timeout=20000
node .agent-runtime/tools/node_modules/pnpm/bin/pnpm.cjs --version

New-Item -ItemType Directory -Force .agent-runtime/smoke | Out-Null
'{"name":"env-ui-001-smoke","private":true,"version":"0.0.0","packageManager":"pnpm@11.19.0"}' | Set-Content -Encoding utf8 .agent-runtime/smoke/package.json
$taskRuntime = Join-Path (Get-Location) '.agent-runtime'
node .agent-runtime/tools/node_modules/pnpm/bin/pnpm.cjs --dir .agent-runtime/smoke add is-number@7.0.0 --save-exact --ignore-scripts --store-dir "$taskRuntime/pnpm-store" --cache-dir "$taskRuntime/pnpm-cache" --config.state-dir="$taskRuntime/pnpm-state" --offline=false --fetch-retries=0 --fetch-timeout=20000
node -e 'const assert=require("node:assert/strict"); const n=require("./.agent-runtime/smoke/node_modules/is-number"); assert.equal(n(42),true); assert.equal(n("hello"),false); console.log("ENV-UI-001 NODE_PACKAGE_SMOKE_PASS",process.version,require.resolve("./.agent-runtime/smoke/node_modules/is-number"));'
node .agent-runtime/tools/node_modules/pnpm/bin/pnpm.cjs --dir .agent-runtime/smoke install --frozen-lockfile --offline --ignore-scripts --store-dir "$taskRuntime/pnpm-store" --cache-dir "$taskRuntime/pnpm-cache" --config.state-dir="$taskRuntime/pnpm-state"
```

네트워크 연결이 필요한 위 npm 설치와 pnpm add는 승인된 확장 권한으로 실행했다.

## 실제 검증과 제한

| 항목 | 결과 |
| --- | --- |
| 기본 npm 설치 | ENOTCACHED: 환경의 only-if-cached 제한으로 실패 |
| 명시적 offline=false + 승인된 확장 권한의 npm 설치 | pnpm 11.19.0 설치 성공 |
| 로컬 pnpm 버전 | 11.19.0 |
| pnpm 임시 패키지 설치 | is-number 7.0.0 다운로드·설치 성공 |
| Node 패키지 실행 | 숫자 true, 일반 문자열 false 단언 통과 |
| frozen-lockfile + offline 설치 | 성공 |
| 패키지 경로 | 이 Worktree의 .agent-runtime/smoke/node_modules/.pnpm 안으로 해석됨 |
| Git 제외 확인 | tools/package.json, smoke/package.json, smoke/pnpm-lock.yaml 모두 제외됨 |
| 3000·3001 TCP 조회 | netstat와 .NET TCP listener 조회 모두 점유 없음 |
| Get-NetTCPConnection | 샌드박스 접근 거부. 읽기 전용 대체 조회로 확인 |

첫 pnpm 명령의 `--state-dir`는 지원되지 않아 실패했다. `--config.state-dir=...`로 수정 후 성공했다. 원인을 확인한 수정 호출이며 같은 실패를 반복하지 않았다.

포트 조회 명령:

```powershell
netstat -ano -p tcp | Select-String ':3000\s|:3001\s'
[System.Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners() | Where-Object { $_.Port -in 3000,3001 }
```

포트 배정은 총괄 3000, UI 3001이다. 이번에는 조회만 했으며 bind·HTTP 서버 실행은 하지 않았다. 조회 시점의 빈 포트가 이후에도 보장되는 것은 아니다.

## 제품 구현 이후 사용 방안 — 아직 미실행

Claude가 생성할 앱 package.json에 `"packageManager": "pnpm@11.19.0"`을 명시하고 pnpm-lock.yaml을 커밋한다. 다른 담당자가 앱 설치 전에 동일 버전을 준비한다. node_modules는 각 Worktree에서 별도로 설치하며 다른 Worktree의 node_modules를 연결하거나 복사하지 않는다. store/cache도 아래처럼 각 Worktree에 둔다.

```powershell
$taskRuntime = Join-Path (Get-Location) '.agent-runtime'
node .agent-runtime/tools/node_modules/pnpm/bin/pnpm.cjs install --frozen-lockfile --store-dir "$taskRuntime/pnpm-store" --cache-dir "$taskRuntime/pnpm-cache" --config.state-dir="$taskRuntime/pnpm-state" --offline=false
node .agent-runtime/tools/node_modules/pnpm/bin/pnpm.cjs exec next dev --port 3001
```

실제 앱 의존성 설치, Next.js 개발 서버·브라우저 UI, lint·타입·build는 앱 미생성으로 미실행이다. Next.js 및 네이티브 의존성 설치 스크립트 승인 요구는 제품 의존성을 정한 뒤 확인해야 한다. 이번 ignore-scripts 검증이 앱 빌드 검증을 대신하지 않는다. pnpm 버전 변경은 공통 lockfile 소유자인 총괄과 조율한다.
