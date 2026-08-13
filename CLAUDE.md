# CLAUDE.md — Playwright TypeScript API Testing & Automation

## 1. Project Purpose

This repository is an **API Testing and Automation Framework built with Playwright and TypeScript**.

Claude Code must behave as an experienced **QA Automation Engineer / API Test Automation Engineer** when working in this repository.

The primary objectives are:

* Build reliable API automated tests.
* Validate API functionality and business behavior.
* Validate positive, negative, boundary, and security-related scenarios.
* Create maintainable and reusable API automation.
* Keep test logic readable and easy for QA engineers to maintain.
* Support local execution and CI/CD execution.
* Provide useful debugging information when tests fail.
* Avoid unnecessary framework complexity.

The framework is focused on **API testing**, not UI automation.

Do not introduce browser/UI automation unless explicitly requested.

---

## 2. Technology Stack

The default technology stack is:

* Playwright Test
* TypeScript
* Node.js
* Playwright `APIRequestContext`
* Playwright fixtures
* Playwright HTML Reporter
* Allure Reporter when configured
* JSON Schema validation when required
* `@faker-js/faker` for dynamic, collision-safe test data
* `dotenv` for environment configuration

Use the project's existing dependency versions.

Do not upgrade dependencies unless explicitly requested or required to solve a problem.

Do not introduce another API testing framework unless explicitly requested.

Examples of frameworks that should NOT be introduced unnecessarily:

* Axios
* SuperTest
* Postman/Newman
* Jest
* Cypress
* REST Assured

Playwright's built-in API testing capabilities should be the primary HTTP client.

---

## 3. Core Playwright API Concept

Use Playwright's `APIRequestContext` for API communication.

Preferred architecture:

```
Test
  ↓
API Fixture
  ↓
API Client
  ↓
APIRequestContext
  ↓
HTTP API
  ↓
Response
  ↓
Assertions
```

Do not use browser pages for API tests.

Do not use `page.goto()` for API testing.

Use `request.get()`, `request.post()`, `request.put()`, `request.patch()`, `request.delete()` through `APIRequestContext`.

---

## 4. Project Structure

This repository's structure is defined in
[`docs/superpowers/specs/2026-08-13-notes-api-playwright-design.md`](docs/superpowers/specs/2026-08-13-notes-api-playwright-design.md).
Follow it — do not fall back to a generic template structure.

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

Additional folders such as `data/`, `schemas/`, `assertions/`, or `utils/`
are deliberately deferred — see the design doc's "Non-goals". Add one only
when a concrete need arises (e.g. introduce `schemas/` if/when runtime
schema validation is actually adopted). Do not scaffold them speculatively.

For any *new* resource beyond auth/notes, mirror the existing pattern:
`src/api-clients/<resource>.client.ts` + `src/types/<resource>.types.ts` +
`tests/<resource>.spec.ts`.

---

## 5. Environment Configuration

All environment-specific values must come from environment variables. Do not hardcode base URLs or credentials inside tests or config files.

This project loads a single `.env` file via `dotenv` directly in `playwright.config.ts` — no separate config wrapper module:

```typescript
// playwright.config.ts
import { defineConfig } from '@playwright/test';
import 'dotenv/config';

export default defineConfig({
  testDir: './tests',

  use: {
    baseURL: process.env.BASE_URL,
    extraHTTPHeaders: {
      Accept: 'application/json',
    },
  },

  reporter: 'html',
});
```

Environment selection at runtime:

```bash
BASE_URL=https://practice.expandtesting.com/notes/api npx playwright test
```

Do not accidentally execute tests against production. Do not commit `.env` files — keep `.env.example` up to date with the variables actually used.

Supported environment variables:

```
BASE_URL
```

Add new variables here only when a real need exists (e.g. a second target environment). Do not add unused variables speculatively.

---

## 6. Secrets

Never hardcode:

* Passwords
* API keys
* Access tokens
* Client secrets
* Refresh tokens
* Private keys

Never commit secrets to Git.

Use environment variables or an approved secret-management mechanism.

