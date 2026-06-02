import { isValidLeadEmail } from "./src/services/scrapers/emailFilter.ts";

// Prove facade passes — 6 hex chars, well under the 20-char threshold
const result = isValidLeadEmail("facade@company.com");
console.log(`facade@company.com → ${result ? "PASS ✓" : "FAIL ✗"}`);
console.log(`Expected: true, Got: ${result}`);

// Also verify the threshold boundary is correct
console.log("\n── Hex boundary ──");
const under20 = "abcdef1234567890123"; // 19 chars
const at20    = "abcdef12345678901234"; // 20 chars
console.log(`19 hex chars → ${isValidLeadEmail(`${under20}@company.com`) ? "PASS ✓" : "FAIL ✗"}  (should pass)`);
console.log(`20 hex chars → ${isValidLeadEmail(`${at20}@company.com`)    ? "PASS ✓" : "FAIL ✗"}  (should fail)`);
