# Codex–Claude 협업 실행 절차

## 현재 실행 방식

2026-09-19 사용자가 로컬 Claude Code 신규 구현·독립 검토 세션을 승인했다. 기존 클라우드 세션 전용 지시를 대체한다. 총괄은 기존 클라우드 배정을 철회했고, 담당 Codex 작업이 각 Worktree에서 CLI 실행 결과를 수집한다. 전송 성공만으로 실행 완료를 판단하지 않는다.

먼저 도구 없는 짧은 연결 확인을 수행한다. 성공하면 구현 세션을 시작하고 실행 ID와 로그를 .agent-runtime/에 기록한다. 구현 후 별도 새 세션에 읽기 전용 도구만 제공해 커밋 차이를 검토한다. 연결 실패 시 정확한 오류와 재개 조건을 남기며 같은 실패를 반복 호출하지 않는다.

## 역할

Codex 작업은 과제와 인터페이스를 정하고 실행을 관리한다. Claude Code CLI가 제품 코드를 구현하고, 새 Claude 호출이 해당 커밋을 독립적으로 검토한다. Codex 총괄은 테스트 결과·검토 지적의 해결·충돌 여부를 확인해 저장소에 통합한다.

## 실행 준비

1. 현재 Worktree와 기능 브랜치를 확인한다. 두 구현 작업은 별도 Worktree에서 실행한다.
2. `Get-Command claude`로 실행 파일을 찾는다. PATH에 없으면 설치된 VS Code Claude 확장의 `resources/native-binary/claude.exe`도 확인한다. 개인 PC 경로는 문서에 고정하지 않는다.
3. `claude --version`과 `claude auth status`로 실행·인증 상태를 확인한다. 결과의 이메일·조직 ID·인증 정보는 로그와 보고서에 복사하지 않는다.
4. 작업 지시는 `.agent-runtime/<작업ID>-implement.txt`에 저장한다. 읽어야 할 문서, 허용 파일, 금지 변경, 완료 기준, 테스트, 보고서 경로를 포함한다.
5. 실제 환경의 `claude --help`와 공식 CLI 문서로 지원 옵션을 확인한다. 별도 모델 선택 요청이 없으면 기존 Claude 기본 모델을 유지한다.

## 호출 원칙

`claude -p`에 UTF-8 프롬프트를 표준 입력으로 전달하고 JSON 출력으로 결과를 받는다. 구현 도구는 파일 읽기·검색·편집과 해당 프로젝트의 필요한 검증 명령만 제공한다. 검토는 Read/Glob/Grep와 필요한 읽기 전용 Git 명령만 제공하고 Edit/Write는 제외한다.

예시 흐름(구체적인 허용 명령은 작업에 맞게 제한):

```powershell
$taskPrompt = Get-Content -Raw -Encoding UTF8 .agent-runtime/UI-001-implement.txt
$taskPrompt | & $taskClaudeExe -p --output-format json --tools 'Read,Glob,Grep,Edit,Write,Bash'
```

이 예시는 호출 형태이며 무인 실행 허용 설정까지 완료한 명령은 아니다. 담당 Codex 작업은 `--allowedTools`에 필요한 도구·명령을 명시하고 권한 거부를 확인한다. 권한 우회 플래그나 무제한 셸 허용으로 실패를 덮지 않는다. 구현은 작업 폴더 안에서 수행한다.

- 오래 걸리는 호출은 tool session ID로 추적하고 실행이 끝날 때까지 새 호출로 중복하지 않는다.
- 출력 JSON에서 실제 성공 여부·오류·permission denial을 확인한다. 프로세스 종료 코드만으로 구현 완료를 판단하지 않는다.
- 기존 Claude 세션 이어가기에는 정확한 세션 ID를 사용한다. 무조건 최근 세션을 재사용하지 않는다.
- 매 15분 실행은 기존 작업을 관찰한다. 무응답을 곧바로 중단·재실행으로 처리하지 않는다.

## 구현 → 검토 → 통합

1. 구현 Claude가 변경과 검증을 마치면 담당 Codex가 diff·범위를 확인하고 기능 브랜치에 커밋한다.
2. 새 프롬프트에 base SHA와 구현 head SHA를 고정하고 별도 Claude 검토를 실행한다.
3. 중요 지적이 있으면 구현 Claude에 전달한다. 수정된 최종 SHA 기준으로 재검토한다.
4. `docs/handoffs/<작업ID>.md`에 검토 결과와 테스트 결과를 기록한다. 로컬 원시 로그는 커밋하지 않는다.
5. 총괄에게 최종 브랜치·SHA·검증·잔여 문제를 보고한다. 총괄은 이 SHA만 dev 통합 대상으로 처리한다. 기능 브랜치는 dev에서 시작하고 PR 대상도 dev다. main 승격은 사용자 결정 후 총괄만 수행한다.

## 실패와 재개

인증 실패·사용 한도·네트워크·필수 도구 부재는 서로 구분한다. 재시도 가능 조건과 사용자 조치가 필요한지를 기록하고, 같은 원인에 대해 자동화를 돌 때마다 반복 호출하지 않는다. Claude가 막히면 제품 구현을 Codex로 전환하지 않고 가능한 설계·준비 작업을 진행한다.

## 참고

- [Claude CLI 명령과 플래그](https://code.claude.com/docs/en/cli-reference)
- [Claude 프로그램 호출](https://code.claude.com/docs/en/headless)
