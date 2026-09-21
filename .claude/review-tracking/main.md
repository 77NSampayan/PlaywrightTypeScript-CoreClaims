# Review tracking — main

Last run: 2026-09-15 · Mode REVIEW · 6 open

## Findings
- [ ] P2 Both MSSQL smoke tests' assertions cannot fail (DB_NAME() always matches its own config); the read-only-account guarantee the DB design rests on is never verified — assert HAS_PERMS_BY_NAME(NULL,NULL,'INSERT') = 0 — `tests/Database.spec.ts:22-23,34-35, README.md:40-41`
- [ ] P2 Browser projects run at different viewports (msedge maximized, firefox/webkit fixed 1280x720) — cross-browser failures unattributable to engine vs viewport — `playwright.config.ts:121-123,140-160`
- [ ] P2 Membership distinctness guard only catches total env duplication (not partial), and silently no-ops instead of test.skip when unconfigured; no equivalent guard on data_enrichment side — `tests/Database.spec.ts:8-12,47-59`
- [ ] P3 CI workflow has no permissions: block, so npm ci's install scripts run with the repo-default (often read/write) GITHUB_TOKEN — `.github/workflows/playwright.yml:7-11`
- [ ] P3 dbConnection/membershipDbConnection fixtures are copy-paste twins — extract a dbFixture(config, label) factory — `src/fixtures/base.fixture.ts:105-117`
- [ ] P3 Stale "API client" comment leftover from commented-out authentication fixture; landingPage indented/placed inconsistently with other page-object fixtures — `src/fixtures/base.fixture.ts:73,129`

## Resolved
- [x] P2 Both MSSQL smoke tests pass against any reachable SQL Server, cannot tell the two databases apart (resolved 2026-09-15) — `tests/Database.spec.ts:12-18, 24-30`
- [x] P2 SQLite spec asserts back the rows its own fixture just inserted (resolved 2026-09-15 — retitled + tagged @wip) — `tests/Database.spec.ts:38-45`
- [x] P2 DB-only specs run 3x across browser projects and force a headed browser launch they never use (resolved 2026-09-15 — `db` project + testIgnore, configInfo no longer depends on `{ browser }`) — `playwright.config.ts:125-141, src/fixtures/base.fixture.ts:29`
- [x] P2 README.md / src/fixtures/README.md described the pre-DB world (resolved 2026-09-15 — both updated) — `README.md:34-43, src/fixtures/README.md:13-18`
- [x] P3 Port getters treat an empty env var as 0, inconsistently with requireEnv (resolved 2026-09-15 — optionalPort() helper) — `playwright.config.ts:55, 74`
- [x] P3 Spec constructs GenericAssertions inline — signals a missing assert fixture (resolved 2026-09-15 — assert fixture added) — `tests/Database.spec.ts:7`
- [x] P3 DbConnection.query() and SqliteWasmConnection.query() return incompatible shapes (resolved 2026-09-15 — both return T[], full result via queryRaw()) — `src/utils/db.util.ts:51, 101`
- [x] P0 playwright-report.zip's underlying .gitignore gap (resolved 2026-09-15 — playwright-report*.zip added, confirmed matching at root) — `.gitignore`
- [x] P2 DB fixtures set up before the logger fixture, logs land in wrong test context (resolved 2026-09-15 — dbConnection/membershipDbConnection/sqliteConnection now depend on `{ logger }`) — `src/fixtures/base.fixture.ts:97-118`
- [x] P2 CLAUDE.md's Commands + Environment sections described the pre-change world (resolved 2026-09-15 — confirmed fully current) — `CLAUDE.md:14, 17, 18, 43-44, 52`
- [x] P3 query()/queryRaw() had no parameter binding (resolved 2026-09-15 — params bag added, values kept out of log message) — `src/utils/db.util.ts:52-69, 108-119`
- [x] P0 CI ran the full live-SSO suite on every push/PR (resolved 2026-09-15 — workflow now runs only tsc --noEmit + playwright test --list, no browsers, no secrets, no live SSO) — `.github/workflows/playwright.yml:21`
- [x] P1 CI uploaded playwright-report/ with traces of an authenticated session as a 30-day artifact (resolved 2026-09-15 — artifact upload step removed entirely) — `.github/workflows/playwright.yml:22-27`
- [x] P2 @wip tests were not excluded from CI (resolved 2026-09-15 — moot, no tests run at all now) — `.github/workflows/playwright.yml:21`
- [x] P3 Membership connectivity test passed even if both DB configs pointed at the same database — full-duplication case now caught (resolved 2026-09-15, though re-reviewed as too narrow — see open item above re: partial mismatches) — `tests/Database.spec.ts:25`
- [x] P3 await on four synchronous void logger calls, plus == where precedence is non-obvious (resolved 2026-09-15 — awaits dropped, === used) — `src/fixtures/base.fixture.ts:43,58,74,79`
- [x] P3 `as T[]` cast makes SqliteWasmConnection.query()'s generic unenforceable (resolved 2026-09-15 — explanatory comment added, confirmed a reasonable resolution) — `src/utils/db.util.ts:131` (now `:134`)
- [x] P2 Green "Playwright Tests" CI check name misleads readers into thinking the suite passed (resolved 2026-09-15 — renamed to "Static checks (no test execution)" / typecheck-and-list) — `.github/workflows/playwright.yml:1,8`
- [x] P2 README promised BASE_URL fails loudly at startup; config never checked it (resolved 2026-09-15 — baseURL now requireEnv('BASE_URL'), fixture banner and CI placeholder updated) — `README.md:44-47, playwright.config.ts:112`
- [x] P3 "Same shape" contract between DbConnection and SqliteWasmConnection enforced by comment only (resolved 2026-09-15 — ReadableDb interface, both classes implement it) — `src/utils/db.util.ts:51,124`
