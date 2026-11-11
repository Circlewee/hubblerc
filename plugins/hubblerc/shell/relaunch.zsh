# hubblerc의 셸 설정: Orca에서 그림을 켜는 값, Claude Code를 새 버전으로 다시 띄우는 셸 함수,
# likely(판정)의 API 키를 키체인에 넣고 지우는 `hubblerc-key`.
# `/setup`이 이 파일을 ~/.claude/hubblerc/relaunch.zsh로 복사하고, ~/.zshrc에 불러오는 줄을 넣는다:
#   source ~/.claude/hubblerc/relaunch.zsh
#
# 아래 번호는 이 파일의 판이다. 내용을 바꾸면 올린다: `/setup`은 설치된 판이 같거나 새로우면 덮어쓰지
# 않아서, 예전 hubblerc로 도는 다른 세션의 `/setup`이 새 파일을 되돌리지 못한다.
# hubblerc-shell-version: 3

# Orca의 터미널은 그림(kitty 유니코드 placeholder)을 그리지만, Claude Code는 Orca를 그림 되는 터미널로
# 알아보지 못한다. Orca는 자기 에이전트 실행으로 띄운 Claude에만 이 값을 넣어 주므로, 탭에서 직접 띄울
# 때도 사이드바 고양이가 그림으로 나오게 여기서 넣는다. 이미 정해 둔 값(0 포함)은 그대로 둔다.
if [[ "$TERM_PROGRAM" == Orca && -z "${CLAUDE_CODE_FORCE_TERMINAL_IMAGES+set}" ]]; then
  export CLAUDE_CODE_FORCE_TERMINAL_IMAGES=1
fi

# 사이드바의 "재시작"이나 `/relaunch`를 쓰면 hubblerc는 진행 중인 답변이 끝나기를 기다렸다가
# 세션 id를 $HUBBLERC_RELAUNCH_FILE에 적고 Claude Code를 끝낸다. 이 함수는 그 파일을 보고 같은
# 세션을 `--resume`으로 다시 연다. 그때 실행 파일은 받아 둔 새 버전이다.
#
# 다시 열 때 처음 실행의 옵션 중 플러그인·폴더·설정·모델을 정하는 것만 그대로 넘긴다.
# 세션을 정하는 것(--resume, --continue, 프롬프트)과 권한 옵션은 넘기지 않는다.

# 개발판 사본: 저장소의 플러그인을 --plugin-dir로 직접 불러오면 그 세션이 플러그인 파일을 고칠 때 자동 모드
# 검사가 판정을 건너뛴다(no verdict). 그래서 개발판은 저장소 밖 사본을 불러온다.
#   HUBBLERC_DEV_SRC   원본 위치(저장소의 plugins/hubblerc). ~/.zshrc에서 export로 정한다. 필수.
#   HUBBLERC_DEV_COPY  사본 위치. 없으면 ~/.cache/hubblerc-live.
#   hcc-sync           원본을 사본으로 복사한다(실행 중 세션은 바뀐 사본을 다시 읽는다).
#   hcc [옵션]         복사한 뒤 사본으로 Claude Code를 띄운다.
# 사본에는 원본 위치를 적은 .hubblerc-source가 남는다. 아래 claude()는 그 표시가 있는 --plugin-dir를
# 다시 띄우기 직전에 새로 복사한다.

# 같은 이름의 alias(예전 방식의 `alias hcc="claude --plugin-dir <저장소>"` 등)가 있으면 아래 함수 정의가
# 파싱 오류로 깨지고(alias는 함수보다 먼저 풀린다) 이 파일의 나머지도 불러오지 못한다. 그리고 alias가
# 남으면 함수보다 먼저 실행되어 저장소 경로를 직접 불러오게 된다. 그래서 이 파일이 정의하는 이름의
# alias는 먼저 지운다(이 셸 세션에서만. ~/.zshrc의 alias 줄은 건드리지 않는다).
unalias hcc hcc-sync claude hubblerc-key 2>/dev/null

# _hubblerc_copy_sync <원본> <사본>: 원본을 사본으로 복사하고 표시를 남긴다.
_hubblerc_copy_sync() {
  local src="${1%/}" dest="${2%/}"
  if [[ ! -f "$src/.claude-plugin/plugin.json" ]]; then
    print -r -- "원본 폴더가 아닙니다: $src (.claude-plugin/plugin.json이 없음)" >&2
    return 1
  fi
  if [[ "$src" == "$dest" ]]; then
    print -r -- "원본과 사본이 같은 폴더입니다: $src" >&2
    return 1
  fi
  mkdir -p "$dest" || return 1
  # -c: an edit of the same size within the same second would pass the size-and-time check unnoticed.
  rsync -ac --delete "$src/" "$dest/" || return 1
  print -r -- "$src" >| "$dest/.hubblerc-source"
}

hcc-sync() {
  if [[ -z "${HUBBLERC_DEV_SRC:-}" ]]; then
    print -r -- "HUBBLERC_DEV_SRC가 정해져 있지 않습니다. ~/.zshrc에 개발판 원본 위치를 넣으세요: export HUBBLERC_DEV_SRC=<저장소>/plugins/hubblerc" >&2
    return 1
  fi
  _hubblerc_copy_sync "$HUBBLERC_DEV_SRC" "${HUBBLERC_DEV_COPY:-$HOME/.cache/hubblerc-live}"
}

