#!/usr/bin/env zsh
# Trial for shell/relaunch.zsh: hcc copies the source and launches the copy, a relaunch copies again,
# a --plugin-dir that is not an hcc copy is left alone. Everything lives in a temp folder with a fake
# `claude`; the real home, ~/.cache and claude are never touched. Exit 0 on success.

here="${0:A:h}"
script="${here:h:h}/shell/relaunch.zsh"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

fail=0
check() { # check <name> <expected> <actual>
  if [[ "$2" == "$3" ]]; then print -r -- "ok   $1"; else print -r -- "FAIL $1: expected [$2] got [$3]"; fail=1; fi
}

mkdir -p "$tmp/bin" "$tmp/home" "$tmp/src/.claude-plugin" "$tmp/other/.claude-plugin"
print -r -- '{}' > "$tmp/src/.claude-plugin/plugin.json"
print -r -- one > "$tmp/src/marker.txt"
print -r -- '{}' > "$tmp/other/.claude-plugin/plugin.json"
print -r -- old > "$tmp/other/marker.txt"

# Fake claude: logs its args and the --plugin-dir's marker.txt; on its first call it edits the source
# and asks for a relaunch by writing a session id to the relaunch file.
cat > "$tmp/bin/claude" <<'EOF'
#!/bin/sh
n=$(cat "$FAKE_DIR/count" 2>/dev/null || echo 0)
n=$((n + 1))
echo $n > "$FAKE_DIR/count"
echo "$*" >> "$FAKE_DIR/args"
dir=""
prev=""
for a in "$@"; do
  [ "$prev" = "--plugin-dir" ] && dir="$a"
  prev="$a"
done
echo "$(cat "$dir/marker.txt" 2>/dev/null)" >> "$FAKE_DIR/seen"
if [ "$n" = 1 ] && [ -n "${FAKE_RELAUNCH:-}" ]; then
  echo two > "$FAKE_SRC/marker.txt"
  echo 11111111-2222-3333-4444-555555555555 > "$HUBBLERC_RELAUNCH_FILE"
fi
exit 0
EOF
chmod +x "$tmp/bin/claude"

export PATH="$tmp/bin:$PATH" HOME="$tmp/home" TMPDIR="$tmp" FAKE_DIR="$tmp" FAKE_SRC="$tmp/src"
unset TERM_PROGRAM
source "$script"

# 1. Without HUBBLERC_DEV_SRC: guidance in Korean, nothing launched.
unset HUBBLERC_DEV_SRC HUBBLERC_DEV_COPY
msg="$(hcc 2>&1 >/dev/null)" && rc=0 || rc=$?
check "no src: fails" 1 "$rc"
[[ "$msg" == *HUBBLERC_DEV_SRC* ]] && check "no src: guidance" 1 1 || check "no src: guidance" 1 0
check "no src: nothing launched" "" "$(cat "$tmp/count" 2>/dev/null)"

# 2. hcc copies and launches the copy (default copy path under HOME).
export HUBBLERC_DEV_SRC="$tmp/src"
export FAKE_RELAUNCH=1
hcc --model x
copy="$tmp/home/.cache/hubblerc-live"
check "hcc: first run saw the copy" one "$(sed -n 1p "$tmp/seen")"
check "hcc: source mark" "$tmp/src" "$(cat "$copy/.hubblerc-source")"
check "hcc: first args" "--plugin-dir $copy --model x" "$(sed -n 1p "$tmp/args")"

# 3. Relaunch: the source changed during the first run, the copy is copied again before the second.
check "relaunch: second call happened" 2 "$(cat "$tmp/count")"
check "relaunch: resume args" "--plugin-dir $copy --model x --resume 11111111-2222-3333-4444-555555555555" "$(sed -n 2p "$tmp/args")"
check "relaunch: copy refreshed" two "$(sed -n 2p "$tmp/seen")"

# 4. A --plugin-dir that is not an hcc copy is not copied over.
rm -f "$tmp/count" "$tmp/args" "$tmp/seen"
mkdir -p "$tmp/scratch"
export FAKE_SRC="$tmp/scratch"
claude --plugin-dir "$tmp/other" --model y
check "plain dir: relaunched" 2 "$(cat "$tmp/count")"
check "plain dir: untouched" old "$(cat "$tmp/other/marker.txt")"
check "plain dir: seen unchanged" old "$(sed -n 2p "$tmp/seen")"
check "plain dir: no mark added" "no" "$([[ -e "$tmp/other/.hubblerc-source" ]] && echo yes || echo no)"
check "plain dir: args" "--plugin-dir $tmp/other --model y --resume 11111111-2222-3333-4444-555555555555" "$(sed -n 2p "$tmp/args")"

# 5. HUBBLERC_DEV_COPY moves the copy.
rm -f "$tmp/count" "$tmp/args" "$tmp/seen"
unset FAKE_RELAUNCH
export HUBBLERC_DEV_COPY="$tmp/mycopy"
hcc
check "custom copy: made" two "$(cat "$tmp/mycopy/marker.txt")"

exit $fail
