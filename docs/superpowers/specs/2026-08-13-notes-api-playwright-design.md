# Notes API Playwright Test Automation — Design

## Purpose

Learn to automate API testing with Playwright (TypeScript), moving beyond
manual testing in Postman. The target is the public practice API at
https://practice.expandtesting.com/notes/api/api-docs/ (a "Notes" API with
user auth and notes CRUD), which the author already tests manually.

## Goals

- Cover the full flow already tested manually: user registration/login/
  profile/password management, and notes CRUD — all protected by a login
  token.
- Structure the project the way a small real-world API test framework would
  be structured (a thin client per resource, reusable auth setup), without
  introducing more concepts than necessary for a first project.
- Tests must be independent and safe to run in parallel — no shared mutable
  test account.

## Non-goals (for this first version)

- Full runtime schema validation (e.g. via zod) — plain TypeScript types are
  enough for now; can be added later.
- Data-driven test-case files (JSON/YAML-driven runs).
- CI pipeline — this is a learning project, not a deployed service; add a
  CI workflow later once the suite is stable.

## Architecture

Playwright Test in API-only mode (no browser) using the built-in `request`
fixture. TypeScript throughout.

```
├── playwright.config.ts
├── .env                      (BASE_URL, gitignored)
├── .env.example
├── tsconfig.json
├── package.json
├── src/
│   ├── api-clients/
│   │   ├── auth.client.ts    (register, login, profile, change/forgot/reset password, logout)
│   │   └── notes.client.ts   (create, getAll, getById, update, delete)
│   └── types/
│       ├── auth.types.ts
│       └── notes.types.ts
├── fixtures/
│   └── auth.fixture.ts       (custom Playwright fixture: fresh registered+logged-in user)
└── tests/
    ├── auth.spec.ts
    └── notes.spec.ts
```

## API client layer

One class per resource, one method per endpoint. Each method takes the
Playwright `APIRequestContext` plus typed params and returns the raw
`APIResponse` — assertions stay in the test files, not hidden inside the
client.

```ts
class NotesClient {
  constructor(private request: APIRequestContext) {}

  create(token: string, data: CreateNoteInput) {
    return this.request.post('/notes', { headers: { 'x-auth-token': token }, data });
  }
  getAll(token: string) { /* ... */ }
  getById(token: string, id: string) { /* ... */ }
  update(token: string, id: string, data: UpdateNoteInput) { /* ... */ }
  delete(token: string, id: string) { /* ... */ }
}
```

`AuthClient` mirrors this for `register`, `login`, `getProfile`,
`updateProfile`, `changePassword`, `forgotPassword`, `resetPassword`,
`logout`. Request/response shapes live in `src/types/` as plain interfaces.

## Auth fixture & test data strategy

A custom Playwright fixture (`fixtures/auth.fixture.ts`) extends the base
`test` with an `authedUser` fixture that, per test file:

1. Generates random user data with `@faker-js/faker` (name, unique email,
   password) — avoids collisions across parallel runs.
2. Calls `AuthClient.register()` then `AuthClient.login()` to get a token.
3. Hands the test `{ token, user, notesClient, authClient }` ready to use.

The fixture stays auth-only and generic. Tests that need a note to act on
(update/get/delete) create it themselves in a `test.beforeEach` inside
`notes.spec.ts`, using the token from the fixture — this keeps note setup
visible in the file where it's relevant instead of buried in shared setup.

## Test coverage

Each spec file mixes happy-path and negative cases:

- `auth.spec.ts`: register (success, duplicate email, missing fields),
  login (success, wrong password, unknown user), get/update profile
  (success, no token → 401), change password (success, wrong current
  password), forgot/reset password (success path), logout.
- `notes.spec.ts`: create (success, missing title/description → 400, no
  token → 401), get all (success, no token), get by id (success, wrong id →
  404, note belonging to another user → 403/404), update (success,
  unauthorized), delete (success, already-deleted → 404).

Assertions check status code plus key response fields (e.g. `success`,
`message`, `data.title`), not full-schema validation.

## Config & tooling

- `playwright.config.ts`: `use: { baseURL: process.env.BASE_URL }`, one
  project (no browsers), `reporter: 'html'`, retries off locally.
- `.env` / `.env.example`: `BASE_URL=https://practice.expandtesting.com/notes/api`,
  loaded via `dotenv` in the config.
- `package.json` scripts: `test` (`playwright test`), `test:report`
  (`playwright show-report`).
- Dev dependencies: `@playwright/test`, `typescript`, `@faker-js/faker`,
  `dotenv`.

## Testing the tests

Since the target is a live public API, "testing" here means running the
suite against it and confirming both happy-path and negative-case
assertions pass/fail as expected (e.g. deliberately breaking an assertion
once to confirm the test actually fails).
