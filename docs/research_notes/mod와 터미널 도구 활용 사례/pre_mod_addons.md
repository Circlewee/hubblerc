# mod 이전 Claude Code 터미널 생산성 애드온 생태계 (statusLine · 사용량 모니터 · 훅 도우미 · 세션 관리자 · 기록 뷰어)

조사일 2026-10-26. 별 수와 마지막 push 날짜는 2026-10-26에 GitHub API(`/repos`, `/search/repositories`)로 받은 값이다. 표시: [공식] Anthropic 문서, [커뮤니티] 서드파티 저장소·블로그, [추론] 내 판단. 각 항목 끝의 "→ hubblerc"는 관련 기능(F1~F5, 후보)이나 구현 요령이다.

---

## Q1. statusLine 도구들은 무엇을 보여 주나? 공통 항목과 드문 항목, 인기, 요청 기능

### Takeaway
모든 도구에 들어가는 기본 묶음은 "모델 · 컨텍스트 % · git 브랜치 · 5h/7d 한도 %와 리셋 · 세션 비용"이다. hubblerc F1 1줄은 이 묶음과 거의 같다. 도구끼리 갈리는 곳은 소진 예측(pace), 프롬프트 캐시 타이머, 세션 줄 +/−, worktree 표시, 그리고 실행 중 도구·에이전트·할 일 줄이다. 실행 중 활동 줄은 claude-hud 계열(4/13)에만 있는데, statusLine 입력에 그 데이터가 없어서 대화 기록 파일을 파싱해야 하기 때문이다. 이슈에서 가장 많이 나오는 문제는 폭 감지와 줄 바꿈 버그, 사용량 API 429, effort/컨텍스트 값의 정확도다.

### Cited Findings

**인기와 활동 (2026-10-26 기준)**

| 도구 | 별 | 마지막 push | 비고 |
|---|---|---|---|
| jarrodwatts/claude-hud | 28,877 | 2026-10-26 (v0.13.1) | 2026-01-02 생성. 플러그인으로 배포. 열린 이슈 0개 (296개 모두 닫힘) |
| ccusage/ccusage (예전 ryoppippi/ccusage) | 19,175 | 2026-10-25 | 사용량 리포트 + `ccusage statusline`(Beta) |
| sirmalloc/ccstatusline | 13,405 | 2026-10-19 (v2.2.32) | 위젯 편집 TUI. 열린 이슈 78개 |
| Haleclipse/CCometixLine | 3,485 | 2026-10-24 | Rust. v2에서 새로 작성됨. companion mod 있음 |
| nilbuild/claude-statusline | 1,394 | 2026-04-03 | 개인 설정 수준 |
| Owloops/claude-powerline | 1,175 | 2026-10-25 | 웹 설정기 powerline.owloops.com |
| GaoSSR/best-claude-hud | 998 | 2026-08-13 | Rust |
| chongdashu/cc-statusline | 646 | 2026-02-16 | bash 생성기 |
| daniel3303/ClaudeCodeStatusLine | 616 | 2026-05-26 | |
| uppinote20/claude-dashboard | 583 | 2026-10-16 | mod 판(패널·밴드)을 같이 배포 |
| Nanako0129/coralline | 549 | 2026-10-21 | p10k 스타일, burn ETA |
| rz1989s/claude-code-statusline | 480 | 2026-08-01 | |
| stephenleo/cship | 428 | 2026-09-06 | Starship TOML |
| leeguooooo/claude-code-usage-bar (claude-statusbar) | 383 | 2026-10-25 | 학습형 소진 예측 |
| Astro-Han/claude-pace | 241 | 2026-09-24 | bash+jq, pace |
| kcchien/claude-code-statusline | 197 | 2026-03-24 | 0 값 숨김 |

