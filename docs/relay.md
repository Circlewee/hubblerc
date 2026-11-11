# relay 동작 흐름

relay는 리드(지금 대화하는 세션)가 일을 나눠 워커에게 맡기고, 돌아온 결과를 확인하고, 다른 모델의 검증을 거쳐 끝내는 방식이다. 판단은 리드가 스킬(`skills/relay/SKILL.md`)을 읽고 하고, 답이 하나로 정해지는 일(지시서 쓰기, 보고서 대조, 완료 명령 실행, 검증 꾸러미, 끝내기 거절)은 도구 `mcp__hubblerc__relay`가 한다. 설계 근거와 세부는 `docs/spec.md`의 F13에 있다.

## 1. 먼저 길을 고른다

작은 길이 먼저다. 막히면 위로 올린다.

```mermaid
flowchart TD
    A[할 일이 들어옴] --> B{리드가 이미 읽은 파일이고<br/>수십 줄 안이고<br/>맡은 워커가 없고<br/>테스트로 확인이 끝나는가}
    B -- 넷 다 맞음 --> D[직접: 리드가 고침]
    B -- 아님 --> C{워커 1~3개로<br/>서로 독립이고<br/>이 답변 안에 끝나고<br/>사용자 결정이 필요 없는가}
    C -- 맞음 --> L[가벼운 위임:<br/>지시서를 메시지로 보내고<br/>짧은 보고를 받음, 기록 폴더 없음]
    C -- 아님 --> F[전체 진행:<br/>기록 폴더, 작업 파일, 묶음 끝 검증]
    L -- 워커가 두 번 막히거나<br/>답변을 넘김 --> F
```

## 2. 전체 진행의 한 바퀴

```mermaid
sequenceDiagram
    participant U as 사용자
    participant L as 리드
    participant T as relay 도구
    participant W as 워커
    participant V as 검증자(다른 모델)

    L->>T: start (묶음 폴더와 진행 기록 생성)
    loop 작업마다
        L->>T: task (지시서 작성: 범위·완료 기준·모델·effort)
        T-->>L: 빠진 칸이나 다른 작업과 겹치면 거절
        L->>W: 지시서 경로를 넘겨 띄움
        Note over T: 관문 1: 띄울 때 지시서를 검사하고<br/>작업을 "도는 중"으로 표시
        Note over L: 답변을 끝내고 이벤트를 기다림(폴링 없음)
        W-->>L: 보고서와 커밋
        L->>T: report (보고서와 지시서 대조)
        L->>T: check (완료 기준 명령을 직접 실행)
        alt 통과
            Note over L: 다음 작업으로
        else 실패·막힘
            L->>T: task (같은 id의 새 판)
            L->>W: 같은 워커에게 다시 보냄(같은 기준 3번 실패면 교체)
        end
    end
    L->>T: package (검증 꾸러미: 지시서·보고서·커밋·검사 결과)
    L->>V: 꾸러미를 넘김(codex exec 먼저)
    V-->>L: 기준별 판정 파일
    L->>T: verdict (판정 기록)
    L->>T: finish
    Note over T: 관문 2: 도는 작업, 커밋 안 된 변경,<br/>판정 없음·실패, 판정 뒤 바뀐 커밋이 있으면 거절
    L->>U: 작업별 결과·증거, 리드가 정한 것, 아직 묻는 것
```

## 3. 작업 하나의 상태

```mermaid
stateDiagram-v2
    [*] --> ready: task (지시서 작성)
    ready --> running: 워커를 띄움
    running --> done: report에서 DONE
    running --> needs_context: 맥락 부족 보고
    running --> blocked: 막힘 보고, 또는 띄운 뒤 지시서가 바뀜
    needs_context --> ready: 새 판
    blocked --> ready: 새 판(띄운 뒤 막힌 것은 워커를 멈추고 cancel 먼저)
    ready --> cancelled: cancel
    running --> cancelled: 워커가 멈춘 것을 확인한 뒤 cancel
    done --> [*]
    cancelled --> [*]
```

끝난(done) 작업은 취소할 수 없다. 그 커밋이 검증 꾸러미에 들어가기 때문이다.

## 4. 지키는 것

- **사용자에게 묻는 것은 정해져 있다.** push, 배포, 외부 전송, 평소를 넘는 비용, 완료 기준 변경, 되돌리기 어려운 일만 묻는다. 나머지는 리드가 정하고 "결정·이유·틀렸을 때 비용"을 결정 표에 적어 끝에 모두 보고한다.
- **워커의 "테스트 통과"는 증거가 아니다.** 완료 기준 명령은 도구가 직접 돌린다.
- **보낸 지시서는 고치지 않는다.** 바꿀 것이 있으면 같은 id로 새 판을 만든다.
- **워커끼리 문서를 공유하지 않는다.** 한 워커가 알아낸 것은 리드가 보고서에서 골라 다음 지시서의 "먼저 읽을 것"에 넣는다.
- **기다림은 이벤트로만.** Orca의 깨움, 서브에이전트 완료 알림, 백그라운드 명령 종료를 기다린다.
- **두 관문은 훅이다.** 띄우기 전 지시서 검사와 끝내기 전 검증 대조는 건너뛸 수 없다.

## 5. 어디에 무엇이 있나

| 무엇 | 어디 |
|---|---|
| 리드의 규칙 | `plugins/hubblerc/skills/relay/SKILL.md` |
| 실행 환경별 안내(Orca, 서브에이전트, codex exec) | `plugins/hubblerc/skills/relay/references/` |
| 도구(지시서·보고·검사·꾸러미·판정·끝내기) | `plugins/hubblerc/hooks/relay/relay.ts` |
| 관문 1·2 | `plugins/hubblerc/hooks/relay/gate.ts` |
| 사이드바 상자·`/relay-status` | `plugins/hubblerc/hooks/relay/relay-view.tsx`, `relay-status.ts` |
| 묶음의 기록(진행 기록, 지시서, 보고서, 판정) | `.relay/runs/<날짜>-<이름>/` (git에 넣지 않음) |
