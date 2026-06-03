"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { keys } from "./queries";

// Mirror of the backend JobEvent union (services/events.ts).
export type JobEvent =
  | { kind: "scrape"; campaignId: string; status: "complete" | "failed" | "blocked"; leadsScraped?: number }
  | { kind: "scrape_progress"; campaignId: string; leadsScraped: number }
  | { kind: "drafts"; campaignId: string; generated: number }
  | { kind: "discovery"; vertical: string; geo: string; inserted: number };

type Listener = (event: JobEvent) => void;

const JobEventsContext = createContext<{ subscribe: (l: Listener) => () => void } | null>(null);

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

// A scrape emits one progress event per inserted lead; coalesce the refetches.
const PROGRESS_THROTTLE_MS = 800;

export function JobEventsProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const listenersRef = useRef<Set<Listener>>(new Set());
  const lastProgressRef = useRef(0);

  // Stable context value (built once via lazy state) so consumers don't
  // re-subscribe each render.
  const [api] = useState(() => ({
    subscribe: (listener: Listener) => {
      listenersRef.current.add(listener);
      return () => {
        listenersRef.current.delete(listener);
      };
    },
  }));

  useEffect(() => {
    const source = new EventSource(`${BASE}/api/v1/events`);

    source.addEventListener("job", (e) => {
      let event: JobEvent;
      try {
        event = JSON.parse((e as MessageEvent).data) as JobEvent;
      } catch {
        return;
      }

      // Refetch whatever the finished job touched.
      switch (event.kind) {
        case "scrape":
          queryClient.invalidateQueries({ queryKey: keys.campaigns });
          break;
        case "scrape_progress": {
          // Leading-edge throttle: refresh at most once per window while leads
          // stream in. The terminal "scrape" event guarantees the final refetch.
          const now = Date.now();
          if (now - lastProgressRef.current >= PROGRESS_THROTTLE_MS) {
            lastProgressRef.current = now;
            queryClient.invalidateQueries({ queryKey: keys.campaigns });
          }
          break;
        }
        case "drafts":
          queryClient.invalidateQueries({ queryKey: keys.campaigns });
          queryClient.invalidateQueries({ queryKey: keys.drafts });
          break;
        case "discovery":
          queryClient.invalidateQueries({ queryKey: keys.registry });
          break;
      }

      // Let components react (e.g. clear a "Scraping…" button state).
      for (const listener of listenersRef.current) {
        try {
          listener(event);
        } catch {
          /* a listener throwing shouldn't break the others */
        }
      }
    });

    return () => source.close();
  }, [queryClient]);

  return <JobEventsContext.Provider value={api}>{children}</JobEventsContext.Provider>;
}

// Subscribe a component to job events. The latest callback is always used, and
// the subscription lasts for the component's lifetime (no re-subscribe churn).
export function useJobEvents(listener: Listener) {
  const ctx = useContext(JobEventsContext);
  const ref = useRef(listener);

  // Keep the ref pointing at the latest callback without writing it during render.
  useEffect(() => {
    ref.current = listener;
  });

  useEffect(() => {
    if (!ctx) return;
    return ctx.subscribe((event) => ref.current(event));
  }, [ctx]);
}

