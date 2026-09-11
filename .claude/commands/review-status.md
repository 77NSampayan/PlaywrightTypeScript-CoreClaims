---
description: Show /senior review progress — open vs resolved points, no fresh review run
argument-hint: "[branch-name]  ·  bare = current branch"
allowed-tools: Bash(git branch --show-current), Bash(git log:*), Read, Glob
model: inherit
---

Arguments: $ARGUMENTS

Current branch:
!`git branch --show-current`

---

Report progress from the **tracking file only** — do not invoke the
`senior-qa` subagent and do not read or re-review any source files. This
command answers "what's left from the last review", cheaply; it is not a
substitute for actually running `/senior` again.

1. **Resolve the target branch:** `$ARGUMENTS` if given, else the current
   branch shown above. Sanitize the same way `/senior` does: replace `/` with
   `-` to get the slug.

2. **Look for `.claude/review-tracking/<slug>.md`** (and `<slug>-coverage.md`
   if the user's phrasing mentions coverage, or both if unspecified — say
   which one(s) you're reporting on).
   - **Missing** → say plainly that no tracked `/senior` review exists for
     this branch, and suggest running `/senior <branch-name>` (or bare
     `/senior` if it's the current branch). Stop — do not guess at status.
   - **Present** → read it in full.

3. **Summarize, don't just paste the file:**
   - Status line first: `OPEN — N of M points resolved` or `APPROVED ✅ <date>`.
   - Open items grouped by severity (P1 before P2 before P3), each as
     `file:line — summary`.
   - If anything was resolved since the file was created, note the count and
     date range briefly — teammates asking "what's left" usually also want
     to know "how much progress was made."

4. **Staleness check.** Compare the tracking file's `Last run` date against
   the branch's latest commit: `git log -1 --format=%cI <branch-or-current>`.
   If the branch has commits after the tracked run, say explicitly that the
   tracked state may be stale — code has changed since the last `/senior`
   pass — and recommend re-running `/senior <branch-name>` before treating
   this as final, especially before merging on the strength of an "OPEN"
   count looking low or an old "APPROVED" line. Never present a stale
   APPROVED as current without this caveat.

5. **Never edit the tracking file.** This command is read-only; only
   `/senior` updates tracking state.
