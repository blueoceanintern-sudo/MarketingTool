import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { getQueryClient } from "@/lib/query-client";
import { repliesOptions } from "@/lib/queries";
import RepliesClient from "./replies-client";

export default async function RepliesPage() {
  const queryClient = getQueryClient();
  await queryClient.prefetchQuery(repliesOptions(false));

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <RepliesClient />
    </HydrationBoundary>
  );
}
