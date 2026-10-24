# One `git bisect run` step over a LibreOffice bibisect repository (Windows):
# good = a Calc tile renders through wos-lok-host (exit 0), bad = it does not
# (exit 1), untestable build = skip (exit 125). The formula bar is hidden and
# the host's wait fix is on (its default), so the 25.8 deadlock cannot hide the result.
param([string]$Repo, [string]$Workspace, [string]$Fixtures)
$prog = Join-Path $Repo "instdir\program"
$rev = (git -C $Repo log -1 --format="%h %s").Trim()
# Release builds are merged (mergedlo.dll); bibisect builds are not (sofficeapp.dll). lok_init takes either.
if (-not ((Test-Path (Join-Path $prog "mergedlo.dll")) -or (Test-Path (Join-Path $prog "sofficeapp.dll")))) {
  Write-Host "skip (no engine library): $rev"
  exit 125
}
Remove-Item (Join-Path $env:TEMP "wos-lok-host-profile") -Recurse -Force -ErrorAction SilentlyContinue
$env:WOS_LOK_KEEP_FORMULA_BAR = "0"
$env:WOS_SMOKE_TIMEOUT_MS = "90000"
$out = & node (Join-Path $Workspace "e2e\lok-host-smoke.mjs") (Join-Path $Workspace "scripts\lok\wos-lok-host.exe") "$prog\" (Join-Path $prog "fundamental.ini") (Join-Path $Fixtures "Harbour-Terminal-Q3.xlsx") 2>&1
$code = $LASTEXITCODE
Get-Process wos-lok-host -ErrorAction SilentlyContinue | Stop-Process -Force
$line = ($out | Select-String -Pattern "Harbour" | Select-Object -Last 1)
if (-not $line) { $line = ($out | Select-Object -Last 1) }
Write-Host "step $rev -> exit $code | $line"
if ($code -eq 0) { exit 0 }
if ("$out" -match "solid tile") { exit 1 }
exit 125
