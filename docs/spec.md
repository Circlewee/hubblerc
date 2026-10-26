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
- effort 슬라이더(2026-10-26 결정): `ctrl+x ctrl+e`(또는 1줄의 effort 값 클릭)로 3줄 자리에 `effort 1: low 2: med 3: high 4: xhigh 5: max 0: 엔진 설정`이 열린다. 숫자 하나로 고르면 이 세션에 적용되고 닫힌다. 다시 `ctrl+x ctrl+e`, 10초 경과, 다음 질문 시작 때도 닫힌다. Esc로는 닫을 수 없다: Esc는 입력창(엔진)이 먼저 받고, 버튼에는 조합키만 연결되며, 밴드가 키보드를 놓을 때 알려 주는 이벤트도 없다 [확인: 타입 문서]. Esc로 닫히는 건 패널(`closeOnEscape`)뿐인데, 전체 화면에서는 사이드 패널로 열려서 밴드 슬라이더를 택했다(2026-10-26). 숫자 핫키 버튼은 열려 있을 때만 존재한다(빈 입력창에서 숫자를 치면 밴드 버튼이 눌리는 엔진 동작을 이용).
  - 단축키: mod는 키 바인딩을 직접 만들 수 없다. effort 버튼에 엔진 동작 이름 `app:cycleDiffBase`(diff 패널용)를 붙이고, `~/.claude/keybindings.json`의 Chat 문맥에 `ctrl+x ctrl+e` → 그 동작을 등록했다(원래 외부 편집기 키. 외부 편집기는 `ctrl+g`로 계속 열린다). 거쳐 온 키: `Option+E`(meta+e)는 macOS에서 악센트(´) 입력 키라 터미널이 단축키로 보내지 않았다 [확인]. `ctrl+x e`는 한글 입력 상태에서 `e`가 `ㄷ`으로 조합 중에 붙잡혀 있다가 다음 키(백스페이스 등)를 칠 때 넘어가서, `ctrl+x ㄷ`을 묶어도 한 박자 늦게 열렸다 [확인]. 컨트롤 조합은 입력기를 거치지 않으므로 단일 키 `ctrl+q`, `ctrl+t`(할 일 목록 키를 풀고)로 바꿔 봤지만 둘 다 반응이 없었다 [확인]. 공식 문서상 `ctrl+q`는 막힌 키가 아니고 키 설정은 재시작 없이 반영된다. 원인은 입력창이 단일 컨트롤 키를 먼저 가져가는 것으로 본다 [추정: 셸 편집키로 `ctrl+t`는 글자 바꾸기, `ctrl+q`는 문자 그대로 넣기]. 두 키 모두 컨트롤인 조합 `ctrl+x ctrl+e`는 한글 상태에서도 열고 닫힌다 [확인, 2026-10-26]. diff 패널이 열려 있을 때만 이 키가 원래 동작을 한다. 이 파일은 플러그인에 들어가지 않으므로 기기마다 등록해야 한다.
  - 엔진의 `Option+P`는 모델 선택까지 함께 열려서, effort만 조정하는 용도로는 쓰지 않기로 했다.
- 수치 출처: `$.session.usage()` = 상태줄과 같은 context / rateLimits(percentUsed, resetsAt) / cost [확인]. 모델 `$.session.model()` [확인]. 서브에이전트 `$.agent.list()`(id, type, description, status; 시작 시각은 없음 → 직접 기록) [확인]. 브랜치는 SessionRepo에 없어서 git으로 읽는다.
- 전환 시점: 개발 중에는 이 폴더에서만 켜지므로 claude-hud(전역 statusLine)를 유지. 배포할 때 statusLine 설정을 뺀다.

