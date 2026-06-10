import CampaignDetailClient from "./campaign-detail-client";

export default async function CampaignDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const leadsPage = Math.max(1, parseInt(String(sp.leadsPage ?? "1"), 10) || 1);

  return <CampaignDetailClient campaignId={id} leadsPage={leadsPage} />;
}
