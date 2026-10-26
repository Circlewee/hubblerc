# anthropics/claude-code 이슈 조사: 터미널 사용성 요청과 mod(function hooks) 요청·한계

조사일 2026-10-26. 대상 저장소 anthropics/claude-code. CHANGELOG는 2.1.310까지 확인(hubblerc 기준 빌드는 2.1.308).

조사 방법과 읽는 법:
- 👍는 GitHub 검색 API(`search/issues`, `sort=reactions`)가 돌려준 `reactions["+1"]` 값이다(2026-10-26 조회). 웹 페이지에는 "Reactions are currently unavailable"로 나오는 이슈가 많아, 숫자는 검색 API 값만 적었다.
- 상태: open / closed(completed·not_planned·duplicate). 날짜는 "열림 → 닫힘".
- 표시: [공식] = Anthropic 쪽 사람의 댓글(Collaborator 배지, 제안자 poteat) 또는 CHANGELOG / [커뮤니티] = 일반 사용자 이슈·댓글 / [추론] = 내 판단.
- 주의 1: 이 저장소는 stale 봇이 일정 기간 활동 없는 이슈를 "not_planned"로 자동 종료한다. 예: #87869는 github-actions가 "Closing for now — inactive for too long."(오래 활동이 없어 일단 닫습니다)로 닫았다 — [#87869](https://github.com/anthropics/claude-code/issues/87869). 그래서 "closed not_planned"는 거절이 아니라 방치인 경우가 많다. 사용자들도 이를 지적한다: "Auto-closing valid feature requests before any human triage doesn't shrink the backlog — it fragments a single recurring request into a pile of locked duplicates"(사람이 보기 전에 자동으로 닫으면 같은 요청이 잠긴 중복 이슈 더미로 쪼개질 뿐) — PaulRBerg, 2026-06-22, [#61904](https://github.com/anthropics/claude-code/issues/61904).
- 주의 2: 2026-08-17에 "closed completed"가 대량으로 몰려 있다. 확인한 한 건(#9177)은 bcherny(Collaborator)가 "출시됨" 설명을 달고 닫았다 — [#9177](https://github.com/anthropics/claude-code/issues/9177). 나머지 08-17 종료 건이 모두 실제로 고쳐졌는지는 개별 확인하지 못했다.
- core API 한도(시간당 60회, 같은 IP의 다른 조사자와 공유)가 조사 중 바닥나서, 개별 이슈 본문·댓글은 웹 페이지(WebFetch)로 읽었다.

## 1. 반응(👍) 많은 터미널 사용성 이슈 상위 목록

### Takeaway
반응이 가장 많이 몰린 터미널 문제는 여전히 스크롤 튐·깜빡임·복사 붙여넣기 같은 렌더러 기본기이고(#826 👍690, #769 👍299, #18170 👍301 모두 open), 상태 표시 쪽은 statusLine에 한도·컨텍스트·effort가 이미 들어가 있어 남은 요청은 모델별 주간 한도, 메시지 타임스탬프, Read 대상 파일 표시처럼 세부로 옮겨 갔다. effort를 키 하나로 바꾸는 요청은 👍는 적지만 3월부터 최소 다섯 번 다시 올라왔고 아직 처리되지 않았다.

### Cited Findings

전체 저장소 반응 상위권 중 터미널 UI 관련(참고로 1위는 AGENTS.md 지원 #6235 👍5189, 터미널과 무관):
- #45596 "Bring Back Buddy — A Consolidated Plea from the Community" — 👍1195 · open · 2026-04-09 · 만우절에 나온 터미널 동반 캐릭터 `/buddy`를 되살려 달라는 통합 요청. 관련 이슈 #45517 제목이 "/buddy command and companion completely missing in v2.1.97 (works in v2.1.96)"(2.1.97에서 사라짐, 2.1.96에선 됨), #45705 제목이 "Make /buddy a permanent feature, not just April Fool's Day" · hubblerc: "개인 취향 꾸미기" 쪽 새 아이디어(동반 캐릭터를 mod로) · [커뮤니티] — [#45596](https://github.com/anthropics/claude-code/issues/45596), [#45517](https://github.com/anthropics/claude-code/issues/45517), [#45705](https://github.com/anthropics/claude-code/issues/45705)
- #3648 "Terminal Scrolling Uncontrollably During Claude Code Interaction" — 👍693 · closed completed · 2025-07-16 → 2025-12-17 · 출력 중 터미널이 제멋대로 스크롤 · [커뮤니티] — [#3648](https://github.com/anthropics/claude-code/issues/3648)
- #826 "[BUG] Console scrolling top of history when claude add text to the console" — 👍690 · open(재오픈) · 2025-04-19 · 출력이 붙을 때 화면이 기록 맨 위로 튐 · [커뮤니티] — [#826](https://github.com/anthropics/claude-code/issues/826)
- #1913 "Terminal Flickering" — 👍322 · closed duplicate · 2025-06-10 → 2026-10-22 — [#1913](https://github.com/anthropics/claude-code/issues/1913)
- #769 "[BUG] In-progress Call causes Screen Flickering" — 👍299 · open(재오픈) · 2025-04-12 — [#769](https://github.com/anthropics/claude-code/issues/769)
- #18170 "Copy/paste from terminal includes unwanted indentation and trailing spaces" — 👍301 · open · 2026-01-14 — [#18170](https://github.com/anthropics/claude-code/issues/18170)
- #8477 "[FEATURE] Add Option to Always Show Claude's Thinking" — 👍337 · closed completed · 2025-09-30 → 2026-08-17 — [#8477](https://github.com/anthropics/claude-code/issues/8477)
- #3412 "Allow viewing and editing content of "pasted text" blocks before submission" — 👍292 · closed completed · → 2026-08-17 — [#3412](https://github.com/anthropics/claude-code/issues/3412)
- #23134 "Option to disable paste text collapse in input field" — 👍157 · open · 2026-02-04 — [#23134](https://github.com/anthropics/claude-code/issues/23134)
- #50246 "Message queue mode — queue messages instead of interrupting active tasks" — 👍214 · closed completed · 2026-04-18 → 2026-08-17 — [#50246](https://github.com/anthropics/claude-code/issues/50246)
- #6814 "Turn off annoying progress messages?" — 👍215 · closed completed · → 2026-03-12; #4034 "Option to disable humorous verb choice" — 👍139 · closed completed · → 2026-02-01; #24968 "Accessbility - turn duration verbs should also be customizable" — 👍72 · open · 2026-02-11 · hubblerc: 꾸미기(스피너·턴 시간 줄 문구) — [#6814](https://github.com/anthropics/claude-code/issues/6814), [#4034](https://github.com/anthropics/claude-code/issues/4034), [#24968](https://github.com/anthropics/claude-code/issues/24968)
- #2254 "Disable the welcome banner" — 👍121 · open · 2025-06-18 — [#2254](https://github.com/anthropics/claude-code/issues/2254)

statusLine 확장, 컨텍스트·한도 표시:
- #516 "Always show available context percentage" — 👍130 · closed not_planned · 2025-03-15 → 2026-01-20. 다만 statusLine 입력에 `context_window.used_percentage`가 2.1.6에서 들어갔다 [공식: CHANGELOG 2.1.6 "Added `context_window.used_percentage` and `context_window.remaining_percentage` fields to status line input"] · hubblerc: F1 ctx % — [#516](https://github.com/anthropics/claude-code/issues/516), [CHANGELOG](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)
- #13585 "Add Quota Information Access to Claude Code CLI" — 👍129 · open · 2025-12-10. #5621 "StatusLine should expose API usage/quota information in JSON input" — 👍47 · closed not_planned · → 2026-02-05. 그 뒤 2.1.80에서 statusLine에 `rate_limits`가 들어갔다 [공식: CHANGELOG 2.1.80 "Added `rate_limits` field to statusline scripts … (5-hour and 7-day windows with `used_percentage` and `resets_at`)"] · hubblerc: F1 5h/7d — [#13585](https://github.com/anthropics/claude-code/issues/13585), [#5621](https://github.com/anthropics/claude-code/issues/5621), [CHANGELOG](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)
- #73770 "statusline: expose per-model weekly rate limits (Opus/Sonnet/Fable) to the status line command" — 👍26 · open · 2026-07-03. 같은 요청 #81940(👍6, open), #77846·#78232(duplicate로 닫힘), #89769(not_planned) · hubblerc: F1 7d 칸을 모델별로 나눌 수 있는지(현재 API 미제공) — [#73770](https://github.com/anthropics/claude-code/issues/73770)
- effort를 statusLine에: #38392 "Statusline JSON missing effort level field" — 👍21 · closed duplicate · 2026-03-24 → 2026-04-24(#31415, #36187, #39399, #31987도 같은 날 duplicate). 2.1.119에서 해결 [공식: CHANGELOG 2.1.119 "Status line: stdin JSON now includes `effort.level` and `thinking.enabled`"] — [#38392](https://github.com/anthropics/claude-code/issues/38392), [CHANGELOG](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)
- #5685 "Feature Request - refresh status line on an interval" — 👍33 · closed completed · → 2026-04-11 [공식: CHANGELOG 2.1.97 "Added `refreshInterval` status line setting"]. #76988 "Re-run statusLine command on terminal resize (SIGWINCH)" — 👍7 · open · 2026-07-12 · hubblerc: F2(폭 변화에 따른 다시 그리기는 mod 쪽이 이미 유리) — [#5685](https://github.com/anthropics/claude-code/issues/5685), [#76988](https://github.com/anthropics/claude-code/issues/76988)
- #21151 "[FEATURE] No indication of WHICH file for READ tool" — 👍186 · open · 2026-01-27 · 접힌 Read 줄에 어떤 파일인지 안 보임 · hubblerc: F4/F5(ToolGroup 줄을 다시 그리는 hubblerc가 바로 채울 수 있는 빈자리) — [#21151](https://github.com/anthropics/claude-code/issues/21151)
- #44763 "Show timestamps on conversation messages" — 👍96 · open · 2026-04-07; #30745 같은 요청 👍34 · open; #2441(👍63)·#21051(👍56)은 2026-10-22 duplicate로 닫힘. 엔진은 턴 끝 줄에 완료 시각을 붙였다 [공식: CHANGELOG 2.1.246 "Added the turn's completion time to the end-of-turn duration line, e.g. `✻ Sautéed for 23s · done 6:05 PM`"], 2.1.257 "transcript-view timestamps" 형식 설정 추가 · hubblerc: F5 타임라인·목차에 시각 표시 — [#44763](https://github.com/anthropics/claude-code/issues/44763), [#30745](https://github.com/anthropics/claude-code/issues/30745), [CHANGELOG](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)
- #11008 "[FEATURE] Expose token usage and cost data in hook inputs" — 👍34 · open · 2025-11-04 · hubblerc: 후보 "누적 비용" — [#11008](https://github.com/anthropics/claude-code/issues/11008)
- #7502 "[Bug] Auto-Compact Erases Entire Chat History Without Warning" — 👍39 · open · 2025-09-12 · hubblerc: 후보 "자동 압축 직전 경고"를 뒷받침 — [#7502](https://github.com/anthropics/claude-code/issues/7502)
- #27242 "No working mechanism to review previous context after compaction, plan-mode clear, or branch navigation" — 👍91 · open · 2026-02-20 — [#27242](https://github.com/anthropics/claude-code/issues/27242)

effort·모델 전환:
- #43326 "Feature: Auto-select model and effort level based on task complexity" — 👍77 · open · 2026-04-04 · "Use a lightweight classifier (e.g., Haiku) to evaluate the user's prompt and automatically set the model/effort"(가벼운 분류기로 프롬프트를 보고 모델·effort를 자동 설정). 댓글: "A `UserPromptSubmit` hook that rewrites `.claude/settings.json` does **not** change the running session's model"(설정 파일을 고치는 훅으로는 실행 중 세션의 모델이 안 바뀜) — akshat4165, 2026-06-11. 2026-10-22에 제3자 도구(danniely/claude-auto-model) 링크. 직원 답 없음 · hubblerc: F3 auto와 같은 요구. mod의 `turn.step`이 이 문제를 푸는 경로 [커뮤니티] — [#43326](https://github.com/anthropics/claude-code/issues/43326)
- effort 키 한 번으로 바꾸기: #61904 "[FEATURE] Add chat:cycleEffort / chat:increaseEffort / chat:decreaseEffort actions for single-key effort switching" — 👍3 · open · 2026-05-23. 앞선 같은 요청 #31519(👍4, 2026-03-06 → 04-12 not_planned), #32735·#41160·#49257(duplicate), #60514·#79468(not_planned) · hubblerc: F3 수동 — [#61904](https://github.com/anthropics/claude-code/issues/61904), [#31519](https://github.com/anthropics/claude-code/issues/31519), [#79468](https://github.com/anthropics/claude-code/issues/79468)
- #66402 "[BUG] /model and /effort mutate global settings.json — breaks agents/fleet view; no way to configure per-agent model or effort" — 👍14 · open · 2026-06-09 · "`/model` and `/effort` write to `~/.claude/settings.json` immediately and globally."(바로 전역 설정에 씀). 댓글: "Ran `/effort high` for one heavy task and it silently saved as my default for new sessions."(한 작업에 쓰려고 바꿨는데 조용히 기본값으로 저장됨) — kevinmccann-td, 2026-07-10. 엔진은 2.1.257에서 `/effort`에 "이 세션만" 키를 추가 [공식: CHANGELOG 2.1.257 "Added `s` in `/effort` to change effort for the current session only, matching `/model`"] · hubblerc: spec F3의 "`/effort`는 설정 파일에 저장될 수 있어(미확인)"에 대한 답. 저장된다(기본 동작), `s`로 세션 한정 가능 — [#66402](https://github.com/anthropics/claude-code/issues/66402), [CHANGELOG](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)
- #30726 "Settings effortLevel "max" is silently downgraded when user interacts with effort selection UI" — 👍31 · open(재오픈) · 2026-03-04; #43083 "configurable reasoning effort level for subagents" — 👍61 · closed completed · → 2026-08-17; #77298 "Add per-call effort parameter to the Agent (Task) tool" — 👍24 · open · 2026-07-13; #95876 "Support inline model effort level specification in prompts" — 👍12 · open · 2026-09-21 — [#30726](https://github.com/anthropics/claude-code/issues/30726), [#43083](https://github.com/anthropics/claude-code/issues/43083), [#77298](https://github.com/anthropics/claude-code/issues/77298), [#95876](https://github.com/anthropics/claude-code/issues/95876)

키 바인딩:
- #9177 "[FEATURE] Add user-configurable keyboard shortcut actions" — 👍49 · closed completed · 2025-10-08 → 2026-08-17. bcherny(Collaborator)의 종료 댓글: "Customizable keyboard shortcuts shipped in v2.1.18 … Binding a key directly to a custom slash command isn't supported yet — feel free to open a focused request for that."(키 설정은 2.1.18에 나왔다. 키를 사용자 슬래시 명령에 바로 묶는 건 아직 안 된다) [공식] — [#9177](https://github.com/anthropics/claude-code/issues/9177). [주의] 이후 버전에는 `command:` 바인딩이 있다는 사용자 보고가 있다(2.1.287, 이름만 받음, 인자 불가) — [#98935](https://github.com/anthropics/claude-code/issues/98935)
- #2054 "Insert a new line with Enter key instead of sending a message" — 👍159 · closed completed · → 2026-08-17; #5064 "Ctrl+Enter for newlines conflicts with standard app conventions - request customizable shortcuts" — 👍55 · closed completed · → 2026-08-17 — [#2054](https://github.com/anthropics/claude-code/issues/2054), [#5064](https://github.com/anthropics/claude-code/issues/5064)
- #75899 "Left arrow accidentally navigates to agents screen (not rebindable) …" — 👍21 · closed completed · 2026-07-08 → 2026-08-17 — [#75899](https://github.com/anthropics/claude-code/issues/75899)
- Esc 과부하: #21167 "ESC key kills ALL background tasks/subagents - poor UX for parallel workflows" — 👍14 · open · 2026-01-27; #93530 "Esc kills an unrelated background subagent irrecoverably…" — 👍1 · open · 2026-09-11; #104725 "Esc overloaded for both interrupt and clear prompt, causing accidental interrupts" — open · 2026-10-23; #94249 "Separate keybindings for canceling operations vs clearing input window (CLI)" — open · 2026-09-14 · hubblerc: Esc를 mod가 못 받는 한계와 별개로 Esc 자체가 엔진 안에서 이미 겹쳐 쓰이고 있음 — [#21167](https://github.com/anthropics/claude-code/issues/21167), [#93530](https://github.com/anthropics/claude-code/issues/93530), [#104725](https://github.com/anthropics/claude-code/issues/104725), [#94249](https://github.com/anthropics/claude-code/issues/94249)
- #95957 "Ctrl+J / LF newline is hardcoded in the chat input, so unbinding ctrl+j in keybindings.json has no effect" — open · 2026-09-22 · hubblerc: "입력창이 단일 ctrl 키를 먼저 가져감"과 비슷한 성격(입력창 하드코딩 키) — [#95957](https://github.com/anthropics/claude-code/issues/95957)

전체 화면·스크롤·복사:
- 엔진은 깜빡임 대책으로 전체 화면 렌더러를 냈다 [공식: CHANGELOG 2.1.110 "Added `/tui` command and `tui` setting — run `/tui fullscreen` to switch to flicker-free rendering"]. 그 뒤 전체 화면 고유 문제가 쌓였다:
- #65833 "v2.1.150: scroll wheel no longer scrolls conversation — sends arrow keys instead" — 👍124 · open · 2026-06-06 — [#65833](https://github.com/anthropics/claude-code/issues/65833)
- #70539 "Add scroll-only mouse mode to disable clicks while preserving wheel scrolling" — 👍92 · closed completed · → 2026-08-17; #70672(👍56) 같은 요청 closed completed — [#70539](https://github.com/anthropics/claude-code/issues/70539)
- #62699 "Text cannot be copied from Claude Code's output using `Ctrl+Shift+C` or right-click context menu." — 👍77 · open · 2026-05-27; #65844 "Fullscreen TUI: Cmd+C intercepted by internal selection, breaks macOS mouse copy" — 👍24 · open; #70857 "Fullscreen (alternate-screen) mode breaks terminal copy" — 👍20 · open; #81472 "[META] Copy/paste is broken across all surfaces — tracking issue for 42 open copy/paste issues" — 👍15 · open · 2026-07-26 — [#62699](https://github.com/anthropics/claude-code/issues/62699), [#65844](https://github.com/anthropics/claude-code/issues/65844), [#81472](https://github.com/anthropics/claude-code/issues/81472)
- #56546 "Fullscreen TUI mode has janky/non-smooth scrolling" — 👍22 · open · 2026-05-06; #72215 "Fullscreen render mode: no scrollbar and scrolling fully broken…" — 👍9 · open — [#56546](https://github.com/anthropics/claude-code/issues/56546), [#72215](https://github.com/anthropics/claude-code/issues/72215)
- #90299 "fullscreen sticky prompt header stopped rendering in 2.1.247" — 👍8 · open · 2026-08-28; #90537 같은 회귀(2.1.251) 👍7 · open — [#90299](https://github.com/anthropics/claude-code/issues/90299), [#90537](https://github.com/anthropics/claude-code/issues/90537)
- #93160 "[BUG] Diff panel opens automatically in fullscreen mode without running /diff" — 👍4 · open · 2026-09-09 · hubblerc: effort 단축키에 diff 패널 동작(`app:cycleDiffBase`)을 빌려 쓰고 있으므로 diff 패널 동작 변화에 주의 [추론] — [#93160](https://github.com/anthropics/claude-code/issues/93160)
- #4851 "Terminal Scrollback Buffer Rewind Lag in Claude Code + Tmux + Visual Studio Code After Extended Use" — 👍97 · open — [#4851](https://github.com/anthropics/claude-code/issues/4851)

대화 기록·이동:
- #70678 "Keyboard navigation between user messages in chat conversation (jump to previous/next prompt)" — 👍18 · open · 2026-06-24; #63901 "navigate/jump to previous user prompts in the current conversation (without terminal scrollback)" — 👍8 · open · 2026-05-30; #16784 "Keyboard shortcut to navigate between user prompts" — 👍18 · closed completed · → 2026-05-12 · hubblerc: F2 사이드바 "목차"(눌러서 그 답변으로 이동)와 같은 요구 — [#70678](https://github.com/anthropics/claude-code/issues/70678), [#63901](https://github.com/anthropics/claude-code/issues/63901), [#16784](https://github.com/anthropics/claude-code/issues/16784)
- #93973 "[FEATURE] Plugin API for interactive TUI elements (clickable overlays, panels, keybinding actions)" — open · 2026-09-13(mod 공개 전) · "What I wanted to build: a minimap of my own prompts in a long session, click one and jump there."(긴 세션에서 내 프롬프트 미니맵을 만들어 눌러서 이동하고 싶었다) · hubblerc: 목차가 정확히 이것 — [#93973](https://github.com/anthropics/claude-code/issues/93973)

diff·변경 추적:
- #37951 "Option to hide inline diffs for Edit/Write tool output" — 👍110 · open · 2026-03-23 · hubblerc: F5(diff 대신 +/− 요약 줄로 접는 mod 가능) — [#37951](https://github.com/anthropics/claude-code/issues/37951)
- #18541 "Improve diff view to show session changes only (exclude read files)" — 👍19 · open · 2026-01-16; #92189 "Display subagent diffs in diff view and subagent activity in agents view" — 👍1 · open · 2026-09-04 · hubblerc: F2 "변경 파일"(서브에이전트 변경 포함, 답변 번호)이 이 빈자리 — [#18541](https://github.com/anthropics/claude-code/issues/18541), [#92189](https://github.com/anthropics/claude-code/issues/92189)
- 엔진 diff 패널 [공식: CHANGELOG 2.1.260 "Added a diff panel that opens beside the conversation in fullscreen mode and shows your uncommitted changes as Claude edits; toggle it with `/diff`"]. #99626 "Per-turn diff view in Claude Code Desktop (parity with CLI /diff)" — open · 2026-10-05(제목상 CLI `/diff`에는 턴별 보기가 있다는 뜻) — [#99626](https://github.com/anthropics/claude-code/issues/99626), [CHANGELOG](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)

알림:
- #26581 "System notifications when Claude needs attention or completes tasks" — 👍34 · closed completed · → 2026-08-17; #19976 "Support terminal notifications when running inside tmux" — 👍26 · closed completed · → 2026-08-17; #13922 "Configurable timeout for idle_prompt notification hook" — 👍42 · open; #5186 "Notification Hook 10 second delay" — 👍33 · open — [#26581](https://github.com/anthropics/claude-code/issues/26581), [#13922](https://github.com/anthropics/claude-code/issues/13922), [#5186](https://github.com/anthropics/claude-code/issues/5186)
- MCP 끊김 알림은 엔진에 이미 있다 [공식: CHANGELOG 2.1.273 "Added a notification when an MCP server disconnects mid-session and automatic reconnection gives up, pointing at `/mcp`"] · hubblerc: 후보 "MCP 끊김 경고"는 재연결 포기 전 단계(끊김 직후)만 차별점 [추론] — [CHANGELOG](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)

테마:
- #2990 "Automatic light/dark theme selection?" — 👍242 · closed completed · 2025-07-04 → 2026-05-31; #1302 "Add support for custom terminal themes beyond built-in options" — 👍135 · closed duplicate · → 2026-04-27; #11813 시스템 테마 따르기 👍134 · closed duplicate — [#2990](https://github.com/anthropics/claude-code/issues/2990), [#1302](https://github.com/anthropics/claude-code/issues/1302)
- 남은 요청(모두 open): #73837 "Markdown inline code (codespans) ignore custom theme overrides" 👍18; #48636 "Customizable Code Snippet Colors / Syntax Highlighting Theme" 👍18; #57036 "Custom themes diff overrides not applying" 👍11; #95249 "theme: "auto": message blocks keep the colors of the theme they were drawn under" 👍4; #93535 "Theme tokens for Markdown elements (headings, bold, inline code) in assistant output" 👍4 · hubblerc: 터미널 색 이름을 써서 Kanagawa가 색을 정하게 한 결정은 이런 테마 누락 문제를 피함 [추론] — [#73837](https://github.com/anthropics/claude-code/issues/73837), [#48636](https://github.com/anthropics/claude-code/issues/48636), [#57036](https://github.com/anthropics/claude-code/issues/57036), [#95249](https://github.com/anthropics/claude-code/issues/95249)

작은 화면·크기 변경:
- #58906 "Terminal UI becomes corrupted after resizing window" — 👍20 · open · 2026-05-14; #51828 "Scrollback duplication on terminal resize persists in 2.1.116 (VS Code integrated terminal, macOS)" — 👍36 · open — [#58906](https://github.com/anthropics/claude-code/issues/58906), [#51828](https://github.com/anthropics/claude-code/issues/51828)
- "작은 화면/좁은 터미널"을 직접 다룬 반응 많은 기능 요청은 찾지 못했다(검색어 narrow·small·width in:title 상위는 스크롤·깜빡임 버그뿐).

### Inferences
- [추론] 반응 상위권은 엔진 렌더러 버그(스크롤·깜빡임·복사)라서 mod로는 못 고친다. mod가 끼어들 수 있는 건 "무엇을 보여 줄지" 층(상태 표시, 도구 행 요약, 목차, 타임스탬프)이다.
- [추론] statusLine 확장 요청은 대부분 엔진이 필드를 추가하며 정리됐다(context %, rate_limits, effort, refreshInterval). 남은 것(모델별 주간 한도, 리사이즈 시 다시 그리기, 메시지 시각)은 mod에서도 데이터가 없거나(모델별 한도) 이미 해결되는(리사이즈) 경우로 갈린다.
- [추론] effort 단축키는 👍 수는 작아도(각 3~4) 다섯 번 넘게 재제출됐고 stale 봇이 계속 닫았다. 👍만 보면 수요를 과소평가하게 된다.

### Gaps
- 👍는 2026-10-26 검색 API 기준. 웹 페이지가 반응을 표시하지 않아 교차 확인하지 못했다.
- 2026-08-17 "completed" 대량 종료 건들이 실제로 출시됐는지는 #9177 한 건만 확인했다.
- "작은 모니터 ↔ 큰 모니터 전환"을 직접 요청한 이슈는 찾지 못했다.

## 2. mod / function hooks 관련 이슈: 제안, 공개 후 버그·API 요청, Anthropic 답변

### Takeaway
제안 이슈 #91870(open, 👍131, 댓글 271)이 맞고, 2.1.287에서 "Claude Mods"로 출시됐다. 공개(10-01 전후) 이후 mod 관련 이슈가 하루 몇 건씩 올라오는데, 반응이 많은 건 VS Code·Desktop·Remote Control에서 mod UI가 안 그려지는 표면 호환 문제(👍9~12)이고, 터미널 쪽 API 요청은 대부분 👍 0~1, 댓글 0개로 아직 Anthropic 답이 달리지 않았다.

### Cited Findings

제안과 출시:
- #91870 "Mods - make Claude 10x more extensible" — 👍131(반응 합계 224) · open · 2026-09-03 · 작성자 poteat(author_association CONTRIBUTOR) · 댓글 271 [공식] — [#91870](https://github.com/anthropics/claude-code/issues/91870)
  - 원문(09-03): "Function Hooks let you modify CC very deeply, while still being safe through side-effect tracking over a parameterized $ object, and while composing neatly using a registration-order-based 'next' continuation model a la Express, or Koa."(함수 훅은 $ 객체로 부작용을 추적해 안전하게 CC를 깊이 바꾸게 하고, Express·Koa처럼 등록 순서 기반 next로 조합된다)
  - 09-09 갱신: "we are going to be calling this functionality "Claude Mods". … A mod is just a plugin that uses function hooks"(이름은 Claude Mods, mod는 함수 훅을 쓰는 플러그인일 뿐), "any folks who want to test and give feedback may use `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude`."
  - 10-01 갱신: "We're live! We're rapidly working down the latest elements of feedback folks have posted."(출시했다. 올라온 피드백을 빠르게 처리 중)
  - poteat 댓글(09-03): "`$.fs`, `$.http`, and `$.process` will very likely exist. Our prerogative is not to restrict what plugins can do; that's your org admin's job."(fs·http·process는 생길 것. 막는 건 조직 관리자의 몫)
  - poteat 댓글(10-20): "Hi folks, we've been super busy addressing feedback and preparing for further parity across surfaces." `Input`이 한 줄뿐이라는 지적에 "Fixed as of v299 and v301 respectively; re the latter, we introduced `rows` for `Input`"(299·301에서 고침, `Input`에 `rows` 추가), rewind 요청에 "Super reasonable, I agree - we'll try to land this as well."
- 출시 [공식: CHANGELOG 2.1.287 "Added Claude Mods: plugins may now modify deeper behavior"] — [CHANGELOG](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)
- #99130 "Mods off remotely on 2.1.288 despite docs saying on by default since 2.1.287 (rollout switch serves off)" — 👍5 · open · 2026-10-03 · 원격 스위치로 mod가 꺼질 수 있음. #91870 댓글(10-23)에도 "When Mods are turned off remotely, show a one-line notice in the app"(원격으로 꺼지면 한 줄 알려 달라) · hubblerc: 밴드·사이드바가 갑자기 안 보이면 원격 스위치 가능성 [커뮤니티] — [#99130](https://github.com/anthropics/claude-code/issues/99130), [#91870](https://github.com/anthropics/claude-code/issues/91870)

반응 많은 mod 이슈(표면 호환, hubblerc는 터미널 전용이라 직접 영향 적음):
- #99045 "VS Code extension never draws mod UI (Pane, AbovePrompt, status, toast) …" 👍12 open 10-02; #99217 "Mod ui.render (AbovePrompt/Pane) not drawn in desktop/iOS views of a Remote Control session" 👍11 open 10-03; #99265 "Desktop app draws a mod's AbovePrompt band in only one chat at a time" 👍10 closed completed 10-03 → 10-14; #99401 VS Code에 mod UI 그리기 👍9 closed duplicate → 10-22; #99211 "Desktop app redraws every mod render site on any state change, which breaks Buttons…" 👍5 open; #101256 Desktop이 Remote Control 세션에 밴드를 그리게 하지 않음 👍4 open · hubblerc: 휴대폰·데스크톱에서 Remote Control로 붙으면 밴드·사이드바가 안 보인다 [커뮤니티] — [#99045](https://github.com/anthropics/claude-code/issues/99045), [#99217](https://github.com/anthropics/claude-code/issues/99217), [#99265](https://github.com/anthropics/claude-code/issues/99265), [#101256](https://github.com/anthropics/claude-code/issues/101256)

터미널 mod API 요청·버그(모두 open, 별도 표기 없으면 👍0~1·댓글 0):
- 키·포커스
  - #98935 "Mods: no way to put effort on a key without /effort rows in the transcript" — 10-02 · 아래 3절 참고 · F3 — [#98935](https://github.com/anthropics/claude-code/issues/98935)
  - #101494 "Plugins: deliver Esc (or a prompt-cancel event) to plugins while the prompt has focus" — 10-12 · F1 슬라이더 — [#101494](https://github.com/anthropics/claude-code/issues/101494)
  - #104670 "Mods: show how to reach a band's Buttons from the keyboard" — 10-23 · "The only keyboard path to them is the `abovePrompt:focus` chord, `ctrl+x` then `tab` by default. … Nothing in the UI shows that chord."(밴드 버튼에 키보드로 가는 길은 `ctrl+x tab`뿐인데 화면 어디에도 안 보임), 제안 중 하나 `$.keybindings.chordOf("abovePrompt:focus")` · F1 effort 버튼, F3 — [#104670](https://github.com/anthropics/claude-code/issues/104670)
  - #104481 "Mods: a Button press should give its pane the keys when the prompt has text" — 10-23; #102216 "a click on a pane Button leaves the keys with the prompt…" — 10-14; #99502 "Mod API: deliver arrow keys (← →) to a focused pane or Client" — 10-04 · F2 사이드바 키보드 조작 — [#104481](https://github.com/anthropics/claude-code/issues/104481), [#102216](https://github.com/anthropics/claude-code/issues/102216), [#99502](https://github.com/anthropics/claude-code/issues/99502)
  - #102378 Pane Button 단축키가 입력 소스에 따라 달라짐(한글), #101804 Client 포커스 중 IME 조합이 입력창에 그려짐(Orca) — 4절 참고
  - #101805 "Mods: Client onKey gets a lone space as undocumented "space" and unnamed keys (F1, Insert, F12) as raw e…" — 10-13 — [#101805](https://github.com/anthropics/claude-code/issues/101805)
- 패널·밴드 배치
  - #103959 "Plugin pane docked beside the transcript can no longer be widened past 45% of the terminal" — 👍3 · 10-21 · 댓글 1(커뮤니티 동조) · 3절 참고 · F2 — [#103959](https://github.com/anthropics/claude-code/issues/103959)
  - #104276 "Add floating pane, per-pane width, and cross-pane focus for mod panes" — 10-22; #101332 "Mods: let a docked Pane span the full height, beside the prompt" — 10-11; #101525 여러 사이드바 패널 동시 배치 — 10-12 · F2 — [#104276](https://github.com/anthropics/claude-code/issues/104276), [#101332](https://github.com/anthropics/claude-code/issues/101332), [#101525](https://github.com/anthropics/claude-code/issues/101525)
  - #100789 "Mods: one band row per plugin above the prompt, instead of one shared AbovePrompt chain" — 👍1 · 10-09 · 댓글 1. "There is one band and one chain … a layout prop such as `width` on a Box that wraps `below` makes the engine refuse the tree … so one plugin's mistake removes every plugin's row."(밴드는 하나, 체인도 하나라서 한 플러그인의 실수가 모든 플러그인 줄을 지움). 댓글(mayuno-dev, 10-18): 한 플러그인이 `await next(e)`를 안 넣으면 다른 플러그인 밴드가 안 보임. #102562 같은 문제 — 10-15 · F1(다른 mod와 밴드 공존) — [#100789](https://github.com/anthropics/claude-code/issues/100789), [#102562](https://github.com/anthropics/claude-code/issues/102562)
  - #91870 댓글(cstillm, 10-21): "The band above the prompt always draws as a full-width bar in the same color as the prompt box, even when the content is tiny... There's no compact or transparent option."(밴드는 내용이 작아도 늘 입력창 색의 전체 폭 막대), "The prompt-footer slot truncates at about 28 characters"(프롬프트 바닥 자리는 약 28자에서 잘림) · F1 스타일 — [#91870](https://github.com/anthropics/claude-code/issues/91870)
  - #100102 "Docked plugin panes render opaque background, ignoring terminal transparency" — 👍4 · 10-07 · 꾸미기(투명 배경 터미널) — [#100102](https://github.com/anthropics/claude-code/issues/100102)
  - #99647 "Mods: `$.ui.status` is always drawn with a ⚠ warning icon and the mod's name as a prefix, with no way to choos…" — 10-05, 댓글 3 — [#99647](https://github.com/anthropics/claude-code/issues/99647)
- 렌더 자리 추가
  - #104841 "Mods: a render hook for the sticky prompt line (fullscreen)" — 10-24; #100338 "Add AboveTranscript render site for mods (fixed panel above the scrolling transcript)" — 10-07; #104503 "The terminal's "Thought for Ns" row raises no ui.render, so a mod that folds tool calls leaves it behin[d]" — 10-23; #102794 "Expose the recap line as a ui.render component" — 10-16; #102306 슬래시 명령 echo 행; #100847 프롬프트 첨부 행; #101235 환영 로고 · F4/F5(도구 행 접기 시 남는 줄) — [#104841](https://github.com/anthropics/claude-code/issues/104841), [#100338](https://github.com/anthropics/claude-code/issues/100338), [#104503](https://github.com/anthropics/claude-code/issues/104503), [#102794](https://github.com/anthropics/claude-code/issues/102794)
  - #102460 "Mod API: expose the engine's own header text on ToolUse and ToolGroup props" — 10-15 · F4(엔진이 접어 쓰는 "Read 1 file, … ran 2 shell commands" 문구를 mod가 못 받아 다시 만들어야 함) — [#102460](https://github.com/anthropics/claude-code/issues/102460)
  - #104462 "ui.render hooks on transcript rows re-run on every scroll step, roughly doubling scroll CPU" — 10-23; #104197 "a hooked tool row goes blank for one hook round trip when a streamed tool call is recorded" — 10-22 · F4 성능·깜빡임 — [#104462](https://github.com/anthropics/claude-code/issues/104462), [#104197](https://github.com/anthropics/claude-code/issues/104197)
- 데이터 접근
  - #101797 "Mods API: expose the session's current effort level" — 👍1 · 10-13 · F1 effort 표시 — 3절 참고 — [#101797](https://github.com/anthropics/claude-code/issues/101797)
  - #102057 "Mod API: add model (and effort) to AgentInfo in $.agent.list()" — 10-14 · F1 2줄 서브에이전트 — [#102057](https://github.com/anthropics/claude-code/issues/102057)
  - #101920 "Mods API: timestamps (and usage) on $.session.messages() rows" — 10-14 · F5 resume 복원 시 시간 없음과 같은 한계 — [#101920](https://github.com/anthropics/claude-code/issues/101920)
  - #102989 "Expose per-model (scoped weekly) rate-limit windows in the status line and $.session.usage()…" — 10-17; #102846 "expose the "Reset for free" offer and its expiry next to the rate limits" 👍3 · 10-16; #104967 "Report how much of the 5-hour and weekly limits each request used, not only the window totals" — 10-25 · F1, 후보 "한도 소진 예측" — [#102989](https://github.com/anthropics/claude-code/issues/102989), [#102846](https://github.com/anthropics/claude-code/issues/102846), [#104967](https://github.com/anthropics/claude-code/issues/104967)
  - #91870 댓글(cstillm, 10-21): "Rate limits reach mods only after the first reply (`rateLimits` is empty "before the first reading"), though the app's own usage card has the numbers at session start."(한도 값은 첫 답변 뒤에야 mod에 옴) · F1 세션 시작 직후 5h/7d 칸이 비는 이유 — [#91870](https://github.com/anthropics/claude-code/issues/91870)
  - #100766 `turn.step` usage에 5분/1시간 캐시 쓰기 구분; #101271 usage에 과금 필드 · 후보 "누적 비용" — [#100766](https://github.com/anthropics/claude-code/issues/100766), [#101271](https://github.com/anthropics/claude-code/issues/101271)
  - #101378 "Mods API: a queryable record per background task, with event order, exit code and progress" — 10-11; #100918 동적 워크플로 에이전트를 `$.agent.list()`에; #101387 리드 프로세스 밖 에이전트 · 후보 "백그라운드 작업 진행" — [#101378](https://github.com/anthropics/claude-code/issues/101378), [#100918](https://github.com/anthropics/claude-code/issues/100918)
  - #104070 "Mods: $.session.repo() stays null for a git repo created mid-session (2.1.306)" — 10-21 · F1 브랜치(hubblerc는 git을 직접 읽음) — [#104070](https://github.com/anthropics/claude-code/issues/104070)
  - #102134 "session.compact mod hook no longer raised in 2.1.299 (manual and automatic compaction)" — 10-14 · 댓글 3 · 후보 "자동 압축 경고"에 압축 이벤트를 쓰려면 확인 필요 — [#102134](https://github.com/anthropics/claude-code/issues/102134)
- 알림
  - #99306 "Mods: let a plugin send a native notification ($.ui.notify)" — 10-03(검색 기준 open). 엔진은 2.1.295에서 추가 [공식: CHANGELOG 2.1.295 "Added `$.ui.notify` for mods: raises a native notification through your own notification setting"]. 후속 요청 #104902 "notification placement, type and delivery to the user's devices" — 10-24; #100204 "let a plugin decide whether Claude Code's turn-end notification is shown" — 10-07 — [#99306](https://github.com/anthropics/claude-code/issues/99306), [#104902](https://github.com/anthropics/claude-code/issues/104902), [CHANGELOG](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)
- 개발 도구·문서
  - #101450 "[DOCS] Mods: document that each event allows only one matcher-less on() registration per plugin" — 10-12; #101451 "[DOCS] Mods: document that $ and state atoms cannot cross module imports (validate refuses the hooks module)" — 10-12 · hubblerc가 직접 부딪혀 spec에 적어 둔 두 규칙과 같음 — [#101450](https://github.com/anthropics/claude-code/issues/101450), [#101451](https://github.com/anthropics/claude-code/issues/101451)
  - #99771 "`claude plugin test` and `claude plugin validate` do not type-check TypeScript mods" — 10-05; #100736 "a headless way to write .claude-plugin/types for CI type-checks" — 10-09 · hubblerc 개발 메모(tsc 따로 실행, 타입 정의를 기기마다 복사)와 같은 불편 — [#99771](https://github.com/anthropics/claude-code/issues/99771), [#100736](https://github.com/anthropics/claude-code/issues/100736)
  - #103893 "render a mod's drawing to an image headlessly (for tests and evals while the screen is locked)" — 10-21 · hubblerc 테스트 키트가 화면 동작(스크롤)을 못 흉내 내는 문제와 같은 방향 — [#103893](https://github.com/anthropics/claude-code/issues/103893)
  - #102300 "an official "render sites" example mod that labels every place a mod can draw" — 10-15 — [#102300](https://github.com/anthropics/claude-code/issues/102300)

Anthropic이 고친 mod 문제(닫힘 + CHANGELOG):
- 2.1.289~2.1.310 CHANGELOG의 mod 수정 예: "Fixed right-aligned content in a mod's pane or band drawing under the close mark or `[-]`"(2.1.289), "Fixed a mod's pane or band being redrawn without end…"(2.1.290), "Fixed plugin hooks stalling each redraw when a mod draws a long multi-line text holding non-Latin characters"(2.1.290), "Fixed a mod's `prompt.edit` hook not being raised for a newline entered with the `chat:newline` keybinding"(2.1.300), "Improved a mod's `Image` to draw inside tmux with `allow-passthrough`…"(2.1.310) [공식] — [CHANGELOG](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)
- 닫힌 completed: #99265(10-14), #101065 분할 보기에서 밴드가 왼쪽에만(10-14), #102594 VS Code 밴드가 `/`·`@` 메뉴를 가림(10-21), #102981(10-21), #99395(10-23) — 대부분 Desktop·VS Code [공식: 닫힘 상태] — [#101065](https://github.com/anthropics/claude-code/issues/101065), [#102594](https://github.com/anthropics/claude-code/issues/102594), [#99395](https://github.com/anthropics/claude-code/issues/99395)

#91870 댓글 271개 전체(core API로 받음, 2026-10-26):
- 작성자 소속: NONE 235, CONTRIBUTOR 36(poteat 35 + 1명). MEMBER·COLLABORATOR 배지 댓글은 없다. poteat 댓글은 09-03~09-25에 집중(설계 질의응답), 공개 후에는 10-01, 10-02, 10-20 세 번뿐 [공식] — [#91870](https://github.com/anthropics/claude-code/issues/91870)
- poteat 10-01: "We've launched! Now the real work begins." 데스크톱 지원("we should broadly support logic and UI customization in Claude Code Desktop as of today"), 첫 패널이 두 번 그려지던 문제 "I believe we've fixed that in v285 - it was a reactive rendering issue related to dynamic width."(동적 폭 관련 반응형 렌더링 문제였고 285에서 고침) [공식] — [댓글](https://github.com/anthropics/claude-code/issues/91870#issuecomment-5942362421)
- poteat 10-02: worktree 격리 버그 "This was a big blunder on our part … This should be fixed as of today's release on v288."(우리 실수, 288에서 고침) [공식] — [#91870](https://github.com/anthropics/claude-code/issues/91870)
- poteat 09-19 로드 순서: "The order is always in the following order: * [org-prepend] [user] [org-append] [built-in]", 숫자 우선순위는 일부러 안 둠("every 'numeric priority' system in the world has failed on this") [공식] · hubblerc: 다른 mod와 밴드 순서는 의존성 선언으로만 조정 — [#91870](https://github.com/anthropics/claude-code/issues/91870)
- poteat 09-03 오류 처리: "If nobody in the chain catches the error and it bubbles up to top, the engine just dispatches again and goes with its default behavior, as if no plugins were registered at all."(아무도 못 잡은 오류는 플러그인이 없는 것처럼 기본 동작으로) [공식] — [#91870](https://github.com/anthropics/claude-code/issues/91870)
- 키 바인딩 등록 요청은 커뮤니티에서 두 번 나왔지만 poteat 답은 없다: richardkmichael(09-26) "5. A method that registers a mod's own keybinding actions.", gmetzker-4c(09-28) "Mod-registered keybinding actions (also asked for by @richardkmichael above), so the trigger doesn't have to be a printable key."(인쇄 가능한 키가 아닌 트리거를 쓰려면 mod가 키 동작을 등록할 수 있어야 함) [커뮤니티] — [댓글](https://github.com/anthropics/claude-code/issues/91870#issuecomment-5842961190), [#91870](https://github.com/anthropics/claude-code/issues/91870)
- Esc: AlmogBaku(09-17)가 `Input`에 Esc 지원을 요청("Asks: `autoFocus` on next commit, Shift+Enter, Esc, and `plugin test` driving focus/keys.") [커뮤니티] — [#91870](https://github.com/anthropics/claude-code/issues/91870)
- 패널 자동 배치 폭: lkangd(10-21, chat-toc) "Needs a wide terminal — docks by itself from 144 columns, from 110 with `/chat-toc`."(스스로 열면 144칸부터, 명령으로 열면 110칸부터 옆에 붙음) — hubblerc가 문서로 확인한 144/110 기준과 같은 관찰 [커뮤니티] — [댓글](https://github.com/anthropics/claude-code/issues/91870#issuecomment-6312070758). nogu66(09-27)도 "a terminal at least 110 columns wide in the fullscreen UI so the panes dock" [커뮤니티] — [#91870](https://github.com/anthropics/claude-code/issues/91870)
- 밴드: sezaakgun(09-14, cc-arcade) "finding out the band is about half the terminal and redraws about ten times a second. All of that is workable, just undocumented right now."(밴드는 터미널 약 절반 높이까지, 초당 약 10번 다시 그림, 문서에 없음) [커뮤니티] — [#91870](https://github.com/anthropics/claude-code/issues/91870)
- 마우스: rjwittams(09-15) "Mouse reporting is on only on the alternate screen, so band buttons and clicks into a Client never fire outside fullscreen."(마우스 보고는 전체 화면에서만 켜져서, 전체 화면이 아니면 밴드 버튼 클릭이 안 됨) [커뮤니티] · hubblerc: 전체 화면이 아닌 기기에서는 effort 값 클릭이 안 될 것 [추론] — [댓글](https://github.com/anthropics/claude-code/issues/91870#issuecomment-5685165223)
- `$.store`: frsorrentino(09-04) "`$.store` is a JSON file per plugin under `~/.claude/plugins/store/`: machine scope, no compare-and-set"(플러그인마다 JSON 파일 하나, 기기 범위, 비교 후 쓰기 없음), rbartoli(10-09) "+1 … a compare-and-set on `$.store`. It's machine-wide, … but get-then-set races between processes."(여러 세션 프로세스가 동시에 읽고 쓰면 경합) [커뮤니티] · hubblerc: 후보 "오늘 누적 비용·작업 시간"을 여러 세션이 `$.store`에 같이 쌓으면 경합. 우회로 "one key per session, summed by readers"(세션마다 키 하나, 읽을 때 합산)가 제시됨 — [#91870](https://github.com/anthropics/claude-code/issues/91870)
- 4MB는 `$.store`가 아닌 다른 한도로만 언급됨: "The 4 MB file read limit means bigger Word, Excel or PDF files need a fallback."(paragpandyareal 10-10, 파일 읽기 한도), 훅 모듈 파일 하나가 1,048,576바이트를 넘으면 안 읽힘(wkasekende 10-15) [커뮤니티] — [#91870](https://github.com/anthropics/claude-code/issues/91870)
- 한도 데이터: Arunjay4213(09-14) "Nothing pushes a rate-limit change, so a tracker has to poll `$.session.usage()` on a timer."(한도 변화 이벤트가 없어 타이머로 조회), "`rateLimits[].percentUsed` arrives as floats like `7.000000000000001`"; frsorrentino(09-15) 임계값 이벤트 요청 [커뮤니티] · hubblerc: F1 % 표시 반올림 필요 — [댓글](https://github.com/anthropics/claude-code/issues/91870#issuecomment-5669755348)
- 버전 호환: deafsquad(10-16) 2.1.300에 새로 생긴 `prompt.change` 이벤트를 걸자 2.1.296·2.1.299가 모듈 전체를 거부("made 2.1.296 and 2.1.299 refuse our whole statusline mod") [커뮤니티] · hubblerc: 세 기기의 Claude Code 버전이 다르면 새 이벤트 하나로 mod 전체가 안 뜰 수 있음 — [#91870](https://github.com/anthropics/claude-code/issues/91870)
- 댓글에 올라온 mod 중 hubblerc와 겹치는 것(자세한 mod 목록은 다른 조사자 영역): chat-toc(대화 목차, lkangd), quota-meter(5h/7d, 리셋 카운트다운, "burn-rate projection" 소진 속도 예측)·token-ledger(턴별 비용)·context-lens(압축까지 남은 턴, Arunjay4213), WeekToken(한도 속도 밴드, 3dnow), ctx-guard(컨텍스트·한도 밴드, svd), model-hint(입력 중 필요한 모델을 밴드에 제안, hashswingingslasher), agentpane·statuspane(서브에이전트 패널, xuanji86), pixpal(서브에이전트마다 작은 로봇, castus) [커뮤니티] — [#91870](https://github.com/anthropics/claude-code/issues/91870)

### Inferences
- [추론] 터미널 mod API 요청은 대부분 공개 후 3주 안에 올라왔고 댓글 0개다. Anthropic이 이슈 댓글보다는 릴리스(CHANGELOG)로 답하는 패턴으로 보인다(예: `$.ui.notify`는 2.1.295에 추가됐는데 요청 이슈 #99306은 검색 기준 아직 open).
- [추론] 반응이 많은 mod 이슈가 표면 호환(VS Code·Desktop·Remote Control)이라는 건, 지금 mod를 쓰는 사람 다수가 터미널 밖 표면도 쓴다는 신호다. hubblerc는 터미널 전용 설계라 이 버그들의 영향은 적다.

- [추론] 공개 후 poteat 답변은 세 번뿐이고, 키 바인딩 등록 요청 두 건에는 답이 없다. 키·포커스 계열은 아직 공식 방향이 없는 영역이다.
- [추론] chat-toc, quota-meter처럼 hubblerc 기능(목차, 한도 예측)과 같은 것을 이미 만든 사람이 있다. 구현을 참고하거나 차별점(밴드·사이드바 자동 전환, 한국어 표시)을 분명히 할 필요가 있다.

### Gaps
- #91870 댓글은 core API로 271개 전부 받았다(2026-10-26). 다만 댓글에 언급된 mod 저장소 내용은 확인하지 않았다(다른 조사자 영역).
- 공식 mod 문서·mod 갤러리는 다른 조사자 영역이라 보지 않았다.
- CHANGELOG에서 `command:` 키 바인딩 도입 시점, `chat:increaseEffort`/`chat:decreaseEffort` 항목은 찾지 못했다.

## 3. hubblerc가 부딪힌 한계와 같은 이슈, 상태, 공유된 우회법

### Takeaway
아홉 가지 한계 중 다섯 개(키 바인딩 생성, Esc, effort 올리기/내리기, /config에 effort 없음, 한글 입력 중 단축키)는 같은 내용의 open 이슈가 있고, 모두 Anthropic 답이 없다. effort 키는 hubblerc와 거의 같은 우회법(명령을 단계별로 등록하고 `command:` 바인딩)이 공유돼 있고, 키 동작 빌려 쓰기도 다른 mod 제작자가 똑같이 하고 있다. 144칸 자동 배치 기준은 별도 이슈는 없지만 #91870 댓글에서 같은 관찰(144/110칸)이 나왔다. `$.store` 4MB, 단일 ctrl 키, 턴 시간 버그는 이슈를 찾지 못했다. 대신 2.1.305부터 패널 폭이 45%로 묶인 변경이 hubblerc 사이드바에 새로 영향을 준다.

### Cited Findings

1) mod가 키 바인딩을 직접 못 만듦 → 일치 이슈 있음(open)
- #93973(open, 2026-09-13, mod 공개 전): 필요한 것 목록 첫 줄 "plugin-registered keybindings that run an action, e.g. scroll to a message"(플러그인이 등록하는 키 바인딩) [커뮤니티] — [#93973](https://github.com/anthropics/claude-code/issues/93973)
- #104670(open, 10-23): mod가 사용자가 묶은 키를 읽을 방법도 없다. "the hint is wrong after the user rebinds `abovePrompt:focus` with `/keybindings`"(사용자가 키를 바꾸면 mod가 그린 안내가 틀려짐) [커뮤니티] — [#104670](https://github.com/anthropics/claude-code/issues/104670)
- #91870 댓글: richardkmichael(09-26) "A method that registers a mod's own keybinding actions.", gmetzker-4c(09-28) 같은 요청. poteat 답 없음 [커뮤니티] — [댓글](https://github.com/anthropics/claude-code/issues/91870#issuecomment-5842961190)
- 같은 우회를 쓰는 사람: #91870 댓글(lkangd, 10-21) "two unused keybinding actions borrowed for ‹ › turn stepping"(쓰지 않는 키 동작 둘을 빌려 턴 이동에 씀) — hubblerc가 `app:cycleDiffBase`를 빌린 것과 같은 방식 [커뮤니티] — [#91870](https://github.com/anthropics/claude-code/issues/91870)
- 다른 우회: `command:` 바인딩. #98935 작성자(2.1.287): "`command:` bindings accept a bare name only (`^command:[a-zA-Z0-9:\-_]+$`), with no arguments."(command: 바인딩은 이름만, 인자 없이) [커뮤니티] — [#98935](https://github.com/anthropics/claude-code/issues/98935). hubblerc도 `/panel`을 `command:panel`로 이미 묶고 있다(spec F2).

2) Esc 이벤트를 못 받음 → 일치 이슈 있음(open, 답 없음)
- #101494(open, 2026-10-12, 2.1.296 macOS): "In 2.1.296 a plugin never receives Esc while the prompt has focus. With the plugin's debug log on, Esc produced no prompt edit and no key event for the plugin."(입력창에 포커스가 있으면 플러그인은 Esc를 전혀 못 받음), 요청 "Pass Esc (or a "prompt cancel" event) to plugins, after the engine's own Esc handling"(엔진 처리 뒤에 Esc나 취소 이벤트를 플러그인에 넘겨 달라). 우회법 없음, 댓글 없음 [커뮤니티] — [#101494](https://github.com/anthropics/claude-code/issues/101494)
- 엔진 쪽 Esc 처리 변경: "Fixed Esc or an interrupt during a `UserPromptSubmit` hook or a mod's `prompt.submit` hook ending headless sessions…"(2.1.296) — Esc가 mod에 전달되는 기능은 아님 [공식: CHANGELOG] — [CHANGELOG](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)

3) effort 올리기/내리기 키 동작이 없음 → 일치 이슈 있음(open), 엔진에 "등록만 된 액션"이 있다는 보고
- #61904(open, 2026-05-23, 👍3): "The existing `modelPicker:increaseEffort` / `modelPicker:decreaseEffort` actions only fire inside the `ModelPicker` context"(기존 동작은 모델 선택 창 안에서만) [커뮤니티] — [#61904](https://github.com/anthropics/claude-code/issues/61904)
- 같은 이슈 2026-10-20 댓글(stepan-ogorodnikov): "I tested this on 2.1.304 and the bindings do nothing. `chat:increaseEffort` and `chat:decreaseEffort` are in the action registry, but no code handles them. … So a `Chat` binding is accepted and then ignored."(2.1.304에서 `chat:increaseEffort`/`chat:decreaseEffort`는 액션 목록에 있지만 처리 코드가 없어, 묶어도 무시됨) [커뮤니티] — [#61904](https://github.com/anthropics/claude-code/issues/61904)
- 같은 이슈 2026-10-08 댓글(HeesungB): Codex CLI에는 이미 있다 — "Actions `chat.increase_reasoning_effort` / `chat.decrease_reasoning_effort`, bound by default to `Shift+Up` / `Alt+.` and `Shift+Down` / `Alt+,`… The change applies to the current session and isn't saved as a default"(현재 세션에만 적용, 기본값으로 저장 안 함) [커뮤니티] — [#61904](https://github.com/anthropics/claude-code/issues/61904)
- 엔진이 추가한 건 슬라이더 안에서만 쓰는 동작이다 [공식: CHANGELOG 2.1.284 "Added `effortSlider:decreaseEffort`, `increaseEffort` and `toggleUltracode` keybinding actions, so the `/effort` slider's arrow and Tab keys can be rebound in `keybindings.json`"] — spec의 "키 동작에 effort 올리기/내리기가 없다"는 Chat 문맥 기준으로 맞고, 슬라이더 문맥에는 있다 — [CHANGELOG](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)
- #98935(open, 10-02): mod 쪽 우회와 비용. 우회 3단계: "1. A plugin registers one command per level (`/effort-low` … `/effort-max`) … 2. `keybindings.json` binds `ctrl+1`…`ctrl+5` to `command:effort-low` … 3. Each of those commands runs `/effort <level>` through `$.command.run`." 비용: "every key press leaves two rows in the transcript"(누를 때마다 대화에 두 줄이 남음), "A mod can't hide or restyle them: in my testing the rows don't go through `CommandOutput` or any other `ui.render` site"(이 줄은 어떤 ui.render 자리도 거치지 않아 mod가 숨길 수 없음) [커뮤니티] — [#98935](https://github.com/anthropics/claude-code/issues/98935)
- hubblerc는 `turn.step`에서 요청마다 effort를 바꿔 끼우므로 이 대화 기록 줄 문제를 피한다(spec F3). 단, 엔진 표시(스피너·statusLine)에 반영되는지는 spec에서 "확인할 것"으로 남아 있다.

4) /config에 effort 항목이 없음 → 두 이슈가 같은 관찰을 기록(open)
- #98935: "`/config` has no effort row either, so `$.config.set` isn't an option." [커뮤니티] — [#98935](https://github.com/anthropics/claude-code/issues/98935)
- #101797(open, 10-13, 2.1.296 Windows): "`$.config.list()`: has no effort row. A probe mod found only `thinking`, `model`, `outputStyle` and `switchModelsOnFlag` among the model-related rows." "`$.settings.read()`: returns the persisted `effortLevel` and `modelSettings`, not a level set with `/effort` during the session." 요청: `$.session.effort()`와 effort 변경 이벤트. 공유된 우회: "Cache `e.effort` from `turn.step`, skipping subagent steps (`agentId`)"(turn.step의 e.effort를 캐시, 서브에이전트 단계는 건너뜀) — 단점 "empty before the first request, stale after `/effort`"(첫 요청 전엔 비고 /effort 뒤엔 낡음) [커뮤니티] — [#101797](https://github.com/anthropics/claude-code/issues/101797)
- hubblerc F1 effort 칸이 엔진의 `/effort` 변경을 놓칠 수 있는 지점과 같다 [추론].

5) 엔진이 스스로 연 패널은 144칸 이상에서만 옆에 붙임 → 별도 이슈는 못 찾음. 같은 관찰은 있음. 그리고 폭 상한 변경
- lkangd(#91870 댓글, 10-21): "docks by itself from 144 columns, from 110 with `/chat-toc`."(스스로 열면 144칸, 명령으로 열면 110칸부터 옆에 붙음). 이 기준을 바꿔 달라는 요청은 없었다 [커뮤니티] — [댓글](https://github.com/anthropics/claude-code/issues/91870#issuecomment-6312070758)
- [공식: CHANGELOG 2.1.305 "Changed a mod's docked pane to stay within 45% of the terminal's width, including a width kept from a wider terminal"] — [CHANGELOG](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)
- #103959(open, 10-21, 👍3): "Since 2.1.306, a plugin pane docked beside the fullscreen transcript cannot be wider than `min(45% of the terminal, terminal - 60 columns)`. … The dock can be dragged narrower, never wider." "Up to 2.1.304, it could be dragged up to `terminal - 24 columns`." 요청: 끈 폭이 우선하거나 `pluginPanes.dockMaxShare` 설정·환경 변수·`$.ui.open`의 `maxColumns`. 작성자에 따르면 상수 `DOCK_MAX_SHARE = 0.45`가 하드코딩. 우회 없음 [커뮤니티] — [#103959](https://github.com/anthropics/claude-code/issues/103959)
- hubblerc는 2.1.308 기준이라 사이드바가 최대 45%로 묶인다. 사이드바가 좁은 쪽 정보(상태·변경 파일·목차)라서 큰 영향은 없을 것으로 본다 [추론].

6) `$.store` 4MB 한도 → 이슈 못 찾음
- "store limit OR 4MB OR quota plugin" 등으로 찾았으나 `$.store` 용량을 다룬 이슈는 없었다. #91870 댓글에서도 4MB는 파일 읽기 한도로만 나왔다. `$.store`에 대해서는 구조(플러그인마다 `~/.claude/plugins/store/` 아래 JSON 파일 하나, 기기 범위)와 여러 프로세스 동시 쓰기 경합이 지적됐다(frsorrentino 09-04, rbartoli 10-09) [커뮤니티] — [#91870](https://github.com/anthropics/claude-code/issues/91870). 관련: #101920(대화 기록 행에 시각 없음) — 시간을 `$.store`에 저장하려던 이유 자체를 없애는 요청 [커뮤니티] — [#101920](https://github.com/anthropics/claude-code/issues/101920)

7) 단일 ctrl 키를 입력창이 먼저 가져감 → 정확히 같은 이슈 못 찾음
- 비슷한 성격: #95957 "Ctrl+J / LF newline is hardcoded in the chat input, so unbinding ctrl+j in keybindings.json has no effect"(open, 09-22) [커뮤니티] — [#95957](https://github.com/anthropics/claude-code/issues/95957)
- 비라틴 입력 소스에서 Ctrl 단축키가 안 먹는 문제(아래 4절): #77386은 bcherny(Collaborator)가 2026-08-20 재현 확인 [공식] — [#77386](https://github.com/anthropics/claude-code/issues/77386). [추론] hubblerc의 `ctrl+q`/`ctrl+t` 실패가 이것 때문인지는 불확실하다. 같은 한글 상태에서 `ctrl+x ctrl+e`는 동작했으므로(spec), 입력 소스 문제라면 그것도 실패했어야 한다. 입력창 우선 처리라는 spec의 추정과 충돌하지 않는다.

8) 한글 입력기 조합 중 키 지연(`ctrl+x e`의 `e`가 `ㄷ`으로 붙잡힘) → 원인이 같은 mod 이슈 있음
- #102378(open, 10-15, macOS, 2.1.300): "a Pane Button's `hotkey` is matched against the **character the active input source produces**, not the key the user pressed."(Pane 버튼 단축키는 누른 키가 아니라 입력 소스가 만든 글자로 맞춰짐) "with the Korean input source on, the physical `a` / `d` / `r` keys produce `ㅁ` / `ㅇ` / `ㄱ`, and none of the Pane's hotkeys fire." 제안: kitty 프로토콜의 base-layout 키(flag 4)로 물리 키에 맞추기. 우회 없음(영문 입력으로 바꾸는 것뿐) [커뮤니티] — [#102378](https://github.com/anthropics/claude-code/issues/102378)
- hubblerc가 찾은 우회(두 키 모두 컨트롤인 조합 `ctrl+x ctrl+e`)는 이슈에서 공유된 걸 못 봤다 [추론: hubblerc 쪽 경험이 더 앞서 있음].

9) 턴 시간 표시 버그(백그라운드 서브에이전트 뒤 이전 질문 시작 시각부터 잼) → 공개 이슈 못 찾음
- "turn_duration", "turn duration wrong", "elapsed time wrong background subagent" 등으로 찾았으나 같은 증상 이슈는 없었다. 다른 원인의 수정만 있음 [공식: CHANGELOG 2.1.218 "Fixed rare negative or incorrect turn duration measurements after a system clock adjustment by timing turns with a monotonic clock"] — [CHANGELOG](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md). 사용자가 /feedback으로 보낸 것은 GitHub에 공개되지 않는다 [추론].

그 밖에 hubblerc의 확인 사실과 일치하는 이슈:
- 매처 없는 훅은 이벤트당 하나 → #101450(open, 문서 요청) — [#101450](https://github.com/anthropics/claude-code/issues/101450)
- atom은 그 파일 안에서 만들어야 함 → #101451(open, 문서 요청) — [#101451](https://github.com/anthropics/claude-code/issues/101451)
- `$.session.messages()`에 시간 없음 → #101920(open) — [#101920](https://github.com/anthropics/claude-code/issues/101920)
- 세션 시작 직후 한도 값이 비어 있음 → #91870 cstillm 댓글(10-21) — [#91870](https://github.com/anthropics/claude-code/issues/91870)
- 엔진이 도구 묶음 줄을 접어 쓰는 문구를 mod가 못 받음 → #102460(open) — [#102460](https://github.com/anthropics/claude-code/issues/102460)

### Inferences
- [추론] 9개 한계 중 같은 이슈가 있는 5개는 모두 2026-10 초·중순에 올라왔고 Anthropic 답이 없다. 공개 3~4주 차라 아직 분류 전일 수 있다. hubblerc가 보탤 수 있는 건 #61904·#98935(effort 키), #101494(Esc), #102378(한글 단축키)에 재현 정보를 붙이는 것.
- [추론] `chat:increaseEffort`/`chat:decreaseEffort`가 액션 목록에 이미 있다는 10-20 보고가 맞다면, 처리기만 붙으면 hubblerc의 `app:cycleDiffBase` 빌리기가 필요 없어질 수 있다. 버전 올릴 때마다 이 두 이름을 `keybindings.json`에 묶어 시험해 볼 만하다.

### Gaps
- 144칸 자동 배치 기준(댓글 관찰만 있음), `$.store` 4MB, 단일 ctrl 키 선점, 턴 시간 버그는 공개 이슈를 찾지 못했다(검색어를 바꿔 여러 번 시도).
- #61904의 10-20 보고(액션 등록만 됨)는 한 사용자의 관찰이고 공식 확인은 없다.

## 4. 한글/CJK 입력 관련 열린 버그

### Takeaway
열려 있는 큰 줄기는 세 가지다. ① IME 조합 자체의 지연·깨짐(#1547, 👍243, open, 고쳤다가 되돌린 뒤 재오픈), ② 비라틴 입력 소스에서 Ctrl 단축키가 안 맞는 문제(#77386, Anthropic이 재현 확인, iTerm2 경로는 #93113로 아직 열림), ③ mod 고유의 두 버그(#102378 Pane 단축키가 입력 소스를 따름, #101804 Orca에서 mod Client에 입력 중인데 조합 글자가 입력창에 그려짐). 한국어 macOS 사용자의 통합 이슈 #87869는 답 없이 stale 봇이 닫았다.

### Cited Findings

열린 것:
- #1547 "[BUG] IME input causes performance issues and duplicate conversion candidates" — 👍243 · open · 2025-06-04 · 라벨 `oncall`, `platform:macos`. 2026-02-06 cirospaciari(이슈를 닫고 다시 열 권한이 있는 계정, 페이지에 소속 배지는 확인 못 함)가 completed로 닫았다가 02-10 재오픈(수정이 되돌려져 다시 낼 예정이라는 설명). 핵심 증상 "When typing Japanese text using macOS default IME in Claude Code, the application becomes significantly slower and displays duplicate conversion candidates." 2026-03-26 댓글: "The 2.1.84 fix for cursor tracking works great in Ghostty and IME renders inline as expected."(2.1.84 커서 추적 수정 후 Ghostty에선 조합이 제자리에 그려짐), Zellij에선 여전히 문제 [재오픈자 소속 미확인 / 댓글은 커뮤니티] — [#1547](https://github.com/anthropics/claude-code/issues/1547)
- #77386 "Ctrl-based shortcuts don't fire with non-Latin (Cyrillic) keyboard layout: Kitty keyboard protocol reports layout-dependent codepoint" — open · 2026-07-14 · 라벨 `reproduced`. 원인 분석: "Claude Code … enables the **Kitty keyboard protocol** … In that mode the terminal reports the **layout-dependent Unicode codepoint** of the key"(kitty 프로토콜에서는 자판 배열에 따른 글자 코드가 옴). bcherny(Collaborator, 08-20): "shortcuts are matched against the layout-dependent codepoint only, and the alternate/base-layout key the protocol offers isn't consulted. Marking as a confirmed bug"(배열 의존 코드만 보고 기본 배열 키는 안 봄. 확인된 버그) [공식] — [#77386](https://github.com/anthropics/claude-code/issues/77386)
  - 이후 수정 [공식: CHANGELOG 2.1.247 "Fixed Ctrl keyboard shortcuts not firing under non-Latin (e.g. Cyrillic) keyboard layouts in kitty-protocol terminals"]. 하지만 iTerm2는 modifyOtherKeys 경로라 안 고쳐짐: #93113 "Ctrl+key bindings ignored under non-Latin layouts on iTerm2: Claude Code overrides its own kitty push with modifyOtherKeys" — open · 2026-09-09 · "Ghostty reports the base-layout key, and everything works"(Ghostty는 기본 배열 키를 보내서 됨) [커뮤니티] — [#93113](https://github.com/anthropics/claude-code/issues/93113), [CHANGELOG](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)
  - #77386 댓글(arbtsv, 09-15): 2.1.272부터 kitty 모드 활성화가 터미널 이름 목록에서 `CSI ? u` 질의 응답 기반으로 바뀌어, "VS Code/VS Codium's integrated terminal (xterm.js) … as of 2.1.272 it gets promoted into Kitty-protocol mode for the first time — and immediately inherits this bug."(xterm.js 기반 터미널이 처음 kitty 모드로 들어가며 이 버그를 물려받음) [커뮤니티] — [#77386](https://github.com/anthropics/claude-code/issues/77386)
- #102378 Pane 단축키가 입력 소스를 따름(위 3절) — open · 2026-10-15 — [#102378](https://github.com/anthropics/claude-code/issues/102378)
- #101804 "[BUG] Mods: hardware cursor stays at the prompt while a Client has key focus, so IME composition (Korean) is d[rawn in the prompt box]" — open · 2026-10-13 · 라벨 `has repro` · 환경 "Orca 1.4.220 (xterm.js)", macOS 27.0.1, Claude Code 2.1.290. "With Korean input, each syllable's in-progress text (`ㅇ`, then `아`, then `안`) appears in the prompt box. The `Client`'s `onKey` gets only the committed syllable."(조합 중 글자가 입력창에 그려지고 Client는 완성된 음절만 받음). "A mod can't fix this. `ClientSurface` has no way to declare a caret"(mod가 커서 위치를 선언할 방법이 없음) [커뮤니티] — [#101804](https://github.com/anthropics/claude-code/issues/101804)
- #100654 "[BUG] Mods: mouse events land to the right of the pointer while a mod Client listens to pointer events (Orca, xterm.js)" — open · 2026-10-09 · "Near column 170, the offset is about 7 columns."(170번째 칸 근처에서 약 7칸 밀림). 원인 분석: Orca가 분수 셀 폭(예 8.2)을 반올림해 보고. 표준 요소만 쓸 때는 정확 [커뮤니티] · hubblerc: 사용자 터미널이 Orca. 사이드바가 `Client`를 쓰지 않으면 영향 없음 — [#100654](https://github.com/anthropics/claude-code/issues/100654)
- #93281 "[BUG] Fullscreen TUI: Chinese IME input dropped/cleared, worse when mouse hovers near title bar" — open · 2026-09-10 · hubblerc: 전체 화면 모드 사용 — [#93281](https://github.com/anthropics/claude-code/issues/93281)
- #103346 "Japanese/CJK IME preedit renders at parked cursor (bottom-left) in the space/tab rename dialog" — open · 2026-10-19 — [#103346](https://github.com/anthropics/claude-code/issues/103346)
- #93497 "日本語IME入力時のプロンプトの遅延により、誤入力・文字欠落が頻発する"(일본어 IME 입력 시 프롬프트 지연으로 오입력·글자 누락) — open · 2026-09-11 — [#93497](https://github.com/anthropics/claude-code/issues/93497)
- #91205 "Bracketed-paste block followed by a key in the same chunk drops the pasted text (breaks CJK IME input…)" — open · 2026-09-01 — [#91205](https://github.com/anthropics/claude-code/issues/91205)
- #80814 "User messages selectively vanish from terminal display; assistant output sometimes duplicated (CJK input…)" — open · 2026-07-24 — [#80814](https://github.com/anthropics/claude-code/issues/80814)
- 입력과 별개(모델 출력): #83033 "Sonnet 5 writes Korean tool-call parameters as \uXXXX escapes and mis-spells the hex, corrupting Hangul" — 👍136 · open · 2026-08-01 · hubblerc: F4가 보여 주는 Bash `description`이 한국어일 때 깨질 수 있음(모델 문제) — [#83033](https://github.com/anthropics/claude-code/issues/83033)

stale 봇이 닫은 한국어 입력 이슈(답 없이 종료, 고쳐졌는지 불명):
- #87869 "[macOS] Korean (Hangul) IME composition is a daily usability blocker for CLI real-time typing — consolidating related reports" — closed not_planned · 2026-08-19 → 09-21(github-actions). 증상 목록 중 "Composition feels noticeably laggier than plain ASCII input"(조합이 영문 입력보다 눈에 띄게 느림), "Ctrl+C (SIGINT) doesn't register while Korean IME composition is active (see #81929)". 요청: "buffering keystrokes until composition commits"(조합이 끝날 때까지 키 입력을 모아 두기) 등 근본 처리. 환경 iTerm2, 2.1.235 [커뮤니티] — [#87869](https://github.com/anthropics/claude-code/issues/87869)
- #87792 "Korean IME broken again after update to 2.1.235 (regression of #35307)" — closed not_planned → 09-21; #81929 "Ctrl+C (SIGINT) does not work with Apple Korean IME in Claude Code on iTerm2/Ghostty" — closed not_planned → 10-02; #84395 "System-wide Korean IME breaks (jamo decomposition + U+3000 spaces in OTHER apps) while Claude Cod[e runs]" — closed not_planned → 10-05; #40291 "Korean IME: All Ctrl+key shortcuts silently ignored when Hangul input is active" — closed not_planned · 03-28 → 04-28; #34533 "Korean (한글) IME input delay / lag in CLI" — closed duplicate · 03-15 → 03-18 — [#87792](https://github.com/anthropics/claude-code/issues/87792), [#81929](https://github.com/anthropics/claude-code/issues/81929), [#84395](https://github.com/anthropics/claude-code/issues/84395), [#40291](https://github.com/anthropics/claude-code/issues/40291), [#34533](https://github.com/anthropics/claude-code/issues/34533)

고쳐진 것 [공식: CHANGELOG]:
- 2.1.84 "Fixed native terminal cursor not tracking the text input caret, so IME composition (CJK input) now renders inline"; 2.1.187 "Fixed pasted Korean/CJK text turning into mojibake…"; 2.1.247 비라틴 배열 Ctrl 단축키(kitty 터미널); 2.1.248 "Fixed @-mentions of other sessions not matching names typed with non-Latin characters (for example Korean entered through an IME)"; 2.1.282 "Fixed the terminal cursor jumping from the `/skills` search box … which could hide the caret and put IME input in the wrong place"; 2.1.290 "Fixed plugin hooks stalling each redraw when a mod draws a long multi-line text holding non-Latin characters"; 2.1.299 CJK·이모지 줄바꿈 두 건 — [CHANGELOG](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)
- 닫힘 completed: #83176 "Korean IME: Extra newline inserted when Shift+symbol input during composition"(08-01), #83067 "Korean IME: cursor fails to advance after each composed syllable"(08-01), #25186 조합 창 위치(03-24), #39067·#39073 한영키가 `[57358u` 출력(04-18) — [#83176](https://github.com/anthropics/claude-code/issues/83176), [#83067](https://github.com/anthropics/claude-code/issues/83067), [#25186](https://github.com/anthropics/claude-code/issues/25186), [#39073](https://github.com/anthropics/claude-code/issues/39073)

### Inferences
- [추론] hubblerc의 "`ctrl+x e`에서 `e`가 `ㄷ`으로 붙잡혀 다음 키에서야 넘어감"은 #87869가 요청한 "조합이 끝날 때까지 키를 모으기"의 반대 결과(조합 대기가 단축키 두 번째 키를 붙잡음)로, 엔진 IME 처리 문제와 같은 뿌리로 보인다. 두 키 모두 컨트롤인 조합이 IME를 거치지 않는다는 hubblerc의 해법이 현재로선 가장 확실하다.
- [추론] Orca는 xterm.js 기반이고(#101804, #100654), 2.1.272부터 xterm.js 터미널이 kitty 모드로 들어간다는 보고(#77386 댓글)가 있다. Orca + 한글 입력에서 Ctrl 단축키가 배열 의존 코드로 오는지는 확인하지 못했다. `ctrl+x ctrl+e`가 한글 상태에서 동작했다는 hubblerc 관찰로 보아, 적어도 이 조합은 영향이 없다.

### Gaps
- Orca에서의 kitty 프로토콜 활성 여부와 base-layout 키 보고 여부는 이슈에서 찾지 못했다.
- #1547의 재오픈 이후 수정이 다시 나갔는지 CHANGELOG에서 명시적 항목을 찾지 못했다.

## 5. 이슈에서 드러나는 "터미널에서 원하는 것" 중 mod로 풀 수 있어 보이는 것 [추론]

### Takeaway
[추론] 데이터 접근 API가 이미 있는 것(도구 행 다시 그리기, 대화 기록, 사용량)으로 풀리는 요청이 꽤 있다: Read 대상 파일 표시(#21151), 인라인 diff 숨기기(#37951), 메시지·답변 시각(#44763), 이전 프롬프트로 이동(#70678·#93973), 세션 변경만 보는 diff(#18541·#92189), 자동 압축 경고(#7502), 동반 캐릭터(#45596). 반대로 렌더러 버그, 키 이벤트, 입력 소스, 패널 폭은 엔진이 바뀌어야 한다.

### Cited Findings
- 근거가 되는 요청(위 1·2절): #21151 👍186 open — [#21151](https://github.com/anthropics/claude-code/issues/21151); #37951 👍110 open — [#37951](https://github.com/anthropics/claude-code/issues/37951); #44763 👍96 open — [#44763](https://github.com/anthropics/claude-code/issues/44763); #70678 👍18 open — [#70678](https://github.com/anthropics/claude-code/issues/70678); #93973 open — [#93973](https://github.com/anthropics/claude-code/issues/93973); #18541 👍19 open — [#18541](https://github.com/anthropics/claude-code/issues/18541); #7502 👍39 open — [#7502](https://github.com/anthropics/claude-code/issues/7502); #45596 👍1195 open — [#45596](https://github.com/anthropics/claude-code/issues/45596); #43326 👍77 open — [#43326](https://github.com/anthropics/claude-code/issues/43326); #11008 👍34 open — [#11008](https://github.com/anthropics/claude-code/issues/11008)
- mod 쪽에서 이미 같은 것을 만든 흔적: #101797 작성자의 상태줄 mod("Every other segment matches the native status line except effort"), #101797에 연결된 커밋 "footer-info 0.2.0: draw the line at the right of the prompt footer"(cppmyjob/claude-mods) [커뮤니티] — [#101797](https://github.com/anthropics/claude-code/issues/101797); #93973의 프롬프트 미니맵 구상 — [#93973](https://github.com/anthropics/claude-code/issues/93973)

### Inferences
- [추론] hubblerc 기능별로 이슈가 뒷받침하는 정도:
  - F1 상태 밴드: statusLine 확장 요청(#13585, #73770)과 effort 노출(#101797). 단 첫 답변 전 한도 값이 빔(cstillm 댓글), `/effort` 변경을 즉시 못 앎(#101797)이라는 데이터 한계가 있다.
  - F2 목차: #70678·#63901·#93973이 같은 요구. 엔진 기본 기능으로 아직 없다(#70678 open).
  - F2 변경 파일: #18541·#92189(서브에이전트 diff)가 엔진 diff 패널의 빈자리를 지적. hubblerc가 이미 메움.
  - F3 auto effort: #43326(👍77). 설정 파일 방식은 실행 중 세션에 안 먹는다는 댓글이 있어, `turn.step` 방식의 장점이 분명하다.
  - F4 Bash 용도: 직접 요청 이슈는 못 찾았지만 #21151(Read 파일 표시, 👍186)이 같은 종류의 "접힌 도구 행에 무엇을 했는지 보여 달라"는 요구다. 같은 ToolGroup 다시 그리기로 Read 파일 이름도 붙일 수 있다.
  - F5 시간: #44763(👍96)·#30745(👍34). 엔진 턴 끝 줄에 완료 시각이 생겼으므로(2.1.246), 차별점은 답변별 시각을 목차·`/activity`에 보여 주는 것.
- [추론] 새 아이디어 후보:
  - Read 대상 파일 이름을 ToolGroup 줄에 붙이기(#21151). F4와 같은 경로.
  - 인라인 diff 접기/요약 전환(#37951). F5 요약 줄과 결합.
  - 자동 압축 경고: #7502(open)가 수요를 보여 주지만, `session.compact` 훅이 2.1.299에서 안 불린다는 버그(#102134)가 있어 사용량 % 기준으로 만드는 편이 안전.
  - 동반 캐릭터(buddy): #45596이 저장소 전체 3위(👍1195). 밴드나 사이드바 구석에 작은 캐릭터를 두는 건 "꾸미기" 목적과 맞다. 원래 기능을 흉내 낼 때 이름·이미지 권리 문제는 따로 봐야 한다.
  - 한도 소진 예측: #104967(요청별 한도 사용량) 요청이 있다는 건 지금 API로는 창 합계만 온다는 뜻. 시간에 따른 % 변화로 추정하는 방식이 현실적. 이미 quota-meter(Arunjay4213)가 "a burn-rate projection, sampled after every turn and on a `$.clock.every` tick"(턴마다·타이머로 표본을 모아 소진 속도 예측)으로 같은 방식을 쓴다고 적었다 — [#91870 댓글](https://github.com/anthropics/claude-code/issues/91870#issuecomment-5669755348).
  - 압축까지 남은 턴: context-lens(같은 작성자)가 "turns left before compaction"을 보여 준다고 적었다. 후보 "자동 압축 직전 경고"의 표시 방식 참고 — [#91870 댓글](https://github.com/anthropics/claude-code/issues/91870#issuecomment-5669755348).
- [추론] mod로 못 푸는 것: 스크롤·깜빡임·복사(#826, #769, #18170, #81472), Esc·방향키 전달(#101494, #99502), 입력 소스 독립 단축키(#102378), 패널 폭 상한(#103959), 밴드 공유 체인(#100789), 슬래시 명령 출력 행 숨기기(#98935).

### Gaps
- "Bash 명령 대신 용도 표시"(F4)를 직접 요청한 이슈는 찾지 못했다.
- 각 아이디어의 실제 구현 가능성은 공식 mod 문서 확인이 필요하다(다른 조사자 영역).

## 6. Anthropic이 답했거나 고친 것 정리

### Takeaway
이슈 댓글로 직접 답한 Anthropic 쪽 사람은 이번 범위에서 poteat(#91870)과 bcherny(#77386 재현 확인, #9177 출시 안내) 정도다. 9월 이후 생긴 이슈에 bcherny가 단 댓글은 검색상 0건이고, mod 관련 터미널 요청 대부분은 답이 없다. 대신 CHANGELOG로 꾸준히 고친다.

### Cited Findings
- 검색 `commenter:bcherny created:>2026-09-01` 결과 0건, `commenter:poteat` 결과는 #91870 1건(2026-10-26 조회) [검색 결과] — [#91870](https://github.com/anthropics/claude-code/issues/91870)
- poteat은 #91870에만 35개 댓글을 달았고, 그중 공개 후(10-01 이후)는 10-01·10-02·10-20 세 개다. 키 바인딩 등록(09-26, 09-28)·Esc(09-17) 요청에는 답하지 않았다 [공식: 댓글 작성자 집계] — [#91870](https://github.com/anthropics/claude-code/issues/91870)
- 답한 것: #91870 poteat 갱신·댓글(위 2절) [공식]; #77386 bcherny 재현 확인(08-20) [공식]; #9177 bcherny 종료 댓글(08-17) [공식]; #1547 cirospaciari 재오픈(02-10, 수정 되돌림 설명, 소속 배지 미확인) — [#91870](https://github.com/anthropics/claude-code/issues/91870), [#77386](https://github.com/anthropics/claude-code/issues/77386), [#9177](https://github.com/anthropics/claude-code/issues/9177), [#1547](https://github.com/anthropics/claude-code/issues/1547)
- 고친 것(터미널 UX, CHANGELOG): statusLine context %(2.1.6), rate_limits(2.1.80), refreshInterval(2.1.97), effort.level(2.1.119), `/tui fullscreen`(2.1.110), 턴 끝 완료 시각(2.1.246), 시간 형식(2.1.257), `/effort`의 `s`(세션 한정, 2.1.257), diff 패널(2.1.260), MCP 끊김 알림(2.1.273), 슬라이더 effort 키 동작(2.1.284), `$.ui.notify`(2.1.295), 패널 45% 상한(2.1.305, 변경) [공식] — [CHANGELOG](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)
- 답이 없는 hubblerc 관련 이슈: #61904, #98935, #101494, #101797, #102378, #101804, #103959, #104670, #100789(모두 open, 직원 댓글 없음, 2026-10-26 페이지 확인) [커뮤니티]

### Inferences
- [추론] effort 키 요청은 stale 봇에 여러 번 닫혀 공식 판단이 한 번도 없었다. 2.1.284에서 슬라이더 안 동작만 추가한 것을 보면 Anthropic도 키 문제를 알고 있지만 Chat 문맥 동작은 아직 우선순위 밖으로 보인다.

### Gaps
- Anthropic 직원 계정 목록을 확인할 방법이 없어 Collaborator 배지와 이슈 작성자 정보로만 판단했다.
