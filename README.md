# hubblerc

hubble의 Claude Code 환경. Claude Code mod(함수 훅 플러그인) 하나에 상태 밴드, 사이드바, 대화 안 요약 줄을 담았다. 문구는 한국어다.

- **상태 밴드** (프롬프트 위 3줄): 모델·effort, 컨텍스트, 5시간·7일 한도(빠르게 닳으면 소진 예측 `⚠18m`), 프로젝트·브랜치, 지금 실행 중인 것, 직전 답변 요약과 마지막 요청 시각·캐시 적중률
- **사이드바** (전체 화면, 넓은 터미널): 장비(세션 상태에 따라 바뀌는 고양이, 칩·메모리·macOS·켜진 시간·Claude Code 버전과 새 버전 알림), 상태, 작업, 이 세션에서 바뀐 파일(누르면 열림, 저장소 밖 파일은 폴더별로), 답변 목차(누르면 그 답변으로 이동). 상자 제목을 누르면 접힌다
- **대화 안**: 답변 끝 요약 줄(`app.ts +2 −1 · Read 3 · 출력 12k · 5h +3%`), Bash 명령의 용도, 접힌 도구 줄의 읽은 파일 이름과 한국어 문구, 수정 diff를 한 줄로(`ctrl+o`로 전체)
- **effort**: `ctrl+x ctrl+e`로 슬라이더, 질문마다 작은 모델이 고르는 auto effort(선택)
- **명령**: `/panel` 사이드바 열기/닫기, `/activity` 답변별 활동, `/effort-log` 요청별 effort와 토큰, `/setup` 이 기기 설정 점검

## 설치

Claude Code 2.1.308~2.1.310에서 썼다(최소 버전은 확인하지 않음). 세 기기를 같은 버전으로 맞추는 편이 안전하다.

1. mod가 원격으로 꺼져 있지 않은지: mod가 없는 폴더에서 `claude plugin test`
2. Claude Code에서:
   ```
   /plugin install hubblerc --marketplace Circlewee/hubblerc
   ```
3. 첫 실행 때 빠진 설정이 있으면 대화에 "hubblerc 설정 N개가 덜 됐습니다"가 뜬다. `/setup`을 실행하면
   - 빠진 키 설정(`ctrl+x ctrl+e` effort, `ctrl+x ctrl+p` 사이드바)을 `~/.claude/keybindings.json`에 추가한다(원래 파일은 `.bak`으로 둔다)
   - 전체 화면(`/tui fullscreen`), claude-hud 상태줄 지우기, 응답 언어는 안내만 한다
4. `/config`의 hubblerc 항목: `layout`(auto / sidebar / band), `autoEffort`

업데이트는 `plugin.json`의 버전이 오를 때 받는다. 버전마다 git 태그 `v<버전>`이 있다.

## 개발

설계와 결정은 [`docs/spec.md`](docs/spec.md), 조사는 [`docs/research.md`](docs/research.md)에 있다.

- 검사: `claude plugin validate plugins/hubblerc`
- 테스트: `claude plugin test plugins/hubblerc`
- 타입 검사: `bunx -p typescript@5.6.3 tsc -p plugins/hubblerc`
