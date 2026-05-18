"use client";

import { useState } from "react";
import type { Draft } from "@/lib/api";
import { approveDraft, rejectDraft } from "@/lib/api";

const MOCK_DRAFTS: Draft[] = [
  {
    id: "DRAFT-001",
    lead_id: "L-001",
    lead_name: "Sarah Chen",
    lead_role: "Director of Ops, CloudScale",
    campaign_id: "CAM-001",
    campaign_name: "Q3 APAC SaaS Prospecting",
    persona: "ops",
    subject: "Optimizing CloudScale's latency for edge nodes",
    body: `Hi Sarah,\n\nI noticed CloudScale's recent move into edge computing regions. Given your role overseeing Ops, you're likely balancing performance spikes with infrastructure costs.\n\nOur team at BlueOcean has developed a specific orchestration layer that reduces cold-start latency by 24% for nodes in high-density areas. It integrates directly with your existing Kubernetes stack without requiring a complete rewrite.\n\nWould you be open to a 10-minute brief on how we're handling similar throughput for Tier-1 providers?\n\nBest,\nThe BlueOcean Team`,
    confidence_score: 88,
    status: "pending_review",
    created_at: new Date().toISOString(),
  },
];

interface Props {
  initialDrafts: Draft[];
}

function confidenceLabel(score: number) {
  if (score >= 75) return { label: "High", className: "bg-success-bg text-success", barClass: "bg-success" };
  if (score >= 50) return { label: "Moderate", className: "bg-warning-bg text-warning", barClass: "bg-warning" };
  return { label: "Low", className: "bg-danger-bg text-danger", barClass: "bg-danger" };
}

