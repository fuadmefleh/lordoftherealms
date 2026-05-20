#!/usr/bin/env bash
# load-repo-memory.sh — SessionStart hook: injects repo memory into agent context
MEM_FILE=".github/repo-memory.md"

if [ -f "$MEM_FILE" ]; then
    CONTENT=$(cat "$MEM_FILE")
    # JSON-escape the content
    ESCAPED=$(printf '%s' "$CONTENT" | python3 -c 'import sys,json; print(json.dumps(sys.stdin.read()))' 2>/dev/null || printf '%s' "$CONTENT" | sed 's/\\/\\\\/g; s/"/\\"/g; s/\t/\\t/g' | awk '{printf "%s\\n", $0}')
    MSG="## Repo Memory (from past sessions)\n\n${ESCAPED}\n\n---\nREMINDER: Before finishing this session, append any new discoveries, bug fixes, architectural insights, or gotchas to .github/repo-memory.md so future sessions benefit. Keep entries short (1-2 lines each). Never remove existing entries."
    printf '{"systemMessage": %s}' "$(printf '%s' "$MSG" | python3 -c 'import sys,json; print(json.dumps(sys.stdin.read()))' 2>/dev/null || echo "\"$MSG\"")"
else
    echo '{"systemMessage": "No repo memory exists yet at .github/repo-memory.md. After completing non-trivial work this session, create it with any useful insights about this codebase."}'
fi
