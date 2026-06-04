"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  triggerCampaignScrape,
  triggerCampaignDraftGeneration,
  triggerCampaignEnrich,
  updateCampaignStatus,
  type CampaignStatus,
} from "@/lib/api";
import { keys } from "@/lib/queries";
import { useJobEvents } from "@/lib/job-events";

interface Props {
  campaignId: string;
  status: CampaignStatus;
}

export default function CampaignActions({ campaignId, status }: Props) {
  const queryClient = useQueryClient();
  const [running, setRunning] = useState<"scrape" | "enrich" | "drafts" | null>(null);
  const [busyStatus, setBusyStatus] = useState<CampaignStatus | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // Scrape and draft generation are async backend jobs. We fire the trigger,
  // then wait for the SSE completion event (which also invalidates the queries,
  // so the tiles and leads table refresh on their own).
  useJobEvents((event) => {
    if (event.kind === "scrape" && event.campaignId === campaignId && running === "scrape") {
      setRunning(null);
      setMessage(
        event.status === "complete"
          ? "Scrape complete."
          : event.status === "blocked"
            ? "Scrape blocked (CAPTCHA or robots.txt)."
            : "Scrape failed.",
      );
    } else if (event.kind === "enrichment_complete" && event.campaignId === campaignId && running === "enrich") {
      setRunning(null);
      setMessage(`Enrichment complete — ${event.count} lead${event.count === 1 ? "" : "s"} enriched.`);
    } else if (event.kind === "drafts" && event.campaignId === campaignId && running === "drafts") {
      setRunning(null);
      setMessage(
        event.generated > 0
          ? `${event.generated} new draft${event.generated !== 1 ? "s" : ""} added to Review Queue.`
          : "Draft generation complete — check the Review Queue.",
      );
    }
  });

  const scrapeMutation = useMutation({
    mutationFn: () => triggerCampaignScrape(campaignId),
    onSuccess: ({ ok, error }) => {
      if (!ok) {
        setMessage(error ?? "Scrape failed");
        return;
      }
      setMessage("Scraping…");
      setRunning("scrape");
    },
  });

  const enrichMutation = useMutation({
    mutationFn: () => triggerCampaignEnrich(campaignId),
    onSuccess: ({ ok, count, error }) => {
      if (!ok) {
        setMessage(error ?? "Enrichment failed");
        return;
      }
      setMessage(`Enriching ${count} lead${count === 1 ? "" : "s"}…`);
      setRunning("enrich");
    },
  });

  const draftMutation = useMutation({
    mutationFn: () => triggerCampaignDraftGeneration(campaignId),
    onSuccess: ({ ok, error }) => {
      if (!ok) {
        setMessage(error ?? "Draft generation failed");
        return;
      }
      setMessage("Generating drafts — Batch API in progress…");
      setRunning("drafts");
    },
  });

  const statusMutation = useMutation({
    mutationFn: (vars: { next: CampaignStatus; label: string }) => updateCampaignStatus(campaignId, vars.next),
    onSettled: () => setBusyStatus(null),
    onSuccess: ({ ok, error }, vars) => {
      if (!ok) {
        setMessage(error ?? `Could not ${vars.label.toLowerCase()} campaign`);
        return;
      }
      queryClient.invalidateQueries({ queryKey: keys.campaigns });
    },
  });

  const scraping = scrapeMutation.isPending || running === "scrape";
  const enriching = enrichMutation.isPending || running === "enrich";
  const drafting = draftMutation.isPending || running === "drafts";

  function handleScrape() {
    setMessage(null);
    scrapeMutation.mutate();
  }

  function handleEnrich() {
    setMessage(null);
    enrichMutation.mutate();
  }

  function handleGenerateDrafts() {
    setMessage(null);
    draftMutation.mutate();
  }

  function handleStatusChange(next: CampaignStatus, label: string) {
    setBusyStatus(next);
    setMessage(null);
    statusMutation.mutate({ next, label });
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
          onClick={handleEnrich}
          disabled={enriching || scraping || drafting || status === "complete"}
          className="flex items-center gap-2 px-3 py-2 border border-primary text-primary rounded-lg text-[13px] font-semibold disabled:opacity-60"
        >
          <span className="material-symbols-outlined text-[18px]">manage_search</span>
          {enriching ? "Enriching…" : "Enrich Leads"}
        </button>

        <button
          type="button"
          onClick={handleGenerateDrafts}
          disabled={drafting || scraping || enriching || status === "complete" || status === "draft"}
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
