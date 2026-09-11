# Code Review Guide

Before opening a PR (or any time you want a second opinion on uncommitted
work), run it through the **senior-qa** subagent instead of asking a human
first. It's read-only, cites `file:line` for every finding, and is grounded in
this repo's actual conventions — not generic Playwright advice.

## How to run it

```
/senior                              # review uncommitted changes (default)
/senior src/pages/login.page.ts      # review specific file(s)
/senior feature/my-branch-name       # review only what changed on that branch vs main
/senior coverage                     # find untested scenarios / gaps
/senior both                         # implementation review + coverage, in one pass
```

Nothing runs the Playwright suite. The agent cannot and will not execute tests,
so it never burns a real SSO login.

### Reviewing your own uncommitted work vs. reviewing a teammate's branch

These are two different invocations — know which one you want:

- **Bare `/senior`** diffs your **working tree against `HEAD`** (uncommitted
  changes only). If you run this against a branch that's already fully
  committed — i.e. any finished branch/PR — that diff is empty, and it falls
  back to a standing audit of `tests/` and `src/pages/` instead of "what
  changed." It does **not** scan the whole repository, but it's broader than
  you probably want for a PR review.
- **`/senior <branch-name>`** is what you want for "review what my teammate
  changed." It computes the changed-file list against `main` (via a read-only
  `git diff --name-only main...<branch>`) and reviews **only those files** —
  never the rest of the codebase. The agent only reads a `README.md` when a
  reviewed file's directory maps to one in its routing table (`CLAUDE.md`
  always, `src/base/README.md` for page-object/base changes, etc.) — never
  the whole doc set regardless of what changed.

## What you get back

A ranked findings report, most severe first:

| Severity | Meaning |
|---|---|
| **P0** | Blocking — merges a defect or a test that can't catch the bug it claims to catch |
| **P1** | Should fix now — real correctness/flakiness risk |
| **P2** | Should fix — convention or design issue, real but not urgent |
| **P3** | Note — polish, doc drift, minor readability |

Each finding names **what**, **why** (cited to a doc line, precedent, or
labeled `[engineering judgment]`), **evidence**, and a **proposed fix** — plus
a **Learn** line generalizing the mistake so it doesn't recur. It also closes
with a **"What's working"** section — don't skip that; it tells you what
pattern to keep repeating.

The agent never edits anything. Read the report, decide what to apply
yourself (or ask your Claude Code session to apply specific findings), and
don't let the human reviewer just rubber-stamp it — this is a first pass, not
a replacement for review.

## Before you even run it — self-check

These are the mistakes that keep recurring across reviews in this repo. Check
your own diff against this list first; it'll save you a review round-trip.

### Logging honesty
- If a wrapped method returns a value the caller branches on (a `boolean`
  predicate especially), the `passMessage` **must be a function of the
  result** — never a static string. A static pass message on a predicate
  method silently states the opposite of what it returned, and that line
  ends up in the HTML report, the trace, *and* the failure dump on an
  unrelated crash.
- Never interpolate a credential, token, or identity field (email, member
  number) into a log/step message unmasked — `ElementActions.fill()`'s
  `{ mask: true }` only covers its own message, not a `logger.step()` label
  you build yourself.

### Option types and timeouts
- Never hand-write an inline option type (`{ timeout?: number }`) in a
  wrapper — derive it from the installed Playwright API in
  `locator-types.config.ts` / `page-types.config.ts` via `Parameters<...>`.
  This is the mechanism that would have caught `isVisible()`/`isHidden()`
  silently ignoring their `timeout` option — Playwright deprecates it, and a
  hand-rolled type hides that fact.
- Before accepting a `timeout` on any wrapper, check whether the underlying
  Playwright method actually waits. Some don't (`isVisible`, `isHidden`).
  Accepting an option the callee ignores is worse than not exposing it — the
  caller writes code that depends on a promise you can't keep.
- A "soft wait" that catches *every* error to report "didn't appear" is
  masking real failures (strict-mode violations, closed pages, bad
  selectors) as "the optional element wasn't there." Catch the specific
  timeout error class only; let everything else propagate.

