# 로컬 DB 개발환경 — ENV-DB-001

확인일: 2026-09-19. 담당 브랜치: `feat/db-foundation`.

## 결과

**도구 준비 완료, 로컬 DB 실행은 차단 상태다.** Docker 서버가 시작되지 않아 PostgreSQL·Auth·Storage는 실행하지 못했다. 제품 SQL·Supabase 프로젝트 설정·migration·계정은 생성하지 않았다. 새 Claude 호출도 하지 않았다.

최신 로컬 main `70bef23`을 담당 브랜치에 충돌 없이 병합했다. 이번 환경 작업의 추적 파일은 이 문서뿐이며 도구·캐시는 Git 제외 경로 `.agent-runtime/`에 둔다. 기존 DB-001 차단 보고서는 유지한다.

## 실행 확인

| 항목 | 결과 |
| --- | --- |
| Docker Desktop | 설치됨, 로그에서 4.81.0 확인 |
| Docker CLI | 29.6.1, context `desktop-linux` |
| Docker 서버 버전 | **미확인** — 엔진 파이프 없음 |
| 시작 시도 | 설치된 Desktop 실행 파일을 `Start-Process -WindowStyle Hidden`으로 1회 실행 |
| 시작 결과 | 백엔드 초기화 중 crash, Docker API 연결 실패 |
| WSL | Ubuntu, docker-desktop, Ubuntu-22.04가 WSL 2로 등록되어 있고 시작 전 모두 Stopped |
| 하이퍼바이저 | Win32_ComputerSystem.HypervisorPresent=true |
| CPU CIM 보고 | VirtualizationFirmwareEnabled=false, SLAT=false. 하이퍼바이저 존재와 함께 관측되므로 이 값만으로 BIOS 가상화 미지원으로 판단하지 않음 |
| Node / npm | v22.22.3 / 10.9.8 |
| Supabase CLI | 2.117.0 설치, `--version`, `init --help`, `start --help` 실행 성공 |
| PostgreSQL·Auth·Storage | 미실행, health check·migration·RLS 검증 미실행 |

초기 제한된 실행의 WSL 조회는 E_ACCESSDENIED였으나 승인된 실행에서는 조회가 성공했다. 이를 WSL 자체 고장으로 분류하지 않는다.

## Docker 차단 원인과 재개 조건

이번 시작 로그의 구체적인 실패는 `starting services: initializing Inference manager` 단계에서 `%LOCALAPPDATA%/Docker/run/dockerInference` 소켓을 제거하거나 리스너를 생성하지 못한 것이다. 오류에는 `The file cannot be accessed by the system`과 `The filename, directory name, or volume label syntax is incorrect`가 포함됐다. 이후 백엔드가 종료되어 DockerDesktopLinuxEngine 파이프가 생기지 않았다.

이는 관측된 직접 실패이며 소켓 오류의 근본 원인은 아직 확인되지 않았다. OS 기능 변경이나 재부팅이 필요하다는 증거는 확보되지 않았다. 공장 초기화·재설치·소켓 삭제·기존 컨테이너 중지/삭제·전역 설정 수정은 수행하지 않았고 동일 시작 실패도 반복하지 않았다.

총괄이 Docker 담당 복구 범위를 정한 뒤 해당 로컬 소켓 상태/권한과 Docker Desktop Inference manager 시작 오류를 확인해야 한다. Docker가 정상화되어 `docker version`의 Server 정보와 `docker ps`가 성공하면 다음 준비를 재개한다. 초기화는 기존 환경에 영향을 주므로 이 문서의 실행 절차에 포함하지 않는다.

## 격리 CLI 사용

공식 npm 레지스트리에서 버전을 확인한 뒤 프로젝트 내부에 고정 설치했다. 앱 package.json·lockfile이나 사용자 전역 npm 설치는 변경하지 않았다.

```powershell
# 담당 Worktree 루트에서 실행
npm.cmd install --prefix .agent-runtime/db-tools --save-exact supabase@2.117.0 --cache .agent-runtime/npm-cache --offline=false --no-audit --no-fund
$env:SUPABASE_HOME = Join-Path (Get-Location) '.agent-runtime/supabase-home'
$env:SUPABASE_TELEMETRY_DISABLED = '1'
$taskSupabase = Join-Path (Get-Location) '.agent-runtime/db-tools/node_modules/.bin/supabase.cmd'
& $taskSupabase --version
```