### F2. 레이아웃 두 가지 + config
- 큰 모니터: 사이드바(`Pane`). 전체 화면 모드(`tui: fullscreen`, 지금 설정)에서 대화 옆에 붙는다.
- 작은 모니터: F1 밴드
- config `layout: auto | sidebar | band`. auto는 터미널 폭 기준. 엔진은 mod가 스스로 여는 패널을 144칸 이상일 때만 옆에 붙인다 [확인: 문서].
- mod 옵션(`userConfig`)은 `/config` 메뉴 항목이 되고 선택지형도 된다. 값은 기기별 사용자 설정(`pluginConfigs`)에 저장되고 프로젝트 설정은 읽지 않는다 [확인: 디버그 로그]. 그래서 기기마다 다른 레이아웃을 쓸 수 있다.
- 구조: 데이터 수집은 한 곳(`$.state`), 그리는 부분만 사이드바용과 밴드용 두 벌.
- 구현(2026-10-26):
  - 사이드바(패널 id `hubblerc`): 위에 밴드 1줄의 항목을 한 줄씩(모델·effort, ctx, 5h, 7d, 프로젝트·브랜치), 그 아래 지금 실행 중인 것(밴드 2줄), 그 아래 "변경 파일"과 "목차".
  - 변경 파일: 이 세션에서 바뀐 파일 전체(서브에이전트 변경 포함). 저장소 안에 있고 `git status`에 남은 변경이 없으면 커밋된 것으로 보고 흐리게 `✓`를 붙인다(제목에 "커밋 안 됨 N"). git은 5초마다, Claude가 `git` 명령을 쓴 직후에도 다시 읽는다(2026-10-26 요청). 저장소 밖 파일(메모리, /tmp 등)은 저장소 파일 아래에 폴더별로 모으고, 폴더마다 경로를 얹은 흐린 점선(`┄┄ ~/.claude/…/memory ┄┄┄`) 아래에 흐리게, `✓` 없이 보인다(2026-10-26 결정. 처음 기록은 "표시하지 않는다"였으나 코드는 커밋 안 됨처럼 밝게 보이고 있었다). 경로는 홈을 `~`, macOS의 `/private/tmp`를 `/tmp`로, 길면 가운데를 `…`로 줄인다. 한도: 모두 12개. 바깥 폴더가 먼저 자리를 잡아(폴더당 2개, 폴더 3개까지, 넘는 폴더는 `┄┄ 다른 폴더 N개`) 저장소 파일이 많아도 밀려나지 않고, 저장소 파일은 최소 6개. 넘친 개수는 부분마다 "외 N개"(저장소 파일 아래, 폴더마다 그 아래). "외 N개 더 보기"(또는 "다른 폴더 N개 더 보기")를 누르면 상자가 모든 파일을 보인다. 펼친 동안에는 저장소 파일의 "외 N개"가 있던 자리(저장소 파일과 바깥 경로 선 사이)에 흐린 "줄이기"가 생겨 12개로 돌아간다. 처음엔 목록 맨 아래에만 "접기"를 두었는데 목록이 길면 화면 밖으로 밀렸고(2026-10-26 사용자 지적), 제목 옆과 맨 아래에 함께 둔 안은 과하다고 해서 한 곳으로 정했다. 이 세션만 유지(`$.state.filesExpanded`). 파일 이름은 `file:///<경로>` 링크(`Link`, 경로 조각마다 퍼센트 인코딩)다. 전체 화면에서는 엔진이 클릭된 하이퍼링크를 직접 받아 `file:` 주소(호스트 없음)면 그 파일을 연다 [확인: 실행 파일 코드, 2.1.310]. 대화 속 링크와 같은 처리기다. 전체 화면이 아니면 터미널(Orca, OSC 8 지원)이 연다. 파일별 +/− 누적과 바꾼 답변 번호(`#3 #7`, 최근 4개). 마지막으로 바뀐 파일이 위. 같은 이름이 둘 이상이면 폴더까지 표시. 12개까지 보이고 나머지는 "외 N개".
  - 목차: 답변마다 한 줄(`#번호 질문`, 실패 수, 시간), 최신이 위. 한 페이지 10개, 아래 `◀ 최근  1 2 3  이전 ▶`로 넘긴다(2026-10-26 요청). 누르면 `$.ui.scroll`로 대화를 그 답변으로 옮긴다. 질문 행(`session.append`의 `door: 'prompt'` 행 uuid)이 있으면 질문을 위에(`start`), 없으면(다른 세션 메시지·알림으로 시작한 답변) 답변 끝 줄을 아래에(`end`) 둔다. 행 id가 없는 답변(복원한 답변, 다른 세션 메시지로 시작한 답변)은 `UserMessage` 렌더 때 모아 둔 "질문 문구(`promptKey`) → 행 id" 표로 찾는다. 렌더 중에는 상태를 쓸 수 없어 모듈 메모리에 둔다(리로드 때 엔진이 다시 그리며 채운다 [추정]). 아직 그려지지 않은 행이면 알림으로 알린다. 테스트 키트는 대화 행 스크롤을 흉내 내지 못해서("no implementation for ui.scroll") 실제 이동은 화면에서 확인한다.
  - 바꾼 이유(2026-10-26): 처음에는 답변을 펼쳐 변경·읽음·검색·Bash·에이전트를 보여 줬지만, 답변 끝 요약 줄과 Bash 용도 줄이 같은 정보를 이미 대화 안에 보여 줘서 중복이었다(사용자 지적). 대화를 스크롤해서는 얻기 어려운 것(여러 답변에 걸친 변경 합계, 답변 위치로 이동)만 남겼다.
  - 여는 시점: 밴드를 그릴 때 레이아웃이 원하면 `$.ui.open`을 부른다(렌더 안에서 `void $.ui.open`은 타입 문서의 예제). auto는 전체 화면이고 `e.viewport.columns`가 110칸(엔진이 옆에 붙이는 최소 폭) 이상일 때만 연다. 사람이 요청하지 않은 패널은 엔진이 144칸(사람이 연 적이 있으면 110칸) 미만에서 그리지 않고 기다리게 한다.
  - 좁아질 때(2026-10-26 요청): 터미널이 좁아져 사이드바가 입력창 위로 밀려나면(`placement: 'inline'`) auto는 사이드바를 닫고 밴드로 돌아간다. 다시 넓어지면 저절로 연다. 넓은 화면에서 사람이 닫았으면, 한 번 좁아졌다 넓어질 때 다시 열린다. 좁은 화면에서 `/panel`로 연 것은 닫거나 넓어질 때까지 입력창 위에 둔다.
  - 밴드 비키기: `$.ui.panes()`에서 이 패널이 그려져 있고(isPlaced) 보이면(isShown) 밴드는 그리지 않는다. 패널이 붙으면 밴드의 `bodyColumns`가 줄어 밴드가 다시 그려지므로 그때 판정이 바뀐다 [추정: 실제 화면에서 확인 필요]. effort 슬라이더는 사이드바가 떠 있어도 밴드 자리에 열린다(빈 입력창의 숫자 키는 밴드 버튼에만 닿기 때문). `ctrl+x ctrl+e`는 사이드바의 effort 값 버튼이 받는다(패널 버튼이 밴드 버튼보다 우선).
  - 닫기: 사람이 닫으면(닫기 표시, `ctrl+x x`) `/panel`을 치거나(auto는) 터미널이 한 번 좁아질 때까지 다시 열지 않는다. 이 기억은 모듈 변수라 리로드하면 사라진다. `/panel` 또는 `ctrl+x ctrl+p`(키 설정의 `command:panel`)로 열고 닫을 수 있다(명령으로 연 패널은 폭과 상관없이 그려진다). 성공하면 대화에 아무 줄도 남기지 않고, 그리지 못했을 때만 이유를 보여 준다. 명령 이름은 처음에 `/sidebar`였다가 사용자 요청으로 바꿨다(2026-10-26).
  - config `layout`(`/config`): auto(기본) / sidebar(전체 화면이 아니어도 연다. 그때는 입력창 위에 붙는다) / band(저절로 열지 않고, 남아 있던 사이드바는 세션 시작 때 닫는다).

