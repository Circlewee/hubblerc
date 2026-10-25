# hubblerc 기획

hubble의 Claude Code 환경. mod(함수 훅) + skill + 훅 + 에이전트를 플러그인 하나(`plugins/hubblerc`)에 담아 이 맥, 회사 스튜디오, 집 미니에서 같이 쓴다.

- 기준 빌드: Claude Code 2.1.308 (mod API는 early access라 버전마다 바뀔 수 있음)
- 방향: 일을 편하게 만드는 도구 + 내 취향대로 꾸미기, 둘 다
- 표시: [확인] 타입 정의·실행으로 확인함 / [추정] 아직 확인 안 함

## 결정한 기능 (v0.1 범위)

### F1. 상태 밴드: claude-hud 대체
작은 모니터용. 프롬프트 바로 위 3줄(`AbovePrompt`).

구현된 모습 (2026-10-26):
```
Opus 5.5 · xhigh │ ctx ━━━━──── 45% │ 5h ━━────── 25% ↻1h30m │ 7d 12% │ hubblerc main*
◐ Bash 테스트 실행 12s +1 │ ◐ Explore: 인증 코드 찾기 2m15s │ ▸ 인증 버그 수정 2/5
직전 2m13s · 파일 +24 −3 · Read 5 · Bash 2
```
3줄은 effort 슬라이더가 열리면 `effort  1: low  2: med  3: high  4: xhigh  5: max  0: 엔진 설정`으로 바뀐다.

- 1줄(항상): 모델·effort(auto 여부), 컨텍스트 %, 5시간 한도 %와 리셋까지 남은 시간, 7일 한도, 프로젝트 이름·브랜치·미커밋(*). 폭이 모자라면 7일 → 프로젝트 이름 → 막대 그래프 순으로 덜어낸다. 비용은 기본 숨김.
- 2줄: 실행 중 도구(Bash는 용도), 서브에이전트(종류·설명·경과), 할 일 진행. 대기 중에도 줄을 유지하고 할 일 또는 "대기 중"을 보여준다(높이 고정).
- 3줄: 직전 답변 요약.
- 스타일(2026-10-26, 두 번째): 배경색 없이 터미널 기본 글자색을 쓰고, 색은 필요한 곳에만 터미널 색 이름(green/yellow/red/cyan/magenta/blue/gray)으로 칠한다. 그러면 터미널 테마(사용자는 Orca 다크 + Kanagawa)가 색을 정한다. 막대는 얇은 선(`━━━━────`)이고 채운 부분이 사용률 단계색(초록 → 60% 노랑 → 85% 빨강), 숫자는 60% 이상일 때만 색. 라벨과 구분선은 흐리게, 브랜치는 magenta, 미커밋 `*`는 yellow, effort는 cyan(세션 고정이면 yellow + `(세션)`). 상태바형 배경은 가독성이 나빠서 버림.
- 간격: 밴드 위에 빈 줄 하나. 밴드 아래 빈 줄은 엔진의 알림 자리("Update installed …")라 줄일 수 없다(음수 여백으로 당기면 3줄이 가려짐 [확인]).
- effort 슬라이더(2026-10-26 결정): `ctrl+x e`(또는 1줄의 effort 값 클릭)로 3줄 자리에 `effort 1: low 2: med 3: high 4: xhigh 5: max 0: 엔진 설정`이 열린다. 숫자 하나로 고르면 이 세션에 적용되고 닫힌다. 다시 `ctrl+x e`, 10초 경과, 다음 질문 시작 때도 닫힌다. Esc로는 닫을 수 없다: Esc는 입력창(엔진)이 먼저 받고, 버튼에는 조합키만 연결되며, 밴드가 키보드를 놓을 때 알려 주는 이벤트도 없다 [확인: 타입 문서]. Esc로 닫히는 건 패널(`closeOnEscape`)뿐인데, 전체 화면에서는 사이드 패널로 열려서 밴드 슬라이더를 택했다(2026-10-26). 숫자 핫키 버튼은 열려 있을 때만 존재한다(빈 입력창에서 숫자를 치면 밴드 버튼이 눌리는 엔진 동작을 이용).
  - 단축키: mod는 키 바인딩을 직접 만들 수 없다. effort 버튼에 엔진 동작 이름 `app:cycleDiffBase`(diff 패널용)를 붙이고, `~/.claude/keybindings.json`의 Chat 문맥에 `ctrl+x e` → 그 동작을 등록했다. `Option+E`(meta+e)는 macOS에서 악센트(´) 입력 키라 터미널이 단축키로 보내지 않아서 바꿨다 [확인]. diff 패널이 열려 있을 때만 이 키가 원래 동작을 한다. 이 파일은 플러그인에 들어가지 않으므로 기기마다 등록해야 한다.
  - 엔진의 `Option+P`는 모델 선택까지 함께 열려서, effort만 조정하는 용도로는 쓰지 않기로 했다.
