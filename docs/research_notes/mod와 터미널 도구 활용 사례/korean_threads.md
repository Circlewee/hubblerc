# 한국어 커뮤니티·Threads에서 본 Claude Code 터미널 사용 사례

조사일 2026-10-26. 표시: [공식] Anthropic·도구 제작사 문서 / [커뮤니티] 사용자 글·블로그·Q&A / [추론] 조사자 판단. 날짜는 게시일이고, 상대 표기("6달 전", "1일")만 있으면 그대로 적었다.

출처 읽은 방법:
- 웹 글: WebSearch → WebFetch로 원문을 열어 확인. "검색 요약"이라고 쓴 항목은 검색 엔진 요약만 보고 원문은 열지 못한 것이다.
- Threads: 웹 검색에서 threads.net이 막혀 있어 Aside 브라우저 에이전트로 읽었다(사용자 계정 로그인 상태, 검색 막힘 없음, 읽기만 함). 검색어 7개(클로드 코드 한글 / 클로드 코드 상태줄 / claude code statusline / 클로드 코드 터미널 / ccusage / claude code mod / 클로드 코드 한도) + 추가(statusline, ccstatusline, claude-hud). Threads 항목은 **Aside 에이전트가 읽고 요약한 것**이고 조사자가 원문을 직접 열어 보지는 않았다. 상대 날짜("1일")는 2026-10-26 오전 10시경(KST) 기준, 좋아요·댓글 수는 그 시점 값.

범위 밖(영어권 Reddit/HN, anthropics/claude-code 이슈 본문, 공식 mod 문서, statusLine 도구 README)은 한국어 글이 언급한 만큼만 요약했다.

## 1. 한국 개발자가 공유한 터미널 셋업 (터미널 앱, tmux, statusLine, 알림 훅, 여러 세션, 사용량 확인)

### Takeaway
한국어 셋업 글은 "상태줄에 컨텍스트 %·5시간/7일 한도·브랜치·모델(+effort)을 띄운다"로 모인다. 직접 셸 스크립트(jq)를 짜거나 Claude에게 만들게 하는 글이 claude-hud·ccstatusline 소개보다 많고, 동기는 "/usage를 계속 치기 싫다"였다. 2026-10월 Threads에서는 터미널 앱으로 Orca·Warp 얘기가 가장 많았고(Orca 글 3건, 하나는 좋아요 104), ccusage를 메뉴바·위젯으로 띄우는 도구 공유가 눈에 띄었다. tmux·알림 훅을 다룬 한국어 글은 Threads에서 0건, 웹에서도 거의 없었다.