### F3. effort 제어
- 수동: 밴드의 effort 버튼. 엔진 키 동작에는 "effort 올리기/내리기"가 없다 [확인: 키바인딩 목록]. 그래서 버튼은 클릭하거나 `ctrl+x tab` 후 hotkey로 누른다. 엔진 기본 방법(`meta+p` → ←/→)도 있다.
- 자동(auto): 켜고 끄는 모드, 기본은 꺼짐.
  - 프롬프트 제출 → `$.model.classify(프롬프트, 라벨)`(엔진의 작은 모델) → 라벨을 effort로 매핑 → `turn.step` 훅에서 그 답변의 모델 요청마다 effort를 바꿔 넣음 [확인: API 존재]
  - 직접 고른 값이 auto보다 우선. 서브에이전트 요청(`e.agentId`)은 건드리지 않는다.
  - 라벨 초안: 간단한 질문 → medium / 일반 수정 → high / 설계·디버깅·큰 작업 → xhigh
- 현재 설정: opus xhigh, fable high (모델별 effortLevel)
- auto 구현(2026-10-26):
  - 켜기: effort 슬라이더의 `6: auto`(이 세션), `/config`의 `autoEffort`(새 세션 기본값, 기본 꺼짐). `1~5`로 직접 고르면 auto는 꺼지고, `0: 엔진 설정`은 둘 다 끈다. 밴드·사이드바에는 `auto high`처럼 마지막 판정이 보인다.
  - 판정: 메인 답변의 `turn.start`에서 `$.model.complete`(haiku, 최대 8토큰, 4초 제한)로 medium/high/xhigh 중 하나를 고른다. `classify`는 고정 프롬프트라 기준을 줄 수 없어 직접 프롬프트를 쓴다. "이어서 진행하자"처럼 짧지만 큰 작업을 여는 메시지가 있어서 직전 답변 끝 1000자를 함께 준다. 직전 답변은 `turn.complete`의 `answer`를 모듈에 기억해 두고, 리로드 직후처럼 없을 때만 대화 기록을 읽는다. low와 max는 auto가 고르지 않는다.
  - 적용: 그 답변의 `turn.step`마다 판정한 effort로 바꿔 보낸다. 첫 요청은 판정을 최대 2.5초 기다리고(처음 4초에서 측정 후 줄임), 실패·시간 초과·알 수 없는 답이면 엔진 effort로 보낸다. 첫 요청 뒤에 온 판정은 같은 답변의 다음 요청부터 쓴다(effort가 바뀌어도 캐시는 유지되므로 문제없다). 우선순위는 직접 고른 값 > auto > 엔진. 서브에이전트 요청과 서브에이전트 답변 시작은 건드리지 않는다.
  - 측정: 메인 요청마다 effort, 출처(엔진/직접/auto), 입력·캐시 읽기·캐시 쓰기·출력 토큰을 기록한다(최근 300개). `/effort-log`가 표와 "effort가 바뀐 직후 요청 vs 그대로인 요청"의 캐시 읽기 비율 평균, 마지막 판정 시간을 보여 준다.
- 수동 변경은 밴드의 effort 슬라이더(`ctrl+x ctrl+e`)로 한다. 이 세션에만 적용(`turn.step`에서 교체).
- 적용 방식(auto용): `/config`(`$.config`)에는 effort 항목이 없다 [확인: config.list에 model은 있고 effort는 없음]. 엔진 커맨드 `/effort`는 있다 [확인: command.list]. `/effort`는 설정 파일에 저장될 수 있어(미확인) 우선 mod가 `turn.step`에서 이 세션의 요청마다 바꿔 끼우는 방식으로 만든다. `/effort` 동작 확인은 설정 파일을 바꿔야 해서 사용자 허락 후에.

### F4. Bash 행에 용도 표시
- Bash 행(`ToolUse` 렌더)을 다시 그려 `input.description`을 앞에 두고, 명령어는 흐리게 하거나 접는다 [확인: props에 input 있음].
- 최근 대화 기록 29개에서 Bash 1,995건 모두 설명이 붙어 있었다 → haiku 요약은 설명이 빠진 경우에만 쓰는 예비 수단.
- `ctrl+o`(펼친 보기)에서는 원래 행을 그대로 보여준다.

