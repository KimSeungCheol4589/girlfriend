# 로컬 DB 개발환경 — ENV-DB-001

확인일: 2026-09-19. 담당 브랜치: `feat/db-foundation`. 개발·통합 기준: `origin/dev`, PR base: `dev`.

## 현재 결과

**프로젝트 전용 로컬 DB 환경 실행·기본 검증 완료.** Docker 서버 29.6.1에서 PostgreSQL 17.6, Auth, REST, Storage, API gateway, 테스트 메일 서비스가 실행 중이다. SQL `SELECT 1`과 Auth·REST·Storage HTTP 200 응답을 확인했다. 외부 publish 포트 3개는 실제 Docker bindings 및 Windows 리스너 모두 `127.0.0.1`로 제한했다.

**제품 migration·RLS·초대·로그인 흐름 검증은 미실행**이다. public 기본 테이블 수는 0이며 제품 SQL을 작성하거나 적용하지 않았다. 운영 DB·계정·자격 증명은 사용하지 않았고 Claude 호출도 하지 않았다. 이번 환경 준비 성공이 DB-001 구현 완료를 의미하지 않는다.

최신 `origin/dev`의 `4767bc7`을 담당 브랜치에 병합해 작업을 보존했다. main에 변경을 반영하지 않았다. 이번 재개 작업의 추적 변경은 이 문서이며 도구·설정·로컬 실행 자료는 Git 제외된 `.agent-runtime/`에 있다.

## 서비스와 접속

공통 컨테이너 접미사는 `_girlfriend-db-env-d82f`다. Docker 네트워크와 Supabase project_id는 `girlfriend-db-env-d82f`다.

| 서비스 | 컨테이너 접두사 | 호스트 접속 | 실제 결과 |
| --- | --- | --- | --- |
| PostgreSQL 17.6 | supabase_db | 127.0.0.1:56322 | healthy, SELECT 1 → 1 |
| API gateway | supabase_kong | http://127.0.0.1:56321 | healthy |
| Auth | supabase_auth | API /auth/v1/health | healthy, HTTP 200 |
| REST | supabase_rest | API /rest/v1/ | running, HTTP 200; 이미지 healthcheck 없음 |
| Storage | supabase_storage | API /storage/v1/status | healthy, HTTP 200 |
| Mailpit | supabase_inbucket | http://127.0.0.1:56324 | healthy, 외부 이메일 전송 없음 |

Auth·REST·Storage는 별도 호스트 포트를 publish하지 않는다. Studio·Realtime·분석·Edge Runtime·풀러·imgproxy는 제외했다. 별도 shadow DB 후보 포트는 56320이며 현재 리스너는 생성하지 않았다.

## 도구·설정 위치

- Node v22.22.3, npm 10.9.8, Supabase CLI 2.117.0.
- CLI: `.agent-runtime/db-tools/node_modules/.bin/supabase.cmd`
- 고정 도구 의존성: `.agent-runtime/db-tools/package.json`, `package-lock.json`
- npm 캐시: `.agent-runtime/npm-cache`
- Supabase runtime home: `.agent-runtime/supabase-home`
- sandbox 설정: `.agent-runtime/db-sandbox/supabase/config.toml`
- 제품 루트의 Supabase 설정이나 앱 package.json/lockfile은 수정하지 않았다.

```powershell
# 담당 Worktree 루트
$env:SUPABASE_HOME = Join-Path (Get-Location) '.agent-runtime/supabase-home'
$env:SUPABASE_TELEMETRY_DISABLED = '1'
$taskSupabase = Join-Path (Get-Location) '.agent-runtime/db-tools/node_modules/.bin/supabase.cmd'
& $taskSupabase --version
```

환경 변수는 해당 프로세스에만 적용한다. CLI 재설치는 `npm.cmd install --prefix .agent-runtime/db-tools --save-exact supabase@2.117.0 --cache .agent-runtime/npm-cache --offline=false --no-audit --no-fund`로 가능하다. CLI home을 지정하지 않으면 사용자 홈에 쓰기를 시도하므로 위 설정을 유지한다.

