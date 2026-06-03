import { QueryClient, defaultShouldDehydrateQuery, isServer } from "@tanstack/react-query";

// Standard Next.js App Router setup: a fresh QueryClient per request on the
// server, and a single long-lived client in the browser.
function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Data prefetched on the server stays "fresh" briefly after hydration so
        // the client doesn't immediately refetch what the server just sent.
        staleTime: 30 * 1000,
        refetchOnWindowFocus: true,
      },
      dehydrate: {
        // Also ship pending (in-flight) queries so streamed prefetches hydrate.
        shouldDehydrateQuery: (query) =>
          defaultShouldDehydrateQuery(query) || query.state.status === "pending",
      },
    },
  });
}

let browserQueryClient: QueryClient | undefined;

export function getQueryClient(): QueryClient {
  if (isServer) {
    // Server: always make a new client so requests don't share cache.
    return makeQueryClient();
  }
  // Browser: reuse one client across renders/navigations.
  browserQueryClient ??= makeQueryClient();
  return browserQueryClient;
}
