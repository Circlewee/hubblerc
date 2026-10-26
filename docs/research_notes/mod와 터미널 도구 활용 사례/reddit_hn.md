# Reddit·Hacker News에서 본 터미널 Claude Code 사용자의 목소리 (셋업·불편·요청·mod 반응)

> 조사 방법(접속 2026-10-26): HN은 Algolia 검색 API(`hn.algolia.com/api/v1/search`, 2026-01-01 이후 글)와 항목 API로 댓글 트리 전체를 받아 읽었다. Reddit은 JSON과 old.reddit이 막혀서(403, 로그인 요구) Aside 브라우저로 www.reddit.com 검색 결과("최다 투표순")와 글 페이지(본문 + 상위 댓글 약 40개)를 읽기 전용으로 열었다. 점수·업보트·댓글 수는 모두 **2026-10-26 접속 시점** 값이다. Reddit 날짜는 페이지의 작성 시각(`ts`, `created-timestamp`)에서 뽑았다. 댓글 앞의 `[숫자]`는 그 댓글의 점수다.
> 표시: [공식] Anthropic 문서·블로그 / [커뮤니티] 사용자 글·댓글(자기소개상 Anthropic 직원 발언은 "[커뮤니티: 직원 자칭]") / [추론] 내 해석.
> 한계: Reddit 검색은 느슨해서 무관한 인기 글이 많이 섞인다. 관련 글만 골라 썼고, 본문을 안 읽은 글은 "제목만"이라고 적었다. "건수"는 이 조사에서 직접 확인한 글·댓글 수일 뿐 전체 빈도가 아니다.

## 1. 셋업·워크플로: 사람들이 터미널에서 Claude Code를 어떻게 쓰나

### Takeaway
2026년 터미널 사용자의 기본 조합은 **tmux(또는 herdr·cmux 같은 에이전트용 멀티플렉서) + git worktree로 여러 세션 병렬 + Ghostty 계열 터미널 + statusLine + 알림 훅**이다. 4월에 나온 `/tui fullscreen`이 깜빡임·입력창 위치·복사 문제의 공식 해법으로 받아들여지는 중이고, 10월 데스크톱 앱 개편 뒤에는 "터미널이 유일한 진짜 자리"라는 반응과 "탭 관리에 지쳐 데스크톱으로 옮겼다"는 반응이 같이 나온다.

### Cited Findings