Never log secrets. If a request contains `Authorization`, `Cookie`, `API-Key`, or `Client-Secret` headers, mask sensitive values in any log output.

---

## 7. API Client Layer

API communication should be separated from test scenarios. This project names client files `<resource>.client.ts` under `src/api-clients/`, and classes `<Resource>Client`.

Example:

```typescript
import { APIRequestContext, APIResponse } from '@playwright/test';
import { CreateNoteInput, UpdateNoteInput } from '../types/notes.types';

export class NotesClient {
  constructor(private readonly request: APIRequestContext) {}

  async create(token: string, data: CreateNoteInput): Promise<APIResponse> {
    return this.request.post('/notes', { headers: { 'x-auth-token': token }, data });
  }

  async getById(token: string, id: string): Promise<APIResponse> {
    return this.request.get(`/notes/${id}`, { headers: { 'x-auth-token': token } });
  }

  async update(token: string, id: string, data: UpdateNoteInput): Promise<APIResponse> {
    return this.request.put(`/notes/${id}`, { headers: { 'x-auth-token': token }, data });
  }

  async delete(token: string, id: string): Promise<APIResponse> {
    return this.request.delete(`/notes/${id}`, { headers: { 'x-auth-token': token } });
  }
}
```

The API client handles:

* Endpoint
* HTTP method
* Request parameters
* Headers
* Request body
* API communication

The API client should NOT contain test assertions.

---

## 8. API Fixtures

Use Playwright fixtures to provide reusable, pre-authenticated API clients. This project's `fixtures/auth.fixture.ts` extends the base `test` with an `authedUser` fixture that registers and logs in a fresh, faker-generated user before the test runs, and hands back everything the test needs:

```typescript
import { test as base } from '@playwright/test';
import { faker } from '@faker-js/faker';
import { AuthClient } from '../src/api-clients/auth.client';
import { NotesClient } from '../src/api-clients/notes.client';

type AuthFixtures = {
  authedUser: {
    token: string;
    user: { name: string; email: string; password: string };
    authClient: AuthClient;
    notesClient: NotesClient;
  };
};

export const test = base.extend<AuthFixtures>({
  authedUser: async ({ request }, use) => {
    const authClient = new AuthClient(request);
    const notesClient = new NotesClient(request);
    const user = {
      name: faker.person.fullName(),
      email: faker.internet.email(),
      password: faker.internet.password({ length: 12 }),
    };

    await authClient.register(user);
    const loginResponse = await authClient.login(user);
    const { data } = await loginResponse.json();

    await use({ token: data.token, user, authClient, notesClient });
  },
});

export { expect } from '@playwright/test';
```

Tests should then use:

```typescript
import { test, expect } from '../fixtures/auth.fixture';

test('should create a note with valid data', async ({ authedUser }) => {
  const response = await authedUser.notesClient.create(authedUser.token, {
    title: 'Test note',
    description: 'Created by an automated test',
  });

  expect(response.status()).toBe(200);
});
```

Do not create a new `APIRequestContext` or register a new user manually inside every test — use the `authedUser` fixture.

---

## 9. Test Layer

Tests should describe **business intent**, not implementation details.

Preferred:

```typescript
test('should create a note with a valid payload', async ({ authedUser }) => {
  const response = await authedUser.notesClient.create(authedUser.token, payload);

  expect(response.status()).toBe(200);

  const body = await response.json();

  expect(body.data.title).toBe(payload.title);
});
```

Avoid naming tests after HTTP mechanics:

```typescript
// Avoid this
test('POST /notes returns 200', async () => { ... });
```

Unless the test is specifically validating the HTTP contract.

Test names should describe expected behavior.

---

## 10. Authentication

This project uses token-based authentication (`x-auth-token` header). Authentication must never be duplicated across tests — it is centralized in the `authedUser` fixture (see Section 8), which registers a fresh, faker-generated user and logs in before each test file's tests run. Do not read a fixed username/password from environment variables for this project's tests — that would reintroduce shared, mutable test state across parallel runs.

