"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  triggerCampaignScrape,
  triggerCampaignDraftGeneration,
  updateCampaignStatus,
  type CampaignStatus,
} from "@/lib/api";

interface Props {
  campaignId: string;
  status: CampaignStatus;
}

export default function CampaignActions({ campaignId, status }: Props) {
  const router = useRouter();
  const [scraping, setScraping] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [busyStatus, setBusyStatus] = useState<CampaignStatus | null>(null);
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

  async function handleGenerateDrafts() {
    setDrafting(true);
    setMessage(null);
    const { ok, error } = await triggerCampaignDraftGeneration(campaignId);
    setDrafting(false);
    if (!ok) {
      setMessage(error ?? "Draft generation failed");
      return;
    }
    setMessage("Draft generation queued. The Batch API takes ~30–60s; check the Review Queue shortly.");
  }

  async function handleStatusChange(next: CampaignStatus, label: string) {
    setBusyStatus(next);
    setMessage(null);
    const { ok, error } = await updateCampaignStatus(campaignId, next);
    setBusyStatus(null);
    if (!ok) {
      setMessage(error ?? `Could not ${label.toLowerCase()} campaign`);
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex items-center gap-3 flex-wrap justify-end">
        <button
          type="button"
          onClick={handleScrape}
          disabled={scraping || status === "complete"}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-[14px] font-semibold disabled:opacity-60"
        >
          <span className="material-symbols-outlined text-[20px]">travel_explore</span>
          {scraping ? "Scraping…" : "Run Scrape"}
        </button>

        <button
          type="button"
          onClick={handleGenerateDrafts}
          disabled={drafting || status === "complete" || status === "draft"}
          title={status === "draft" ? "Activate the campaign before generating drafts" : undefined}
          className="flex items-center gap-2 px-4 py-2 border border-primary text-primary rounded-lg text-[14px] font-semibold disabled:opacity-60"
        >
          <span className="material-symbols-outlined text-[20px]">edit_note</span>
          {drafting ? "Queuing…" : "Generate Drafts Now"}
        </button>

        {status === "draft" && (
          <button
            type="button"
            onClick={() => handleStatusChange("active", "Activate")}
            disabled={busyStatus !== null}
            className="flex items-center gap-2 px-4 py-2 bg-success text-white rounded-lg text-[14px] font-semibold disabled:opacity-60"
          >
            <span className="material-symbols-outlined text-[20px]">play_arrow</span>
            {busyStatus === "active" ? "Activating…" : "Activate"}
          </button>
        )}

        {status === "active" && (
          <button
            type="button"
            onClick={() => handleStatusChange("paused", "Pause")}
            disabled={busyStatus !== null}
            className="flex items-center gap-2 px-4 py-2 border border-danger rounded-lg text-[14px] font-semibold text-danger hover:bg-danger-bg disabled:opacity-60"
          >
            <span className="material-symbols-outlined text-[20px]">pause_circle</span>
            {busyStatus === "paused" ? "Pausing…" : "Pause"}
          </button>
        )}

        {status === "paused" && (
          <button
            type="button"
            onClick={() => handleStatusChange("active", "Resume")}
            disabled={busyStatus !== null}
            className="flex items-center gap-2 px-4 py-2 bg-success text-white rounded-lg text-[14px] font-semibold disabled:opacity-60"
          >
            <span className="material-symbols-outlined text-[20px]">play_arrow</span>
            {busyStatus === "active" ? "Resuming…" : "Resume"}
          </button>
        )}

        {(status === "active" || status === "paused") && (
          <button
            type="button"
            onClick={() => handleStatusChange("complete", "Mark complete")}
            disabled={busyStatus !== null}
            className="flex items-center gap-2 px-4 py-2 border border-grey-200 rounded-lg text-[14px] font-semibold text-grey-700 hover:bg-grey-50 disabled:opacity-60"
          >
            <span className="material-symbols-outlined text-[20px]">flag</span>
            {busyStatus === "complete" ? "Completing…" : "Mark Complete"}
          </button>
        )}
      </div>
      {(status === "active" || status === "paused") && (
        <p className="text-[11px] text-grey-400 max-w-xs text-right leading-snug">
          Drafts auto-generate every 30 min for enriched leads (auto_queue).
          Use &ldquo;Now&rdquo; to skip the wait.
        </p>
      )}
      {message && <p className="text-[12px] text-grey-500 max-w-xs text-right">{message}</p>}
    </div>
  );
}