- 수치 출처: `$.session.usage()` = 상태줄과 같은 context / rateLimits(percentUsed, resetsAt) / cost [확인]. 모델 `$.session.model()` [확인]. 서브에이전트 `$.agent.list()`(id, type, description, status; 시작 시각은 없음 → 직접 기록) [확인]. 브랜치는 SessionRepo에 없어서 git으로 읽는다.
- 전환 시점: 개발 중에는 이 폴더에서만 켜지므로 claude-hud(전역 statusLine)를 유지. 배포할 때 statusLine 설정을 뺀다.

### F2. 레이아웃 두 가지 + config
- 큰 모니터: 사이드바(`Pane`). 전체 화면 모드(`tui: fullscreen`, 지금 설정)에서 대화 옆에 붙는다.
- 작은 모니터: F1 밴드
- config `layout: auto | sidebar | band`. auto는 터미널 폭 기준. 엔진은 mod가 스스로 여는 패널을 144칸 이상일 때만 옆에 붙인다 [확인: 문서].
- mod 옵션(`userConfig`)은 `/config` 메뉴 항목이 되고 선택지형도 된다. 값은 기기별 사용자 설정(`pluginConfigs`)에 저장되고 프로젝트 설정은 읽지 않는다 [확인: 디버그 로그]. 그래서 기기마다 다른 레이아웃을 쓸 수 있다.
- 구조: 데이터 수집은 한 곳(`$.state`), 그리는 부분만 사이드바용과 밴드용 두 벌.

### F3. effort 제어
- 수동: 밴드의 effort 버튼. 엔진 키 동작에는 "effort 올리기/내리기"가 없다 [확인: 키바인딩 목록]. 그래서 버튼은 클릭하거나 `ctrl+x tab` 후 hotkey로 누른다. 엔진 기본 방법(`meta+p` → ←/→)도 있다.
- 자동(auto): 켜고 끄는 모드, 기본은 꺼짐.
  - 프롬프트 제출 → `$.model.classify(프롬프트, 라벨)`(엔진의 작은 모델) → 라벨을 effort로 매핑 → `turn.step` 훅에서 그 답변의 모델 요청마다 effort를 바꿔 넣음 [확인: API 존재]
  - 직접 고른 값이 auto보다 우선. 서브에이전트 요청(`e.agentId`)은 건드리지 않는다.
  - 라벨 초안: 간단한 질문 → medium / 일반 수정 → high / 설계·디버깅·큰 작업 → xhigh
- 현재 설정: opus xhigh, fable high (모델별 effortLevel)
- 수동 변경은 밴드의 effort 슬라이더(`ctrl+x e`)로 한다. 이 세션에만 적용(`turn.step`에서 교체).
- 적용 방식(auto용): `/config`(`$.config`)에는 effort 항목이 없다 [확인: config.list에 model은 있고 effort는 없음]. 엔진 커맨드 `/effort`는 있다 [확인: command.list]. `/effort`는 설정 파일에 저장될 수 있어(미확인) 우선 mod가 `turn.step`에서 이 세션의 요청마다 바꿔 끼우는 방식으로 만든다. `/effort` 동작 확인은 설정 파일을 바꿔야 해서 사용자 허락 후에.