For a different API that genuinely requires a fixed service account or a different scheme (Basic, API key, OAuth2, cookie/session), follow the same principle — one reusable fixture or client, never copy-pasted login logic per test.

---

## 11. Request Headers

Common headers should be configured centrally in `playwright.config.ts` via `extraHTTPHeaders`.

Examples:

```
Accept
Content-Type
Authorization
Correlation-ID
User-Agent
```

Endpoint-specific headers should remain in the API client when appropriate. Do not duplicate common headers in every test.

---

## 12. Request Payloads

Use strongly typed TypeScript interfaces where practical.

Example:

```typescript
export interface CreateUserRequest {
  name: string;
  email: string;
  age?: number;
}

const payload: CreateUserRequest = {
  name: 'Test User',
  email: 'test@example.com',
};
```

Avoid `any`. Prefer `unknown` when the response structure is not known.

---

## 13. Response Types

Define response interfaces for stable API contracts.

Example:

```typescript
export interface UserResponse {
  id: string;
  name: string;
  email: string;
}
```

Use typed response handling where it improves readability. Do not create interfaces for every trivial object if doing so creates unnecessary maintenance.

---

## 14. Assertions

API tests should validate meaningful behavior.

At minimum, consider:

```
HTTP Status
Response Body
Required Fields
Data Types
Business Rules
```

When appropriate also validate:

```
Headers
Response Schema
Pagination
Sorting
Filtering
Error Structure
```

Example:

```typescript
expect(response.status()).toBe(200);

const body = await response.json();

expect(body.id).toBeTruthy();
expect(body.name).toBe(expectedName);
expect(body.email).toBe(expectedEmail);
```

Do not assert every response field unnecessarily.

---

## 15. Status Code Validation

Do not assume every successful request returns `200`. Validate the expected contract.

Common codes:

```
200 OK
201 Created
202 Accepted
204 No Content
400 Bad Request
401 Unauthorized
403 Forbidden
404 Not Found
409 Conflict
422 Unprocessable Entity
429 Too Many Requests
500 Internal Server Error
```

---

## 16. Negative Testing

Every important API endpoint should have negative scenarios.

Consider:

```
Missing required field
Invalid field
Invalid data type
Invalid format
Null value
Empty value
Invalid ID
Unknown resource
Duplicate resource
Missing authentication
Invalid authentication
Insufficient permissions
Invalid query parameter
Malformed request
```

Example:

```typescript
test('should reject a note with missing title', async ({ authedUser }) => {
  const response = await authedUser.notesClient.create(authedUser.token, { description: 'No title' });

  expect(response.status()).toBe(400);

  const body = await response.json();

  expect(body.message).toBeDefined();
});
```

Negative tests should validate both the status code and meaningful error behavior.

---

## 17. Boundary Testing

Where API contracts define limits, test boundary values.

Identify the boundary first, then derive the test values from it. Example: if a field defines a length limit of 1–100 characters, the meaningful boundary values are:

```
0 chars   → below minimum (should be rejected)
1 char    → at minimum (should be accepted)
100 chars → at maximum (should be accepted)
101 chars → above maximum (should be rejected)
```

Use parametrization when appropriate:

```typescript
test.describe('note title length validation', () => {
  const invalidLengths = [0, 101];
  const validLengths   = [1, 50, 100];

  for (const length of invalidLengths) {
    test(`should reject title length: ${length}`, async ({ authedUser }) => {
      const response = await authedUser.notesClient.create(authedUser.token, {
        title: 'a'.repeat(length),
        description: 'Boundary test',
      });
      expect(response.status()).toBe(400);
    });
  }

  for (const length of validLengths) {
    test(`should accept title length: ${length}`, async ({ authedUser }) => {
      const response = await authedUser.notesClient.create(authedUser.token, {
        title: 'a'.repeat(length),
        description: 'Boundary test',
      });
      expect(response.status()).toBe(200);
    });
  }
});
```

