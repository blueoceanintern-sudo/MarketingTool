"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Draft } from "@/lib/api";
import { approveDraft, editDraft, rejectDraft } from "@/lib/api";
import Pagination from "@/components/pagination";

const DRAFTS_PER_PAGE = 50;

type Tab = "queue" | "scheduled" | "sent";

interface Props {
  initialQueue: Draft[];
  initialScheduled: Draft[];
  initialSent: Draft[];
}

function confidenceLabel(score: number) {
  if (score >= 75) return { label: "High", className: "bg-success-bg text-success", barClass: "bg-success" };
  if (score >= 50) return { label: "Moderate", className: "bg-warning-bg text-warning", barClass: "bg-warning" };
  return { label: "Low", className: "bg-danger-bg text-danger", barClass: "bg-danger" };
}

function wordCount(text: string) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

// Groups drafts by campaign_name, preserving order.
function groupByCampaign(drafts: Draft[]): { campaign: string; drafts: Draft[] }[] {
  const map = new Map<string, Draft[]>();
  for (const d of drafts) {
    const group = map.get(d.campaign_name) ?? [];
    group.push(d);
    map.set(d.campaign_name, group);
  }
  return Array.from(map.entries()).map(([campaign, drafts]) => ({ campaign, drafts }));
}

// ── Scheduled / Sent table ────────────────────────────────────────────────────