### F5. 활동 기록: 답변별 타임라인 + 답변 끝 요약 줄
(2026-10-26: 사이드바의 답변별 타임라인은 중복이라 목차와 세션 변경 파일로 바꿨다. F2 구현 참고. 아래 시안은 처음 기획.)

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
- 다시 연 세션(2026-10-26 요청): `$.state`는 프로세스가 새로 뜨면 비어서 resume한 세션의 기록이 사라졌다. 세션 시작 때 `$.session.id()`가 기록해 둔 id와 다르거나 기록이 비어 있으면, `$.session.messages()`(대화 기록, 최근 4096개)에서 답변을 다시 만든다 [확인: 타입 문서].
  - 경계와 제목은 모델에 보낸 형태(`$.session.messages({ as: 'api' })`)에서 읽는다. 기본 형태(`$.session.messages()`)는 메타 사용자 행(다른 세션의 메시지, 서브에이전트 보고)을 빼고 돌려주는 것으로 보여서(추정: 복원 제목이 비메타 행과 정확히 일치), 그 답변들이 앞의 `/reload-plugins` 행을 제목으로 잡았다 [확인: 2026-10-26 화면]. 또 `/reload-plugins`의 출력은 시스템 행이라 `<local-command-stdout>` 사용자 행이 없다 [확인: 기록 파일].
  - 사용자 메시지의 텍스트 블록 중 마지막으로 답할 거리가 있는 것이 제목이다. 리마인더, 로컬 명령 행(caveat·command·stdout), 스킬 본문("Base directory for this skill")은 건너뛴다. 스킬을 부른 명령은 다른 게 없을 때 제목(`/스킬 인자`). 작업 완료 알림은 `알림: <summary>`, 서브에이전트 보고는 "(서브에이전트 보고)", 압축 요약은 "(압축 후 이어짐)". 이 제목 규칙은 실시간 기록(`turn.start`)에도 쓴다.
  - 도구 호출은 api 형태의 tool_use 블록이고, 저장된 결과(+/− 계산용 patch, Agent의 `agentId`)는 기본 형태의 `toolUses`에서 같은 id로 찾는다. 서브에이전트의 도구는 `$.session.messages({ agentId })`로 읽는다(최근 답변부터 30개까지).
  - 확인: 테스트 세션 기록 파일로 두 형태를 근사해(연속한 같은 역할 행을 합침) 돌렸을 때 16개 답변의 제목이 모두 실제 질문과 맞았다. 엔진의 실제 정규화와 같다는 보장은 없다.
  - 대화 기록에는 시간이 없다. 복원한 답변(`restored`)은 소요 시간을 표시하지 않고(`/activity`에서는 "이전"), 답변 끝 줄과 시간으로 짝짓지도 않는다.
  - 같은 세션의 리로드는 실시간으로 쌓은 기록(시간 포함)을 그대로 둔다. 시간까지 살리려면 `$.store`에 저장해야 하는데, 모든 세션을 합쳐 4MB 한도라 보류했다.

### F6. 리서치에서 고른 추가 기능 (2026-10-26 결정)
`docs/research.md` 검토 뒤 사용자가 고른 것. 고르지 않은 후보: 목차의 ◆·시각, effort 접두어, 자동 압축까지 남은 양, 95% 한도 토스트. 뺀 것: 승인 대기 표시(API 미확인), claude-hud 비키기(mod 밖 작업), 서브에이전트 행·OS 알림·탭 제목(Orca와 겹침).

사이드바: 구역마다 제목 달린 상자(시안 세 개 중 선택. 나머지는 "제목 + 구분선", "구역별 색 막대").
```
╭── ▾ 상태 ─────────────────────────────╮
│ Opus 5.5 · high                       │
│ 5h ━━━━━━── 81% ↻1h30m ⚠ 18m 뒤 소진  │
│ 마지막 요청 7분 전                    │
╰───────────────────────────────────────╯
╶── ▸ 파일 ──────────────────────────────
```
- 제목(2026-10-26 사용자 지정): 상태, 작업, 파일, 목차+숫자(한 쪽이면 `목차 5`, 여러 쪽이면 `목차 #3~12 / 12`). 파일 제목의 개수·"커밋 안 됨 N"은 뺐다(커밋된 파일은 행이 흐리고 `✓`).
- 상자: 흐린 둥근 테두리(`borderStyle: round`, `borderDimColor`), 안쪽 여백 1칸. 폭이 4칸 준다.
- 제목 그리기: 처음엔 상자의 자식인 `position: absolute`, `top: -1` Box로 윗변에 얹었는데 화면에 아예 안 보였다 [확인: 화면, 2.1.310]. 엔진이 테두리를 자식보다 나중에 칠해 덮은 것으로 본다 [추정]. 지금은 상자의 형제로 둔다: 바깥 Box를 `column-reverse`로 두고 상자 → 제목 줄 순서로 넣어, 제목 줄이 위에 놓이고 `marginBottom: -1`로 윗변에 겹치며 나중에 칠해진다. 제목 줄은 내용 폭만 차지하고(`alignSelf: flex-start`) 모서리 `╭──`도 직접 그린다. 이 방식으로 제목이 보인다 [확인: 화면, 2026-10-26].
- 접기: 제목을 누르면 상자가 한 줄(`╶── ▸ 제목 ───`)로 접히고 다시 누르면 펼쳐진다. `$.state.folded`에 두고 `$.store`의 `sidebarFolded`에도 저장해서 새 세션에서도 접힌 채 시작한다. 글자 단축키는 한글 입력 상태에서 안 눌리므로 붙이지 않았다.
- 엔진의 테두리 종류(2.1.310 실행 파일): `single double round bold singleDouble doubleSingle classic arrow dashed quote`. `quote`는 왼쪽 `▎`만 긋고 나머지 변은 빈칸, `dashed`는 `╌╎`. 변별 끄기(`borderTop` 등)는 mod에 허용되지 않는다.

한도 쪽:
- 5h 소진 예측: 5h 값이 바뀔 때마다(`refreshStatus`: 답변 뒤, 30초마다) `$.state.fiveHourLog`에 남긴다(2시간 보관). 최근 1시간 속도(지금까지, 쉬면 느려짐)로 1시간 안에, 리셋 전에 바닥나면 밴드 5h 옆에 `⚠18m`, 사이드바에 `⚠ 18m 뒤 소진`. 10분 이상, 2%p 이상 오른 뒤에만 믿는다. 값은 계정 단위라 다른 기기 사용도 섞인다.
- 답변별 5h 소비·토큰: 답변 끝 요약 줄 뒤에 `출력 12k · 5h +3%`. 토큰은 메인 루프 요청의 출력 합(서브에이전트 제외). 5h는 답변 시작 때 값과 끝난 뒤 다시 읽은 값의 차이라 그 사이 다른 기기·세션 사용이 섞이고, 1%p 미만은 표시하지 않는다.
- 마지막 요청 시각과 캐시 적중률(2026-10-26 바꿈): 쉬는 동안 밴드 3줄 끝과 사이드바 상태 상자에 `마지막 요청 14:32 · 캐시 96%`. 캐시 적중률은 직전 답변의 메인 루프 요청들에서 캐시 읽기 ÷ (입력 + 캐시 읽기 + 캐시 쓰기)이고, 80% 미만 노랑·50% 미만 빨강. 세션 첫 답변은 캐시가 없어 빨강이 정상이다. 처음엔 `마지막 요청 7분 전`(5분 노랑, 1시간 빨강)이었으나 쉬는 동안 화면이 다시 그려지지 않아 "1분 전"에 멈춰 보였다(사용자 지적). 원인으로 본 것은 타이머가 상태 읽기 중 하나라도 실패하면 다시 그리기를 건너뛰던 코드 [추정]라, 읽기마다 따로 실패를 받고 30초마다 반드시 다시 그리게 고쳤다. 같은 타이머에 기대는 5h 리셋 카운트다운·켜진 시간도 함께 영향받는다.

