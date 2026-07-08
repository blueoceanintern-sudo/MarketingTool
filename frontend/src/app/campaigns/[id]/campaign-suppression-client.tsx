"use client";

import { useQuery } from "@tanstack/react-query";
import { campaignSuppressionsOptions } from "@/lib/queries";

const REASON_BADGE: Record<string, { label: string; className: string }> = {
  unsubscribed: { label: "Unsubscribed", className: "bg-warning-bg text-warning" },
  manual:       { label: "Manual",       className: "bg-grey-100 text-grey-600" },
};

interface Props {
  campaignId: string;
}

export default function CampaignSuppressionClient({ campaignId }: Props) {
  const { data: entries = [] } = useQuery(campaignSuppressionsOptions(campaignId));

  return (
    <div className="bg-white rounded-lg shadow-[0_1px_3px_rgba(27,45,91,0.08)] border border-grey-100 overflow-hidden mt-6">
      <div className="px-6 py-4 border-b border-grey-100 bg-grey-50 flex items-center justify-between">
        <h3 className="text-[14px] font-semibold text-primary">Suppression List</h3>
        {entries.length > 0 && (
          <span className="text-[13px] text-grey-500">{entries.length.toLocaleString()} suppressed</span>
        )}
      </div>

      {entries.length === 0 ? (
        <div className="px-6 py-12 text-center text-grey-400 text-[14px]">
          No suppressed contacts for this campaign.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-grey-50 border-b border-grey-100">
                <th className="px-6 py-3 text-[14px] font-semibold text-grey-700">Email</th>
                <th className="px-6 py-3 text-[14px] font-semibold text-grey-700">Reason</th>
                <th className="px-6 py-3 text-[14px] font-semibold text-grey-700">Date Added</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-grey-100">
              {entries.map((entry) => {
                const badge = REASON_BADGE[entry.reason] ?? REASON_BADGE.manual;
                return (
                  <tr key={entry.id} className="hover:bg-ocean-wash transition-colors duration-150">
                    <td className="px-6 py-4 text-[13px] font-mono text-ocean-light">{entry.email}</td>
                    <td className="px-6 py-4">
                      <span className={`px-2.5 py-0.5 rounded-full text-[12px] font-medium ${badge.className}`}>
                        {badge.label}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-[13px] text-grey-500">
                      {new Date(entry.added_at).toLocaleDateString("en-GB", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
