import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { getQueryClient } from "@/lib/query-client";
import { campaignsOptions } from "@/lib/queries";
import CampaignsClient from "./campaigns-client";

export default async function CampaignsPage() {
  const queryClient = getQueryClient();
  await queryClient.prefetchQuery(campaignsOptions());

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <CampaignsClient />
    </HydrationBoundary>
  );
}
