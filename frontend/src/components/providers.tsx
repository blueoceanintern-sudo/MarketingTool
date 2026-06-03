"use client";

import { ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { getQueryClient } from "@/lib/query-client";
import { JobEventsProvider } from "@/lib/job-events";

export default function Providers({ children }: { children: ReactNode }) {
  // getQueryClient() returns the browser singleton on the client, so this is
  // stable across re-renders without needing useState.
  const queryClient = getQueryClient();

  return (
    <QueryClientProvider client={queryClient}>
      <JobEventsProvider>{children}</JobEventsProvider>
      {process.env.NODE_ENV === "development" && <ReactQueryDevtools initialIsOpen={false} />}
    </QueryClientProvider>
  );
}