### Cited Findings
**statusLine 직접 구성**
- [커뮤니티] Dale Seo(달레) 블로그 「클로드 코드 상태줄: 터미널 하단을 나만의 대시보드로」(2026-03-22, 업데이트 2026-06-27). 한 줄 구성: 디렉터리·브랜치·Git 상태(Starship 스타일, +초록 !노랑 ?빨강, ⇡⇣ ahead/behind) → vim 모드(쓸 때만) → 컨텍스트 막대 → 세션 비용 → 5시간·7일 한도(Pro/Max) → 모델과 effort. 값이 없는 칸은 구분자째 생략. effort는 단계별 색(low 회색 ~ max 굵은 빨강). 비용은 단가 추정이 아니라 `cost.total_cost_usd` 실측값(캐시 토큰 반영). git은 `git -C "$cwd" --no-optional-locks`로 잠금 충돌을 피한다. Nerd Font가 없으면 아이콘을 빼라, `echo -e` 대신 `printf '%b'`, macOS Terminal.app은 OSC 8 링크 미지원. ccstatusline·claude-hud 언급 없음, 추이는 ccusage를 보라고 함 — [daleseo.com/claude-code-statusline](https://daleseo.com/claude-code-statusline/)
  - hubblerc: F1 1줄과 항목·순서가 거의 같다(비용만 F1은 기본 숨김). F1이 브랜치를 git으로 읽으므로 `--no-optional-locks`를 그대로 가져올 만하다. "값 없는 칸은 구분자째 생략"은 F1의 폭 줄이기 규칙과 같은 발상.
- [커뮤니티] GeekNews Show GN 「Claude Code Status Bar - 컨텍스트, 비용, rate limit을 항상 보여주는 status line」(remin1994, "6달 전", 접속 2026-10-26). 셸 + jq로 3줄: 디렉터리, 브랜치, 모델, 컨텍스트 막대, 5시간·주간 한도. 컨텍스트 70%를 넘으면 경고 아이콘이 바뀌어 `/compact`·`/clear` 시점을 알린다. 만든 이유: "작업 중 컨텍스트와 rate limit 잔량을 보려고 /usage를 반복 입력하게 돼서". 댓글 2개: greekr4 "매일 Claude에게 시켜서 커스텀해 쓰고 있었는데 이게 더 깔끔", kurthong "실용적" — [news.hada.io/topic?id=28227](https://news.hada.io/topic?id=28227)
  - hubblerc: F1 그대로. 후보 "자동 압축 직전 경고"의 근거(70% 경고가 이미 공유된 요구).
- [커뮤니티·Threads] @papapat.ai(2026-04-29, 좋아요 1/댓글 2): ccstatusline을 쓰려다 그만둔 이유 두 가지 — 매번 최신 버전이 자동 실행되는 점(`npx …@latest`), 사용량 위젯이 인증 토큰으로 Anthropic 서버를 직접 호출하는 점. 대신 Claude에게 bash 상태줄을 만들게 함: 폴더, 모델+effort, 컨텍스트 %, git, 토큰, AUTO 모드 6항목 — threads.com/@papapat.ai/post/DXtpqBeAXmy
  - hubblerc: mod는 `$.session.usage()`로 한도를 엔진에서 받아 토큰을 들고 외부를 호출하지 않는다 — 공개 시 내세울 차이. "AUTO 모드" 표시 요구는 권한 모드 표시 아이디어(3절)의 근거.
- [커뮤니티·Threads] @yw_0woo("6일", 좋아요 0/댓글 1): statusline에 prompt cache의 warm 값을 띄우면 캐시가 식는 순간이 바로 보인다. 앞 글에서 "구독 캐시는 1시간, API 키는 5분이라 사용량이 갑자기 빠지는 건 캐시 만료 때문인 경우가 많다"고 적음(작성자 주장, 미검증) — threads.com/@yw_0woo/post/DerAyjokQP4
  - hubblerc: 새 아이디어 — "캐시 식음" 표시(마지막 요청 후 경과 시간 / 캐시 적중률). spec의 "auto effort가 캐시 적중률을 떨어뜨리는가" 확인 항목과도 직결.
- [커뮤니티·Threads] @ramg_td(2026-10-10, 좋아요 9): `/statusline`으로 화면 하단에 컨텍스트와 남은 사용량을 띄우는 법, `remoteControlAtStartup`, `/btw`, Ctrl+X 다음 Enter 소개 — threads.com/@ramg_td/post/DeT_fNFE-GZ
- [커뮤니티] 한국어 가이드: `/statusline 컨텍스트 70% 넘으면 노랑, 90% 넘으면 빨강으로`처럼 자연어로 만들게 하는 방법(검색 요약) — [potato-ai.xyz](https://potato-ai.xyz/claude-code-statusline-context-git-workflow/), [공식 한국어 문서](https://code.claude.com/docs/ko/statusline.md)
  - hubblerc: F1 색 단계(60%/85%)와 비교 대상. 한국어 글들의 임계값은 70%·90%.
- [커뮤니티] 인프런 Q&A 「statusline 설정」(2026-04-03, Windows + Cursor): `/statusline`을 설정했는데 안 보임. 강사(짐코딩): "/statusline 내 컴퓨터는 Windows 환경이야. 설정을 해줘."처럼 환경을 같이 알려라 — [inflearn 1796746](https://www.inflearn.com/community/questions/1796746/statusline-설정)

**claude-hud / ccstatusline / ccusage**
- [커뮤니티] PyTorch Korea 「Claude HUD … 실시간 상태 표시줄 플러그인」(9bow, 2026-01-14): 모델, 컨텍스트 게이지, 경로, 브랜치, 설정 파일 수, 세션 경과, (선택) 5시간 한도, 실행 중/완료 도구, 서브에이전트 작업·시간, 할 일 진행. 세션 JSONL 파싱. 좋아요 2, 댓글 없음 — [discuss.pytorch.kr/t/…/8690](https://discuss.pytorch.kr/t/claude-hud-claude-code-statusline/8690)
- [커뮤니티·Threads] @qjc.ai(2026-03-27): claude-hud와 CCometixLine, claude-powerline, ccstatusline, claudia-statusline 비교. claude-hud의 장점으로 에이전트 모니터링, TODO 추적, 11,500 스타 — threads.com/@qjc.ai/post/DWYJbUME461
- [커뮤니티·Threads] ccstatusline 소개 글 2건: @developk88(2026-09-20), @limedaddy_8924(2026-08-31, 좋아요 4) — 위젯·파워라인 꾸미기, `npx ccstatusline@latest`로 설정 — threads.com/@developk88/post/Ddf5p5hj4Bf, threads.com/@limedaddy_8924/post/Dcq1BEFFGVn
  - hubblerc: F1 2줄(도구·서브에이전트·할 일)이 claude-hud와 같은 영역. 한국어로 claude-hud를 "써 보니"라고 쓴 후기는 웹·Threads 모두 0건(소개·비교만).
- [커뮤니티] GeekNews 「ccusage - Claude Code/Codex 사용량 분석용 CLI 도구」(xguru, "8달 전", GeekNews Weekly 202607 수록): 로컬 JSONL로 일·월·세션별 토큰·비용, 5시간 블록 리포트, statusline 표시, MCP 서버 내장. 댓글 없음 — [news.hada.io/topic?id=26561](https://news.hada.io/topic?id=26561)
- [커뮤니티·Threads] @qjc.ai(2026-07-13, 좋아요 6/댓글 7, 7개 연재): cc-menubar — "매번 터미널에 ccusage 치기 귀찮아서" macOS 메뉴바에 오늘/주/월/누적 지출을 **달러와 원화로** 표시. 내부적으로 `npx ccusage --json --offline` 호출(데이터가 기기 밖으로 안 나감). 여러 Claude 계정 사용률을 보는 teamclaude 화면 포함. Apple Silicon 전용, MIT — threads.com/@qjc.ai/post/Daub-kVk5ym
  - hubblerc: 후보 "오늘 누적 비용·시간"에 원화 표시 옵션을 더할 근거. "여러 계정 사용률"은 기기 라벨 후보와 이웃한 요구.
- [커뮤니티·Threads] @seol.cc(2025-08-10, 인기 탭, 좋아요 97; 오래된 글): ccusage의 statusline 연동 — settings.json 한 줄로 세션 비용, 오늘 총비용, 5시간 블록 남은 시간, 소모 속도(burn rate)를 색 경고와 함께 표시 — threads.com/@seol.cc/post/DNKJkrzxUTB
  - hubblerc: "소모 속도"는 후보 "한도 소진 예측"과 같은 것. 이미 ccusage가 보여 주던 항목이라 F1에 넣으면 claude-hud+ccusage를 한 번에 대체하는 셈.
- [커뮤니티·Threads] 그 밖의 ccusage 소개 3건: @developk88(2026-09-05; Codex·Gemini CLI·Copilot CLI도 같이, 5시간 구간 추적), @innobbv.ai(2026-07-14; 댓글에 "내 API 정보도 입력해야 하나요?"), @keepgoing_0325(2026-06-16; 회사에 ccusage 위젯을 배포했더니 다른 팀 반응이 좋았다) — threads.com/@developk88/post/Dc5R64cEhPx, threads.com/@innobbv.ai/post/Daxwb6Zk8Nn, threads.com/@keepgoing_0325/post/DZpQLk-mrH2
- [커뮤니티] 한국어 블로그: daleseo.com/ccusage, velog 「Claude Code Usage Monitor」(제목만 확인). `npx ccusage@latest blocks --live`로 실시간 감시(검색 요약) — [daleseo.com/ccusage](https://daleseo.com/ccusage/), [velog @yardyard](https://velog.io/@yardyard/Claude-Code-Usage-Monitor)

**터미널 앱·여러 세션**
- [커뮤니티·Threads] Orca 언급 3건: @jjinbuilder(2026-10-17, 좋아요 104/댓글 30/리포스트 32) "터미널은 보기 싫은 사람"을 위한 Orca 설정 — 기본 에이전트를 Claude나 Codex로, 실험 기능 Chat UI를 켬; 화면 맨 아래에 Codex·Claude 사용량, 대화창에 컨텍스트 도넛 표시. @felix.dev0("1일", 좋아요 64/댓글 25) VSCode 터미널에서 Orca로 옮기니 "너무 편하다". @poorvidecoder("2일", 댓글 12) 터미널·Orca로 쓰던 사람에게 Aside가 체감이 안 되는지 질문 — threads.com/@jjinbuilder/post/DemWYKUj2aD, threads.com/@felix.dev0/post/De5O8IJksdB, threads.com/@poorvidecoder/post/De0vQVZE_hz
  - hubblerc: 사용자도 Orca를 쓴다. Orca 자체가 하단에 사용량, 대화창에 컨텍스트 도넛을 보여 준다면(Chat UI 기준; 일반 터미널 화면에서도 그런지는 미확인) F1 1줄과 겹친다 — 겹침을 확인하고 F1에서 뺄 항목을 고를 것[추론].
- [커뮤니티·Threads] @swon.yeonmom(2026-10-13): 데스크톱 앱에서 채팅과 코드를 한 화면에 보기 불편해 터미널로 옮겼고, Warp가 예뻐서 골랐다. @lemonduck1004("48분"): 반대로 터미널 → 데스크톱 앱; 터미널에서는 오류 화면을 보여 주려면 이미지를 로컬 폴더에 넣고 설명해야 해서 불편 — threads.com/@swon.yeonmom/post/DeaZz-tk8OM, threads.com/@lemonduck1004/post/De7-oCvn0LW
- [커뮤니티] 인프런 강사 짐코딩(2026-05-22): 한글 밀림 질문에 "외부 터미널(macOS는 iTerm2)"을 권하며 본인은 Warp를 쓴다고 함. 다른 답(2026-04-02)은 Cursor 내장 터미널 대신 VS Code, Warp, Antigravity — [inflearn 1816788](https://www.inflearn.com/community/questions/1816788/한글-밀림현상), [inflearn 1793589](https://www.inflearn.com/community/questions/1793589/cursor-에서-터미널을-사용하여-claude-실행시-한글-밀림)
- [커뮤니티·Threads] @solostack11("1일", 좋아요 4/댓글 3): `claude agents` — 터미널 하나에서 여러 세션을 보고 관리, 세션마다 worktree, 연구 미리보기, v2.1.309 기준 — threads.com/@solostack11/post/De4JL7ljT6E
  - hubblerc: 여러 세션을 한 화면에서 보는 엔진 기능이 생겼다(2.1.309, hubblerc 기준 2.1.308보다 새것). F1·F2가 그 화면에서 어떻게 보이는지 확인 필요[추론].
- [커뮤니티·Threads] @mirror_one_official(2026-10-06, 좋아요 83): OpenRig — Claude Code·Codex 여러 개를 한 팀으로 묶어 돌리고 터미널에 모델·컨텍스트 사용량·작업 상태를 표로 표시 — threads.com/@mirror_one_official/post/DeHhkrLGx3L
- [커뮤니티] cmux(Ghostty 기반 macOS 터미널) 한국어 글 「cmux: AI 에이전트 시대에 터미널을 다시 설계하면 어떤 모습일까」(위키독스 @jaehong) — 403으로 본문 미확인 — [wikidocs.net/blog/@jaehong/10104](https://wikidocs.net/blog/@jaehong/10104/). [공식(cmux)] 한국어 페이지: Claude Code가 끝나거나 입력을 기다리면 패널이 울리고 사이드바에 읽지 않음 배지 — [cmux.com/ko/agents/claude-code](https://cmux.com/ko/agents/claude-code)
- [커뮤니티] GeekNews 「Claude Code로 5명 팀처럼 개발하는 법」(neo, 2025-08-25, 댓글 12; 오래된 글): 여러 인스턴스를 git worktree로 병렬 실행, tmux 연동. bluekai17 "워크트리만 잘 써도 충분" — [news.hada.io/topic?id=22716](https://news.hada.io/topic?id=22716)

**알림 훅**
- [공식] 기본 데스크톱 알림은 Ghostty, Kitty, iTerm2에서만(검색 요약) — [code.claude.com/docs/en/terminal-config](https://code.claude.com/docs/en/terminal-config)
- [커뮤니티] 한국어 노트(tilnote): `Stop`·`Notification` 이벤트에 command 훅으로 소리 재생(예시는 Windows `powershell.exe`, 맥은 `afplay`), `idle_prompt` 알림은 늦게 오는 경우가 많아 `Stop` 훅과 같이 쓰라고 함(검색 요약) — [tilnote.io/pages/68ee1e2f…](https://tilnote.io/pages/68ee1e2f1e31782e1ea8edd0)
- [커뮤니티·Threads] Aside 결과: "tmux와 알림 훅을 직접 다룬 한국어 글은 못 봤다. 훅은 Windows 버그 수정 소식(@a00534: v2.1.310에서 Git Bash가 없을 때 PreToolUse·PermissionRequest 훅이 도구 호출을 그냥 통과시키던 문제 수정)과 claude-howto 가이드 정도" — threads.com/@a00534/post/De5dY6JEpIR
  - hubblerc: 알림은 한국어 공유가 적은 빈자리. Orca가 기본 알림 대상인지는 미확인.

**사용량 확인**
- [커뮤니티] 위키독스 「클로드 사용량 확인 방법」: 앱·웹은 claude.ai/settings/usage, Claude Code는 `/usage`; 한도 메시지에 초기화 시각(검색 요약) — [wikidocs.net/blog/@openwiki/32390](https://wikidocs.net/blog/@openwiki/32390/)
- [커뮤니티·Threads] 치트시트·팁 글 3건: @solostack11("1일", 좋아요 107/리포스트 27) "한도 경고 뜨기 전에 토큰 아끼는 법 5가지" — `/context`, `/compact`, `/usage`, `/autocompact`, `/clear` 후 `/resume`, v2.1.310에서 직접 해 봄. @momentai.daily(좋아요 35) 명령어 20개 — `/usage`로 확인, 빨리 닳으면 `/context`→`/clear`→`/compact`. @ai.rusk — `npx ccusage@latest`, Ctrl+R 프롬프트 검색, Ctrl+O, Ctrl+B 백그라운드, Esc 두 번 되감기 — threads.com/@solostack11/post/De3NpoODKLL, threads.com/@momentai.daily/post/De53x9ZmoMv, threads.com/@ai.rusk/post/Dab2FHbk55K
  - hubblerc: `/usage`·`/context`를 자주 치는 습관이 F1의 존재 이유. 최신 엔진은 2.1.310까지 나왔다(hubblerc 기준 2.1.308).

### Inferences
- [추론] 상태줄 항목의 공통 분모는 컨텍스트 %, 5h/7d 한도, 브랜치, 모델이다(Dale Seo, remin1994, papapat.ai, claude-hud 소개가 모두 포함). F1 1줄은 이걸 다 담고 있다.
- [추론] effort를 상태줄에 넣은 한국어 사례는 2건(Dale Seo, papapat.ai)이고, effort를 **바꾸는** UI를 공유한 글은 0건. F1 슬라이더·F3는 공유된 셋업에 없는 부분이다.
- [추론] "Claude에게 시켜 상태줄을 매일 커스텀"(greekr4), "bash로 직접 만들게 시킴"(papapat.ai)처럼 Claude로 생성해 쓰는 사람이 있다. mod도 "말로 만드는 mod"(4절)로 퍼지고 있다.
- [추론] 외부 도구를 피하는 이유로 "토큰을 들고 서버를 호출"(papapat.ai), "기기 밖으로 안 나감"(cc-menubar)이 나온다. 한국 사용자 일부는 보안·프라이버시를 상태줄 도구 선택 기준으로 본다(2건).

### Gaps
- velog·Tistory·네이버 블로그에서 셋업 전체(터미널 앱+tmux+statusLine+알림)를 한 번에 공개한 한국어 글은 찾지 못했다. 검색 엔진이 velog를 잘 잡지 못했다.
- 커리어리·Disquiet·OKKY 관련 글은 검색 결과 0건(사이트 내 검색은 안 함).
- cmux 한국어 사용기(위키독스)는 403으로 본문 미확인. Orca의 Chat UI 사용량 표시가 일반 터미널 화면에도 있는지 미확인.
- 한국어 ccstatusline 상세 설정 글(블로그)은 못 찾음 — Threads 소개 글만.

## 2. 한국어 사용자에게만 생기는 문제와 우회법 (입력기 조합, 단축키, 한글 폭, 출력·도구 설명 언어)

### Takeaway
한글 문제는 네 갈래다: (1) 조합 중 글자가 입력줄 밖에 찍히거나 밀림 — 2026년 1~5월 인프런 질문 4건, 그중 3건이 Cursor 내장 터미널, 우회는 "다른 터미널" 또는 `/tui fullscreen`; (2) 한글 상태에서 단축키 — 맥 이슈 1건(Ctrl 전체 무시, 2026-03, not planned로 닫힘)과 Threads 1건(ccstatusline 설정 화면에서 한글 상태로 `T`가 안 먹음); (3) 박스 문자·폭 어긋남 — 2칸 폭 한글 글꼴 권장, Ambiguous Width는 건드리지 말라는 조언; (4) 모델이 도구 호출 인자에 한글을 `\uXXXX`로 쓰다 틀려 "추천→추첸"처럼 바뀜 — 2026-08 이슈 열림, CLAUDE.md 지시가 유일한 제안. 응답 언어는 CLAUDE.md로 정하는 글이 대부분이다. Threads에서는 Claude Code 한글 입력 문제 글을 거의 찾지 못했다(최근 약 155개·인기 45개 중 0건).

### Cited Findings
**(1) 조합 중 표시·밀림**
- [커뮤니티] 인프런 「Claude Code CLI 내 한글 조합 중 입력 외부 표기」(2026-01-03, iTerm·Cursor 둘 다 재현, v2.0.76). 조합 중 글자("아")가 입력줄 밖에 보였다가 다음 글자를 치면 안으로 들어감. 강사 1차(01-06): 2.0.68 체인지로그의 IME 수정 → 업데이트. 강사 정정(02-10): "체인지로그에는 고쳤다지만 실제로는 안 고쳐짐, 한·중·일 공통, 완성된 글자는 정상, 우회 없음". 다른 사용자(01-13): Windows 11 + WSL, v2.1.6에서도 재현, 이슈 #16322. 02-20 댓글: IDE 터미널에서 커서 밀림 + 텍스트 블록 선택 불가 — [inflearn 1740730](https://www.inflearn.com/community/questions/1740730/claude-code-cli-내-한글-조합-중-입력-외부-표기)
- [커뮤니티] 인프런 「Cursor에서 터미널을 사용하여 claude 실행시 한글 밀림」(2026-03-28, Windows): 한 글자씩 밀림, Cursor 밖 PowerShell은 정상, 폰트·locale·업데이트 효과 없음. 질문자(04-02): 2.1.84에 IME 수정이 있었다며 원인을 Cursor 터미널로 봄. 강사 동의 — [inflearn 1793589](https://www.inflearn.com/community/questions/1793589/cursor-에서-터미널을-사용하여-claude-실행시-한글-밀림)
- [커뮤니티] 인프런 「프롬프트에 한글 입력 시 복사되는 현상」(2026-03-31): "안됐됐됐어"처럼 반복. 강사: Cursor 이슈로 보고 VS Code·Warp 권함 — [inflearn 1795387](https://www.inflearn.com/community/questions/1795387/프롬프트에-한글-입력-시-복사되는-현상이-발생합니다)
- [커뮤니티] 인프런 「한글 밀림현상」(2026-05-21, Cursor 터미널). 강사: CJK IME 조합을 입력창이 매끄럽게 처리 못 하는 알려진 버그, 외부 터미널 권장 — [inflearn 1816788](https://www.inflearn.com/community/questions/1816788/한글-밀림현상)
- [커뮤니티] 위 4건에서 인프런 AI 답변이 반복 제안한 것: iTerm2 Text → Unicode Normalization NFC, `LANG=…UTF-8`, D2Coding·Noto Sans KR Mono. 질문자가 시도해 효과를 봤다는 보고는 0건(1793589는 "효과 없음").
- [커뮤니티(업체 블로그)] SSD Nodes 한국어 가이드 「Claude Code 터미널 한글 깨짐」(공식 문서 2026-09-17 확인 기준). 조합 중 글자가 엉뚱한 곳에 찍히고 문장 중간 수정 시 밀림·잔상 → `/tui fullscreen`(상시: `CLAUDE_CODE_NO_FLICKER=1`). 단 "한글 조합이 고쳐졌다는 건 한 사용자의 보고이고 문서는 한글을 언급하지 않는다". 대가: 전체 화면에서는 터미널 `Cmd+F` 검색이 대화를 못 찾고 마우스 드래그 복사가 바뀜 → `Ctrl+O` transcript에서 검색. 편집기 터미널 박스·번짐 → `/terminal-setup`(VS Code `terminal.integrated.gpuAcceleration` off). Windows Terminal 잔상 → `CLAUDE_CODE_ALT_SCREEN_FULL_REPAINT=1`, `chcp 65001`. SSH의 `?`·빈 박스 → 서버 locale, `SendEnv`/`AcceptEnv`, `tmux kill-server` 후 `tmux -u new` — [ssdnodes.com/learn/lang/ko/…](https://www.ssdnodes.com/learn/lang/ko/claude-code-korean-text-garbled-in-terminal)
  - hubblerc: 사용자는 이미 `tui: fullscreen`. 전체 화면의 대가(터미널 검색 불가)는 F2 사이드바 "목차"·`/activity`가 메우는 빈자리와 겹친다 — 공개 설명 포인트.
- [커뮤니티] 반대 증거(검색 요약, 이슈 미러): `CLAUDE_CODE_NO_FLICKER=1`을 바꿔도 한글 조합 중 `?` 같은 엉뚱한 문자가 들어가는 현상(#77009)은 그대로였다는 보고 — [claudeissues.com/issue/77009](https://claudeissues.com/issue/77009-korean-hangul-ime-composition-inserts-stray-characters-e-g-across-cli-tui-and-ag)

**(2) 한글 상태에서 단축키**
- [커뮤니티] 이슈 #40291 「Korean IME: All Ctrl+key shortcuts silently ignored when Hangul input is active」(2026-03-28 등록, 2026-04-28 "Closed — not planned", 관리자 답 없음; 이슈 미러로 확인). macOS, cmux(Ghostty 기반)·Terminal.app·iTerm2, v2.1.86. 한글 상태에서 Ctrl+C/A/L/E 등 무반응, 영문이면 정상. 우회: Karabiner-Elements로 Ctrl+키를 가로채 영문 전환 → 키 전송 → 한글 복귀(보고자도 근본 해결 아님) — [claudeissues.com/issue/40291](https://claudeissues.com/issue/40291-korean-ime-all-ctrl-key-shortcuts-silently-ignored-when-hangul-input-is-active)
  - hubblerc: F1 effort 슬라이더 키 선정과 직결. hubblerc는 2.1.308·Orca에서 `ctrl+x ctrl+e`가 한글 상태에서 동작함을 확인했으므로 "Ctrl 전체 무시"는 적어도 일부 해소된 것으로 보인다[추론]. 남은 문제는 "두 번째 키가 글자 키면 조합에 걸림"(`ctrl+x e` → `ㄷ`).
- [커뮤니티·Threads] @goldenrabbit2020(2026-09-18, 좋아요 0): ccstatusline 파워라인 설정에서 **한글 입력 상태로 단축키 `T`를 누르면 반응이 없다**. Threads 조사에서 찾은 한글 입력 문제는 이것 하나 — threads.com/@goldenrabbit2020/post/DdbYrDNHc8k
  - hubblerc: 같은 계열의 문제(글자 단축키가 한글 조합에 먹힘)가 다른 도구에서도 보고됐다. hubblerc 슬라이더는 숫자 `1~5, 0`을 쓰는데, 숫자는 두벌식에서 조합되지 않으므로 한글 상태에서도 안전할 것이다[추론, 화면 확인 필요].
- [커뮤니티] 이슈 #45055(2026-04-08 등록·같은 날 Fixed): Windows 11 + Windows Terminal, v2.1.96에서 한/영 키가 포커스 이동 전까지 안 바뀜(이슈 미러) — [claudeissues.com/issue/45055](https://claudeissues.com/issue/45055-bug-ime-korean-input-method-toggle-does-not-work-inside-claude-code-terminal-wit)
- [커뮤니티·Threads] @e_eeeeeee14("1일", 좋아요 20/댓글 14): Windows용 입력기 'Araso' 베타 — 한/영 전환 없이 단어마다 언어를 자동으로 정함. Claude Code 언급은 없음 — threads.com/@e_eeeeeee14/post/De3B_YkmXDP
  - hubblerc: 직접 관련 없음. 한/영 전환 자체가 불편하다는 수요의 간접 신호.

**(3) 한글 폭·박스 문자**
- [커뮤니티] 인프런 「터미널에서 사용하는 한글 폰트가 뭔가요」(2026-03-29): 박스 문자를 그릴 때 한글이 섞이면 깨진다는 질문. 강사는 기본 폰트라고만 답, AI 답변은 D2Coding·나눔고딕코딩 — [inflearn 1793850](https://www.inflearn.com/community/questions/1793850/터미널에서-사용하는-한글-폰트가-뭔가요)
- [커뮤니티(업체 블로그)] SSD Nodes: 한글을 영문 2칸 폭으로 만든 고정폭 글꼴(D2Coding, 나눔고딕코딩)이면 줄 어긋남이 준다. East Asian Ambiguous Width 설정은 한글이 아니라 입력창 테두리 같은 문자에 영향을 주므로 건드리지 말라 — [ssdnodes.com/learn/lang/ko/…](https://www.ssdnodes.com/learn/lang/ko/claude-code-korean-text-garbled-in-terminal)
  - hubblerc: F1·F2·F4·F5 모두 한글 문자열(Bash 용도, 질문 제목, 할 일)을 줄 폭에 맞춰 자른다. 표시 폭(한글 2칸)으로 세야 하고, `━ ─ │ ◐ ▸ ↻` 같은 기호는 Ambiguous Width라 터미널 설정에 따라 1칸/2칸이 갈린다[추론]. "Ambiguous = 2칸" 사용자에게서 F1이 넘칠 수 있다.

**(4) 도구 호출 속 한글 깨짐, 응답 언어**
- [커뮤니티] 지피터스 「클로드 한글 깨짐, 원인은 밝혀졌어요: 해결법과 아직 남은 물음표」(지피터스_강지인, "2달 전", 확인일 2026-09-03). 흔한 단어가 한 음절씩 바뀜(추천→추첸), 다른 한글 음절이라 오타로 착각. AskUserQuestion·TodoWrite 같은 도구 호출 인자에서 발생. 원인: 모델이 인자에 한글을 `\uXXXX`로 쓰며 헥스를 틀림. 이슈 #83033(8월 1일 등록, 열림): 이스케이프로 쓴 45회 중 45회 깨짐, 음절의 약 3~5% 오류; 그대로 쓴 실행은 정상; Sonnet 5·Opus 5에서 보고; 메인테이너는 2.1.233에서 3회 재현 실패. 제안된 우회: CLAUDE.md에 "Always write Korean (and other non-ASCII) strings in tool-call parameters as literal UTF-8…" — 작성자 실험 외 독립 검증 없음 — [gpters.org/news/post/claude-hangul-broken-cause…](https://www.gpters.org/news/post/claude-hangul-broken-cause-b3lfK4VaSPaP5Fg)
  - hubblerc: F4가 직접 영향받는다. Bash `description`도 도구 호출 인자라 한국어 용도 문구가 한 음절씩 틀릴 수 있다[추론]. 할 일(TodoWrite) 내용을 보여 주는 F1 2줄도 같다. mod가 고칠 수는 없지만, 사용자 메모리·CLAUDE.md에 위 지시를 넣는 게 현재 유일한 제안이고, "F4가 글자를 바꿨다"는 오해를 피하려면 원인을 문서에 적어 둘 만하다.
- [커뮤니티·Threads] @ai.corder(2026-02-15, 좋아요 23/댓글 6): $200 요금제 8개월 후 해지하고 대안 비교. "MiniMax2.5 + 클코: 한글 응답에 중국어가 자주 섞인다" — threads.com/@ai.corder/post/DUwtD6SEnAy
  - hubblerc: 직접 관련 없음(다른 모델을 Claude Code에 물린 경우).
- [커뮤니티·Threads] @zhugehyuk(2025-08-20; 오래된 글): Claude Code에 영/한 i18n을 시켰더니 반쯤만 번역되고 실시간 언어 전환 때 섞임 — threads.com/@zhugehyuk/post/DNkWqJxKtQ-
- [커뮤니티] 응답·커밋 언어는 CLAUDE.md에 "응답은 한국어, 커밋 메시지는 한국어"를 적는 방식이 대부분(검색 요약) — [inflearn 1738835](https://www.inflearn.com/questions/1738835)
- [커뮤니티(업체 블로그)] SSD Nodes 「Claude 한국어」(2026-10-01): 응답 언어는 저장소 루트 CLAUDE.md에 언어·말투 지침을 적는다. 개발자라면 "코드·명령어·오류 메시지는 번역하지 말라"를 넣으라(원문으로 검색하게). 앱 화면 언어는 메뉴·버튼만 바꾸고 답변은 사용자가 쓴 언어를 따른다 — [ssdnodes.com/learn/lang/ko/claude-in-korean…](https://www.ssdnodes.com/learn/lang/ko/claude-in-korean-what-works-and-app-language)
  - hubblerc: F4 운영 방식(메모리에 "Bash 설명은 한국어로")이 이 관행과 같은 계열. 엔진이 붙이는 영어 문구(묶음 줄 "Read 1 file, listed 1 directory…", "… for Ns")는 CLAUDE.md로 못 바꾸므로 mod로 한국어 재표기하는 것이 새 아이디어가 될 수 있다[추론].
- [커뮤니티·Threads] @life.of.haru(2026-04-03, 좋아요 13): Claude Code 치트시트를 한글로 번역해 공유. @marketerjjj("12시간"): 영어 설정 화면이 불편해서 (Aside) 한글 패치를 만들었다 — threads.com/@life.of.haru/post/DWqKruLEyP_, threads.com/@marketerjjj/post/De6wA3qEzpT
  - hubblerc: "영어 UI가 불편하다"는 수요 2건 — mod로 엔진 문구 한국어화 아이디어의 근거.

### Inferences
- [추론] 2026년 상반기 한국어 IME 질문은 Cursor 내장 터미널에 몰려 있다(인프런 4건 중 3건). 맥 + 독립 터미널 + 전체 화면인 hubblerc 사용자는 (1)보다 (2)·(3)·(4)에 더 노출된다.
- [추론] Threads에서 Claude Code 한글 입력 문제 글이 거의 없는 것은 (a) 2.1.84 이후 IME 수정으로 덜해졌거나, (b) Threads 사용자층이 데스크톱 앱·Orca Chat UI 쪽이라 TUI 입력창을 덜 쓰기 때문일 수 있다. 어느 쪽인지는 근거 없음.
- [추론] 한국어 커뮤니티의 IME 답변은 "다른 터미널 써라 / 업데이트 기다려라"가 대부분이고, "단축키를 두 키 모두 Ctrl로" 같은 우회를 공유한 글은 0건이다. hubblerc의 `ctrl+x ctrl+e` 경험 자체가 공유 가치가 있다.
- [추론] mod로 할 수 있는 한글 관련 개선: (a) 단축키 안내에서 "두 번째 키가 글자 키인 조합" 피하기, 한글 상태에서 안전한 숫자 키 활용, (b) 문자열 자르기를 표시 폭 기준으로, (c) Ambiguous 기호 대신 ASCII 대체 옵션, (d) 엔진 고정 영어 문구 한국어 재표기.

### Gaps
- 맥 + Orca 환경의 한글 조합 문제 보고는 웹·Threads 모두 0건.
- "단축키 두 번째 글자 키가 조합에 붙잡힘"(hubblerc의 `ctrl+x e`)을 Claude Code에서 다룬 한국어 글은 0건(ccstatusline 설정 화면 사례 1건만).
- Claude Code 공식 `language` 설정 키 존재 여부는 한국어 글에서 확인 못 함(모든 글이 CLAUDE.md만 언급). 공식 문서 담당 조사자 확인 필요.
- 한글 폭 때문에 Claude Code TUI(입력창 테두리, 표, diff)가 어긋난다는 구체 보고는 인프런 박스 문자 질문 1건뿐.

## 3. 불편·요청 (한도, 비용, 컨텍스트, 변경 추적, 권한 승인, 작은 화면)

### Takeaway
가장 많은 불만은 단연 사용 한도다: 웹(클리앙 1·GeekNews 1·브런치 1)과 Threads(2026-10월 하순에만 5~6건)에서 "5시간·주간 한도에 걸려 멈춤", "한도가 갑자기 준 느낌"이 반복됐고, 사람들은 `/usage`·`/context`·`/compact` 팁, ccusage 위젯·메뉴바, 직접 만든 남은 사용량 표시기로 대응했다. 다음은 컨텍스트 관리(70% 경고, 압축 시점)와 승인 팝업("클릭 노동"). 변경 추적·작은 화면에 대한 한국어 불만 글은 찾지 못했다.

### Cited Findings
**한도·비용**
- [커뮤니티] 클리앙 모두의앱 「클로드 코드 사용량 한도 너무 자주 걸립니다」(2026-04-29, 조회 2,307, 댓글 11). Pro에서 5분도 안 돼 한도. 댓글: Max로 옮기니 하루 종일 여유, Pro는 개발용으로 부족, $100 Max도 5시간 구간이 자주 거의 참, 새 모델마다 토큰 소모가 늘어 사실상 가격 인상, $200→$100으로 내림, Codex로 옮기는 사람이 많다, $100 Max 추천 다수 — [clien.net/…/19184158](https://www.clien.net/service/board/cm_app/19184158)
- [커뮤니티·Threads] 2026-10월 하순 한도 글: @jteen_78("2일", 좋아요 6/댓글 14) 한도가 갑자기 줄어든 느낌, 이틀 연속 5시간 한도, 풀린 뒤 질문 2개와 자동 작업만 했는데 10%. @xavi.creator("14시간", 댓글 4) 팀 계정은 5시간 리밋만 있고 금방 참, 개인 계정은 주간 리밋에만 걸림, 원인을 캐시 불일치로 추측. @rivera.co.kr("23시간", 댓글 4) 주간 한도로 이틀 강제 휴식, 댓글 "사용량 70% 넘으면 큰 작업은 리셋 뒤로 미룬다". @ego_saku_yume(좋아요 14/댓글 7) "한도 더 높은 거 나오면 좋겠다". @snrnfrkdy1473(2026-10-18, 댓글 32) Codex 사용량을 일찍 다 써서 Claude Code로, Max가 가장 합리적. @super_happy_s 뉴스 요약 "클로드 에이전트 SDK, 5시간 한도 1.8배 빨리 닳는다" — threads.com/@jteen_78/post/De12t_nGkVO, threads.com/@xavi.creator/post/De6gSlhI84M, threads.com/@rivera.co.kr/post/De5gf_RgZ3F, threads.com/@snrnfrkdy1473/post/DemclbZkqFY
- [커뮤니티·Threads] @marketerjjj("12시간"): 한도 때문에 작업이 멈춘 적이 있어서 Claude·GPT 남은 사용량 표시기를 직접 만듦 — threads.com/@marketerjjj/post/De6wA3qEzpT
- [커뮤니티] GeekNews 22716 댓글(2025-08, 오래된 글): Pro 한도 불만 4명(bhjun "매번 2시간을 못 넘김", fanotify "오전 2~3시간 쓰면 점심 전에 걸림", click, helio), $100이면 된다 2명(bluekai17 "한 달 약 $566.93", muroa96 "Opus 계획 + Sonnet 코딩"). neodasida "자동 2시간 뽀모도로" — [news.hada.io/topic?id=22716](https://news.hada.io/topic?id=22716)
- [커뮤니티] 브런치 「클로드 사용 한도에 미칠 것 같은 상황을 파훼하는 방법」(AX Engineer Lukas, 2026-05-02): 월 46만원대 플랜에서도 몇 시간씩 막힘. 대처: 기획은 저가 모델·실행만 Opus/Sonnet, Plan Mode, "짧은 챗 3개가 끝없이 긴 챗 1개보다 낫다", 긴 대화는 요약 프롬프트로 새 채팅에 이전 — [brunch.co.kr/@lukas08/203](https://brunch.co.kr/@lukas08/203)
- [커뮤니티] 위키독스·디지털마케터(검색 요약): 채팅과 Claude Code가 같은 한도를 나눠 씀, 세션(5시간)·주간 창이 따로 — [digitalmarketer.co.kr](https://www.digitalmarketer.co.kr/class/claude-code-for-everyone/claude-code-plans-and-limits), [wikidocs @openwiki/32390](https://wikidocs.net/blog/@openwiki/32390/)
  - hubblerc: F1(5h·7d %와 리셋까지 남은 시간)이 이 불만을 겨냥. "70% 넘으면 큰 작업은 리셋 뒤로"(rivera.co.kr 댓글)는 후보 "한도 소진 예측"을 사람이 머릿속으로 하는 모습. "질문 2개에 10%"(jteen_78)처럼 갑자기 빠지는 순간을 보여 주려면 답변별 한도 소비(F5 요약 줄에 "5h +3%")가 새 아이디어가 된다[추론].

**캐시**
- [커뮤니티·Threads] @yw_0woo: 사용량이 갑자기 빠지는 건 캐시 만료(구독 1시간, API 5분) 때문인 경우가 많다는 주장, statusline에 cache warm 표시. @xavi.creator도 원인을 캐시 불일치로 추측(2건, 둘 다 미검증) — threads.com/@yw_0woo/post/DerAyjokQP4
  - hubblerc: 새 아이디어 — 캐시 상태 표시. F3 auto effort가 캐시를 깨는지 측정하는 항목과 같은 데이터.

**컨텍스트**
- [커뮤니티] remin1994 상태줄: 70% 넘으면 아이콘 변경 → `/compact`·`/clear` 시점 안내 — [news.hada.io/topic?id=28227](https://news.hada.io/topic?id=28227)
- [커뮤니티(약한 출처)] youmind 한국어 정리(X 바이럴 글 요약): 자동 압축은 90~95% 근처, 턴 경계에서 돌아 나중에야 알아챔. 요약이 "무엇을 했나" 위주라 "왜·기각된 계획"이 빠지고, 기각된 계획을 다시 구현하려 드는 오해. 우회: 작업 단위마다 직접 `/compact`, 무관한 작업 사이 `/clear`, 큰 조사는 서브에이전트 — [youmind.com/ko-KR/…](https://youmind.com/ko-KR/landing/x-viral-articles/claude-code-compact-solutions)
- [커뮤니티·Threads] @solostack11 토큰 아끼기 5가지(좋아요 107)에 `/autocompact`·`/context` 포함 — threads.com/@solostack11/post/De3NpoODKLL
  - hubblerc: 후보 "자동 압축 직전 경고"의 근거 3건. F5 resume 복원의 "(압축 후 이어짐)" 제목 처리와도 연결.

**권한 승인**
- [커뮤니티] Dale Seo 「클로드 코드 권한 모드」(2025-09-29, 업데이트 2026-05-04): "승인 팝업이 끊임없이 뜹니다" — 대량 수정에서 번거로움. 모드: default / acceptEdits / plan / auto(Max·Team·Enterprise·API만) / dontAsk / bypassPermissions, Shift+Tab 순환. 추천: 혼자 개발은 acceptEdits, 긴 작업은 auto — [daleseo.com/claude-code-permission-modes](https://daleseo.com/claude-code-permission-modes/)
- [커뮤니티·Threads] @make.my.agent_jy("1일"): 엔진 확인 창이 명령어로 물어서 코드를 모르면 읽기 어렵다 → mod로 쉬운 문장 확인 창을 만듦(4절) — threads.com/@make.my.agent_jy/post/De39pBkiuHi
- [커뮤니티·Threads] @papapat.ai 상태줄에 "AUTO 모드" 항목 — threads.com/@papapat.ai/post/DXtpqBeAXmy
  - hubblerc: F1에 권한 모드 표시는 없다. 새 아이디어: 밴드 1줄에 권한 모드(auto·bypass일 때 색). 승인 창 자체를 바꾸는 건 mod로 제한적(qjc: "권한 확인 프롬프트는 mod가 못 바꾼다") — 대신 자체 확인 창을 띄우는 방식(make.my.agent_jy)은 가능.

**터미널 vs 앱, IDE 터미널**
- [커뮤니티·Threads] @lemonduck1004: 터미널에서 오류 화면 이미지를 보여 주려면 로컬 폴더에 넣고 설명해야 해 불편 → 데스크톱 앱으로. @swon.yeonmom: 반대로 앱에서 채팅·코드 동시 보기가 불편해 터미널(Warp)로 — threads.com/@lemonduck1004/post/De7-oCvn0LW, threads.com/@swon.yeonmom/post/DeaZz-tk8OM
- [커뮤니티] 인프런 1796746(2026-04-03): Windows Cursor에서 Ctrl+C/V 안 됨, 우클릭 붙여넣기로 우회 — [inflearn 1796746](https://www.inflearn.com/community/questions/1796746/statusline-설정)

### Inferences
- [추론] 한도 불만은 "얼마나 남았나"보다 "언제 풀리나·왜 갑자기 빠졌나·지금 속도면 언제 바닥나나"로 이어진다("점심 전에 걸림", "질문 2개에 10%", "70% 넘으면 미룬다"). F1의 "↻1h30m"과 후보 소진 예측, 답변별 소비 표시가 이 말투와 맞다.
- [추론] 한도 예측은 세션 안 토큰이 아니라 `rateLimits.percentUsed`의 시간당 변화로 계산해야 한다. 채팅·다른 기기와 한도를 나눠 쓰기 때문이고, 사용자가 맥·스튜디오·미니를 오가므로 특히 그렇다.
- [추론] 비용은 구독자에게 덜 중요하다(웹 댓글은 플랜 가격 얘기). 다만 Threads에서는 ccusage 원화 표시·위젯처럼 "얼마 썼나"를 보고 싶어 하는 글도 있다(5건). F1 비용 기본 숨김 + 사이드바나 `/activity`에서 원화 누적을 보는 정도가 균형[추론].
- [추론] "변경 추적"(어느 답변에서 무엇을 바꿨나)은 한국어 불만 글에는 없고, mod 예시(Replay Theater, read-map)와 Threads의 "사무실 시각화"(4절)에서 간접적으로만 보인다. F5는 수요가 드러나지 않은 쪽을 먼저 채운 셈이라, 공개 시 "왜 필요한가"를 설명해야 할 가능성이 있다.

### Gaps
- 작은 화면·노트북에서 TUI가 좁다는 한국어 불만 글은 0건.
- MCP 끊김, 백그라운드 작업 진행 표시에 대한 한국어 요청 글 0건.
- 변경 추적 불만·요청 글 0건.
- 캐시 1시간/5분 주장(@yw_0woo)은 검증하지 않았다.

## 4. 2026-10월 mod 공개에 대한 한국어 반응, 한국어로 공유된 mod

### Takeaway
mod 공개(2026-10-01 18:00 UTC, KST 10-02 03:00) 뒤 한국어 반응은 기사 1건(보안 우려 중심), 튜토리얼 블로그 2건(퀀텀점프클럽 10-04, 짐코딩 10-08), 유튜브 1건, Threads 1건(직접 만든 mod 연재) 정도로 적다. Threads "claude code mod" 검색에서 관련 한국어 글은 1개뿐이었다. 공유된 예시 mod는 "프롬프트 위 한 줄"(컨텍스트·브랜치·목표 메모·사용량), "옆 패널"(읽은 파일), "위험 명령·파일 정리 확인 창", "긴 턴 완료 알림"으로 hubblerc와 많이 겹친다. 한편 Claude Code 활동을 시각화한 "사무실" 글이 좋아요 2.7천을 받아, 꾸미기·시각화 수요가 크다는 신호가 있다.

### Cited Findings
- [커뮤니티] 퀀텀점프클럽 정상록 「클로드코드 모드가 뭔가요?」(2026-10-04): 릴리스 2026-10-01 18:00 UTC(KST 10-02 03:00), 최소 v2.1.287. Anthropic 샘플 3종(Token Weather, Blast Radius, Replay Theater; claude-code-playground 저장소, 기본 포함 아님). 커뮤니티 확장 "token-weather-usage": 프롬프트 위 한 줄에 5시간·주간 사용률 + 컨텍스트 날씨. 보안: 샌드박스 아님, 사용자 권한으로 실행, 권한 확인 프롬프트는 mod가 못 바꿈, `claude plugin validate`로 미리 확인, `allowManagedModsOnly`, 끄는 법 `/plugin` 비활성화·`--safe-mode`·`disableAllHooks` — [qjc.app/en/blog/claude-code-mods](https://qjc.app/en/blog/claude-code-mods)
  - hubblerc: token-weather-usage는 F1 1줄과 같은 영역(참고·경쟁 대상). spec의 "회사 스튜디오에서 관리 정책에 막히는지"는 `allowManagedModsOnly`로 판단 가능. 같은 작성자(@qjc.ai)가 Threads에서 cc-menubar·statusline 비교 글을 쓴 사람이다.
- [커뮤니티] 짐코딩 「Claude Code Mods 사용법과 실전 프롬프트」(2026-10-08, 기준 2.1.294). 글의 제작 예시: context-check(입력창 위 한 줄에 컨텍스트 %·토큰), read-map(Read로 읽은 파일 목록을 옆 패널), delete-review(직접 `rm` 전 확인), branch-label(입력창 위 폴더·브랜치), turn-timer(60초 넘은 턴이 끝나면 완료 알림), focus-note(입력창 위 "오늘의 목표"). 팁: 프롬프트는 대화창에 붙여넣기, `/plugin` Installed의 `mod active` 줄 확인, 기능은 하나씩 추가. 주의: Token Weather 수치는 직전 응답 기준·구독 잔량과 다름, Claude가 만든 mod는 세션 폴더에 묶여 정리될 수 있으니 별도 폴더에 보관, 공식 문서 링크가 대부분 영문 — [gymcoding.co/articles/claude-code-mods-guide](https://www.gymcoding.co/articles/claude-code-mods-guide)
  - hubblerc: context-check·branch-label ≈ F1 1줄, read-map ≈ F5 "읽음"(F2 사이드바에서 뺀 부분), turn-timer = 새 아이디어(긴 답변 완료 알림), focus-note = 꾸미기 아이디어. 짐코딩은 인프런 IME 질문에 답하던 강사라 수강생층(Cursor·Windows 비중 높음)에 퍼질 가능성[추론].
- [커뮤니티·Threads] @make.my.agent_jy("1일", 좋아요 1/댓글 2, 3개 연재 중 첫 글만 읽음): "Claude Code Mod로 파일 정리 확인 창을 직접 만들어 봤다". 원래 확인 창은 명령어로 물어봐서 코드를 모르면 읽기 어렵다 → 옮길 파일마다 쉬운 문장으로 계획을 보여 주고 클릭으로 뺄 수 있게, 승인 전에는 옮기기·지우기를 막음 — threads.com/@make.my.agent_jy/post/De39pBkiuHi
  - hubblerc: 한국어로 공유된 mod 1건. "명령어 대신 쉬운 문장"은 F4(Bash 행에 용도 표시)와 정확히 같은 동기 — 비개발자에게도 F4가 먹힐 근거.
- [커뮤니티·Threads] @cowboy76("6일", 좋아요 2.7천/댓글 289/리포스트 620): Claude Code가 터미널에서 하는 일을 '사무실'로 시각화, 내 터미널과 실시간 연동 — 파일을 읽으면 자료실, 명령을 돌리면 서버실로 가고, 서브에이전트는 엘리베이터를 타고 출근. mod인지 별도 앱인지는 Aside 요약에 없음 — threads.com/@cowboy76/post/DeqgY7wiJYa
  - hubblerc: 이번 조사에서 반응이 가장 큰 글. "개인 취향 꾸미기" 방향의 수요 신호. F5가 이미 모으는 활동(읽음·Bash·서브에이전트)을 다른 모양으로 그리는 꾸미기 레이어(예: 사이드바 테마)로 확장할 수 있다[추론].
- [커뮤니티] 위키트리 기사 「클로드 코드 '모드', 훅이 못 하던 프롬프트·화면까지 개발자가 고친다…샌드박스는 없다」(송태섭, 2026-10-04): 기능·샘플 소개, 보안 책임이 사용자·관리자에게 넘어감, 로드 순서 의존. 국내 개발자 인용 없음 — [wikitree.co.kr/articles/1163804](https://www.wikitree.co.kr/articles/1163804)
- [커뮤니티] 유튜브 「Claude Code 모드(Mods) 직접 써 봤습니다 | 말로 만드는 나만의 기능 + 쓸만한 모드 사례」 — 제목만 확인, 채널·날짜·설명란 미확인 — [youtube.com/watch?v=dUKUgvyqAw0](https://www.youtube.com/watch?v=dUKUgvyqAw0)
- [공식] 공식 한국어 문서에 mod 인터페이스 페이지가 있다: 렌더 사이트 = 패널, 프롬프트 위 밴드, 토스트, 로그 줄, 프롬프트 아래 상태 줄, 스피너 등 — [code.claude.com/docs/ko/plugins/mods/interface](https://code.claude.com/docs/ko/plugins/mods/interface)
- [커뮤니티] mod 이전에 한국어로 공유된 플러그인·훅(검색 요약): Show GN 「Claude Code Achievements」(26개 업적, macOS/Linux/Windows 알림, 한국어 포함 5개 언어), 「Claude Quest」(세션을 픽셀 아트로 보여 주는 터미널 뷰어), 대화 기록을 훅으로 Obsidian 지식 그래프에 잇는 도구 — [news.hada.io/topic?id=25961](https://news.hada.io/topic?id=25961), [26936](https://news.hada.io/topic?id=26936), [27464](https://news.hada.io/topic?id=27464)
  - hubblerc: 게임화·시각화 수요 사례 3건(+ Threads "사무실" 1건).

### Inferences
- [추론] 한국어 mod 글은 공개 후 1~3주 안의 튜토리얼과 첫 시도 연재가 전부이고, "몇 주 써 보니"류 후기는 아직 없다(10-26 기준). hubblerc가 공개되면 한국어 실사용 mod로는 이른 편이다.
- [추론] 한국어 튜토리얼이 강조한 주의점(보안, 버전마다 바뀌는 API, 관리 정책, Claude가 만든 mod의 보관 위치)은 hubblerc 배포 문서에 그대로 넣을 항목이다.
- [추론] Threads의 한국 사용자층에는 비개발자(문과 사무직, 마케터, 육아 중 부모 등)가 섞여 있고, 이들은 "명령어 대신 쉬운 말"(make.my.agent_jy, lemonduck1004)을 원한다. F4·F5의 한국어 요약은 이 층에도 맞는다.

### Gaps
- 한국인이 만들어 GitHub/GeekNews Show GN에 공개한 mod 저장소는 찾지 못했다(Threads 연재 1건만).
- token-weather-usage의 제작자·저장소 미확인. "사무실" 시각화의 구현 방식(mod 여부) 미확인.
- 유튜브 영상 내용·댓글 미확인.

## 5. hubblerc F1~F5·후보가 해결하는 것과 안 다루는 것

### Takeaway
F1은 한국어 글에서 가장 많이 공유된 요구(컨텍스트·한도·브랜치·모델을 늘 보기, `/usage` 반복 입력 없애기)를 정면으로 다루고, effort를 보여 주고 바꾸는 부분(F1 슬라이더·F3)은 공유된 셋업에 거의 없는 차별점이다. F4는 "명령어 대신 쉬운 말" 수요와 맞지만 도구 호출 인자 한글 깨짐(#83033)의 영향을 받는다. 커뮤니티에서 드러난 것 중 한도 소비 원인(캐시)·권한 모드 표시·완료 알림·원화 비용·한글 폭·엔진 영어 문구는 F1~F5가 다루지 않는다.

### Cited Findings
| 커뮤니티에서 나온 것 | 건수(이 조사) | hubblerc | 비고 |
|---|---|---|---|
| 컨텍스트 %·5h/7d 한도·브랜치·모델 상시 표시 | 셋업 글 4(Dale Seo, remin1994, papapat.ai, claude-hud 소개) + mod 예시 3(context-check, branch-label, token-weather-usage) | F1 1줄 해결 | [daleseo](https://daleseo.com/claude-code-statusline/), [GN 28227](https://news.hada.io/topic?id=28227), [gymcoding](https://www.gymcoding.co/articles/claude-code-mods-guide), [qjc](https://qjc.app/en/blog/claude-code-mods), Threads @papapat.ai |
| effort 표시 | 2(Dale Seo, papapat.ai) | F1·F3 해결 + 조작까지 | effort를 바꾸는 UI 공유 0건 |
| 한도 불만·리셋 시각 | 웹 3(클리앙, GeekNews 댓글, 브런치) + Threads 6 | F1 리셋까지 남은 시간, 후보 소진 예측 | "70% 넘으면 큰 작업 미룸"(Threads 댓글) |
| 한도가 갑자기 빠지는 이유(캐시) | Threads 2(@yw_0woo, @xavi.creator) | 없음 → 캐시 상태 표시 아이디어 | F3 캐시 측정과 같은 데이터 |
| 소모 속도(burn rate) | Threads 1(@seol.cc, ccusage statusline) | 후보 소진 예측 | |
| 누적 비용(원화) | Threads 1(cc-menubar) + ccusage 소개 5 | 후보 누적 비용 | 원화 표시 옵션 아이디어 |
| 컨텍스트 70% 경고 / 압축 시점 | 3(remin1994, youmind, @solostack11) | 후보 "자동 압축 직전 경고" | F1 색 단계 60/85%와 임계값이 다름 |
| 도구·서브에이전트·할 일 진행 | claude-hud 소개·비교 2 | F1 2줄 | 한국어 사용 후기 0건 |
| 여러 세션 한눈에 | Threads 2(`claude agents`, OpenRig), Orca 3 | 일부(F1 프로젝트·브랜치), 후보 기기 라벨 | `claude agents` 화면에서 F1·F2 동작 미확인 |
| 읽은 파일·변경 기록 | mod 예시 2(read-map, Replay Theater) | F5·F2 변경 파일 | 한국어 불만 글 0건 |
| 활동 시각화·꾸미기 | Threads 1(사무실, 좋아요 2.7천), GeekNews 3 | F5 데이터 재사용 가능 | 꾸미기 레이어 아이디어 |
| 명령어 대신 쉬운 말 | Threads 1(make.my.agent_jy mod) | F4 해결 | |
| 긴 턴 완료 알림 | mod 예시 1(turn-timer), 알림 훅 노트 1 | 없음 → 새 아이디어 | 한국어 알림 훅 글 적음 |
| 권한 모드·승인 피로 | 3(Dale Seo, papapat.ai AUTO 표시, make.my.agent_jy) | 없음 → 밴드에 권한 모드 표시 | 승인 창 자체는 mod로 못 바꿈(qjc) |
| 한글 조합 표시·밀림 | 인프런 4 | 없음(엔진 입력창 문제) | `/tui fullscreen` 권장 1, 반대 보고 1 |
| 한글 상태 단축키 | 이슈 1(#40291), Threads 1(ccstatusline `T`) | F1 슬라이더를 `ctrl+x ctrl+e` + 숫자 키로 회피 | 글자 키는 조합에 걸림 |
| 한글 폭·Ambiguous 기호 | 2(인프런, SSD Nodes) | 미대응 | F1의 `━ ─ │ ◐ ▸ ↻` 폭 점검 필요 |
| 도구 호출 인자 한글 음절 오류 | 1(지피터스, #83033) | F4·F1 2줄(할 일)이 영향받음 | CLAUDE.md 지시가 유일한 제안 |
| 영어 UI 불편 | 2(@marketerjjj 한글 패치, @life.of.haru 번역 치트시트) | F4만 | 엔진 영어 문구 한국어화 아이디어 |

### Inferences
- [추론] 구현 요령 1 — 폭 계산: 밴드·사이드바에서 한글 문자열을 자를 때 표시 폭(한글 2칸, 이모지 2칸, Ambiguous 기호는 설정 의존)으로 세고, 기호를 ASCII로 바꾸는 옵션을 두면 Ambiguous=2 사용자와 좁은 화면 둘 다 대응된다.
- [추론] 구현 요령 2 — 단축키: 배포 문서에 "한글 입력 상태에서는 `ctrl+x <글자>` 대신 `ctrl+x ctrl+<글자>`, 슬라이더 선택은 숫자 키"를 적는다. #40291 같은 "Ctrl 전체 무시"는 2.1.308에서 재현되지 않았음을 hubblerc 경험으로 덧붙일 수 있다. 단일 Ctrl 키(`ctrl+q`·`ctrl+t`) 무반응의 원인이 IME인지 입력창인지는 영문 상태에서 같은 키를 눌러 보면 가를 수 있다.
- [추론] 구현 요령 3 — 한도: 예측은 `rateLimits.percentUsed`의 시간당 변화로, 답변별 소비는 `turn.start`/`turn.complete` 사이 `percentUsed` 차이로 F5 요약 줄에 붙일 수 있다("5h +3%"). 이러면 "질문 2개에 10%" 같은 순간을 사용자가 직접 본다.
- [추론] 구현 요령 4 — 보안 내세우기: 외부 statusLine 도구를 꺼리는 이유가 "토큰을 들고 서버 호출", "매번 @latest 자동 실행"(papapat.ai)이었다. hubblerc는 엔진 API만 쓰고 버전이 고정된 플러그인이라는 점을 공개 문서에 적을 만하다.
- [추론] 새 아이디어 우선순위(커뮤니티 근거 수 기준): ① 한도 소진 예측 + 답변별 한도 소비(근거 9+) ② 컨텍스트 경고(3) ③ 권한 모드 표시(3) ④ 캐시 상태(2) ⑤ 원화 누적 비용(1+5) ⑥ 긴 답변 완료 알림(2) ⑦ 엔진 영어 문구 한국어화(2) ⑧ 활동 시각화 꾸미기(반응 큼, 1).
- [추론] 사용자가 쓰는 Orca가 Chat UI에서 사용량·컨텍스트 도넛을 이미 보여 준다면(@jjinbuilder) F1 1줄과 겹친다. 일반 터미널 화면(전체 화면 TUI)에서도 Orca가 그걸 보여 주는지 먼저 확인하고, 겹치면 F1을 "effort·실행 중 작업·한도 예측" 쪽으로 무게를 옮길 수 있다.

### Gaps
- hubblerc 기능을 한국 사용자가 실제로 원하는지 직접 물은 글(설문·투표)은 없다.
- Threads 항목은 Aside 에이전트 요약이라 원문 문장·숫자를 조사자가 직접 대조하지 않았다. 중요하게 쓸 글(@cowboy76, @jjinbuilder, @make.my.agent_jy, @papapat.ai, @yw_0woo)은 인용 전에 원문을 다시 확인할 것.
- Threads에서 tmux·알림 훅·작은 화면·MCP 끊김 관련 한국어 글은 0건.
