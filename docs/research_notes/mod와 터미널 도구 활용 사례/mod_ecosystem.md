# Claude Code mod 생태계 현황 (조사일 2026-10-26, 최신 빌드 2.1.310)

표시: [공식] Anthropic 문서·저장소·CHANGELOG·블로그 / [커뮤니티] 제3자 저장소·갤러리·블로그 / [추론] 조사자의 판단(검증 안 됨).
날짜를 모르면 "접속 2026-10-26". 버전별 배포일은 npm 레지스트리 시각(UTC)이다([npm](https://registry.npmjs.org/@anthropic-ai/claude-code), 접속 2026-10-26): 2.1.259=09-02, 2.1.284=09-28, 2.1.286=09-30, **2.1.287=10-01**, 2.1.290=10-05, 2.1.295=10-08, 2.1.299=10-14, 2.1.301=10-15, 2.1.304=10-19, 2.1.305=10-20, **2.1.308=10-22(stable)**, 2.1.309=10-22, **2.1.310=10-23(latest)**.
각 항목 끝의 "→ hubblerc:"는 관련 기능(F1~F5) 또는 새 아이디어·구현 요령이다.

## 1. 공식 문서가 허용하는 것: 그리기 자리, 이벤트, 커맨드, config, 상태, 키 입력, 제약, 공식 예제

### Takeaway
공식 문서(overview·create·interface·gallery·events·api·test·troubleshoot·admin·reference 10쪽)는 pane, 프롬프트 위 band, toast, 프롬프트 아래 status line, 대화 안 log line, 기존 행(도구 행·스피너·메시지·TurnDuration·SessionMode 등) 다시 그리기를 허용한다. 반면 키보드는 "mod가 직접 읽지 않는다"고 못박고, 엔진 키 동작을 버튼에 빌려 붙이는 `action`과 band의 숫자 hotkey만 예외로 둔다. hubblerc가 막힌 네 가지(키 바인딩, Esc, 144칸, $.store 4MiB)는 모두 문서에 적힌 그대로의 제약이다.

### Cited Findings

**정의·범위**
- [공식] mod는 "a plugin that changes how Claude Code looks and behaves. It's made of JavaScript or TypeScript event handlers"(Claude Code의 모양과 동작을 바꾸는 플러그인. JS/TS 이벤트 핸들러로 이루어진다). 훅은 observe / rewrite / answer 세 가지를 할 수 있고, 밖으로 나가는 일(그리기, 커맨드, 모델 호출, 파일, 프로세스, 네트워크)은 모두 `$`(mods API)를 거친다 — [overview](https://code.claude.com/docs/en/plugins/mods/overview) (접속 2026-10-26). → hubblerc: 전체 구조의 전제.
- [공식] 파일 구성: `.claude-plugin/plugin.json`, `hooks/hooks.json`의 `"modules": ["./register.js"]`(경로 하나), 훅 모듈은 ES 모듈이고 `register(on, options)`를 내보낸다. `options`는 manifest의 `userConfig` 값(기본값 채움). `$.state`를 쓰면 `types/index.d.ts`에 `PluginState` 선언 필요 — [reference#files](https://code.claude.com/docs/en/plugins/mods/reference) (문서 기준 CLI·Desktop v2.1.290, VS Code v2.1.299). → hubblerc: 이미 따르는 구조.
- [공식] 버전: 터미널은 v2.1.287부터 기본 켜짐, Desktop은 v2.1.286부터. `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS`는 2.1.287부터 무시된다 — [overview#turn-mods-on-or-off](https://code.claude.com/docs/en/plugins/mods/overview). → hubblerc: 기준 빌드 2.1.308은 범위 안.
- [공식] 동작 위치: 터미널·Desktop Code 탭·VS Code(확장 2.1.299+, 피처 플래그를 못 받는 세션은 2.1.304+)에서 그려지고, `claude -p`/Agent SDK/클라우드 세션은 훅만 돌고 그리지 않는다 — [overview#where-mods-run](https://code.claude.com/docs/en/plugins/mods/overview). → hubblerc: 스튜디오·미니 배포 때 같은 터미널이면 차이 없음.

**그리기 자리(render site)**
- [공식] 터미널에서 mod가 그릴 수 있는 곳: 오른쪽 사이드바 pane, 대화 오른쪽 위 toast, 대화 안 log line, 프롬프트 위 band, 프롬프트 아래 status line. 그리고 메시지·도구 행·스피너는 다시 그릴 수 있다. "The prompt is Claude Code's own."(프롬프트 입력창은 엔진 것) — [interface](https://code.claude.com/docs/en/plugins/mods/interface) 화면 지도 설명.
- [공식] `ui.render`의 `e.component` 값 전체: `Pane`(props: title, isFocused, bodyColumns, placement, scroll, view), `AbovePrompt`(hasSurvey, isWorking, maxRows, bodyColumns, scroll, view), `UserMessage`, `AssistantMessage`, `ToolUse`/`ToolResult`/`ToolGroup`, `CommandOutput`, `AskUserQuestion`, `ToolProgress`(터미널만), `Spinner`, `TurnDuration`(터미널만), `InfoNotice`(터미널만), `SessionMode`(푸터 모드 라벨), `PromptHint`(프롬프트 아래 힌트 줄) — [reference#render-sites](https://code.claude.com/docs/en/plugins/mods/reference). → hubblerc: F1(AbovePrompt), F2(Pane), F4(ToolUse·ToolGroup), F5(TurnDuration). `SessionMode`·`PromptHint`는 아직 안 쓰는 자리(아래 5절 아이디어).
- [공식] 폭·높이: band와 pane은 `e.props.bodyColumns`에 맞춰 그린다. 옆 pane(`placement: 'dock'`)은 `e.props.scroll.bodyRows`가 높이, 프롬프트 위 pane(`'inline'`)은 내용만큼 커지다가 한도에서 멈춘다. `e.viewport`(columns, rows, isFullscreen)는 터미널에서 창을 재기 전까지 없고, `rows`는 창 전체 높이다 — [reference#render-sites](https://code.claude.com/docs/en/plugins/mods/reference). → hubblerc: F2 auto 판정에 `e.viewport.columns`를 쓰는 현재 방식과 일치.
- [공식] band는 "always there, and every mod shares it"(항상 있고 모든 mod가 같이 쓴다). 트리를 돌려주면 뒤 순서 mod의 band를 덮으므로, 같이 보이려면 `await next(e)` 결과를 `Box` 자식에 넣으라고 한다. 그 `Box`(와 바깥 Box)에 width/height/position/display/overflow 등을 주면 트리가 거부된다 — [interface#pick-where-to-draw](https://code.claude.com/docs/en/plugins/mods/interface), [troubleshoot](https://code.claude.com/docs/en/plugins/mods/troubleshoot) "Another mod's band shows and yours doesn't". → hubblerc: F1 밴드가 다른 mod의 밴드를 지우지 않으려면 `next(e)`를 자식으로 품어야 함.
- [공식] 기존 자리에서 할 수 있는 것: 세부 바꾸기(`next({...e, props})`), 통째 바꾸기(트리 반환), 그대로 두기(`next(e)`). 권한 확인 프롬프트는 render site가 아니라 바꿀 수 없다 — [interface#change-what-claude-code-already-draws](https://code.claude.com/docs/en/plugins/mods/interface). → hubblerc: F4가 쓰는 방식.
- [공식] 텍스트 출력 3종: `$.ui.status(text)` = 프롬프트 아래 한 줄, 바꿀 때까지 유지, `⚠ 이름:`으로 시작 / `$.ui.toast(text)` = 전체 화면에서는 오른쪽 위 상자, 기본 4초 / `$.ui.log(text)` = 대화 안 흐린 줄(Claude는 안 읽음, `● 이름:`) / `$.ui.notify(text)` = 터미널 밖 OS 알림(`preferredNotifChannel` 따름, 2.1.295+) — [api#show-something-without-starting-a-turn](https://code.claude.com/docs/en/plugins/mods/api). → hubblerc: 후보 "MCP 끊김 경고·컨텍스트 경고"는 toast/notify로, 긴 답변 끝 알림은 notify로 가능.
- [공식] 요소: Box, Text, Button, Link, Code(diff 포함), Markdown, Input(`rows` 2.1.301+), Select, Svg(터미널 불가), Client, Raster(터미널만, 512×256), Image(터미널만, 2MiB) — [reference#elements](https://code.claude.com/docs/en/plugins/mods/reference), [gallery](https://code.claude.com/docs/en/plugins/mods/gallery). Text 색은 2.1.290부터 `ThemeKey`/`Color` 타입 제공 — [CHANGELOG 2.1.290](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md). → hubblerc: F1은 터미널 색 이름을 쓰는 중. 테마 키를 쓰는 mod(statuspane, effort-cycle)와 갈리는 지점(5절).

**pane 열기·폭**
- [공식] `$.ui.open({ id, title, focus, closeOnEscape, holdToasts, rows, columns })`. `columns`는 옆 pane 폭 요청이며 최대 터미널 폭의 45%, 사람이 드래그한 폭이 있으면 그것이 우선. `focus`/`closeOnEscape`/`holdToasts`는 `true`만 받고 `false`를 주면 오류 — [interface#open-a-pane-at-the-right-time](https://code.claude.com/docs/en/plugins/mods/interface).
- [공식] "A pane your mod opens without being asked doesn't appear in a narrow terminal"(요청 없이 연 pane은 좁은 터미널에 안 나온다). 사람이 한 일(커맨드, 버튼)로 열면 폭과 무관, mod가 스스로(타이머, `turn.start`) 열면 144칸 이상, 사람이 한 번 연 뒤에는 110칸. 결과는 `{ isPlaced, reason }` — [interface#when-a-pane-waits-for-a-wider-terminal](https://code.claude.com/docs/en/plugins/mods/interface), [reference#limits](https://code.claude.com/docs/en/plugins/mods/reference). → hubblerc F2: 144/110 규칙은 2.1.310까지 바뀐 기록이 없다(2절).
- [공식] 여러 pane이 열리면 제목 탭이 생긴다. 좁은 터미널에서는 pane이 프롬프트 위 틀 안에 놓인다 — [interface](https://code.claude.com/docs/en/plugins/mods/interface).

**키 입력**
- [공식] "Your mod never reads the keyboard itself."(mod는 키보드를 직접 읽지 않는다.) band 숫자 hotkey와 `action` 바인딩을 빼면, pane/band가 키보드 포커스를 가진 동안에만 컨트롤 콜백이 돈다 — [interface#keyboard-focus-and-hotkeys](https://code.claude.com/docs/en/plugins/mods/interface). → hubblerc F1·F3: "mod는 키 바인딩을 못 만든다"는 공식 사실.
- [공식] `Button.action`: "names one of Claude Code's own keybinding actions, and the user's binding for it presses the button when that binding is a chord or a modified key"(엔진 키 동작 이름을 붙이면, 그 동작에 묶인 키가 조합키나 수식키일 때 버튼을 누른다). band 버튼의 숫자 hotkey는 빈 프롬프트에 그 숫자만 치고 멈춰도 눌린다. 접힌 band에서는 둘 다 안 된다. 같은 hotkey 두 개면 나중 것이 이긴다 — [reference#elements](https://code.claude.com/docs/en/plugins/mods/reference). 타입 정의 주석: "no engine handler of the action mounted; a pane's over the band's over another's, then the last drawn"(엔진 쪽 처리기가 떠 있지 않을 때만, pane 버튼 > band 버튼 > 다른 것 > 마지막에 그린 것 순) — [claude-code.d.ts](https://github.com/anthropics/claude-code/blob/main/mods/types/claude-code.d.ts) (GitHub 사본은 2.1.277이 쓴 것, 접속 2026-10-26). 예시 이름이 바로 `"app:cycleDiffBase"`다. → hubblerc F1: `ctrl+x ctrl+e` → `app:cycleDiffBase` 우회는 문서가 예로 든 방식 그대로이고, diff 패널이 떠 있으면 엔진이 가져가는 것도 문서와 일치.
- [공식] 포커스가 있을 때 키: Tab/화살표(컨트롤 이동·스크롤), Enter(누르기), hotkey(한 자리 숫자 또는 소문자 한 글자), Ctrl+X 화살표(pane 크기), Ctrl+X X(pane 닫기), **Ctrl+X Ctrl+A(band 접기/펴기, 프롬프트에 포커스가 있어도 동작)**, **Esc는 포커스를 프롬프트로 돌려줌**(`closeOnEscape`면 pane도 닫음). "A mod can't bind Tab or the arrow keys to anything else" — [interface#what-each-key-does](https://code.claude.com/docs/en/plugins/mods/interface). → hubblerc: Esc를 받을 수 있는 건 `closeOnEscape` pane뿐이라는 hubblerc 결론과 일치.
- [공식] 키 설정 쪽: 문맥 `AbovePrompt`, `AbovePromptInput`, `AbovePromptSelect`, `Pane`, `PaneField`가 있고, 동작 `abovePrompt:toggle`(Ctrl+X Ctrl+A), `abovePrompt:focus`(Ctrl+X Tab), `abovePrompt:leave`(Escape), `pane:grow`, `pane:close` 등. 그리고 **`command:<name>`: "Run the command `/<name>`"** (Chat 블록에서 임의 키로 커맨드 실행) — [keybindings](https://code.claude.com/docs/en/keybindings) (접속 2026-10-26). → hubblerc: `command:panel`은 이미 사용 중. effort 슬라이더도 mod 커맨드로 만들어 `command:`로 묶으면 diff 동작을 빌리지 않아도 된다(5절).
- [공식] `/effort` 슬라이더 문맥(`EffortSlider`)에 `effortSlider:decreaseEffort`/`increaseEffort`/`toggleUltracode`가 2.1.284에 생겼다(슬라이더 안의 ←/→/Tab 재지정용) — [keybindings](https://code.claude.com/docs/en/keybindings), [CHANGELOG 2.1.284](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md). → hubblerc F3: Chat 문맥의 "effort 올리기/내리기" 동작은 여전히 없다는 hubblerc 확인과 모순되지 않음(슬라이더 안에서만 동작).
- [공식] 포커스 이벤트 `ui.focus`는 "a site's focus ring about to move onto one of the elements … or off them"이고 origin은 `person`(Tab, 화살표, 클릭) 또는 `plugin`뿐 — [claude-code.d.ts](https://github.com/anthropics/claude-code/blob/main/mods/types/claude-code.d.ts) (2.1.277 사본). `ui.close`는 pane이 닫히기 직전에 오며 `e.origin.kind`가 `plugin`/`person`/`unload` — [reference#interface](https://code.claude.com/docs/en/plugins/mods/reference).

**이벤트·커맨드·모델 호출**
- [공식] 이벤트 묶음: 도구(`tool.call`, `tool.check`, `tool.describe`), 프롬프트(`prompt.submit`, `prompt.fill`, `prompt.suggest`, `prompt.edit`(50ms 한도), `prompt.change`(2.1.300+), `prompt.autocomplete`(2.1.292+), `prompt.compose`, `prompt.section`, `prompt.context`, `prompt.attachment`, `prompt.mention`, `skill.prompt`, `attribution.text`), 커맨드·설정(`command.run`, `command.describe`, `config.set`, `config.describe`, `settings.read`), 턴(`turn.start`, `turn.step`, `turn.complete`), 세션(`session.start`, `session.end`, `session.compact`, `session.receive/send`, `session.append`, `session.attach/detach`, **`session.measure`: 각 턴 뒤와 플랜 한도 %가 바뀔 때**), 서브에이전트(`agent.offer`, `agent.spawn`), UI(`ui.render`, `ui.resolve`, `ui.press/input/select`, `ui.focus`, `ui.scroll`, `ui.close`, `ui.message`, `ui.fault`), 다른 mod(`plugin.register`, `engine.create`), 텔레메트리, `classic.<설정 훅 이벤트>`, 그리고 모든 `$` 메서드 이름 자체 — [reference#events](https://code.claude.com/docs/en/plugins/mods/reference). → hubblerc: 한도 소진 예측은 `session.measure`에 거는 게 타이머보다 맞을 수 있음 [추론].
- [공식] `turn.step`은 async generator이고 `next({ ...e, model })`, `next({ ...e, effort })`로 그 요청만 바꾼다. `result.usage`에 input/output/cache_read/cache_creation과 응답 모델, 2.1.290+ `serverToolUses` — [events#follow-a-turn](https://code.claude.com/docs/en/plugins/mods/events). → hubblerc F3 자동 effort의 근거.
- [공식] 커맨드: `$.command.register({ name, description, argumentHint, immediate })`. `immediate: true`면 Claude가 일하는 중에도 바로 실행, 아니면 턴 끝까지 대기. 반환 `text`는 대화에 찍히고 Claude가 읽는다, `{}`면 아무것도 안 찍음. 내장 커맨드 이름이면 throw — [api#add-a-command](https://code.claude.com/docs/en/plugins/mods/api).
- [공식] `$.model.complete`(세션 자격으로 과금, `maxTokens` 기본 1024, `effort` 옵션, 2.1.292+ `cache: true` 블록), `$.model.fork`(대화 전체 + 내 프롬프트, 캐시 재사용), `$.model.classify` — [api#call-a-model](https://code.claude.com/docs/en/plugins/mods/api), [reference](https://code.claude.com/docs/en/plugins/mods/reference). → hubblerc F3: `classify`를 쓸 계획과 일치.
- [공식] `$.session.usage()` = `{ startedAt, context{tokens, window, percent}, rateLimits[{kind, percentUsed, resetsAt}], cost }`; `$.agent.list()`의 status는 pending/running/waiting/idle/completed/failed/killed(idle·waiting 2.1.289+) — [reference#mods-api-methods](https://code.claude.com/docs/en/plugins/mods/api). Addy Osmani 글: "The call is free: it only sends a token-count request if you ask for a `breakdown`."(breakdown을 요청할 때만 토큰 세기 요청이 나간다) — [Getting Started with Claude Code Mods](https://claude.dev/blog/getting-started-with-claude-code-mods/) (2026-10-01). → hubblerc F1: 지금처럼 breakdown 없이 부르면 비용 없음. 자동 압축 경고에 breakdown을 쓰면 요청이 생김.

**config(userConfig)**
- [공식] `userConfig` 값은 `pluginConfigs`에 플러그인 id(예: `first-mod@inline`) 키로 저장되고, 위치는 사용자 또는 관리 설정 — [reference#settings-and-environment-variables](https://code.claude.com/docs/en/plugins/mods/reference). `config.describe`/`config.set` 이벤트로 `/config` 행을 꾸미거나 막을 수 있다 — [reference#commands-and-configuration](https://code.claude.com/docs/en/plugins/mods/reference). → hubblerc F2: "프로젝트 설정은 안 읽는다"는 디버그 로그 관찰과 문서가 일치(사용자/관리만 명시).

**상태 저장**
- [공식] 3단계: 모듈 변수(리로드마다 초기화) / `$.state`(세션 끝 또는 `/clear`·`/resume`·`/branch`까지, 리로드는 견딤, 읽은 render를 자동 다시 그림) / `$.store`(기기 전체 세션 공유, `~/.claude/plugins/store/` 아래 JSON, `cleanupPeriodDays` 동안 아무도 안 쓰면 삭제) — [interface#keep-state](https://code.claude.com/docs/en/plugins/mods/interface).
- [공식] "/clear, /resume, /branch … reset every `$.state` value to its default, and `session.start` doesn't fire again."(세 명령은 `$.state`를 기본값으로 되돌리고 `session.start`는 다시 안 온다.) 대신 `classic.SessionStart`가 `source` = clear/resume/fork로 온다 — [interface#load-a-saved-value-again-after-clear](https://code.claude.com/docs/en/plugins/mods/interface). → hubblerc F5: resume 복원 시점을 `classic.SessionStart{source:'resume'}`에도 걸어야 같은 프로세스 안 `/resume`을 잡는다 [추론: hubblerc는 프로세스 재시작 resume만 다룸].
- [공식] `$.store`는 4 MiB JSON 합계, get→set은 원자적이지 않아 세션끼리 경합; 키를 나누고 쓰기 직전에 다시 읽으라고 권함. `$.fs.write`도 원자적이지 않으니 여러 세션이 바꾸는 데이터는 store에 두라고 함. `$.fs` 한 파일 4 MiB — [reference#limits](https://code.claude.com/docs/en/plugins/mods/reference), [interface#save-from-more-than-one-session](https://code.claude.com/docs/en/plugins/mods/interface). → hubblerc: "오늘 누적 비용" 후보는 날짜별 키로 쪼개면 4MiB 안에서 가능 [추론].
- [공식] 렌더 중에는 상태를 쓸 수 없다("a `ui.render` hook can read state and can't write it"), atom은 `const`로, plugin/key는 문자열 리터럴로 — [interface#define-read-and-write-a-value](https://code.claude.com/docs/en/plugins/mods/interface). → hubblerc 개발 메모의 validate 규칙과 같다.

**제약(limits 표 발췌)**
- [공식] 훅 자체 실행 10초(`prompt.edit`는 50ms, `$` 호출 안에서 기다린 시간은 제외), `.catch` 1초, `session.end` 전체 1.5초, `$.process.run` 기본 30초, http 30초·4MiB, 트리 텍스트 10만 자, `$.session.messages()` 최근 4,096개, `$.ui.invalidate` 초당 10회(터미널의 보이는 pane·펼친 band·힌트 줄은 30회), 이름은 영문·숫자·`_`·`-` 64자, 테스트 하나 5초 — [reference#limits](https://code.claude.com/docs/en/plugins/mods/reference).

**테스트·검증**
- [공식] `claude plugin validate`(hooks:/calls: 줄, `--json`, `--strict`), `claude plugin test`(`*.test.ts(x)`, 세션·로그인·네트워크 없이, stub으로 엔진 답 대체, `$.ui.press({plugin,key})`, `mock.store/clock/env`) — [test](https://code.claude.com/docs/en/plugins/mods/test), [built-in mods README](https://github.com/anthropics/claude-code/tree/main/mods). `claude plugin test`를 mod 없는 폴더에서 돌리면 원격 차단 여부가 나온다("the rollout switch served off" = Anthropic이 원격으로 끔) — [troubleshoot#check-whether-mods-can-load](https://code.claude.com/docs/en/plugins/mods/troubleshoot).

**공식 예제 mod**
- [공식] 내장 mod(소스 공개): `diff`(/diff pane, "buttons bound to keyboard actions and scrolling the mod handles itself"), `agents-md`(userConfig 예), `sec-default`(정책 가드), `telemetry`(다른 mod가 부를 메서드와 타입 제공). 그 밖에 `/plugin`에는 `cc-plugin-plugin-authoring`(스킬), `cc-plugin-you-should-know`(옆 에이전트가 프롬프트 위에 메모, 기본 꺼짐, 2.1.287 추가) — [overview#mods-built-into-claude-code](https://code.claude.com/docs/en/plugins/mods/overview), [anthropics/claude-code/mods](https://github.com/anthropics/claude-code/tree/main/mods). → hubblerc: diff mod 소스는 "키 동작에 묶인 버튼 + 직접 스크롤" 구현 참고서.
- [공식] 샘플 mod(지원 없음, [claude-code-playground](https://github.com/anthropics/claude-code-playground/tree/main/claude-code/mods), 저장소 생성 2026-09-25, 마지막 push 2026-10-14, 별 293, 접속 2026-10-26): `token-weather`(band 1줄 컨텍스트 예보), `blast-radius`(위험 Bash를 붙잡고 pane에 영향 범위 + 진행/취소, 좁으면 band로), `replay-theater`(`/replay`로 직전 턴의 편집을 한 단계씩). 셋 다 2.1.280에서 만들고 2.1.285에서 validate 통과. → hubblerc: F1(token-weather), F5(replay-theater)와 같은 계열.
- [공식] 발표 글(2026-10-01): "available today" in CLI and desktop, 앞으로 "move more built-in features to mods over time"(더 많은 내장 기능을 mod로 옮길 예정). 키 바인딩·API 안정성에 대한 약속은 없음 — [claude.com/blog/claude-code-mods](https://claude.com/blog/claude-code-mods).

### Inferences
- [추론] 키 입력 설계는 의도적으로 닫혀 있다: 엔진이 키를 해석한 뒤 컨트롤에 넘기는 구조라, mod 전용 키 바인딩이나 Esc 이벤트가 생기려면 엔진 쪽 API 추가가 필요하다. 지금 열린 길은 `Button.action`(엔진 동작 빌리기), band 숫자 hotkey, `command:<name>` 키 설정(사용자가 keybindings.json에 직접), `closeOnEscape` pane 넷이다.
- [추론] `SessionMode`(푸터 모드 라벨)와 `PromptHint`(프롬프트 아래 힌트 줄)는 band의 3줄 높이를 늘리지 않고 1~2개 값을 놓을 수 있는 자리다. 실제로 effort-cycle, hud가 이 자리를 쓴다(5절).

### Gaps
- [공식] 문서에 한글 등 입력기(IME) 조합 중 키 처리에 대한 설명은 없다(키보드 문서·mod 문서 모두 검색, 접속 2026-10-26).
- 공식 타입 정의는 GitHub 사본이 2.1.277이라 2.1.308의 정확한 시그니처는 로컬 `/plugin-types` 출력으로 확인해야 한다(문서도 그렇게 권함).

## 2. CHANGELOG 2.1.259~2.1.310의 mod/function hooks 변경, 2.1.308 이후 새 API

### Takeaway
CHANGELOG에 "mod"가 처음 나오는 건 2.1.287(2026-10-01)이고 그 전 early access 기간(2.1.259~2.1.286)에는 함수 훅 항목이 없다. 2.1.288~2.1.305에 API 추가가 몰려 있고, 2.1.308은 "Bug fixes and reliability improvements" 한 줄, 2.1.309·2.1.310에는 mod 수정 몇 개뿐이다. hubblerc가 막힌 키 바인딩·Esc·패널 폭 문제를 푸는 새 API는 2.1.310까지 없다. 오히려 2.1.305에서 옆 pane 폭을 45%로 제한하는 변경이 들어갔다.

### Cited Findings
(모두 [공식] [CHANGELOG.md](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md), 접속 2026-10-26. 날짜는 npm 배포일.)

**2.1.308 이후 (hubblerc 기준 빌드보다 새것)**
- 2.1.309(10-22): "Fixed a mod's `turn.step` hook that names a model by alias, such as `haiku`, failing every request with a model error"(turn.step에서 `haiku` 같은 별칭으로 모델을 지정하면 모든 요청이 실패하던 문제 수정). → hubblerc F3: 2.1.308에서는 `turn.step`의 model에 별칭을 쓰면 안 된다(effort만 바꾸면 무관).
- 2.1.309: "Fixed key-bound slash commands running in the shell from `!` mode"(키에 묶은 슬래시 커맨드가 `!` 모드에서 셸로 실행되던 문제). → hubblerc: `ctrl+x ctrl+p` → `command:panel`이 `!` 모드에서 오작동할 수 있던 버그가 2.1.309에서 고쳐짐.
- 2.1.309: hooks 모듈이 너무 깊게 중첩돼 못 읽을 때 파일 이름을 알려 줌 / [VSCode] 프롬프트 위 "From the … plugin" 라벨이 슬래시 메뉴를 덮던 문제(#102981).
- 2.1.310(10-23): "Improved a mod's `Image` to draw inside tmux with `allow-passthrough` and `focus-events` on, in kitty, Ghostty, and iTerm2 3.5+ with fullscreen rendering". → hubblerc: 무관(이미지 안 씀).
- 키 바인딩, Esc 이벤트, 패널 배치 폭, `$.store` 한도에 관한 변경: 2.1.308~2.1.310에 없음.

**2.1.287~2.1.305 주요 mod API 추가·변경 (hubblerc 관련 위주)**
- 2.1.287(10-01): You should know 내장 mod 추가(기본 켜짐 전환 릴리스).
- 2.1.288(10-02): `$.ui.selection()`(전체 화면에서 마지막 선택 텍스트와 그 행) / 전체 화면에서 mod가 프롬프트 위에 행을 그리는 중 백그라운드 작업 대화상자를 열면 "unrecoverable interface error"로 끝나던 문제 수정. → hubblerc F1: 밴드 + 백그라운드 작업 조합 충돌이 2.1.288에서 해결됨.
- 2.1.289(10-03): pane/band 오른쪽 정렬 내용이 닫기 표시나 `[-]` 밑에 그려지던 문제, band 그리기 실패 시 아래 카드가 비키던 문제, `ui.fault` 추가, `$.agent.list` status에 idle/waiting.
- 2.1.290(10-05): `ThemeKey`·`Color` 타입 / "Fixed a mod's pane or band being redrawn without end when it followed its end over a tree that changed height at every drawing" / "**Fixed plugin hooks stalling each redraw when a mod draws a long multi-line text holding non-Latin characters**"(비라틴 문자가 든 긴 여러 줄 텍스트를 그리면 다시 그릴 때마다 멈칫하던 문제) / `tool.check`에 `agentId`. → hubblerc: 한글 질문 제목·답변 요약을 밴드·사이드바에 그리므로 2.1.290 이후 버전이 필요. 높이가 매번 바뀌는 트리는 무한 재그리기 위험(hubblerc가 밴드 높이를 고정한 결정과 맞음).
- 2.1.292(10-06): `prompt.autocomplete`, `$.model.complete` 프롬프트 캐싱, 많은 `$.state` 호출이 로드를 몇 분씩 늦추던 문제 수정.
- 2.1.293(10-07): `$.tool.register`의 `isDeferred`, `claude plugin test`에 `mock.session`(`$.session.append` 결과 읽기).
- 2.1.295(10-08): `$.ui.notify`, `Button` 자식(Text·문자열), 핫 리로드 놓침 수정 여러 개, 조직 mod의 toast 우선.
- 2.1.296(10-09): Esc/인터럽트가 `prompt.submit` 훅 중에 오면 헤드리스 세션이 끝나거나 프롬프트가 지워지던 문제 수정.
- 2.1.299(10-14): "**Changed the `turn.start` mod hook to also hear subagents' and teammates' turns, not only the main loop's; tell them apart by `e.agentId`**"(turn.start가 서브에이전트 턴도 받도록 변경 — 깨지는 변경) / `Text`의 `size`·`weight`·`mono`·`tabular`, `Box` 간격 단계 `xs~xl`, `bold`는 `weight`로 대체 권장 / `claude plugin test`의 render 트리 루트에 `part: { plugin }`이 붙음(정확한 트리 비교 테스트가 깨짐) / `$.ui.open`이 그릴 곳 없는 세션에서 placed라고 답하던 문제 수정 / `dimColor`가 다크 ANSI 테마·16색에서 일반 글자와 같아 보이던 문제 수정 / `$.ui.invalidate` 뒤 `tool.describe`·`prompt.section` 답이 Claude에 안 가던 문제 / 원격으로 꺼진 mod가 턴 사이에 내려감. → hubblerc: F5의 `turn.start` 집계는 `e.agentId`로 거르는지 확인할 것. dimColor 수정은 F1의 흐린 라벨·구분선에 직접 영향(Kanagawa ANSI 테마).
- 2.1.300(10-14): `prompt.change`, `virtualText`(프롬프트 안에 초안에 안 들어가는 글자), `$.ui.view({ agentId })`(에이전트 대화를 메인 화면에), `Text.dir`(RTL), `prompt.edit`가 `chat:newline` 줄바꿈에 안 오던 문제.
- 2.1.301(10-15): `Input.rows`(여러 줄 입력), `.catch` 의미 변경(훅이 throw/timeout일 때만), `$.env.set` 반환값 변경.
- 2.1.304(10-19): 앞 순서 플러그인이 내 훅을 건너뛰면 대화에 한 줄 표시, `tool.check`의 `decider: "person"`·`e.isReadOnly`, 버튼 같은 label·key 없을 때 클릭 유실 수정, `settings.read`가 설정 층마다 받도록 변경.
- 2.1.305(10-20): "**Changed a mod's docked pane to stay within 45% of the terminal's width, including a width kept from a wider terminal**"(옆 pane은 터미널 폭의 45% 이내, 넓은 터미널에서 기억한 폭도 포함). → hubblerc F2: 작은 모니터 110~143칸에서 사이드바는 최대 49~64칸. 사이드바 내용을 그 폭 기준으로 설계해야 함.
- 2.1.304·2.1.309 [VSCode]: VS Code 패널에서 mod 그리기 확대(Bedrock·게이트웨이·텔레메트리 꺼짐도) — hubblerc 무관.

**early access 기간(2.1.259~2.1.286)**
- [공식] 이 기간 CHANGELOG에는 "mod"/"function hook"/"hooks module" 항목이 없다(2.1.259 `claude plugin validate --json`, 2.1.271 훅 대기 표시 등 설정 훅·플러그인 항목만). 함수 훅은 `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1` 뒤에 있었다는 것이 설계 이슈(#91870, 2026-09-03 poteat 작성)에 적혀 있다 — [issue #91870](https://github.com/anthropics/claude-code/issues/91870). 이슈 갱신: 09-09 "committed to shipping function hooks, on the scale of weeks", 10-01 "We're live!".
- [커뮤니티] 2.1.308 Desktop에서 사용량 푸터 mod가 사라졌고 `tengu_plugin_hooks_modules`가 false, `claude plugin test`가 "installed mods are turned off remotely"를 보고했다는 댓글(615morimotorinta-bot, 2026-10-23) — [issue #91870](https://github.com/anthropics/claude-code/issues/91870). → hubblerc: 원격 차단 스위치가 실제로 쓰인 사례. 회사 스튜디오 배포 전에 `claude plugin test`로 상태 확인.
- [커뮤니티] 2.1.308 기준 스캔에서 6,097개 중 68개가 validate 실패 — [karanb192/awesome-claude-code-mods catalogue](https://github.com/karanb192/awesome-claude-code-mods/blob/main/catalogue.md) (2026-10-22 스캔). 예: `effortless`(HeyCubit)는 "fails on 2.1.308".

### Inferences
- [추론] 2.1.299는 hubblerc 같은 관찰형 mod에 가장 영향이 큰 릴리스였다(`turn.start` 범위, 테스트 트리 형태, dimColor). 버전을 올릴 때마다 CHANGELOG에서 "mod"를 grep해 깨지는 변경을 확인하는 절차가 필요하다.
- [추론] 키·Esc·패널 폭 관련 요청은 #91870 스레드에도 거의 없다(한 명이 "두 개의 안 쓰는 키 동작을 빌렸다"고 언급). 가까운 시일 안에 공식 API가 생길 신호는 찾지 못했다.

### Gaps
- GitHub API 호출 한도에 걸려 GitHub Releases 페이지의 릴리스 노트 원문은 따로 보지 않았다. CHANGELOG.md와 npm 배포 시각으로 대신했다.
- 2.1.308 자체의 변경 내역은 "Bug fixes and reliability improvements" 한 줄뿐이라, 2.1.307→2.1.308에서 mod 쪽 변화가 있었는지 알 수 없다.

## 3. 공개된 mod 목록과 갤러리 (터미널 생산성·사용성 중심)

### Takeaway
공개 mod는 3주 만에 수천 개다. 자동 스캔 카탈로그 두 곳이 각각 6,097개(karanb192, 2026-10-22)와 6,127개(mods4claude)를 센다. aitmpl.com은 45개만 골라 담았다. 상태/HUD·사용량 band가 가장 붐비는 범주다. claude-hud의 기능을 그대로 mod로 옮긴 것(hoobnn `hud`)과 hubblerc F1과 거의 같은 카드(xuanji86 `statuspane`)도 이미 있다. 별 수는 대부분 저장소 단위라 mod 하나의 인기를 그대로 보여 주지는 않는다.

### Cited Findings

**갤러리·카탈로그**
- [커뮤니티] aitmpl.com/mods: 45개, `npx claude-code-templates@latest --mod <경로>`로 설치. 페이지는 JS 렌더라 [카탈로그 API](https://www.aitmpl.com/api/v1/catalog/mods.json)(generatedAt 2026-10-25)로 전부 확인. 범주별: games 15, productivity 9, security 7, integrations 6, ui 5, observability 2, enterprise 1. 다운로드 상위: prompt-cache-control 2,951 / jev-model-router 1,779 / jev-skill-suggestion 1,693 / stack-viewer 490 / turn-inspector 353 / agent-flow 316 / ultra-config 222 / secret-redactor 106 / pet 98. 각 항목에 skillspector 스캔 등급(예: prompt-cache-control HIGH 58점, stack-viewer CRITICAL)이 붙음. aitmpl 설치는 `.claude/skills/<이름>/`에 쓰고 `@skills-dir`로 자동 로드되며, 신뢰한 프로젝트에서만 읽힌다(jev-model-router README) — [aitmpl](https://www.aitmpl.com/mods), [llms.txt](https://aitmpl.com/llms.txt) (접속 2026-10-26). → hubblerc: 터미널 생산성 관련은 아래 개별 항목.
- [커뮤니티] karanb192/awesome-claude-code-mods + [mods.aidojo.si](https://mods.aidojo.si/): "As of 2026-10-22, scanned against Claude Code 2.1.308: 6097 mods in 3169 candidate repos … 1942 see every tool call, 1767 see every prompt, 68 fail to validate"(2.1.308 기준 6,097개, 모든 도구 호출을 보는 것 1,942개, 모든 프롬프트를 보는 것 1,767개, validate 실패 68개). 접근 수준: L0(그리기·기억) 511, L1(읽기) 1,515, L2(쓰기·실행) 3,220, L3(네트워크) 660. Anthropic 플러그인 디렉터리에도 있는 것 58개. 별 열은 저장소 별 — [catalogue.md](https://github.com/karanb192/awesome-claude-code-mods/blob/main/catalogue.md). → hubblerc: 비교 대상 찾기에 쓴 1차 자료.
- [커뮤니티] mods4claude.com: 6,127개, 범주 Panes 2,616 / Bands 2,631 / Status line 1,269 / Toasts 407 / Reskins 1,320 / Guards 3,339 / Commands 4,368 등(중복 태그). 정렬: Most starred, Recently updated 등. 첫 쪽은 ruvnet 저장소(별 7.8만~9.9만)가 독차지 — [mods4claude](https://mods4claude.com/mods) (접속 2026-10-26). → 별 순 정렬은 큰 저장소에 딸린 mod가 위로 올라와 쓸모가 낮음 [추론].
- [커뮤니티] whyashthakker/awesome-claude-code-mods: 직접 만든 70개(일반 50 + Desktop 20, 2.1.288에서 테스트) + 외부 14개 소개(2026-10-03 확인). Context Meter, Quota Watch, Cache Inspector, Tool Timing, Turn Timeline, Agent Board, Branch Board, Task Board, Focus Clock, Stopwatch 등 — [README](https://github.com/whyashthakker/awesome-claude-code-mods). 스크린샷은 테스트 키트 트리를 브라우저로 그린 것이라고 밝힘.
- [커뮤니티] 그 밖의 갤러리: [claudemod.com](https://www.claudemod.com/mods/statuspane)(범주 10개 중 Mods), [statuslin.es/mods](https://statuslin.es/mods)("reviewed mod gallery … installs pinned to reviewed commits", karanb192 README 설명), Anthropic 플러그인 디렉터리(claude.ai/directory, 제출 가능 — Addy Osmani 글). statuslin.es 본문은 직접 열어 보지 않음.
- [커뮤니티] 이름만 비슷한 저장소: [0xDarkMatter/claude-mods](https://github.com/0xDarkMatter/claude-mods)는 "3 agents. 112 skills. 13 styles. 15 hooks. 15 rules."를 묶은 플러그인으로, README 머리말 기준 함수 훅 mod 모음이 아니다(hooks 모듈 포함 여부는 확인 안 함). 반대로 [galElmalah/claude-mods](https://github.com/galElmalah/claude-mods)는 실제 mod 두 개(claude-mermaid, claude-queue)를 담은 마켓플레이스다. [karanb192/claude-code-mods](https://github.com/karanb192/claude-code-mods)도 실제 mod(cache-tax 등, mod-builder 스킬)다.

**상태·HUD·사용량 (F1과 같은 계열)** — 별은 저장소 별, catalogue 2026-10-22 기준
- [커뮤니티] **statuspane** (xuanji86/claude-statuspane, v1.3.4, 2.1.300에서 테스트, 별 14): 프롬프트 바로 위 카드. 모델·작업 중 여부·effort 게이지(`▮▮▮▯▯ high`), 컨텍스트 게이지 + `⟲ compact` 버튼(확인 후 `/compact`), 5시간·7일 게이지와 리셋까지 남은 시간(`↻2h41m`), 디렉터리·브랜치, 세션 비용, GitHub CI(기본 꺼짐), 스크립트·다른 mod가 채우는 진행 막대. 70칸 이상에서만 표시, Desktop에는 없음. 테마 색 사용, 60%부터 warning, 85%부터 error(컨텍스트는 50/80). 설정은 모든 세션 공통이며 "a change shows in the others within 2 seconds" — [README](https://github.com/xuanji86/claude-statuspane), [claudemod](https://www.claudemod.com/mods/statuspane) ("18 days ago" 등록, 접속 2026-10-26). → hubblerc F1: 기능 목록이 거의 같은 직접 경쟁작(5절 비교).
- [커뮤니티] **hud** (hoobnn/hoobnn-agent-mods): "[claude-hud] 0.10.0 rebuilt as a Claude Code mod"(claude-hud 0.10.0을 mod로 다시 만듦). 위치 `above`(band) / `below`(힌트 줄 옆, 원래 statusline 자리), 12개 테마, 컨텍스트·한도 toast, 소진 예측(5시간은 최근 1시간 속도), 모델별 주간 한도(Fable 등), 자동 압축까지 남은 토큰, 만료된 캐시 재기록량, 턴별 컨텍스트 증가 sparkline, 하루 예산, `/hud detail` pane, 긴 턴 끝 toast. 기존 claude-hud 설정 파일을 그대로 읽음 — [hud README.en](https://github.com/hoobnn/hoobnn-agent-mods/tree/main/claude-code/hud) (catalogue 별 7, "review UI rewrite" 표시). → hubblerc F1: "claude-hud 대체"라는 목표를 그대로 구현한 사례.
- [커뮤니티] **model-effort-band** (YeonwooSung/my-claude-code-mods, 저장소 별 1,126, 2.1.292에서 테스트, 한국어 README 있음): 선택된 모델과 "most recently observed main-conversation effort"(가장 최근 관찰한 메인 대화 effort)만 보이는 테두리 band. 60칸 미만이면 게이지·캡션·배지를 빼고, 30칸 미만이나 3줄 미만이면 테두리 없는 한 줄 — [README](https://github.com/YeonwooSung/my-claude-code-mods/tree/main/model-effort-band). → hubblerc F1·F3.
- [커뮤니티] **cc-vitals** (naicud): 프롬프트 위 테두리 대시보드(터미널·Desktop). 모델·effort, 컨텍스트, 자동 압축까지, 5H·주간 한도와 두 한도의 FORECAST, 비용·burn rate, 에이전트·백그라운드 셸·실행 중 도구. 150칸 이상이면 두 단 — [README](https://github.com/naicud/cc-vitals) (별 5).
- [커뮤니티] 사용량 band 다수: `usage-meter`·`cache-clock`·`where-am-i`·`agent-radar`(hamzafer/claude-code-mods, 별 338), `sub-meter`·`think-hard`(midudev/after-for-claude-code, 별 178), `usage-quota`(별 24), `usage-band`(JetsonChan, 별 15), `lemo-meter`(lemomo-ai, 별 36, 입력창 위 컨텍스트·5시간·비용·git 브랜치), KOZMOS 묶음(ersinkoc/claude-mods, 별 13: `bridge` 사이드바, `marquee` 상태줄, `hourglass` 한도 예측, `compass` 프롬프트 아래 힌트, `stamp` 턴 영수증), `limit-watch`·`session-watch`·`bg-tasks`·`sidebar`(KilimcininKorOglu/claude-code-mods, 별 11), `ccbar`(별 4), `session-band`(별 1), `taxi-meter`(devbrother2024, 별 9, 한국어 설명 "프롬프트 위 택시 미터기 패널") — [catalogue](https://github.com/karanb192/awesome-claude-code-mods/blob/main/catalogue.md). → hubblerc F1: 같은 자리를 노리는 mod가 많아 한 band를 나눠 쓰는 문제(4절)가 현실적.
- [커뮤니티] **cctop** (tomstagl): htop/btop식 대시보드. 함수 훅이 켜진 빌드에서는 Claude Code 안 pane, 아니면 tmux/WezTerm 등 터미널 분할로 자동 대체. 컨텍스트 구성, 캐시, 비용·burn rate, 한도와 "Projected exhaustion: Least-squares slope of used_percentage samples over the last 30 min, extrapolated to 100%"(최근 30분 사용률 표본의 최소제곱 기울기로 100% 도달 시점 외삽), 도구별 지연, 규칙 36개짜리 조언 — [README](https://github.com/tomstagl/cctop). 데이터는 대화 기록 jsonl·세션 파일·statusLine JSON에서 읽음(별도 바이너리).
- [커뮤니티] **Flightdeck** (scasella): 서브에이전트 카드/스윔레인, 권한 판정, 컨텍스트·비용, 턴 영수증. 옆 dock 레이아웃과 프롬프트 위 inline mini 레이아웃 두 벌 — [README](https://github.com/scasella/claude-flightdeck).

**사이드바·레이아웃 (F2)**
- [커뮤니티] **prompt-rail** (oikon48, 별 40): 프롬프트 목록을 가로(프롬프트 위 막대, 기본) 또는 세로(옆 pane)로. 레이아웃은 `/config` "Rail mode" 행에 저장. `/prompt-rail-next`·`-prev`·`-toggle`처럼 인자 없는 커맨드를 따로 만들어 keybindings.json의 `command:`로 묶게 함("they run mid-turn too") — [README](https://github.com/oikon48/prompt-rail). → hubblerc F2(목차)·키 우회.
- [커뮤니티] **widgets** (oMaN-Rod/claude-code-widgets): 위젯 95개의 배치 담당 플러그인. `/widgets side|above|below|<columns>|width <widget> <n>`. `side`는 전체 화면에서만 옆에 붙고 아니면 아래로. 배치·켜진 위젯은 세션마다 복원 — [README](https://github.com/oMaN-Rod/claude-code-widgets). → hubblerc F2의 `layout: auto|sidebar|band`와 같은 발상.
- [커뮤니티] **sidebar** (KilimcininKorOglu): "Opens one shared pane beside the transcript and draws the sections, lines and buttons every other mod writes into it through `$.sidebar`"(다른 mod가 `$.sidebar`로 써 넣는 공용 옆 pane), limit-watch·session-watch·bg-tasks·effort-auto가 사이드바가 열려 있으면 거기에, 아니면 status line에 그림 — [README](https://github.com/KilimcininKorOglu/claude-code-mods). → hubblerc F2: 사이드바/밴드 두 벌 그리기와 같은 구조를 mod 사이 계약으로 푼 사례.
- [커뮤니티] **git-sidebar** (aitmpl ui, 다운로드 57): lazygit식 worktree·브랜치 pane. 전체 화면이면 바닥부터 천장까지 옆에 붙고(110칸 이상), 아니면 프롬프트 위. `columns`(28~120, 기본 44), `openOnStart`. "A pane opened on its own at session start stays hidden below 144 columns until you run `/git-sidebar`." — [README](https://github.com/davila7/claude-code-templates/tree/main/cli-tool/components/mods/ui/git-sidebar).
- [커뮤니티] **mission-control** (dphase): 컨텍스트·git·만진 파일·할 일·서브에이전트·대화 요약 사이드바, "opens on its own once the terminal is wide enough", `/mc`로 토글 — [README](https://github.com/dphase/claude-mission-control). → hubblerc F2와 거의 같은 구성.
- [커뮤니티] paneline(markneonin, Activity·Files·Agents·Context·MCP·Skills·Spend 탭), session-radar, pinboard, worklist(할 일 사이드바), session-switcher — [catalogue](https://github.com/karanb192/awesome-claude-code-mods/blob/main/catalogue.md).

**effort 제어 (F3)**
- [커뮤니티] **effort-cycle** (Anerco, 2.1.291에서 테스트): Ctrl+↑/↓(또는 Option+↑/↓)로 보고 있는 에이전트(메인 또는 열어 둔 서브에이전트)의 effort를 한 단계씩. 푸터(`SessionMode` 자리)에 `Opus 5.5 ▰▰▰▱▱ high` 미터 — [README](https://github.com/Anerco/claude-code-effort-cycle), [how-it-works](https://github.com/Anerco/claude-code-effort-cycle/blob/main/docs/how-it-works.md). → hubblerc F3 수동 슬라이더의 직접 비교 대상.
- [커뮤니티] **effort-auto** (KilimcininKorOglu): 프롬프트마다 haiku가 low~max 한 단어로 판정, 그 턴과 그 턴이 띄운 서브에이전트에 적용, 세션 설정은 안 씀, 허용 단계 제한 가능 — [README](https://github.com/KilimcininKorOglu/claude-code-mods/tree/main/plugins/effort-auto). → hubblerc F3 자동 모드와 같은 설계.
- [커뮤니티] **jev-model-router** (aitmpl productivity, 다운로드 1,779): TypeSafe Jev(외부 결정 모델) 또는 키가 없으면 엔진 `$.model.classify`로 판정, `prompt.submit`에서 분류하고 `turn.step`에서 그 턴 첫 요청에 적용, 나머지 요청에 재사용. 메인 모델 변경은 기본 꺼짐(캐시 무효화) — [README](https://github.com/davila7/claude-code-templates/tree/main/cli-tool/components/mods/productivity/jev-model-router).
- [커뮤니티] think-hard(midudev: "Start a prompt with + and that turn thinks at max effort"), effortless(HeyCubit, 별 257, 2.1.308 validate 실패), brewmod-plan-effort(plan 모드에서 xhigh), jev-router·jev-pilot·crew-chief, subagent-tuner(Kruhlikau, 서브에이전트 모델·effort, 144칸 이상이면 pane·좁으면 대화상자 연쇄) — [catalogue](https://github.com/karanb192/awesome-claude-code-mods/blob/main/catalogue.md), [subagent-tuner](https://github.com/Kruhlikau/subagent-tuner).

**도구 행 다시 그리기 (F4)**
- [커뮤니티] shellcast("Tidy one-line shell command rows with live output, progress, timing and exit status"), quiet-bash(한 줄 도구 행, 출력 숨김), simple-mode·clean-view·glanceflow·plain-view(도구 행을 숨기고 쉬운 말 체크리스트), env-badge(Bash 행 아래 대상 환경 배지: AWS 프로필·kube context), toolmarks(KOZMOS, 도구 계열 글리프와 시간), time-badge·path-shorten(baselane-sh), skins(hellosverre, 별 188), tool-timing-badge(aitmpl, `ToolUse`를 감싸 색 있는 소요시간 배지) — [catalogue](https://github.com/karanb192/awesome-claude-code-mods/blob/main/catalogue.md), [tool-timing-badge](https://github.com/davila7/claude-code-templates/tree/main/cli-tool/components/mods/ui/tool-timing-badge).

**활동 기록·목차 (F5)**
- [공식] replay-theater(위 1절).
- [커뮤니티] receipt(hoobnn: "What each turn did, in a band above the prompt once it ends (files changed with lines, commands and failures…"), changes-receipt(셸로 바꾼 파일 포함 턴별 영수증), KOZMOS stamp("The closing 'Baked for 42s' line becomes a compact row of dur…" = `TurnDuration` 줄을 영수증으로 교체), epilogue, chronicle, turn-timeline(whyashthakker·arasovic), flight-recorder(Gantt), landmarks-widget("A numbered table of contents for the session"), session-toc, jump-list, prompt-jump, prompt-marks(Option+Up으로 프롬프트 사이 이동), time-machine(YeonwooSung, shadow-git 스냅샷), time-blame(턴 시간을 Claude·도구·사람으로 나눔) — [catalogue](https://github.com/karanb192/awesome-claude-code-mods/blob/main/catalogue.md). chat-toc(lkangd, 144칸부터 스스로 붙고 `/chat-toc`로는 110칸) — [issue #91870 댓글 2026-10-21](https://github.com/anthropics/claude-code/issues/91870).

**기타 터미널 사용성**
- [커뮤니티] prompt-cache-control(aitmpl 1위, 다운로드 2,951): band에 캐시 읽기/쓰기/새 토큰과 만료 카운트다운, 할 일 제안(keep going / compact / clear), 유휴 자동 압축 카운트다운, `/cache` pane, 1초 타이머지만 텍스트가 바뀔 때만 다시 그림 — [README](https://github.com/davila7/claude-code-templates/tree/main/cli-tool/components/mods/observability/prompt-cache-control).
- [커뮤니티] notify(mishgoldenberg: 긴 턴 끝·서브에이전트·백그라운드 작업 끝·승인 15초 대기 시 OS 알림), usage-meter(같은 저장소: "burn rate and 'full in ~2.3h'") — [README](https://github.com/mishgoldenberg/claude-mods).
- [커뮤니티] claude-queue(galElmalah: `/q`로 후속 프롬프트를 쌓고 턴 끝에 자동 제출, Esc로 끊어도 큐가 비워질 수 있다고 경고) — [whyashthakker 소개](https://github.com/whyashthakker/awesome-claude-code-mods).
- [커뮤니티] **claude-hangul** (proagent-ai, 별 3): "Claude Code mod 하나로 만든 한글 입력기. OS IME 없이, 한/영 전환 없이." `prompt.edit`에서 키를 받아 두벌식·세벌식 390·최종을 직접 조합하고, `prompt.submit`에서 조합 중 음절 확정, `$.ui.status`에 `한 두벌식` 표시. 작성자는 Orca 모바일 원격에서 사용 — [README](https://github.com/proagent-ai/claude-hangul) (접속 2026-10-26). → hubblerc: 한글 입력기 조합 지연 문제의 다른 해법(5절).

### Inferences
- [추론] 터미널 생산성 mod는 대부분 (1) 사용량·컨텍스트 band, (2) 옆 대시보드 pane, (3) 턴 영수증, (4) 도구 행 정리 넷 중 하나다. hubblerc는 (1)~(4)를 한 플러그인에 다 넣은 "통합형"이다. KOZMOS·hamzafer·KilimcininKorOglu 같은 묶음은 작은 mod를 여럿 두고 공용 사이드바나 band 순서로 엮는다.
- [추론] Bash 행에 `input.description`(용도)을 앞세우는 mod는 카탈로그 설명 검색으로는 찾지 못했다. F4는 상대적으로 드문 아이디어다(설명문에 안 적힌 mod는 있을 수 있음).

### Gaps
- 카탈로그별 "인기" 지표가 다르다(aitmpl은 자체 CLI 다운로드, karanb192·mods4claude는 저장소 별). mod 단위 설치 수는 어느 곳에서도 찾지 못했다.
- 각 mod의 게시일은 대부분 확인하지 못했다(README에 테스트 버전만 있음). 6,000여 개를 다 볼 수는 없어 키워드 필터(상태줄·한도·effort·사이드바·도구 행·타임라인·키)로 좁혔다.
- statuslin.es, claudemod.com의 전체 목록은 열어 보지 않았다.

## 4. 만든 사람들이 기록한 구현 요령과 함정

### Takeaway
반복해서 나오는 요령은 다섯 가지다. (1) 키는 엔진 동작을 빌리거나(`Button.action`) `command:` 키 설정으로 우회한다. (2) 폭은 터미널이 아니라 `bodyColumns` 기준으로 단계별로 덜어낸다. (3) 값이 바뀔 때만 다시 그린다. (4) 상태는 리로드와 `/clear`·`/resume`을 따로 다룬다. (5) 버전마다 타입을 새로 받는다. 함정으로는 band 공유, diff 패널과의 키·자리 충돌, macOS 시스템 단축키, 원격 차단, 보안(샌드박스 없음)이 자주 기록돼 있다.

### Cited Findings

**키 바인딩 우회**
- [커뮤니티] effort-cycle: "A mod cannot own a key, and a plugin brings no keybindings. A mod can only borrow one of Claude Code's own keybinding actions, through a button. So two hidden buttons in the band above the prompt take the diff panel's file-list actions"(mod는 키를 가질 수 없고 엔진 키 동작을 버튼으로 빌릴 뿐이다. 그래서 band에 숨은 버튼 둘을 두고 diff 패널의 파일 목록 동작을 가져온다). `app:diffFileListUp/Down`은 기본으로 Ctrl+↑/↓, Alt+↑/↓에 묶여 있어 "the keys step with no setup"(설정 없이 바로 동작). 단 diff 패널이 파일 8개 넘게 보여 스크롤할 때는 패널이 가져감 — [how-it-works](https://github.com/Anerco/claude-code-effort-cycle/blob/main/docs/how-it-works.md) (2.1.291). → hubblerc F1: hubblerc의 `app:cycleDiffBase` + keybindings.json 등록과 같은 기법. 차이는 **기본으로 묶여 있는 동작을 고르면 기기마다 keybindings.json을 고칠 필요가 없다**는 점.
- [커뮤니티] macOS 함정: Ctrl+↑/↓는 Mission Control 단축키라 시스템이 먹는다. Option을 Meta로 보내도록 터미널을 설정하면 Alt+↑/↓로 들어온다(Terminal.app "Use Option as Meta key", iTerm2 Left Option = Esc+, Ghostty `macos-option-as-alt = true`) — [effort-cycle README](https://github.com/Anerco/claude-code-effort-cycle). → hubblerc: Option+E가 악센트 입력으로 먹힌 hubblerc 경험과 같은 원인. Orca의 Option-as-Meta 설정 여부를 확인할 가치 [추론].
- [커뮤니티] `command:<name>` 경로: prompt-rail은 인자 없는 커맨드를 별도로 등록해 키 설정에 묶게 하고, 턴 중에도 실행된다고 적음 — [prompt-rail](https://github.com/oikon48/prompt-rail). statuspane은 band 접기(`abovePrompt:toggle`)를 `ctrl+s` 한 키로 묶으라고 권하며 원래 `ctrl+s`(stash)는 `ctrl+q`로 옮기는 예시를 줌 — [statuspane](https://github.com/xuanji86/claude-statuspane). → hubblerc: hubblerc는 단일 `ctrl+q`/`ctrl+t`가 반응하지 않았다고 기록했는데, statuspane은 단일 ctrl 키를 엔진 동작에 묶는 예시를 든다. 차이는 버튼 `action`(mod 경유)인지 엔진 동작 직결인지일 수 있다 [추론, 미검증].
- [커뮤니티] 여러 mod 묶음의 hotkey 활용: prompt-deck(빈 프롬프트에서 숫자 키로 저장된 프롬프트 즉시 전송), blast-radius(band에서 `1`/`2`), cctop(셀마다 숫자 hotkey) — [KilimcininKorOglu](https://github.com/KilimcininKorOglu/claude-code-mods), [blast-radius](https://github.com/anthropics/claude-code-playground/tree/main/claude-code/mods/blast-radius), [cctop](https://github.com/tomstagl/cctop).
- [커뮤니티] replay-theater 경험: "A pane only takes the keyboard while nothing else holds it. When the band's Replay button is pressed, the band holds the keys, so the mod hides the band and waits briefly before it opens the pane."(다른 게 키보드를 쥐고 있으면 pane이 포커스를 못 받는다. band 버튼을 누르면 band가 키를 쥐고 있으므로 band를 숨기고 잠깐 기다린 뒤 pane을 연다) — [replay-theater README](https://github.com/anthropics/claude-code-playground/tree/main/claude-code/mods/replay-theater) [공식 저장소의 샘플이지만 내용은 빌드 경험담]. → hubblerc F2: 밴드 버튼으로 사이드바를 열 때 같은 문제가 생길 수 있음.

**좁은 터미널·레이아웃**
- [공식/블로그] Addy Osmani: `e.props.bodyColumns` "is the band's real width, which is narrower than the terminal while a pane is docked beside the transcript. Size the tree to it."(pane이 옆에 붙으면 band 폭은 터미널보다 좁다. 그 값에 맞춰라.) token-weather는 60칸 미만에서 sparkline을 숨김. "Use single-width symbols, not emoji." — [Getting Started](https://claude.dev/blog/getting-started-with-claude-code-mods/) (2026-10-01). → hubblerc F1: 사이드바가 붙으면 `bodyColumns`가 줄어 밴드가 다시 그려진다는 hubblerc 추정과 일치.
- [커뮤니티] 단계별 덜어내기 기준: model-effort-band 60칸/30칸, statuspane 70칸 미만 숨김, cc-vitals 150칸 이상 두 단·메인 화면에서는 행의 절반 이하·band 최대 40행, Flightdeck 옆/inline 두 레이아웃 — 각 README([meb](https://github.com/YeonwooSung/my-claude-code-mods/tree/main/model-effort-band), [statuspane](https://github.com/xuanji86/claude-statuspane), [cc-vitals](https://github.com/naicud/cc-vitals), [Flightdeck](https://github.com/scasella/claude-flightdeck)).
- [공식 샘플] blast-radius: "In a narrow terminal Claude Code doesn't place it, so the mod checks `isPlaced` and draws the report in the `AbovePrompt` band instead." 120칸 터미널에서는 band로 그려졌다 — [blast-radius README](https://github.com/anthropics/claude-code-playground/tree/main/claude-code/mods/blast-radius). → hubblerc F2: auto 대체 경로와 같은 패턴.
- [커뮤니티] prompt-rail: "The dock width is shared by all plugin panes; drag its edge to narrow it, down to 24 columns."(dock 폭은 모든 플러그인 pane이 공유) — [prompt-rail](https://github.com/oikon48/prompt-rail).
- [커뮤니티, 오래된 정보] cctop가 2.1.270 바이너리를 뜯어 본 기록: "the `/diff` panel and a plugin pane share the same dock and are mutually exclusive — while the diff panel is open, an open plugin pane is not drawn at all"(diff 패널과 플러그인 pane은 같은 자리를 쓰고 동시에 못 뜬다), diff 자동 열림도 144칸/110칸 규칙 — [cctop docs/claude-code-panels.md](https://github.com/tomstagl/cctop/blob/main/docs/claude-code-panels.md) (2.1.270, 2026-09-12 빌드). 현재 공식 문서는 diff가 내장 mod로 바뀌었고 pane이 여러 개면 탭이 생긴다고 해서, 2.1.308에서 그대로인지는 불확실. → hubblerc F2: 사이드바와 diff 패널이 동시에 열릴 때 동작을 실제로 확인할 항목.
- [커뮤니티] #91870 댓글(cstillm, 2026-10-21): 푸터가 "about 28 characters"에서 잘리고, 푸터에서는 hover가 안 되며, band는 "always draws as a full-width bar" — [issue #91870](https://github.com/anthropics/claude-code/issues/91870). → hubblerc: `SessionMode` 푸터에 긴 값을 넣기 어렵다는 근거.

**band 공유**
- [공식 샘플] token-weather·replay-theater·blast-radius 모두 "The band above the prompt is shared. If another mod also draws there, only one of them shows." blast-radius는 다른 mod가 band를 가져가면 진행/취소 버튼이 안 보여 10분 뒤 거부된다고 경고 — 각 README. → hubblerc F1: 다른 band mod와 같이 쓰려면 `next(e)` 결과를 품어야 함.
- [커뮤니티] model-effort-band: "Other mods' `AbovePrompt` content is preserved before this band"; "A survey takes precedence and hides the band"(`hasSurvey`) — [README](https://github.com/YeonwooSung/my-claude-code-mods/tree/main/model-effort-band). hamzafer는 여러 band의 순서를 정하는 화면을 두고 `<config dir>/claude-code-mods/bands.json`에 저장(재시작 후 적용) — [hamzafer](https://github.com/hamzafer/claude-code-mods).

**성능·다시 그리기 빈도**
- [커뮤니티] prompt-cache-control: `$.clock.every(1000)`로 카운트다운을 그리되 "only while its text changes, so an idle expired session costs nothing"(텍스트가 바뀔 때만) — [README](https://github.com/davila7/claude-code-templates/tree/main/cli-tool/components/mods/observability/prompt-cache-control). → hubblerc F1: 리셋까지 남은 시간(`↻1h30m`)을 분 단위로만 바꾸면 다시 그리기를 크게 줄일 수 있음 [추론].
- [커뮤니티] #91870 댓글(2026-10-18~21): 대화 재그룹에 "300 ms trailing gate, incremental regroup"(lkangd), 초안 읽기는 "after a 300 ms pause"(hashswingingslasher), 애니메이션은 "`$.ui.blit` at 12 fps"(olliewagner), "Rate limits reach mods only after the first reply"(cstillm) — [issue #91870](https://github.com/anthropics/claude-code/issues/91870). → hubblerc F1: 첫 응답 전에는 5h/7d 값이 비어 있는 게 정상.
- [커뮤니티] hud(hoobnn): 대화 기록 파일을 "once and incrementally (only appended lines, gated on its size)" 읽음. prompt-rail도 "The transcript is read again only when its size or time changed" — [hud](https://github.com/hoobnn/hoobnn-agent-mods/tree/main/claude-code/hud), [prompt-rail](https://github.com/oikon48/prompt-rail). → hubblerc F5: resume 복원을 `$.session.messages()` 대신 jsonl 증분 읽기로 하면 4,096개 한도와 시간 정보 문제(jsonl에는 timestamp가 있음)를 피할 수 있음 [추론: hubblerc는 "대화 기록에는 시간이 없다"고 적었는데 그건 `$.session.messages()` 기준].
- [커뮤니티, early access 시절] claudefa.st: 함수 훅 체인은 직렬이라 300ms 훅 8개가 2,427ms(설정 훅 병렬 640ms) — [claudefa.st](https://claudefa.st/blog/tools/hooks/function-hooks) (날짜 표기 없음, 2.1.260 시절 내용, "not a shipped feature"라고 적은 낡은 글). → hubblerc F3: `prompt.submit`에서 분류를 기다리면 그 시간만큼 턴 시작이 늦어짐.

**상태 유지**
- [공식/블로그] Addy Osmani: "A module-level `let readings = []` looks like the obvious choice, but a hot reload is a fresh load … Put the history in `$.state` instead."(모듈 변수는 핫 리로드 때 초기화되니 `$.state`에) — [Getting Started](https://claude.dev/blog/getting-started-with-claude-code-mods/).
- [커뮤니티] widgets: "Plugin storage (`$.store`) is read once per session, so a widget that has to see other live sessions keeps a file under its own folder instead (`$.plugin.root`)."(store는 세션당 한 번 읽히므로 다른 세션을 봐야 하면 자기 폴더에 파일을 둔다) — [widgets](https://github.com/oMaN-Rod/claude-code-widgets). 반면 statuspane은 설정 변경이 다른 세션에 2초 안에 반영된다고 적음(방식 미확인). 공식 문서는 store가 모든 세션에 공유된다고만 하고 캐시 주기는 말하지 않음. → hubblerc: 기기 공통 값(오늘 누적 비용)을 store로 할 때 다른 세션 반영이 늦을 수 있음. 출처 간 차이.
- [커뮤니티] statuspane Progress API: 스크립트가 `~/.claude/statuspane/progress/<id>.json`에 쓰면 카드에 진행 막대, "Write to a temporary file and rename it over the target so the card never reads half a file"(임시 파일에 쓰고 rename), 최근 20개 파일만, 64KB 이하, 제어·bidi 문자 제거. 다른 mod는 `plugin.json`의 `dependencies`로 `$.statuspane`을 받아 호출(메모리라 리로드 뒤 다시 보고) — [statuspane](https://github.com/xuanji86/claude-statuspane). → hubblerc 후보 "백그라운드 작업 진행"에 쓸 수 있는 설계.
- [커뮤니티] effort-cycle: "A pick is lost on restart. A plugin cannot write settings, so it cannot save the level the way `/effort` and Alt+P do." / "It never runs `/effort`, which would print rows into the transcript." — [README](https://github.com/Anerco/claude-code-effort-cycle). → hubblerc F3: `turn.step` 교체 방식을 택한 이유와 같다.

**테스트**
- [커뮤니티] widgets: `docs/engine.js`라는 작은 엔진 대역으로 모든 위젯을 브라우저에서 돌리는 데모·smoke 테스트 — [widgets](https://github.com/oMaN-Rod/claude-code-widgets). subagent-tuner: `claude plugin test` + 가짜 `$`(`hooks/harness.ts`) 단위 테스트 — [subagent-tuner](https://github.com/Kruhlikau/subagent-tuner). KilimcininKorOglu: `make check` = eslint(복잡도 10)·tsc·validate·test — [README](https://github.com/KilimcininKorOglu/claude-code-mods). castus: "`claude plugin test` and `$.session.version()` made this easy to build and to ship with CI" — [issue #91870](https://github.com/anthropics/claude-code/issues/91870) (2026-10-25).
- [커뮤니티] YeonwooSung: 테스트 키트 결과와 "live pixels unverified"를 구분해 표기, `CLAUDE_BIN=/path/to/claude-2.1.292 npm run test:adapters`로 특정 버전 바이너리를 지정해 검사 — [my-claude-code-mods](https://github.com/YeonwooSung/my-claude-code-mods). → hubblerc: 테스트 키트가 `ui.scroll`·`ui.close`를 흉내 못 내는 한계를 hubblerc도 기록. 화면 확인은 실제 세션 필요.

**버전 변경 대응**
- [공식/블로그] "The API can change between releases." Claude Code가 로드할 때 `.claude-plugin/types/`에 타입을 쓰고 "those are the authority for your version" — [Getting Started](https://claude.dev/blog/getting-started-with-claude-code-mods/). 공식 reference도 GitHub d.ts가 오래될 수 있으니 로컬 사본을 믿으라고 함 — [reference](https://code.claude.com/docs/en/plugins/mods/reference).
- [커뮤니티] subagent-tuner(aitmpl 사본): 2.1.283 d.ts에 Agent 입력 `effort`가 없어 모든 모듈에 `// @ts-nocheck` — [subagent-tuner README](https://github.com/Kruhlikau/subagent-tuner). prompt-rail: "Bump the version … since installed copies update only when it changes."(버전을 올려야 설치본이 갱신) — [prompt-rail](https://github.com/oikon48/prompt-rail). → hubblerc: 세 기기 배포 때 `plugin.json` 버전 올리기 필수.
- [커뮤니티] hud: "the engine follows `$` only within this file"(엔진은 `$` 사용을 그 파일 안에서만 추적) — 그래서 `$`를 부르는 코드는 `register.tsx`에 모으고 다른 모듈은 클로저를 받음 — [hud](https://github.com/hoobnn/hoobnn-agent-mods/tree/main/claude-code/hud). 2.1.299에서 "a hook hands `$` to a function declaration imported from another file" 거부 문제가 고쳐짐 — [CHANGELOG](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md). → hubblerc 개발 메모의 "atom은 그 파일 안의 const로" 규칙과 같은 계열.
- [커뮤니티] castus: "A hooks module can import only its own files and `claude-code`." / widgets: "Plugins cannot import from one another, so `widgets` shares … as `$.widgets`" — [issue #91870](https://github.com/anthropics/claude-code/issues/91870), [widgets](https://github.com/oMaN-Rod/claude-code-widgets). 공식 방식은 `engine.create`로 namespace를 추가하는 "noun contract" — [built-in mods README](https://github.com/anthropics/claude-code/tree/main/mods).

**보안**
- [공식] mod는 샌드박스가 없고, 파일·비밀·모든 프롬프트와 도구 호출을 보고, 도구 호출을 승인하고, 사용량을 쓸 수 있다. 관리 설정이나 Team/Enterprise 로그인이면 사용자 mod의 승인이 `ask` 규칙을 못 넘는다. 권한 프롬프트는 바꿀 수 없다 — [overview#decide-whether-to-trust-a-mod](https://code.claude.com/docs/en/plugins/mods/overview).
- [커뮤니티] SSD Nodes(Matt Connor, 2026-10-14): pluto.security가 2.1.274에서 mod로 `~/.claude/.credentials.json`을 읽어 외부로 보낸 시연을 인용, 엔진 프롬프트처럼 보이는 가짜 입력으로 키를 받을 수 있다고 경고, 검토한 커밋 고정 권장 — [ssdnodes](https://www.ssdnodes.com/learn/claude-code-mods-explained). AIREITER(2026-10-02 갱신): 서드파티 mod는 "installable software code"로 다뤄라 — [aireiter](https://aireiter.com/it/blog/claude-code-mods-security-installation-guide).
- [커뮤니티] aitmpl는 mod마다 skillspector 스캔 등급을, karanb192는 validate 결과로 L0~L3 접근 배지를 붙인다(실행 안전 보증은 아니라고 명시) — [aitmpl API](https://www.aitmpl.com/api/v1/catalog/mods.json), [karanb192](https://github.com/karanb192/awesome-claude-code-mods). → hubblerc: 자기 mod라 위험은 낮지만, 회사 스튜디오에서 `allowManagedModsOnly`·`sec-default` 정책에 막힐 수 있음(spec의 확인할 것과 연결).

**effort와 캐시·표시 (hubblerc "확인할 것" 직접 관련)**
- [공식] "On most models, each effort level has its own cache … On Opus 5.5, Sonnet 5.5, Haiku 5.5, and Fable 5.1 with an API key or a Claude subscription, the cache stays intact by default."(대부분 모델은 effort마다 캐시가 따로지만, Opus 5.5·Sonnet 5.5·Haiku 5.5·Fable 5.1은 API 키나 구독이면 캐시가 유지된다.) Bedrock·Agent Platform·Claude apps gateway, `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS`면 해당 없음. Fable 5.1은 v2.1.260 이전엔 무효화됨 — [prompt-caching#changing-effort-level](https://code.claude.com/docs/en/prompt-caching) (접속 2026-10-26). → hubblerc F3: 사용자 설정(opus xhigh, fable high)은 둘 다 캐시 유지 모델이라 자동 effort의 캐시 손해는 공식상 없음.
- [커뮤니티] effort-auto 측정: Opus 5.5 high→low, low→max에서 "cache read 58,408 each time", Sonnet 5는 "cache read 0, the whole conversation of about 73,700 tokens written again"(2.1.283), Sonnet 5.5도 유지(2.1.284). 그래서 캐시가 유지되는 모델에서만 effort를 바꿈. haiku 판정은 약 0.6초(2.1.284). 메인 요청만 바꾸면 서브에이전트 요청은 세션 effort 그대로였음 — [effort-auto](https://github.com/KilimcininKorOglu/claude-code-mods/tree/main/plugins/effort-auto). → hubblerc F3: 공식 문서와 일치. 지연은 약 0.6초. hubblerc는 서브에이전트를 일부러 안 건드리는데, effort-auto는 반대로 서브에이전트까지 맞춤.
- [커뮤니티] prompt-cache-control은 "A change in the prefix (model, effort or thinking settings …) makes the next request write instead of read"라고 적음 — 위 공식 문서와 모델별로 어긋나는 일반화(공식 우선) — [README](https://github.com/davila7/claude-code-templates/tree/main/cli-tool/components/mods/observability/prompt-cache-control).
- [커뮤니티] jev-model-router: "the model and effort it rewrites are parameters of each request, not the session's settings, so the status line, the header and the effort box never move whatever it decides"(바꾼 값은 요청 단위라 상태줄·헤더·effort 표시가 움직이지 않는다) — 그래서 transcript 로그와 한 줄 status를 따로 둠. effort-cycle도 "The spinner can show a different level from the footer"(issue #1) — [jev-model-router](https://github.com/davila7/claude-code-templates/tree/main/cli-tool/components/mods/productivity/jev-model-router), [effort-cycle](https://github.com/Anerco/claude-code-effort-cycle). → hubblerc F3 "turn.step에서 바꾼 effort가 Spinner나 상태 표시에 반영되는가": 커뮤니티 두 곳 모두 "반영 안 됨". hubblerc 밴드가 직접 보여 줘야 함.
- [커뮤니티] model-effort-band: "The observed request is the value at this mod's hook position. A later mod can still rewrite the request"(관찰값은 내 훅 위치 기준이고 뒤 mod가 또 바꿀 수 있다) — [README](https://github.com/YeonwooSung/my-claude-code-mods/tree/main/model-effort-band).

### Inferences
- [추론] hubblerc의 "기기마다 keybindings.json 등록" 부담은 effort-cycle처럼 **기본으로 묶여 있고 프롬프트에서 아무 일도 안 하는 엔진 동작**을 고르면 줄일 수 있다. 다만 그런 동작은 대개 화살표류라 macOS 시스템 단축키와 겹치는지 따져야 한다.
- [추론] 사용량 표시는 첫 응답 전엔 비고(rateLimits), 턴 단위로만 갱신되는 값이 많다. 시계성 값(리셋까지 남은 시간, 캐시 만료)만 타이머로 다시 그리고, 그것도 표시 문자열이 바뀔 때만 invalidate하는 게 공통 요령이다.

### Gaps
- Esc를 감지하는 우회책을 기록한 mod는 찾지 못했다. `closeOnEscape` pane의 `ui.close`(origin `person`) 말고는 방법이 보이지 않는다.
- 한글 입력기 조합 중 키 지연(hubblerc의 `ctrl+x e` 한 박자 지연)을 다룬 글은 claude-hangul(입력기를 아예 mod로 대체) 외에 찾지 못했다.
- `$.store`가 "세션당 한 번 읽힌다"는 widgets 주장을 공식 문서로 확인하지 못했다.

## 5. hubblerc F1~F5와 같은 일을 하는 mod, 차이, hubblerc에 없는 아이디어

### Takeaway
F1(상태 밴드)·F2(사이드바/밴드 전환)·F3(effort)·F5(턴 기록·목차)는 모두 비슷한 공개 mod가 있다. 가장 가까운 것은 statuspane(F1), hud(F1, claude-hud 이식), effort-cycle·effort-auto(F3), mission-control·prompt-rail·widgets(F2), receipt·stamp·landmarks(F5)다. F4(Bash 용도 표시)와 정확히 같은 mod는 찾지 못했다. hubblerc만의 강점은 한 플러그인 안에서 수집을 한 곳에 모으고 그리기만 두 벌로 둔 점, 답변 번호와 연결된 변경 파일, Bash 용도 표시다. 빌려 올 만한 아이디어는 다음과 같다: 한도 소진 예측 알고리즘, 자동 압축까지 남은 토큰, 캐시 만료 카운트다운, 진행 API, OS 알림, `SessionMode` 푸터, `command:` 키 경로, `classic.SessionStart` 복원.

### Cited Findings

**F1 상태 밴드 vs 공개 mod**
- [커뮤니티] statuspane과의 차이:
  - 같은 점: 모델·effort, ctx 게이지, 5h/7d와 리셋 카운트다운, 디렉터리·브랜치, 60%/85% 색 단계.
  - statuspane에만 있는 것: compact 버튼, 비용 기본 표시, GitHub CI, 외부 진행 막대 API, 설정 페이지(줄 선택·막대 폭 6~24), 숨김 버튼, 70칸 미만이면 아예 숨김, Claude Code 테마 색(theme key) 사용.
  - hubblerc에만 있는 것: 2줄(실행 중 도구·Bash 용도·서브에이전트·할 일), 3줄(직전 답변 요약), effort 슬라이더, 미커밋 표시, 폭 부족 시 항목별 덜어내기, 터미널 ANSI 색 이름 사용(Kanagawa를 따르려는 선택) — [statuspane](https://github.com/xuanji86/claude-statuspane), hubblerc spec.
  - → hubblerc F1: 테마 키를 쓰면 Claude Code 테마(dark/light/색맹)를, ANSI 이름을 쓰면 터미널 테마를 따른다. 2.1.299 dimColor 수정 이후 흐린 글자가 ANSI 테마에서 제대로 보이는지 재확인할 것.
- [커뮤니티] hud(hoobnn)와의 차이: hud는 claude-hud 코드를 그대로 품고 statusLine stdin을 mod 데이터로 재구성(`prompt_cache`, 모델별 주간 한도, `session_name` 등 mod API에 없는 값은 추정·파일에서 읽음). `position: above|below`, 하단은 원래 statusline 자리(힌트 줄 옆). 모델별 주간 한도(Fable 등)는 "neither the mod API nor the statusline carries them, so they come from Claude Code's own cache of its usage endpoint, `cachedUsageUtilization` in `.claude.json`" — [hud](https://github.com/hoobnn/hoobnn-agent-mods/tree/main/claude-code/hud). → hubblerc F1: 사용자가 fable을 쓰므로 모델별 주간 한도가 따로 있다면 `$.session.usage().rateLimits`만으로는 빠질 수 있다 [추론: 사용자 계정에 그런 한도가 있는지 미확인].
- [커뮤니티] 표시 위치 대안: effort-cycle은 effort를 푸터 `SessionMode` 자리에, hud·KOZMOS compass는 프롬프트 아래에, statuspane·hud는 compact 버튼을 둠 — 각 README. → 새 아이디어: band 3줄을 지키면서 effort 값만 푸터로 옮기는 선택지(단 푸터는 약 28자에서 잘린다는 보고, 위 4절).

**F2 레이아웃 vs 공개 mod**
- [커뮤니티] 같은 문제를 이렇게 풀었다: prompt-rail(가로 band / 세로 pane, `/config` 행), widgets(side/above/below + 위젯별 폭), Flightdeck(dock 전체 / inline mini 두 레이아웃), git-sidebar(`columns`·`openOnStart`, 144칸 미만이면 숨김), mission-control(넓으면 스스로 열림), subagent-tuner(144칸 이상 pane, 좁으면 대화상자 연쇄), blast-radius(`isPlaced:false`면 band) — 각 README. → hubblerc F2: `layout: auto|sidebar|band` + `isPlaced`/`placement` 판정 + 사람이 닫으면 다시 안 열기는 공개 mod들보다 세밀한 편. 다른 mod들은 대부분 "넓으면 열기 / 아니면 다른 자리" 수준.
- [공식] 2.1.305 이후 옆 pane은 터미널 폭의 45%까지만 — [CHANGELOG](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md). → hubblerc: 110칸이면 사이드바 최대 49칸. 변경 파일 12개·목차 줄이 이 폭에 맞는지 확인.
- [커뮤니티] KilimcininKorOglu `sidebar`의 공용 사이드바(`$.sidebar`) 방식: 각 기능이 섹션을 써 넣고 사이드바가 없으면 status line으로 — [README](https://github.com/KilimcininKorOglu/claude-code-mods). → hubblerc: 지금은 한 플러그인이라 필요 없지만, 기능을 mod 여러 개로 쪼갤 때의 모델.

**F3 effort 제어 vs 공개 mod**
- [커뮤니티] 수동 조정:
  - effort-cycle: Ctrl/Option+↑↓, 설정 없이 동작, 보고 있는 에이전트별, 푸터 미터, `/config`로 단계 선택.
  - hubblerc: `ctrl+x ctrl+e` → 3줄 자리에 숫자 슬라이더, 10초 뒤 자동으로 닫힘, keybindings.json 등록이 필요.
  - think-hard: 프롬프트 앞에 `+`를 붙이면 그 턴만 max — 키가 전혀 필요 없는 방식.
  - 출처: [effort-cycle](https://github.com/Anerco/claude-code-effort-cycle), [catalogue](https://github.com/karanb192/awesome-claude-code-mods/blob/main/catalogue.md).
  - → 새 아이디어: `prompt.submit`에서 접두어(`!h `, `+` 등)로 그 턴 effort를 정하면 한글 입력 상태에서도 단축키 문제 없이 동작 [추론].
- [커뮤니티] 자동 선택:
  - effort-auto: haiku가 한 단어로 판정, 프롬프트에 단계 이름을 직접 쓰면 그 단계, 허용 단계 제한, 캐시가 유지되는 모델에서만 바꿈, 서브에이전트까지 적용, 사이드바에 "this turn high · session low" 표시, 8초 안에 답이 없으면 세션 값.
  - jev-model-router: `prompt.submit`에서 분류하고 `turn.step`에 적용. 올릴 때와 내릴 때 신뢰도 기준을 다르게 둠(올리기 0.3 / 내리기 0.6). 신뢰도가 없는 분류기는 올리기만 허용. 인자 없는 슬래시 커맨드는 분류하지 않음. 실패하면 엔진 값 그대로.
  - 출처: [effort-auto](https://github.com/KilimcininKorOglu/claude-code-mods/tree/main/plugins/effort-auto), [jev-model-router](https://github.com/davila7/claude-code-templates/tree/main/cli-tool/components/mods/productivity/jev-model-router).
  - → hubblerc F3 자동 모드: 라벨 초안(medium/high/xhigh)과 같은 구조. 빌려 올 규칙은 셋이다. "명시한 단계 우선", "내리기는 더 엄격하게", "분류 실패나 시간 초과면 그대로".
- [커뮤니티] effort-auto의 함정 기록: haiku에게 허용 단계만 알려 주면 판정이 비뚤어짐("told only `low` and `medium`, it answered `named max` … 3 of 3 times"), 사람이 "max"라는 말을 다른 뜻으로 써도 단계 지정으로 오인할 수 있어 프롬프트에 단어가 실제로 있을 때만 받아들임 — [effort-auto](https://github.com/KilimcininKorOglu/claude-code-mods/tree/main/plugins/effort-auto).

**F4 Bash 용도 표시 vs 공개 mod**
- [커뮤니티] 도구 행을 바꾸는 mod는 많지만(shellcast, quiet-bash, simple-mode·clean-view·glanceflow, env-badge, toolmarks, tool-timing-badge), 설명문 기준으로 Bash의 `description`을 명령 대신 앞세우는 것은 찾지 못함 — [catalogue](https://github.com/karanb192/awesome-claude-code-mods/blob/main/catalogue.md). simple-mode류는 "plain-English checklist"로 대신하는데 이건 모델 호출이나 자체 규칙으로 만든 문장일 가능성 [추론]. → hubblerc F4: 상대적으로 독창적. 추가 아이디어로 env-badge처럼 Bash 행 아래에 대상 환경(브랜치, kube context 등) 배지, tool-timing-badge처럼 소요 시간 배지(F5와 연결).

**F5 활동 기록·목차 vs 공개 mod**
- [커뮤니티] 턴 끝 요약 줄: KOZMOS stamp는 `TurnDuration`("Baked for 42s") 줄 자체를 영수증 행으로 바꿈, hoobnn receipt는 턴이 끝나면 band에 변경 파일·줄 수·명령·실패를 표시, changes-receipt는 셸로 바꾼 파일까지 — [catalogue](https://github.com/karanb192/awesome-claude-code-mods/blob/main/catalogue.md). → hubblerc F5: hubblerc도 `TurnDuration` 행과 짝지어 답변 끝 줄을 그림(같은 자리). Bash로 바꾼 파일을 어떻게 잡는지는 changes-receipt를 열어 볼 가치.
- [커뮤니티] 목차·이동: prompt-rail(지금 읽는 프롬프트 = 화면 맨 위 행, 스크롤 거부된 프롬프트는 점선 표시·건너뜀, `/rewind`로 버린 가지 제외, 대화 jsonl을 크기·시간이 바뀔 때만 다시 읽음, Desktop에서는 스크롤 불가), landmarks-widget, session-toc, chat-toc, jump-list, prompt-jump — [prompt-rail](https://github.com/oikon48/prompt-rail), [catalogue](https://github.com/karanb192/awesome-claude-code-mods/blob/main/catalogue.md). → hubblerc F2 목차: "아직 그려지지 않은 행이면 알림"과 같은 한계를 prompt-rail도 "A prompt Claude Code refused to scroll to"로 표시만 함. `/compact` 행으로는 이동 못 한다는 기록도 있음.
- [공식 샘플] replay-theater: 턴의 편집을 한 단계씩 diff로(12줄 제한), 거부·실패한 편집도 기록되는 한계 — [README](https://github.com/anthropics/claude-code-playground/tree/main/claude-code/mods/replay-theater). → hubblerc `/activity`에 "그 답변의 편집 다시 보기"를 붙이는 아이디어.

**hubblerc 후보 기능과 겹치는 공개 구현**
- [커뮤니티] 5시간 한도 소진 예측:
  - limit-watch: 5시간·spend 한도는 최근 구간(5시간은 1시간) 표본의 최소제곱 기울기, 10분 이상 쌓여야 표시. 7일은 표본 없이 "the percentage divided by the time since the cycle began, `resetsAt` minus 7 days"(주기 시작 이후 평균)로 계산하고 둘째 날부터 표시. 리셋보다 늦게 차면 "차지 않음", `resetsAt`이 5분 넘게 움직이면 새 주기. 표본은 `$.store`(한도당 최대 1,500개), 80%·95%에서 주기당 한 번 경고하고 다른 세션과 중복 방지.
  - 같은 계열: cctop(최근 30분, 표본 3개 이상), hud(최근 1시간, 10분 이상), mishgoldenberg usage-meter("full in ~2.3h").
  - 출처: [limit-watch](https://github.com/KilimcininKorOglu/claude-code-mods/tree/main/plugins/limit-watch), [cctop](https://github.com/tomstagl/cctop), [hud](https://github.com/hoobnn/hoobnn-agent-mods/tree/main/claude-code/hud), [mishgoldenberg](https://github.com/mishgoldenberg/claude-mods).
  - → hubblerc 후보: 알고리즘을 그대로 쓸 수 있음. 7일을 단기 기울기로 재면 과대 예측된다는 측정("4% after 2.4 busy hours read as `7d hits 100% in ~2d 8h`")도 있음.
- [커뮤니티] 자동 압축 직전 경고:
  - hud: "Tokens left before auto-compaction … The threshold is Claude Code's own (`$.session.usage({ breakdown: 'summary' })`)" — breakdown은 토큰 세기 요청을 만든다는 공식 설명(1절)과 함께 볼 것.
  - token-weather: 창 전체 대비 %와 엔진의 "context used" 알림(자동 압축 기준)이 81% vs 90%로 달랐음.
  - cctop: 엔진 푸터가 "Context low"로 바뀌는 구간(임계 − 20,000 토큰)을 기록.
  - 출처: [hud](https://github.com/hoobnn/hoobnn-agent-mods/tree/main/claude-code/hud), [token-weather](https://github.com/anthropics/claude-code-playground/tree/main/claude-code/mods/token-weather), [cctop](https://github.com/tomstagl/cctop).
  - → hubblerc 후보: ctx %가 창 전체 기준이면 경고 시점이 엔진보다 늦다. 임계값은 breakdown으로 가끔(창이 바뀔 때만) 읽어 두는 방식을 hud가 씀.
- [커뮤니티] 백그라운드 작업 진행: bg-tasks(백그라운드 셸과 가장 오래된 것의 나이, `/bg-tasks`에서 중지), agent-radar(서브에이전트·셸마다 한 줄, 최신 출력), cc-vitals 셸 섹션, statuspane 진행 API — [catalogue](https://github.com/karanb192/awesome-claude-code-mods/blob/main/catalogue.md), [cc-vitals](https://github.com/naicud/cc-vitals), [statuspane](https://github.com/xuanji86/claude-statuspane).
- [커뮤니티] 오늘 누적 비용: hud(claude-hud의 일일 비용 장부, 60일 store 보관, 하루 예산 대비 80% 노랑), cc-vitals(주간·월간 지출 보고) — [hud](https://github.com/hoobnn/hoobnn-agent-mods/tree/main/claude-code/hud), [cc-vitals](https://github.com/naicud/cc-vitals).
- [커뮤니티] MCP 연결 상태: KOZMOS switchboard("an MCP observatory sidebar. Every MCP server in the session with its tools, calls, errors…"), cctop의 "idle MCP servers" 조언 — [catalogue](https://github.com/karanb192/awesome-claude-code-mods/blob/main/catalogue.md), [cctop](https://github.com/tomstagl/cctop). 공식 이벤트 목록에 MCP 연결 끊김 이벤트는 없고 `$.mcp.connect`는 자기 플러그인의 서버만 연결 — [reference](https://code.claude.com/docs/en/plugins/mods/reference). → hubblerc 후보: 공식 API로 끊김을 직접 받는 길은 안 보임. 도구 호출 오류로 추정하는 정도 [추론].
- [커뮤니티] 기기 라벨: 직접 같은 mod는 못 찾음. ts-band(Tailscale 노드 상태 band)가 기기 간 상태를 보이는 유일한 근접 사례 — [hoobnn](https://github.com/hoobnn/hoobnn-agent-mods).

**hubblerc에 없는 좋은 아이디어 (출처별)**
- [커뮤니티] 캐시 만료 카운트다운과 "지금 /compact 할지" 제안, 유휴 자동 압축 카운트다운(prompt-cache-control, cache-clock, cache-tax는 쉬는 동안 캐시를 데워 둠) — [prompt-cache-control](https://github.com/davila7/claude-code-templates/tree/main/cli-tool/components/mods/observability/prompt-cache-control), [karanb192 Featured](https://github.com/karanb192/awesome-claude-code-mods). → F1 1줄 후보.
- [공식/커뮤니티] 긴 턴 끝 OS 알림: 공식 예제(`turn.complete` + `$.ui.notify`, bell이면 toast로 대체), notify(mishgoldenberg, 승인 15초 대기 알림), hud(`notifyAfterSeconds`) — [api](https://code.claude.com/docs/en/plugins/mods/api), [mishgoldenberg](https://github.com/mishgoldenberg/claude-mods). → 큰 모니터·작은 모니터를 오가며 다른 창을 볼 때 유용 [추론].
- [커뮤니티] 턴별 컨텍스트 증가 sparkline(token-weather, hud), "몇 턴 뒤 압축" 예측(forecast-widget) — [token-weather](https://github.com/anthropics/claude-code-playground/tree/main/claude-code/mods/token-weather), [catalogue](https://github.com/karanb192/awesome-claude-code-mods/blob/main/catalogue.md). → F1 3줄 또는 사이드바.
- [커뮤니티] 진행 API(파일 + `$.statuspane` noun) — [statuspane](https://github.com/xuanji86/claude-statuspane). → 사용자 스크립트(빌드·테스트)가 밴드 2줄에 진행률을 보내는 통로.
- [커뮤니티] 미커밋 경고 임계값(`gitDirtyWarn` 20개, `gitAheadWarn` 5개) — [hud](https://github.com/hoobnn/hoobnn-agent-mods/tree/main/claude-code/hud). → F1 `main*` 표시를 수치 경고로 확장.
- [공식] `classic.SessionStart{source:['clear','resume','fork']}`에서 `$.state` 다시 채우기 — [interface](https://code.claude.com/docs/en/plugins/mods/interface). → F5 복원을 같은 프로세스 안 `/resume`·`/branch`에도 적용.
- [공식] `session.measure`(턴 뒤 + 한도 % 변화 때) — [reference](https://code.claude.com/docs/en/plugins/mods/reference). → 한도 표시·예측 갱신 시점.
- [공식/커뮤니티] `command:<name>` 키 설정 + `immediate: true` mod 커맨드(prompt-rail 방식) — [keybindings](https://code.claude.com/docs/en/keybindings), [prompt-rail](https://github.com/oikon48/prompt-rail). → F1 effort 슬라이더 여닫기를 `app:cycleDiffBase` 대신 `/effort-slider` 같은 mod 커맨드에 묶으면 diff 패널과 충돌하지 않는다 [추론: 커맨드 실행이 대화에 줄을 남기지 않는지, 한글 상태에서 지연이 없는지는 확인 필요].
- [커뮤니티] claude-hangul(입력기를 mod로 대체): OS 입력기를 영어에 두므로 `ctrl+x e` 같은 조합이 OS IME에 붙잡히지 않음 — [claude-hangul](https://github.com/proagent-ai/claude-hangul). → hubblerc의 한글 조합 지연 문제를 피하는 근본 대안이지만 다른 mod의 `prompt.edit`와 충돌 가능, 한 키마다 50ms 한도 [추론].

### Inferences
- [추론] F1은 statuspane·hud와 정면으로 겹친다. 차별점은 (a) 2줄·3줄의 "지금 무엇을 하는가/직전에 무엇을 했나", (b) Bash 용도(F4)와의 연결, (c) 한글·Kanagawa 환경에 맞춘 색·키 선택이다. 공개하려면 이 셋을 앞세우는 게 맞다.
- [추론] F3 수동 조정은 "설정 없이 바로 되는 키"가 사용성의 핵심이다(effort-cycle). hubblerc는 한글 입력기와 macOS 키 제약 때문에 `ctrl+x ctrl+e`에 도달했다. `command:` 경로나 프롬프트 접두어를 보조로 두면 기기마다 keybindings.json을 고치는 부담이 준다.
- [추론] F3 자동 모드의 캐시 걱정은 공식 문서상 사용자 모델(Opus 5.5, Fable 5.1)에서 해소된다. 남은 비용은 분류 지연(haiku 약 0.6초, 커뮤니티 측정)과 판정 오류다.
- [추론] 큰 화면 사이드바는 2.1.305의 45% 상한과 dock 공유(다른 pane·diff 패널) 때문에 "내 것만 있는 넓은 사이드바"를 전제로 하면 안 된다.

### Gaps
- statuspane·hud·effort-cycle·effort-auto 등의 실제 코드는 README·설계 문서만 읽었고 소스는 열어 보지 않았다(aitmpl 사본 소스는 내려받았지만 상세 분석 안 함).
- F4와 정확히 같은 mod가 없다는 판단은 카탈로그 설명 검색 기준이다(설명에 "description"을 안 적은 mod는 놓쳤을 수 있음).
- 요청받은 블로그 중 wavect.io 글은 검색으로 찾지 못했다. ssdnodes(2026-10-14), aireiter(2026-10-02 갱신), claudefa.st(날짜 없음, early access 시절)는 확인했다.
- Reddit의 "31개 mod 검토" 언급(aireiter 일본어판)은 다른 조사자 영역이라 확인하지 않았다.
