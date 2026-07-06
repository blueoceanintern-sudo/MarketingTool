# Backend Tests

Integration tests using `bun:test` against a real PostgreSQL database.

## How it works

Every test follows the same cycle:

```
wipe DB → seed minimal data → call function → assert DB state
```

`beforeEach` runs `resetTables()` then `seedBase()` before every single `it()` block, so each test starts from a completely blank slate. This prevents tests from interfering with each other — a suppression row seeded in test 1 won't accidentally cause test 2 to fail for the wrong reason.

The tests call **real service functions** against a real database, not mocks. This catches actual bugs: wrong SQL, missing joins, foreign key violations, incorrect row counts.

## Setup

1. Create a test database (separate from your dev DB):
   ```
   docker exec blueocean-pg psql -U postgres -c "CREATE DATABASE blueocean_test;"
   ```

2. Apply migrations:
   ```powershell
   $env:DATABASE_URL="postgresql://postgres:postgres@localhost:5432/blueocean_test"; bun run src/migrate.ts
   ```

## Running tests

```powershell
# Pre-send gates (no Claude API needed)
$env:TEST_DATABASE_URL="postgresql://postgres:postgres@localhost:5432/blueocean_test"; $env:SES_DRY_RUN="true"; bun test tests/pre-send.test.ts

# Follow-up sender
$env:TEST_DATABASE_URL="postgresql://postgres:postgres@localhost:5432/blueocean_test"; $env:SES_DRY_RUN="true"; bun test tests/follow-up-sender.test.ts

# Reply webhook scenarios
$env:TEST_DATABASE_URL="postgresql://postgres:postgres@localhost:5432/blueocean_test"; $env:SES_DRY_RUN="true"; $env:SKIP_SNS_VERIFICATION="true"; bun test tests/reply-scenarios.test.ts

# Self-improving templates (kill-switch + mutation runner)
$env:TEST_DATABASE_URL="postgresql://postgres:postgres@localhost:5432/blueocean_test"; $env:SES_DRY_RUN="true"; $env:SKIP_SNS_VERIFICATION="true"; bun test tests/self-improving.test.ts

# Reply classifier (live Claude API — no DB needed)
$env:ANTHROPIC_API_KEY="sk-ant-..."; bun test tests/reply-classifier.test.ts

# Drafting — thompsonSample only (no API, no DB)
$env:TEST_DATABASE_URL="postgresql://postgres:postgres@localhost:5432/blueocean_test"; bun test tests/drafting.test.ts --testNamePattern "thompsonSample"

# Drafting — full suite (live Claude API; generateFollowUpBatch uses Batch API and can take several minutes)
$env:TEST_DATABASE_URL="postgresql://postgres:postgres@localhost:5432/blueocean_test"; $env:ANTHROPIC_API_KEY="sk-ant-..."; bun test tests/drafting.test.ts

# Mutation (live Claude API)
$env:TEST_DATABASE_URL="postgresql://postgres:postgres@localhost:5432/blueocean_test"; $env:ANTHROPIC_API_KEY="sk-ant-..."; bun test tests/mutation.test.ts
```

## Environment variables

| Variable | Value | Purpose |
|---|---|---|
| `TEST_DATABASE_URL` | `postgresql://postgres:postgres@localhost:5432/blueocean_test` | Points to the isolated test DB — never touches your dev DB |
| `SES_DRY_RUN` | `true` | Prevents real SES sends — writes DB rows only |
| `SKIP_SNS_VERIFICATION` | `true` | Bypasses SNS signature check so fake webhook payloads are accepted |
| `ANTHROPIC_API_KEY` | `sk-ant-...` | Required for reply-classifier, drafting, and mutation tests |

## Test files

| File | Tests | What it calls | Needs API |
|---|---|---|---|
| `pre-send.test.ts` | Pre-send gates + approval phase logic | `sendDraft()`, `shouldQueueForReview()` | No |
| `follow-up-sender.test.ts` | Initial send + follow-up sequence enforcement | `runFollowUpSender()` | Partial* |
| `reply-scenarios.test.ts` | Full webhook reply pipeline across 4 timing scenarios + multi-campaign scoping | `POST /webhooks/ses/reply` via `app` | No |
| `self-improving.test.ts` | Spam complaint kill-switch (uses webhook) + mutation runner eligibility (calls worker directly) | `POST /webhooks/ses/reply` (kill-switch section), `runMutationRunner()` (mutation section) | No** |
| `reply-classifier.test.ts` | Reply classification — normal cases + edge cases | `classifyReply()` | Yes |
| `drafting.test.ts` | Thompson sampling (pure), initial draft generation + scoring, follow-up generation | `thompsonSample()`, `generateDraftsBatch()`, `generateFollowUpBatch()` | Partial*** |
| `mutation.test.ts` | Mutation generation — replace, refine, winner, middle-tier skip, not found | `generateMutation()` | Yes |

\* `follow-up-sender.test.ts`: the lazy content generation tests call the real Batch API. Set `ANTHROPIC_API_KEY` or those specific tests will fail.

\*\* `self-improving.test.ts`: mutation runner tests use `spyOn` to mock `generateMutation` — no Claude API needed.

\*\*\* `drafting.test.ts`: `thompsonSample` tests are pure and need no API. `generateDraftsBatch` and `generateFollowUpBatch` make live Claude calls. `generateFollowUpBatch` uses the Batch API and can take several minutes per test.

## Notes

- The reply and self-improving tests require `SKIP_SNS_VERIFICATION=true` because the fake SNS envelopes in tests carry `Signature: "FAKE"` which would fail real verification.
- `db/index.ts` prefers `TEST_DATABASE_URL` over `DATABASE_URL` — set `TEST_DATABASE_URL` in every test command to guarantee isolation from your dev DB.
- The `thompsonSample` tests in `drafting.test.ts` are pure functions — you can run them without any env vars to quickly verify the sampling logic in isolation.
