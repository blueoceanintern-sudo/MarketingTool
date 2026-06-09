"use client";

import { ReactNode } from "react";
import { SessionProvider, useSession } from "next-auth/react";
import type { Session } from "next-auth";
import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { getQueryClient } from "@/lib/query-client";
import { JobEventsProvider } from "@/lib/job-events";
import { setApiToken } from "@/lib/api";

// Sets the backend token synchronously during render (not in an effect) so it
// is guaranteed to be present before React Query's child effects fire their
// initial fetches.
function TokenSync() {
  const { data: session } = useSession();
  if (session?.backendToken) setApiToken(session.backendToken);
  return null;
}

export default function Providers({
  children,
  session,
}: {
  children: ReactNode;
  session: Session | null;
}) {
  const queryClient = getQueryClient();

  return (
    <SessionProvider session={session}>
      <QueryClientProvider client={queryClient}>
        <TokenSync />
        <JobEventsProvider>{children}</JobEventsProvider>
        {process.env.NODE_ENV === "development" && <ReactQueryDevtools initialIsOpen={false} />}
      </QueryClientProvider>
    </SessionProvider>
  );
}
