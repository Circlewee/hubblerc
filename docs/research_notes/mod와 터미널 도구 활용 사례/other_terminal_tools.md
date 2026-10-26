# 다른 AI 코딩 CLI와 터미널 도구의 생산성·사용성 기능 (hubblerc에 옮길 아이디어)

- 기준일: 2026-10-26. hubblerc 기준은 Claude Code 2.1.308 mod API.
- 조사 방식: 공식 문서·변경 기록·공식 블로그를 먼저 봤다. 조사는 세 묶음으로 나눠 병렬로 했다(① Codex·Gemini/Antigravity·Copilot·Cursor ② OpenCode·Amp·Crush·Aider·Goose·Kiro ③ 터미널·멀티플렉서·IME). Orca와 OSC 7501은 직접 조사했다. 핵심 주장 중 Copilot 변경 기록, Antigravity 상태줄 문서, Amp 사이드바 제거 글, Kiro 터미널 UI 문서, iTerm2 3.7 릴리스 노트, Orca 문서·릴리스는 원문을 다시 열어 확인했다. 나머지는 조사자가 읽은 원문 요약에 기댄다.
- 표기: [공식] 제품 공식 문서·변경 기록·공식 블로그 / [커뮤니티] 서드파티 글·미러·포럼·집계 사이트 / [추론] 내 판단 / [타입 확인] 로컬 mod 타입 정의(`plugins/hubblerc/.claude-plugin/types/claude-code/index.d.ts`, 2.1.308)에서 확인.
- 인용은 웹 페이지 요약기가 뽑아 준 원문 발췌라 앞뒤가 잘렸을 수 있다.
- 어떤 도구도 설치·실행하지 않았다.
- 다른 조사자 영역(Claude Code mod 자체, Claude Code용 statusLine·hooks 부가 도구, Reddit/HN, anthropics/claude-code 이슈, 한국 커뮤니티)은 필요한 만큼만 언급했다.

---

## 1. 주요 AI 코딩 CLI는 상태·effort·진행·변경·되감기·알림·확장을 어떻게 다루나 (2026년 기준)

### Takeaway
2026년의 주요 CLI는 거의 같은 방향으로 수렴했다. ① 설정 가능한 상태줄과 사용 한도 표시, ② 세션 범위 모델·effort 전환, ③ 턴 단위 diff와 되감기·포크, ④ 포커스를 감지하는 완료 알림, ⑤ 기존 표시를 덮지 않고 덧붙이는 확장 슬롯. hubblerc에 가장 직접 쓸 만한 출처는 세 곳이다.
- **Copilot CLI 변경 기록**: 좁은 폭에서 상태줄을 여러 줄로 쌓기, 한도 50%·95% 경고, 한도에 걸리면 Auto 모델로 자동 전환, 세션 +/− 토글
- **Antigravity CLI 상태줄 JSON**: `reset_in_seconds`, 추정 비용, `agent_state`, `terminal_width`, 갱신 스로틀
- **Kiro CLI**: 승인 대기 중 타이머 멈춤, OSC 7501로 탭에 상태 보고

effort를 프롬프트마다 자동으로 고르는 기능은 조사한 도구 어디에도 없었다. 모델 단위 자동 라우팅("Auto")만 있었다.

### Cited Findings