대화 쪽(`hooks/tool-lines.tsx`):
- 접힌 도구 줄: 아래에 `↳ 읽음: register.tsx, band.tsx 외 1`(최대 3개)과 Bash 용도. 끝났고(`isActive: false`) 호출만 든 묶음(`isCallsOnly: true`)은 엔진 줄 대신 `파일 2개 읽음 · 명령 1개 실행`을 그린다. 진행 중에는 엔진 줄(움직이는 표시, 현재 작업 요약)을 그대로 둔다. 엔진의 끝난 묶음 줄은 점 없이 위 빈 줄 1개 + 2칸 들여쓰기 + 흐린 글자라 그대로 따랐다 [확인: 실행 파일 코드]. Bash는 무엇을 했든 "명령"으로 센다(엔진은 `ls`를 "listed directory"로 센다). 생각 시간("thought for") 표시는 잃는다.
- 수정 diff: Edit·Write 결과 행(`ToolResult`)을 `⎿  +40 −12 · ctrl+o로 전체 보기` 한 줄로. 새 파일은 `새 파일 120줄`. 펼친 보기(ctrl+o, `isExpanded`)와 실패는 엔진 것을 그린다. 결과 행 훅은 PostToolUse 훅 메시지까지 대신 그리므로, 접힌 보기에서는 그 메시지도 안 보인다.

### F7. 사이드바 장비 상자 (2026-10-26)
상태 위 첫 상자 "장비": 왼쪽에 고양이 픽셀 그림, 오른쪽에 칩·메모리(`Apple M3 Pro · 18GB`), macOS 버전, 켜진 시간(`켜진 지 11일 23시간`), Claude Code 버전. 컴퓨터 이름은 사용자가 고르지 않았다.
- 값: 세션 시작 때 한 번 `sysctl -n machdep.cpu.brand_string hw.memsize kern.boottime`, `sw_vers -productVersion`, `$.session.version()`. 켜진 시간은 부팅 시각에서 매번 계산한다.
- 그림: 12×8 픽셀을 반쪽 블록(`▀▄█`) 12칸×4줄로, 위 픽셀은 글자색·아래 픽셀은 바탕색(hex). `Image`는 kitty·Ghostty·iTerm2에서만 그림이 나오고(Orca는 목록에 없음) [확인: 타입 문서], `Raster`는 빈 칸을 터미널 기본 바탕으로 칠해 패널 바탕과 어긋날 수 있어 [추정] 글자 방식을 택했다.
- 고양이 상태(2026-10-26): 도구·서브에이전트 실행 중 → 눈 좌우·귀 움찔 / 생각 중 → 눈 위로, `?` / 답변 쓰는 중 → 입 벌렸다 다물기 / 답변 진행 중(아직 스트림 없음) → 눈 뜨고 4초에 한 번 깜빡 / 대기 → 눈 감고 `z` / 대기인데 직전 답변에 실패 → 동그란 눈, `!`(빨강), 다음 질문까지. 이 순서가 우선순위. 생각·쓰기는 `turn.step` 스트림의 `thinking`·`text` 조각이 바뀔 때만 `$.state.streamPhase`에 적는다(조각마다 아님). 움직임은 일할 때만, 타이머가 답변 진행 중에도 1초마다 다시 그리게 넓혔다.
- 새 버전 표시(2026-10-26): 실행 중인 버전 옆에 더 높은 버전을 `↑ 2.1.312`로, 숫자는 CHANGELOG 링크. 설치됐는데 재시작만 남았으면 노랑 + 흐린 `재시작`, 나왔는데 아직 안 받았으면 청록. 둘 다면 재시작 쪽을 보인다. `↻`는 5h 리셋 표시가 써서 피했다.
  - 설치본: `ls "$HOME/.local/share/claude/versions"`의 가장 높은 버전(네이티브 설치는 버전마다 파일 하나, 이 맥 2.1.307~2.1.310 [확인]). 자동 업데이트가 여기에 받아 둔다는 것은 파일 날짜로 본 [추정].
  - 배포본: `$.http.fetch('https://registry.npmjs.org/@anthropic-ai/claude-code/latest')`의 `version`. npm 명령이 없어도 된다. npm 배포와 네이티브 배포가 잠깐 어긋날 수 있다 [추정].
  - 세션 시작 때와 한 시간마다 읽는다.
- 나중에: 실제 이미지 파일(png 등)을 쓰고 싶다는 요청(2026-10-26). 이 방식으로 그리려면 그림을 픽셀로 풀어 반쪽 블록으로 바꿔야 한다.

