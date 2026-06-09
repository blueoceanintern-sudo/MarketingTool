import { type EmailStatus, type EnrichmentRouting, type LeadStatus } from "@/lib/api";
import LeadsClient from "./leads-client";

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

  return (
    <LeadsClient
      page={page}
      statusFilter={status}
      emailStatusFilter={emailStatus}
      routingFilter={routing}
      campaignIdFilter={campaignId}
    />
  );
}
