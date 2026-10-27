# ─────────────────────────────────────────────
#  pipeline-state.tests.ps1
#  Dry run of pipeline-state.ps1 against throwaway folders — no GitHub,
#  no runner (spec § Testing). Each case runs the script in its own
#  powershell process, the way the composite action does.
#
#    powershell -NoProfile -ExecutionPolicy Bypass -File .github/actions/pipeline-state/pipeline-state.tests.ps1
# ─────────────────────────────────────────────

$ErrorActionPreference = 'Stop'
$script = Join-Path $PSScriptRoot 'pipeline-state.ps1'
$failures = 0

function New-Sandbox {
    $base = Join-Path ([IO.Path]::GetTempPath()) ('pipeline-state-test-' + [guid]::NewGuid())
    $ws = Join-Path $base 'workspace'
    $root = Join-Path $base 'state'
    New-Item -ItemType Directory -Force -Path (Join-Path $ws 'scripts'), (Join-Path $ws 'test-data') | Out-Null
    [pscustomobject]@{
        Base      = $base
        Workspace = $ws
        Root      = $root
        Store     = Join-Path $root 'op-pipeline'
        Snapshots = Join-Path $root 'op-pipeline-snapshots'
    }
}

function Invoke-State($sb, [string]$mode, [string]$initialize = 'false', [string]$run = '1') {
    # Continue, not Stop: under Stop, PowerShell 5.1 turns a child's stderr
    # (redirected with 2>&1) into a terminating NativeCommandError.
    $ErrorActionPreference = 'Continue'
    $out = & powershell -NoProfile -ExecutionPolicy Bypass -File $script `
        -Mode $mode -Workspace $sb.Workspace -StateRoot $sb.Root -Initialize $initialize -RunNumber $run 2>&1 | Out-String
    [pscustomobject]@{ Code = $LASTEXITCODE; Output = $out }
}

function Set-File([string]$path, [string]$content) {
    New-Item -ItemType Directory -Force -Path (Split-Path $path) | Out-Null
    Set-Content -Path $path -Value $content
}

function Get-StoreFiles($sb) {
    @((Get-Content -Raw (Join-Path $sb.Store 'store.json') | ConvertFrom-Json).files)
}

function Check([string]$name, [bool]$ok, [string]$detail = '') {
    if ($ok) {
        Write-Host "PASS  $name"
    } else {
        Write-Host "FAIL  $name`n$detail" -ForegroundColor Red
        $script:failures++
    }
}

$tracker = 'test-data\control-code-tracker.xlsx'
$counter = 'scripts\.intake-sequence-state.json'
$intake = 'test-data\DPS\10.27.26\OPEML2026102700001T.xlsx'

# 1. Empty root, restore → refused
$sb = New-Sandbox
$r = Invoke-State $sb 'restore'
Check 'empty root: restore is refused' ($r.Code -ne 0 -and $r.Output -match 'No pipeline state found') $r.Output
Check 'empty root: nothing created' (-not (Test-Path $sb.Store))
Remove-Item $sb.Base -Recurse -Force

# 2. Empty root, restore with initialize → store.json with no files
$sb = New-Sandbox
$r = Invoke-State $sb 'restore' 'true'
Check 'initialize: restore succeeds' ($r.Code -eq 0) $r.Output
Check 'initialize: store.json created' (Test-Path (Join-Path $sb.Store 'store.json'))
Check 'initialize: files list empty' ((Get-StoreFiles $sb).Count -eq 0)
Remove-Item $sb.Base -Recurse -Force