## 배포 (2026-10-26 결정)
- 버전 규칙: 기능을 묶어 커밋할 때마다 `plugins/hubblerc/.claude-plugin/plugin.json`의 `version`을 올리고 같은 커밋에 git 태그 `v<버전>`을 건다. 기능 추가는 0.x, 고치기만 했으면 0.x.y. 설치된 사본은 버전을 올려야 갱신된다는 보고가 있다 [커뮤니티]. 0.1.0 → 0.2.0(F6·F7과 파일 패널 작업). 0.2.1: `/setup`의 claude-hud 점검을 합쳐진 설정으로 되돌림(이 저장소는 settings.local.json의 no-op `statusLine`이 claude-hud를 가린다. 처음에 이를 Orca 탓으로 잘못 짚고 사용자 파일까지 보게 했었다). 0.2.2: 5초마다 도는 `git status`에 `--no-optional-locks`(그 사이 커밋이 `index.lock`에 막혔다).
- 저장소: GitHub. 공개/비공개는 미정. 비공개는 기기마다 GitHub 로그인이 필요하다(회사 스튜디오에 개인 계정). 공개는 커밋 작성자 이메일과 `docs/`의 사용 환경이 드러나므로, 올리기 전에 키·내부 주소·개인 정보를 훑는다.
- 최소 Claude Code 버전: 미확인. 2.1.308~2.1.310에서 썼다. 세 기기를 같은 버전으로 맞춘다(옛 버전이 새 이벤트를 쓰는 mod를 통째로 거부한 사례 [커뮤니티]).
- 새 기기 설치:
  1. mod가 원격으로 꺼져 있지 않은지: mod 없는 폴더에서 `claude plugin test` [리서치]
  2. 마켓플레이스 추가 후 `hubblerc`를 사용자 범위로 설치
  3. 첫 실행: 세션 시작 때 hubblerc가 필요한 설정(키 `ctrl+x ctrl+e`·`ctrl+x ctrl+p`, 전체 화면)을 점검하고, 빠진 게 있으면 대화에 "hubblerc 설정 N개가 덜 됐습니다. `/setup`" 한 줄을 남긴다
  4. `/setup`: 빠진 키만 `~/.claude/keybindings.json`(또는 `CLAUDE_CONFIG_DIR`)의 Chat 문맥에 추가한다. 먼저 `.bak`으로 백업하고, 같은 키가 다른 동작에 묶여 있으면 덮어쓰지 않고 알린다. 설정 파일은 직접 고치지 않고 안내만: 전체 화면(`/tui fullscreen` 또는 `"tui": "fullscreen"`), 권장으로 claude-hud `statusLine` 지우기·`/plugin uninstall claude-hud`, 응답 언어(`"language": "korean"`)
  5. 사이드바·밴드·고양이·대화 줄이 보이는지 확인

## 알려진 한계
- 한글 조합 중 사이드바 위에 커서와 어두운 띠가 겹쳐 보인다(2026-10-26, Orca, 질문 창 메모 입력 중 스크린샷). 조합 표시는 터미널이 실제 커서 자리에 그리는데, 그 자리가 사이드바 쪽에 잡힌 것으로 본다 [추정]. mod API에는 터미널 커서나 한글 조합을 다루는 기능이 없다 [확인: 타입 문서]. 터미널 환경의 한계로 두고 넘어가기로 했다. 원인을 가리려면 사이드바를 닫은 채, 그리고 다른 터미널에서 같은 입력을 해 본다.

## 후보 (아직 결정 안 함)
- 오늘 누적 비용·작업 시간 (`$.store`로 세션 넘어 누적)
- 기기 라벨 (이 맥 / 스튜디오 / 미니)
- 컨텍스트 경고 (자동 압축 직전에 색 변경)
- 백그라운드 작업·서브에이전트 진행
- MCP 연결 끊김 경고 [추정: API 미확인]
- 나만의 skill, 훅을 같은 플러그인에 묶기 (가능 [확인: 묶음 플러그인 로드 실험])
- 표시 언어 (2026-10-26 검토, 공개할 때 넣기로 함): 지금은 hubblerc 문구가 모두 한국어 고정이다. 혼자 세 기기에서 한국어로 쓰므로 미뤘다. 넣을 때는 hubblerc 설정 `자동 / 한국어 / English`(기본 자동). 자동이면 Claude Code 설정 `language`(`$.settings.read({ key: 'language' })`, 자유 입력. 이 맥은 `"korean"` [확인])를 따르고, korean·한국어·ko류면 한국어, 그 밖은 영어로 본다. 둘 다 없으면 영어(엔진 화면이 영어). 범위는 미정: 대화 안(요약 줄, 도구 줄, diff 줄, 명령 출력·설명)만인지, 밴드·사이드바까지인지. Bash 용도 줄은 Claude가 쓴 설명이라 대상이 아니다.

## 보류: 색 테마 프리셋 (2026-10-26 조사, 구현 안 함)
하고 싶어지면 아래만 보고 바로 시작할 수 있게 정리.

- 결정: hubblerc의 밴드·사이드바 글자색은 계속 터미널 색 이름(Kanagawa가 정함). 테마는 엔진이 그리는 나머지를 맞추는 용도.
- mod API만으로는 패널 바탕을 바꿀 수 없다. 패널 틀·바탕은 엔진이 칠하고(스크린샷상 대화 영역보다 한 단계 밝음), 패널 배경 속성이 없다 [확인: 타입 문서]. mod 색 값은 터미널 색 이름, hex, 엔진 테마 키(`success`, `error`, `subtle` 등) 셋 중 하나.
- 플러그인은 테마를 배포할 수 있다 [확인: 문서 "Add components to a plugin" > Themes and output styles].
  - 위치: `plugins/hubblerc/themes/<slug>.json` (manifest 키 `experimental.themes`를 쓰면 폴더 스캔 대신).
  - `/theme` 목록에 파일의 `name`으로, 플러그인 표시와 함께 나온다. 플러그인 테마는 읽기 전용이고 사용자가 `/theme`에서 고치면 `~/.claude/themes/`에 사본으로 저장된다.
  - 형식(문서 "Configure your terminal" > Create a custom theme): `{ "name": "...", "base": "dark", "overrides": { "<token>": "<color>" } }`. base는 `dark`, `light`, `dark-daltonized`, `light-daltonized`, `dark-ansi`, `light-ansi`. 색은 `#rrggbb`, `#rgb`, `rgb(r,g,b)`, `ansi256(n)`, `ansi:<16색 이름>`. 모르는 토큰·잘못된 값은 무시된다.
