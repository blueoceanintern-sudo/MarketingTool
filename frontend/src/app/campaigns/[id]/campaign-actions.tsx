"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { triggerCampaignScrape, updateCampaignStatus, type CampaignStatus } from "@/lib/api";

interface Props {
  campaignId: string;
  status: CampaignStatus;
}

export default function CampaignActions({ campaignId, status }: Props) {
  const router = useRouter();
  const [scraping, setScraping] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function handleScrape() {
    setScraping(true);
    setMessage(null);
    const { ok, error } = await triggerCampaignScrape(campaignId);
    setScraping(false);
    if (!ok) {
      setMessage(error ?? "Scrape failed");
      return;
    }
    setMessage("Scrape started. Refresh in a moment to see new leads.");
    router.refresh();
  }

  async function handlePause() {
    const { ok, error } = await updateCampaignStatus(campaignId, "paused");
    if (!ok) {
      setMessage(error ?? "Could not pause campaign");
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleScrape}
          disabled={scraping}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-[14px] font-semibold disabled:opacity-60"
        >
          <span className="material-symbols-outlined text-[20px]">travel_explore</span>
          {scraping ? "Scraping…" : "Run Scrape"}
        </button>
        {status === "active" && (
          <button
            type="button"
            onClick={handlePause}
            className="flex items-center gap-2 px-4 py-2 border border-danger rounded-lg text-[14px] font-semibold text-danger hover:bg-danger-bg"
          >
            <span className="material-symbols-outlined text-[20px]">pause_circle</span>
            Pause
          </button>
        )}
      </div>
      {message && <p className="text-[12px] text-grey-500 max-w-xs text-right">{message}</p>}
    </div>
  );
}