### F4. Bash 행에 용도 표시
- Bash 행(`ToolUse` 렌더)을 다시 그려 `input.description`을 앞에 두고, 명령어는 흐리게 하거나 접는다 [확인: props에 input 있음].
- 최근 대화 기록 29개에서 Bash 1,995건 모두 설명이 붙어 있었다 → haiku 요약은 설명이 빠진 경우에만 쓰는 예비 수단.
- `ctrl+o`(펼친 보기)에서는 원래 행을 그대로 보여준다.

### F5. 활동 기록: 답변별 타임라인 + 답변 끝 요약 줄
사이드바(A):
```
▾ #14 effort 질문 정리          2m13s
   변경  register.tsx        +24 −3
         README.md            +5
   읽음  claude-code.d.ts, settings.json
   검색  "effort", "statusLine"
   Bash  타입 정의에서 effort API 검색  0.4s
▸ #13 디렉토리 이름 변경         48s
```
대화 안(C), 답변이 끝나는 줄:
```
  2m13s · 3파일 +24 −3 · Read 5 · Grep 2 · Bash 2
```
- +/- 줄 수: Edit/Write 결과의 `structuredPatch` [확인: 타입]. git 없이 세고 새 파일도 센다.
- Bash로 바꾼 파일은 잡히지 않음 → git 저장소면 `git diff --numstat`로 보완 [추정]
- 엔진 내장 diff 패널은 git 기준·세션 단위라 "어느 답변에서 바꿨나", 읽은 파일, Bash 기록은 없다(스크린샷 확인). F5는 이 빈자리를 채운다.
- 상세를 볼 커맨드도 둔다(`/activity <번호>` 등, 이름 미정).

## 후보 (아직 결정 안 함)
- 5시간 한도 소진 예측 (지금 속도면 언제 바닥나는지)
- 오늘 누적 비용·작업 시간 (`$.store`로 세션 넘어 누적)
- 기기 라벨 (이 맥 / 스튜디오 / 미니)
- 컨텍스트 경고 (자동 압축 직전에 색 변경)
- 백그라운드 작업·서브에이전트 진행
- MCP 연결 끊김 경고 [추정: API 미확인]
- 나만의 skill, 훅을 같은 플러그인에 묶기 (가능 [확인: 묶음 플러그인 로드 실험])

## 확인할 것
- auto effort: 답변마다 effort가 바뀌면 프롬프트 캐시 적중률이 떨어지는가 → 사용량의 cache_read 수치로 측정
- auto effort: 판정 호출 때문에 답변 시작이 얼마나 늦어지는가
- `turn.step`에서 바꾼 effort가 Spinner나 상태 표시에 반영되는가
- 엔진 effort 슬라이더를 여는 방법
- 회사 스튜디오에서 플러그인 설치가 관리 정책에 막히는지

## 개발 메모
- 로드: 이 폴더를 마켓플레이스로 `--scope local` 등록, `hubblerc@hubblerc`도 local 설치 → 이 폴더에서만 켜짐. 수정 반영은 `/reload-plugins`.
- 검증: `claude plugin validate plugins/hubblerc`, 테스트는 `claude plugin test plugins/hubblerc`
- 타입 검사: `bunx -p typescript@5.6.3 tsc -p plugins/hubblerc`. 엔진 타입 정의는 git에 넣지 않으므로, 새 기기에서는 plugin-authoring 스킬이 만든 `claude-code.d.ts`를 `plugins/hubblerc/.claude-plugin/types/claude-code/index.d.ts`로 복사한다.
- 규칙: `read`/`update`에 넘기는 atom은 그 파일 안의 `const`로 `atom(...)` 해야 한다. 다른 파일에서 import한 atom은 validate가 거부한다.
- 커맨드 출력 앞에는 엔진이 플러그인 이름(`hubblerc:`)을 붙인다. 출력 문구에 이름을 또 넣지 않는다.