- 토큰(문서 목록): `claude`, `text`, `inverseText`, `inactive`, `subtle`, `suggestion`, `permission`, `remember` / `success`, `error`, `warning`, `merged` / `promptBorder`, `planMode`, `autoAccept`, `bashBorder`, `ide`, `fastMode`, `effortUltra` / `diffAdded`, `diffRemoved`, `diffAddedDimmed`, `diffRemovedDimmed`, `diffAddedWord`, `diffRemovedWord` / `userMessageBackground`, `userMessageBackgroundHover`, `bashMessageBackgroundColor`, `memoryBackgroundColor`, `selectionBg`, `composerSidebarBackground` / `rate_limit_fill`, `rate_limit_empty`, `briefLabelYou`, `briefLabelClaude` / 반짝임 짝(`claudeShimmer` 등), `<color>_FOR_SUBAGENTS_ONLY`, `rainbow_<color>`.
  - `composerSidebarBackground`: 대화 옆 패널(diff 패널, mod 패널) 배경. 대화 바탕과 같은 hex를 넣으면 "투명처럼" 보인다. "투명"이나 "터미널 기본 바탕"을 뜻하는 값은 없다.
- 적용 범위: Claude Code가 칠하는 색만 바뀌고 터미널 자체(바탕, 기본 글자, 칠하지 않은 영역)는 그대로 [확인: 문서]. 고르면 `custom:<slug>`가 사용자 설정으로 저장돼 그 기기의 모든 Claude Code 세션에 적용된다 [추정].
- 주의: hubblerc는 지금 이 폴더에서만(local scope) 켜진다. hubblerc 테마를 고른 채 다른 폴더에서 실행하면 테마를 못 찾는데, 그때 동작은 문서에 없다(확인 필요). 쓰려면 사용자 범위로 설치.
- 다크/라이트: `/theme`의 auto는 터미널 바탕 밝기로 내장 다크/라이트를 고른다. 사용자 정의 테마는 고정되는 것으로 보인다 [추정].
- 시작 순서: (1) Kanagawa 변형(Wave/Dragon/Lotus)과 Orca 바탕 hex 확인 (2) `themes/kanagawa.json`(base dark, `composerSidebarBackground` = 대화 바탕색, 상태색·diff 색을 Kanagawa 팔레트로) (3) `claude plugin validate` → `/reload-plugins` → `/theme`에서 선택 (4) 필요하면 라이트(Lotus)와 다른 프리셋 추가.

## 확인할 것
- `turn.step`에서 바꾼 effort가 Spinner나 상태 표시에 반영되는가
- 엔진 effort 슬라이더를 여는 방법
- 회사 스튜디오에서 플러그인 설치가 관리 정책에 막히는지

## 개발 메모
- 로드(2026-10-26 바꿈): 마켓플레이스 `hubblerc`는 GitHub(`Circlewee/hubblerc`)이고 `hubblerc@hubblerc`는 사용자 범위로 설치돼 모든 프로젝트에서 켜진다. 이 저장소에서는 `.claude/settings.local.json`에서 배포판을 끄고(`"hubblerc@hubblerc": false`), `hcc` 별칭(`claude --plugin-dir ~/vault/project/hubblerc/plugins/hubblerc`, `~/.zshrc`)으로 디스크의 개발판을 띄운다 [확인: 이 폴더 disabled·다른 폴더 enabled, `--plugin-dir`로 `/setup` 실행됨]. `--plugin-dir`는 저장하면 자동 리로드된다고 문서에 있다. 로컬 마켓플레이스와 GitHub 마켓플레이스는 이름이 같아(`hubblerc`) 함께 등록할 수 없다. 다른 프로젝트의 배포판은 버전을 올리고 푸시한 뒤 `claude plugin marketplace update hubblerc` → `claude plugin update hubblerc@hubblerc --scope user`로 받고, 재시작하면 적용된다 [확인: 0.2.1 → 0.2.2]. 자동 갱신 여부는 미확인.
- 검증: `claude plugin validate plugins/hubblerc`, 테스트는 `claude plugin test plugins/hubblerc`
- 타입 검사: `bunx -p typescript@5.6.3 tsc -p plugins/hubblerc`. 엔진 타입 정의는 git에 넣지 않으므로, 새 기기에서는 plugin-authoring 스킬이 만든 `claude-code.d.ts`를 `plugins/hubblerc/.claude-plugin/types/claude-code/index.d.ts`로 복사한다.
- 규칙: `read`/`update`에 넘기는 atom은 그 파일 안의 `const`로 `atom(...)` 해야 한다. 다른 파일에서 import한 atom은 validate가 거부한다.
- 커맨드 출력 앞에는 엔진이 플러그인 이름(`hubblerc:`)을 붙인다. 출력 문구에 이름을 또 넣지 않는다.

## 구현 상태
- [x] 1단계: 기록 수집 + 답변 끝 요약 줄 + `/activity` (2026-10-25, 테스트 세션에서 확인)
- [x] 2단계: Bash 용도 표시 (2026-10-25, 테스트 세션에서 확인)
- [x] 3단계: 상태 밴드 3줄 + effort 슬라이더 (2026-10-26, 테스트 세션에서 확인)
- [x] 4단계: 사이드바(상태 · 변경 파일 · 목차) + layout config + `/panel` + resume한 세션 복원 (2026-10-26, 테스트 세션에서 확인. 목차 이동은 화면에 그려진 질문 행까지만 된다)
- [x] 5단계: auto effort (2026-10-26, 테스트 세션에서 측정: 캐시 영향 없음, 첫 요청 지연 약 1초, 상한 2.5초)
- [ ] 6단계: F6(사이드바 상자·접기, 5h 소진 예측, 답변별 토큰·5h, 캐시 경과, 도구 줄 한국어·읽은 파일, diff 한 줄) (2026-10-26 구현, 테스트 82개 통과. 화면 확인: 사이드바 상자 제목. 나머지는 확인 전)