function wordCount(text: string) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export default function DraftsClient({ initialDrafts }: Props) {
  const queue = initialDrafts.length ? initialDrafts : MOCK_DRAFTS;
  const [drafts, setDrafts] = useState<Draft[]>(queue.filter((d) => d.status === "pending_review"));
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [showReject, setShowReject] = useState(false);

  const selected = drafts[selectedIdx];

  async function handleApprove() {
    if (!selected) return;
    setSubmitting(true);
    await approveDraft(selected.id);
    setDrafts((prev) => prev.filter((d) => d.id !== selected.id));
    setSelectedIdx(0);
    setSubmitting(false);
  }

  async function handleReject() {
    if (!selected) return;
    setSubmitting(true);
    await rejectDraft(selected.id, rejectReason);
    setDrafts((prev) => prev.filter((d) => d.id !== selected.id));
    setSelectedIdx(0);
    setRejectReason("");
    setShowReject(false);
    setSubmitting(false);
  }

  if (drafts.length === 0) {
    return (
      <div className="h-[calc(100vh-4rem)] flex items-center justify-center flex-col gap-4 text-grey-400">
        <span className="material-symbols-outlined text-[48px]">check_circle</span>
        <p className="text-[16px] font-medium">Review queue is empty</p>
        <p className="text-[13px]">All drafts have been reviewed.</p>
      </div>
    );
  }

  const conf = confidenceLabel(selected?.confidence_score ?? 0);
  const wc = wordCount(selected?.body ?? "");

  return (
    <>
      <div className="h-[calc(100vh-4rem)] flex flex-col overflow-hidden">
        <div className="flex-1 flex overflow-hidden">
          {/* Left queue panel */}
          <section className="w-[320px] bg-white border-r border-grey-100 flex flex-col overflow-y-auto shrink-0">
            <div className="px-5 py-4 border-b border-grey-100 sticky top-0 bg-white z-10">
              <h2 className="text-[16px] font-semibold text-primary">Queue ({drafts.length})</h2>
            </div>
            {drafts.map((draft, idx) => {
              const c = confidenceLabel(draft.confidence_score);
              return (
                <button
                  key={draft.id}
                  onClick={() => { setSelectedIdx(idx); setShowReject(false); }}
                  className={[
                    "w-full text-left p-4 border-b border-grey-100 cursor-pointer transition-colors",
                    idx === selectedIdx
                      ? "bg-ocean-wash border-l-4 border-l-primary"
                      : "hover:bg-grey-50 border-l-4 border-l-transparent",
                  ].join(" ")}
                >
                  <div className="flex justify-between items-start mb-1">
                    <h3 className="text-[14px] font-semibold text-primary truncate max-w-[170px]">{draft.lead_name}</h3>
                    <span className={`px-2 py-0.5 text-[11px] font-medium rounded shrink-0 ${c.className}`}>
                      {c.label}
                    </span>
                  </div>
                  <p className="text-[13px] text-grey-500 mb-1 truncate">{draft.lead_role}</p>
                  <p className="text-[12px] text-grey-400 truncate">{draft.campaign_name}</p>
                </button>
              );
            })}
          </section>

          {/* Right workspace */}
          {selected && (
            <section className="flex-1 bg-grey-50 overflow-y-auto">
              <div className="p-10 flex flex-col gap-6">
                {/* Contact info strip */}
                <div className="bg-white p-6 rounded-lg shadow-[0_1px_3px_rgba(27,45,91,0.08)] flex justify-between items-center">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-full bg-primary-fixed flex items-center justify-center font-bold text-[14px] text-on-primary-fixed">
                      {selected.lead_name.split(" ").map((n) => n[0]).join("").slice(0, 2)}
                    </div>
                    <div>
                      <h2 className="text-[20px] font-bold text-primary">{selected.lead_name}</h2>
                      <p className="text-[13px] text-grey-500 mt-0.5">{selected.lead_role}</p>
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <span className="bg-ocean-wash text-primary px-3 py-1 rounded text-[13px] font-medium capitalize">
                      {selected.persona}
                    </span>
                    <span className="bg-ocean-wash text-primary px-3 py-1 rounded text-[13px] font-medium">
                      {selected.campaign_name}
                    </span>
                  </div>
                </div>

                {/* Content grid */}
                <div className="grid grid-cols-12 gap-6">
                  {/* Email editor */}
                  <div className="col-span-8 flex flex-col gap-4">
                    <div className="bg-white rounded-lg border border-grey-100 flex flex-col min-h-[400px]">
                      <div className="px-3 py-2.5 bg-grey-50 border-b border-grey-100 flex justify-between items-center">
                        <span className="text-[11px] text-grey-500 uppercase tracking-wider truncate max-w-[70%]">
                          {selected.subject}
                        </span>
                      </div>
                      <textarea
                        className="flex-1 p-6 font-mono text-[13px] bg-transparent border-none focus:outline-none resize-none text-primary leading-relaxed min-h-[300px]"
                        spellCheck={false}
                        defaultValue={selected.body}
                        key={selected.id}
                      />
                      <div className="px-4 py-2 border-t border-grey-100 flex justify-between items-center">
                        <div className="flex gap-4">
                          <span className="text-[11px] text-grey-500">
                            Words: <span className={wc > 125 ? "text-danger" : "text-primary"}>{wc}</span>/125
                          </span>
                        </div>
                        <span className={`text-[11px] ${wc > 125 ? "text-danger" : "text-success"}`}>
                          {wc > 125 ? "⚠ Exceeds limit" : "✓ Optimal length"}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Right sidebar */}
                  <div className="col-span-4 flex flex-col gap-6">
                    <div className="bg-white rounded-lg shadow-[0_1px_3px_rgba(27,45,91,0.08)] overflow-hidden">
                      <div className={`px-6 py-3 flex justify-between items-center text-white ${conf.barClass}`}>
                        <span className="text-[13px] font-medium">Confidence Score</span>
                        <span className="text-[16px] font-semibold">{conf.label}</span>
                      </div>
                      <div className={`h-1.5 w-full ${conf.barClass} opacity-50`} />
                      <div className="p-6">
                        <div className="w-full bg-grey-100 h-2 rounded-full overflow-hidden mb-2">
                          <div className={`h-full rounded-full ${conf.barClass}`} style={{ width: `${selected.confidence_score}%` }} />
                        </div>
                        <p className="text-[13px] text-grey-500 text-right">{selected.confidence_score}%</p>
                      </div>
                    </div>
                  </div>
                </div>

                {showReject && (
                  <div className="bg-white p-4 rounded-lg border border-danger">
                    <p className="text-[13px] font-medium text-primary mb-2">Rejection reason (optional)</p>
                    <textarea
                      className="w-full border border-grey-200 rounded p-2 text-[13px] resize-none focus:outline-none focus:ring-2 focus:ring-danger/20"
                      rows={3}
                      placeholder="e.g. Too generic, please personalise further"
                      value={rejectReason}
                      onChange={(e) => setRejectReason(e.target.value)}
                    />
                    <div className="flex gap-2 mt-2">
                      <button
                        onClick={handleReject}
                        disabled={submitting}
                        className="px-4 py-2 bg-danger text-white text-[13px] font-semibold rounded-lg disabled:opacity-60"
                      >
                        {submitting ? "Rejecting…" : "Confirm Reject"}
                      </button>
                      <button
                        onClick={() => setShowReject(false)}
                        className="px-4 py-2 border border-grey-200 text-grey-700 text-[13px] font-semibold rounded-lg"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </section>
          )}
        </div>

        {/* Sticky footer actions */}
        <footer className="bg-white border-t border-grey-100 px-10 py-4 flex justify-between items-center shrink-0">
          <div className="flex items-center gap-4">
            <span className="text-[13px] text-grey-500">
              {selectedIdx + 1} of {drafts.length} in queue
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setSelectedIdx((i) => Math.max(0, i - 1))}
                disabled={selectedIdx === 0}
                className="w-8 h-8 flex items-center justify-center border border-grey-100 rounded hover:bg-grey-50 disabled:opacity-40 transition-colors"
              >
                <span className="material-symbols-outlined text-[20px] text-grey-500">chevron_left</span>
              </button>
              <button
                onClick={() => setSelectedIdx((i) => Math.min(drafts.length - 1, i + 1))}
                disabled={selectedIdx === drafts.length - 1}
                className="w-8 h-8 flex items-center justify-center border border-grey-100 rounded hover:bg-grey-50 disabled:opacity-40 transition-colors"
              >
                <span className="material-symbols-outlined text-[20px] text-grey-500">chevron_right</span>
              </button>
            </div>
          </div>
          <div className="flex gap-4">
            <button
              onClick={() => setShowReject((v) => !v)}
              disabled={submitting}
              className="px-6 py-2 border border-danger text-danger text-[14px] font-semibold rounded-lg hover:bg-danger-bg transition-colors duration-150 disabled:opacity-60"
            >
              Reject
            </button>
            <button
              onClick={handleApprove}
              disabled={submitting}
              className="px-8 py-2 bg-success text-white text-[14px] font-semibold rounded-lg shadow-[0_1px_3px_rgba(27,45,91,0.08)] active:scale-[0.98] transition-transform disabled:opacity-60"
            >
              {submitting ? "Approving…" : "Approve & Send"}
            </button>
          </div>
        </footer>
      </div>
    </>
  );
}
