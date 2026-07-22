"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  triggerCampaignFetchLeads,
  triggerCampaignDraftGeneration,
  triggerCampaignDiscover,
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
  const [running, setRunning] = useState<"drafts" | "discovery" | null>(null);
  const [busyStatus, setBusyStatus] = useState<CampaignStatus | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [showManage, setShowManage] = useState(false);
  const manageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleOutsideClick(e: MouseEvent) {
      if (manageRef.current && !manageRef.current.contains(e.target as Node)) {
        setShowManage(false);
      }
    }
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  useJobEvents((event) => {
    if (event.kind === "drafts" && event.campaignId === campaignId && running === "drafts") {
      setRunning(null);
      setMessage(
        event.generated > 0
          ? `${event.generated} draft${event.generated !== 1 ? "s" : ""} added to Review Queue.`
          : "No new drafts generated.",
      );
    }
    if (event.kind === "campaign_discovery" && event.campaignId === campaignId && running === "discovery") {
      if (discoveryTimeoutRef.current) clearTimeout(discoveryTimeoutRef.current);
      setRunning(null);
      queryClient.invalidateQueries({ queryKey: keys.campaign(campaignId) });
      if (event.inserted > 0) {
        setMessage(`Discovery complete — ${event.inserted} new source${event.inserted !== 1 ? "s" : ""} found. Scraping leads now.`);
      } else {
        setMessage("Discovery complete — no new sources found for this campaign.");
      }
    }
  });

  const discoveryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const discoverMutation = useMutation({
    mutationFn: () => triggerCampaignDiscover(campaignId),
    onSuccess: ({ ok, error }) => {
      if (!ok) {
        setMessage(error ?? "Discovery failed to start.");
        return;
      }
      setMessage("AI discovery agent running — searching for new lead sources…");
      setRunning("discovery");
      // Fallback: if no SSE event arrives within 5 min, clear the spinner.
      if (discoveryTimeoutRef.current) clearTimeout(discoveryTimeoutRef.current);
      discoveryTimeoutRef.current = setTimeout(() => {
        setRunning((r) => (r === "discovery" ? null : r));
        setMessage("Discovery timed out — check back shortly or try again.");
      }, 5 * 60 * 1000);
    },
  });

  const fetchLeadsMutation = useMutation({
    mutationFn: () => triggerCampaignFetchLeads(campaignId),
    onSuccess: ({ ok, added, error }) => {
      if (!ok) {
        setMessage(error ?? "Fetch leads failed.");
        return;
      }
      queryClient.invalidateQueries({ queryKey: keys.campaign(campaignId) });
      if (added && added > 0) {
        setMessage(`${added} lead${added === 1 ? "" : "s"} matched.`);
      } else {
        toast.warning("No leads matched this campaign", {
          description: "Try enriching leads, running scrape, or adding sources in the Registry.",
        });
        setMessage(null);
      }
    },
  });

  const draftMutation = useMutation({
    mutationFn: () => triggerCampaignDraftGeneration(campaignId),
    onSuccess: ({ ok, error }) => {
      if (!ok) {
        setMessage(error ?? "Draft generation failed.");
        return;
      }
      setMessage("Generating drafts…");
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
      setShowManage(false);
    },
  });

  const discovering = discoverMutation.isPending || running === "discovery";
  const fetching = fetchLeadsMutation.isPending;
  const drafting = draftMutation.isPending || running === "drafts";

  function handleDiscover() {
    setMessage(null);
    discoverMutation.mutate();
  }

  function handleFetchLeads() {
    setMessage(null);
    fetchLeadsMutation.mutate();
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

  const showManageMenu =
    status === "active" || status === "paused";

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex items-center gap-2 flex-wrap justify-end">
        <button
          type="button"
          onClick={handleDiscover}
          disabled={discovering || fetching || drafting || status === "complete"}
          title="Run the AI agent to find new lead source directories for this campaign"
          className="flex items-center gap-2 px-3 py-2 border border-grey-200 text-grey-700 rounded-lg text-[13px] font-semibold disabled:opacity-60 hover:bg-grey-50"
        >
          <span className="material-symbols-outlined text-[18px]">travel_explore</span>
          {discovering ? "Discovering…" : "Discover Sources"}
        </button>

        <button
          type="button"
          onClick={handleFetchLeads}
          disabled={fetching || drafting || status === "complete"}
          className="flex items-center gap-2 px-3 py-2 bg-primary text-white rounded-lg text-[13px] font-semibold disabled:opacity-60"
        >
          <span className="material-symbols-outlined text-[18px]">person_search</span>
          {fetching ? "Fetching…" : "Fetch Leads"}
        </button>

        <button
          type="button"
          onClick={handleGenerateDrafts}
          disabled={drafting || fetching || status === "complete" || status === "draft"}
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

        {showManageMenu && (
          <div ref={manageRef} className="relative">
            <button
              type="button"
              onClick={() => setShowManage((v) => !v)}
              className="flex items-center gap-2 px-3 py-2 border border-grey-200 rounded-lg text-[13px] font-semibold text-grey-700 hover:bg-grey-50"
            >
              <span className="material-symbols-outlined text-[18px]">settings</span>
              Manage
              <span className="material-symbols-outlined text-[16px]">
                {showManage ? "expand_less" : "expand_more"}
              </span>
            </button>

            {showManage && (
              <div className="absolute right-0 top-full mt-1 z-20 bg-white border border-grey-200 rounded-lg shadow-lg min-w-42.5 overflow-hidden">
                {status === "active" && (
                  <button
                    type="button"
                    onClick={() => handleStatusChange("paused", "Pause")}
                    disabled={busyStatus !== null}
                    className="w-full flex items-center gap-2 px-4 py-2.5 text-[13px] text-grey-700 hover:bg-grey-50 disabled:opacity-60"
                  >
                    <span className="material-symbols-outlined text-[18px]">pause_circle</span>
                    {busyStatus === "paused" ? "Pausing…" : "Pause Campaign"}
                  </button>
                )}
                {status === "paused" && (
                  <button
                    type="button"
                    onClick={() => handleStatusChange("active", "Resume")}
                    disabled={busyStatus !== null}
                    className="w-full flex items-center gap-2 px-4 py-2.5 text-[13px] text-grey-700 hover:bg-grey-50 disabled:opacity-60"
                  >
                    <span className="material-symbols-outlined text-[18px]">play_arrow</span>
                    {busyStatus === "active" ? "Resuming…" : "Resume Campaign"}
                  </button>
                )}
                <div className="border-t border-grey-100" />
                <button
                  type="button"
                  onClick={() => handleStatusChange("complete", "Mark complete")}
                  disabled={busyStatus !== null}
                  className="w-full flex items-center gap-2 px-4 py-2.5 text-[13px] text-danger hover:bg-danger-bg disabled:opacity-60"
                >
                  <span className="material-symbols-outlined text-[18px]">flag</span>
                  {busyStatus === "complete" ? "Completing…" : "Mark Complete"}
                </button>
              </div>
            )}
          </div>
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
