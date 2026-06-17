---
name: feedback_seed_defaults
description: Shipped/default data goes in seed.sql, not in application code seeding logic
metadata:
  type: feedback
---

Put shipped defaults in `seed.sql`, not as in-process seeding code.

**Why:** Keeps data management in one place (seed.sql) and avoids coupling startup/boot logic to data initialization. The seed file is already the established pattern for dev defaults.

**How to apply:** When adding new DB-backed config with default values, add INSERT statements to `backend/src/db/seed.sql` instead of writing a "seed if empty" function in the service layer. Also, never create migration SQL files directly — only update the Drizzle schema; the user runs `drizzle-kit generate` themselves.