#### 1-1. OpenAI Codex CLI (0.164.0, 2026-10-23)
- 개요: 오픈소스(Rust). 공식 문서는 developers.openai.com/codex에서 learn.chatgpt.com/docs로 옮겨졌다(308 리다이렉트) [공식] — [Codex changelog](https://learn.chatgpt.com/docs/changelog). 0.165.0-alpha.1은 2026-10-23에 나왔다 [공식] — [releases.atom](https://github.com/openai/codex/releases.atom)

| 차원 | 내용 | 출처 |
|---|---|---|
| 상태줄 | `tui.status_line`은 순서 있는 배열이고 `null`이면 끈다. `/statusline`으로 대화형으로 편집한다. 고를 수 있는 항목: 모델, reasoning, 컨텍스트 통계, rate limits, git 브랜치, 토큰 카운터, 세션 ID, cwd, 버전. 사용자 스크립트(command) 방식은 없고, 정해진 항목만 고른다 | [공식] [config reference](https://learn.chatgpt.com/docs/config-file/config-reference) (접속 2026-10-26), [developer commands](https://learn.chatgpt.com/docs/developer-commands.md?surface=cli) / 스크립트 요청은 [커뮤니티] [#17827 미러](https://upd.dev/openai/codex/issues/17827) |
| 레이아웃 프리셋 | 0.164.0: "Add quick dial presets for terminal title and status line layouts"(터미널 제목·상태줄 배치 빠른 프리셋). `/title`·`/statusline`에 이번 세션에만 적용하는 인자가 생겼다 | [공식] [changelog](https://learn.chatgpt.com/docs/changelog) (2026-10-23) |
| 터미널 제목 | `tui.terminal_title` 기본값 `["spinner","project"]`. `/title`로 앱 이름·상태·스레드·브랜치·모델·task progress를 고른다 | [공식] config reference |
| 모델·effort | `/model`에서 모델과 reasoning effort를 고르고, 0.164.0부터 인자로 바로 지정한다. Plan 모드 전용 값 `plan_mode_reasoning_effort`가 있다 | [공식] config reference, changelog |
| 진행·백그라운드 | `/ps`는 백그라운드 터미널마다 최근 출력 3줄을 보여 준다. `/agents`는 "agent command center"이고, 0.162.0부터 `p`로 작업을 고정한다 | [공식] developer commands, changelog 0.162.0 (2026-10-08) |
| 에이전트 대시보드 | v0.149.0에서 전체 화면 agents 대시보드(Alt+A)가 생겼다 | [커뮤니티] [Daniel Vaughan 블로그](https://codex.danielvaughan.com/2026/08/21/codex-agents-dashboard-interactive-task-management-v0149-subagent-monitoring-tui/) (2026-08-21) |
| diff·리뷰 | `/diff`는 미추적 파일까지 포함한 git diff, `/review`는 작업 트리 리뷰 | [공식] developer commands |
| 되감기·포크 | `/fork`, `/side`(=`/btw`) 임시 곁가지 대화, `/resume`, `/recap`. "Press Escape twice with an empty composer to edit the previous user message and fork the chat from that point."(입력창이 비었을 때 Esc 두 번이면 이전 메시지를 고쳐 그 지점에서 포크) | [공식] developer commands |
| 자동 요약 | `tui.auto_recap`: "Generate automatic conversation recaps while the terminal is unfocused (default: true)."(터미널이 포커스를 잃은 동안 대화 요약 자동 생성, 기본 켜짐) | [공식] config reference |
| 알림 | `tui.notification_method` auto/osc9/bel, `tui.notification_condition` unfocused/always. 외부 `notify` 명령에 JSON을 넘긴다 | [공식] config reference |
| 화면 | `tui.alternate_screen` auto/always/never(Zellij 안에서는 auto가 alt screen을 생략), `/raw` 스크롤백 모드 | [공식] config reference |
| 키 바인딩 | `tui.keymap.<context>.<action>`, 빈 배열이면 해제, `/keymap`. 0.163.0부터 leader 키를 설정할 수 있고 기본은 Ctrl+X | [공식] config reference, changelog 0.163.0 (2026-10-15) |
| 테마·확장 | `/theme`, `.tmTheme` 사용자 테마. hooks(PreToolUse·Stop·SessionStart…), 0.164에서 "observation-only model request lifecycle hooks"(관찰 전용 모델 요청 훅). `/import`로 Claude Code·Cursor 설정과 대화를 가져온다 | [공식] changelog |

#### 1-2. Gemini CLI → Antigravity CLI (`agy`)
- 이름 변경: Google은 2026-05-19에 Gemini CLI를 Antigravity CLI로 옮긴다고 발표했다. 2026-06-18부터 Google AI Pro/Ultra·무료 개인 사용자 요청은 처리하지 않는다. Standard/Enterprise 라이선스와 유료 API 키 사용자는 계속 쓸 수 있다 [공식] — [Google Developers Blog](https://developers.googleblog.com/en/an-important-update-transitioning-gemini-cli-to-antigravity-cli/) (2026-05-19). README: "Gemini CLI was replaced by Antigravity CLI on June 18th, 2026" [공식] — [gemini-cli README](https://github.com/google-gemini/gemini-cli) (접속 2026-10-26)
- 발표문 인용: "While there won't be 1:1 feature parity right out of the gate"(처음부터 1:1 기능 대응은 아니다) [공식] — 같은 블로그
- Antigravity CLI는 Go로 작성됐고 데스크톱 Antigravity 2.0과 같은 agent harness를 쓴다. "closed-source"라는 비판 기사가 있다 [커뮤니티] — [dealroom 뉴스](https://eit.dealroom.co/news/feed/google-kills-open-source-gemini-cli-replaces-it-with-closed-antigravity-tool)

| 차원 | 내용 | 출처 |
|---|---|---|
| 상태줄 | 기본 상태줄이 있다. `statusLine` command를 주면 stdin JSON → stdout(여러 줄·ANSI 가능). `stack_with_default`: "When true, shows your status line below the built-in one instead of replacing it."(켜면 기본 줄을 대체하지 않고 그 아래에 덧붙임) | [공식] [agy statusline 문서](https://antigravity.google/docs/cli/statusline/) (날짜 표기 없음, 접속 2026-10-26, 원문 재확인) |
| 상태줄 JSON | `context_window`(total_input/output_tokens, context_window_size, 사용·남은 %), `model.effort`("low through max"), `quota.<bucket>`의 `reset_time`·`reset_in_seconds`·`disabled`, `cost`("These are estimates based on list prices, not billed amounts" 정가 기준 추정, 청구액 아님), `agent_state`("idle, working, tool_use, reviewing, authenticating, initializing, or error"), `subagents`(name·role·status), `task_count`("Number of running background tasks (omitted when 0)"), `terminal_width`("Live width of the interactive terminal") | [공식] 같은 문서 |
| 갱신 규칙 | "runs your script at most once every 300 ms"(최대 300ms에 1번), "stops any run that takes longer than 5 seconds"(5초 넘으면 중단), "After 30 failed runs in a row, it stops running the script for the rest of the session"(30번 연속 실패하면 세션 내내 끔) | [공식] 같은 문서 |
| 모델·effort | `/model`, `/effort`, `/usage`, `/credits`, `/context`. `--model`은 이번 세션에만 적용 | [공식] [slash commands](https://antigravity.google/docs/slash-commands/), [settings](https://antigravity.google/docs/settings?tab=cli) |
| 진행 | 백그라운드 에이전트, `/btw` 곁질문, `/goal`, `/schedule`. `verbosity: low`면 도구 활동을 "token usage summary"로 접는다 | [공식] 같은 문서들 |
| 되감기·세션 | `/rewind`=`/undo`(대화 기록만 되돌린다고 적혀 있음), `/fork`, `/resume`. 종료할 때 다시 여는 정확한 명령을 출력한다 | [공식] [using](https://antigravity.google/docs/cli/using/) |
| 알림 | `notifications` 기본 꺼짐. 켜면 승인·질문·턴 종료 때 bell과 데스크톱 알림 | [공식] settings |
| 화면·키·테마 | `altScreenMode` 기본 inline(always/never). `keybindings.json`으로 "customize almost all keyboard shortcuts"(거의 모든 단축키 변경), `[]`이면 해제. `colorScheme`: terminal / light / dark / solarized / colorblind-friendly / tokyo night | [공식] settings |
| 구 Gemini CLI (참고) | `ui.footer.items` 순서 지정, `ui.footer.showLabels`(항목 위에 "/model" 같은 머리글 줄), `hideContextPercentage` 기본 true, `general.notificationMethod` auto/osc9/osc777/bell | [공식] [geminicli.com configuration](https://geminicli.com/docs/reference/configuration/) (접속 2026-10-26) |

#### 1-3. GitHub Copilot CLI (1.0.103, 2026-10-22, GA 2026-02-25)
변경 기록 원문은 직접 확인했다 [공식] — [changelog.md](https://raw.githubusercontent.com/github/copilot-cli/main/changelog.md). 아래 날짜는 모두 이 변경 기록 기준이다.

| 차원 | 내용 (버전·날짜) |
|---|---|
| 상태줄 | 0.0.413(02-20) "configurable status line support … via custom shell scripts"(셸 스크립트 상태줄). 1.0.30(04-16) `/statusline`(=`/footer`)로 항목 토글. 1.0.35(04-23) "Context window indicator in the statusline is now hidden by default"(컨텍스트 표시 기본 숨김). 1.0.36(04-24) "Add a 'changes' statusline toggle to show added/removed line counts for the session"(세션 +/− 줄 수 토글). 1.0.65(06-24) 사용자 상태줄 명령을 `/settings`에 저장 |
| 좁은 폭 | 0.0.416(02-24) "Status line automatically switches to a two-line layout on narrow terminals"(좁으면 두 줄 배치로 자동 전환). 1.0.60(06-05) "Status line progressively stacks across rows at narrow terminal widths instead of truncating elements beyond recognition"(알아볼 수 없게 자르는 대신 여러 줄로 점점 쌓음). 0.0.398 경로는 가운데 생략(middle-truncation) |
| 컨텍스트 % | 1.0.4(03-11) "Status line context window percentage no longer inflates across turns"(턴이 쌓여도 %가 부풀지 않게 고침). 누적값 대신 마지막 호출 토큰을 쓴다. 0.0.334: 남은 컨텍스트 20% 이하 경고 |
| 한도 | 1.0.33(04-20) "Show usage limit warnings at 50% and 95% capacity, giving earlier notice before hitting rate limits"(한도 50%·95%에서 경고). 1.0.35(04-23) "continueOnAutoMode … automatically switch to auto model on rate limit instead of pausing"(한도에 걸리면 멈추지 않고 Auto 모델로 전환). 1.0.52(05-23) "/usage shows quota progress bars for session and weekly limits" |
| 모델·effort | 1.0.72(07-20) "Add /model --session (-s) to change the model, reasoning effort, or context window for just the current session"(이번 세션에만 모델·effort·컨텍스트 창 변경). 1.0.69 footer에 effort 라벨 |
| 진행 | 1.0.87(09-21) "Show live elapsed time for execution subagents in timeline entries"(서브에이전트 경과 시간 실시간 표시). 도구 호출 시간 실시간 표시 [공식] — [GitHub changelog 2026-08-07](https://github.blog/changelog/2026-08-07-github-copilot-weekly-releases-august-3) |
| 목표 고정 | 1.0.79(08-10) 프롬프트 고정: "Prompt pinning is off by default; set pinnedPrompts to true"(기본 꺼짐, `pinnedPrompts`로 켬). 1.0.81 Autopilot 패널에 마지막 프롬프트를 "inferred objective"(추정 목표)로 표시하고, 짧은 터미널에서는 한 줄로 접는다 |
| 세션 사이드바 | 1.0.76(07-29) "New Sessions sidebar for managing multiple concurrent sessions"(여러 세션을 관리하는 사이드바, 실험 기능). 좁으면 맞지 않는 키 힌트를 뺀다(1.0.90) |
| diff·되감기 | `/diff` 세션 변경(줄 코멘트, 파일 트리 사이드바 1.0.62). GA 글: "Press Esc–Esc to rewind file changes to any previous snapshot in the session."(Esc 두 번으로 세션 안 이전 스냅샷까지 파일 되감기) [공식] — [GA 공지](https://github.blog/changelog/2026-02-25-github-copilot-cli-is-now-generally-available/) (2026-02-25). `/rewind`에서 대화만 / 대화+파일을 고른다(1.0.78) |
| 기록 보고 | `/chronicle` standup·search·cost-tips. standup은 기본 최근 24시간 세션으로 보고서를 만든다 [공식] — [docs.github.com chronicle](https://docs.github.com/en/copilot/how-tos/copilot-cli/use-copilot-cli/chronicle) |
| 알림·진행률 | 0.0.400(01-30) "Show progress indicator in terminal tab when thinking"(생각 중 탭에 진행 표시). 1.0.51(05-20) `terminalProgress`로 OSC 9;4 켜고 끄기. 1.0.88(09-22) "optional OSC 777 terminal notifications for direct Ghostty and WezTerm sessions" |

#### 1-4. Cursor CLI (`agent`, 별칭 `cursor-agent`, v2026.10.22)
- 2026-01-08부터 진입점이 `agent`가 됐다 [공식] — [Cursor 포럼 공지](https://forum.cursor.com/t/cursor-cli-jan-8-2026-new-commands-and-performance-improvement/148372). 아래 출처는 별도 표시가 없으면 [공식] [Cursor CLI changelog](https://cursor.com/docs/cli/changelog)(접속 2026-10-26)다.

| 차원 | 내용 |
|---|---|
| 프롬프트 위 고정 | v2026.06.09 "Working status, token counts, and hints stay pinned above the prompt"(작업 상태·토큰 수·힌트를 프롬프트 위에 고정) — hubblerc F1 밴드와 같은 자리 |
| 상태줄 | 2026-04 사용자 `statusLine` command를 footer에 그린다. `display.showStatusLineRunningTime`으로 경과 시간 [공식] [configuration](https://cursor.com/docs/cli/reference/configuration). 사용자 statusLine이 기본 footer를 **대체**해서 모델·Auto-review·브랜치가 사라진다는 버그 보고 [커뮤니티] [포럼](https://forum.cursor.com/t/cursor-cli-custom-statusline-replaces-native-footer-and-cannot-preserve-auto-review-state/166364) (v2026.07.20) |
| 한도·모델 | `/usage`에 플랜 미터·청구 리셋일(07-13). 신규 설치는 Auto 모델이 기본. "Changing Fast, effort, or context in `/model` keeps your other compatible choices"(06-29) |
| 진행 | 병렬 서브에이전트 실시간 상태, 서브에이전트별 토큰 수, 백그라운드 작업 뷰어(06-09) |
| diff·되감기 | `/changes`(Ctrl+R) 이번 세션 수정. "`/rewind` offers an interactive timeline with per-turn file diffs."(턴별 파일 diff가 붙은 대화형 타임라인, 2026-04, 06-22부터 기본 켜짐) |
| 알림 | 2026-04 "Desktop alerts when a turn finishes or the agent needs you, with focus-aware muting"(턴 종료·사용자 필요 시 알림, 포커스 중이면 음소거) |
| 기타 | v2026.08.11 "Mode-switch approvals show a 15-second countdown and auto-reject when unattended"(모드 전환 승인에 15초 카운트다운, 응답 없으면 거부). 터미널 라이트/다크 전환 시 다시 그림(05-07) |

#### 1-5. OpenCode (v2.1.4, 2026-10-23)
- `github.com/sst/opencode`가 `anomalyco/opencode`로 표시된다(별 약 221.5k) [공식] — [GitHub](https://github.com/sst/opencode). 옮긴 날짜와 이유는 못 찾았다. 1.0에서 TUI를 Go+bubbletea에서 자체 OpenTUI(zig+solidjs)로 다시 썼다 [공식 릴리스 노트] — [newreleases v1.0.0](https://newreleases.io/project/github/sst/opencode/release/v1.0.0). 지금은 v2 계열이다(brew `opencode-v2`) [공식] — [v2 docs](https://opencode.ai/v2/docs)

| 차원 | 내용 | 출처 |
|---|---|---|
| 키 | leader `ctrl+x`, `leader_timeout` 2000ms. `sidebar_toggle` `<leader>b`. `variant_cycle` `ctrl+t`(모델 variant = 추론 강도 순환), `model_cycle_recent` `f2`. 서브에이전트 세션 이동 `session_child_cycle` 등 | [공식] [keybinds](https://opencode.ai/docs/keybinds) (2026-10-24) |
| 사이드바 폭 | "Auto-shows session list on wide screens (>120 columns)" / "Auto-hides on narrow screens"(120열 넘으면 자동 표시, 좁으면 숨김) | [커뮤니티] [learnopencode](https://learnopencode.com/en/2-daily/01-interface) (날짜 없음) |
| 사이드바 할 일 | v2.1.0 "Added todo lists to session output, compact cards, and the sidebar when experimental todo support is enabled." | [공식] [changelog](https://opencode.ai/changelog) (2026-10-20) |
| undo | `/undo`: "Removes the most recent user message, all subsequent responses, and any file changes."(마지막 사용자 메시지·뒤 응답·파일 변경까지 되돌림). Git 저장소여야 한다. `/redo`, `session_timeline` `<leader>g` | [공식] [tui](https://opencode.ai/docs/tui/) (2026-10-24) |
| diff | `diff_style: "auto"`는 터미널 폭에 따라 나란히/위아래를 바꾼다. 최근 AI 턴의 변경을 따로 본다는 서술은 [커뮤니티] | [공식] tui / [커뮤니티] learnopencode |
| 알림·소리 | 데스크톱 알림은 "non-subagent events"에 대해 "when the terminal is blurred"일 때만. 이벤트별 소리 `default/question/permission/error/done/subagent_done` | [공식] tui |
| 테마 | `system` 테마는 "Adapts to your terminal's background color". ANSI 0–15와 `none`을 써서 터미널 색을 살린다 | [공식] [themes](https://opencode.ai/docs/themes/) |
| TUI 플러그인 v2 | 슬롯 `home.footer(.status)`, `prompt.footer(.status/.file)`, `session.composer.top`, `sidebar.content`, `sidebar.footer`, `session.panel`. prepend/append/replace로 배치. `keymap.layer`(키·커맨드 등록), `ui.toast.show`, `attention.notify`, `storage.store`("persists JSON across restarts and syncs across TUI instances") | [공식] [v2 plugins](https://opencode.ai/v2/docs/build/plugins/cli) |
| 서버 플러그인 이벤트 | `session.idle`, `session.diff`, `session.status`, `todo.updated`, `tool.execute.before/after`, `permission.asked`, `experimental.session.compacting` | [공식] [plugins](https://opencode.ai/docs/plugins/) |

#### 1-6. Amp (Amp, Inc.)
- 2025-12에 Sourcegraph에서 분리됐다 [공식] — [Amp Inc.](https://ampcode.com/news/amp-inc). CLI를 새로 만들었고("Amp, Rebuilt", 2026-05-06), 공개 스레드 공유를 끝냈다(2026-06-02) [공식] — [news](https://ampcode.com/news)
- **TUI 사이드바 제거(2026-08-27)**: "Adding our own layer of multi-environment multiplexing on top proved to be a less-than-optimal user experience."(우리 쪽 다중 환경 다중화 층을 얹는 건 좋은 경험이 아니었다). 터미널은 "already comes with its own very powerful multiplexing functionality, complete with tabs, panes, and more"(탭·패인을 갖춘 강력한 다중화가 이미 있다). 스레드 관리는 네이티브·웹 앱의 사이드바로 옮겼다 [공식] — [So Long, TUI Sidebar](https://ampcode.com/news/so-long-tui-sidebar) (원문 재확인)
- **The Dial(2026-07-09)**: smart/deep/rush/large 모드를 `low/medium/high/ultra` 네 단계로 바꿨다. "The old modes were models in disguise: each name hid a model, a prompt, a reasoning effort."(예전 모드는 이름 뒤에 모델·프롬프트·추론 강도를 숨긴 것이었다) [공식] — [The Dial 소식](https://ampcode.com/news/the-dial). "Amp chooses the model, reasoning effort, system prompt, and tools for each mode."(단계마다 모델·effort·프롬프트·도구를 정함). 첫 메시지 전에 Ctrl+S로 바꾸고, "You cannot change the mode later in that thread."(그 스레드에서는 나중에 못 바꿈). 자동 선택은 없다 [공식] — [Dial 문서](https://ampcode.com/docs/the-dial). 2026-09-10부터 단계 뒤의 모델을 사용자가 고를 수 있다 [공식] — news
- 키: Ctrl+O 명령 팔레트, `amp.keymap`, `<leader>` 기본 Ctrl+X. Enter의 기본 동작은 "steer"(실행 중인 스텝 뒤에 끼워 넣음) [공식] — [keybindings](https://ampcode.com/docs/cli/keybindings)
- 비용: 스레드 메뉴에 "what the thread has cost so far". "Explain Usage"(2026-08-21)는 토큰이 어디에 쓰였는지 설명한다 [공식] — [threads](https://ampcode.com/docs/threads), news
- 플러그인(TS/JS): `session.start`, `agent.start`, `tool.call`(allow/reject/modify/synthesize), `tool.result`, `agent.end`. `ctx.ui.notify/confirm/input/select`. `amp.experimental?.createStatusItem()` → `update({text,url})`는 CLI 상태줄에 표시된다. 작은 모델 판정 API `amp.ai.ask/decide/choice/score`가 있다. 예제로 "Turn Stats"(실시간 상태 항목 + 상세 커맨드) [공식] — [plugins](https://ampcode.com/docs/customize/plugins)

#### 1-7. Crush (charmbracelet, v0.98.2, 2026-10-23)
- 2026-09~10에 테마(v0.96.0), Plan Mode(v0.95.0), ctrl+b 사이드바 토글·Git 브랜치 표시·UI에서 MCP 켜고 끄기(v0.97.0, 09-29)가 추가됐다 [공식] — [releases](https://github.com/charmbracelet/crush/releases)
- 사이드바 섹션은 "Modified Files", "LSPs", "MCPs"이고, 비용 `$%.2f`, 토큰, 컨텍스트 %를 보여 준다. 컨텍스트가 80%를 넘으면 경고 아이콘을 붙인다(`if percentage > 80`) [공식 저장소 커밋, 날짜 미상, 옛 경로 `internal/tui`] — [commit ec1b652](https://github.com/charmbracelet/crush/commit/ec1b652dbaa0d89e51ba58ec356f138c3534d82c)
- 좁은 화면: `CompactModeWidthBreakpoint = 120`, `CompactModeHeightBreakpoint = 30`, `SideBarWidth = 31`. **폭 < 120 또는 높이 < 30**이면 compact 모드로 바꾸고 로고와 세션 상세를 숨긴다. `forceCompact`가 있다 [공식 커밋, 날짜 미상] — [commit b8f74f3](https://github.com/charmbracelet/crush/commit/b8f74f33c52759625a1a5cd9f5f1a0b95675a781). 현재 설정은 `options.tui.compact_mode`, `diff_mode` unified/split, `transparent` [공식] — [schema.json](https://raw.githubusercontent.com/charmbracelet/crush/main/schema.json). UI 코드가 `internal/ui`로 옮겨졌으니 수치가 바뀌었을 수 있다 [추론]
- v0.98.2: 보내자마자 턴 스피너를 띄우고, "gave each status message its own display time"(상태 메시지마다 표시 시간을 따로 줌) [공식] — releases
- 알림: `notifications` auto/native/osc/bell/disabled. 권한 요청·턴 완료 때, 터미널이 포커스 밖일 때만 [공식] — [README](https://github.com/charmbracelet/crush), schema

#### 1-8. Aider (0.86.2, 2026-02-12)
- PyPI 최신은 0.86.2(2026-02-12)이고, 이전은 0.86.1(2025-08-13)이다 [공식] — [PyPI](https://pypi.org/project/aider-chat/#history). 릴리스 간격으로 보아 개발이 느려졌다 [추론]
- `/undo` "Undo the last git commit if it was done by aider", `/diff` "Display the diff of changes since the last message"(지난 메시지 이후 diff, 턴 단위), `/tokens`, `/reasoning-effort`, `/think-tokens` [공식] — [commands](https://aider.chat/docs/usage/commands.html)
- 알림: "When enabled, aider will notify you when the LLM has finished generating a response and is waiting for your input."(켜면 응답이 끝나 입력을 기다릴 때 알림). macOS는 `terminal-notifier`나 AppleScript를 쓰고, `--notifications-command`로 임의 명령을 건다 [공식] — [notifications](https://aider.chat/docs/usage/notifications.html)

#### 1-9. Goose (Linux Foundation AAIF로 이관)
- 문서에 "has moved to the Agentic AI Foundation (AAIF)"라고 적혀 있다. GitHub는 `aaif-goose/goose` [공식] — [CLI commands](https://goose-docs.ai/docs/guides/goose-cli-commands). 2025-12 기증, 2026-04-07 저장소 이전이라는 서술은 [커뮤니티] — [nexu.io](https://nexu.io/blog/goose-cli-linux-foundation-local-agent)
- `session --resume`, `--fork`(기록 복사), `--edit`(대화를 YAML로 에디터에서 편집), export, `/mode` auto/approve/chat/smart_approve, `/r` 도구 출력 전체 토글, 레시피·`goose schedule` [공식] — 같은 문서

#### 1-10. Kiro CLI (Amazon Q Developer CLI 후속, V3 early release)
- Amazon Q Developer CLI는 2025-11-24에 자동 업데이트로 Kiro CLI가 됐다 [공식] — [migrating from Q](https://kiro.dev/docs/cli/migrating-from-q/). "An early release of Kiro CLI V3 is now available." [공식] — [V3](https://kiro.dev/docs/cli/v3/). 비공개 소스로 바뀌었다는 서술은 [커뮤니티] — [issoh](https://www.issoh.co.jp/md/tech/5753)
- 아래는 원문을 다시 열어 확인했다 [공식] — [terminal UI](https://kiro.dev/docs/cli/terminal-ui/) (2026-10-21)
  - "Kiro CLI V2 and V3 report their state through OSC 7501 on interactive terminals."(V2·V3는 대화형 터미널에서 OSC 7501로 상태를 보고). "Terminal tab/title bar animates and reflects agent state (streaming, pending approval, error)"(탭·제목줄이 상태를 반영). `KIRO_NO_PROGRAM_STATUS=1`로 끈다
  - "The timer pauses whenever the turn is waiting for your approval or an answer to a question"(승인이나 답을 기다리는 동안 경과 타이머가 멈춘다)
  - "Press `Ctrl+X` to see task progress and queued messages at a glance"(작업 진행과 대기 중인 메시지를 한눈에), `Ctrl+G` Crew monitor(서브에이전트·생성된 세션 실시간)
  - `/usage` "Usage limits with progress bar and credit balance", `/context` 파일별 토큰 %
  - "Themes use named ANSI colors instead of hardcoded hex values"(테마는 고정 hex가 아니라 이름 있는 ANSI 색), `NO_COLOR` 존중, safe 테마. "CJK characters, emoji, and accented letters render correctly"
  - 권한 요청은 "a notification bar appears above your input with Yes, Trust, and No options"(입력창 위 알림 막대)
- `/rewind`는 "forks the conversation at an earlier turn into a new session"(파일은 안 바꿈). checkpoint는 실험 기능. "Kiro does not track changes to a file made _outside_ of the Kiro agent."(에이전트 밖에서 바꾼 파일은 추적 안 함) [공식] — [checkpoints](https://kiro.dev/docs/checkpoints/) (2026-08-04)

#### 1-11. 그 밖 (짧게)
- Factory Droid: Shift+Tab 한 키로 Normal → Spec → Auto(Low/Medium/High)를 순환한다 [공식] — [auto-run](https://docs.factory.ai/cli/user-guides/auto-run) (날짜 미확인)
- Cline CLI 2.0(2026-02-03): "Sessions end with summaries of what changed, what ran, and how many tokens were used"(세션 끝에 바뀐 것·실행한 것·토큰 요약). 검색 요약 문장이라 원문과 정확히 같은지는 확인하지 못했다 [공식 블로그] — [Cline CLI 2.0](https://cline.bot/blog/announcing-cline-cli-2-0)
- Kilo CLI 1.0(2026-02 무렵)은 OpenCode 기반이고 기기 간 세션 동기화를 내세운다 [커뮤니티] — [morphllm](https://www.morphllm.com/comparisons/kilo-code-vs-opencode). Qwen Code는 Gemini CLI 기반 [커뮤니티] — [toolquestor](https://toolquestor.com/vs/qwen-code-vs-github-copilot-cli)

#### 1-12. 차원별 비교 (위 출처 요약)

| 차원 | 대표 방식 | 도구 |
|---|---|---|
| 상태줄 커스터마이즈 | 정해진 항목 고르기 | Codex `tui.status_line`, Copilot `/statusline`, Gemini `ui.footer.items` |
| | 스크립트 + JSON | Copilot, Cursor, Antigravity |
| | 플러그인 슬롯 | OpenCode `prompt.footer.status`, Amp `createStatusItem` |
| 기본 줄 보존 | 덧붙임 옵션 있음 | Antigravity `stack_with_default`, OpenCode `home.footer.status` |
| | 대체해 버림 | Cursor(버그 보고) |
| 한도 표시 | 진행 막대 | Copilot·Kiro `/usage` |
| | 임계 경고 | Copilot 50%·95% |
| | 한도에 걸릴 때 | Copilot 자동 모델 전환. Orca 네이티브 채팅은 "pause with reset time + Continue"(2-1) |
| effort UX | `/model` 안에서 | Codex, Antigravity, Cursor |
| | 단축키 순환 | OpenCode `ctrl+t` variant |
| | 세션 한정 | Copilot `/model --session` |
| | 난이도 단계로 묶음 | Amp Dial |
| | 프롬프트별 자동 | **없음**. 모델 단위 Auto만 있음(Copilot, Cursor) |
| 진행 | 서브에이전트 경과 실시간 | Copilot, Cursor |
| | 승인 대기 중 타이머 멈춤 | Kiro |
| | 백그라운드 출력 미리보기 | Codex `/ps` |
| | 프롬프트 위 고정 상태 | Cursor |
| 변경·되감기 | 턴별 diff 타임라인 | Cursor `/rewind` |
| | 세션 diff + 파일 트리 | Copilot |
| | `/undo` | OpenCode(파일 포함), Aider(git 커밋) |
| | 대화 포크 | Codex Esc×2, Goose `--fork` |
| 요약 | 포커스 잃었을 때 자동 요약 | Codex |
| | 세션 끝 요약 | Cline |
| | 24시간 standup | Copilot `/chronicle` |
| | 토큰 사용처 설명 | Amp Explain Usage |
| 알림 | 포커스 밖일 때만 | Codex, OpenCode, Crush, Cursor |
| | 이벤트별 소리 | OpenCode |
| 좁은 화면 | 두 줄 → 여러 줄로 쌓기 | Copilot |
| | 폭 또는 높이로 compact | Crush 120/30 |
| | 120열 기준 사이드바 | OpenCode |
| | diff 배치 자동 | OpenCode |
| 테마 | 터미널 ANSI 색 따르기 | OpenCode `system`, Kiro, Antigravity `terminal` |

### Inferences
- [추론] effort를 프롬프트마다 자동으로 고르는 기능(F3 auto)은 조사한 도구 중 하나도 없다. Copilot·Cursor는 모델 라우팅 "Auto"를, Amp는 스레드 시작 때 사람이 고르는 단계를 쓴다. Amp가 스레드 중간 변경을 막은 이유는 단계가 프롬프트·도구까지 바꾸기 때문이다(1-6). hubblerc는 effort만 바꾸므로 그 제약이 그대로 해당하지는 않는다. 다만 effort 변경이 캐시에 주는 영향은 spec의 "확인할 것"대로 따로 재야 한다.
- [추론] "기본 표시를 대체하지 말고 덧붙이기"는 여러 도구가 따로 도달한 원칙이다(Antigravity `stack_with_default`, OpenCode 슬롯, Cursor의 대체 버그 보고). hubblerc의 밴드도 엔진 기본 표시(스피너, 알림 줄)와 같은 정보를 겹쳐 그리지 않는 쪽이 맞다.
- [추론] Copilot의 컨텍스트 % 버그(1.0.4)는 같은 실수를 피하라는 교훈이다. hubblerc는 `$.session.usage()`의 context를 쓰므로 직접 합산하지 않는다면 해당하지 않을 가능성이 크다.
- [추론] "2026년 리뷰 글에서 칭찬받는 기능"은 거의 찾지 못했다. 위 칭찬 포인트는 대부분 공식 블로그·변경 기록에서 각 회사가 강조한 것이다.

### Gaps
- Codex: 상태줄 항목 ID 공식 목록이 없고, 커뮤니티 목록끼리도 다르다. effort 전용 단축키는 못 찾았다. agents 대시보드(v0.149)를 공식 변경 기록에서 직접 확인하지 못했다.
- Antigravity CLI: 공식 변경 기록, `/rewind`가 파일까지 되돌리는지, 사이드 패널·좁은 화면 대응, OSC 알림 지원을 확인하지 못했다. Gemini CLI 최신 버전은 GitHub API 403으로 확인 못 했다.
- Copilot·Cursor: 키 재정의 설정, statusLine payload 공식 스키마를 못 찾았다.
- OpenCode: 현재 사이드바 구성(컨텍스트·비용·LSP·MCP·수정 파일)은 공식 문서로 확인하지 못했다. 120열 기준은 커뮤니티 출처뿐이다. `/share` 문서는 404였다. sst → anomalyco 이전 시점도 모른다.
- Amp: CLI 상태줄에 컨텍스트 %나 비용을 늘 보여 주는지, 제거 전 사이드바 내용을 못 찾았다.
- Crush: compact 기준값과 사이드바 근거가 날짜 미상의 옛 코드다. 수정 파일 +/− 표시 형식, effort UI를 확인하지 못했다.
- Aider 비용 줄 형식, Goose CLI의 컨텍스트·비용·알림, Kiro 고정 상태줄 유무는 확인하지 못했다.

---

## 2. 터미널 에뮬레이터·멀티플렉서의 AI 에이전트 기능과 다중 세션 UX (Orca 포함)

### Takeaway
2026년 터미널들은 "에이전트 상태를 탭·사이드바의 점과 배지로 보여 주고, 읽지 않은 완료·입력 대기를 따로 모으는" 쪽으로 같이 움직였다. 공통 상태 어휘는 working / waiting(blocked) / done(안 봄) / error / idle이다. 가장 큰 변화는 **OSC 7501 Program Status Protocol**(Mitchell Hashimoto, 2026-10-06)이다. 사용자의 터미널 **Orca가 v1.4.232(2026-10-20 무렵)부터 이것을 읽어 행과 탭에 보여 준다**. Kiro CLI는 이미 이것으로 상태를 보고한다. Orca는 xterm.js 기반 데스크톱 ADE이고, 상태 점·사용량 상태바·완료 알림·Agents feed를 이미 갖고 있다. 그래서 hubblerc는 Orca가 이미 하는 일(세션 간 관리, OS 알림)을 되풀이하지 말고, TUI 안에서만 보이는 정보에 집중하는 편이 맞다 [추론].

### Cited Findings

#### 2-1. Orca (사용자의 터미널)
- 정체: Stably AI의 오픈소스(MIT) 데스크톱 앱이다. "Run Codex, ClaudeCode, OpenCode or Pi side-by-side — each in its own worktree"(각 에이전트를 자기 worktree에서 나란히). 별 105.8k, "we ship daily"(매일 배포). 최신 v1.4.240(2026-10-25) [공식] — [GitHub stablyai/orca](https://github.com/stablyai/orca), [releases](https://github.com/stablyai/orca/releases), 문서 [onorca.dev/docs](https://www.onorca.dev/docs)
- 터미널: "the same xterm.js-based terminal VS Code uses"(VS Code와 같은 xterm.js 기반). README는 "Ghostty-class terminals with WebGL rendering"이라고 쓰지만, 문서에서 Ghostty는 테마·폰트·커서 설정을 가져오는 출처로만 나온다. 테마 라이브러리가 있고 Ghostty 색·Warp YAML 테마를 가져올 수 있다. "kitty keyboard protocol"을 광고해 Shift+Enter 같은 조합키가 앱에 전달된다. OSC 52(클립보드)·OSC 8(링크)을 지원한다. OSC 9·9;4·133은 문서에 없다 [공식] — [Terminal](https://www.onorca.dev/docs/terminal)
- 설정 문서에 IME·조합 관련 항목이 없고, macOS Option 키 설정은 일본어 JIS 키보드의 "JIS Yen (¥) to Backslash" 하나뿐이다(Option-as-Meta 항목 없음) [공식] — [Settings reference](https://www.onorca.dev/docs/settings)
- 상태 감지와 표시: "State is detected from the terminal's OSC title sequence and agent hooks."(OSC 제목과 에이전트 훅으로 감지) [공식] — [Agents & sessions](https://www.onorca.dev/docs/model/agents-sessions)
  - working = 스피너, waiting = 호박색 물음표(권한·입력 요청, 사이드바 "Needs You" 수도 같은 기호), done = 에메랄드 체크·점, blocked·interrupted·failed = 빨간 점, idle = 회색 점
  - 실험 기능 Agent Dashboard는 칸반 4열(Needs You / Working / Done / Idle)이고, Idle은 약 30분 동안 완료 보고가 없는 것이다
- Claude Code 연동: Orca가 Claude Code를 띄울 때 status-line hook을 붙인다. 이 훅이 "emits OSC title events Orca uses for state dots"(Orca 상태 점에 쓰는 OSC 제목 이벤트를 낸다). `~/.claude`의 사용량을 읽어 상태바에 보여 준다. 여러 Claude 계정을 한 번에 전환한다. 백그라운드 서브에이전트와 Agent Teams 팀원은 리드 에이전트 아래 펼칠 수 있는 하위 행으로 나온다 [공식] — [Claude Code in Orca](https://www.onorca.dev/docs/agents/claude-code)
- 훅 관리: Settings → Agents → Agent status hooks가 "report working / waiting / done into the UI"(작업 중·대기·완료를 UI에 보고)하는 Orca 관리 훅을 켜고 끈다. CLI는 `orca agent hooks status|on|off`. 엔드포인트는 `{userData}/agent-hooks/endpoint.env`에 있다 [공식] — [Agent hooks & memory](https://www.onorca.dev/docs/agents/hooks-memory)
- 사용량·한도 표시 [공식] — [Usage & rate-limit tracking](https://www.onorca.dev/docs/agents/usage-tracking)
  - 상태바 세그먼트를 누르면 Usage 팝오버가 열리고 "tightest limit first"(가장 빡빡한 한도부터) 보인다
  - % used / % remaining을 고를 수 있다(Settings → Appearance). 5시간·일간·주간·Fable 주간 창의 리셋까지 시간을 보여 준다
  - Detailed(막대·라벨·%) / Compact(공급자별 가장 빡빡한 창만)
  - 좁은 창에서는 미니 막대와 라벨을 숨기고 공급자당 % 하나만 남긴다. 자리가 모자라면 **+N** 칩으로 접는다. 80% 이상인 공급자는 맨 나중에 접는다
  - 80%를 넘으면 경고 칩이 뜬다. 데이터가 없으면 0이 아니라 "Loading usage…", "not signed in", "Usage unavailable"로 표시한다. 잔액을 보고하지 않는 공급자는 "unavailable, not zero"(0이 아니라 없음)
  - 소진 예측(burn rate)은 없다
- 알림 [공식] — [Notifications & Inbox](https://www.onorca.dev/docs/notifications)
  - "an agent transitions from working to idle"(작업 중 → 유휴로 바뀔 때) 알린다. 채널은 시스템 알림·소리·워크트리 칩이다
  - Dock 배지에 읽지 않은 수, 헤더 벨에 전체 미확인, 우클릭으로 읽지 않음 표시, 카테고리별 소리, 기기별 음소거, 휴대폰 푸시
- Agents feed: 턴 완료(idle 또는 질문으로 막힘), 오래 입력을 기다린 에이전트, "A short preview of the agent's most recent response"(최근 응답의 짧은 미리보기). "running agents stay pinned at the top"(실행 중은 위에 고정). 누르면 해당 pane으로 간다 [공식] — [Agents feed](https://www.onorca.dev/docs/activity)
- 워크트리 코멘트: `orca worktree set --worktree active --comment "…"`로 에이전트가 상태 한 줄을 남긴다. 권장 형식은 첫 줄에 "행동과 다음 단계" [공식] — [Worktree checkpoints](https://www.onorca.dev/docs/cli/worktree-checkpoints)
- 2026-10 릴리스 중 관련 항목 [공식] — [releases](https://github.com/stablyai/orca/releases), [v1.4.239](https://github.com/stablyai/orca/releases/tag/v1.4.239)
  - v1.4.232(날짜 표기 없음, 10-20 무렵): "feat(agent-status): read OSC 7501 program status beside hooks", "show OSC 7501 program status in rows and tabs"(OSC 7501을 훅과 함께 읽어 행·탭에 표시). 네이티브 채팅에서는 "a usage limit reads as a pause with its reset time and a Continue, not a failure"(한도 도달을 실패가 아니라 리셋 시각과 Continue가 붙은 일시정지로 표시)
  - v1.4.235(10-20): "Rewind Claude chats from messages that started a turn"
  - v1.4.237(10-21): "Show Working only while Claude, Pi or ACP is handling work"
  - v1.4.239(10-24): "Send on the Enter that commits a Hangul composition"(#30192), "Submit on the Enter that commits Korean in every text field"(#32756)
  - v1.4.240(10-25): "Clear stale Working status for completed Codex subagents"
  - v1.4.229(10-17): "Register a short PostCompact hook command"
  - v1.4.230(10-19): "Keep a restored agent's status unconfirmed after 30 minutes instead of marking it done"

#### 2-2. OSC 7501 Program Status Protocol
- 발표: Mitchell Hashimoto, 2026-10-06. "It lets any program tell the terminal what it's doing: idle, working, waiting on the user, finished, or failed, and why."(어떤 프로그램이든 지금 무엇을 하는지, 왜 그런지 터미널에 알린다). "The program already knows. Let's give it a way to tell us!" [공식] — [mitchellh.com](https://mitchellh.com/writing/program-status-osc7501)
- 구현: 터미널은 libghostty(Ghostty PR)와 Rex(베타 멀티플렉서)다. 프로그램은 Terraform·Claude Code·Codex·Homebrew에 "via either plugins or forks"(플러그인이나 포크로) 시험 구현했다. **Claude Code가 기본으로 내보낸다는 말은 없다** [공식] — 같은 글. 독일어 요약 기사 [커뮤니티] — [zeli](https://zeli.app/de/story/49984159)
- 명세 [공식] — [Program Status 명세](https://www.superlogical.com/rex/docs/build/program-status)
  - 형식: `OSC 7501 ; key=value:key=value ST`. 예: `ESC ] 7501 ; state=blocked:kind=permission:app=terraform:msg=<base64> ESC \`
  - 키: `state`(필수, idle/working/done/blocked/error/clear), `id`(`/`로 계층), `kind`(blocked일 때 permission/question/auth), `progress`(0–100, working·blocked), `app`, `title`(base64, 192바이트), `msg`(base64 한 줄, 2048바이트)
  - 수명: working·blocked는 프로세스가 끝나거나 새 셸 프롬프트(OSC 133 A)가 오면 지워진다. done·error는 남는다. "There is no heartbeat"(살려 두려고 다시 보낼 필요 없음). `clear`로 지운다
  - 기능 감지: `OSC 7501 ; ? ST` 질의. 응답을 못 읽는 프로그램은 질의 없이 보내도 된다
  - 다른 시퀀스와의 관계: OSC 9;4는 바쁨·%·오류만 담는다. 터미널은 OSC 7501을 받으면 9;4를 루트 레코드로 매핑하던 것을 멈춰야 한다. OSC 9/777은 일회성 알림, OSC 133은 셸이 내는 명령 경계, OSC 0/2 제목은 기계가 읽기에 믿을 수 없는 문자열이다
- Kiro CLI V2·V3는 이미 OSC 7501로 상태를 보고한다 [공식] — [Kiro terminal UI](https://kiro.dev/docs/cli/terminal-ui/) (1-10)

#### 2-3. Warp
- 서드파티 CLI 에이전트(Claude Code·Codex·OpenCode)를 위한 섹션이 있다. 지원 에이전트를 실행하면 "the agent toolbelt appears automatically"(툴벨트가 자동으로 뜸). 칩 순서 바꾸기·숨기기가 재시작 후에도 유지된다. Remote Control("monitor or steer it from another device") [공식] — [CLI agents overview](https://docs.warp.dev/agent-platform/cli-agents/overview/) (2026-10-20)
- "Each tab displays an icon reflecting its agent's current state — working, blocked, completed, or errored"(탭마다 상태 아이콘). 알림은 Complete / Request(명령 승인·권한·idle prompt) / Error로 나뉜다. 토스트는 "Up to two toasts are visible at a time"(동시에 최대 2개), 마우스를 올리면 타이머가 멈추고 클릭하면 이동한다. 종 아이콘 Mailbox에 All/Unread/Errors 필터가 있다 [공식] — [Agent notifications](https://docs.warp.dev/agent-platform/capabilities/agent-notifications/) (2026-10-20)
- Claude Code 연동은 플러그인 `warpdotdev/claude-code-warp`가 맡는다. "The plugin communicates with Warp via OSC 777 escape sequences". 훅 SessionStart·Stop·Notification·PermissionRequest·UserPromptSubmit·PostToolUse를 쓰고, 알림 UI에 브랜치를 같이 표시한다 [공식] — [claude-code-warp](https://github.com/warpdotdev/claude-code-warp), [Warp Claude Code 문서](https://docs.warp.dev/agent-platform/cli-agents/claude-code/)
- 블록: "A Block groups commands and outputs into one atomic unit" [공식] — [Blocks](https://docs.warp.dev/terminal/blocks). alt-screen TUI를 블록으로 어떻게 다루는지는 문서에 없다

#### 2-4. iTerm2 (3.7.0 ~ 3.7.6)
아래는 원문을 다시 확인했다 [공식] — [iTerm2 downloads/릴리스 노트](https://iterm2.com/downloads.html)
- 3.7.0: "Sessions can now report status that appears on their tab with a custom subtitle, color, and dot icon."(세션이 탭에 부제목·색·점으로 상태를 보고). "Claude Code integration was added." / "so you can see at a glance which instance is waiting for you"(어느 인스턴스가 나를 기다리는지 한눈에). "The control-sequence-controlled progress indicator is now shown in the tab bar."(진행률이 탭 바에 표시). "Suppress notifications from the active session"(보고 있는 세션의 알림 억제). "Customizable IME color."
  - 날짜가 서로 다르다: 다운로드 목록은 2026-09-08, 변경 기록 본문은 "June 8, 2026"
- 3.7.5(2026-10-14): "Session Status has new "done" and "error" statuses for work that finished or failed while you were away."(자리 비운 사이 끝나거나 실패한 작업용 done·error 상태). "Claude Code now reports a finished turn as "done" and an API error as "error"." "Interrupting Claude Code with Esc now returns its Session Status to idle."(Esc로 중단하면 idle로 돌아가게 고침). 한국어 2벌식 IME로 조합 중 Backspace를 누를 때의 버그 수정
- 상태 시퀀스: `OSC 21337 ; indicator=[#rrggbb] ; status=[text] ; status-color=[#rrggbb] ST`. 빈 값을 보내면 지워진다 [공식] — [escape codes](https://iterm2.com/documentation-escape-codes.html)

#### 2-5. Ghostty, WezTerm, Kitty
- Ghostty 1.2.0(2025-09-15): OSC 9;4를 네이티브 진행 막대로 그린다. "The progress report OSC 9;4 sequence collides with the iTerm2 notification sequence"(OSC 9;4와 iTerm2식 OSC 9 알림이 겹침) → "the more recommended OSC 777"(OSC 777 권장) [공식] — [1.2.0 노트](https://ghostty.org/docs/install/release-notes/1-2-0)
- Ghostty 1.3.0(2026-03-09): `notify-on-command-finish = never/unfocused/always`(OSC 133·셸 통합 필요), OSC 133 파싱 보강, macOS AppleScript, "IME preedit text is now rendered with underlines instead of inverted colors"(조합 중 글자를 반전 대신 밑줄로), "a memory leak that Claude Code regularly triggered"(Claude Code가 자주 일으키던 메모리 누수) 수정. `bell-features` 기본에 제목 앞 🔔 [공식] — [1.3.0 노트](https://ghostty.org/docs/install/release-notes/1-3-0), [config reference](https://ghostty.org/docs/config/reference). 1.4는 10월 말 예정이라는 정보만 있다 [커뮤니티] — [zeli](https://zeli.app/story/49996286)
- WezTerm: OSC 9 토스트, OSC 777은 notify만. `notification_handling`으로 포커스 기반 억제. OSC 9;4는 `pane:get_progress()`인데 nightly 전용. user var가 바뀌면 `update-status` 이벤트로 Lua 상태바를 갱신한다. "In macOS, `ime_preedit_rendering` has effected nothing yet"(macOS에서는 아직 효과 없음) [공식] — [escape sequences](https://wezterm.org/escape-sequences.html), [get_progress](https://wezterm.org/config/lua/pane/get_progress.html), [ime_preedit_rendering](https://wezterm.org/config/lua/config/ime_preedit_rendering.html)
- Kitty: OSC 99 알림. `i=` 같은 ID면 교체, `a=report` 클릭 콜백, `o=unfocused` 포커스 억제, `w=` 만료. 0.47.0(2026-05-19) OSC 9;4로 창 위쪽 진행 막대. 0.48.0 세로 탭. 0.49.0(2026-09-21) preedit 밑줄, macOS에서 키 이벤트 밖에서 확정된 긴 IME 텍스트가 버려지던 문제 수정 [공식] — [desktop notifications](https://sw.kovidgoyal.net/kitty/desktop-notifications/), [changelog](https://sw.kovidgoyal.net/kitty/changelog/)

#### 2-6. 프로토콜 지원 표 (공식 문서 기준, ?는 확인 못 함)

| 시퀀스 | Orca | Ghostty | iTerm2 | WezTerm | Kitty | Warp |
|---|---|---|---|---|---|---|
| OSC 7501 상태 | ✅ v1.4.232 | libghostty PR | ? | ? | ? | ? |
| 상태 전용 기타 | OSC 제목 + 훅 | — | OSC 21337 | user var + Lua | — | OSC 777 플러그인 |
| OSC 9 / 777 알림 | 문서에 없음 | ✅ / ✅ 권장 | ✅ / ? | ✅ / notify만 | 레거시 / ? | ? / ✅ |
| OSC 9;4 진행률 | 문서에 없음 | ✅ 1.2.0 | ✅ 탭 바 3.7.0 | nightly | ✅ 0.47.0 | ? |
| OSC 133 | 문서에 없음 | ✅ | ✅ | ✅ | ✅ | ? |

- tmux 3.3+ 안에서는 `allow-passthrough`를 켜고 DCS로 감싸야 OSC가 바깥으로 나간다. Claude Code는 v2.1.78부터 tmux 안에서 자체 알림·진행률을 바깥으로 넘긴다는 기록이 있다. Claude Code에는 이미 `terminalProgressBarEnabled`(OSC 9;4) 설정이 있다 [커뮤니티] — [claudeissues 미러 #57366](https://claudeissues.com/issue/57366-) (조사자가 본 이슈 미러, 정확한 URL 꼬리는 잘림)

#### 2-7. 멀티플렉서·다중 세션 매니저 (Claude Code 전용 도구는 이름과 한 줄만)
- claude-tmux-hop: 패인을 waiting/idle/active로 나누고 상태바에 상태별 개수를 표시한다. waiting을 최우선으로 순환한다 [커뮤니티] — [PyPI](https://pypi.org/project/claude-tmux-hop/)
- workmux: tmux 창 이름에 🤖 작업 중 / 💬 입력 대기 / ✅ 완료 [커뮤니티] — [workmux status tracking](https://workmux.raine.dev/guide/status-tracking/)
- claude-tmux(nielsgroen): 패인 화면을 긁어 `[y/n]`이면 waiting으로 판정 [커뮤니티] — [GitHub](https://github.com/nielsgroen/claude-tmux)
- cmux(manaflow-ai): libghostty 기반 macOS 터미널. "Panes get a blue ring and tabs light up when coding agents need your attention"(주의가 필요하면 패인에 파란 링). 사이드바에 브랜치·PR 상태·cwd·열린 포트·최신 알림 텍스트를 보여 준다. Cmd+Shift+U는 가장 최근 미확인으로 점프 [커뮤니티] — [GitHub cmux](https://github.com/manaflow-ai/cmux)
- AgentDiode(KDE 트레이) 작성자: 에이전트마다 대기 상태 이벤트가 다 있지 않아 대기 감지는 부분적일 수밖에 없다 [커뮤니티] — [KDE discuss](https://discuss.kde.org/t/agentdiode-…/48991) (URL 일부 생략됨)
- Josh Morony의 다중 에이전트 주의 관리 원칙 [커뮤니티] — [블로그](https://www.joshmorony.com/effectively-manage-attention-across-multiple-coding-agents/) (2026-07-27)
  - 상태 4종: 처리 중 / idle(이미 봄) / 승인 대기 / 완료했지만 안 봄
  - "Counters lead so they survive truncation"(숫자를 앞에 둬서 잘려도 남게)
  - "Persistence without retraction just moves the chore"(자동 철회 없는 지속 알림은 일만 옮긴다). 그 패인을 보거나, 작업이 재개되거나, 세션이 끝나면 알림을 자동으로 걷는다
  - 터미널이 앞에 없을 때만 알림을 보낸다. 완료가 많으면 "✅+K"로 접는다

### Inferences
- [추론] Orca는 hubblerc가 후보로 둔 "세션 밖" 기능 상당수를 이미 한다: 완료 알림(working→idle), 사용량·리셋 시간 상태바, 서브에이전트 하위 행, 최근 응답 미리보기, 되감기. Orca 안에서 쓰는 한 hubblerc가 OS 알림을 기본으로 켜면 같은 알림이 두 번 올 수 있다. hubblerc는 TUI 안에서만 보이는 것(답변별 활동, Bash 용도, effort, 압축 직전)에 집중하는 게 겹치지 않는다.
- [추론] Amp의 사이드바 제거(1-6)도 같은 결론이다. 여러 세션 관리는 터미널(Orca)에 맡기고, TUI 사이드바는 한 세션의 정보만 다룬다. hubblerc F2의 지금 범위(상태·변경 파일·목차)가 이 원칙에 맞는다.
- [추론] OSC 7501은 hubblerc와 Orca를 잇는 가장 직접적인 길이다. `blocked` + `kind=permission` + `msg="Bash: 테스트 실행 승인 대기"`, `working` + `progress=40`(할 일 2/5), `id=sub/explore` 서브에이전트 레코드를 보내면 Orca가 이를 행·탭에 보여 줄 것이다. 다만 Orca가 msg·title·progress를 어떻게 그리는지는 문서로 확인하지 못했고, 이미 Orca 자체 상태줄 훅이 상태 점을 맡고 있어서 추가로 얻는 것은 "메시지 한 줄과 진행률"이다.
- [추론] iTerm2가 3.7.5에서야 "Esc 중단 → idle"을 고친 사례는 hubblerc F1 2줄에 같은 위험이 있다는 신호다. mod는 Esc를 못 받으므로, 중단 때도 `turn.complete`가 오는지 확인하고, 안 오면 다음 `turn.start`나 시간 초과로 "실행 중" 표시를 비워야 한다.

### Gaps
- Orca가 OSC 7501의 `msg`·`title`·`progress`·`id` 계층을 화면에 어떻게 그리는지: 문서 페이지가 없고 릴리스 노트 한 줄뿐이다.
- Orca가 Claude Code에 붙이는 status-line hook의 정확한 방식: 사용자의 전역 statusLine(claude-hud)을 감싸는지, `--settings`로 덮어쓰는지, OSC 제목을 어디로 쓰는지 문서에 없다. hubblerc가 OSC 제목을 건드리면 Orca 상태 점과 충돌할 수 있는데 확인하지 못했다.
- Orca 터미널 안에서 에이전트 프로세스에 Orca 전용 환경 변수(예: `ORCA_*`)가 붙는지 확인하지 못했다. hubblerc가 "Orca 안에서는 OS 알림 끄기"를 자동으로 하려면 필요하다.
- spec에 적힌 단일 컨트롤 키(`ctrl+q`, `ctrl+t`) 무반응이 Orca(xterm.js·kitty keyboard protocol) 쪽 원인인지: 관련 문서나 이슈를 찾지 못했다(`gh`가 없어 Orca 이슈 검색을 못 했다).
- iTerm2·WezTerm·Kitty·Warp의 OSC 7501 지원 여부, Kitty·iTerm2의 OSC 777 지원, Warp의 OSC 9/9;4/133 지원.
- Rex의 상태 표시 화면: 문서에 없다(베타).

---

## 3. 한글(CJK) 입력기, 좁은 화면, 작은 모니터를 잘 처리한 사례

### Takeaway
한글 조합 문제의 대부분은 **터미널 쪽(preedit 표시, 조합을 확정하는 Enter·Backspace)**에서 고쳐지고 있다. 2026년에 Orca v1.4.239, iTerm2 3.7.5, Ghostty 1.3, Kitty 0.49가 모두 조합 처리를 고쳤다. TUI 앱 쪽 핵심은 "진짜 커서를 입력 위치에 두기"(Ink `useCursor`)와 "입력 중 레이아웃 흔들지 않기"다. mod가 손댈 수 있는 것은 후자뿐이다 [추론]. 좁은 화면은 ① 폭과 **높이**를 같이 보는 전환(Crush, lazygit), ② auto/always/never 세 값, ③ 자르지 말고 우선순위대로 접거나 쌓기(Copilot, Orca)가 반복되는 패턴이다.

### Cited Findings
- 한글 IME (터미널 쪽)
  - Orca v1.4.239(2026-10-24): "Send on the Enter that commits a Hangul composition"(한글 조합을 확정하는 Enter로 바로 전송, #30192, 이슈 #30159), "Submit on the Enter that commits Korean in every text field"(모든 입력란에서 같은 동작, #32756) [공식] — [Orca v1.4.239](https://github.com/stablyai/orca/releases/tag/v1.4.239)
  - iTerm2 3.7.5(2026-10-14): 한국어 2벌식 IME로 조합 중 Backspace를 누를 때의 버그 수정. 조합 중 Return 한 번으로 줄 전송. 3.7.0에서 IME 색 설정 [공식] — [iTerm2 릴리스 노트](https://iterm2.com/downloads.html)
  - Ghostty 1.2.0: "Key input that clears preedit without text shouldn't encode to pty"(텍스트 없이 preedit만 지우는 키는 pty로 보내지 않음). 1.3.0: preedit 밑줄 표시 [공식] — [1.2.0](https://ghostty.org/docs/install/release-notes/1-2-0), [1.3.0](https://ghostty.org/docs/install/release-notes/1-3-0)
  - Kitty 0.49.0(2026-09-21): preedit 밑줄, macOS에서 키 이벤트 밖에서 확정된 긴 IME 텍스트가 버려지던 문제 수정 [공식] — [Kitty changelog](https://sw.kovidgoyal.net/kitty/changelog/)
  - WezTerm: macOS에서는 `ime_preedit_rendering`이 아직 효과가 없다 [공식] — [WezTerm 문서](https://wezterm.org/config/lua/config/ime_preedit_rendering.html)
- 한글 IME (TUI 앱 쪽)
  - Ink 기반 TUI는 진짜 커서를 숨기고 가짜 커서를 그린다. macOS IME는 진짜 커서 위치를 기준으로 삼아서 후보창이나 조합 글자가 엉뚱한 곳에 뜬다. 한글은 "ㅎ→하→한이 Enter 전까지 안 보임" 사례가 있다 [커뮤니티] — [tap-skill CJK-IME-KNOWN-ISSUES](https://cdn.jsdelivr.net/npm/tap-skill@0.1.1/docs/CJK-IME-KNOWN-ISSUES.md) (날짜 없음)
  - Ink `useCursor` → `setCursorPosition`은 IME 용도로 실제 커서를 옮긴다 [공식 타입 정의] — [ink@7.0.0 use-cursor.d.ts](https://cdn.jsdelivr.net/npm/ink@7.0.0/build/hooks/use-cursor.d.ts). Ink 8.0.0: "Preserve the cursor position when its component skips rendering"(렌더를 건너뛴 컴포넌트도 커서 위치 유지) [공식] — [Ink releases](https://github.com/vadimdemedes/ink/releases)
  - Kiro CLI는 "CJK characters, emoji, and accented letters render correctly"라고 명시한다 [공식] — [Kiro terminal UI](https://kiro.dev/docs/cli/terminal-ui/)
  - Gemini CLI·Codex가 CJK를 잘 처리한다는 주장과 Gemini CLI도 같은 문제를 겪는다는 주장이 엇갈린다. 둘 다 커뮤니티 출처이고 검증하지 못했다 [커뮤니티]
- 좁은 화면·작은 모니터
  - Crush: 폭 < 120 **또는** 높이 < 30이면 compact(로고·세션 상세 숨김), `forceCompact`, 현재 설정 `compact_mode` [공식 커밋·스키마] — [commit b8f74f3](https://github.com/charmbracelet/crush/commit/b8f74f33c52759625a1a5cd9f5f1a0b95675a781), [schema.json](https://raw.githubusercontent.com/charmbracelet/crush/main/schema.json)
  - lazygit: `portraitMode: auto|always|never`. auto는 "width is less than or equal to portraitModeAutoMaxWidth and the window height is greater than or equal to portraitModeAutoMinHeight"(폭 ≤ 84이고 높이 ≥ 46이면 세로로 쌓음). `mainPanelSplitMode: flexible`, `expandFocusedSidePanel`(포커스 패널만 키움), `showBottomLine: false` [공식] — [lazygit Config.md](https://raw.githubusercontent.com/jesseduffield/lazygit/master/docs/Config.md)
  - Copilot CLI: 좁으면 두 줄 배치(0.0.416), 자르지 않고 여러 줄로 쌓기(1.0.60), 짧은 터미널에서 목표 패널을 한 줄로 접기(1.0.81), 좁으면 키 힌트 빼기(1.0.90) [공식] — [changelog](https://raw.githubusercontent.com/github/copilot-cli/main/changelog.md)
  - Orca 사용량 표시: 좁으면 막대·라벨을 숨기고 % 하나, +N 칩, 80% 이상은 맨 나중에 접음 [공식] — [Usage tracking](https://www.onorca.dev/docs/agents/usage-tracking)
  - OpenCode: 120열 기준 사이드바 자동 표시·숨김 [커뮤니티] — [learnopencode](https://learnopencode.com/en/2-daily/01-interface). `diff_style: auto` [공식] — [tui](https://opencode.ai/docs/tui/)
  - Zellij swap layouts: 폭이 아니라 패인 개수 제약으로 배치를 자동 전환한다 [공식] — [Zellij swap layouts](https://zellij.dev/documentation/swap-layouts)
  - TUI 설계 가이드: "Priority collapse — Less important panels hide first below minimum width"(최소 폭 아래면 덜 중요한 패널부터 숨김), 80×24 / 120×40 / 200×60에서 테스트 [커뮤니티, 스킬 문서] — [hyperskills tui-design](https://claudeskills.info/skills/hyperb1iss/hyperskills/tui-design/)

### Inferences
- [추론] spec에 기록된 `ctrl+x e` 문제(한글 상태에서 `e`가 `ㄷ`으로 조합 중에 붙잡혀 다음 키 때 넘어감)는 Orca·iTerm2가 2026-10에 고친 "조합을 확정하는 키" 문제와 같은 계열이다. 터미널(Orca/xterm.js)이 조합 중 글자를 앱에 언제 넘기느냐의 문제라 mod로는 못 고친다. `ctrl+x ctrl+e`처럼 컨트롤만 쓰는 조합을 고른 지금 결정이 맞다.
- [추론] `Option+E`가 악센트로 들어간 것은 Orca 설정에 Option-as-Meta 항목이 없는 것(2-1)과 들어맞는다. Orca를 쓰는 동안 Option 조합 단축키는 기대하지 않는 게 안전하다.
- [추론] mod가 IME를 위해 할 수 있는 것: ① 밴드·사이드바가 커서를 건드리지 않기, ② 입력 중 밴드 줄 수를 바꾸지 않기(spec F1의 "높이 고정"이 이미 이 방향이다), ③ 입력 중 잦은 다시 그리기를 피하기. 효과는 실측해야 한다.
- [추론] F2의 auto 전환은 지금 폭만 본다. 작은 모니터의 전체 화면에서는 높이가 먼저 모자랄 수 있다(Crush 30행, Copilot 짧은 터미널). mod는 `e.viewport.rows`로 행 수를 받으므로 높이 조건을 추가할 수 있다. 다만 높이만 바뀌면 다시 그리지 않아 반영이 늦을 수 있다(4절 근거).

### Gaps
- Orca(xterm.js) 안에서 Claude Code 입력창의 한글 조합이 어떻게 보이는지(조합 중 글자 위치·지연)는 문서에 없다. 실측이 필요하다.
- btop·k9s·ratatui 앱의 실제 폭 중단점, ratatui 앱의 IME 커서 처리 구체 사례는 찾지 못했다.
- 한국 커뮤니티의 한글 입력 경험담은 다른 조사자 영역이라 보지 않았다.

---

## 4. hubblerc F1~F5와 비교: 다른 도구에 있고 hubblerc에 없는 것, 더 잘 표현한 방식

### Takeaway
hubblerc가 이미 앞서거나 다른 도구에서 같은 것을 보지 못한 부분은 세 가지다: Bash 행의 용도 표시(F4), 답변 단위 활동 요약 줄과 목차(F5·F2), 프롬프트별 effort 자동 선택(F3 계획). 다른 도구가 더 잘하거나 hubblerc에 없는 것은 크게 다섯 갈래다.
1. 한도 경고 단계와 "데이터 없음 ≠ 0" 처리 (Copilot, Orca)
2. 좁고 낮은 화면에서 자르지 않고 우선순위대로 접거나 쌓기, 높이 기준 (Copilot, Crush, Orca)
3. 승인 대기 상태의 명시적 표시와 그동안 타이머 멈추기 (Kiro, Orca, Warp)
4. 바깥 터미널(Orca)에 상태 알리기, 곧 OSC 7501 (Kiro, Orca)
5. 세션을 넘는 보고(standup·사용처 설명·턴별 diff 타임라인) (Copilot, Amp, Cursor)

### Cited Findings
- mod로 구현할 수 있는지 판단할 때 쓴 근거 (로컬 타입 정의, 2.1.308) [타입 확인] — `/Users/circlewee/vault/project/hubblerc/plugins/hubblerc/.claude-plugin/types/claude-code/index.d.ts`
  - `$.ui.notify(text, { title })`: 사용자의 `preferredNotifChannel`로 네이티브 알림을 띄운다. 채널은 `'iterm2' | 'iterm2_with_bell' | 'kitty' | 'ghostty' | 'terminal_bell'`. "nothing limits how often"(빈도 제한 없음). 결과는 `{ isSent, channel }` 또는 `{ isSent: false, reason }`
  - `$.ui.toast(text, { timeoutMs })`가 있다(Crush식 "메시지마다 다른 표시 시간"을 줄 수 있음)
  - `session.measure` 이벤트가 `rateLimits`를 넘긴다(타입 문서 예제 `toastPast90(e.rateLimits)`)
  - 컨텍스트 분석 객체에 `autoCompactThreshold`("The token count at which auto-compaction runs")와 `isAutoCompactEnabled`가 있다 → 후보 "자동 압축 직전 경고"에 바로 쓸 수 있다
  - `hookSpecificOutput.sessionTitle`(UserPromptSubmit·SessionStart)이 있다
  - OSC 8 링크(`Link`)는 그릴 수 있다
  - `RenderViewport`는 `columns`, `rows`, `isFullscreen`을 준다. `rows`는 "Informational: a change of height alone re-draws nothing"(참고용, 높이만 바뀌면 다시 그리지 않음)이다
  - `UiPane.isFocused`는 "True while the person has given it the keyboard"(패널이 키보드를 가졌을 때)다. 터미널 창 포커스가 아니다
  - 원시 이스케이프 시퀀스를 터미널에 쓰는 API는 타입 정의에서 찾지 못했다(`tty`, `\x1b`, `terminalTitle` 검색 결과 없음). `$.process.run`으로 외부 명령을 실행할 수는 있다
- 다른 도구의 대응 기능은 1·2·3절의 출처를 따른다.

### Inferences — 옮길 아이디어 목록
아래는 모두 [추론]이다. "가능성"은 위 타입 근거와 spec을 기준으로 한 내 판단이고, 실제로 실행해 확인하지는 않았다. 우선순위는 사용자 환경(Orca, 한글, 작은/큰 모니터)에서의 효용과 구현 난이도로 매겼다.

**우선순위 높음**

| # | 아이디어 | 어디서 | hubblerc 관련 | mod 구현 가능성 [추론] |
|---|---|---|---|---|
| 1 | **한도 경고 단계**: 50%·80%·95% 같은 임계값을 넘는 순간 토스트 한 번, 밴드 숫자는 계속 색으로 표시. 리셋되면 경고를 자동으로 걷는다(Morony의 자동 철회) | Copilot 1.0.33(50·95%), Orca(80% 칩), Morony | F1 1줄, 후보 "한도 소진 예측"의 첫 단계 | 높음. `session.measure`의 `rateLimits`와 `$.ui.toast`로 된다 |
| 2 | **데이터 없음 ≠ 0**: 한도·비용을 못 읽었으면 `5h —` 또는 `5h ?`로 표시하고 0%로 그리지 않는다 | Orca "unavailable, not zero" | F1 | 높음. 렌더링만 바꾸면 된다 |
| 3 | **자동 압축 직전 경고**: `autoCompactThreshold` 대비 남은 토큰이 일정 비율 아래면 ctx 막대 색을 바꾸고 `압축까지 N%`를 표시 | Crush(ctx 80% 경고 아이콘), Copilot(남은 컨텍스트 20% 이하 경고) | 후보 "컨텍스트 경고" | 높음. 타입에 임계값이 있다 [타입 확인] |
| 4 | **승인 대기 상태와 타이머 멈춤**: 권한 요청 중이면 2줄 앞에 `? 승인 대기: Bash 테스트 실행`(Orca처럼 호박색), 경과 시간은 대기 동안 멈춤 | Kiro(타이머 멈춤), Orca(호박색 ?), Warp(blocked) | F1 2줄 | 중간. 권한 요청이 시작·끝나는 mod 이벤트가 있는지 먼저 확인해야 한다(classic `PermissionRequest` 훅 입력 타입은 있음) |
| 5 | **좁을 때 자르지 말고 접기·쌓기, 숫자 먼저**: 지금의 "7일 → 프로젝트 이름 → 막대 순으로 덜어내기"에 더해, `ctx 72%`처럼 숫자를 라벨보다 앞에 둔다. 아주 좁으면 Orca Compact처럼 "가장 빡빡한 한도 하나"만 남긴다 | Copilot 1.0.60, Orca Compact·+N, Morony | F1, F2 | 높음. 순수 렌더링이다. 3줄 높이 고정과 충돌하지 않게 "쌓기"보다 "접기"를 우선 |
| 6 | **높이 기준 추가**: `layout: auto`가 폭뿐 아니라 높이도 본다(예: 행이 적으면 밴드 3줄 → 2줄, 사이드바 대신 밴드). config에 auto/always/never와 임계값 | Crush(높이 30), lazygit portraitMode, Copilot(짧은 터미널) | F2 | 중간. `RenderViewport.rows`는 있다 [타입 확인]. 다만 "a change of height alone re-draws nothing"(높이만 바뀌면 다시 그리지 않음)이라 높이 변화는 다음 폭·props 변화 때 반영된다. 모니터를 옮기면 폭도 같이 바뀌는 경우가 많아 실사용에는 충분할 수 있다 |
| 7 | **중단 후 "실행 중" 표시 고착 방지**: Esc 중단 때도 `turn.complete`가 오는지 확인하고, 안 오면 다음 `turn.start`나 시간 초과로 2줄을 비운다 | iTerm2 3.7.5 "Esc → idle" 수정, Orca v1.4.240 "stale Working" 수정 | F1 2줄 | 높음. 확인 작업이 먼저다 |
| 8 | **Orca와 알림 겹치지 않기**: hubblerc가 OS 알림(`$.ui.notify`)을 추가한다면 기본은 끄거나, Orca가 못 주는 것(압축 직전, 한도 95%)에만 쓴다 | Orca(working→idle 알림), Codex·OpenCode·Crush·Cursor(포커스 밖일 때만) | 새 아이디어(알림) | 높음(API 있음). 포커스 감지는 타입에서 못 찾았다 |

**우선순위 중간**

| # | 아이디어 | 어디서 | hubblerc 관련 | mod 구현 가능성 [추론] |
|---|---|---|---|---|
| 9 | **OSC 7501로 Orca에 상태 보내기**: `blocked:kind=permission:msg=<승인 대기 내용>`, `working:progress=<할 일 %>`, 서브에이전트는 `id=sub/<이름>` | OSC 7501 명세, Orca v1.4.232, Kiro | 새 아이디어(바깥 터미널 연동), F1 정보를 Orca 탭·행으로 | 불확실. 원시 터미널 쓰기 API를 못 찾았다. `$.process.run`으로 `/dev/tty`에 쓰는 우회가 될지는 미확인이고, Ink 화면과 섞일 위험이 있다. Orca 자체 훅과 겹칠 수 있다 |
| 10 | **effort 단계에 뜻 붙이기**: 슬라이더에 `3: high — 고칠 곳은 알지만 어려움`처럼 한 줄 설명 | Amp Dial | F3 슬라이더 | 높음. 텍스트만 바꾸면 된다. 한 줄 폭을 넘으면 사이드바에서만 |
| 11 | **한도 임박 시 effort 자동 강등**(선택 기능): 5시간 한도가 95%를 넘으면 auto effort가 한 단계 낮춘다. 바꿀 때 토스트로 알림 | Copilot `continueOnAutoMode` | F3 auto 확장 | 높음. `turn.step`에서 effort를 바꾸는 방식 그대로. 사람이 고른 값은 건드리지 않는다 |
| 12 | **세션 범위 표시 강화**: effort가 이 세션 한정인지 영구인지 늘 표시(이미 `(세션)` 표기가 있음). `/model --session`처럼 "전역은 그대로"를 문구로 | Copilot 1.0.72, Cursor "다른 선택 유지" | F3 | 이미 대부분 있음 |
| 13 | **목표 고정 표시**: 지금 답변의 질문을 한 줄로 줄여 2줄 또는 사이드바 맨 위에 둔다 | Copilot pinned prompt·inferred objective | F1 2줄 "대기 중" 자리, F2 | 높음. `turn.start` 텍스트(spec의 제목 규칙 재사용) |
| 14 | **목차에서 답변별 변경 펼치기**: 목차 항목을 누르면 그 답변의 변경 파일 +/−를 펼친다(실제 diff는 안 그림) | Cursor `/rewind` 턴별 diff 타임라인, OpenCode 최근 턴 diff, Aider `/diff` | F2 목차, F5 | 중간. 데이터는 F5에 이미 있다. spec이 "중복"이라며 뺀 부분과 겹치니 펼침 방식으로만 |
| 15 | **답변 끝 요약에 토큰·비용 선택 표시**: config로 켜면 `· 12k tok · $0.08(추정)` | Cline 2.0, Aider, Antigravity `cost.estimated` | F5 요약 줄 | 중간. 답변별 usage를 얻을 수 있는지 확인 필요. 정가 추정이면 "추정" 표기 |
| 16 | **도구 경과 시간 실시간 표시**: Bash 용도 줄 끝에 `12s`(이미 밴드 2줄에는 있음) | Copilot 1.0.87, Cursor `showStatusLineRunningTime` | F4 | 중간. 행 다시 그리기 주기에 달렸다 |
| 17 | **외부 호출 스로틀·타임아웃·실패 차단**: git 미커밋 조회를 300ms에 1번 이하로, 5초 넘으면 중단, 연속 실패 시 세션 동안 끔 | Antigravity statusLine 규칙 | F1(브랜치·미커밋) | 높음. 구현 수칙이다 |

**우선순위 낮음 / 나중에**

| # | 아이디어 | 어디서 | hubblerc 관련 | mod 구현 가능성 [추론] |
|---|---|---|---|---|
| 18 | **`/activity standup`**: 최근 24시간 답변 요약(바꾼 파일, 시간)을 날짜별로 | Copilot `/chronicle standup` | F5, 후보 "누적 비용·시간" | 중간. `$.store` 4MB 한도 안에서 요약만 저장 |
| 19 | **"토큰이 어디 갔나" 설명**: `/activity <번호> tokens`로 그 답변의 도구별 토큰 비중 | Amp Explain Usage, Kiro `/context` 파일별 % | F5 | 불확실. 답변별 토큰 분해 데이터가 있는지 미확인 |
| 20 | **error 상태**: 모델 요청 오류·MCP 끊김 때 밴드 앞에 빨간 점과 한 줄 | iTerm2 3.7.5 "API error → error", Orca 빨간 점 | 후보 "MCP 끊김 경고", F1 | 중간. 요청 실패 이벤트가 있는지 확인 필요 |
| 21 | **서브에이전트를 하위 행으로**: 사이드바에서 서브에이전트를 리드 아래 접히는 행으로, 상태 점 포함 | Orca 하위 행, Codex agents 대시보드, Kiro Crew monitor | F2 사이드바, 후보 "백그라운드 작업 진행" | 높음. `$.agent.list()`가 있다 |
| 22 | **레이아웃 프리셋 커맨드**: `/panel compact`, `/panel full`처럼 이번 세션만 바꾸는 인자 | Codex 0.164 quick dial | F1·F2 | 높음 |
| 23 | **Orca 워크트리 코멘트 연동**: 답변 끝 요약 첫 줄을 `orca worktree set --comment`로 남긴다(선택 기능) | Orca worktree comment | F5, 새 아이디어 | 중간. `$.process.run`으로 가능해 보이나, 사용자 글을 덮어쓸 수 있으니 기본 꺼짐 |
| 24 | **포커스 잃었을 때 요약**: 긴 답변이 끝나면 작은 모델로 한 줄 요약을 만들어 3줄에 둔다 | Codex `tui.auto_recap` | F1 3줄, F5 | 중간. 포커스 이벤트는 없을 것으로 보인다. "긴 답변"으로 대체 |

**하지 말 것 (근거 있음)**
- OSC 9;4 진행률을 hubblerc가 따로 보내지 않는다. Claude Code에 이미 `terminalProgressBarEnabled`가 있다는 기록이 있고 [커뮤니티], OSC 7501 명세도 9;4와 7501이 섞이는 것을 경계한다 [공식](2-2). Ghostty에서는 OSC 9 알림과 겹친다 [공식](2-5).
- 여러 세션 관리 사이드바를 TUI 안에 만들지 않는다. Amp가 만들었다가 없앴고 [공식](1-6), Orca가 이미 한다 [공식](2-1).
- 터미널 탭 제목(OSC 0/2)을 hubblerc가 바꾸지 않는다. Orca가 Claude Code 상태 점을 OSC 제목으로 받으므로 [공식](2-1) 충돌할 수 있다.

**hubblerc가 이미 앞선 것 (비교 결과)**
- F4 Bash 용도 표시: 조사한 문서에서 같은 기능을 보지 못했다. 따로 찾아보지는 않았으니 "없다"는 확정이 아니다.
- F5 답변 끝 요약 줄(`2m13s · 3파일 +24 −3 · Read 5 …`): 가장 가까운 것은 Cline 2.0의 세션 끝 요약과 Copilot의 세션 +/− 토글이다. 답변 단위는 hubblerc가 더 촘촘하다.
- F2 목차 클릭 이동 + 세션 변경 파일 누적: Copilot `/diff` 파일 트리, Cursor `/changes`가 비슷하지만 "어느 답변에서 바꿨나"(`#3 #7`)를 붙인 것은 보지 못했다.
- F3 auto effort: 프롬프트별 effort 자동 선택은 조사한 도구 중 없다(1절). Amp `amp.ai.decide/choice`가 hubblerc의 `$.model.classify`와 같은 종류의 API라 판정 설계에 참고할 만하다.
- 테마: hubblerc의 "터미널 색 이름만 쓰기" 결정은 Kiro("named ANSI colors instead of hardcoded hex"), OpenCode `system`, Antigravity `terminal`과 같은 방향이다.

### Gaps
- 승인 대기(권한 요청) 시작·끝, 모델 요청 실패, MCP 연결 상태를 mod 이벤트로 받을 수 있는지: classic 훅 입력 타입에 `PermissionRequest`·`Notification`은 있지만 mod 이벤트로 쓸 수 있는지는 확인하지 않았다(다른 조사자 영역).
- mod가 터미널에 원시 이스케이프를 쓸 수 있는지, `/dev/tty` 우회가 안전한지: 확인하지 못했다. 아이디어 #9의 가능 여부가 여기에 달렸다.
- 터미널 포커스(창이 앞에 있는지)를 mod가 아는지: 타입의 `isFocused`는 패널이 키보드를 가졌는지일 뿐이다. 터미널 창 포커스 정보는 찾지 못했다. 그래서 "포커스 밖일 때만 알림"(Codex·OpenCode·Crush·Cursor)은 mod로 그대로 옮기기 어렵다. 엔진 알림 채널 쪽에서 처리하는지는 미확인이다. 뷰포트 높이는 `RenderViewport.rows`로 받는다(아이디어 #6).
- MCP: `$.mcp.connect(server)`, `mcp.call` 인자 타입은 있다. 연결이 끊긴 것을 알려 주는 이벤트가 있는지는 확인하지 않았다(아이디어 #20, 후보 "MCP 끊김 경고").
- 답변별 토큰·비용 분해 데이터를 mod에서 얻을 수 있는지(아이디어 #15, #19).