### Assertions that can't fail
- Ask of every assertion: **if the app were broken in the most likely way,
  would this definitely fail?** Negative/exclusionary assertions ("URL
  doesn't contain X", "not on the login page") usually pass for the wrong
  reasons — the set of ways to *not* be somewhere is unbounded. Prefer
  asserting the positive destination or a concrete signed-in element.
- Don't assert a value you had to recompute from the test runner's own
  environment (locale-formatted dates, client timezone). Every environmental
  input is a new way the test can fail while the product is correct. Prefer
  a shape/regex check over an exact recomputed string.
- If a test's comment describes conditional behavior ("may expand", "only
  shown when..."), make sure the test actually exercises the condition
  rather than just asserting the end state — otherwise it either always
  fails or proves nothing about the transition.

### Locators & synchronization
- Scope every locator to something that can't collide as the app grows.
  Prefer `getByRole`/stable ids over CSS built from SVG path data, class
  names, or other presentation details that redraw or duplicate.
- Never drive a UI toggle ("open the menu") by blindly clicking — check the
  current state first (`isVisible`), act only if needed, then wait for the
  target state. Otherwise correctness depends on wherever the DOM happened
  to be left by a previous action.
- No raw `locator.waitFor().then().catch()` (or any raw `Locator`/`Page`
  call) inside a page object — it produces no log line and no report step,
  which is exactly the coverage you lose at the moment you need it most (an
  intermittent, hard-to-repro screen). If the wrapper layer doesn't have the
  primitive you need, add it there — don't reach around it.

### Test scope and titling
- A test's title is a claim about what its failure means. If a test grows to
  cover multiple unrelated features, split it — a nav-menu bug reported as
  "Successful login failed" costs someone real debugging time.
- Watch the timeout budget as a test accumulates phases. A test built for one
  flow's worth of waits will start failing on the sum of all of them, and a
  timeout failure looks identical to a real regression in the report.
- Never construct a page object inline in a spec (`new SomePage(...)`) —
  register it as a fixture in `base.fixture.ts`. If the page's `Page`
  instance only exists mid-test (e.g. from a popup), that's a sign you need
  a **factory fixture** (`(page) => new SomePage(page)`), not a excuse to
  skip registration.

### Reuse before adding
- Before writing a new method on `ElementActions`, `ElementAssertions`,
  `GenericAssertions`, or a page object, grep `src/base/` and `src/pages/`
  for something that already does the job under a different name. A review
  scoped to your diff can't catch this on its own — nothing inside a diff
  contradicts itself just because it duplicates code sitting outside it. The
  reviewer now explicitly checks new methods against the rest of the
  codebase for this (not just against the files you changed), but it's
  cheaper to catch before you write the second copy than after.

### Docs
- If your change adds a fixture, an endpoint, or a convention, update the
  relevant `README.md` in the same commit. A stale fixture table is how the
  next person duplicates something that already exists.

## Coverage reports now use a fixed scenario taxonomy

`/senior coverage` classifies every existing and proposed test into exactly
one of five types — **Happy Path, Negative, Boundary, Business Rule,
Alternative Flow** — and reports coverage per type instead of one flat
verdict per flow. A flow can be fully covered on Happy Path and completely
uncovered on Negative; the old flat "partially covered" verdict hid which
half was missing. Recommended next tests also name their type and, if the
project is already using tags (see below), a suggested tag.

## Tagging tests

Playwright's native `tag` option (`test('...', { tag: ['@smoke'] }, ...)`,
filterable with `npx playwright test --grep @smoke`) is documented as an
**optional** convention in `README.md` § Tagging tests, using a fixed set:
`@smoke`, `@regression`, `@critical`, `@wip`. Tagging a test is never
required and an untagged test is never a review finding — but if you do tag
one, `/senior` checks it's from that set rather than a one-off invention.

## Tracking progress across re-reviews

Every `/senior` run (REVIEW or HYBRID) writes/updates a checklist at
`.claude/review-tracking/<branch-slug>.md` — one file per branch. It's how
"what's left to fix" and "did the team approve this" stay answerable without
re-reading every past report:

- **First run on a branch** creates the file, one checkbox per finding.
- **Every re-run** reconciles: a finding that's no longer raised gets checked
  off (`resolved <date>`), anything new gets appended. Nothing is ever
  silently deleted — it's a history, not a live mirror.
- **When zero points remain open**, the file flips to `Status: APPROVED ✅
  <date>` and `/senior` says so explicitly in its reply. That's the "the
  reviewer approves" signal — don't treat a clean-looking diff as approved on
  your own read; wait for that line, since only a real re-run can produce it.

To check progress **without** paying for a full re-review:

```
/review-status                       # progress on the current branch
/review-status feature/my-branch     # progress on a specific branch
```

This only reads the tracking file — it never re-invokes the reviewer. If the
branch has new commits since the last tracked `/senior` run, it'll tell you
the state may be stale rather than presenting old numbers as current. Treat
`/review-status` as "where did we leave off" and `/senior <branch>` as the
actual check — especially right before merging.

These tracking files are meant to be committed alongside the branch, so the
review state travels with the PR and teammates can see it without re-running
anything.

## When `/senior` isn't the right tool

The agent is read-only and single-shot — it can't have a conversation. For
"why do we do X" or "should we adopt Y" questions, ask in your normal Claude
Code session instead; those need back-and-forth, not a report.
