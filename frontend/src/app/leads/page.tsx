import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { getQueryClient } from "@/lib/query-client";
import { leadsOptions, campaignsOptions } from "@/lib/queries";
import { type EmailStatus, type EnrichmentRouting, type LeadStatus } from "@/lib/api";
import LeadsClient from "./leads-client";

const PAGE_LIMIT = 50;

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;

  const page = Math.max(1, parseInt(String(sp.page ?? "1"), 10) || 1);
  const status = (sp.status as LeadStatus | undefined) ?? "";
  const emailStatus = (sp.email_status as EmailStatus | undefined) ?? "";
  const routing = (sp.routing as EnrichmentRouting | undefined) ?? "";
  const campaignId = String(sp.campaign_id ?? "");

  const params = {
    page,
    limit: PAGE_LIMIT,
    status: status || undefined,
    email_status: emailStatus || undefined,
    routing: routing || undefined,
    campaign_id: campaignId || undefined,
  };

  const queryClient = getQueryClient();
  await Promise.all([
    queryClient.prefetchQuery(leadsOptions(params)),
    queryClient.prefetchQuery(campaignsOptions()),
  ]);

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <LeadsClient
        page={page}
        statusFilter={status}
        emailStatusFilter={emailStatus}
        routingFilter={routing}
        campaignIdFilter={campaignId}
      />
    </HydrationBoundary>
  );
}
