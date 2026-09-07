---
description: Senior QA review — conventions or coverage gaps (read-only)
argument-hint: "[coverage] [path]  ·  bare = review uncommitted changes"
allowed-tools: Bash(git status:*), Bash(git diff --name-only:*), Bash(git diff --stat:*), Task
model: inherit
---

Arguments: $ARGUMENTS

Changed files (tracked):
!`git diff --name-only HEAD`

Untracked files:
!`git status --porcelain --untracked-files=all`

Diff size:
!`git diff --stat HEAD`

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
- otherwise → `Mode REVIEW. Target: <paths exactly as given>.`

Pass the file lists above through verbatim so the agent doesn't need git itself.

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
