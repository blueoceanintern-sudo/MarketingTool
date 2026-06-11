import { client } from "../db";

// Job-completion events pushed to the frontend over SSE. They cross process
// boundaries via Postgres LISTEN/NOTIFY (no Redis), so a triggered job emits
// and every API process delivers it to its connected browsers.
export type JobEvent =
  | { kind: "scrape"; campaignId: string; status: "complete" | "failed" | "blocked"; leadsScraped?: number }
  | { kind: "scrape_progress"; campaignId: string; leadsScraped: number }
  | { kind: "scrape_complete"; count: number }
  | { kind: "drafts"; campaignId: string; generated: number }
  | { kind: "discovery"; vertical: string; geo: string; inserted: number }
  | { kind: "discovery_scrape_complete"; vertical: string; geo: string; leadsAdded: number }
  | { kind: "enrichment_complete"; campaignId: string; count: number };

const CHANNEL = "job_events";

type Listener = (event: JobEvent) => void;
const listeners = new Set<Listener>();

// Server-side: broadcast a job event. Round-trips through Postgres so it reaches
// the LISTEN connection (and thus every SSE subscriber) even from another process.
export async function emitJobEvent(event: JobEvent): Promise<void> {
  try {
    await client.notify(CHANNEL, JSON.stringify(event));
  } catch (err) {
    console.error("[events] emit failed:", err);
  }
}

// In-process: SSE connections register here to receive events. Returns an unsubscribe.
export function subscribeJobEvents(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

let started = false;

// Opens the dedicated LISTEN connection once and fans incoming notifications out
// to all in-process SSE subscribers. Safe to call multiple times.
export async function startJobEventListener(): Promise<void> {
  if (started) return;
  started = true;
  try {
    await client.listen(CHANNEL, (payload) => {
      let event: JobEvent;
      try {
        event = JSON.parse(payload) as JobEvent;
      } catch {
        console.error("[events] dropped malformed payload:", payload);
        return;
      }
      for (const listener of listeners) {
        try {
          listener(event);
        } catch (err) {
          console.error("[events] listener threw:", err);
        }
      }
    });
    console.log(`[events] listening on Postgres channel "${CHANNEL}"`);
  } catch (err) {
    started = false;
    console.error("[events] failed to start LISTEN:", err);
  }
}
