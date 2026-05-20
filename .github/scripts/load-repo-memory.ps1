# load-repo-memory.ps1 — SessionStart hook: injects repo memory into agent context
$memFile = Join-Path $PWD ".github" "repo-memory.md"

if (Test-Path $memFile) {
    $content = Get-Content $memFile -Raw
    $msg = "## Repo Memory (from past sessions)`n`n" + $content + "`n`n---`nREMINDER: Before finishing this session, append any new discoveries, bug fixes, architectural insights, or gotchas to .github/repo-memory.md so future sessions benefit. Keep entries short (1-2 lines each). Never remove existing entries."
} else {
    $msg = "No repo memory exists yet at .github/repo-memory.md. After completing non-trivial work this session, create it with any useful insights about this codebase."
}

$output = @{ systemMessage = $msg } | ConvertTo-Json -Compress
Write-Output $output
