import { getCampaigns } from "@/lib/api";
import CampaignsClient from "./campaigns-client";

export default async function CampaignsPage() {
  const campaigns = await getCampaigns();
  return <CampaignsClient initialCampaigns={campaigns} />;
}