## 실행해서 확인한 사실 (2.1.308)
- "… for Ns" 줄(`TurnDuration`)의 `e.requestId`는 그 줄의 대화 기록 행 uuid와 같다. `session.append`(door `notice`, `message.name === 'turn_duration'`)에서 그 uuid를 턴에 저장해 두면 줄과 턴을 정확히 짝지을 수 있다.
- 엔진이 그 줄에 표시하는 시간은 틀릴 수 있다. 백그라운드 서브에이전트를 띄운 뒤의 답변은 이전 질문의 시작 시각부터 잰다(14초 답변이 23분으로 표시됨). `turn.complete`의 `durationMs`는 맞다. 그래서 시간으로 짝짓는 것은 예비 수단으로만 쓴다. 엔진 버그로 보고함(/feedback).
- 백그라운드 서브에이전트는 띄운 턴이 끝난 뒤에도 도구를 쓴다. Agent 결과의 `agentId`로 띄운 턴에 붙인다. `SubagentHandback`은 엔진 내부 호출이라 세지 않는다.
- 크로스 세션 메시지로 시작된 턴의 `turn.start` 텍스트는 `Another Claude session sent a message:` + `<cross-session-message …>` 태그로 감싸져 있다.
- Bash 호출 1,995건(최근 기록 29개) 모두 `description`이 있었다. 그래서 haiku 예비 요약은 아직 넣지 않았다.
- 이 환경의 세션에는 할 일 도구(TodoWrite, TaskCreate/TaskUpdate)가 없다. 밴드의 할 일 표시는 테스트로만 확인했다.
- `settings.read` 이벤트의 결과는 병합된 설정 객체 전체이고, `{ key }` 읽기는 그 객체에서 꺼낸 값이다.
- 같은 이벤트에 매처 없는 훅은 모듈 전체에서 하나만 등록할 수 있다(validate가 거부). 그래서 `session.start`, `turn.start`, `tool.call`, `turn.complete`는 `register.tsx`에서 한 번씩만 걸고 각 기능의 함수를 부른다.
- 테스트 키트의 `$`에는 `ui.close`가 없어서 "사람이 패널을 닫음"은 테스트로 일으킬 수 없다. `/panel`로 닫는 경로만 테스트하고, 사람이 닫는 경로는 실제 세션에서 확인한다.
- auto effort 측정(2026-10-26, 테스트 세션, Opus 5.5, 엔진 설정 xhigh). 실제로 보낸 effort는 기록 파일의 `api-request` 행 `params.output_config.effort`, 캐시는 응답의 usage에서 읽었다.
  - `turn.step`에서 바꾼 effort가 실제 API 요청에 그대로 나간다 [확인]. 슬라이더 수동 변경도 같은 경로다.
  - 판정: 간단한 질문 → medium, 한 줄 파일 만들기 → medium(예상은 high, 작은 작업이라 가볍게 본 것), 설계 검토 → xhigh, 직전 답변에 대한 짧은 정리 요청 → medium.
  - 캐시: effort가 바뀐 직후 요청의 캐시 읽기 비율이 96%(xhigh→medium), 99%(medium→xhigh), 96%(xhigh→medium)였다. 쓰기 분량은 새 메시지 크기 정도라, effort를 바꿔도 프롬프트 캐시는 깨지지 않는다 [확인: 3건].
  - 지연: 메시지부터 첫 API 요청까지 auto 전 0.07~0.13초, auto 후 0.78~3.09초(4건, 평균 약 1.5초). 판정 호출 시간이 그대로 더해진다.
  - 대기 상한을 2.5초로 줄이고 직전 답변 조회를 없앤 뒤 재측정(3건): 0.77~1.38초(평균 약 1.0초, 1.38초는 리로드 직후라 대화 기록을 읽은 경우). 3건 모두 상한 안이라 auto로 나갔다. 표본이 적어 개선 폭은 확정하지 않는다. 판정은 간단한 질문 → medium, Read+Edit 수정 → high, 대안 2가지를 짧게 제시하는 설계 질문 → high(예상 xhigh). 캐시 읽기는 effort가 바뀐 직후에도 99%.
- 밴드 훅이 `next(e)`로 넘기면 테스트에서는 아래에 그릴 것이 없어 오류가 난다. 테스트에서는 빈 `Box`를 그리는 대역을 둔다.
- 엔진은 파일을 바꾸는 Bash(`touch`)까지 Read, `ls`와 함께 한 줄로 접는다("Read 1 file, listed 1 directory, ran 2 shell commands"). Bash 용도는 `ToolUse` 행과 `ToolGroup` 줄 양쪽에 붙여야 보인다.

## 테스트 방법
- 같은 폴더에서 Claude 세션을 하나 더 열어 테스트 세션으로 쓴다. 개발 세션이 SendMessage로 "시나리오 N · …" 메시지를 보내고(`notify_when_idle`), 테스트 세션은 적힌 도구만 쓰고 끝에 `실제: …`를 적는다.
- 정답은 테스트 세션의 기록 파일(`~/.claude/projects/<폴더>/<세션 id>.jsonl`)의 도구 호출과 `turn_duration` 행에서 뽑고, 화면 쪽은 `/activity` 출력과 대조한다.
- 코드를 고치면 테스트 세션에서도 `/reload-plugins`를 해야 한다.