## 시작·종료 — 현재 만들어진 환경 보존

현재 환경은 실행 중이다. 아래 명령은 이 작업이 만든 6개 활성 컨테이너만 대상으로 하며 중지해도 데이터 볼륨을 지우지 않는다. **pre-loopback 접미사의 백업 컨테이너는 시작하지 않는다.** 동일 DB 볼륨을 공유하므로 활성 DB와 동시에 실행하면 안 된다.

```powershell
# 보존된 환경 다시 시작
$taskDb = 'supabase_db_girlfriend-db-env-d82f'
$taskServices = @(
  'supabase_inbucket_girlfriend-db-env-d82f',
  'supabase_auth_girlfriend-db-env-d82f',
  'supabase_rest_girlfriend-db-env-d82f',
  'supabase_storage_girlfriend-db-env-d82f',
  'supabase_kong_girlfriend-db-env-d82f'
)
docker start $taskDb
docker exec $taskDb pg_isready -U postgres -d postgres
# pg_isready 성공 후 실행
docker start $taskServices

# 필요할 때만 이 환경 종료. 볼륨·컨테이너 삭제 없음.
docker stop $taskServices
docker stop $taskDb
```

현재 환경을 유지할 때는 위 Docker start/stop을 사용한다. Supabase stop/reset 또는 CLI 재생성은 loopback 수정과 내부 상태를 재작성할 수 있으므로 무심코 실행하지 않는다. stop/start 왕복은 최종 정상 상태에서 추가 실행하지 않았으며, 아래 바인딩 수정 때의 실제 컨테이너 기동과 health를 검증했다.

## 검증 명령과 증거

```powershell
docker version --format '{{.Server.Version}}'
docker ps --filter name=girlfriend-db-env-d82f --format '{{.Names}} {{.Status}} {{.Ports}}'
docker exec supabase_db_girlfriend-db-env-d82f psql -U postgres -d postgres -Atc 'SELECT 1; SHOW server_version;'
# SQL 대화형 접속: 비밀번호를 명령행에 넣지 않음
docker exec -it supabase_db_girlfriend-db-env-d82f psql -U postgres -d postgres

# 키는 메모리에서만 사용하며 결과 본문/키는 출력하지 않음
$taskStatusRaw = & $taskSupabase --workdir .agent-runtime/db-sandbox status -o json
$taskStatus = $taskStatusRaw | ConvertFrom-Json
$taskHeaders = @{ apikey = $taskStatus.ANON_KEY }
foreach ($taskRoute in @('/auth/v1/health','/rest/v1/','/storage/v1/status')) {
  $taskResponse = Invoke-WebRequest -UseBasicParsing -Uri ('http://127.0.0.1:56321'+$taskRoute) -Headers $taskHeaders -TimeoutSec 15
  Write-Output ($taskRoute+' HTTP '+$taskResponse.StatusCode)
}
```

바인딩 수정 후 실제 결과:

- Docker server: 29.6.1. SQL 결과: 1, server_version: 17.6.
- Auth /auth/v1/health: 200, REST /rest/v1/: 200, Storage /storage/v1/status: 200.
- public BASE TABLE 수: 0. 테스트 계정·제품 데이터는 생성하지 않았다.
- `docker ps`: 127.0.0.1:56321→8000, 127.0.0.1:56322→5432, 127.0.0.1:56324→8025.
- Windows `Get-NetTCPConnection -State Listen`: 위 세 포트의 LocalAddress가 모두 127.0.0.1. IPv6/전체 인터페이스 리스너 없음.
- 컨테이너 메모리 합계 약 304 MiB(유휴 시점), Docker VM 보고 한도 7.533 GiB. 부하 상황의 최대 사용량은 미측정.
- git diff --check 실행. 새 제품 코드는 없으며 별도 Claude 코드 검토 대상도 없다.