## 구현 상태
- [x] 1단계: 기록 수집 + 답변 끝 요약 줄 + `/activity` (2026-10-25, 테스트 세션에서 확인)
- [x] 2단계: Bash 용도 표시 (2026-10-25, 테스트 세션에서 확인)
- [x] 3단계: 상태 밴드 3줄 + effort 슬라이더 (2026-10-26, 테스트 세션에서 확인)
- [ ] 4단계: 사이드바 타임라인 + layout config
- [ ] 5단계: auto effort

## 실행해서 확인한 사실 (2.1.308)
- "… for Ns" 줄(`TurnDuration`)의 `e.requestId`는 그 줄의 대화 기록 행 uuid와 같다. `session.append`(door `notice`, `message.name === 'turn_duration'`)에서 그 uuid를 턴에 저장해 두면 줄과 턴을 정확히 짝지을 수 있다.
- 엔진이 그 줄에 표시하는 시간은 틀릴 수 있다. 백그라운드 서브에이전트를 띄운 뒤의 답변은 이전 질문의 시작 시각부터 잰다(14초 답변이 23분으로 표시됨). `turn.complete`의 `durationMs`는 맞다. 그래서 시간으로 짝짓는 것은 예비 수단으로만 쓴다. 엔진 버그로 보고함(/feedback).
- 백그라운드 서브에이전트는 띄운 턴이 끝난 뒤에도 도구를 쓴다. Agent 결과의 `agentId`로 띄운 턴에 붙인다. `SubagentHandback`은 엔진 내부 호출이라 세지 않는다.
- 크로스 세션 메시지로 시작된 턴의 `turn.start` 텍스트는 `Another Claude session sent a message:` + `<cross-session-message …>` 태그로 감싸져 있다.
- Bash 호출 1,995건(최근 기록 29개) 모두 `description`이 있었다. 그래서 haiku 예비 요약은 아직 넣지 않았다.
- 이 환경의 세션에는 할 일 도구(TodoWrite, TaskCreate/TaskUpdate)가 없다. 밴드의 할 일 표시는 테스트로만 확인했다.
- `settings.read` 이벤트의 결과는 병합된 설정 객체 전체이고, `{ key }` 읽기는 그 객체에서 꺼낸 값이다.
- 같은 이벤트에 매처 없는 훅은 모듈 전체에서 하나만 등록할 수 있다(validate가 거부). 그래서 `session.start`, `turn.start`, `tool.call`, `turn.complete`는 `register.tsx`에서 한 번씩만 걸고 각 기능의 함수를 부른다.
- 엔진은 파일을 바꾸는 Bash(`touch`)까지 Read, `ls`와 함께 한 줄로 접는다("Read 1 file, listed 1 directory, ran 2 shell commands"). Bash 용도는 `ToolUse` 행과 `ToolGroup` 줄 양쪽에 붙여야 보인다.

## 테스트 방법
- 같은 폴더에서 Claude 세션을 하나 더 열어 테스트 세션으로 쓴다. 개발 세션이 SendMessage로 "시나리오 N · …" 메시지를 보내고(`notify_when_idle`), 테스트 세션은 적힌 도구만 쓰고 끝에 `실제: …`를 적는다.
- 정답은 테스트 세션의 기록 파일(`~/.claude/projects/<폴더>/<세션 id>.jsonl`)의 도구 호출과 `turn_duration` 행에서 뽑고, 화면 쪽은 `/activity` 출력과 대조한다.
- 코드를 고치면 테스트 세션에서도 `/reload-plugins`를 해야 한다.
