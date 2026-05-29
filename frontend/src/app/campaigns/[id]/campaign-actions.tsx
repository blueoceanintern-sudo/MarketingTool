"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  getCampaign,
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
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  async function handleScrape() {
    setScraping(true);
    setMessage(null);
    if (pollRef.current) clearInterval(pollRef.current);

    const { ok, error } = await triggerCampaignScrape(campaignId);
    if (!ok) {
      setScraping(false);
      setMessage(error ?? "Scrape failed");
      return;
    }

    const before = await getCampaign(campaignId);
    const beforeCount = before?.leads_count ?? 0;
    setMessage("Scraping…");

    let tries = 0;
    pollRef.current = setInterval(async () => {
      tries++;
      const updated = await getCampaign(campaignId);
      const newCount = updated?.leads_count ?? beforeCount;
      const done = newCount > beforeCount || tries >= 10;
      if (done) {
        clearInterval(pollRef.current!);
        pollRef.current = null;
        setScraping(false);
        const diff = newCount - beforeCount;
        setMessage(diff > 0 ? `Done — ${diff} new lead${diff !== 1 ? "s" : ""} added.` : "Scrape complete — no new leads found.");
        router.refresh();
      }
    }, 3000);
  }

  async function handleGenerateDrafts() {
    setDrafting(true);
    setMessage(null);
    if (pollRef.current) clearInterval(pollRef.current);

    const { ok, error } = await triggerCampaignDraftGeneration(campaignId);
    if (!ok) {
      setDrafting(false);
      setMessage(error ?? "Draft generation failed");
      return;
    }

    const before = await getCampaign(campaignId);
    const beforePending = before?.drafts_pending ?? 0;
    setMessage("Generating drafts — Batch API in progress…");

    let tries = 0;
    pollRef.current = setInterval(async () => {
      tries++;
      const updated = await getCampaign(campaignId);
      const newPending = updated?.drafts_pending ?? beforePending;
      const done = newPending > beforePending || tries >= 20;
      if (done) {
        clearInterval(pollRef.current!);
        pollRef.current = null;
        setDrafting(false);
        const diff = newPending - beforePending;
        setMessage(diff > 0 ? `${diff} new draft${diff !== 1 ? "s" : ""} added to Review Queue.` : "Draft generation complete — check the Review Queue.");
        router.refresh();
      }
    }, 3000);
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
      <div className="flex items-center gap-2 flex-wrap justify-end">
        <button
          type="button"
          onClick={handleScrape}
          disabled={scraping || drafting || status === "complete"}
          className="flex items-center gap-2 px-3 py-2 bg-primary text-white rounded-lg text-[13px] font-semibold disabled:opacity-60"
        >
          <span className="material-symbols-outlined text-[18px]">travel_explore</span>
          {scraping ? "Scraping…" : "Run Scrape"}
        </button>

        <button
          type="button"
          onClick={handleGenerateDrafts}
          disabled={drafting || scraping || status === "complete" || status === "draft"}
          title={status === "draft" ? "Activate the campaign before generating drafts" : undefined}
          className="flex items-center gap-2 px-3 py-2 border border-primary text-primary rounded-lg text-[13px] font-semibold disabled:opacity-60"
        >
          <span className="material-symbols-outlined text-[18px]">edit_note</span>
          {drafting ? "Generating…" : "Generate Drafts"}
        </button>

        {status === "draft" && (
          <button
            type="button"
            onClick={() => handleStatusChange("active", "Activate")}
            disabled={busyStatus !== null}
            className="flex items-center gap-2 px-3 py-2 bg-success text-white rounded-lg text-[13px] font-semibold disabled:opacity-60"
          >
            <span className="material-symbols-outlined text-[18px]">play_arrow</span>
            {busyStatus === "active" ? "Activating…" : "Activate"}
          </button>
        )}

        {status === "active" && (
          <button
            type="button"
            onClick={() => handleStatusChange("paused", "Pause")}
            disabled={busyStatus !== null}
            className="flex items-center gap-2 px-3 py-2 border border-danger rounded-lg text-[13px] font-semibold text-danger hover:bg-danger-bg disabled:opacity-60"
          >
            <span className="material-symbols-outlined text-[18px]">pause_circle</span>
            {busyStatus === "paused" ? "Pausing…" : "Pause"}
          </button>
        )}

        {status === "paused" && (
          <button
            type="button"
            onClick={() => handleStatusChange("active", "Resume")}
            disabled={busyStatus !== null}
            className="flex items-center gap-2 px-3 py-2 bg-success text-white rounded-lg text-[13px] font-semibold disabled:opacity-60"
          >
            <span className="material-symbols-outlined text-[18px]">play_arrow</span>
            {busyStatus === "active" ? "Resuming…" : "Resume"}
          </button>
        )}

        {(status === "active" || status === "paused") && (
          <button
            type="button"
            onClick={() => handleStatusChange("complete", "Mark complete")}
            disabled={busyStatus !== null}
            className="flex items-center gap-2 px-3 py-2 border border-grey-200 rounded-lg text-[13px] font-semibold text-grey-700 hover:bg-grey-50 disabled:opacity-60"
          >
            <span className="material-symbols-outlined text-[18px]">flag</span>
            {busyStatus === "complete" ? "Completing…" : "Mark Complete"}
          </button>
        )}
      </div>
      {(status === "active" || status === "paused") && !message && (
        <p className="text-[11px] text-grey-400 max-w-xs text-right leading-snug">
          Drafts auto-generate every 30 min for enriched leads.
        </p>
      )}
      {message && <p className="text-[12px] text-grey-500 max-w-xs text-right">{message}</p>}
    </div>
  );
}
