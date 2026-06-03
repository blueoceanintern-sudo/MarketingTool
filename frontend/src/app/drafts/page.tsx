import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { getQueryClient } from "@/lib/query-client";
import { draftQueueOptions, draftsByStatusOptions } from "@/lib/queries";
import DraftsClient from "./drafts-client";

export default async function DraftsPage() {
  const queryClient = getQueryClient();
  await Promise.all([
    queryClient.prefetchQuery(draftQueueOptions()),
    queryClient.prefetchQuery(draftsByStatusOptions("scheduled")),
    queryClient.prefetchQuery(draftsByStatusOptions("sent")),
  ]);

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <DraftsClient />
    </HydrationBoundary>
  );
}