hcc() {
  hcc-sync || return $?
  claude --plugin-dir "${HUBBLERC_DEV_COPY:-$HOME/.cache/hubblerc-live}" "$@"
}

# _hubblerc_resync <--plugin-dir 값>: hcc가 만든 사본이면 원본에서 새로 복사한다. 아니면 아무것도 안 한다.
_hubblerc_resync() {
  local dir="${1%/}"
  [[ -f "$dir/.hubblerc-source" ]] || return 0
  local src
  src="$(<"$dir/.hubblerc-source")"
  _hubblerc_copy_sync "$src" "$dir" || print -r -- "개발판 사본을 새로 복사하지 못했습니다. 있던 사본으로 다시 띄웁니다: $dir" >&2
  return 0
}

claude() {
  local file="${TMPDIR:-/tmp}/hubblerc-relaunch.$$.$RANDOM"
  local -a keep
  local i=1
  while (( i <= $# )); do
    case "${argv[i]}" in
      --plugin-dir|--plugin-dir-no-mcp|--add-dir|--settings|--setting-sources|--mcp-config|--model)
        keep+=("${argv[i]}" "${argv[i+1]}")
        (( i += 2 ))
        continue
        ;;
      --plugin-dir=*|--plugin-dir-no-mcp=*|--add-dir=*|--settings=*|--setting-sources=*|--mcp-config=*|--model=*|--strict-mcp-config)
        keep+=("${argv[i]}")
        ;;
    esac
    (( i++ ))
  done

  rm -f "$file"
  HUBBLERC_RELAUNCH_FILE="$file" command claude "$@"
  local code=$?
  local id
  while [[ -s "$file" ]]; do
    id="$(<"$file")"
    rm -f "$file"
    # 세션 id(uuid)가 아니면 다시 띄우지 않는다.
    [[ "$id" =~ '^[0-9a-f-]{36}$' ]] || break
    local k
    for (( k = 1; k <= ${#keep}; k++ )); do
      case "${keep[k]}" in
        --plugin-dir|--plugin-dir-no-mcp) _hubblerc_resync "${keep[k+1]}" ;;
        --plugin-dir=*) _hubblerc_resync "${keep[k]#--plugin-dir=}" ;;
        --plugin-dir-no-mcp=*) _hubblerc_resync "${keep[k]#--plugin-dir-no-mcp=}" ;;
      esac
    done
    HUBBLERC_RELAUNCH_FILE="$file" command claude "${keep[@]}" --resume "$id"
    code=$?
  done
  rm -f "$file"

  return $code
}

# likely(판정)가 쓰는 Anthropic API 키를 macOS 키체인 항목 hubblerc-likely에 넣고(바꾸고), 지우고, 있는지 본다.
# 키 값은 어디에도 출력하지 않는다: 확인은 항목이 있는지(종료 코드)만, 넣을 때는 security가 가린 입력으로 묻는다.
#   hubblerc-key         있는지 확인 (status와 같음)
#   hubblerc-key set     넣기·바꾸기
#   hubblerc-key delete  지우기 (y/N 확인)
hubblerc-key() {
  local service=hubblerc-likely
  local usage='사용법: hubblerc-key [status|set|delete]  확인 · 넣기·바꾸기 · 지우기'
  case "${1:-status}" in
    status)
      if security find-generic-password -s "$service" >/dev/null 2>&1; then
        print -r -- "likely API 키: 키체인에 있음 ($service)"
      else
        print -r -- "likely API 키: 키체인에 없음 ($service)"
      fi
      print -r -- "$usage"
      ;;
    set)
      print -r -- "Max 구독 크레딧이 연결된 Console 조직의 API 키를 넣으세요. 입력은 화면에 보이지 않습니다(두 번 묻습니다)."
      if security add-generic-password -U -s "$service" -a "$USER" -w; then
        print -r -- "키체인에 넣었습니다. 키가 없던 Claude Code 세션은 /likely를 한 번 실행하면 읽고, 키가 있던 세션은 새 세션부터 바뀐 키를 씁니다."
      else
        print -r -- "키를 넣지 못했습니다." >&2
        return 1
      fi
      ;;
    delete)
      if ! security find-generic-password -s "$service" >/dev/null 2>&1; then
        print -r -- "키체인에 지울 키가 없습니다 ($service)."
        return 0
      fi
      local answer
      read -r "answer?키체인의 likely API 키($service)를 지울까요? [y/N] "
      if [[ "$answer" == [yY]* ]]; then
        if security delete-generic-password -s "$service" >/dev/null 2>&1; then
          print -r -- "지웠습니다. 열려 있는 Claude Code 세션은 새 세션부터 키 없이 돕니다."
        else
          print -r -- "지우지 못했습니다." >&2
          return 1
        fi
      else
        print -r -- "그대로 둡니다."
      fi
      ;;
    *)
      print -r -- "$usage" >&2
      return 2
      ;;
  esac
}
