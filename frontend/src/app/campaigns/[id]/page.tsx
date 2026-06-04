import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { getQueryClient } from "@/lib/query-client";
import { campaignOptions, campaignLeadsOptions } from "@/lib/queries";
import CampaignDetailClient from "./campaign-detail-client";

const LEADS_PER_PAGE = 50;

export default async function CampaignDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const leadsPage = Math.max(1, parseInt(String(sp.leadsPage ?? "1"), 10) || 1);

  const queryClient = getQueryClient();
  await Promise.all([
    queryClient.prefetchQuery(campaignOptions(id)),
    queryClient.prefetchQuery(campaignLeadsOptions(id, leadsPage, LEADS_PER_PAGE)),
  ]);

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <CampaignDetailClient campaignId={id} leadsPage={leadsPage} />
    </HydrationBoundary>
  );
}
