"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Draft } from "@/lib/api";
import { approveDraft, editDraft, rejectDraft } from "@/lib/api";

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
  const pending = initialDrafts.filter((d) => d.status === "pending_review");
  const [drafts, setDrafts] = useState<Draft[]>(pending);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [bodyEdits, setBodyEdits] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [showReject, setShowReject] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const selected = drafts[selectedIdx];
  const selectedBody = selected ? (bodyEdits[selected.id] ?? selected.body) : "";

  const persistBody = useCallback(async (draft: Draft, body: string) => {
    if (body === draft.body) return;
    setSaving(true);
    setSaveError(null);
    const { draft: updated, error } = await editDraft(draft.id, { body });
    setSaving(false);
    if (error || !updated) {
      setSaveError(error ?? "Failed to save");
      return;
    }
    setDrafts((prev) => prev.map((d) => (d.id === updated.id ? updated : d)));
    setBodyEdits((prev) => {
      const next = { ...prev };
      delete next[draft.id];
      return next;
    });
    setLastSaved(new Date());
  }, []);

  useEffect(() => {
    if (!selected) return;
    const body = bodyEdits[selected.id];
    if (body === undefined || body === selected.body) return;

    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void persistBody(selected, body);
    }, 800);

    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [bodyEdits, selected, persistBody]);

  async function handleApprove() {
    if (!selected) return;
    setSubmitting(true);
    const body = bodyEdits[selected.id];
    if (body !== undefined && body !== selected.body) {
      await persistBody(selected, body);
    }
    const ok = await approveDraft(selected.id);
    setSubmitting(false);
    if (!ok) {
      setSaveError("Could not approve — check the backend is running.");
      return;
    }
    setDrafts((prev) => prev.filter((d) => d.id !== selected.id));
    setSelectedIdx(0);
    setShowReject(false);
  }

  async function handleReject() {
    if (!selected) return;
    setSubmitting(true);
    const ok = await rejectDraft(selected.id, rejectReason);
    setSubmitting(false);
    if (!ok) {
      setSaveError("Could not reject — check the backend is running.");
      return;
    }
    setDrafts((prev) => prev.filter((d) => d.id !== selected.id));
    setSelectedIdx(0);
    setRejectReason("");
    setShowReject(false);
  }

  if (drafts.length === 0) {
    return (
      <div className="h-[calc(100vh-4rem)] flex items-center justify-center flex-col gap-4 text-grey-400">
        <span className="material-symbols-outlined text-[48px]">check_circle</span>
        <p className="text-[16px] font-medium">Review queue is empty</p>
        <p className="text-[13px]">Generate drafts from a campaign or wait for new leads.</p>
      </div>
    );
  }

  const conf = confidenceLabel(selected?.confidence_score ?? 0);
  const wc = wordCount(selectedBody);

  return (
    <>
      <div className="h-[calc(100vh-4rem)] flex flex-col overflow-hidden">
        <div className="flex-1 flex overflow-hidden">
          <section className="w-[320px] bg-white border-r border-grey-100 flex flex-col overflow-y-auto shrink-0">
            <div className="px-5 py-4 border-b border-grey-100 sticky top-0 bg-white z-10">
              <h2 className="text-[16px] font-semibold text-primary">Queue ({drafts.length})</h2>
            </div>
            {drafts.map((draft, idx) => {
              const c = confidenceLabel(draft.confidence_score);
              return (
                <button
                  key={draft.id}
                  type="button"
                  onClick={() => {
                    setSelectedIdx(idx);
                    setShowReject(false);
                    setSaveError(null);
                  }}
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
                  <p className="text-[13px] text-grey-500 truncate">{draft.lead_role}</p>
                </button>
              );
            })}
          </section>

          {selected && (
            <section className="flex-1 bg-grey-50 overflow-y-auto">
              <div className="p-10 flex flex-col gap-6">
                <div className="bg-white p-6 rounded-lg shadow-[0_1px_3px_rgba(27,45,91,0.08)]">
                  <h2 className="text-[20px] font-bold text-primary">{selected.lead_name}</h2>
                  <p className="text-[13px] text-grey-500">{selected.subject}</p>
                  <p className="text-[11px] text-grey-400 mt-2">
                    {saving ? "Saving…" : lastSaved ? `Saved ${lastSaved.toLocaleTimeString()}` : "Edits auto-save"}
                  </p>
                  {saveError && <p className="text-[13px] text-danger mt-1">{saveError}</p>}
                </div>

                <div className="grid grid-cols-12 gap-6">
                  <div className="col-span-8">
                    <div className="bg-white rounded-lg border border-grey-100 flex flex-col min-h-[400px]">
                      <textarea
                        className="flex-1 p-6 font-mono text-[13px] bg-transparent border-none focus:outline-none resize-none min-h-[300px]"
                        spellCheck={false}
                        value={selectedBody}
                        onChange={(e) =>
                          setBodyEdits((prev) => ({ ...prev, [selected.id]: e.target.value }))
                        }
                      />
                      <div className="px-4 py-2 border-t border-grey-100 text-[11px] text-grey-500">
                        Words: <span className={wc > 125 ? "text-danger" : "text-primary"}>{wc}</span>/125
                      </div>
                    </div>
                  </div>
                  <div className="col-span-4">
                    <div className="bg-white rounded-lg shadow-[0_1px_3px_rgba(27,45,91,0.08)] p-6">
                      <p className="text-[13px] font-medium mb-2">Confidence Score</p>
                      <div className="w-full bg-grey-100 h-2 rounded-full overflow-hidden mb-2">
                        <div
                          className={`h-full rounded-full ${conf.barClass} transition-all duration-300`}
                          style={{ width: `${selected.confidence_score}%` }}
                        />
                      </div>
                      <p className="text-[13px] text-grey-500 text-right">{Math.round(selected.confidence_score)}%</p>
                    </div>
                  </div>
                </div>

                {showReject && (
                  <div className="bg-white p-4 rounded-lg border border-danger">
                    <textarea
                      className="w-full border border-grey-200 rounded p-2 text-[13px] resize-none"
                      rows={3}
                      placeholder="Rejection reason (optional)"
                      value={rejectReason}
                      onChange={(e) => setRejectReason(e.target.value)}
                    />
                    <div className="flex gap-2 mt-2">
                      <button
                        type="button"
                        onClick={handleReject}
                        disabled={submitting}
                        className="px-4 py-2 bg-danger text-white text-[13px] font-semibold rounded-lg"
                      >
                        Confirm Reject
                      </button>
                      <button type="button" onClick={() => setShowReject(false)} className="px-4 py-2 border rounded-lg">
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </section>
          )}
        </div>

        <footer className="bg-white border-t border-grey-100 px-10 py-4 flex justify-end gap-4 shrink-0">
          <button
            type="button"
            onClick={() => setShowReject(true)}
            disabled={submitting}
            className="px-6 py-2 border border-danger text-danger font-semibold rounded-lg"
          >
            Reject
          </button>
          <button
            type="button"
            onClick={handleApprove}
            disabled={submitting || saving}
            className="px-8 py-2 bg-success text-white font-semibold rounded-lg disabled:opacity-60"
          >
            {submitting ? "Approving…" : "Approve & Send"}
          </button>
        </footer>
      </div>
    </>
  );
}
