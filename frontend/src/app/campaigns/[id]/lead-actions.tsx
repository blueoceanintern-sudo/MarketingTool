"use client";

import { useState, type SubmitEvent } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { addLeadToCampaign, removeLeadFromCampaign } from "@/lib/api";
import { campaignsOptions, keys } from "@/lib/queries";

interface Props {
  leadId: string;
  leadName: string;
  currentCampaignId: string;
}

type Mode = "add" | "remove";

export default function LeadActions({ leadId, leadName, currentCampaignId }: Props) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("add");
  const [targetCampaignId, setTargetCampaignId] = useState<string>("");
  const [removeReason, setRemoveReason] = useState<string>("");

  // Only fetch the campaign list when the modal is open. For "add", exclude the
  // current campaign and completed campaigns.
  const { data: allCampaigns, isLoading } = useQuery({ ...campaignsOptions(), enabled: open });
  const eligible = (allCampaigns ?? []).filter((c) => c.id !== currentCampaignId && c.status !== "complete");
  const noTargets = allCampaigns !== undefined && eligible.length === 0;
  const selectedTarget = targetCampaignId || eligible[0]?.id || "";

  function closeModal() {
    setOpen(false);
    setError(null);
    setMode("add");
    setRemoveReason("");
    setTargetCampaignId("");
  }

  const applyMutation = useMutation({
    mutationFn: async () => {
      let result: { ok: boolean; error?: string };
      if (mode === "add") {
        if (!selectedTarget) throw new Error("Pick a campaign to add the lead to.");
        result = await addLeadToCampaign(leadId, selectedTarget);
      } else {
        result = await removeLeadFromCampaign(leadId, currentCampaignId, removeReason || undefined);
      }
      if (!result.ok) throw new Error(result.error ?? "Update failed");
    },
    onSuccess: () => {
      closeModal();
      // Refetch this campaign's leads + counts (and the target campaign on add).
      queryClient.invalidateQueries({ queryKey: keys.campaigns });
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : "Update failed");
    },
  });

  function handleSubmit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    applyMutation.mutate();
  }

  return (
    <>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
        className="flex items-center gap-1.5 px-2.5 py-1 text-[12px] font-medium text-grey-500 hover:text-primary hover:bg-grey-50 border border-transparent hover:border-grey-200 rounded-lg transition-colors"
        aria-label="Manage lead"
      >
        <span className="material-symbols-outlined text-[14px]">more_horiz</span>
        Manage
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
          onClick={(e) => { if (e.target === e.currentTarget) closeModal(); }}
        >
          <div className="bg-white rounded-lg w-full max-w-md p-6 text-left">
            <h3 className="text-[18px] font-bold mb-1">Manage lead</h3>
            <p className="text-[12px] text-grey-500 mb-4 truncate">{leadName}</p>

            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <label className="flex items-start gap-3 cursor-pointer p-3 border border-grey-200 rounded-lg hover:bg-grey-50">
                <input
                  type="radio"
                  name="mode"
                  value="add"
                  checked={mode === "add"}
                  onChange={() => setMode("add")}
                  className="mt-1"
                />
                <div className="flex-1">
                  <p className="text-[13px] font-medium">Add to another campaign</p>
                  <p className="text-[12px] text-grey-500 mt-0.5">
                    The lead stays in this campaign and is also added to the one you pick. A separate draft will generate for the new campaign on the next cron tick.
                  </p>
                  {mode === "add" && (
                    <select
                      value={selectedTarget}
                      onChange={(e) => setTargetCampaignId(e.target.value)}
                      disabled={isLoading || noTargets}
                      className="mt-2 w-full border border-grey-200 rounded-lg px-3 py-2 text-[13px] bg-white"
                    >
                      {isLoading && <option>Loading…</option>}
                      {noTargets && <option>No other eligible campaigns</option>}
                      {eligible.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name} ({c.status})
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              </label>

              <label className="flex items-start gap-3 cursor-pointer p-3 border border-grey-200 rounded-lg hover:bg-grey-50">
                <input
                  type="radio"
                  name="mode"
                  value="remove"
                  checked={mode === "remove"}
                  onChange={() => setMode("remove")}
                  className="mt-1"
                />
                <div className="flex-1">
                  <p className="text-[13px] font-medium">Remove from this campaign</p>
                  <p className="text-[12px] text-grey-500 mt-0.5">
                    The lead is unlinked from this campaign only. Pending drafts are deleted. The lead is also excluded so future scrape and CSV imports cannot re-add them.
                  </p>
                  {mode === "remove" && (
                    <input
                      type="text"
                      value={removeReason}
                      onChange={(e) => setRemoveReason(e.target.value)}
                      placeholder="Reason (optional) — e.g. wrong vertical, duplicate"
                      className="mt-2 w-full border border-grey-200 rounded-lg px-3 py-2 text-[13px] bg-white placeholder:text-grey-400"
                    />
                  )}
                </div>
              </label>

              {error && (
                <p className="text-danger text-[13px] border border-danger-bg bg-danger-bg/30 px-3 py-2 rounded-lg">
                  {error}
                </p>
              )}

              <div className="flex gap-3 justify-end">
                <button
                  type="button"
                  onClick={closeModal}
                  className="px-4 py-2 border border-grey-200 rounded-lg text-[13px]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={applyMutation.isPending || (mode === "add" && (noTargets || isLoading))}
                  className="px-6 py-2 bg-primary text-white rounded-lg text-[13px] font-semibold disabled:opacity-60"
                >
                  {applyMutation.isPending ? "Applying…" : "Apply"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