출처: 각 저장소 API 응답(접속 2026-10-26). 예: [claude-hud](https://github.com/jarrodwatts/claude-hud), [ccstatusline](https://github.com/sirmalloc/ccstatusline), [CCometixLine](https://github.com/Haleclipse/CCometixLine), [claude-powerline](https://github.com/Owloops/claude-powerline), [ccusage](https://github.com/ccusage/ccusage), [claude-dashboard](https://github.com/uppinote20/claude-dashboard), [coralline](https://github.com/Nanako0129/coralline), [claude-statusbar](https://github.com/leeguooooo/claude-code-usage-bar), [cship](https://github.com/stephenleo/cship), [kcchien](https://github.com/kcchien/claude-code-statusline), [daniel3303](https://github.com/daniel3303/ClaudeCodeStatusLine), [cc-statusline](https://github.com/chongdashu/cc-statusline), [best-claude-hud](https://github.com/GaoSSR/best-claude-hud).
- [커뮤니티] awesome-claude-code(별 56,537)에는 "Status Lines" 분류가 따로 있고, CCometixLine, ccstatusline, Claude HUD, claude-powerline, claude-statusbar, tmux-claude-status-tabs 등이 올라 있다. 같은 목록에 "Mods" 분류도 생겼다(prismantis, Review Inbox) — [awesome-claude-code README](https://github.com/hesreallyhim/awesome-claude-code) (접속 2026-10-26)
- [커뮤니티] 2026-04 중국어 가이드는 claude-hud를 "htop 같은 세션 모니터", ccstatusline을 "꾸미기용"으로 나눴다(당시 별: hud 약 1.8만, ccstatusline 약 7천) — [heyuan110.com](https://www.heyuan110.com/zh/posts/ai/2026-04-10-claude-hud-guide/) (2026-04-10). 같은 검색에서 나온 비교 글들은 품질이 고르지 않아 이 구분만 인용한다.

**항목별 빈도 (README 기준 13개 도구: hud, ccstatusline, CCometixLine, powerline, ccusage statusline, claude-statusbar, claude-dashboard, cship, coralline, kcchien, daniel3303, cc-statusline, best-claude-hud)**

README에서 확인한 항목만 셌다. README에 없으면 "없음"으로 셌으므로 실제보다 적게 나왔을 수 있다.

| 항목 | 도구 수 | 비고 |
|---|---|---|
| 모델 이름 | 13/13 | |
| 컨텍스트 % 또는 막대 | 13/13 | 대부분 초록→노랑→빨강 단계색 |
| git 브랜치(+dirty) | 12/13 | ccusage만 없음 |
| 세션 비용 | 12/13 | hud·claude-statusbar·best-hud는 기본 꺼짐 |
| 5h/7d 공식 % + 리셋 | 11/13 (+부분 2) | ccusage는 블록 비용·남은 시간, cc-statusline은 리셋 타이머만 |
| effort | 11/13 | 공식 `effort.level` 필드가 생긴 뒤 빠르게 퍼짐 |
| 세션 줄 +/− | 9/13 | 공식 `cost.total_lines_added/removed` 또는 git diff |
| 소진 예측 / pace / burn rate | 8/13 | Q2에서 자세히 |
| 세션 경과 시간 | 8/13 | |
| worktree 표시 | 7/13 | 공식 `workspace.git_worktree`, `worktree.*` |
| 프롬프트 캐시 남은 시간·적중률 | 7/13 | 공식 `prompt_cache`(v2.1.251+) |
| 오늘 누적 비용 | 5/13 | hud, CCometixLine, powerline(+월), ccusage, claude-dashboard |
| 출력 속도·TTFT | 5/13 | |
| 서브에이전트 | 5/13 | hud, CCometixLine(mod 필요), claude-statusbar(기본 꺼짐), claude-dashboard, kcchien(이름만) |
| 실행 중 도구 | 4/13 | hud, CCometixLine(mod 필요), claude-statusbar, claude-dashboard |
| 압축 횟수 / 압축까지 남은 양 | 3/13 | hud, ccstatusline, CCometixLine |
| 할 일 진행 | 3/13 | hud, claude-statusbar, claude-dashboard |

출처: [claude-hud README](https://github.com/jarrodwatts/claude-hud), [ccstatusline docs/USAGE.md](https://github.com/sirmalloc/ccstatusline/blob/main/docs/USAGE.md), [CCometixLine README](https://github.com/Haleclipse/CCometixLine), [claude-powerline README](https://github.com/Owloops/claude-powerline), [ccusage statusline 가이드](https://ccusage.com/guide/statusline), [claude-statusbar docs/segments.md](https://github.com/leeguooooo/claude-code-usage-bar/blob/main/docs/segments.md), [claude-dashboard README](https://github.com/uppinote20/claude-dashboard), [cship README](https://github.com/stephenleo/cship), [coralline README](https://github.com/Nanako0129/coralline) 등 (모두 접속 2026-10-26)

**드문 항목 (1~2개 도구)**
- [커뮤니티] ccstatusline: Claude 서비스 상태(`status.claude.com`, 48시간 장애 기록), Git PR·CI 상태, 샌드박스 상태, 음성 입력 상태, 계정 이메일, 메모리 사용량, 터미널 폭 — [docs/USAGE.md](https://github.com/sirmalloc/ccstatusline/blob/main/docs/USAGE.md)
- [커뮤니티] claude-hud: 로그인 플랜(`Claude Max 20x`), `/add-dir` 추가 폴더, 마지막 응답 이후 경과(`showLastResponseAt`), advisor 모델, 사용자 지정 문구(`customLine`), 실패한 MCP 서버 이름 — [README](https://github.com/jarrodwatts/claude-hud), [CHANGELOG #699](https://github.com/jarrodwatts/claude-hud/blob/main/CHANGELOG.md)
- [커뮤니티] claude-dashboard: 마지막 프롬프트와 시각(`lastPrompt`), 다른 CLI(Codex/Gemini/Antigravity) 사용량, "peakHours" — [README](https://github.com/uppinote20/claude-dashboard)
- [커뮤니티] CCometixLine: 컨텍스트 구성 내역(`context.breakdown`), 턴당 컨텍스트 증가량(`context.trend`), 캐시가 식었을 때 드는 비용(`cache.cold_cost`) — [README](https://github.com/Haleclipse/CCometixLine)
- [커뮤니티] powerline: tmux 세션 이름, 환경 변수 값, 월 예산 — [README](https://github.com/Owloops/claude-powerline)
- [커뮤니티] 재미 요소: 가상 펫(terryso/ccpet 64★), 표정 이모티콘(claude-code-personalities), 세션별 생물(TermaGITchi), CO2(claude-carbon), 재생 중인 음악(Autumn1337/better-statusline 344★) — [awesome-claude-code](https://github.com/hesreallyhim/awesome-claude-code), GitHub 검색(접속 2026-10-26)

**도구별 특징 (hubblerc와 관련 있는 것만)**
- [커뮤니티] claude-hud 기본은 2줄(`[Opus] │ my-project git:(main*)` / `Context █████░░░░░ 45% │ Usage ██░░░░░░░░ 25% (resets in 1h 30m)`)이고, 도구·에이전트·할 일 줄은 켜야 나온다. hubblerc F1 시안의 2줄 형식(`◐ Edit: auth.ts | ✓ Read ×3`, `◐ explore [haiku]: Finding auth code (2m 15s)`, `▸ Fix authentication bug (2/5)`)은 이 README와 같은 꼴이다 — [README](https://github.com/jarrodwatts/claude-hud) → hubblerc: F1은 claude-hud 레이아웃을 이어받았다.
- [커뮤니티] claude-hud는 7일 한도를 기본적으로 80% 이상일 때만 보여 준다(`display.sevenDayThreshold` 기본 80). 사용량 전체도 `usageThreshold`로 숨길 수 있다 — [README](https://github.com/jarrodwatts/claude-hud) → hubblerc F1: 좁을 때 7d부터 덜어내는 것과 별도로, "평소엔 숨기고 높아지면 보이기" 규칙을 둘 수 있다.
- [커뮤니티] claude-hud의 컨텍스트 경고는 70%, 위험은 85%이고, 85%를 넘으면 토큰 내역이 자동으로 붙는다(`showTokenBreakdown`). `autoCompactWindow`를 주면 % 기준을 자동 압축 창으로 바꿔 `/context` 숫자와 맞춘다 — [README](https://github.com/jarrodwatts/claude-hud) → hubblerc 후보 "자동 압축 직전 경고".
- [커뮤니티] kcchien: "Smart hiding — Zero values (`+0/-0`, `0m0s`, rate limits) are hidden" (0 값은 숨긴다), 컨텍스트 크기는 모델 이름에 이미 없을 때만 보여 준다 — [README](https://github.com/kcchien/claude-code-statusline) → hubblerc F1·F5 3줄: `파일 +0 −0` 같은 0 항목은 빼는 규칙.
- [커뮤니티] CCometixLine 팔레트 `terminal`은 "follows your terminal theme"(터미널 테마를 따른다), 항목마다 text/bar/gauge/sparkline/pace 형태와 공간이 모자랄 때 쓸 짧은 템플릿 3개를 둔다. 좁으면 항목 사이에서 줄을 바꾸고, 오른쪽 묶음은 오른쪽에 붙인다 — [README](https://github.com/Haleclipse/CCometixLine) → hubblerc F1: 색 이름만 쓰는 현재 방침과 같은 방향. "폭별 짧은 형태" 아이디어(`5h 25% ↻1h30m` → `5h 25%`).
- [커뮤니티] claude-statusbar는 좁은 패널에서 한도 막대를 세로로 쌓는다(`narrow_layout stack`), 막대 글리프로 얇은 선 `━`를 고를 수 있다 — [README](https://github.com/leeguooooo/claude-code-usage-bar) → hubblerc F1·F2.

**사용자 요청 (이슈 반응 순, 2026-10-26 조회)**
- [커뮤니티] ccstatusline 상위: #126 Claude Code 입력의 `context_window` 쓰기(👍20, 2025-12), #329 Thinking 값 부정확(19), #124 블록 타이머를 남은 시간으로(13), #239 `/effort max`로 바꿔도 effort가 안 바뀜(10), #94 `/usage` 실시간 그래프(9, 댓글 16), #114 켜진 MCP 목록(9, 열림), #226·#277 미리 만든 테마·템플릿(9·8, 열림), #38 값에 따른 동적 색(9, 열림), #363 컨텍스트 % 임계값 색(7, 열림), #397 여러 세션 동시 실행 시 CPU 과다(7, 열림), #299 백그라운드 서브에이전트 위젯(5, 열림), #25 tmux 세션 이름(3, 열림) — [ccstatusline issues](https://github.com/sirmalloc/ccstatusline/issues)
- [커뮤니티] claude-hud 상위는 대부분 버그다: #173·#187 사용량 API 429(16·5), #392·#436·#407·#151 줄 바꿈과 터미널 폭 문제(8·7·5·2), #91 컨텍스트 값 틀림(4), #271 effort 표시 요청(3, 댓글 9). 기능 요청 제목은 7일 표시 임계값(#98), Bedrock/Vertex 비용(#621), 캐시 TTL 카운트다운(#400), 출력 속도(#72), worktree 표시(#780), 하루 누적 비용(#695), 요소 순서 바꾸기(#654·#827), 항목별 색(#688) — [claude-hud issues](https://github.com/jarrodwatts/claude-hud/issues?q=is%3Aissue)
- [커뮤니티] claude-powerline: #27 "Accounting does not keep track of tokens/costs used by subagents"(서브에이전트 토큰·비용이 집계되지 않는다), #38 컨텍스트 사용률별 색, #81 캐시 만료 타이머 — [powerline issues](https://github.com/Owloops/claude-powerline/issues)
- [커뮤니티] CCometixLine 상위는 중국어 버그 보고(토큰 %가 안 보임 #69, Opus 4.6 1M을 Sonnet으로 오인 #93, 2.1.56 이후 상태줄 사라짐 #90) — [CCometixLine issues](https://github.com/Haleclipse/CCometixLine/issues)

### Inferences
- [추론] 반응이 많은 이슈 대부분은 "엔진이 준 값과 화면 값이 다르다"(context, effort, thinking)와 "폭·줄 바꿈" 문제다. mod는 `$.session.usage()`, `$.session.model()`처럼 엔진 값을 직접 받고 `e.viewport.columns`로 폭을 알기 때문에, 이 두 종류의 버그 원인이 줄어든다. hubblerc F1이 이미 이 구조를 쓴다.
- [추론] 빈도표 기준으로 F1에 없는 흔한 항목은 세션 줄 +/−(9/13), 세션 시간(8/13), worktree 표시(7/13), 프롬프트 캐시(7/13)다. 사용자는 Orca에서 worktree를 쓰므로 worktree 표시가 가장 쓸모 있어 보인다.
- [추론] "비용 기본 숨김"은 hud(`showCost` 기본 false)와 claude-statusbar(opt-in, "API-equivalent value … not money owed": API로 쳤을 때의 금액이지 낼 돈이 아니다)와 같은 판단이다.

### Gaps
- cship, best-claude-hud, rz1989s, claude-pace, nilbuild는 README만 훑었다. 빈도표에서 "없음"은 README에서 못 찾았다는 뜻이다.
- 설치 수(npm·PyPI 다운로드)는 보지 않았다. 별 수만 인기 지표로 썼다.
- GitHub API 무인증 한도(시간당 60회)를 다 써서 이슈 본문과 댓글은 몇 개만 읽었다.

---

## Q2. 사용량·한도 모니터는 소진 예측과 비용·토큰 집계를 어떻게 하나?

### Takeaway
지금 대부분은 엔진이 statusLine에 주는 공식 `rate_limits`(%, `resets_at`)를 기준으로 쓴다. 그 위에 소진 예측을 얹는 방식은 네 가지다: (1) 지금 속도를 리셋까지 직선으로 늘린 예상 % (claude-hud, claude-statusbar), (2) 사용률 − 경과율 차이 (CCometixLine `⇡8%`, powerline `60%/40%`), (3) 다 쓸 때까지 남은 시간(ETA)과 5h·7d 중 먼저 닿는 쪽 (coralline, claude-dashboard), (4) 최근 속도·창 평균·기준선을 섞은 학습형 (claude-statusbar). 대화 기록(JSONL)으로 토큰을 세던 옛 방식(ccusage `blocks --live`, Claude-Code-Usage-Monitor의 플랜별 고정 한도·P90)은 공식 값으로 넘어가는 중이다. ccusage는 v18에서 live 모니터를 뺐다.

### Cited Findings
**공식 입력**
- [공식] `rate_limits.five_hour.used_percentage` / `seven_day.used_percentage`(0~100)와 `resets_at`(유닉스 초). Pro/Max 구독자에게만, 세션의 첫 API 응답 뒤에 오고, 창마다 따로 빠질 수 있다. 엔진은 `resets_at`이 지난 창을 뺀다 — [statusline 문서](https://code.claude.com/docs/en/statusline) (접속 2026-10-26)
- [공식] `cost.total_cost_usd`는 "computed client-side at list price"(클라이언트가 정가로 계산)이고 실제 청구와 다를 수 있으며 `/clear` 때 0으로 돌아간다. `cost.total_duration_ms`는 resume을 넘어 누적된다 — [statusline 문서](https://code.claude.com/docs/en/statusline)

**계산 방식**
- [커뮤니티] claude-hud `display.usagePace`(2026-10-01 병합, PR #779): "Pace projects the used percentage in a straight line to the window's reset."(사용률을 리셋 시점까지 직선으로 늘린다) 예상치가 90% 이상이면 amber, 리셋 전에 다 쓰면 빨강이고 `▲`를 붙인다. "Below 10% used pace stays normal, so a short burst at the start of a window does not flag"(10% 미만이면 판정하지 않아, 창 초반의 짧은 폭주에 경고가 뜨지 않는다). 리셋 시각이 없거나 지났거나 너무 멀면 pace를 내지 않는다 — [PR #779](https://github.com/jarrodwatts/claude-hud/pull/779), [README](https://github.com/jarrodwatts/claude-hud) → hubblerc 후보 "5시간 소진 예측": 가장 단순한 기준선. `예상 = used% ÷ (경과 ÷ 창 길이)`, 경과 = 창 길이 − (resets_at − now) [추론: 문서에 식은 없고 "직선"이라는 말만 있다].
- [커뮤니티] CCometixLine `quota.5h`/`quota.7d` 기본 형태는 2단 pace 막대다: "the upper row is what you have used, the lower row how much of the window has passed. `⇡8%` means you are 8 points ahead of the clock"(윗줄은 쓴 양, 아랫줄은 지난 시간. `⇡8%`는 시계보다 8%p 앞섰다는 뜻). 따로 `quota.eta`(다 쓰는 시각), `quota.spend`, `cost.rate`(시간당) 지표가 있다 — [README](https://github.com/Haleclipse/CCometixLine)
- [커뮤니티] claude-powerline `showPace`: 실제 사용량 뒤에 "the usage an even spend would have reached by now"(고르게 썼다면 지금쯤 닿았을 양)를 붙인다. 예: `◱ ▰▰▰▰◆▰▱▱▱▱ 60%/40% (3h)`, `◆`는 초과, `◇`는 미달 — [README](https://github.com/Owloops/claude-powerline)
- [커뮤니티] ccstatusline: 사용량 막대에 "time cursor"(창 안에서 지난 시간 위치)를 표시할 수 있다(v2.2.9~12). 세션 비용의 시간당 속도 위젯(v2.2.31)도 있다 — [README](https://github.com/sirmalloc/ccstatusline) → hubblerc F1: 한 줄짜리 얇은 막대 `━━──`에 경과 위치 표시 한 글자만 넣으면 pace를 나타낼 수 있다 [추론].
- [커뮤니티] coralline `burn` 세그먼트(이슈 #17, 2026-06-18): 동기는 "neither tells you **which wall you hit first** or **when, at your current pace**"(어느 벽에 먼저, 지금 속도로 언제 닿는지 알려 주는 게 없다). 5h는 "the estimator derives a rate from 1%-crossing timestamps"(1%를 넘는 시각들로 속도를 잰다), 이유는 "the `used_percentage` is effectively stepwise"(사용률이 사실상 계단식이다). 7d는 `rate = used/elapsed`. 표시는 `min(ETA_5h, ETA_7d)`이다. 샘플은 `~/.claude/coralline/burn-5h.tsv`에 쌓고, 기본 창은 600초 — [issue #17](https://github.com/Nanako0129/coralline/issues/17), [README](https://github.com/Nanako0129/coralline) → hubblerc 구현 요령: `$.session.usage()`의 percentUsed가 정수 단위로 움직이면 짧은 구간 기울기는 0이나 튀는 값이 된다. 1%p가 바뀐 시각들을 `$.state`에 기록해 기울기를 구한다.
- [커뮤니티] claude-statusbar: `→42%`는 "Projected end-of-window usage at your current rhythm"(지금 리듬이면 창 끝에 닿을 사용률), 80% 미만은 흐리게, 80% 이상 노랑, 100% 이상 빨강. "The 5h model blends recent pace + whole-window average + a local baseline; the 7d model integrates learned day/night/weekend buckets so a busy first day isn't extrapolated across the week."(5h는 최근 속도·창 평균·로컬 기준선을 섞고, 7d는 학습한 낮/밤/주말 구간을 써서 바쁜 첫날을 한 주 전체로 늘리지 않는다) 별도 경고 칩 `⚠~18m`은 "only when a window is projected to hit 100% **and** the cap is imminent (≤ 1 h)"(100%에 닿을 것으로 예상되고, 그 시점이 1시간 이내일 때만) 나온다 — [docs/segments.md](https://github.com/leeguooooo/claude-code-usage-bar/blob/main/docs/segments.md) → hubblerc: "예상 %"와 "임박 경고"를 나누면 평소에는 조용하다.
- [커뮤니티] claude-dashboard `depletionTime`은 "Assumes all utilization came from this session; improves as session runs longer"(사용량이 모두 이 세션에서 나왔다고 가정한다. 세션이 길수록 나아진다) — [README](https://github.com/uppinote20/claude-dashboard) → hubblerc: 여러 기기(맥·스튜디오·미니)에서 같은 계정을 쓰면 한 세션의 토큰으로 속도를 재는 방식은 틀린다. 공식 % 변화로 재야 한다 [추론].
- [커뮤니티] coralline `VL_LIMIT_SYNC=1`은 같은 계정의 여러 세션이 열린 5h·7d 창 값을 파일로 나눠 갖는다 — [README](https://github.com/Nanako0129/coralline)
- [커뮤니티] ccusage statusline 예: `🤖 Fable 5 (high) | 💰 $0.23 session / $1.23 today / $0.45 block (2h 45m left) | 🔥 $0.12/hr | 🧠 25,000 (12%)`. burn rate는 $/시간이고 색은 토큰/분 기준(2,000 미만 초록, 2,000~5,000 노랑, 5,000 초과 빨강). 기본은 오프라인 가격표 — [ccusage statusline 가이드](https://ccusage.com/guide/statusline) (페이지 날짜 없음, 접속 2026-10-26)
- [커뮤니티] ccusage 블록: 첫 메시지에서 시작해 정확히 5시간, UTC로 경계를 계산하고, 빈 시간은 따로 표시한다. "The `blocks --live` monitor feature has been removed in v18.0.0"(v18.0.0에서 live 모니터를 뺐다), statusline을 대신 쓰라고 한다. `--token-limit max`는 이전 블록 중 최댓값을 한도로 쓴다 — [ccusage blocks 가이드](https://ccusage.com/guide/blocks-reports)
- [커뮤니티] Claude-Code-Usage-Monitor(8,764★, 마지막 push 2026-07-05): burn rate는 "Gathers token usage from all sessions in the last hour … Calculates tokens consumed per minute"(지난 1시간 모든 세션의 토큰으로 분당 소비량을 구한다). 기본 Custom 플랜은 최근 192시간(8일) 기록의 P90으로 한도를 추정한다. 지금은 `--statusline`으로 공식 `rate_limits`를 받아 "live source of truth when fresh"(신선하면 기준값)로 쓰고, 오래되면 "labeled local estimates"(추정이라고 표시한 로컬 값)로 돌아간다. `--set-terminal-title`/`--title-format "{pct}% {plan}"`으로 터미널 제목에 사용률을 쓴다 — [README](https://github.com/Maciek-roboblog/Claude-Code-Usage-Monitor)
- [커뮤니티] 같은 저장소 이슈: #167 "Add Weekly Usage and Weekly Reset Day/Time"(👍20), #131 statusline 지원 요청(11), #106 리셋 시각 부정확(11), #121 시간대 문제(9), #128 "Add date/time context to 'Tokens will run out' prediction"(바닥나는 예측에 날짜·시각을 붙여 달라, 6), #94 계정 여러 개(6) — [issues](https://github.com/Maciek-roboblog/Claude-Code-Usage-Monitor/issues)
- [커뮤니티] ccusage 이슈 #483 "Live Blocks not accurate, Limit reached earlier"(댓글 27, 2025-08), #288 "Live token usage is *still* incorrect" — [ccusage issues](https://github.com/ccusage/ccusage/issues). 로컬에서 토큰을 세는 예측이 실제 한도와 어긋났다는 기록이다.

**누적(일/주)**
- [커뮤니티] claude-hud `showDailyCost`: `cost.total_cost_usd`를 플러그인 데이터 폴더의 작은 일별 장부에 모아 `Today $12.34`로 보여 주고, 자정에 초기화하며, 세션은 "from the first render that sees it"(처음 본 렌더부터) 센다. `showWeeklyCost`는 7일 창이 열린 시점부터 센다 — [README](https://github.com/jarrodwatts/claude-hud) → hubblerc 후보 "오늘 누적 비용": `$.store`에 `{날짜: {세션id: 마지막 cost}}`를 두고 합하면 된다. 세션별 마지막 값만 두므로 4MB 한도 걱정이 거의 없다 [추론].
- [커뮤니티] claude-powerline `today`/`month` 세그먼트와 예산(`budget.today.amount` 기본 50, `month` 기본 500, 경고 80%) — [README](https://github.com/Owloops/claude-powerline)
- [커뮤니티] ccusage는 `daily/weekly/monthly/session/blocks` 리포트를 내고 18개 이상의 CLI(Codex, OpenCode, Gemini 등)를 함께 집계한다 — [ccusage README](https://github.com/ccusage/ccusage/blob/main/apps/ccusage/README.md)

### Inferences
- [추론] hubblerc 소진 예측 추천 형태: 1줄 5h 항목에 경과 위치 커서와 예상 색만 넣고(hud식 직선 예측 + 10% 미만 무시), 1시간 안에 바닥날 때만 `⚠~18m` 같은 짧은 칩을 붙인다(claude-statusbar식). 속도는 coralline처럼 1%p가 바뀐 시각으로 잰다. 7d는 `used/elapsed`면 충분하다.
- [추론] hubblerc는 `$.session.usage()`의 rateLimits만 쓰므로 계정 단위 값이다. 다른 기기에서 쓴 양도 들어가니 "이 세션 속도"가 아니라 "계정 속도"로 표시하는 편이 정직하다.

### Gaps
- claude-hud pace의 정확한 코드 식은 소스를 열지 못해 확인하지 못했다(API 한도 소진). PR 설명의 "직선" 표현만 확인했다.
- ccusage `--live`가 projection을 어떻게 계산했는지는 문서에서 빠졌다(v18에서 제거됨).
- Anthropic이 `used_percentage`를 몇 단위로 내는지(정수인지 소수인지)는 공식 문서 예시(23.5, 41.2)에 소수가 있다. coralline이 "stepwise"라고 한 근거는 확인하지 못했다.

---

## Q3. 훅 기반 도우미: 알림, tmux/탭 제목, 안전 훅, 자동 포맷

### Takeaway
가장 흔한 패턴은 `Notification`(권한 요청·입력 대기)과 `Stop`(작업 끝)에 알림을 거는 것이다. 수단은 OS 알림, 소리, TTS, ntfy·Telegram·Lark 푸시, tmux 탭 상태색, 터미널 OSC 시퀀스가 있다. 2026-05의 v2.1.141부터 훅이 `terminalSequence`로 OSC 바이트를 엔진에 넘길 수 있어서 tmux·ssh 안에서도 창 제목과 알림을 쓸 수 있다. 공식 가이드의 예제 묶음(알림, 자동 포맷, 보호 파일 차단, 압축 후 컨텍스트 재주입, 설정 변경 감사, 권한 자동 승인)이 사실상 표준 레시피다.

### Cited Findings
- [공식] 훅 가이드 예제 목록: "Get notified when Claude needs input", "Auto-format code after edits", "Block edits to protected files", "Re-inject context after compaction", "Audit configuration changes", "Reload environment when directory or files change", "Auto-approve specific permission prompts" — [hooks-guide](https://code.claude.com/docs/en/hooks-guide) (접속 2026-10-26)
- [공식] `Notification` 종류: `permission_prompt`는 "the prompt has waited about six seconds"(권한 창이 약 6초 기다린 뒤), `idle_prompt`는 "Claude finished responding about 60 seconds ago and you haven't typed since"(답변 끝난 지 약 60초 동안 입력이 없을 때). 그 밖에 `agent_needs_input`, `agent_completed`, `quota_auto_resume_*` 등이 있다 — [hooks-guide](https://code.claude.com/docs/en/hooks-guide)
- [공식] 기본 데스크톱 알림은 Ghostty·Kitty·iTerm2에서만 된다. 그 밖에는 `preferredNotifChannel: "terminal_bell"`이나 Notification 훅을 쓴다. tmux는 passthrough가 필요할 수 있다 — WebSearch 요약이 인용한 [terminal-config 문서](https://code.claude.com/docs/en/terminal-config.md) (접속 2026-10-26, 원문 재확인은 안 함)
- [커뮤니티] `terminalSequence`: "[Claude Code v2.1.141] (May 13, 2026) added `terminalSequence` to hook JSON output", 엔진이 그 바이트를 자기 터미널에 쓰므로 tmux/screen 안에서도 된다. OSC 0/1/2(창 제목, 모든 주요 터미널), OSC 9(iTerm2, WezTerm, Windows Terminal; `9;4`는 작업 표시줄 진행률), OSC 99(Kitty), OSC 777(Ghostty, Warp, urxvt), BEL(모두). 예제는 Stop 훅에서 `{terminalSequence: "<OSC777><OSC9><OSC2 'Claude: done'>"}`을 출력한다 — [agentpatterns.ai](https://agentpatterns.ai/tool-engineering/terminal-sequence-hook-notifications/) (last_reviewed 2026-06-03) → hubblerc: Orca는 내장 터미널이라 어떤 OSC를 지원하는지 확인이 필요하다. mod에도 같은 출력 수단이 있는지는 다른 조사 범위다.
- [커뮤니티] tmux에서는 벨 플래그가 창 단위라 한 창 안의 여러 pane 중 어느 쪽인지 알 수 없다. 그래서 pane별 tmux 사용자 옵션 + 상태바 표시로 바꿨다는 글 — [kaskavalci 블로그](https://blog.kaskavalci.com/per-pane-claude-code-notifications-in-tmux) (날짜 미확인)
- [커뮤니티] 훅 입력에 터미널·탭 식별자가 없어서 "지금 이 탭을 보고 있으면 알림 생략"을 할 수 없다는 기능 요청 — [claudeissues.com #57592](https://claudeissues.com/issue/57592-feature-per-tab-focus-aware-notifications-hook-payload-lacks-terminal-tab-identi) (anthropics/claude-code 이슈 미러, 깊게 보지 않음)
- [커뮤니티] tmux 상태 표시: LiveNL/tmux-claude-status-tabs는 창 탭에 running(스피너), input(amber `?`), permission(red `!`), done(green `✓`)을 그린다. "Claude Code hooks repaint the tab within half a second of each lifecycle event, and a verifier checks every tab against Claude Code's own per-session status"(훅이 0.5초 안에 다시 그리고, 검증기가 엔진의 세션 상태와 대조한다) — [README](https://github.com/LiveNL/tmux-claude-status-tabs) (별 수 미확인). craftzdog/tmux-claude-hatch(403★, 2026-09-28)는 프로젝트별 팝업 세션, fzf 선택기의 working/waiting/idle 상태와 미리보기, 끝나면 실행한 창을 벨로 강조한다 — [README](https://github.com/craftzdog/tmux-claude-hatch). accessd/tmux-agent-indicator(99★), gs/tmux-agent-status(23★, "shows nothing while agents work, a small marker when one needs you": 일할 때는 아무것도 안 보이고, 필요할 때만 표시)도 있다 — GitHub 검색(2026-10-26)
- [커뮤니티] 알림 도구: mylee04/code-notify 288★(교차 플랫폼), ZekerTop/ai-cli-complete-notify 431★("耗时阈值", 걸린 시간 기준으로 알림, Lark/DingTalk/Telegram/메일), wyattjoh/claude-code-notification 95★(macOS 알림+소리), anotifier(데스크톱 토스트 + ntfy 폰 푸시) — GitHub 검색, [awesome-claude-code](https://github.com/hesreallyhim/awesome-claude-code). 소리 팩도 여럿 있다(StarCraft SCV, Warcraft 등, 15~41★).
- [커뮤니티] disler/claude-code-hooks-mastery(3,959★, 마지막 push 2026-03-04): 13개 훅 이벤트 전부의 예제. PreToolUse에서 `rm -rf`와 `.env` 접근 차단, Notification에서 TTS "Your agent needs your input", Stop에서 LLM이 만든 완료 문구를 TTS로 읽기, SessionStart에서 git 상태·최근 이슈 불러오기, 모든 이벤트를 `logs/`에 JSON으로 기록 — [README](https://github.com/disler/claude-code-hooks-mastery)
- [커뮤니티] 안전 훅 묶음: karanb192/claude-code-hooks 559★("safety, cost, observability, productivity"), sangrokjung/claude-forge 864★("21 safety hooks"), SethGammon/Citadel 928★ — GitHub 검색(2026-10-26)
- [커뮤니티] ccmanager는 세션 상태 변화 훅(busy/waiting/idle)을 제공해 알림 자동화에 쓴다 — [ccmanager README](https://github.com/kbwo/ccmanager)

### Inferences
- [추론] hubblerc는 전체 화면 TUI 한 창에서 쓰므로 tmux 탭 연동보다 "답변이 끝났거나 권한을 기다릴 때 창 제목·OSC 알림"이 맞다. Orca가 여러 worktree 터미널을 띄우므로 Orca 쪽 알림과 겹치지 않는지 먼저 확인해야 한다.
- [추론] "걸린 시간 기준 알림"(ai-cli-complete-notify)은 hubblerc F5가 이미 답변 시간을 재고 있으니 붙이기 쉽다. 예: 2분 넘게 걸린 답변이 끝날 때만 알림.

### Gaps
- Orca 내장 터미널의 OSC 9/777 지원 여부는 찾지 못했다.
- ntfy 전용 인기 도구는 따로 찾지 못했다(anotifier가 ntfy를 쓰는 정도).
- 자동 포맷 훅은 공식 예제 외에 인기 저장소를 따로 조사하지 않았다(대부분 dotfiles 수준).

---

## Q4. 세션·worktree 관리자, 대시보드, 대화 기록 뷰어: 어떤 UX가 인기인가? 답변별 활동 기록 도구가 있나?

### Takeaway
세션 관리자의 공통 UX는 "세션마다 worktree 하나 + 목록에 상태(작업 중/대기/유휴) + diff 미리보기 + 끝나면 알림"이다. 가장 큰 것은 Orca(10만+★)이고, vibe-kanban은 회사가 2026-04에 문을 닫았다. "어느 답변에서 무엇을 바꿨나"를 보여 주는 도구는 아직 작다(VeroDiff, claude-turn-diffs, claude-lens: 별 0~3개). 하지만 문제 정의는 hubblerc F5와 같다. 기록 뷰어는 대화 기록을 HTML·TUI로 바꿔 검색·필터·타임라인을 주는 방향이다(claude-code-log).

### Cited Findings
**세션·worktree 관리자 (별, 마지막 push)**
- [커뮤니티] stablyai/orca 105,833★, 2026-10-26: "Orca is the place for working with a fleet of agents"(여러 에이전트와 일하는 곳). 에이전트마다 git worktree를 주고, WebGL 터미널 분할, 재시작해도 남는 스크롤백, 내장 diff 리뷰·커밋, GitHub/Linear 연동, SSH worktree, 모바일 앱이 있다. Product Hunt 출시 2026-04-09 — GitHub API, WebSearch 요약([landscape.jimmysong.io](https://landscape.jimmysong.io/projects/orca/), [github.com/stablyai/orca](https://github.com/stablyai/orca)) → hubblerc: 사용자의 실제 환경. Orca가 이미 diff·worktree를 주므로 hubblerc 사이드바는 그것과 겹치지 않는 "답변별" 정보에 집중하는 게 맞다 [추론].
- [커뮤니티] BloopAI/vibe-kanban 28,455★, 2026-09-19: 칸반 이슈 → 워크스페이스(브랜치·터미널·dev 서버) → diff 인라인 댓글 → PR. README 맨 위에 "Vibe Kanban is sunsetting."이 있다. bloop은 2026-04-10에 문을 닫았고 프로젝트는 커뮤니티 유지로 남았다 — [README](https://github.com/BloopAI/vibe-kanban), [vibekanban.com/blog/shutdown](https://vibekanban.com/blog/shutdown)
- [커뮤니티] smtg-ai/claude-squad 8,669★, 2026-08-20: tmux + worktree. 백그라운드(자동 승인 포함) 작업, 미리보기 탭과 diff 탭(`tab` 전환), `s` 커밋·푸시, `c` 체크아웃 후 일시정지, `r` 재개 — [README](https://github.com/smtg-ai/claude-squad)
- [커뮤니티] kbwo/ccmanager 1,274★, 2026-10-25: tmux 없이 여러 세션, "Visual status indicators for session states (busy, waiting, idle)", worktree 만들기·병합·삭제, 재시작 후 세션 복원, worktree 사이 세션 데이터 복사, 상태 변화 훅, AI로 안전한 권한 요청을 자동 승인(실험) — [README](https://github.com/kbwo/ccmanager)
- [커뮤니티] asheshgoplani/agent-deck 1,157★, 2026-10-25: "One terminal shows every session — running, waiting, or done". `/` 퍼지 검색과 상태 필터(`!` running, `@` waiting, `#` idle, `&` error), `$` 비용 대시보드, `C` "Context inspector (what the session is sent, ranked by cost)"(세션이 보내는 내용을 비용순으로), MCP 관리자, 세션 포크, 휴대폰으로 보고받는 "conductor" 세션 — [README](https://github.com/asheshgoplani/agent-deck)
- [커뮤니티] stravu/crystal 3,132★(2026-02-26 이후 멈춤) → "Crystal is now Nimbalyst"(nimbalyst/nimbalyst 1,973★, 2026-10-25): 시각 편집 + 세션 칸반 + worktree — GitHub API
- [커뮤니티] Conductor(Melty Labs, 맥 앱, 비공개 소스): 작업마다 worktree·브랜치, 채팅·터미널·실행 스크립트·diff·체크·PR·보관 흐름을 한 앱에 묶는다 — [conductor.build](https://www.conductor.build/workflows/run-parallel-claude-codes), 서드파티 리뷰 [thenewstack](https://thenewstack.io/a-hands-on-review-of-conductor-an-ai-parallel-runner-app/) (날짜 미확인)
- [커뮤니티] 세션 모니터(메뉴바·TUI): farouqaldori/vibe-notch 2,525★(노치 알림 + 세션 관리), stefanprodan/cctop 147★("top-style" TUI: 세션별 바쁨/유휴, 컨텍스트 크기, 모델, 브랜치, 서브에이전트·하위 프로세스 트리, 열린 포트), hoangsonww/Claude-Code-Agent-Monitor 1,117★(훅 기반 웹 대시보드: 서브에이전트 트리, 도구 호출 타임라인), Claude Status·c9watch·claude-status-bar 등 메뉴바 앱 — GitHub API, [awesome-claude-code "Session Monitors"](https://github.com/hesreallyhim/awesome-claude-code)
- [커뮤니티] 원격·모바일: slopus/happy 24,315★(폰에서 여러 세션, 권한 필요 시 푸시), siteboon/claudecodeui 14,282★(웹·PWA) — GitHub API

**대화 기록 뷰어**
- [커뮤니티] daaain/claude-code-log 1,250★, 2026-10-09: JSONL → HTML/Markdown, TUI, `watch`·`serve --watch`(실시간), 세션 목차와 요약, 메시지별 토큰, 메시지 종류 필터, "Interactive timeline", 서브에이전트·rewind 포크를 접거나 나란히 보는 테마, 전체 검색, `--depth session|user|assistant|agent|tool|hook`. README의 질문 목록에 "What did I work on with Claude yesterday/last week?", "What tools did Claude use in this project?"가 있다 — [README](https://github.com/daaain/claude-code-log)
- [커뮤니티] simonw/claude-code-transcripts 1,720★(2026-02-12), d-kimuson/claude-code-viewer 1,300★(웹 클라이언트) — GitHub API
- [커뮤니티] entireio/cli 5,215★: "hooks into your Git workflow to capture AI agent sessions as you work. Sessions are indexed alongside commits"(git 흐름에 붙어 세션을 커밋과 함께 색인) — GitHub 검색 설명만 봄

**답변(턴)별 활동 기록**
- [커뮤니티] GomelHawk/VeroDiff(3★, 2026-10-20): "Claude Code's own `/diff` shows everything you have not committed yet, all mixed together. VeroDiff shows the changes of **each request on its own**"(엔진의 `/diff`는 커밋 안 한 변경을 다 섞어 보여 준다. VeroDiff는 요청마다 따로 보여 준다). 대화 옆 패널에 최신 요청부터, 요청 단위 또는 파일 단위 되돌리기, "Ask about this"로 위치를 프롬프트에 넣기, 프롬프트 위 한 줄 요약 `VeroDiff turn 3 · 2 files · +5 −1`, Claude가 같은 기록을 읽을 수 있음. 기록은 프로젝트 밖에 둔다 — [README](https://github.com/GomelHawk/VeroDiff) → hubblerc F5·F2: 문제 정의가 같다. "요청 단위 되돌리기"와 "Claude가 기록을 읽기"는 hubblerc에 없는 아이디어다.
- [커뮤니티] cristian-fleischer/claude-turn-diffs(0★, 2026-08-05): 대화 기록을 파싱해 턴마다 프롬프트 → 접힌 Process(도구 호출) → 파일 diff → 서브에이전트 → 답변을 HTML로 실시간 갱신. 파일을 바꾼 턴에는 `◆ N` 배지, "Changes only" 필터, 턴 별표·숨기기, diff 줄에 댓글을 달면 `file:line` 프롬프트로 모아 준다 — [README](https://github.com/cristian-fleischer/claude-turn-diffs) → hubblerc F2 목차: "파일을 바꾼 답변 표시"와 "변경 있는 답변만" 필터.
- [커뮤니티] hypertetrahedron/claude-lens(3★): "per-prompt tokens, cost, cache savings, file changes, and subagent rollup"(프롬프트별 토큰·비용·캐시 절약·파일 변경·서브에이전트 합계) — GitHub 검색 설명 → hubblerc F5 3줄에 "답변별 비용/토큰"을 넣을지 판단할 참고.
- [커뮤니티] arunkumar9t2/raven(3★): Claude 옆 diff 패널에서 줄에 메모를 남기면 다음 턴에 Claude가 읽는다 — GitHub 검색 설명
- [커뮤니티] 되돌리기 도구: Manavarya09/checkpoint(8★, 프롬프트마다 파일 스냅샷), mohshomis/ckpt(7★) 등. 엔진에 `/rewind`가 있어서인지 Claude Code용은 작다 — GitHub 검색

### Inferences
- [추론] 세션 관리자들의 "상태 3색(작업 중·대기·유휴/완료)"은 hubblerc 밴드 2줄의 "대기 중" 표시와 같은 정보다. 여러 세션을 한 화면에서 보는 기능은 Orca가 맡고 있으니 hubblerc가 할 일은 아니다.
- [추론] 답변별 활동 기록 도구는 별이 적다. 수요가 작은지, 새로 생긴 분야인지(대부분 2026-07 이후)는 별 수만으로 판단할 수 없다. 여러 명이 따로 같은 문제("`/diff`는 섞여 있다")를 짚었다는 점은 F5 방향을 뒷받침한다.

### Gaps
- Orca가 "답변별 변경"을 보여 주는지는 확인하지 못했다(README·문서를 직접 읽지 않음).
- Conductor는 소스가 닫혀 있어 서드파티 설명만 있다.
- claude-code-log의 "timeline"이 답변별 파일 변경까지 보여 주는지는 README로는 알 수 없다.

---

## Q5. mod로 옮겼거나 mod 판을 낸 도구가 있나? statusLine의 어떤 한계가 언급되나?

### Takeaway
큰 statusLine 도구 중 mod로 완전히 옮긴 곳은 아직 없다. 하지만 옮기기 시작했다: CCometixLine(3.5k★)은 그리지 않고 데이터만 넘기는 "companion mod"를 냈다(2.1.287+). claude-dashboard(583★)는 같은 플러그인에 mod 패널·밴드를 넣었다(2.1.289에서 시험). 2026-10에는 개인 statusLine 저장소 여러 곳이 "statusLine을 mod 밴드로" 옮기는 PR을 냈다. claude-hud·ccstatusline·powerline의 이슈와 PR에는 "mod" 언급이 없었다(2026-10-26 검색). 언급된 한계는 갱신 시점(이벤트 기반이라 유휴 때 멈춤), 입력에 없는 데이터(실행 중 도구·에이전트, TTFT, 컨텍스트 구성, 압축 지점), 폭 감지, 권한 창이 뜰 때 숨겨짐, 데스크톱 앱에서 안 보임, 상호작용 불가(OSC 8 링크뿐)다.

### Cited Findings
**mod로 옮긴 사례**
- [커뮤니티] CCometixLine: "On Claude Code 2.1.287+ an optional mod passes ccline what the status line input lacks: time to first token, output speed, running tools and agents, what fills the context, and the exact auto-compact point. It draws nothing itself."(statusLine 입력에 없는 TTFT, 출력 속도, 실행 중 도구·에이전트, 컨텍스트 구성, 정확한 자동 압축 지점을 넘긴다. 직접 그리지는 않는다) `ccline mod install/status/uninstall`. "Live values need Claude Code to redraw the status line on a timer: set `refreshInterval` to 2 seconds"(실시간 값을 보려면 `refreshInterval` 2초) — [README](https://github.com/Haleclipse/CCometixLine) (접속 2026-10-26) → hubblerc: statusLine에 없는 데이터 목록이 hubblerc가 mod라서 얻는 장점 목록과 같다.
- [커뮤니티] claude-dashboard: "also ships as a Claude Code **mod** (function-hook plugin, early access, tested on Claude Code 2.1.289)". `/claude-dashboard-pane`(대화 옆 패널), `/claude-dashboard-band`(프롬프트 위 밴드, 이 세션에서만 statusLine을 숨김). 숨기는 방법: "the band writes a per-session heartbeat marker (`~/.cache/claude-dashboard/band-<sessionId>`), refreshed on every render (at most every 60s) and ignored after 180s … if the mod stops the status line comes back by itself within 3 minutes"(밴드가 세션별 심장박동 파일을 렌더마다(최대 60초 간격) 갱신하고, statusLine은 180초 넘은 파일을 무시한다. mod가 멈추면 3분 안에 statusLine이 저절로 돌아온다). "`cacheHit`, `tokenBreakdown`, and `performance` are hidden in the pane and band (the mod API has no per-request cache usage)"(mod API에 요청별 캐시 사용량이 없어 패널·밴드에서는 숨긴다) — [README](https://github.com/uppinote20/claude-dashboard) → hubblerc F1 전환 시점: "배포할 때 statusLine 설정을 뺀다" 대신, claude-hud 앞에 심장박동 확인을 끼워 hubblerc 밴드가 살아 있을 때만 claude-hud가 아무것도 출력하지 않게 할 수 있다. 개발 중 두 줄이 겹치는 문제도 사라진다 [추론].
- [커뮤니티] TheBabaYaga/claude-statusline PR #2(2026-10-07) "add v2 statusline as a Claude Code mod": 이유는 "Claude Desktop does not run a `statusLine` command … A mod can draw in the band above the prompt, and that band shows in the terminal and in the Desktop Code tab."(데스크톱 앱은 statusLine을 실행하지 않는다. mod 밴드는 터미널과 데스크톱 Code 탭 양쪽에 나온다) 데이터는 `$.session.cwd()`, `$.session.model()`, `$.session.usage()`, `session.measure`·`turn.step` 이벤트, git은 `$.process.run`. "It refreshes after each turn, when usage changes, and every 30 seconds."(턴마다, 사용량이 바뀔 때, 30초마다 갱신) 모델 이름을 누르면 `/model` 선택기가 열린다(`ctrl+x tab` 후 `m`). 주의점: "In the terminal, v1 and v2 both show while the `statusLine` setting stays."(statusLine 설정이 남아 있으면 터미널에 둘 다 보인다), "`/model` has no change event"(모델 변경 이벤트가 없다) — [PR #2](https://github.com/TheBabaYaga/claude-statusline/pull/2) → hubblerc F1: 같은 API 조합을 쓰고, "모델 변경 이벤트 없음"은 hubblerc도 겪을 수 있다.
- [커뮤니티] St0nefish/agent-toolkit PR #212(2026-10-06): bash statusLine을 mod 밴드로 바꿨다. "Context, usage windows and cost come from `session.measure`, so there is no `curl` polling, no process per redraw and no install step that edits `settings.json`."(`session.measure`에서 받으니 curl 폴링도, 다시 그릴 때마다 프로세스 띄우기도, settings.json 수정도 없다) "Width-responsive: sheds username, bar and weekly window as the terminal narrows"(좁아지면 사용자 이름, 막대, 주간 창 순으로 덜어낸다) — [PR #212](https://github.com/St0nefish/agent-toolkit/pull/212) → hubblerc F1의 "7일 → 프로젝트 → 막대" 덜어내기와 같은 발상.
- [커뮤니티] 같은 검색에서 나온 2026-10 PR·이슈 제목: "Migrate Claude Code statusline to mod"(Aquaticats/Monochromatic #663, 2026-10-09), "a local Claude tab draws its status line with a Claude Code mod"(superkoh/koloft #375, 2026-10-08), "claudeAwareMod — the usage line as a Claude Code mod, Python statusline removed"(lbonnaireYellowtail/claudeAware #14, 2026-10-02) — GitHub 이슈 검색 `statusline mod "claude code" in:title`(2026-10-26). 본문은 API 한도로 읽지 못했다.
- [커뮤니티] claude-hud·ccstatusline·claude-powerline 저장소에서 `mod`로 이슈·PR을 검색하면 0건이었다(2026-10-26). claude-hud는 지금도 statusLine 명령(플러그인 + `/claude-hud:setup`)이고, 최신 릴리스 v0.13.1(2026-10-26)에도 mod 이야기는 없다 — [releases](https://github.com/jarrodwatts/claude-hud/releases)
- [커뮤니티] karanb192/awesome-claude-code-mods(759★, 2026-10-25): "5,000+ Claude Code mods … Context and usage meters, prompt cache warmers, status lines" — GitHub API 설명. mod 갤러리는 다른 조사자 범위라 깊게 보지 않았다.

**statusLine 한계 (공식 문서와 도구 문서에서)**
- [공식] 갱신 시점: 세션 시작·resume, 새 assistant 메시지, `/compact` 완료, 권한 모드 변경, vim 모드 토글, 명령 변경, `refreshInterval`, 한도 창의 `resets_at` 도달, 프롬프트 캐시 `expires_at` 도달. "Claude Code debounces updates at 300ms … If a new update triggers while your script is still running, Claude Code cancels the in-flight script."(300ms로 묶고, 실행 중에 새 갱신이 오면 실행 중인 스크립트를 취소한다) "The event-driven triggers can go quiet when the main session is idle, for example while a coordinator waits on background subagents."(메인 세션이 유휴면, 예를 들어 백그라운드 서브에이전트를 기다릴 때 이벤트가 끊길 수 있다) — [statusline 문서](https://code.claude.com/docs/en/statusline)
- [공식] "It temporarily hides during certain UI interactions, including the help menu and permission prompts."(도움말이나 권한 창이 뜨면 잠시 숨겨진다) 출력은 여러 줄, ANSI 색, OSC 8 링크까지만 된다. 스크립트는 `tput cols`로 폭을 읽을 수 없어 `COLUMNS`/`LINES` 환경 변수를 써야 한다. statusLine을 설정하면 `esc to interrupt` 같은 하단 키 안내가 대부분 사라진다 — [statusline 문서](https://code.claude.com/docs/en/statusline)
- [공식] statusLine 입력 JSON에는 실행 중 도구·할 일 목록이 없다(모델, 작업 폴더, 비용, 컨텍스트, effort, rate_limits, prompt_cache, session, worktree, PR 등만 있다). 서브에이전트 행은 별도 `subagentStatusLine`으로만 바꿀 수 있다 — [statusline 문서](https://code.claude.com/docs/en/statusline)
- [커뮤니티] claude-hud: 도구·에이전트·할 일 줄은 "also read the session transcript"(대화 기록 파일을 읽는다). 대화 기록 파싱 때문에 생긴 버그를 계속 고치고 있다: 최근 버전이 남기는 `api-request-blob` 줄이 예전 도구 호출을 되풀이해서 끝난 도구가 실행 중으로 보임(v0.12.1, 2026-10-21), 백그라운드 에이전트가 끝나도 `◐`로 남음(v0.11.3), 긴 세션에서 렌더마다 파일 전체를 다시 읽어 느려짐(v0.12.0에서 이어 읽기로 고침) — [CHANGELOG](https://github.com/jarrodwatts/claude-hud/blob/main/CHANGELOG.md)
- [커뮤니티] claude-hud 프롬프트 캐시 표시는 카운트다운 대신 시계 시각(`Cache ⏱ until 14:30`)이다. "because the status line doesn't repaint between turns, which is exactly when the cache drains"(턴 사이에는 statusLine이 다시 그려지지 않는데, 캐시가 식는 때가 바로 그때라서) — [README](https://github.com/jarrodwatts/claude-hud)
- [커뮤니티] claude-powerline: "Claude Code system messages may truncate long status lines."(엔진 시스템 메시지가 긴 상태줄을 자를 수 있다) `cacheTimer`는 `refreshInterval` 없이는 유휴 때 멈춘다 — [README](https://github.com/Owloops/claude-powerline)
- [커뮤니티] ccusage #459 "ccusage statusline causes infinite process spawning loop leading to 100% CPU usage"(2025-08, 댓글 18), ccstatusline #397 여러 세션에서 CPU 과다(열림) — 렌더마다 프로세스를 띄우는 구조의 비용 — [ccusage #459](https://github.com/ccusage/ccusage/issues/459), [ccstatusline #397](https://github.com/sirmalloc/ccstatusline/issues/397)
- [커뮤니티] 보안: claude-hud v0.11.1(2026-10-12) "A directory whose `.git/config` … set `core.fsmonitor` or a filter driver could run any command as you on every render"(저장소 `.git/config`의 `core.fsmonitor`나 필터 드라이버가 렌더마다 임의 명령을 실행할 수 있었다), GHSA-fq7j-8hxj-jfqh. 그 전에는 도구 이름·Bash 명령·할 일 문구를 터미널 이스케이프 제거 없이 그대로 출력했다("They reached the terminal raw.", v0.10.0, 2026-10-01) — [CHANGELOG](https://github.com/jarrodwatts/claude-hud/blob/main/CHANGELOG.md) → hubblerc: 브랜치를 git으로 읽으므로 `git -c core.fsmonitor=false`처럼 저장소 설정 실행을 막는 옵션이 필요하다. F4 Bash 용도 문구도 제어 문자를 지운다 [추론: mod 렌더러가 이스케이프를 처리하는지 확인 안 함].

### Inferences
- [추론] mod로 옮긴 사람들이 꼽는 이유는 셋이다: (1) 데스크톱 Code 탭에서도 보임, (2) 프로세스·폴링 없이 엔진 값을 받음, (3) statusLine에 없는 데이터(실행 중 도구, TTFT 등). 상호작용(누르면 `/model` 열기)은 덤으로 쓰였다. hubblerc의 effort 슬라이더와 목차 이동은 statusLine으로는 할 수 없는 기능이라 차별점이 뚜렷하다.
- [추론] 큰 도구(claude-hud 2.9만★)가 아직 statusLine에 머무는 이유로는 mod가 early access이고 터미널·데스크톱 Code 탭에서만 그려진다는 점이 있을 수 있다(claude-dashboard: "not the VS Code panel, not `claude -p`"). 근거 있는 진술은 찾지 못했다.

### Gaps
- claude-hud 작성자의 mod 계획 발언은 찾지 못했다(이슈·PR 0건, Discussions·SNS는 안 봄).
- Monochromatic, koloft, claudeAware PR 본문은 API 한도 때문에 읽지 못했다.

---

## Q6. hubblerc F1/F5/후보와 비교: 빠진 항목, 더 나은 표현

### Takeaway
F1 1줄은 생태계의 기본 묶음과 같고 색 방침(터미널 색 이름, 단계색)도 흔한 방식이다. F5(답변별 기록)와 effort 슬라이더는 statusLine 도구에는 없고 mod 신생 도구(VeroDiff)에서만 비슷한 것이 보인다. 가져올 만한 것은 경과 위치 커서 pace 표현, 임박할 때만 뜨는 소진 경고, worktree 표시, 0 값 숨김, 압축까지 남은 양, statusLine 자동 숨김(심장박동), 실패한 MCP 표시 방식, git 보안 옵션이다.

### Cited Findings
(근거는 Q1~Q5의 출처. 여기서는 비교만 정리한다.)

| hubblerc | 생태계에서 본 것 | 제안 |
|---|---|---|
| F1 1줄 5h `━━──── 25% ↻1h30m` | pace 표현 3종: 예상 %·`▲`(hud), `⇡8%` 2단 막대(CCometixLine), 막대 위 경과 커서(ccstatusline time cursor), `60%/40%`(powerline) | 막대 안 경과 위치에 커서 한 글자 + 예상 기준 색. 한 줄 높이를 지킨다 [추론] |
| 후보: 5시간 소진 예측 | 직선 예측 + 10% 미만 무시(hud), 1%p 넘는 시각으로 기울기(coralline), 1시간 이내일 때만 `⚠~18m`(claude-statusbar), `min(ETA_5h, ETA_7d)`(coralline) | 평소엔 색만, 1시간 안에 바닥날 때만 칩. 속도는 계정 단위 % 변화로 잰다 |
| F1 7d | hud는 80% 미만이면 숨김 | 폭과 상관없이 낮을 때 숨기기 옵션 |
| F1 ctx % | hud 70/85% 경고 + 85% 넘으면 토큰 내역, `autoCompactWindow`, CCometixLine `context.to_compact`, powerline 자동 압축 임계 | 후보 "압축 직전 경고"를 색만이 아니라 `압축까지 18k` 같은 글로 |
| F1 프로젝트·브랜치·`*` | worktree 표시 7/13 (`⎇ feat-x`, `🌳`), 공식 `workspace.git_worktree` 필드 | Orca worktree 사용자이므로 worktree 이름 추가. mod API에 같은 값이 있는지 확인 필요 |
| F1 비용 숨김 | hud·claude-statusbar도 기본 숨김 | 그대로. 후보 "오늘 누적 비용"은 hud식 일별 장부 |
| 후보: 기기 라벨 | hud `customLine`, `CLAUDE_CONFIG_DIR`별 설정 덮어쓰기, `showAuth`(플랜) | 기기별 `pluginConfigs`에 라벨 문자열 하나 |
| 후보: MCP 끊김 | hud #699(v0.7.0, 2026-08-07) "Surface bounded MCP server failures … clearing a failure after a later successful result"(실패를 보여 주고, 다음에 성공하면 지운다). 도구 결과로 추정하는 방식. ccstatusline #114 켜진 MCP 목록 요청(열림) | 연결 상태 API가 없으면 hud처럼 MCP 도구 결과의 실패로 추정 |
| 후보: 백그라운드 작업 | hud가 `isAsync`/`async_launched` 결과를 백그라운드로 보고 task-notification까지 유지. claude-statusbar는 엔진 패널과 중복이라 에이전트 줄을 기본으로 끈다 | 엔진의 에이전트 패널과 겹치는지 먼저 확인 |
| F1 2줄 실행 중 도구 | claude-hud 형식과 같음. 완료 도구 묶음 `✓ Read ×3`은 hud·claude-statusbar에 있음 | hubblerc 3줄(직전 요약)이 이 역할을 함 |
| F1 3줄 / F5 답변 끝 줄 `2m13s · 파일 +24 −3 · Read 5` | VeroDiff `turn 3 · 2 files · +5 −1`, claude-lens 프롬프트별 토큰·비용, kcchien 0 값 숨김 | 0 항목 빼기. 답변별 토큰·비용은 넣을지 판단 필요(비용 기본 숨김 방침과 충돌) |
| F2 사이드바 변경 파일·목차 | claude-turn-diffs `◆ N`(파일 바꾼 턴) 배지와 "Changes only" 필터, VeroDiff 요청 단위 되돌리기·"Ask about this"·Claude가 기록 읽기 | 목차에 변경 있는 답변 표시. 되돌리기는 엔진 `/rewind`와 겹치는지 확인 |
| F1 전환 시점(claude-hud와 겹침) | claude-dashboard 심장박동 파일 + statusLine이 180초 지난 파일은 무시 | claude-hud 앞에 심장박동 확인 래퍼 → 개발 중에도 둘이 겹치지 않음 |
| git 읽기 | hud GHSA: `core.fsmonitor`·필터 드라이버 실행 위험 | `git -c core.fsmonitor=false status --porcelain=v2` 같은 안전 옵션. hud는 git 호출을 한 번으로 줄였다(`--porcelain=v2`) |
| 알림 | Stop/Notification 훅 + `terminalSequence` OSC, 걸린 시간 기준 알림 | F5 답변 시간으로 "N분 넘은 답변 끝" 알림 [추론] |

- [커뮤니티] 출처 묶음: [claude-hud README·CHANGELOG](https://github.com/jarrodwatts/claude-hud), [CCometixLine](https://github.com/Haleclipse/CCometixLine), [ccstatusline](https://github.com/sirmalloc/ccstatusline), [claude-powerline](https://github.com/Owloops/claude-powerline), [coralline #17](https://github.com/Nanako0129/coralline/issues/17), [claude-statusbar segments](https://github.com/leeguooooo/claude-code-usage-bar/blob/main/docs/segments.md), [claude-dashboard](https://github.com/uppinote20/claude-dashboard), [VeroDiff](https://github.com/GomelHawk/VeroDiff), [claude-turn-diffs](https://github.com/cristian-fleischer/claude-turn-diffs), [kcchien](https://github.com/kcchien/claude-code-statusline)
- [공식] worktree 관련 입력 필드: `workspace.git_worktree`("Git worktree name when the current directory is inside a linked worktree", 연결된 worktree 안이면 그 이름), `worktree.name/path/branch/original_cwd/original_branch`(엔진 worktree 세션일 때만) — [statusline 문서](https://code.claude.com/docs/en/statusline)

### Inferences
- [추론] hubblerc에만 있는 것: effort 수동 슬라이더(statusLine 도구는 effort를 보여 주기만 한다), 답변 목차와 대화 위치 이동, 서브에이전트 변경까지 합친 세션 변경 파일 누적, resume 때 답변 기록 복원. statusLine 생태계에는 없고 mod라서 할 수 있는 것들이다.
- [추론] 우선순위 제안(근거: 빈도와 사용자 환경): ① worktree 표시(Orca), ② 5h pace 커서 + 임박 칩, ③ 압축까지 남은 양, ④ claude-hud 자동 숨김 래퍼, ⑤ 오늘 누적 비용. 재미 요소(펫, 음악)는 "취향 꾸미기" 방향에 맞지만 생태계에서도 별이 적다.

### Gaps
- mod API(`$.session.usage()` 등)에 `workspace.git_worktree`, `prompt_cache`, `cost.total_lines_added`에 해당하는 값이 있는지는 이 조사 범위(서드파티 도구) 밖이라 확인하지 않았다. claude-dashboard는 "mod API has no per-request cache usage"라고 적었다.
- 사용자 요청 빈도는 GitHub 이슈 반응 수만 봤다. Reddit/HN 의견은 다른 조사자 범위다.