**멀티플렉서·여러 세션**
- [커뮤니티] HN 글 "Tmux and Claude Code: Sessions, Send-Keys, and the Ceiling"(2026-10-19, 172점·128댓글). 최다 답글 댓글(답글 11): "If you aren't familiar with tmux(or GNU screen), you owe it to yourself to become familiar… it will act as a force multiplier."(tmux를 모르면 꼭 배워라, 생산성을 몇 배로 늘려 준다) — [HN 50148855](https://news.ycombinator.com/item?id=50148855)
  - 같은 스레드 nsagent: "Wow, nearly every top level comment is about coding their own version of this."(최상위 댓글 거의 전부가 자기 버전을 직접 만들었다는 얘기다) — [HN 50152510](https://news.ycombinator.com/item?id=50152510)
  - thomas_witt: "Herdr does it all so much better out of the box when it comes to agentic coding."(에이전트 코딩에는 herdr가 기본 상태로 훨씬 낫다). 반론 oefrha: herdr가 "randomly crash and take out the whole session"(무작위로 죽으며 세션을 날린다)해서 중요한 건 herdr 안에 tmux를 중첩해 돌린다 — [HN 50149524](https://news.ycombinator.com/item?id=50149524)
  - aranelsurion: "If you're mainly just using Claude Code, '$ claude agents' view is a good alternative coupled with tmux."(Claude Code만 쓴다면 `claude agents` 보기 + tmux가 좋은 대안) — 같은 스레드
  - teiferer(답글 3): 에이전트는 데몬으로 돌고 CLI가 붙는 구조여야 하며 "stuff into something like tmux"(tmux 같은 데 쑤셔 넣는 것)는 잘못된 구조라는 비판 — [HN 50150553](https://news.ycombinator.com/item?id=50150553)
- [커뮤니티] 에이전트용 멀티플렉서·세션 관리자 Show HN이 2026년 내내 반복된다: cmux "Ghostty-based terminal with vertical tabs and notifications"(2026-02-19, 198점·77댓글) [HN 47079718](https://news.ycombinator.com/item?id=47079718), Agent-of-empires(2026-01-12, 118점) [HN 46588905](https://news.ycombinator.com/item?id=46588905), Agent-Manager "A Tmux TUI for Running Claude Code, Codex and OpenCode"(2026-07-30, 98점·80댓글) [HN 49107749](https://news.ycombinator.com/item?id=49107749), Corgi "agent, terminal multiplexer"(2026-10-23, 137점·46댓글, "Inspired by Herdr") [HN 50214373](https://news.ycombinator.com/item?id=50214373). Agent-Manager 스레드 최다 답글(9) hamaluik: "it's not clear to me the added value they bring in over using plain tmux"(그냥 tmux 대비 무슨 가치가 있는지 모르겠다).
- [커뮤니티] 이 조사에서 받은 HN 스레드 33개의 댓글에서 키워드가 나온 횟수(대략, tmux 스레드가 표본에 있어 tmux가 부풀려짐): tmux 155, herdr 65, ghostty 19, iterm 12, zellij 12, cmux 8, orca 4, warp 3, kitty 3 — HN 항목 API로 받은 댓글 트리 집계(접속 2026-10-26).
- [커뮤니티] Orca 언급: Reebz "since using Orca IDE it feels like a leap in usability and robustness."(Orca IDE를 쓴 뒤 사용성이 크게 좋아졌다) vs whyho "I found orca way to cluttered and overkill."(너무 어수선하고 과하다) — [HN 50150507](https://news.ycombinator.com/item?id=50150507) (2026-10-19). hmokiguess "I decided to test herdr and orca today and I'm really impressed with both, especially orca." — [HN 49107749 스레드](https://news.ycombinator.com/item?id=49111877) (2026-07-30)

**worktree·병렬**
- [커뮤니티] Ask HN "Is it actually possible to run multiple coding sessions in parallel?"(2026-03-30, 11점·15댓글): rox_kd "if you operate with worktrees… up to 5-10"(worktree면 5~10개도 된다), nojs "worktrees with workmux", sprobertson "Pretty much everyone saying worktrees but…"(다들 worktree라지만 핫 리로드·포트 때문에 main 하나에서 작업 범위만 나눈다) — [HN 47573483](https://news.ycombinator.com/item?id=47573483)
- [커뮤니티] Reddit "5 claude code worktree tips from creator of claude code in feb 2026"(2026-02-21, 660표·112댓글, 제목만) — [r/ClaudeCode](https://www.reddit.com/r/ClaudeCode/comments/1rae7sa/5_claude_code_worktree_tips_from_creator_of/); "My Claude Code workflow after months of daily use"(2026-08-12, 549표·103댓글) 본문 "Always use worktrees and versioning." — [r/ClaudeCode](https://www.reddit.com/r/ClaudeCode/comments/1vmey7d/my_claude_code_workflow_after_months_of_daily_use/)
- [커뮤니티] 병렬 회의론: Boris Cherny 셋업 소개 HN 스레드(2026-01-02, 568점·403댓글) 최다 답글(38) tmerr: "I don't need 10 parallel agents making 50-100 PRs a week, I need 1 agent that successfully solves the most important problem."(주 50~100 PR을 만드는 에이전트 10개가 아니라 가장 중요한 문제를 푸는 1개가 필요하다) — [HN 46470017](https://news.ycombinator.com/item?id=46470017)
- [커뮤니티] 병렬 에이전트 충돌용 도구도 나온다: 로컬 merge queue(2026-07-30, 42점) [HN 49104747](https://news.ycombinator.com/item?id=49104747), Foremerge(2026-09-21, 45점) [HN 49789356](https://news.ycombinator.com/item?id=49789356)

**원격·여러 기기**
- [커뮤니티] Reddit "Coding on an Linux machine over SSH has been a game changer"(2026-09-07, 514표·160댓글): 미니 PC + Fedora 서버로 옮김. 댓글 kamisdeadnow [8] "tailscale… terminus on your phone… tmux to let it run as background process", niggo372 [11] "Just run claude rc"(원격 제어 내장 기능), electricshep [2] "cmux ssh-tmux {hostname}… you can paste images/files over cmux" — [r/ClaudeCode](https://www.reddit.com/r/ClaudeCode/comments/1w9yzkw/coding_on_an_linux_machine_over_ssh_has_been_a/)
- [커뮤니티] mkw5053: "ghosty + ssh + mosh + tmux + claude code (sometimes codex)" 조합을 쓰지만 복사·붙여넣기가 95%만 된다(2026-10-19) — [HN 50155107](https://news.ycombinator.com/item?id=50155107)

**터미널 앱**
- [커뮤니티: 직원 자칭] Claude Code TUI 렌더링 담당이라는 chrislloyd(2026-01-21): "As always, I recommend using Ghostty which has 2026 support and zero flicker."(늘 그렇듯 DEC 2026 동기화 출력을 지원해 깜빡임이 0인 Ghostty를 권한다) — [HN 46701013](https://news.ycombinator.com/item?id=46701013)
- [커뮤니티] Ghostty 기반 신규 터미널: cmux(위), Helium Terminal "built on libghostty"(2026-10-10, 8점) [HN 50030806](https://news.ycombinator.com/item?id=50030806), thurm.rs "ghostty + herder, but all natively"(2026-10-19) [HN 50150539](https://news.ycombinator.com/item?id=50150539). Warp 사용자: 탭을 닫아도 Claude 프로세스가 고아로 남았다(2026-10-11, proc-stats) [HN 50047442](https://news.ycombinator.com/item?id=50047442). iTerm2 사용자: 블록 선택으로 들여쓰기 제거(2026-06-22) [r/ClaudeCode](https://www.reddit.com/r/ClaudeCode/comments/1uciszz/when_cc_gives_you_a_multiline_command_to/)

**전체 화면 모드**
- [커뮤니티] Reddit "Opus 4.7 is cool but the real release today is /tui"(2026-04-16, 25표·11댓글): "the big news here is that it keeps the input box visible even when you scroll up."(스크롤해도 입력창이 보인다는 게 핵심) — [r/ClaudeCode](https://www.reddit.com/r/ClaudeCode/comments/1sn8by4/opus_47_is_cool_but_the_real_release_today_is_tui/). 같은 스레드 arekxy: "mouse handling is broken… copies 'Jump to bottom'… scrolling with mouse is slow as you no longer have scrollbar"(마우스 처리 이상, UI 문구까지 복사됨, 스크롤바가 없어 느림), searchingforuni: "I had to use the json config flags to revert it."
- [커뮤니티] mod 작성자들이 설치 안내에 `/tui fullscreen`을 함께 적는다(cc-stretch, 2026-10-15) — [r/ClaudeCode](https://www.reddit.com/r/ClaudeCode/comments/1x688sx/turning_a_crazy_idea_from_1967_into_a_claude_code/)

**알림**
- [커뮤니티] 2026년 Claude Code 관련 HN Show 계열 최고점 중 하나가 알림 훅: "Warcraft III Peon Voice Notifications for Claude Code"(2026-02-12, 1006점·301댓글) — [HN 46985151](https://news.ycombinator.com/item?id=46985151). 같은 계열: Mr. Meeseeks 음성(2026-07-13, 132점) [HN 48899529](https://news.ycombinator.com/item?id=48899529), Dock 옆 LED 스트립(2026-08-10, 19점) [HN 49250486](https://news.ycombinator.com/item?id=49250486), 아이폰 SSH 터미널이 "pings you when an agent is blocked"(2026-10-08, 32점) [HN 50009634](https://news.ycombinator.com/item?id=50009634)
- [커뮤니티] Reddit "My cursor sprouts a Claude logo the moment Claude Code is waiting on me"(2026-06-15, 227표·32댓글). 댓글: Fleischhauf [11] 창마다 다른 기타 코드를 울리게 해서 어느 창이 부르는지 구분, MushyGushyTushy [1] "a lot nicer than the awful toast notifications I set up", damienhauser [1] 기본 알림도 있다 — [r/ClaudeCode](https://www.reddit.com/r/ClaudeCode/comments/1u6cc24/my_cursor_sprouts_a_claude_logo_the_moment_claude/)

**워크플로 습관**
- [커뮤니티] Reddit "Claude Code tips for terminal users (from a senior dev)"(r/ClaudeAI, 2026-05-13, 1,137표·110댓글): `@` 파일 지정, `/btw`("criminally underappreciated"), `!` 셸, `/statusline`, `/add-dir`. 댓글 BestUsernameLeft: "Having a good status line is super handy… I drop to the shell quite often with Ctrl-Z." — [r/ClaudeAI](https://www.reddit.com/r/ClaudeAI/comments/1tbwwel/claude_code_tips_for_terminal_users_from_a_senior/)
- [커뮤니티] 규칙→훅 승격: "if I've corrected the same behaviour twice, it becomes a PreToolUse hook that denies the call."(같은 걸 두 번 고쳤으면 PreToolUse 훅으로 막는다) — Reddit "My Claude Code setup: it runs like a small engineering team"(2026-10-21, 623표·152댓글) [r/ClaudeCode](https://www.reddit.com/r/ClaudeCode/comments/1xbxoza/my_claude_code_setup_it_runs_like_a_small/). 같은 스레드 최다 댓글 Prinzka [163]: "there's gotta be a more reasonable medium between this and 'Claude, build me an app, no mistakes'"(이것과 "앱 만들어 줘" 사이 중간이 있어야지)
- [커뮤니티] 계획 파일·실수 기록: thabxi [57] "I always maintain a MISTAKES.md file"(2026-08-12) — [r/ClaudeCode 1vmey7d](https://www.reddit.com/r/ClaudeCode/comments/1vmey7d/my_claude_code_workflow_after_months_of_daily_use/)

**터미널 vs 데스크톱 앱 (2026-10 개편 뒤)**
- [커뮤니티] Reddit "Did anyone else's Claude Code UI just update?"(2026-10-14, 178표·175댓글, 데스크톱 앱 2.37337.1): TBT_TBT [50] "Use Claude Code on the terminal. The only real place to use Claude Code." 반론 rkever72 [8] 데스크톱이 세션 전환·시각 단서 때문에 더 생산적 — [r/ClaudeCode](https://www.reddit.com/r/ClaudeCode/comments/1x5v1cg/did_anyone_elses_claude_code_ui_just_update/)
- [커뮤니티] Reddit "Claude Code UI Update"(2026-10-15, 316표·171댓글): pizzatimefriend [51] "CC outside the terminal seems way less efficient to me", Anxious-Yak-9952 [7] "I got tired of managing so many terminal tabs with split windows, in the app it's so much easier" — [r/ClaudeCode](https://www.reddit.com/r/ClaudeCode/comments/1x6is2o/claude_code_ui_update/). 이미지 mod 글(2026-10-11)에서 eastlin1 [16] "the desktop app is clunky af and drains far too much ram" — [r/ClaudeCode](https://www.reddit.com/r/ClaudeCode/comments/1x34qj4/claude_code_now_shows_images_and_videos_in_the/)

### Inferences
- [추론] 여러 세션 병렬이 표준이 되면서 "어느 세션이 나를 기다리나"를 알리는 것이 별도 제품군이 됐다(멀티플렉서, 소리, 커서, LED). hubblerc는 세션 하나 안의 상태만 보여 주므로 이 축은 안 다룬다. 사용자도 Orca를 쓰므로 세션 간 관리는 Orca 쪽 몫으로 두는 게 자연스럽다.
- [추론] Ghostty 권장이 렌더링 담당자 발언과 신규 터미널들로 굳어지는 중이다. 사용자의 Orca 터미널이 어떤 엔진인지(동기화 출력 지원 여부)는 이 조사에서 확인 못 했다.
- [추론] 전체 화면 모드는 이제 mod 작성자들이 전제로 깔기 시작했다(cc-stretch 설치 안내). hubblerc F2가 전체 화면을 기준으로 잡은 것은 흐름과 맞다.

### Gaps
- statusLine 구성을 정량으로 비교한 자료(무엇을 몇 %가 넣는지)는 못 찾았다. 자랑 글 댓글을 읽어 질적으로만 정리했다(4절).
- 작은/큰 모니터를 오가는 사용자의 레이아웃 고민 글은 직접 찾지 못했다(아래 2절 "작은 화면" 참고).
- zellij 사용 사례는 키워드 언급 12건뿐이고 따로 읽지 않았다.

## 2. 불편: 무엇이 실제로 많이 나오나 (빈도·반응 순)

### Takeaway
반응이 가장 크고 2026-08~10에도 계속 나오는 불편은 **(1) 사용 한도가 빨리, 이유를 모르게 닳는 것**과 **(2) Claude가 무엇을 했는지 안 보이는 것**이다. 다음으로 **(3) 여러 세션 중 누가 나를 기다리는지 모르는 것**, **(4) 장황한 답변 읽기 피로**가 크다. 깜빡임·스크롤백은 1~4월에 크게 터졌지만 차등 렌더러(1월)와 `/tui fullscreen`(4월) 뒤로 최근 3개월 큰 글이 보이지 않는다. 입력기(IME)와 작은 화면 불편은 Reddit·HN 영어권에서 찾지 못했다.

### Cited Findings

**순위표** ([추론] 순위는 내가 반응 크기·글 수·최근성으로 매긴 것. "확인 건수"는 이 조사에서 직접 읽은 관련 글·댓글 수)

| 순위 | 불편 | 확인 건수 | 가장 큰 반응 | 2026-08~10에도? | 해결 여부 | hubblerc |
|---|---|---|---|---|---|---|
| 1 | 사용 한도 소진·불투명 | 글 12+, 댓글 20+ | Reddit 2.7천표(한도 마무리 기능), HN 331점 | 예(10-24 글 206댓글) | 아니오(3월 건은 버그로 확인) | F1 5h/7d·리셋, 후보 소진 예측 |
| 2 | 무엇을 했는지 안 보임 | 글 6, 댓글 10+ | Reddit 888표, 1.5천표(이미지 mod) | 예(mod로 계속) | 아니오 | F5, F2 변경 파일 |
| 3 | 대기 상태·여러 세션 관리 | 글 10+ | HN 1006점(알림), 172점(tmux) | 예 | 부분(Agent View 등) | 거의 안 다룸 |
| 4 | 장황한 답변·읽기 피로 | 글 5 | Reddit 1.5천표(cc-stretch) | 예 | 아니오 | F5 요약 줄이 일부 |
| 5 | 권한 승인 피로→auto 모드 불만 | 글 4, 댓글 8 | HN 292점·313댓글 | 예(8월 기본값 전환) | 부분 | 안 다룸 |
| 6 | 깜빡임·스크롤백·렌더링 | 글 7 | HN 192점·148댓글 | 큰 글 못 찾음 | 대부분(전체 화면) | 간접(전체 화면 전제) |
| 7 | 복사·붙여넣기 | 글 3, 댓글 6 | Reddit 67댓글 | 예(HN 10-19 1건) | 부분(`/copy`, 전체 화면) | 안 다룸 |
| 8 | 데스크톱 앱 개편(터미널 아님) | 글 2 | Reddit 316표·171댓글 | 예(10-14~15) | — | 참고(정보 배치) |
| 9 | 메모리·프로세스가 안 끝남 | 글 2 | HN 8점 | 예(10-11, 10-23) | — | 안 다룸 |
| 10 | 입력기(IME)·작은 화면 | 0 | — | — | — | F1·F2 (근거는 사용자 본인 경험) |

**1. 사용 한도 소진·불투명**
- [커뮤니티] HN "Claude Code users hitting usage limits 'way faster than expected'"(2026-03-31, 331점·224댓글). dinakernel(답글 8): "This turned out to be a bug… it was a cache invalidation issue."(버그였고 캐시 무효화 문제였다) — [HN 47586176](https://news.ycombinator.com/item?id=47586176) → 3월 건은 해결된 것으로 보임(댓글 근거).
- [커뮤니티] Reddit "Max plan reset literally this morning and 53% of my limit is already wiped"(2026-10-24, 177표·206댓글). 본문이 인용한 사용량 화면 경고: "At this pace you'll run out tonight, before the Oct 31 reset."(이 속도면 10/31 리셋 전 오늘 밤에 바닥난다). derdigga [24] "This lacks transparency and borders on deceptive practice."(투명성이 없다). 작성자 답글: "There's no breakdown or log showing how these tokens are being calculated or burned."(토큰이 어떻게 계산·소모되는지 내역이 없다). tv_dim [84] 하루 토큰이 절반으로 줄었는데 한도는 더 빨리 닳는다 — [r/ClaudeCode](https://www.reddit.com/r/ClaudeCode/comments/1xelhl0/max_plan_reset_literally_this_morning_and_53_of/)
- [커뮤니티] Reddit "Claude added graceful stopping point in new update"(2026-09-25, 2,709표·107댓글): 한도에 닿을 때 작업을 끊지 않고 마무리하는 기능. MassiveBoner911_3 [9] "middle of a task and it just gets decapitated."(작업 중간에 목이 잘렸었다). daaain [231] "But will it handle the situation when Fable goes off the rails with several Fable subagents?", zionek [78] "That shit costed me half week" — [r/ClaudeCode](https://www.reddit.com/r/ClaudeCode/comments/1wqagzu/claude_added_graceful_stopping_point_in_new_update/)
- [커뮤니티] Show HN "My Claude quota ran out in 10 minutes, so I made a tool to find out why"(2026-08-27, 88점·57댓글). ryandrake: "It would be cool if these harnesses could all graphically display your quota usage on the screen at all times."(한도 사용량을 화면에 항상 그래프로 보여 주면 좋겠다). sva_: "In 95% of cases it is because you had a large context for which the cache expired."(95%는 캐시가 만료된 큰 컨텍스트 때문) — [HN 49467551](https://news.ycombinator.com/item?id=49467551)
- [커뮤니티] Show HN "agent-usage-guard – a Claude Code mod to protect your usage window"(2026-10-22, 28점·12댓글). 작성자: "After consuming my whole usage window in a few minutes multiple times…"(몇 분 만에 창을 통째로 쓴 일이 여러 번). 75일 운영 결과 "the biggest burst fell from 365 agent spawned to 27, and requests over 500k tokens of context from 14.5% to 0.6%". donfuzius: "I think that's a needed lever of control that's currently missing."(지금 없는, 필요한 제어 수단) — [HN 50198936](https://news.ycombinator.com/item?id=50198936)
- [커뮤니티] khoury(2026-02-17): "I think it's pretty ridiculous we have to install 3rd party packages… just to see how much gas is left in the tank"(남은 기름을 보려고 서드파티를 깔아야 하다니). 답글들은 `/usage`, `/status`를 안내 — [HN 47045125](https://news.ycombinator.com/item?id=47045125)
- [커뮤니티] 한도 축소 소식 제목(내용은 트윗 링크라 미확인): "Claude Code reduces it's weekly limit by 17%"(2026-08-31, 67점·52댓글) [HN 49506519](https://news.ycombinator.com/item?id=49506519), "Claude Code is going reduce limits by 25% from September 14"(2026-08-29, 27점) [HN 49491631](https://news.ycombinator.com/item?id=49491631)

**2. Claude가 무엇을 했는지 안 보임(관측성)**
- [커뮤니티] Show HN claude-devtools(2026-02-13, 69점·44댓글): "Recent updates have replaced critical output with summaries like 'Read 3 files' or 'Edited 2 files'. To see what actually happened, I was forced to use `--verbose`, which floods the terminal with unreadable JSON"(최근 업데이트가 중요한 출력을 "파일 3개 읽음" 같은 요약으로 바꿨고, 실제 내용을 보려면 JSON이 쏟아지는 `--verbose`밖에 없다). 기능: 인라인 diff, 파일/도구 출력/생각별 토큰 분해, 서브에이전트 트리 — [HN 47004712](https://news.ycombinator.com/item?id=47004712)
- [커뮤니티] 같은 도구 Reddit 글 "Claude Code's CLI feels like a black box now"(2026-02-13, 888표·124댓글). Pitiful-Impression70 [63]: "the 'done' with no context thing drives me insane, especially when youre trying to figure out why it burned through 8k tokens on what should have been a 3 line change."(맥락 없는 "완료"가 미치게 한다, 3줄 수정에 왜 8천 토큰을 썼는지 알 수 없다) — [r/ClaudeCode](https://www.reddit.com/r/ClaudeCode/comments/1r3to9f/claude_codes_cli_feels_like_a_black_box_now_i/). 후속 PSA 글(2026-03-23, 271표·119댓글, 제목만) [r/ClaudeCode](https://www.reddit.com/r/ClaudeCode/comments/1s132j8/psa_for_heavy_daily_use_claude_code_users_give/)
- [커뮤니티] mod 시대 버전: "Claude Code now shows images and videos in the terminal"(2026-10-11, 1,544표·214댓글): "Claude says 'Done! I fixed the pricing page', and I switch to the browser, find the localhost tab, reload…"(완료라는데 내가 브라우저에서 확인해야 했다) — [r/ClaudeCode](https://www.reddit.com/r/ClaudeCode/comments/1x34qj4/claude_code_now_shows_images_and_videos_in_the/)
- [커뮤니티] "I miss the old Claude Code"(2026-08-26, 38점): gorayobi "Now it's prompt -> model seems to read the entire codebase to 'get the full picture' -> takes forever"(이제는 코드베이스 전체를 읽느라 한참 걸린다) — [HN 49448395](https://news.ycombinator.com/item?id=49448395)

**3. 대기 상태·여러 세션 관리**
- [커뮤니티] Reddit "A Claude Code session asked for Bash permission at minute three. I noticed at minute forty."(2026-10-09, 106표·25댓글): "I usually have five or six Claude Code sessions open… Nothing had broken. It was waiting."(세션 5~6개, 고장이 아니라 기다리고 있었다). heyyarun [1]: 멈춘 걸 알아보는 신호로 "turn length: how long since the agent last handed control back to you"(마지막으로 제어를 넘긴 뒤 경과 시간)와 "Context use climbing with no new diff"(diff 없이 컨텍스트만 증가) — [r/ClaudeCode](https://www.reddit.com/r/ClaudeCode/comments/1x1z70y/a_claude_code_session_asked_for_bash_permission/)
- [커뮤니티] 알림 도구들의 반응(1절): peon-ping 1006점, 커서 로고 227표 등.

**4. 장황한 답변·읽기 피로**
- [커뮤니티] cc-stretch mod(2026-10-15, 1,511표·128댓글): "It cuts Claude's reply by 83% so you read much less, yet still have the option to expand / shrink on demand." fullup72 [83]: 새로 펼쳐진 글에 색을 하나 더 달라("I need to know exactly which are the new words"). TheLastNapkin [6]: 마우스 클릭이 필요해 키보드 사용자에겐 안 맞고 "vimium like keys"가 있으면 좋겠다 — [r/ClaudeCode](https://www.reddit.com/r/ClaudeCode/comments/1x688sx/turning_a_crazy_idea_from_1967_into_a_claude_code/)
- [커뮤니티] ASCII 트리 mod "to reduce reading fatigue"(2026-10-20, 6표) — [r/ClaudeCode](https://www.reddit.com/r/ClaudeCode/comments/1xb4twe/i_made_an_asciitree_mod_for_claude_code_to_reduce/); Terse 플러그인(2026-10-07, 25점) [HN 49995809](https://news.ycombinator.com/item?id=49995809); effort A/B 스레드의 한 댓글 "The verbosity is insane though" (2026-08-22) [HN 49401549](https://news.ycombinator.com/item?id=49401549)

**5. 권한 승인 피로 → auto 모드 불만**
- [커뮤니티] HN "Auto mode is now the default in Claude Code"(2026-08-10, 292점·313댓글, 링크는 [공식] claude.com 블로그). nomilk가 블로그 문구 인용: "users approve 97% of permission prompts in Claude Code."(권한 요청의 97%를 승인한다, 원문 미확인). sandcat_: auto 모드 분류기가 "quite annoying and overly zealous, but probably pretty effective"(짜증 날 만큼 과하지만 효과는 있을 것). dgunay(답글 4): 위험하진 않지만 의도와 어긋난 행동을 잡으려고 수동 승인을 쓰는데 auto 모드는 "it's also Claude"라 그걸 통과시킨다 — [HN 49239021](https://news.ycombinator.com/item?id=49239021)
- [커뮤니티] tough(2026-10-23): "claude code 'auto-mode' uses a smaller sonnet-like model for classifying… the harness biases it into denials"(작은 모델이 판정해 거부 쪽으로 치우친다) — [HN 50213199](https://news.ycombinator.com/item?id=50213199)
- [커뮤니티] Show HN "A context-aware permission guard for Claude Code"(2026-03-11, 127점·94댓글, 제목만) — [HN 47343927](https://news.ycombinator.com/item?id=47343927)

**6. 깜빡임·스크롤백·렌더링**
- [커뮤니티] Show HN "Claude Chill: Fix Claude Code's flickering in terminal"(2026-01-20, 192점·148댓글). prodigycorp(답글 9) "THEY HAVEN'T FIXED THIS YET?". [커뮤니티: 직원 자칭] chrislloyd(2026-01-21): "we shipped our differential renderer to everyone today… only ~1/3 of sessions see at least a flicker… Synchronized output totally eliminates flickering." elliot07: "Why has public comms been so poor on this issue?" benzible: claude-chill이 "breaks Ghostty's native scrollback". ossa-ma: "a toggle to lock the input to the bottom of the terminal"(입력창을 아래에 고정하는 옵션) 요청. 3ln00b: "Codex is so much more responsive… Claude just starts stuttering badly when the session is running for sometime." — [HN 46699072](https://news.ycombinator.com/item?id=46699072)
- [커뮤니티] Reddit claude-chill 글(2026-01-17, 47표·18댓글): demiquasar [1] "I've experienced it across Ghostty, Warp and Termius. Seems worse in tmux sessions" — [r/ClaudeCode](https://www.reddit.com/r/ClaudeCode/comments/1qfpugq/fix_for_claude_code_terminal_flickering/)
- [커뮤니티] Reddit "Scrollback, seriously?"(2026-04-01, 42표·14댓글): "delete the scrollback history alltogether in v2.1.89?"(2.1.89에서 스크롤백을 아예 지웠다). t4a8945 [6]: 압축 뒤 이전 명령을 보려고 "I had to spend TOKENS to ask Claude" — [r/ClaudeCode](https://www.reddit.com/r/ClaudeCode/comments/1s9d8a8/scrollback_seriously/)
- [커뮤니티] 해결 흐름: 1월 차등 렌더러 → 4월 `/tui fullscreen`(1절). Reddit "flicker" 1년 검색 상위 7개 중 2026-08~10 글은 mod로 Doom을 돌린 글(7표)과 무관한 게임 글뿐이었다 — [검색 결과](https://www.reddit.com/r/ClaudeCode/search/?q=flicker&sort=top&t=year)(접속 2026-10-26)

**7. 복사·붙여넣기**
- [커뮤니티] Reddit "When CC gives you a multi-line command to copy/paste, how are you doing it?"(2026-06-22, 25표·67댓글). 작성자 EDIT: "/tui fullscreen is the correct answer!". AncientAspargus [49] "you just use /copy", jakethunderpants [17] "I hate how copy and paste is a huge issue.", RouterDon [2] "its a known unfixed rendering bug where the indentation and wrap newlines get baked into the clipboard" — [r/ClaudeCode](https://www.reddit.com/r/ClaudeCode/comments/1uciszz/when_cc_gives_you_a_multiline_command_to/)
- [커뮤니티] michaellicious(2026-05): "Have they fixed the issue where copying and pasting bash commands adds extra newlines?" — [r/ClaudeAI 1tbwwel](https://www.reddit.com/r/ClaudeAI/comments/1tbwwel/claude_code_tips_for_terminal_users_from_a_senior/); HN mkw5053(2026-10-19) 복사 95%, 이미지·영상 붙여넣기·드래그 불가 — [HN 50155107](https://news.ycombinator.com/item?id=50155107)

**8. 데스크톱 앱 개편(참고: 터미널 아님)**
- [커뮤니티] 2026-10-14 글 본문: "They removed session context from the usage pop up (the circle next to the model/effort) and now only way to see it is with an obnoxious new 'session rail' which takes up more screen real-estate."(모델·effort 옆 작은 원에서 컨텍스트를 빼고 화면을 더 먹는 세션 레일로 옮겼다). Christian_Anon_ [15]: "why remove context usage from the circle popup… in the spot you can keep an eye on it from just the icon itself" — [r/ClaudeCode 1x5v1cg](https://www.reddit.com/r/ClaudeCode/comments/1x5v1cg/did_anyone_elses_claude_code_ui_just_update/)
- [커뮤니티] 2026-10-15 글: lardymcfly69 [5] "It now takes three clicks to change effort level instead of two. For zero benefit."(effort 바꾸는 데 클릭이 2번에서 3번) — [r/ClaudeCode 1x6is2o](https://www.reddit.com/r/ClaudeCode/comments/1x6is2o/claude_code_ui_update/)

**9. 메모리·프로세스**
- [커뮤니티] proc-stats 작성자(2026-10-11): "a Claude Code session costs 450MB RAM before even starting to do any work"(일 시작 전 세션당 450MB) — [HN 50047442](https://news.ycombinator.com/item?id=50047442)
- [커뮤니티] Tell HN "Claude CLI doesn't exit anymore, not even with CTRL-C"(2026-10-23, 8점): Agent View 때문에 백그라운드 프로세스가 남는다, `disableAgentView`로 끌 수 있다. uliseis: "the process you see is a background supervisor… 'claude daemon status'" — [HN 50214693](https://news.ycombinator.com/item?id=50214693)

**10. 입력기·작은 화면**
- [커뮤니티] Reddit r/ClaudeCode에서 "IME"(1년)·"Korean"(1년) 검색 상위 결과에 입력기 문제 글이 없었고, HN 댓글 검색("claude code IME/Japanese input/CJK/Korean", 2026-03 이후)도 관련 결과가 없었다("IME"는 "in my experience" 뜻으로만 나옴) — [Reddit 검색](https://www.reddit.com/r/ClaudeCode/search/?q=IME&sort=top&t=year)(접속 2026-10-26)
- [커뮤니티] 작은 화면 관련으로 가장 가까운 것: "Yet another statusline" 작성자가 "The layout has 3 different modes - narrow, medium and wide, which change at 55 & 80"(좁음·중간·넓음 세 모드), Mythril_Zombie [6] "A lot of empty space in the middle, A shorter but denser version would be nice."(2026-05-24) — [r/ClaudeCode](https://www.reddit.com/r/ClaudeCode/comments/1tmdxu9/yet_another_statusline/)

### Inferences
- [추론] "한도"와 "안 보임"은 같은 뿌리다: 사람들이 화내는 건 한도 자체보다 **왜 닳았는지 모른다**는 점이다(10-24 글의 "no breakdown or log", 2월 글의 "why it burned through 8k tokens"). 한도 % 표시만으로는 이 불만이 안 풀리고, "무엇이 얼마나 먹었나"까지 가야 한다.
- [추론] 깜빡임·스크롤백은 최근 3개월 검색 상위에서 사라졌으므로, hubblerc가 따로 고칠 대상은 아니다. 다만 전체 화면 모드 특유의 문제(마우스 스크롤 느림, UI 문구 복사)는 4월 기준 보고가 있었고 지금 고쳐졌는지는 확인 못 했다.
- [추론] 입력기 문제를 영어권에서 못 찾은 것은 문제가 없어서라기보다 영어권 사용자가 IME를 거의 안 쓰기 때문일 가능성이 크다. hubblerc의 `ctrl+x e`·`Option+E` 시행착오(스펙 기록)는 한국 커뮤니티 조사와 맞춰 봐야 한다.

### Gaps
- Reddit "We should be furious about this. Let's see if we can move the giant."(2026-10-22, 2,512표·511댓글)가 한도 검색에 걸렸지만 본문을 읽지 못해 내용을 모른다 — [r/ClaudeCode](https://www.reddit.com/r/ClaudeCode/comments/1xcnrxk/we_should_be_furious_about_this_lets_see_if_we/)
- 키 바인딩 불편(단축키 충돌 등) 글은 찾지 못했다.
- 긴 도구 출력(Bash 출력이 화면을 덮는 문제)만 다룬 글은 따로 찾지 못했다. 관측성 글은 오히려 "더 보여 달라" 쪽이다.
- 전체 화면 모드의 마우스·복사 문제가 10월 현재 고쳐졌는지 확인 못 했다.

## 3. 요청: "이런 게 있었으면"과 다른 CLI에서 부러워하는 기능

### Takeaway
가장 자주 보인 요청은 **한도·컨텍스트를 화면에 항상**, **한도 소진 속도(번다운)와 캐시 만료 시계**, **서브에이전트별 소모량**, **작업 내역·diff를 제대로**다. 다른 CLI와 비교할 때 부러워하는 것은 기능보다 **운영 방식**(OpenAI의 잦은 한도 리셋·소통, Codex의 반응 속도, OpenCode의 클라이언트/서버 구조와 UI 커스터마이즈)이 많다. Gemini CLI는 2026-06-18로 종료돼 비교 대상에서 빠졌다.

### Cited Findings

**화면 표시 요청**
- [커뮤니티] ryandrake(2026-08-27): "graphically display your quota usage on the screen at all times."(한도 사용량을 늘 화면에 그래프로). 답글 jdthedisciple: "You can enable showing the quota usage (and much more) in codex via /statusline"(Codex는 /statusline으로 이미 된다) — [HN 49468960](https://news.ycombinator.com/item?id=49468960)
- [커뮤니티] statusLine 자랑 글 댓글의 추가 요청(2026-05-24 "Yet another statusline"): yopla [3] 5시간·주간 한도의 선형 소진 대비 편차 "If I'm at 60% if shows ▲10.5% (so i'm burning too fast)"(이상적인 속도보다 얼마나 빠른지), aphelion83 [3] "Token burn rates with thresholds for both the main session and on a per-subagent level so you can keep an eye on the biggest hogs. And real time cache countdown."(메인·서브에이전트별 소모 속도와 실시간 캐시 카운트다운) — [r/ClaudeCode](https://www.reddit.com/r/ClaudeCode/comments/1tmdxu9/yet_another_statusline/)
- [커뮤니티] "Show me your /statusline"(2026-02-07, 215표·100댓글): OSUWebby [26] "I couldn't find a good way to show session and weekly limits / reset times."(세션·주간 한도와 리셋 시각을 보여 줄 방법을 못 찾았다), brain__exe [9] "Instead of 'thinking: on' you can also show the reasoning effort"(thinking 대신 effort를 보여 줘라), _megazz [3] 상태줄의 컨텍스트 %가 엔진이 띄우는 남은 % 경고와 안 맞는다 — [r/ClaudeCode](https://www.reddit.com/r/ClaudeCode/comments/1qycvdu/show_me_your_statusline/)
- [커뮤니티] 상태 표시 영역에 엔진이 끼워 넣는 문구 처리: daresTheDevil [2] "How do you handle the data that cc injects into that area…like /remote-control or 'image in clipboard'" — [r/ClaudeCode 1tmdxu9](https://www.reddit.com/r/ClaudeCode/comments/1tmdxu9/yet_another_statusline/)
- [커뮤니티] 자동 압축 전 알림: ClaudeStatsBar "your session is 486k deep and nothing told you"(2026-09-11, 18점·15댓글). 반응은 갈림: jondwillis "Could've asked Claude to put this in your status line.", cbg0 "Just use autocompact?", ethanj8011 "Insane slop title." — [HN 49658328](https://news.ycombinator.com/item?id=49658328)
- [커뮤니티] 캐시 만료 직전 압축: SOLAR_FIELDS(2026-10-22) "Newer versions of CC do in fact compact when the cache is close to expiry. I haven't seen it work 100% of the time" — [HN 50201188](https://news.ycombinator.com/item?id=50201188)

**누적 비용**
- [커뮤니티] Reddit "I made my Claude Code logs print a store receipt. $8.3k of tokens at API prices on a $200/mo plan"(2026-10-12, 220표·56댓글, 제목만) — [r/ClaudeCode](https://www.reddit.com/r/ClaudeCode/comments/1x4aqyi/i_made_my_claude_code_logs_print_a_store_receipt/); CodeBurn "Analyze Claude Code token usage by task"(2026-04-13, 112점) — [HN 47759035](https://news.ycombinator.com/item?id=47759035)

**권한·자동화**
- [커뮤니티] nomilk: Cursor의 "'allow once' and 'add command to allowlist'"가 낫다. steve_adams_86: "Claude Code also does this. It's a little broken, though. It gets hung up on nested commands"(Claude Code도 있지만 중첩 명령에서 꼬인다) — [HN 49239808](https://news.ycombinator.com/item?id=49239808)
- [커뮤니티] OpenCode 2.0 스레드 moretti(2026-10-15): "Does opencode support anything similar to claude code's auto mode?… 'yolo mode' feels risky" — auto 모드는 다른 CLI 사용자가 부러워하는 쪽 — [HN 50100763](https://news.ycombinator.com/item?id=50100763)

**다른 CLI 비교**
- [커뮤니티] Codex: 한도 마무리 기능 글 작성자 "I think codex already has this feature and glad to see this in claude as well."(Codex에 먼저 있었다, 이후 Codex에서 빠졌다는 댓글 다수) — [r/ClaudeCode 1wqagzu](https://www.reddit.com/r/ClaudeCode/comments/1wqagzu/claude_added_graceful_stopping_point_in_new_update/)
- [커뮤니티] Reddit "Anthropic, I think you really need to react. You're slowly losing ground."(2026-07-12, 1,380표·293댓글): Derio101 [145] "Open AI wins on: Cost Resets Communication", Mol2h [315] "since i got an openAI sub they did like 20 resets lol" — [r/ClaudeCode](https://www.reddit.com/r/ClaudeCode/comments/1uuqz4l/anthropic_i_think_you_really_need_to_react_youre/)
- [커뮤니티] Reddit "Claude Code (~100 hours) vs. Codex (~20 hours)"(2026-04-13, 2,312표·318댓글, "Opus High effort vs. Codex Medium effort"): Radical_Neutral_76 [21] "Codex doesnt break rules you give so much."(Codex가 규칙을 덜 어긴다) — [r/ClaudeCode](https://www.reddit.com/r/ClaudeCode/comments/1sk7e2k/claude_code_100_hours_vs_codex_20_hours/)
- [커뮤니티] 반응 속도: 3ln00b(2026-01-21) "Codex is so much more responsive for me no matter how long the session is running." — [HN 46701046](https://news.ycombinator.com/item?id=46701046)
- [커뮤니티] Codex의 반대 사례: "Codex CLI installs a persistent, self-updating background daemon by default"(2026-10-12, 610점·294댓글) — [HN 50060694](https://news.ycombinator.com/item?id=50060694). Claude Code도 Agent View 상주 프로세스로 같은 비판(2026-10-23, 위 2절 9번).
- [커뮤니티] OpenCode 2.0(2026-10-14, 888점·396댓글): ghrl "positive views on usability, the client/server model and self-awareness/ability to edit it's config and write plugins", esafak "I'd like a harness to let me customize the GUI, not just add MCPs and plugins… Give me UI building blocks (buttons, labels, etc.) and wire them with my own functions."(UI 블록을 주고 내 함수로 엮게 해 달라), 한 댓글 "I wish Claude Code would adopt the same model. The desktop app deploys a separate engine that restarts and clobbers long-running sessions upon reconnect" — [HN 50094994](https://news.ycombinator.com/item?id=50094994)
- [커뮤니티] OpenCode 쪽 악재: 토큰 오버헤드 비교 "Claude Code sends 33k tokens before reading the prompt; OpenCode sends 7k"(2026-07-12, 706점·395댓글) [HN 48883275](https://news.ycombinator.com/item?id=48883275), "OpenCode Hacked: User credentials leaked"(2026-10-17, 976점·185댓글) [HN 50133401](https://news.ycombinator.com/item?id=50133401)
- [커뮤니티] Gemini CLI: "Gemini CLI will stop working from June 18, 2026"(2026-05-19, 406점, 링크는 [공식] Google 블로그 "transitioning Gemini CLI to Antigravity CLI") — [HN 48196867](https://news.ycombinator.com/item?id=48196867)

### Inferences
- [추론] esafak의 "UI 블록을 달라" 요청은 Claude Code mod가 이미 하는 일이다(밴드·패널·버튼). OpenCode 사용자가 부러워하는 지점이 hubblerc 같은 mod의 존재 이유와 겹친다.
- [추론] "한도 % 표시"는 이미 흔하다(statusLine 자랑 글, Codex `/statusline`). 차별점은 **번다운(이상 속도 대비 편차)**, **서브에이전트별 소모**, **캐시 만료 시계** 쪽이다. 세 요청 모두 댓글 1건씩이라 수요 크기는 작게 잡아야 한다.

### Gaps
- Codex CLI·OpenCode의 TUI 기능(사이드바, 상태줄 항목)을 사용자가 구체적으로 부러워한 글은 찾지 못했다. 비교는 대부분 모델 품질·한도·회사 대응 이야기였다.
- 공식 기능으로 이미 들어간 요청(예: 사용량 화면의 소진 예측 경고)이 CLI 안에도 있는지는 확인 못 했다(공식 문서는 다른 조사자 담당).

## 4. mod 공개 반응, 공유된 mod·statusLine 자랑, effort 의견

### Takeaway
mod는 9월 중순 예고(HN), 2026-10-01 공개(Reddit 1.1천표·212댓글)됐다. 반응은 **"Claude Code를 Claude Code로 개조한다"는 흥분 + "쓸 데를 모르겠다"·"훅의 고급판일 뿐"·"악성 mod 위험"**으로 갈렸다. 2주 사이 공유된 mod 중 반응이 큰 것은 **읽기 피로 줄이기(cc-stretch 1.5천표)**와 **터미널에 이미지 보이기(1.5천표)**였고, 상태·한도 계열(컨텍스트 막대, 한도 가드, 물리 디스플레이)도 여럿이다. effort는 "대부분 medium이면 충분" 쪽 의견이 반복되고, 8월 effort A/B 소동은 팀 해명으로 일단락됐다.

### Cited Findings

**공개 전 예고(HN)**
- [커뮤니티] sync(2026-09-18): "they're releasing something called 'Claude Code mods', toted as their 'upcoming way to customize the Claude Code harness'" — [HN 49760309](https://news.ycombinator.com/item?id=49760309)
- [커뮤니티: 직원 자칭] mpoteat(2026-09-23, AGENTS.md가 텔레메트리 켜졌을 때만 읽히던 문제 스레드, 486점·284댓글): "The AGENTS.md support was implemented via our new extensibility system for CC, called Mods, which is launching soon-ish. A mod is a plugin with a new type of hook, which we call a function hook."(AGENTS.md 지원은 곧 나올 새 확장 체계 Mods로 만들었다. mod는 함수 훅이라는 새 훅을 가진 플러그인이다). 같은 댓글에서 피드백 이슈 #91870 안내. 텔레메트리 문제는 "fixed as part of v2.1.281" — [HN 49815421](https://news.ycombinator.com/item?id=49815421), [HN 49815363](https://news.ycombinator.com/item?id=49815363)
  - rickette: "Do you really need a whole plugin system to support that use case? Feels like this could have been a one line change." — [HN 49815527](https://news.ycombinator.com/item?id=49815527)
  - 63stack: "I can't tell if this is real, or you are making fun of overengineered AI solutions." / c0rruptbytes: "mods seem like a grasp at all the pi and dsh users"(pi·dsh 사용자를 붙잡으려는 시도) / pasteleft: "having mod support is definitely a plus for everyone." — 같은 스레드
  - amluto(답글 6): 사전 문서가 "Claudish"라 읽기 어렵다고 비판, 그리고 "Does this finally fix the limitation that there is no supportable way to replace the implementation of a native tool in Claude Code?"(내장 도구 구현을 바꿀 공식 방법이 생기나) — [HN 49816799](https://news.ycombinator.com/item?id=49816799)

**공개 후 Reddit**
- [커뮤니티] "Introducing Claude Mods"(2026-10-01, 1,123표·212댓글, 링크 [공식] https://claude.com/blog/claude-code-mods — 블로그 본문은 이 조사에서 안 읽음) — [r/ClaudeCode](https://www.reddit.com/r/ClaudeCode/comments/1wvc7vc/introducing_claude_mods/)
  - pm_your_snesclassic [221]: "earlier this year I was excited with modding games with Claude code, but now I'm excited with modding Claude code with Claude code"
  - Sleepywalker69 [180]: "Need a mod that re-writes the prompt so it doesn't get cyber flagged"(보안 필터에 안 걸리게 프롬프트를 고쳐 주는 mod가 필요)
  - Level-Physics-1730 [154]: 데스크톱 앱용 자작 mod 체계를 이미 만들었다(gitlab claude-ui-mod)
  - Malenx_ [59]: "Then they'll take the best mods and and ingest or rewrite them."(좋은 mod는 결국 공식이 흡수할 것)
  - atehrani [49]: "With one function, a mod can: Rewrite a prompt… Block, rewrite, or retry a tool call. Approve or deny a permission request. Redact secrets… Seems ripe for malicious mods"(악성 mod가 나오기 좋은 구조)
  - OofWhyAmIOnReddit [38]: "this is basically just a more advanced form of hooks."(결국 훅의 고급판)
  - cafepeaceandlove [32]: 처음엔 벤더 종속을 의심했지만 "we can rewrite one system's 'mods' into another system's in a couple of hours now"
  - dbbk [9]: "Didn't expect this to work in the desktop app."
- [커뮤니티] "mods is insane. I love it"(2026-10-07, 313표·130댓글). 본문: "They basically let you change how Claude Code works from the inside… For months I had hooks and scripts bolted on from the outside… now all of that is a mod that lives in the session." 최다 댓글 radgh [388]: "And not a single example was given. ok"(예시 하나도 없네). skitchbeatz [156]: "For the life of me I just cant figure out a use case that I need this for." 답글: grateful2you [18] "keeps a tab on the context usage. (Bar chart helped me identify expanding tool output context)"(컨텍스트 막대 덕에 커지는 도구 출력을 찾았다), EYtNSQC9s8oRhe6ejr [7] "Git status in a sidebar is nice", Time_Cat_5212 [85] 비꼼("BUT CONFIG THO twists knobs pushes buttons…"). JayArrCoffee [41]: 다른 회사 모델을 "pseudo-native sub agents"로 붙였다 — [r/ClaudeCode](https://www.reddit.com/r/ClaudeCode/comments/1x04oq4/mods_is_insane_i_love_it/)
- [커뮤니티] HN 후기: UberMouse(2026-10-17) "The Workflow engine, the Mod system. I've tried to explore other coding harnesses and nothing is as powerful as claude code" — [HN 50127717](https://news.ycombinator.com/item?id=50127717); EduardoBautista(2026-10-19) "with the new claude code mods feature I think it's something I could vibe code quickly." — [HN 50154231](https://news.ycombinator.com/item?id=50154231)

**공유된 mod (반응 순)**
| 날짜 | mod | 반응 | 하는 일 | 출처 |
|---|---|---|---|---|
| 2026-10-11 | claude-show-your-work | 1,544표·214댓글 | 스크린샷·영상을 터미널에 표시(kitty 그래픽 프로토콜, Ghostty·kitty) | [r/ClaudeCode](https://www.reddit.com/r/ClaudeCode/comments/1x34qj4/claude_code_now_shows_images_and_videos_in_the/) |
| 2026-10-15 | cc-stretch | 1,511표·128댓글 | 답변을 83% 접고 필요할 때 펼침 | [r/ClaudeCode](https://www.reddit.com/r/ClaudeCode/comments/1x688sx/turning_a_crazy_idea_from_1967_into_a_claude_code/) |
| 2026-10-05 | 사용량·컨텍스트 → USB 물리 디스플레이 | 371표·88댓글 | 구독 사용량과 컨텍스트를 ESP32 화면으로 | [r/ClaudeCode](https://www.reddit.com/r/ClaudeCode/comments/1wye4ix/i_just_wanted_to_try_the_new_claude_code_mods_i/) |
| 2026-10-22 | agent-usage-guard | HN 28점·12댓글 | 한도 80%에서 묻고 95%에서 거부, 캐시 만료 + 큰 컨텍스트면 압축 제안, 서브에이전트 폭주 제한 | [HN 50198936](https://news.ycombinator.com/item?id=50198936) |
| 2026-10-20 | ascii-tree mod | 6표·4댓글 | 답변을 색 입힌 ASCII 트리로 | [r/ClaudeCode](https://www.reddit.com/r/ClaudeCode/comments/1xb4twe/i_made_an_asciitree_mod_for_claude_code_to_reduce/) |
| 2026-10-19 | cc-split-diff-view | 5표·4댓글 | Edit/Write diff를 좌우 비교로 | [r/ClaudeCode](https://www.reddit.com/r/ClaudeCode/comments/1x9svqw/i_made_a_claude_code_mod_for_sidebyside_diffs/) |
| 2026-10-05 | Doom | 7표·3댓글 | mod로 Doom 실행 | [r/ClaudeCode](https://www.reddit.com/r/ClaudeCode/comments/1wyc0nc/time_well_spent_yes_claude_mods_can_run_doom/) |
| 2026-10-24 | 텍스트 어드벤처 | 7표·5댓글 | 하네스 + 플레이어 UI를 mod로 | [r/ClaudeCode](https://www.reddit.com/r/ClaudeCode/comments/1xeabvr/used_claude_code_as_both_the_realtime_agent/) |
| 2026-10-13 | diffr | HN 7점 | diff 엔진, TUI·웹·mod | [HN 50076982](https://news.ycombinator.com/item?id=50076982) |
| 2026-10-11 | proc-stats | HN 1점 | 세션 RAM·하위 프로세스 보기 | [HN 50047385](https://news.ycombinator.com/item?id=50047385) |
| 2026-10-09 | agent-config mod | HN 2점 | 플러그인별 설정을 화면에 | [HN 50024345](https://news.ycombinator.com/item?id=50024345) |
| 2026-10-03 | desktop-statusline | HN [dead] | CLI statusLine을 데스크톱 앱에 | [HN 49946192](https://news.ycombinator.com/item?id=49946192) |

- [커뮤니티] mod 버전: cc-split-diff-view 작성자 "When mods became available in Claude Code (with version 2.1.287)", agent-usage-guard "needs Claude Code 2.1.287 or later" — 위 링크들
- [커뮤니티] 보안 지적: claude-show-your-work의 `register.tsx`를 읽은 hiaro [11] "It updates itself from main, on by default… Telemetry is on by default."(main에서 자동 업데이트, 텔레메트리 기본 켜짐). 작성자가 "All of the changes listead above have since been implemented"라고 답함 — [r/ClaudeCode 1x34qj4](https://www.reddit.com/r/ClaudeCode/comments/1x34qj4/claude_code_now_shows_images_and_videos_in_the/)
- [커뮤니티] tmux 주의: electro042 [15] "if anyone's running this inside tmux… set -g allow-passthrough on" — 같은 글
- [커뮤니티] 웹 검색 결과로 본 묶음 저장소: hamzafer/claude-code-mods "add live lines above the prompt… Context bar, usage meter… prompt-cache clock"(2.1.287+) — [GitHub](https://github.com/hamzafer/claude-code-mods), GitHub 토픽 [claude-code-mods](https://github.com/topics/claude-code-mods) (접속 2026-10-26, 다른 조사자의 갤러리 영역이라 깊이 안 봄)

**statusLine 자랑 글(mod 이전 방식)**
- [커뮤니티] "Show me your /statusline"(2026-02-07, 215표·100댓글): 최다 댓글 Special-Economist-64 [78] "This is statusparagraph, instead of statusline"(상태줄이 아니라 상태 문단) — [r/ClaudeCode](https://www.reddit.com/r/ClaudeCode/comments/1qycvdu/show_me_your_statusline/)
- [커뮤니티] "Yet another statusline"(2026-05-24, 246표·66댓글): daliovic [33] "More like status-essay /s", Such_Independent_234 [5] "Looks nice but holy noise.", 작성자 "it takes up 20 lines… If none of those things are going on then it takes up 10 lines"(최대 20줄) — [r/ClaudeCode](https://www.reddit.com/r/ClaudeCode/comments/1tmdxu9/yet_another_statusline/)
- [커뮤니티] "My minimal Claude Code statusline config"(2026-02-27, 185표·34댓글, 제목만) — [r/ClaudeCode](https://www.reddit.com/r/ClaudeCode/comments/1rg3nmt/my_minimal_claude_code_statusline_config/)
- [커뮤니티] Show HN 계열: rate-limit 번다운 상태줄(2026-06-08, 8점) 작성자 "goes green to red as I burn it down… The lines added/removed counter is the one I didn't expect to like. it's a quick 'did I actually do anything this session' check"(초록→빨강 번다운, 추가/삭제 줄 수가 의외로 좋았다) — [HN 48441174](https://news.ycombinator.com/item?id=48441174); statuslin.es 커뮤니티 갤러리(2026-08-17, 13점) [HN 49330285](https://news.ycombinator.com/item?id=49330285); Claudoro 포모도로(2026-07-01, 50점·36댓글), fellowmartian "From the title I thought it'd be a timer for the agent itself, so it doesn't waste time on endless thinking loops" [HN 48745590](https://news.ycombinator.com/item?id=48745590); hungryhobbit(2026-08-27) "changed the bottom of the CLI to say: Usage: 34% (resets in 2h 47m) Context: 56% [Opus 4.6]" [HN 49469127](https://news.ycombinator.com/item?id=49469127); 사용량 LCD(2026-08-15, 14점) [HN 49314594](https://news.ycombinator.com/item?id=49314594); Reddit 사용량 데스크톱 모니터(2026-08-10, 355표·73댓글, 제목만) [r/ClaudeCode](https://www.reddit.com/r/ClaudeCode/comments/1vk5lhv/made_a_usage_meter_desktop_monitor_cause_why_not/)
- [커뮤니티] 데스크톱 앱으로 확장: "Status lines can now be used in the Claude desktop app"(2026-10-02, 8표, 제목만) — [r/ClaudeCode](https://www.reddit.com/r/ClaudeCode/comments/1wvwxru/status_lines_can_now_be_used_in_the_claude/)

**effort 의견**
- [커뮤니티] HN "Anthropic appears to be A/B testing reduced effort levels in Claude Code"(2026-08-22, 216점·191댓글). [커뮤니티: 직원 자칭] trq_(Thariq): "one running now maps the numerical effort value differently… The scale isn't 0-100, the number isn't meaningful on its own, and the effort you selected is the effort you're getting."(실험 중인 설정이 숫자 매핑만 다르게 한다, 고른 effort 그대로 받는다) — [HN 49404033](https://news.ycombinator.com/item?id=49404033)
  - Wowfunhappy(답글 3): 근거가 모델에게 effort를 물어본 것뿐인데 "how would the model even know that?" — [HN 49401879](https://news.ycombinator.com/item?id=49401879)
  - onlyrealcuzzo: "IIUC, the consensus seems to be that anything more than medium effort is rarely worth it"(medium보다 높은 effort는 거의 값어치가 없다는 게 대세) / 반론 gwerbin: 세부가 많은 작업은 "the very large amount of thinking tokens seem to give the model a chance to 'remember' everything" — [HN 49404627](https://news.ycombinator.com/item?id=49404627)
  - 한 사용자: "sonnet 5 low/medium when I have a plan… opus low/medium for more complex… only go high when it's very complex… Never go xhigh or max." — 같은 스레드 [HN 49401549](https://news.ycombinator.com/item?id=49401549)
- [커뮤니티] Reddit "Haiku 5.5 is 40x cheaper than Opus 5.5. Your Explore subagent is probably still running on Opus"(2026-10-08, 736표·123댓글): 본문 "it's the first Haiku with an effort setting", "Claude Code's built-in Explore subagent no longer runs on Haiku. It uses your main model". Declwn [12] "one opus medium agent is better, cheaper, and faster than the number of Haiku agents (on any effort level) it takes to match its quality", zaibatsu [55] "route by verifiability, not difficulty"(난이도가 아니라 검증 가능성으로 모델을 나눠라) — [r/ClaudeCode](https://www.reddit.com/r/ClaudeCode/comments/1x0kzbh/haiku_55_is_40x_cheaper_than_opus_55_your_explore/)
- [커뮤니티] 데스크톱 앱에서 effort 변경 클릭 수 증가 불만(2절 8번), "Ask HN: How are thinking efforts implemented?"(2026-06-07, 104점·31댓글, 제목만) — [HN 48434240](https://news.ycombinator.com/item?id=48434240)

### Inferences
- [추론] mod 반응에서 가장 큰 반대는 "쓸 데를 모르겠다"(156점)와 "예시가 없다"(388점)였다. 반대로 찬성 쪽이 든 실제 예시는 컨텍스트 막대, 사이드바 git 상태처럼 hubblerc F1·F2와 거의 같은 것들이다. hubblerc를 공개할 때 스크린샷과 구체 사용 장면이 반응을 가를 것이다.
- [추론] statusLine 자랑 글의 최다 댓글이 둘 다 "문단/에세이 같다"는 비꼼이다. 정보를 많이 넣을수록 놀림받는 패턴이 반복되므로, F1의 3줄 고정·폭 부족 시 덜어내기 원칙이 이 비판을 피하는 방향이다.
- [추론] mod 보안(자동 업데이트·텔레메트리·프롬프트 재작성 권한)에 대한 지적이 공개 직후부터 있다. hubblerc가 네트워크 호출을 하지 않는다면 그 점을 공개 문서에 밝히는 게 좋다(agent-usage-guard도 "makes no network calls"를 앞세움).
- [추론] effort는 "medium이 기본, 필요할 때 올린다" 의견이 여럿이라 F3 auto 라벨 초안(간단→medium, 일반→high, 설계·디버깅→xhigh)은 커뮤니티 감각보다 한 단계 높다. 단 이는 의견 3~4건 수준이다.

### Gaps
- 공식 공개 블로그(claude.com/blog/claude-code-mods)의 정확한 공개일·내용은 확인 안 했다(Reddit 글 날짜 2026-10-01로 추정). 공식 문서는 다른 조사자 담당.
- HN에서 mod 공개 자체를 다룬 큰 스레드는 찾지 못했다(2026-09-10 이후 "mods" 검색 상위에 없음). HN 반응은 예고 댓글과 작은 Show HN에 흩어져 있다.
- r/ClaudeAI에서 mod 반응 글은 검색 상위에 없었다(검색 결과가 무관한 인기 글로 채워짐).
- "Do you agree?"(2026-10-17, 1.5천표·208댓글)가 effort 검색에 걸렸지만 내용은 확인 못 했다 — [r/ClaudeCode](https://www.reddit.com/r/ClaudeCode/comments/1x8no04/do_you_agree/)

## 5. hubblerc F1~F5·후보가 무엇을 해결하고 무엇을 안 다루나

### Takeaway
hubblerc는 **불편 1위(한도·컨텍스트가 안 보임)와 2위(무엇을 했는지 안 보임)를 정면으로 다룬다**. F1·F5는 커뮤니티가 statusLine·외부 도구·mod로 각자 만들던 것을 한곳에 모은 형태다. 반면 **3위(여러 세션 중 누가 기다리나)·4위(장황한 답변)·권한 승인·복사**는 다루지 않는다. 후보 중 "한도 소진 예측"과 "압축 직전 경고"는 요청 근거가 있지만 이미 비슷한 공식 기능과 mod가 있다. "MCP 끊김 경고"와 "기기 라벨"은 요청 근거를 찾지 못했다.

### Cited Findings

**F1 상태 밴드(모델·effort, ctx %, 5h/7d·리셋, 브랜치 / 실행 중 / 직전 요약)**
- 해결하는 불편: 한도·리셋 시각을 보여 달라(OSUWebby [26], ryandrake), 컨텍스트 막대가 쓸모 있었다(grateful2you [18]), effort를 보여 달라(brain__exe [9]) — [r/ClaudeCode 1qycvdu](https://www.reddit.com/r/ClaudeCode/comments/1qycvdu/show_me_your_statusline/), [HN 49468960](https://news.ycombinator.com/item?id=49468960), [r/ClaudeCode 1x04oq4](https://www.reddit.com/r/ClaudeCode/comments/1x04oq4/mods_is_insane_i_love_it/)
- 같은 것을 이미 만든 사례: hungryhobbit "Usage: 34% (resets in 2h 47m) Context: 56% [Opus 4.6]"(2026-08-27) [HN 49469127](https://news.ycombinator.com/item?id=49469127), hamzafer/claude-code-mods의 context bar·usage meter [GitHub](https://github.com/hamzafer/claude-code-mods)
- 주의할 비판: "statusparagraph"[78], "status-essay"[33], "holy noise"[5], "A shorter but denser version would be nice"[6] — 1·4절 링크
- 데스크톱 개편 불만(컨텍스트를 아이콘 자리에서 빼서 레일로 옮김, 2026-10-14)은 "작은 자리에서 한눈에" 수요를 보여 준다 — [r/ClaudeCode 1x5v1cg](https://www.reddit.com/r/ClaudeCode/comments/1x5v1cg/did_anyone_elses_claude_code_ui_just_update/)
- 2줄 "실행 중 도구·서브에이전트" 관련: 서브에이전트 폭주로 한도를 날린 경험(zionek [78]), 세션이 멈췄는지 판단 신호로 "turn length"와 "context climbing with no new diff"(heyyarun) — [r/ClaudeCode 1wqagzu](https://www.reddit.com/r/ClaudeCode/comments/1wqagzu/claude_added_graceful_stopping_point_in_new_update/), [r/ClaudeCode 1x1z70y](https://www.reddit.com/r/ClaudeCode/comments/1x1z70y/a_claude_code_session_asked_for_bash_permission/)

**F2 사이드바 vs 밴드 자동 전환**
- 근거: "Git status in a sidebar is nice"[7] 1건 — [r/ClaudeCode 1x04oq4](https://www.reddit.com/r/ClaudeCode/comments/1x04oq4/mods_is_insane_i_love_it/). 폭에 따라 narrow/medium/wide로 바꾸는 statusLine 사례 1건 — [r/ClaudeCode 1tmdxu9](https://www.reddit.com/r/ClaudeCode/comments/1tmdxu9/yet_another_statusline/)
- 반대 신호: 데스크톱의 "session rail which takes up more screen real-estate"(화면을 더 먹는 레일) 불만 — [r/ClaudeCode 1x5v1cg](https://www.reddit.com/r/ClaudeCode/comments/1x5v1cg/did_anyone_elses_claude_code_ui_just_update/)

**F3 effort 수동 슬라이더 + auto 분류**
- 수동 빠른 변경 수요: 데스크톱 "three clicks to change effort level instead of two" 불만[5] — [r/ClaudeCode 1x6is2o](https://www.reddit.com/r/ClaudeCode/comments/1x6is2o/claude_code_ui_update/)
- auto 분류 직접 요청은 못 찾음. 관련 의견: "medium보다 높은 건 거의 값어치 없음"(onlyrealcuzzo), "Never go xhigh or max", "route by verifiability"(zaibatsu [55]) — [HN 49404627](https://news.ycombinator.com/item?id=49404627), [r/ClaudeCode 1x0kzbh](https://www.reddit.com/r/ClaudeCode/comments/1x0kzbh/haiku_55_is_40x_cheaper_than_opus_55_your_explore/)
- effort 표시의 신뢰 문제: 8월 A/B 소동은 "모델에게 물어본 effort" 때문이었고 팀은 숫자 매핑만 다르다고 해명 — [HN 49404033](https://news.ycombinator.com/item?id=49404033)

**F4 Bash 행에 용도 표시**
- 관련 불만은 반대 방향이다: 사람들은 "Read 3 files" 같은 요약 때문에 **더 자세히** 보고 싶어 한다(claude-devtools, 888표 글) — [HN 47004712](https://news.ycombinator.com/item?id=47004712), [r/ClaudeCode 1r3to9f](https://www.reddit.com/r/ClaudeCode/comments/1r3to9f/claude_codes_cli_feels_like_a_black_box_now_i/)
- Bash 명령 대신 용도를 보여 달라는 직접 요청은 찾지 못했다.

**F5 답변별 활동 기록(변경 파일 ±, 읽음, 검색, Bash), 답변 끝 요약 줄, /activity, resume 복원**
- 해결하는 불편: "the 'done' with no context thing drives me insane"[63], "Real Diffs… Agent Trees"(claude-devtools 기능), "did I actually do anything this session" 확인용 추가/삭제 줄 수(fotoflo) — [r/ClaudeCode 1r3to9f](https://www.reddit.com/r/ClaudeCode/comments/1r3to9f/claude_codes_cli_feels_like_a_black_box_now_i/), [HN 48441174](https://news.ycombinator.com/item?id=48441174)
- 아직 안 다루는 부분: "왜 토큰을 이만큼 썼나"(파일/도구 출력/생각별 분해) — claude-devtools의 "Context Forensics", Reddit 작성자 답글 "package-lock.json is consuming 40% of your context window" 예시 — 같은 링크

**후보**
- 5시간 한도 소진 예측: 요청 근거 yopla(번다운 편차), HN 번다운 상태줄, Claumon(2026-06-11, 7점) [HN 48488753](https://news.ycombinator.com/item?id=48488753), agent-usage-guard의 "burn rule (20 points of the 5-hour window in 10 minutes)" [HN 50200180](https://news.ycombinator.com/item?id=50200180). 공식 사용량 화면에 이미 "At this pace you'll run out tonight, before the Oct 31 reset." 경고가 있다는 사용자 보고(2026-10-24, 주간 기준) — [r/ClaudeCode 1xelhl0](https://www.reddit.com/r/ClaudeCode/comments/1xelhl0/max_plan_reset_literally_this_morning_and_53_of/)
- 오늘 누적 비용·시간: "store receipt $8.3k" 글(220표), ClaudeStatsBar "cost/turn and the burn rate" — [r/ClaudeCode 1x4aqyi](https://www.reddit.com/r/ClaudeCode/comments/1x4aqyi/i_made_my_claude_code_logs_print_a_store_receipt/), [HN 49658667](https://news.ycombinator.com/item?id=49658667)
- 자동 압축 직전 경고: ClaudeStatsBar("486k deep and nothing told you"), agent-usage-guard "500k context before it asks to compact". 반대 "Just use autocompact?" — [HN 49658328](https://news.ycombinator.com/item?id=49658328), [HN 50198936](https://news.ycombinator.com/item?id=50198936)
- 백그라운드 작업·서브에이전트 진행: "per-subagent" 소모 요청(aphelion83), claude-devtools "Agent Trees… usually interleaved and confusing in the CLI" — [r/ClaudeCode 1tmdxu9](https://www.reddit.com/r/ClaudeCode/comments/1tmdxu9/yet_another_statusline/), [HN 47004712](https://news.ycombinator.com/item?id=47004712)
- 기기 라벨: SSH·원격 기기로 작업하는 흐름은 있다(1w9yzkw 514표), 라벨 요청은 못 찾음.
- MCP 끊김 경고: 관련 글을 찾지 못함.

**hubblerc가 안 다루는 것(새 아이디어 후보)**
- 대기·권한 대기 알림: peon-ping 1006점, 커서 로고 227표, "Bash permission at minute three… noticed at minute forty" 106표 — 1·2절 링크
- 읽기 피로: cc-stretch 1.5천표, fullup72 [83] "새로 펼친 글에 다른 색", TheLastNapkin [6] 키보드로 펼치기 — [r/ClaudeCode 1x688sx](https://www.reddit.com/r/ClaudeCode/comments/1x688sx/turning_a_crazy_idea_from_1967_into_a_claude_code/)
- 캐시 만료 시계: aphelion83 "real time cache countdown", hamzafer mod "prompt-cache clock", sva_ "95%는 캐시 만료된 큰 컨텍스트" — 3절 링크
- 복사: `/copy`와 전체 화면으로 대부분 해결됐다는 반응(2026-06) — [r/ClaudeCode 1uciszz](https://www.reddit.com/r/ClaudeCode/comments/1uciszz/when_cc_gives_you_a_multiline_command_to/)

### Inferences
- [추론] F1+F5 조합(한도·컨텍스트 + 답변별 무엇을 했나)은 2026년 내내 반복된 "블랙박스" 불만에 대한 가장 직접적인 답이다. 다만 비슷한 mod(컨텍스트 막대·사용량 계기)가 공개 2~3주 만에 여럿 나왔으므로, 공개 시 차별점은 **답변 단위 기록 + resume 복원 + 폭에 따른 자동 레이아웃**에 둬야 한다.
- [추론] F4는 커뮤니티 정서와 어긋날 위험이 있다. 사람들은 요약 때문에 내용을 잃는 걸 싫어한다. F4가 명령어를 "흐리게/접기"까지 가면 같은 반발을 살 수 있으니, 명령어를 숨기기보다 **용도를 덧붙이는** 표현이 안전하다(스펙상 `ctrl+o`에서 원래 행을 보여 주는 것은 이 우려를 일부 덜어 준다).
- [추론] 소진 예측 후보는 공식 사용량 화면이 이미 주간 기준 "At this pace…" 경고를 하는 것으로 보이므로(사용자 1건 보고, CLI 안에도 있는지는 미확인), hubblerc가 만든다면 **5시간 창 기준 + 지금 세션·서브에이전트가 얼마나 기여하나**처럼 공식이 안 하는 쪽이 낫다.
- [추론] 사용자 본인이 Orca(멀티 세션 관리)를 쓰므로 "누가 나를 기다리나"는 Orca 몫으로 남기고, hubblerc는 세션 안에서 "권한 대기 중"을 밴드 2줄에서 눈에 띄게 하는 정도가 분업에 맞다. 단 권한 대기 상태를 mod가 읽을 수 있는지는 확인 안 했다.

### Gaps
- MCP 연결 끊김 불편을 다룬 Reddit·HN 글은 찾지 못했다(검색어 "MCP disconnected claude code" 결과 없음).
- 작은 모니터·큰 모니터를 오가며 레이아웃을 바꾸고 싶다는 직접 요청은 찾지 못했다. F2의 근거는 사용자 본인 사용 패턴이 주가 된다.
- 기기 라벨 요청은 찾지 못했다.
- 한국어 입력기 관련은 한국 커뮤니티 조사(같은 폴더 `korean_threads.md`)와 맞춰 봐야 한다.
