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
```

## Environment variables

| Variable | Value | Purpose |
|---|---|---|
| `TEST_DATABASE_URL` | `postgresql://postgres:postgres@localhost:5432/blueocean_test` | Points to the isolated test DB |
| `SES_DRY_RUN` | `true` | Prevents real SES sends — writes DB rows only |
| `SKIP_SNS_VERIFICATION` | `true` | Bypasses SNS signature check so fake webhook payloads are accepted |

## Test files

| File | Tests | What it calls |
|---|---|---|
| `pre-send.test.ts` | Pre-send gates + approval phase logic | `sendDraft()`, `shouldQueueForReview()` |
| `follow-up-sender.test.ts` | Initial send + follow-up sequence enforcement | `runFollowUpSender()` |
| `reply-scenarios.test.ts` | Full webhook reply pipeline across 4 timing scenarios | `POST /webhooks/ses/reply` via `app` |
| `self-improving.test.ts` | Spam complaint kill-switch + mutation runner | `POST /webhooks/ses/reply`, `runMutationRunner()` |

## Notes

- `follow-up-sender.test.ts` has a few tests that make real Claude Batch API calls (lazy content generation, angle tags). Set `ANTHROPIC_API_KEY` or those specific tests will fail.
- `self-improving.test.ts` mutation runner tests use `spyOn` to mock `generateMutation` — no Claude API needed there.
- The reply and self-improving tests use `SKIP_SNS_VERIFICATION=true` because the fake SNS envelopes in tests have a `Signature: "FAKE"` field that would fail real verification.
