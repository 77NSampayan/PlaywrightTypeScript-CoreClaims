# ─────────────────────────────────────────────
#  pipeline-state.ps1
#  Keeps the OP pipeline's git-ignored state on the self-hosted runner
#  between GitHub Actions runs — checkout's clean deletes it from the
#  workspace every time. See README § Pipeline state on the runner.
#
#    restore  validate the store, snapshot it, copy it into the workspace
#    save     copy the workspace back, rewrite store.json
#
#  Called by action.yml; run directly (with -StateRoot pointing at a scratch
#  folder) by pipeline-state.tests.ps1. Windows PowerShell 5.1 — no pwsh.
# ─────────────────────────────────────────────

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('restore', 'save')]
    [string]$Mode,
    [string]$Workspace = (Get-Location).Path,
    # Empty = %USERPROFILE%\claims-qa-state.
    [string]$StateRoot = '',
    # Text, not [bool]: composite-action inputs arrive as 'true' / 'false'.
    [string]$Initialize = 'false',
    [int]$SnapshotKeep = 20,
    [string]$RunNumber = $env:GITHUB_RUN_NUMBER,
    [string]$RunUrl = ''
)

$ErrorActionPreference = 'Stop'

if (-not $StateRoot) { $StateRoot = Join-Path $env:USERPROFILE 'claims-qa-state' }
if (-not $RunUrl -and $env:GITHUB_RUN_ID) {
    $RunUrl = "$env:GITHUB_SERVER_URL/$env:GITHUB_REPOSITORY/actions/runs/$env:GITHUB_RUN_ID"
}
if (-not $RunNumber) { $RunNumber = 'local' }

$store = Join-Path $StateRoot 'op-pipeline'
$snapshots = Join-Path $StateRoot 'op-pipeline-snapshots'
$storeJson = Join-Path $store 'store.json'

# The files whose loss reuses control codes or forgets codes' history.
# Name = how store.json lists it; Store / Workspace = where it lives in each.
$keyFiles = @(
    @{ Name = 'test-data/control-code-tracker.xlsx'; Store = 'test-data\control-code-tracker.xlsx'; Workspace = 'test-data\control-code-tracker.xlsx' },
    @{ Name = 'scripts/.intake-sequence-state.json'; Store = '.intake-sequence-state.json'; Workspace = 'scripts\.intake-sequence-state.json' }
)

function Invoke-Robocopy([string]$from, [string]$to, [string[]]$extra = @()) {
    & robocopy $from $to /E @extra /NFL /NDL /NJH /NJS /NP | Out-Null
    # 0-7 = success (1 = files copied); 8+ = at least one copy failed.
    if ($LASTEXITCODE -ge 8) { throw "robocopy $from -> $to failed (exit $LASTEXITCODE)." }
    $global:LASTEXITCODE = 0
}

function Read-StoreJson {
    Get-Content -Raw $storeJson | ConvertFrom-Json
}

function Write-StoreJson($data) {
    ConvertTo-Json -InputObject $data -Depth 3 | Set-Content -Path $storeJson -Encoding UTF8
}

function New-Snapshot {
    $present = @($keyFiles | Where-Object { Test-Path (Join-Path $store $_.Store) })
    if ($present.Count -eq 0) { return }

    $dir = Join-Path $snapshots ('{0}-run{1}' -f (Get-Date -Format 'yyyyMMdd-HHmmss-fff'), $RunNumber)
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    foreach ($file in $present) {
        Copy-Item (Join-Path $store $file.Store) (Join-Path $dir (Split-Path $file.Store -Leaf)) -Force
    }
    Write-Host "Snapshot: $dir"

    # Fixed-width timestamp prefix, so name order is age order.
    Get-ChildItem $snapshots -Directory | Sort-Object Name -Descending |
        Select-Object -Skip $SnapshotKeep | Remove-Item -Recurse -Force
}

function Invoke-Restore {
    if (-not (Test-Path $storeJson)) {
        if ($Initialize -ne 'true') {
            throw "No pipeline state found at $store. If this is the first run on this runner, re-run with initialize_state ticked."
        }
        New-Item -ItemType Directory -Force -Path $store | Out-Null
        Write-StoreJson ([ordered]@{
            createdAt     = (Get-Date).ToString('o')
            createdByRun  = $RunUrl
            lastRunNumber = $null
            lastRunAt     = $null
            lastRunUrl    = $null
            files         = @()
        })
        Write-Host "Initialized new pipeline state at $store"
    } elseif ($Initialize -eq 'true') {
        Write-Warning "initialize_state ignored: pipeline state already exists at $store."
    }

    # A file the last save recorded but the store no longer has = damaged.
    # A file never saved yet (the counter before the first S0) is not demanded.
    $meta = Read-StoreJson
    $missing = @(@($meta.files) | Where-Object { $_ } | Where-Object {
        $name = $_
        $file = $keyFiles | Where-Object { $_.Name -eq $name }
        -not $file -or -not (Test-Path (Join-Path $store $file.Store))
    })
    if ($missing.Count -gt 0) {
        throw "Pipeline state is damaged: $($missing -join ', ') missing. Restore from $snapshots (README § Pipeline state on the runner)."
    }

    New-Snapshot

    if (Test-Path (Join-Path $store 'test-data')) {
        Invoke-Robocopy (Join-Path $store 'test-data') (Join-Path $Workspace 'test-data')
    }
    $counter = $keyFiles[1]
    if (Test-Path (Join-Path $store $counter.Store)) {
        New-Item -ItemType Directory -Force -Path (Join-Path $Workspace 'scripts') | Out-Null
        Copy-Item (Join-Path $store $counter.Store) (Join-Path $Workspace $counter.Workspace) -Force
    }
    Write-Host "Pipeline state restored from $store"
}

function Invoke-Save {
    # A run that never restored must not create (or overwrite) the store.
    if (-not (Test-Path $storeJson)) {
        throw "No pipeline state at $store to save into. The restore step must run first."
    }

    if (Test-Path (Join-Path $Workspace 'test-data')) {
        # /E never deletes from the store; lock files are left behind.
        Invoke-Robocopy (Join-Path $Workspace 'test-data') (Join-Path $store 'test-data') @('/XF', '*.lock')
    }
    $counter = $keyFiles[1]
    if (Test-Path (Join-Path $Workspace $counter.Workspace)) {
        Copy-Item (Join-Path $Workspace $counter.Workspace) (Join-Path $store $counter.Store) -Force
    }

    $meta = Read-StoreJson
    Write-StoreJson ([ordered]@{
        createdAt     = $meta.createdAt
        createdByRun  = $meta.createdByRun
        lastRunNumber = $RunNumber
        lastRunAt     = (Get-Date).ToString('o')
        lastRunUrl    = $RunUrl
        files         = @($keyFiles | Where-Object { Test-Path (Join-Path $store $_.Store) } | ForEach-Object { $_.Name })
    })
    Write-Host "Pipeline state saved to $store"
}

switch ($Mode) {
    'restore' { Invoke-Restore }
    'save' { Invoke-Save }
}
exit 0
