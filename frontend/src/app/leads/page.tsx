import { getCampaigns, getLeadsPaginated, type EmailStatus, type EnrichmentRouting, type LeadStatus } from "@/lib/api";
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

  const [result, allCampaigns] = await Promise.all([
    getLeadsPaginated({
      page,
      limit: PAGE_LIMIT,
      status: status || undefined,
      email_status: emailStatus || undefined,
      routing: routing || undefined,
      campaign_id: campaignId || undefined,
    }),
    getCampaigns(),
  ]);

  return (
    <LeadsClient
      data={result.data}
      total={result.total}
      page={result.page}
      limit={result.limit}
      totalPages={result.total_pages}
      summary={result.summary}
      statusFilter={status}
      emailStatusFilter={emailStatus}
      routingFilter={routing}
      campaignIdFilter={campaignId}
      allCampaigns={allCampaigns}
    />
  );
}