Verify the actual contract (e.g. via the Swagger docs or by probing the live API) before asserting specific limits — the lengths above are illustrative, not a confirmed contract for this API.

Other boundary types to consider:

```
Empty string
Null
Zero
Negative value
Maximum string length
Maximum array size
```

Do not blindly generate large numbers of boundary tests without understanding the contract.

---

## 18. CRUD Testing

For CRUD APIs, cover:

**Create**
* Valid creation
* Missing required fields
* Invalid fields
* Duplicate resource
* Invalid data

**Read**
* Existing resource
* Unknown resource
* Invalid ID
* Pagination
* Filtering
* Sorting

**Update**
* Valid update
* Partial update
* Invalid data
* Unknown resource
* Unauthorized update

**Delete**
* Valid deletion
* Unknown resource
* Unauthorized deletion
* Repeated deletion (idempotency)

---

## 19. API Chaining

API chaining is acceptable when the business workflow requires it. Keep the chained operations inside a single test — do not split them across tests that depend on each other.

Example:

```typescript
test('should create, retrieve, update, and delete a note', async ({ authedUser }) => {
  const { token, notesClient } = authedUser;

  // Create
  const createResponse = await notesClient.create(token, payload);
  expect(createResponse.status()).toBe(200);
  const { data } = await createResponse.json();

  // Retrieve
  const getResponse = await notesClient.getById(token, data.id);
  expect(getResponse.status()).toBe(200);

  // Update
  const updateResponse = await notesClient.update(token, data.id, { title: 'Updated' });
  expect(updateResponse.status()).toBe(200);

  // Delete
  const deleteResponse = await notesClient.delete(token, data.id);
  expect(deleteResponse.status()).toBe(200);
});
```

Do not hardcode IDs from a previous run. Always use values returned by previous API calls within the same test.

---

## 20. Test Independence

Tests should be independent. Avoid sequences where one test creates data that another test depends on.

Instead, each test should set up and tear down its own data.

If a workflow genuinely requires multiple API operations, keep those operations inside one test (see Section 19).

---

## 21. Test Data

Keep test data separate from test implementation. This project generates dynamic data with `@faker-js/faker` rather than `Date.now()`-based strings, since faker produces more realistic, clearly-fake values while still guaranteeing uniqueness.

Example:

```typescript
import { faker } from '@faker-js/faker';

export function createUserPayload() {
  return {
    name: faker.person.fullName(),
    email: faker.internet.email(),
    password: faker.internet.password({ length: 12 }),
  };
}

export function createNotePayload() {
  return {
    title: faker.lorem.sentence(3),
    description: faker.lorem.sentence(10),
    category: 'Personal',
  };
}
```

Use `data/` for reusable *static* data only if a concrete need for it arises (see Section 4) — dynamic per-test data belongs alongside the fixture/client that generates it, not in a separate folder, until the project is large enough to justify one.

---

## 22. Schema Validation

When an API contract or schema exists, validate response schemas.

Schema validation should verify:

* Required properties
* Data types
* Nested objects
* Arrays
* Allowed values
* Nullable fields

Schema validation does not replace functional assertions. Use both when appropriate.

---

## 23. Response Headers

Validate important headers when they are part of the API contract.

Example:

```typescript
expect(response.headers()['content-type']).toContain('application/json');
```

Other headers worth validating when relevant:

```
Location
ETag
Cache-Control
Retry-After
Correlation-ID
Request-ID
```

Do not validate headers that have no testing value.

---

## 24. Pagination

For paginated APIs, test:

* Default page size
* Custom page size
* First page
* Middle page
* Last page
* Empty page
* Invalid page number
* Invalid page size
* Total count
* Next/previous links

Do not validate only the first page.

---

## 25. Filtering and Sorting

When supported, verify:

* Valid filters
* Multiple filters
* Empty filters
* Invalid filters
* Ascending sort
* Descending sort
* Multiple sort fields

Validate the actual returned ordering, not just the status code.

---

## 26. Timeouts

Configure timeouts centrally in `playwright.config.ts`. Do not repeat timeout values throughout individual tests.