# 3. Save tracker + an intake file (no counter yet), then restore into a clean workspace
$sb = New-Sandbox
Invoke-State $sb 'restore' 'true' | Out-Null
Set-File (Join-Path $sb.Workspace $tracker) 'tracker-v1'
Set-File (Join-Path $sb.Workspace $intake) 'intake-v1'
$r = Invoke-State $sb 'save'
Check 'tracker only: save succeeds' ($r.Code -eq 0) $r.Output
$files = @(Get-StoreFiles $sb)  # @(): a one-item result would unwrap to a plain string
Check 'tracker only: files lists the tracker alone' ($files.Count -eq 1 -and $files[0] -eq 'test-data/control-code-tracker.xlsx') ($files -join ', ')
Remove-Item (Join-Path $sb.Workspace 'test-data') -Recurse -Force
$r = Invoke-State $sb 'restore' 'false' '2'
Check 'tracker only: restore succeeds without a counter' ($r.Code -eq 0) $r.Output
Check 'tracker only: tracker restored' ((Get-Content (Join-Path $sb.Workspace $tracker)) -eq 'tracker-v1')
Check 'tracker only: intake file restored' ((Get-Content (Join-Path $sb.Workspace $intake)) -eq 'intake-v1')
Remove-Item $sb.Base -Recurse -Force

# 4 + 5. Tracker + counter saved, counter deleted from the store → damaged, with or without initialize
$sb = New-Sandbox
Invoke-State $sb 'restore' 'true' | Out-Null
Set-File (Join-Path $sb.Workspace $tracker) 'tracker-v1'
Set-File (Join-Path $sb.Workspace $counter) '{"date":"2026-10-27","next":7}'
Invoke-State $sb 'save' | Out-Null
Check 'both saved: files lists tracker and counter' ((Get-StoreFiles $sb).Count -eq 2)
Remove-Item (Join-Path $sb.Store '.intake-sequence-state.json')
$r = Invoke-State $sb 'restore'
Check 'counter deleted: restore is refused as damaged' ($r.Code -ne 0 -and $r.Output -match 'Pipeline state is damaged' -and $r.Output -match 'scripts/\.intake-sequence-state\.json') $r.Output
$r = Invoke-State $sb 'restore' 'true'
Check 'counter deleted: initialize does not override damage' ($r.Code -ne 0 -and $r.Output -match 'Pipeline state is damaged') $r.Output
Remove-Item $sb.Base -Recurse -Force

# 6. 22 restores → newest 20 snapshots kept
$sb = New-Sandbox
Invoke-State $sb 'restore' 'true' | Out-Null
Set-File (Join-Path $sb.Workspace $tracker) 'tracker-v1'
Invoke-State $sb 'save' | Out-Null
foreach ($n in 1..22) {
    Invoke-State $sb 'restore' 'false' "$n" | Out-Null
    Start-Sleep -Milliseconds 20
}
$snaps = @(Get-ChildItem $sb.Snapshots -Directory)
Check 'snapshots: 20 kept' ($snaps.Count -eq 20) "found $($snaps.Count)"
Check 'snapshots: newest kept' (@($snaps | Where-Object Name -like '*-run22').Count -eq 1)
Check 'snapshots: oldest pruned' (@($snaps | Where-Object Name -like '*-run1').Count -eq 0)
Check 'snapshots: tracker inside' (Test-Path (Join-Path ($snaps | Sort-Object Name | Select-Object -Last 1).FullName 'control-code-tracker.xlsx'))
Remove-Item $sb.Base -Recurse -Force

# 7. Lock files are not saved
$sb = New-Sandbox
Invoke-State $sb 'restore' 'true' | Out-Null
Set-File (Join-Path $sb.Workspace $tracker) 'tracker-v1'
Set-File (Join-Path $sb.Workspace "$tracker.lock") 'held'
Invoke-State $sb 'save' | Out-Null
Check 'lock: tracker saved' (Test-Path (Join-Path $sb.Store 'test-data\control-code-tracker.xlsx'))
Check 'lock: lock file not saved' (-not (Test-Path (Join-Path $sb.Store 'test-data\control-code-tracker.xlsx.lock')))
Remove-Item $sb.Base -Recurse -Force

# 8. Save with no store → refused (a run that never restored must not create one)
$sb = New-Sandbox
Set-File (Join-Path $sb.Workspace $tracker) 'tracker-v1'
$r = Invoke-State $sb 'save'
Check 'no store: save is refused' ($r.Code -ne 0 -and -not (Test-Path (Join-Path $sb.Store 'store.json'))) $r.Output
Remove-Item $sb.Base -Recurse -Force

if ($failures) {
    Write-Host "`n$failures check(s) failed." -ForegroundColor Red
    exit 1
}
Write-Host "`nAll checks passed."
exit 0
