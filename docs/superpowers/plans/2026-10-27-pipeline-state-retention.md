# Pipeline State Retention Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the Control Code Tracker, intake files and filename counter on the self-hosted runner between GitHub Actions pipeline runs, refusing to run when that state is missing or damaged.

**Architecture:** A local composite action (`.github/actions/pipeline-state/`) wraps one Windows PowerShell script with two modes: `restore` (validate the store, snapshot it, copy it into the workspace) and `save` (copy the workspace back, rewrite `store.json`). The OP intake workflow calls it at start and end, runs only on the `op-pipeline`-labelled runner, and exposes an `initialize_state` input for the first run. A standalone PowerShell test script dry-runs every case against temp folders.

**Tech Stack:** GitHub Actions (composite action, self-hosted Windows runner), Windows PowerShell 5.1, robocopy.

**Spec:** [docs/superpowers/specs/2026-10-27-pipeline-state-retention-design.md](../specs/2026-10-27-pipeline-state-retention-design.md)

## Global Constraints

- Shell is **Windows PowerShell 5.1** (`shell: powershell`), not `pwsh` — the runner may not have pwsh. No PowerShell 7-only syntax (`??`, `?.`, ternary `a ? b : c`, `-Parallel`).
- State root default: `%USERPROFILE%\claims-qa-state`; store `op-pipeline\`; snapshots `op-pipeline-snapshots\`.
- Store layout: tracker at `op-pipeline\test-data\control-code-tracker.xlsx`, intake files under `op-pipeline\test-data\<CHANNEL>\<date>\`, counter at `op-pipeline\.intake-sequence-state.json`, marker `op-pipeline\store.json`.
- `store.json.files` uses workspace-relative names exactly: `test-data/control-code-tracker.xlsx`, `scripts/.intake-sequence-state.json`.
- robocopy exit codes 0–7 = success, ≥ 8 = failure. Copies use `/E` and never delete from the store; `save` excludes `*.lock`.
- Error texts (verbatim):
  - `No pipeline state found at <store path>. If this is the first run on this runner, re-run with initialize_state ticked.`
  - `Pipeline state is damaged: <comma-separated files> missing. Restore from <snapshots path> (README § Pipeline state on the runner).`
- Snapshots: newest 20 kept by default; folder name `yyyyMMdd-HHmmss-fff-run<N>` (milliseconds added to the spec's format so names sort and never collide).
- Workflow: `runs-on: [self-hosted, windows, op-pipeline]`; `concurrency: op-pipeline-state`; tracker artifact retention 30 days.
- Never upload intake files as artifacts. Never print secret values.

---

### Task 1: State script with dry-run tests

**Files:**
- Create: `.github/actions/pipeline-state/pipeline-state.tests.ps1`
- Create: `.github/actions/pipeline-state/pipeline-state.ps1`

**Interfaces:**
- Produces: `pipeline-state.ps1 -Mode <restore|save> [-Workspace <path>] [-StateRoot <path>] [-Initialize <'true'|'false'>] [-SnapshotKeep <int>] [-RunNumber <string>] [-RunUrl <string>]`. Exit code 0 on success, 1 on any failure (thrown message on stderr). `-Initialize` is a string because composite-action inputs arrive as text.

- [ ] **Step 1: Write the failing test script**

Create `.github/actions/pipeline-state/pipeline-state.tests.ps1`:

```powershell
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `powershell -NoProfile -ExecutionPolicy Bypass -File .github/actions/pipeline-state/pipeline-state.tests.ps1`
Expected: exit code 1 and `FAIL` lines — `pipeline-state.ps1` does not exist, so every run exits non-zero without the expected messages or files. (Only "empty root: nothing created" and "no store: save is refused" can pass, since a missing script also creates nothing.)

- [ ] **Step 3: Write the script**

Create `.github/actions/pipeline-state/pipeline-state.ps1`:

```powershell
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `powershell -NoProfile -ExecutionPolicy Bypass -File .github/actions/pipeline-state/pipeline-state.tests.ps1`
Expected: every line `PASS`, final line `All checks passed.`, exit code 0. Takes ~30 s (case 6 starts 22 processes).

If `tracker only: files lists the tracker alone` fails with a string instead of an array, `ConvertTo-Json` collapsed a one-element array: check `-InputObject` is used (not the pipeline) in `Write-StoreJson`.

- [ ] **Step 5: Commit**

```bash
git add .github/actions/pipeline-state/pipeline-state.ps1 .github/actions/pipeline-state/pipeline-state.tests.ps1
git commit -m "Add pipeline-state script to keep tracker state on the runner

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Composite action + workflow wiring

**Files:**
- Create: `.github/actions/pipeline-state/action.yml`
- Modify: `.github/workflows/op-intake-pipeline.yml` (inputs, `runs-on`, restore/save steps, tracker retention)

**Interfaces:**
- Consumes: `pipeline-state.ps1` parameters from Task 1.
- Produces: action `./.github/actions/pipeline-state` with inputs `mode` (required), `initialize` (default `'false'`), `state-root` (default `''`), `snapshot-keep` (default `'20'`). Future S3+ workflows call it the same way.

- [ ] **Step 1: Create the action**

Create `.github/actions/pipeline-state/action.yml`:

```yaml
name: Pipeline state
description: >-
  Restores or saves the OP pipeline's git-ignored state (tracker, intake
  files, filename counter) on the self-hosted runner between runs.
  See README § Pipeline state on the runner.

inputs:
  mode:
    description: 'restore (start of a run) or save (end of a run)'
    required: true
  initialize:
    description: 'restore only: create the state store if none exists (first run on a runner)'
    required: false
    default: 'false'
  state-root:
    description: 'Folder holding op-pipeline\ and op-pipeline-snapshots\. Empty = %USERPROFILE%\claims-qa-state'
    required: false
    default: ''
  snapshot-keep:
    description: 'restore only: snapshots kept after pruning'
    required: false
    default: '20'

runs:
  using: composite
  steps:
    - shell: powershell
      # Inputs go through env, not ${{ }} inside the script text, so a value
      # can never be read as PowerShell code.
      env:
        STATE_MODE: ${{ inputs.mode }}
        STATE_INITIALIZE: ${{ inputs.initialize }}
        STATE_ROOT: ${{ inputs.state-root }}
        STATE_SNAPSHOT_KEEP: ${{ inputs.snapshot-keep }}
      run: |
        & (Join-Path $env:GITHUB_ACTION_PATH 'pipeline-state.ps1') `
          -Mode $env:STATE_MODE `
          -Initialize $env:STATE_INITIALIZE `
          -StateRoot $env:STATE_ROOT `
          -SnapshotKeep ([int]$env:STATE_SNAPSHOT_KEEP) `
          -Workspace $env:GITHUB_WORKSPACE
        exit $LASTEXITCODE
```

- [ ] **Step 2: Add the `initialize_state` input**

In `.github/workflows/op-intake-pipeline.yml`, after the `payment_mode` input's `options` list (`          - UB`), add:

```yaml
      initialize_state:
        description: 'First run on this runner only: create the pipeline state store (README § Pipeline state on the runner)'
        type: boolean
        default: false
```

- [ ] **Step 3: Pin the runner and point the concurrency comment at the README**

Replace:

```yaml
# Every run reads and writes the same tracker and filename counter on the
# runner (see "Restore pipeline state") — two at once would overwrite each other.
```

with:

```yaml
# Every pipeline run reads and writes the same tracker and filename counter on
# the runner (README § Pipeline state on the runner) — two at once would
# overwrite each other. Future S3+ workflows join this same group.
```

Replace:

```yaml
    # Self-hosted Windows runner (AVD-BASCL06-0), same as playwright.yml.
    runs-on: [self-hosted, windows]
```

with:

```yaml
    # AVD-BASCL06-0 only: it holds the pipeline state. Any other runner would
    # start empty and reuse control codes, so the op-pipeline label pins it.
    runs-on: [self-hosted, windows, op-pipeline]
```

- [ ] **Step 4: Replace the inline restore step**

Replace the whole comment block and `Restore pipeline state` step (from `      # The pipeline's state is git-ignored, so checkout's clean (here and in` through its `          exit 0`) with:

```yaml
      # The pipeline's state (tracker, intake files, filename counter) is
      # git-ignored, so checkout's clean deletes it from the workspace on every
      # run; this keeps it on the runner between runs. Refuses to run when the
      # state is missing or damaged — README § Pipeline state on the runner.
      # No browser install: setup/api use channel msedge, the runner's own Edge.
      - name: Restore pipeline state
        id: restore
        uses: ./.github/actions/pipeline-state
        with:
          mode: restore
          initialize: ${{ inputs.initialize_state }}
```

- [ ] **Step 5: Replace the inline save step**

Replace the whole comment block and `Save pipeline state` step (from `      # Saved even when a step failed: the tracker records failures too, and` through its `          exit 0`) with:

```yaml
      # Saved even when a step failed: the tracker records failures too, and
      # the next run needs them. Only after a successful restore, so a run
      # that never loaded the state can't save an empty one over it.
      - name: Save pipeline state
        if: ${{ always() && steps.restore.outcome == 'success' }}
        uses: ./.github/actions/pipeline-state
        with:
          mode: save
```

- [ ] **Step 6: Keep the tracker artifact 30 days**

In the `Upload tracker` step, change `          retention-days: 7` to `          retention-days: 30`.

- [ ] **Step 7: Check the workflow by reading it**

No YAML linter is installed in this repo. Read the full `.github/workflows/op-intake-pipeline.yml` and check:
- `grep -n "USERPROFILE\|robocopy" .github/workflows/op-intake-pipeline.yml` prints nothing (the inline copies are gone).
- `grep -n "pipeline-state" .github/workflows/op-intake-pipeline.yml` prints exactly the two `uses:` lines plus the comment references.
- Every step is indented 6 spaces, its keys 8 spaces; no tab characters (`grep -nP "\t" .github/workflows/op-intake-pipeline.yml .github/actions/pipeline-state/action.yml` prints nothing).

The real validation is Task 4 step 1 on GitHub.

- [ ] **Step 8: Commit**

```bash
git add .github/actions/pipeline-state/action.yml .github/workflows/op-intake-pipeline.yml
git commit -m "Wire pipeline-state action into the OP intake workflow

Pins the workflow to the op-pipeline runner, adds initialize_state for
the first run, and keeps the tracker artifact 30 days.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Documentation

**Files:**
- Modify: `README.md` — new subsection at the end of § OP Teleconsultation pipeline & the Control Code Tracker, directly before `## Writing test specs`
- Modify: `CLAUDE.md` — one sentence in the **Control Code Tracker** paragraph
- Modify: `docs/superpowers/specs/2026-10-27-pipeline-state-retention-design.md` — snapshot folder name format

- [ ] **Step 1: Add the README section**

Insert before `## Writing test specs` in `README.md`:

````markdown
### Pipeline state on the runner

GitHub Actions keeps one tracker for every control code CI generates. The
[OP intake workflow](.github/workflows/op-intake-pipeline.yml) runs only on the
self-hosted runner labelled `op-pipeline` (AVD-BASCL06-0). Its
[pipeline-state action](.github/actions/pipeline-state/) copies the git-ignored state
in before the stages run and back out afterwards, even when a stage failed:

| Kept | Where on the runner (`%USERPROFILE%\claims-qa-state\`) |
|---|---|
| Tracker + intake files (`test-data/`) | `op-pipeline\test-data\` |
| Filename counter (`scripts/.intake-sequence-state.json`) | `op-pipeline\.intake-sequence-state.json` |
| What the last run saved, and which run | `op-pipeline\store.json` |
| Tracker + counter before each run, newest 20 | `op-pipeline-snapshots\<timestamp>-run<N>\` |

Local runs are not part of this: your machine keeps its own tracker. To see CI's, open a
run's summary (tracker status before and after) or download its `control-code-tracker`
artifact, kept 30 days.

**First run on a runner.** A run stops with "No pipeline state found" until the state
exists, because starting empty would restart the filename counter and reuse control
codes already uploaded. Run the workflow once with **initialize_state** ticked and
S0–S2 unticked. To carry existing codes over, first copy a local `test-data\` and
`scripts\.intake-sequence-state.json` into `op-pipeline\` on the runner.

**"Pipeline state is damaged".** A file the last run saved is gone. Restore it:

1. Make sure no pipeline workflow is running.
2. On the runner, copy `control-code-tracker.xlsx` from the newest good folder under
   `op-pipeline-snapshots\` into `op-pipeline\test-data\`, and
   `.intake-sequence-state.json` into `op-pipeline\`.
3. Run the workflow with S0–S2 unticked and check "Tracker status (before)".

The same steps roll back a run that wrote a bad tracker: use the snapshot taken before
that run.

To test the action without a runner:

```bash
powershell -NoProfile -ExecutionPolicy Bypass -File .github/actions/pipeline-state/pipeline-state.tests.ps1
```
````

- [ ] **Step 2: Point CLAUDE.md at it**

In `CLAUDE.md`, in the **Control Code Tracker** paragraph, after the sentence ending `No member names/codes go into the tracker.`, add:

```markdown
In GitHub Actions the tracker, intake files and filename counter are kept on the `op-pipeline` runner between runs by [.github/actions/pipeline-state](.github/actions/pipeline-state/) — any new pipeline workflow restores and saves through it (see [README.md](README.md) § Pipeline state on the runner).
```

- [ ] **Step 3: Update the spec's snapshot name**

In `docs/superpowers/specs/2026-10-27-pipeline-state-retention-design.md`, replace both occurrences of `20261027-143005-run42` with `20261027-143005-123-run42`, and replace `op-pipeline-snapshots\<yyyyMMdd-HHmmss>-run<N>\` with `op-pipeline-snapshots\<yyyyMMdd-HHmmss-fff>-run<N>\`.

- [ ] **Step 4: Check the README renders sensibly**

Run: `grep -n "Pipeline state on the runner" README.md CLAUDE.md .github/workflows/op-intake-pipeline.yml .github/actions/pipeline-state/*`
Expected: the README heading, plus references from CLAUDE.md, the workflow, `action.yml` and `pipeline-state.ps1` — every reference has a matching heading.

- [ ] **Step 5: Commit**

```bash
git add README.md CLAUDE.md docs/superpowers/specs/2026-10-27-pipeline-state-retention-design.md
git commit -m "Document pipeline state on the runner

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Verify on the runner (by a person with access)

Needs the workflow on `main` (a `workflow_dispatch` workflow only gets a Run button from the default branch) and the `op-pipeline` label on AVD-BASCL06-0. Run from **Actions → OP Intake Pipeline (S0-S2) → Run workflow**.

- [ ] **Step 1: Empty runner is refused**

Run with S0, S1, S2 unticked, `initialize_state` unticked.
Expected: fails at "Restore pipeline state" with `No pipeline state found at C:\Users\<runner user>\claims-qa-state\op-pipeline. …`; "Save pipeline state" is skipped.

- [ ] **Step 2: (Optional) Seed from local state**

On the runner, create `%USERPROFILE%\claims-qa-state\op-pipeline\` and copy a local `test-data\` into it and `scripts\.intake-sequence-state.json` to `op-pipeline\.intake-sequence-state.json`. Skip to start CI from an empty tracker.

- [ ] **Step 3: Initialize**

Same run with `initialize_state` ticked.
Expected: succeeds; log shows `Initialized new pipeline state at …`; `op-pipeline\store.json` exists; "Tracker status (before)" shows the seeded codes (or "No control codes yet").

- [ ] **Step 4: State carries over**

Same run again, `initialize_state` unticked.
Expected: succeeds; "Tracker status (before)" matches the previous run's "after"; one folder under `op-pipeline-snapshots\`.

- [ ] **Step 5: Real stages**

Run S0 only, then S1 only (each with `initialize_state` unticked).
Expected: after S0, new codes appear at S1 NOT_STARTED in "after"; the next run's "before" shows them; after S1 they move to S3 WAITING. `store.json` `files` lists both the tracker and the counter after S0.