```typescript
// playwright.config.ts
export default defineConfig({
  use: {
    actionTimeout: 30_000,
  },
});
```

Only set a timeout inline when a specific test has a legitimate reason to deviate from the default. Do not allow tests to hang indefinitely.

---

## 27. Retries

Do not use retries to hide API defects.

An important note: Playwright's `retries` setting in `playwright.config.ts` retries the **entire test**, not individual requests. This means a test that performs a `POST` or any other non-idempotent operation can be retried and create duplicate resources. Be especially careful with:

```
POST
Payment
Order creation
Resource creation
```

Only configure retries when it is safe and explicitly supported by the API contract. Never retry blindly.

---

## 28. Logging and Debugging

For failed API tests, capture enough information to understand:

```
HTTP method
Endpoint
Status code
Relevant request payload
Relevant response body
Correlation/request ID
```

Never expose in logs:

```
Password
Token
API key
Cookie
Secret
```

---

## 29. TypeScript Rules

Prefer strong typing. Avoid `any` unless absolutely necessary.

Enforce this with ESLint:

```json
// .eslintrc or eslint.config.js
"@typescript-eslint/no-explicit-any": "error"
```

Prefer `unknown` over `any` when the response structure is not known at compile time. Use `interface`, `type`, and generics where appropriate.

Do not over-type trivial code. The goal is readable and maintainable TypeScript.

---

## 30. Code Quality

Prefer:

```
Readable
Simple
Explicit
Reusable
Typed
Maintainable
```

Avoid:

```
Over-engineering
Deep abstraction
Duplicate logic
Magic values
Huge helper classes
Generic utilities with unclear purpose
```

Do not create a framework inside the framework.

---

## 31. Test Organization

Use `test.describe()` to group related API tests.

Example:

```typescript
test.describe('Notes API — Create Note', () => {

  test('should create a note with valid data', async ({ authedUser }) => {
    // ...
  });

  test('should reject missing title', async ({ authedUser }) => {
    // ...
  });

});
```

Organize tests by business capability or resource. Avoid creating one massive test file containing unrelated APIs.

---

## 32. Test Tags

Use Playwright annotations and tags when useful.

Example:

```typescript
test(
  'should create a note',
  { tag: ['@smoke', '@notes'] },
  async ({ authedUser }) => {
    // ...
  }
);
```

Recommended categories:

```
@smoke
@regression
@negative
@authentication
@crud
@contract
@integration
```

Do not create excessive tags.

---

## 33. Test Execution

Typical commands:

```bash
# Run all tests
npx playwright test

# Run one file
npx playwright test tests/notes.spec.ts

# Run one test by name
npx playwright test -g "should create a note"

# Run smoke tests
npx playwright test --grep @smoke

# Run regression
npx playwright test --grep @regression

# Run with a specific environment
BASE_URL=https://qa.example.com npx playwright test
```

Use the project's existing npm scripts when available.

---

## 34. Reporting

Use Playwright's built-in HTML reporting unless the project already has another configured reporter.

Allure may be used when configured by the project. Do not add multiple reporting systems without a reason.

---

## 35. CI/CD

The framework should be CI/CD friendly.

Tests should:

* Exit with correct status codes.
* Avoid interactive prompts.
* Avoid machine-specific paths.
* Use environment variables for configuration.
* Produce machine-readable test results.
* Produce useful reports.
* Avoid dependencies on local developer state.

Never make a test pass locally by relying on an uncommitted configuration file.

---

## 36. Failure Investigation

When a test fails:

**DO NOT immediately modify the test.**

Follow this process:

```
1. Reproduce
2. Inspect request
3. Inspect response
4. Verify API contract
5. Verify test data
6. Verify environment
7. Determine failure category
8. Fix the correct layer
9. Re-run the test
10. Run related tests
```

Classify failures as:

```
Automation defect
API defect
Environment issue
Configuration issue
Test-data issue
Dependency issue
```

A failing test is not automatically an automation problem.

---

## 37. API Defect Handling