CLI status/start 결과에는 로컬 키가 포함될 수 있다. 원시 출력을 공유하거나 저장소에 커밋하지 않는다. 초기 시작 출력은 `.agent-runtime/`에만 보관했고 보고서·사용자 출력에 키/토큰을 기록하지 않았다.

## localhost 수정 이력과 재생성 한계

CLI의 `start --help`에는 bind-address 옵션이 없었다. 공식 Docker bridge 옵션 `com.docker.network.bridge.host_binding_ipv4=127.0.0.1`로 전용 네트워크를 생성하고 CLI `--network-id`에 지정했으나, 이 환경의 실제 최초 포트는 `0.0.0.0`/`[::]`로 publish됐다. 네트워크 옵션 자체는 inspect에서 확인됐으므로 실제 리스너 검증이 필요하다.

수정 절차는 이번에 만든 DB/Kong/Mailpit 3개만 일시 중지한 뒤 Docker Engine API로 기존 설정·named volume을 보존하고 `HostConfig.PortBindings[*].HostIp=127.0.0.1`을 명시해 새 컨테이너를 만든 것이다. DB의 `/etc/postgresql`, `/etc/postgresql-custom`, schema 파일과 Kong의 `/home/kong` 내부 설정은 archive API로 메모리 안에서 전달했다. 키 내용을 출력하지 않았다. 다른 프로젝트·전역 Docker 설정·OS 방화벽은 변경하지 않았다.

원본 3개는 이름 뒤에 `-pre-loopback`을 붙여 **중지된 백업**으로 남겼다. 기존 볼륨과 데이터는 삭제하지 않았다. `.agent-runtime/db-loopback.cjs`는 당시 수정용 스크립트이며 재실행용이 아니다. 백업 이름 충돌과 현재 running 상태를 무시하여 재호출하지 않는다.

완전히 새 환경을 만들 경우 `supabase init/start`만으로 localhost 제한이 보장되지 않는다. 이번과 같은 전용 project_id·포트·서비스 제외 설정을 적용하고, 컨테이너 재생성이 필요하면 이 바인딩 보정도 별도 수행한 다음 실제 포트와 health를 검증해야 한다. 현재 정상 환경에서는 불필요하게 재생성하지 않는다.

최초 실행 명령(이력이며 현재 재실행 불필요):

```powershell
& $taskSupabase --workdir .agent-runtime/db-sandbox init
# config.toml에 project_id/5632x 포트와 불필요 서비스 비활성화 적용 후
& $taskSupabase --workdir .agent-runtime/db-sandbox --network-id girlfriend-db-env-d82f start --exclude realtime,studio,postgres-meta,edge-runtime,logflare,vector,supavisor,imgproxy
```

## 이전 차단과 인수인계

이전 Docker Desktop 숨김 시작 1회는 Inference manager의 dockerInference 소켓 처리 오류로 실패했다. 사용자가 Docker를 직접 켰다고 알린 뒤 서버 응답을 확인해 이번 실행을 재개했다. 이번 재개에서는 Docker Desktop 재시작·초기화·OS 변경을 하지 않았다. 첫 조사에서 WSL2 등록과 하이퍼바이저 존재를 확인했으며 더 이상의 가상화 설정 변경은 필요하지 않았다.

**환경 준비 완료, 제품 검증 대기.** 총괄은 이 로컬 환경에 후속 Claude migration을 전달한 뒤 실제 RLS·초대·동시성·업로드 검증을 별도로 배정할 수 있다. main 직접 반영은 금지하며 dev 통합 후 main 승격은 사용자 결정과 총괄 담당이다.

공식 참고: [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started), [CLI home](https://github.com/supabase/cli/blob/develop/apps/cli/docs/supabase-home.md), [Docker bridge 바인딩](https://docs.docker.com/engine/network/drivers/bridge/).
