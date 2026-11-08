# hubblerc

Claude Code mod(함수 훅 플러그인) 하나에 상태 밴드·사이드바·대화 안 요약 줄·할 일·likely 등을 담은 개인 환경. 공개 저장소(`Circlewee/hubblerc`)이고, 이 폴더가 마켓플레이스, 플러그인 본체는 `plugins/hubblerc/`.

- 결정·측정·확인할 것의 기준 문서는 `docs/spec.md`. 기능을 바꾸면 해당 절과 "주기 작업과 자원"을 날짜와 함께 갱신하고, 확인한 사실은 `[확인: …]`, 짐작은 `[추정]`으로 적는다. 테스트 키트의 함정은 spec "개발 메모"에 모여 있다.
- 사용자에게 보이는 문구는 한국어, 코드 주석·커밋 메시지는 영어.

## 구조
```
plugins/hubblerc/
  .claude-plugin/plugin.json   버전·userConfig
  hooks/register.tsx           진입점: 모든 훅 연결(이벤트당 매처 없는 훅은 하나만 됨)
  hooks/commands.ts            슬래시 명령 등록·응답
  hooks/status/  effort/  activity/  sidebar/(boxes/)  todo/  system/  likely/  commit/  shared/
  skills/aside-research/       플러그인 스킬
  shell/relaunch.zsh           /setup이 까는 셸 함수(claude 재시작, hubblerc-key)
  tests/                       claude plugin test용, tests/engine.ts가 엔진 대역
tools/likely-replay.ts         likely 기록 재실행 실험(bun)
```

## 개발 루프
- 이 폴더에선 배포판이 꺼져 있다(`.claude/settings.local.json`). 개발판은 `hcc`(= `claude --plugin-dir …/plugins/hubblerc`)로 띄운다.
- 검사 세 가지(모두 통과해야 커밋):
  - `claude plugin validate plugins/hubblerc`
  - `claude plugin test plugins/hubblerc` (파일 선택 불가. 부하가 높으면 무관한 테스트가 5초 제한에 걸리니 다시 돌린다)
  - `bunx -p typescript@5.6.3 tsc -p plugins/hubblerc` — 기존 오류 3개(`sidebar/boxes/device.tsx`의 Image `source`, `device.test.tsx` 대역 2개)가 있다. 기준은 "새 오류 0".
- 엔진 타입(`plugins/hubblerc/.claude-plugin/types/`)은 git에 없다. 새 기기에선 plugin-authoring 스킬이 만든 `claude-code.d.ts`를 `types/claude-code/index.d.ts`로 복사.
- 바뀐 코드를 다른 세션·기기에 반영하려면 업데이트 뒤 `/relaunch`(재시작). `/reload-plugins`만으로는 mod 훅이 안 붙은 일이 있었다.

## 규칙
- **atom**: `read`/`update`에 넘기는 atom은 그 파일 안에서 `const x = atom({ plugin: 'hubblerc', key: '…' } as const, …)`로 선언해야 한다(import한 atom은 validate가 거부). 같은 키를 쓰는 파일마다 다시 선언한다. atom에 큰 값을 두지 않는다(사이드바·밴드가 렌더마다 읽는다).
- **렌더 훅**(`ui.render`)에서는 상태를 쓰지 않는다. `prompt.edit` 훅은 엔진이 50ms만 기다리니 오래 걸리는 일은 기다리지 말고(`void`) 넘긴다.
- **쉬는 동안의 비용**: 새 타이머·폴링·감시를 넣지 말고 이벤트로 받는다. 2026-11-06 실측에서 쉬는 세션 비용의 대부분은 엔진에 넘기던 파일 감시 목록(`watchPaths`)과, 사이드바가 열린 채 2초마다 깨어나는 타이머였다(일 자체보다 깨어남이 비쌌다). 기능을 더하거나 바꾸면 spec "기능을 더할 때 점검" 절차를 따르고 결과를 적는다.
- **실측 방법**: 같은 시각에 Orca 탭으로 비교 세션을 나란히 띄우고(`orca terminal create --command "claude --plugin-dir …"`) 쉬는 상태 2~3분간 `ps -o time,rss`를 30초마다 읽는다. hubblerc 없는 세션(`claude`)을 바닥으로 함께 잰다. 원인을 좁힐 땐 scratchpad에 플러그인 사본을 만들어 훅을 하나씩 뺀다(저장소는 건드리지 않음). 회차마다 1초 가까이 흔들리니 작은 차이는 믿지 않는다. 끝나면 탭을 닫는다.
- **시험용 `claude -p`**: 사용자 기본 권한 모드가 auto라서 `--permission-mode default`를 붙여 실제 실행을 막는다. 시험 세션에서 `/model <이름>`을 보내면 새 세션 기본값으로 저장되니 쓰지 않는다(써야 하면 바로 원래 값으로 되돌린다).
- **커밋·릴리스**: 커밋은 작업 단위로 알아서 한다. 버전 올리기·태그·push는 사용자가 지시할 때만. 릴리스는 `plugin.json` 버전 + spec "버전 규칙" 줄에 내용 추가 + 같은 커밋에 lightweight 태그 `v<버전>`.
- **공개 저장소**: API 키·개인 정보·대화 원문을 넣지 않는다. likely·auto effort 기록(iCloud `hubblerc/`)의 명령·질문 원문은 저장소나 공유 문서로 옮기지 않고, 분석 결과는 숫자로만 적는다.
- **likely API 키**: 플러그인 설정 비밀 항목 또는 키체인 `hubblerc-likely`에서만 읽는다. 환경 변수는 읽지 않고, 키를 출력하거나 파일에 쓰지 않는다.
- **다른 세션과 같은 저장소를 쓸 때**: 시작 전에 `git status`로 남의 미커밋 변경을 확인하고, 커밋할 때는 바꾼 파일만 `git add`한다. `tools/likely-replay.ts`는 `hooks/likely/cost.ts`·`method.ts`를 import하니 둘의 위치·export를 바꾸면 그쪽도 고친다.
