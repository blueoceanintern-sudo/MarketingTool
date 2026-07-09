"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { campaignOptions } from "@/lib/queries";
import CampaignActions from "./campaign-actions";
import CampaignDetails from "./campaign-details";
import CampaignLeadsClient from "./campaign-leads-client";
import CampaignSuppressionClient from "./campaign-suppression-client";

interface Props {
  campaignId: string;
  leadsPage: number;
}

export default function CampaignDetailClient({ campaignId, leadsPage }: Props) {
  const { data: campaign } = useQuery(campaignOptions(campaignId));
  const name = campaign?.name ?? "Campaign";

  return (
    <div className="p-4 sm:p-6 lg:p-10 max-w-400 mx-auto">
      {/* Page header */}
      <div className="flex justify-between items-end mb-8">
        <div>
          <nav className="flex items-center gap-2 mb-2">
            <Link href="/campaigns" className="text-[13px] text-grey-500 hover:text-primary transition-colors">
              Campaigns
            </Link>
            <span className="material-symbols-outlined text-[16px] text-grey-300">chevron_right</span>
            <span className="text-[13px] font-medium text-primary">{name}</span>
          </nav>
          <h2 className="text-[20px] font-bold text-primary">{name}</h2>
          <p className="text-[11px] text-grey-500 mt-1">ID: {campaignId}</p>
        </div>
        {campaign && <CampaignActions campaignId={campaignId} status={campaign.status} />}
      </div>

      {campaign && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-6 mb-8">
          <div className="bg-white p-6 rounded-lg shadow-[0_1px_3px_rgba(27,45,91,0.08)] border border-grey-100">
            <div className="flex justify-between items-start mb-4">
              <div className="p-2 bg-ocean-wash text-primary rounded-lg">
                <span className="material-symbols-outlined">group</span>
              </div>
            </div>
            <p className="text-[13px] text-grey-500 mb-1">Total Leads</p>
            <h3 className="text-[28px] font-bold text-primary font-mono">{campaign.leads_count.toLocaleString()}</h3>
          </div>
          <Link
            href={`/drafts?campaign=${campaignId}`}
            className="bg-white p-6 rounded-lg shadow-[0_1px_3px_rgba(27,45,91,0.08)] border border-grey-100 hover:border-warning transition-colors block"
          >
            <div className="flex justify-between items-start mb-4">
              <div className="p-2 bg-warning-bg text-warning rounded-lg">
                <span className="material-symbols-outlined">edit_note</span>
              </div>
              {campaign.drafts_pending > 0 && (
                <span className="text-[11px] font-medium text-warning flex items-center gap-0.5">
                  Review
                  <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
                </span>
              )}
            </div>
            <p className="text-[13px] text-grey-500 mb-1">Drafts Pending</p>
            <h3 className="text-[28px] font-bold text-primary font-mono">{campaign.drafts_pending}</h3>
          </Link>
          <div className="bg-white p-6 rounded-lg shadow-[0_1px_3px_rgba(27,45,91,0.08)] border border-grey-100">
            <div className="flex justify-between items-start mb-4">
              <div className="p-2 bg-ocean-wash text-ocean-light rounded-lg">
                <span className="material-symbols-outlined">send</span>
              </div>
            </div>
            <p className="text-[13px] text-grey-500 mb-1">Emails Sent</p>
            <h3 className="text-[28px] font-bold text-primary font-mono">{campaign.sent.toLocaleString()}</h3>
          </div>
          <div className="bg-white p-6 rounded-lg shadow-[0_1px_3px_rgba(27,45,91,0.08)] border border-grey-100">
            <div className="flex justify-between items-start mb-4">
              <div className="p-2 bg-success-bg text-success rounded-lg">
                <span className="material-symbols-outlined">forum</span>
              </div>
            </div>
            <p className="text-[13px] text-grey-500 mb-1">Open Rate</p>
            <h3 className="text-[28px] font-bold text-primary font-mono">{campaign.open_rate}%</h3>
          </div>
        </div>
      )}

      {/* Campaign details */}
      {campaign && <CampaignDetails campaign={campaign} />}

      {/* Leads — KPI tile + paginated table */}
      <CampaignLeadsClient campaignId={campaignId} initialPage={leadsPage} />

      {/* Suppression list for this campaign */}
      <CampaignSuppressionClient campaignId={campaignId} />
    </div>
  );
}