function DraftsTable({ drafts, emptyMessage }: { drafts: Draft[]; emptyMessage: string }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const totalPages = Math.ceil(drafts.length / DRAFTS_PER_PAGE);
  const pageDrafts = drafts.slice((page - 1) * DRAFTS_PER_PAGE, page * DRAFTS_PER_PAGE);

  if (drafts.length === 0) {
    return (
      <div className="h-[calc(100vh-8rem)] flex items-center justify-center flex-col gap-4 text-grey-400">
        <span className="material-symbols-outlined text-[48px]">inbox</span>
        <p className="text-[16px] font-medium">{emptyMessage}</p>
      </div>
    );
  }

  const groups = groupByCampaign(pageDrafts);

  return (
    <div className="p-8 overflow-y-auto h-[calc(100vh-8rem)]">
      <div className="flex flex-col gap-8">
        {groups.map(({ campaign, drafts: groupDrafts }) => (
          <div key={campaign}>
            <h3 className="text-[13px] font-semibold text-grey-400 uppercase tracking-wider mb-3">{campaign}</h3>
            <div className="bg-white rounded-lg border border-grey-100 overflow-hidden">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-grey-100 text-grey-400 text-[11px] uppercase tracking-wider">
                    <th className="text-left px-4 py-3 font-medium">Lead</th>
                    <th className="text-left px-4 py-3 font-medium">Subject</th>
                    <th className="text-left px-4 py-3 font-medium w-24">Score</th>
                    <th className="text-left px-4 py-3 font-medium w-28">Date</th>
                    <th className="px-4 py-3 w-8" />
                  </tr>
                </thead>
                <tbody>
                  {groupDrafts.map((d) => {
                    const conf = confidenceLabel(d.confidence_score);
                    const isOpen = expanded === d.id;
                    return (
                      <>
                        <tr
                          key={d.id}
                          className="border-b border-grey-100 last:border-0 hover:bg-grey-50 cursor-pointer"
                          onClick={() => setExpanded(isOpen ? null : d.id)}
                        >
                          <td className="px-4 py-3">
                            <p className="font-medium text-primary">{d.lead_name}</p>
                            <p className="text-grey-400 text-[11px]">{d.lead_role}</p>
                          </td>
                          <td className="px-4 py-3 text-grey-600 truncate max-w-[300px]">{d.subject}</td>
                          <td className="px-4 py-3">
                            <span className={`px-2 py-0.5 text-[11px] font-medium rounded ${conf.className}`}>
                              {conf.label} ({Math.round(d.confidence_score)}%)
                            </span>
                          </td>
                          <td className="px-4 py-3 text-grey-400">
                            {new Date(d.created_at).toLocaleDateString()}
                          </td>
                          <td className="px-4 py-3 text-grey-400 text-center">
                            <span className="material-symbols-outlined text-[16px]">
                              {isOpen ? "expand_less" : "expand_more"}
                            </span>
                          </td>
                        </tr>
                        {isOpen && (
                          <tr key={`${d.id}-body`} className="bg-grey-50 border-b border-grey-100 last:border-0">
                            <td colSpan={5} className="px-6 py-4">
                              <pre className="font-mono text-[12px] text-grey-700 whitespace-pre-wrap leading-relaxed">
                                {d.body}
                              </pre>
                              <p className="text-[11px] text-grey-400 mt-2">{wordCount(d.body)} words</p>
                            </td>
                          </tr>
                        )}
                      </>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ))}

        {totalPages > 1 && (
          <div className="flex items-center justify-between bg-white rounded-lg border border-grey-100 px-5 py-3">
            <p className="text-[13px] text-grey-500">
              Showing {(page - 1) * DRAFTS_PER_PAGE + 1}–{Math.min(page * DRAFTS_PER_PAGE, drafts.length)} of {drafts.length}
            </p>
            <Pagination
              page={page}
              totalPages={totalPages}
              onPageChange={(p) => { setPage(p); setExpanded(null); }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ── Review queue (unchanged logic, new props shape) ───────────────────────────

function ReviewQueue({ initialDrafts }: { initialDrafts: Draft[] }) {
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
      <div className="h-[calc(100vh-8rem)] flex items-center justify-center flex-col gap-4 text-grey-400">
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
      <div className="h-[calc(100vh-8rem)] flex flex-col overflow-hidden">
        <div className="flex-1 flex overflow-hidden">
          <section className="w-[260px] lg:w-[320px] bg-white border-r border-grey-100 flex flex-col overflow-y-auto shrink-0">
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
              <div className="p-4 sm:p-6 lg:p-10 flex flex-col gap-6">
                <div className="bg-white p-6 rounded-lg shadow-[0_1px_3px_rgba(27,45,91,0.08)]">
                  <h2 className="text-[20px] font-bold text-primary">{selected.lead_name}</h2>
                  <p className="text-[13px] text-grey-500">{selected.subject}</p>
                  <p className="text-[11px] text-grey-400 mt-2">
                    {saving ? "Saving…" : lastSaved ? `Saved ${lastSaved.toLocaleTimeString()}` : "Edits auto-save"}
                  </p>
                  {saveError && <p className="text-[13px] text-danger mt-1">{saveError}</p>}
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
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

        <footer className="bg-white border-t border-grey-100 px-4 sm:px-6 lg:px-10 py-4 flex justify-end gap-4 shrink-0">
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
            {submitting ? "Approving…" : "Approve & Schedule"}
          </button>
        </footer>
      </div>
    </>
  );
}

// ── Root tabbed component ─────────────────────────────────────────────────────

export default function DraftsClient({ initialQueue, initialScheduled, initialSent }: Props) {
  const [tab, setTab] = useState<Tab>("queue");

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: "queue", label: "Review Queue", count: initialQueue.length },
    { key: "scheduled", label: "Scheduled", count: initialScheduled.length },
    { key: "sent", label: "Sent", count: initialSent.length },
  ];

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      <div className="bg-white border-b border-grey-100 px-8 flex gap-6 shrink-0">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={[
              "py-4 text-[14px] font-medium border-b-2 transition-colors",
              tab === t.key
                ? "border-primary text-primary"
                : "border-transparent text-grey-400 hover:text-grey-600",
            ].join(" ")}
          >
            {t.label}
            <span
              className={[
                "ml-2 px-2 py-0.5 rounded-full text-[11px] font-semibold",
                tab === t.key ? "bg-primary text-white" : "bg-grey-100 text-grey-500",
              ].join(" ")}
            >
              {t.count}
            </span>
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-hidden">
        {tab === "queue" && <ReviewQueue initialDrafts={initialQueue} />}
        {tab === "scheduled" && (
          <DraftsTable drafts={initialScheduled} emptyMessage="No drafts scheduled for sending." />
        )}
        {tab === "sent" && (
          <DraftsTable drafts={initialSent} emptyMessage="No emails sent yet." />
        )}
      </div>
    </div>
  );
}
