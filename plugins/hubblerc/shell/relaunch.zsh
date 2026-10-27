# hubblerc: Claude Code를 새 버전으로 다시 띄우는 셸 함수.
# `/setup`이 이 파일을 ~/.claude/hubblerc/relaunch.zsh로 복사하고, ~/.zshrc에 불러오는 줄을 넣는다:
#   source ~/.claude/hubblerc/relaunch.zsh
#
# 사이드바의 "재시작"이나 `/relaunch`를 쓰면 hubblerc는 진행 중인 답변이 끝나기를 기다렸다가
# 세션 id를 $HUBBLERC_RELAUNCH_FILE에 적고 Claude Code를 끝낸다. 이 함수는 그 파일을 보고 같은
# 세션을 `--resume`으로 다시 연다. 그때 실행 파일은 받아 둔 새 버전이다.
#
# 다시 열 때 처음 실행의 옵션 중 플러그인·폴더·설정·모델을 정하는 것만 그대로 넘긴다.
# 세션을 정하는 것(--resume, --continue, 프롬프트)과 권한 옵션은 넘기지 않는다.

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
    HUBBLERC_RELAUNCH_FILE="$file" command claude "${keep[@]}" --resume "$id"
    code=$?
  done
  rm -f "$file"

  return $code
}