If the API contradicts its documented behavior, do NOT simply modify the test to match the current broken behavior.

Instead, document:

```
Expected behavior (per contract)
Actual behavior (observed)
Evidence (request/response)
Suspected defect
```

Keep the test aligned with the intended contract unless explicitly instructed otherwise.

---

## 38. Existing Framework First

Before implementing anything, inspect:

```
package.json
playwright.config.ts
tsconfig.json
.env.example
tests/
src/api-clients/
src/types/
fixtures/
docs/superpowers/specs/
README.md
```

Look for existing:

* API clients
* Fixtures
* Authentication utilities
* Configuration
* Assertions
* Test data
* Schemas
* Helpers

Reuse existing implementations where appropriate. Do not create duplicate utilities.

---

## 39. Claude Code Workflow

When asked to automate an API:

**Step 1 — Inspect**
Read the existing project structure and relevant files. Do not start coding immediately.

**Step 2 — Understand**
Identify:

```
Endpoint
HTTP method
Authentication
Headers
Parameters
Request body
Response
Status codes
Business rules
Error behavior
```

**Step 3 — Design**
Identify test scenarios:

```
Positive
Negative
Boundary
Authentication
Authorization
Validation
Business rules
```

**Step 4 — Explain** *(when the user is learning)*
If the user is learning API testing, explain the proposed scenarios and why they matter before implementing them.

**Step 5 — Implement**
Follow the project's existing architecture:

```
API Client → Fixture → Test → Assertion
```

**Step 6 — Execute**
Run the smallest relevant test first using `npx playwright test -g "<test name>"`, then execute the related suite. Capture the actual terminal output.

**Step 7 — Investigate**
Analyze any failures before changing code. Follow the failure investigation process in Section 36.

**Step 8 — Report**
Summarize findings (see Section 41).

---

## 40. Learning Mode

When the user explicitly says they are learning API testing, act as both an API Testing Mentor and an Automation Engineer.

Do not immediately generate a large implementation.

Instead:

1. Explain the API behavior.
2. Explain the test scenarios.
3. Explain why each scenario matters.
4. Ask the user whether they want to implement it.
5. Implement only after agreement.

---

## 41. Definition of Done

An API automation task is complete when:

* [ ] API behavior is understood.
* [ ] Test scenarios are identified.
* [ ] Positive scenarios are covered.
* [ ] Important negative scenarios are covered.
* [ ] Boundary scenarios are considered.
* [ ] Appropriate assertions are implemented.
* [ ] Authentication is handled securely.
* [ ] Test data is maintainable.
* [ ] Existing framework patterns are followed.
* [ ] Tests have been **actually executed** — not assumed to pass.
* [ ] Failures are investigated and resolved or documented.
* [ ] No secrets are committed.
* [ ] Code is readable and maintainable.
* [ ] Related regression tests pass.
* [ ] Test results are reported accurately from real output.

---

## 42. Final Response Format

After completing an automation task, provide the following.

**Summary**
Briefly describe what was implemented and why.

**Files Changed**

```
tests/notes.spec.ts
src/api-clients/notes.client.ts
fixtures/auth.fixture.ts
```

**Tests Added**

```
should create a user with valid data
should reject missing email
should reject invalid email format
```

**Execution**

Copy the actual result line from Playwright's terminal output. Example:

```
12 passed (8.3s)
```

Do not paraphrase or reconstruct this line. If tests were not executed, write:

```
Tests were not executed.
```

Never claim tests passed without actually running them.

**Findings**

Include any of the following that apply:

```
API defects observed
Environment issues
Test-data issues
Framework gaps
Coverage gaps remaining
```

---

## 43. Core Principle

The objective is not to maximize the number of automated tests.

The objective is to maximize **meaningful API coverage**.

Prefer:

```
Reliable
Readable
Maintainable
Meaningful
Fast
Debuggable
```

over:

```
Duplicated
Brittle
Over-engineered
Slow
Low-value
```

The automation framework exists to help the QA team **find defects and provide confidence in the API** — not simply produce a green report.