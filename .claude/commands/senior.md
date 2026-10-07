---
description: Senior QA review — conventions, coverage gaps, or both (read-only)
argument-hint: "[coverage|both] [path|branch-name]  ·  bare = review uncommitted changes"
allowed-tools: Bash(git status:*), Bash(git diff --name-only:*), Bash(git diff --stat:*), Bash(git branch --show-current), Read, Write, Glob, Task
model: inherit
---

Arguments: $ARGUMENTS

Changed files (tracked):
!`git diff --name-only HEAD`

Untracked files:
!`git status --porcelain --untracked-files=all`

Diff size:
!`git diff --stat HEAD`

Current branch:
!`git branch --show-current`

---

Delegate this to the **senior-qa** subagent via the Task tool.

**Do not review anything yourself.** Do not read the target files, do not form
an opinion first, and do not pre-empt the agent's findings — the entire value
here is an independent read by an agent whose context isn't already anchored to
whatever we were just working on.

Build the agent's request using these rules:

- `$ARGUMENTS` empty → `Mode REVIEW. Target: the changed and untracked files
  listed above.` If both lists are empty, pass
  `Mode REVIEW. Working tree is clean — perform a standing audit of tests/ and src/pages/.`
- `$ARGUMENTS` starts with `coverage` → `Mode COVERAGE.` plus any remaining
  words as scope.
- `$ARGUMENTS` starts with `both`, or asks for a review *and* coverage in the
  same breath → `Mode HYBRID.` plus any remaining words as scope. Say
  explicitly that both an implementation review and a coverage analysis are
  wanted, since HYBRID is only entered on an explicit request.
- `$ARGUMENTS` names a git branch (not an existing file/dir path, not
  `coverage`/`both`) — e.g. a teammate's feature branch for PR review → `Mode
  REVIEW. Target: branch "<name>" — compute the changed-file list yourself
  with a read-only git diff against the base branch (try main, then master)
  — e.g. `git diff --name-only main...<name>` — and review only those files.
  If the branch isn't checked out locally, read each file's *content at that
  branch* (e.g. `git show <name>:<path>`) rather than the working tree, since
  the working tree may be on a different branch. Do not review anything
  outside that changed-file list.` This is the right invocation for "review
  what my teammate changed" — bare `/senior` cannot do this, since it only
  diffs against `HEAD` (uncommitted changes), which is empty once a branch is
  fully committed.
- otherwise → `Mode REVIEW. Target: <paths exactly as given>.`

Pass the file lists above through verbatim so the agent doesn't need git itself
for the default (no-argument) case. For a branch target, the agent computes
its own file list per the rule above — it already has read-only git diff in
its permitted command set.

**Do not pass diff content.** Pass file *paths* only. The agent must read the
files directly from disk, so that every `file:line` it cites is accurate and
clickable — an agent reconstructing absolute line numbers from `@@` hunk
headers reliably gets them wrong by a few lines, which makes its citations
untrustworthy exactly where precision matters most.

When the agent returns, **relay its report to the user unmodified.** Do not
summarise it, do not re-rank its findings, do not add your own, and do not
start fixing anything. The agent is deliberately read-only and the human
decides what to apply — if you helpfully summarise and then offer to implement,
you've collapsed the boundary that makes this useful.

If the user then asks you to apply a specific finding, that's a normal request
and you can act on it.

## Tracking file — update after every run

The subagent is stateless and one-shot; it has no memory of a prior review.
Progress tracking across runs is your job, done *after* you've relayed the
report unmodified — never let tracking bookkeeping change what you show the
user as the review result.

1. **Resolve the slug.** For a branch target (the rule above), use that
   branch name. Otherwise (bare invocation, or an explicit path target) use
   the current branch shown above. Sanitize: replace `/` with `-`. Mode
   COVERAGE/HYBRID runs get `-coverage` appended to the slug — coverage gaps
   ("add a test for X") are a different kind of checklist item than review
   defects ("fix X"), and mixing them in one file makes neither list trustworthy.

2. **File path:** `.claude/review-tracking/<slug>.md`. Create the directory
   if it doesn't exist.

3. **If the file doesn't exist**, create it from this run's findings:
   ```
   # Review tracking — <target>

   Last run: <YYYY-MM-DD> · Mode <REVIEW|COVERAGE|HYBRID> · <n> open

   ## Findings
   - [ ] P1 <short_summary> — `file:line`
   - [ ] P2 <short_summary> — `file:line`
   ```
   One checkbox line per finding, most severe first, using each finding's
   `short_summary`/summary and `file:line` exactly as the subagent reported
   them. If the report had zero findings, write `Status: APPROVED ✅
   <YYYY-MM-DD>` instead of a findings list, and say so plainly in your reply.

4. **If the file already exists**, this is a re-review — reconcile, don't
   overwrite:
   - For each existing unchecked item, check whether this run's report still
     raises it (match on `file:line`, or clearly the same underlying issue if
     the line shifted). If it's gone, check it off and append
     `(resolved <YYYY-MM-DD>)`.
   - Append any genuinely new findings from this run as new unchecked items.
   - **Never delete or uncheck a line yourself** — the checklist is a
     historical record, not a live mirror of the last report.
   - Update the `Last run` line.
   - If, after reconciling, **zero items remain unchecked**, set the status
     line to `Status: APPROVED ✅ <YYYY-MM-DD>` and say so explicitly and
     prominently in your reply to the user — this is the "senior review
     approves" signal your teammates are watching for. Do not say "approved"
     for any other reason (a clean first run with zero findings also counts,
     per step 3).

5. **After writing the file**, add one short line to your reply (after the
   relayed report, never replacing it): how many points were resolved since
   the last tracked run, how many remain open, and the tracking file's path —
   or the approval line from step 4/3 if it just flipped to APPROVED.

Use the `/review-status` command for progress checks. Do not use `/senior`
itself as the progress-reporting interface — it always does a full fresh
review before you get an answer, which is correct when you want a real check
but wasteful for "what's left."
