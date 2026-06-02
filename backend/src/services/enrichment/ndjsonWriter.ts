import { open, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { EnrichmentRecord } from "./types";

const DEFAULT_PATH = "./data/enriched_leads.ndjson";

let writeChain: Promise<void> = Promise.resolve();

function path(): string {
  return process.env.ENRICHED_LEADS_PATH ?? DEFAULT_PATH;
}

export async function appendEnrichmentRecord(record: EnrichmentRecord): Promise<void> {
  const line = JSON.stringify(record) + "\n";
  const target = path();

  const next = writeChain.then(async () => {
    await mkdir(dirname(target), { recursive: true });
    const handle = await open(target, "a");
    try {
      await handle.appendFile(line, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
  });

  writeChain = next.catch((err) => {
    console.error("[ndjsonWriter] failed to append enrichment record:", err);
  });
  await next;
}