환경 변수는 해당 PowerShell 프로세스에만 적용한다. `SUPABASE_HOME`을 지정하지 않은 최초 버전 확인은 사용자 홈 디렉터리 생성 권한 오류로 실패했다. 격리 경로를 지정한 후에는 정상 실행됐다. 운영 access token·로그인·원격 프로젝트 link는 필요하지 않으며 사용하지 않았다.

## 엔진 복구 후 프로젝트 전용 실행 계획 — 아직 미실행

1. 현재 Git 상태, Docker Server 응답, 기존 컨테이너와 포트 충돌을 확인한다. 기존 서비스는 건드리지 않는다.
2. `.agent-runtime/db-sandbox`를 만들고 위 격리 CLI로 `--workdir .agent-runtime/db-sandbox init`을 실행한다. 루트 제품 Supabase 설정은 만들지 않는다.
3. 생성된 sandbox 설정에 프로젝트 ID `girlfriend-db-env-d82f`를 부여하고 포트를 별도로 지정한다. 후보는 API 56321, DB 56322, shadow DB 56320, Studio 56323, Mailpit 56324다. 풀러·분석 등 추가 서비스는 비활성화하거나 별도 빈 포트를 지정한다. 후보 포트는 이번 조회 당시 리스너가 없었지만 실제 시작 직전에 재확인해야 한다.
4. 로컬 테스트에 필요한 PostgreSQL·Auth·REST·Storage·메일 테스트 서비스를 우선 시작한다. `start --help`로 확인한 exclude 옵션을 사용해 불필요한 분석·Edge 등 서비스를 제외할 수 있다. ignore-health-check는 사용하지 않는다. 다운로드·컨테이너 시작·health check는 아직 실행하지 않았다.
5. localhost 노출 범위와 서비스 health를 확인한 뒤 일회용 테스트 계정만 사용한다. 상태 출력에는 로컬 키가 포함될 수 있으므로 콘솔·보고서에 키를 복사하지 않는다.
6. 총괄이 전달한 Claude 제품 migration이 준비된 후 해당 버전의 SQL을 테스트 환경에 적용해 RLS·초대·동시성 검증을 수행한다. 환경 기동과 제품 검증 완료를 분리한다.
7. 종료할 때 해당 sandbox의 Supabase stop만 사용한다. 다른 프로젝트나 전체 Docker를 중지하지 않고 no-backup·볼륨 삭제를 사용하지 않는다.

## 필요 자원과 관측치

- 현재 물리 메모리 약 15.6 GiB, 여유 약 3.5 GiB, C 드라이브 여유 약 252 GiB였다. 시점에 따라 달라진다.
- 실행 가능한 Docker Linux 엔진과 컨테이너 이미지 다운로드 네트워크, 충돌 없는 로컬 포트가 필요하다.
- 초기 운영 계획으로 가용 RAM 6~8 GiB와 이미지/테스트 데이터용 디스크 10~20 GiB 여유를 권장한다. 이는 이 프로젝트의 보수적인 준비 예산이며 측정된 사용량이나 공식 최소 요구량이 아니다. 현재 메모리 여유가 작으므로 총괄이 실행 자원을 조정한 뒤 측정한다. 다른 사용자 앱을 임의 종료하지 않는다.
- Docker 복구 전에는 DB 접속 정보나 실제 준비 완료를 제공할 수 없다.

## 인수인계

ENV-DB-001의 조사·격리 도구 준비·문서는 완료했다. **문서 검토는 가능하나 DB 환경 준비 완료 또는 DB-001 제품 통합 가능 상태는 아니다.** Claude 구현·코드 검토는 이번 환경 작업 범위에 포함되지 않았고 실행하지 않았다. 제품 검토 대상 SHA도 없다.

참고: [Supabase CLI 설치·실행](https://supabase.com/docs/guides/local-development/cli/getting-started), [CLI 상태 경로·SUPABASE_HOME](https://github.com/supabase/cli/blob/develop/apps/cli/docs/supabase-home.md), [Docker Desktop Windows 요구사항](https://docs.docker.com/desktop/setup/install/windows-install/).
