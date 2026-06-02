"use client";

import { useState } from "react";
import type { Reply, Sentiment } from "@/lib/api";
import { resolveReply } from "@/lib/api";
import BookDemoModal from "@/components/book-demo-modal";

const sentimentConfig: Record<Sentiment, { label: string; className: string; icon: string }> = {
  positive: { label: "Positive",  className: "bg-success-bg text-success",   icon: "thumb_up" },
  negative: { label: "Negative",  className: "bg-danger-bg text-danger",     icon: "thumb_down" },
  neutral:  { label: "Neutral",   className: "bg-neutral-bg text-neutral",   icon: "remove" },
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-SG", {
    day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

interface Props {
  initialReplies: Reply[];
}

export default function RepliesClient({ initialReplies }: Props) {
  const replies = initialReplies;
  const [selected, setSelected] = useState<Reply | null>(replies[0] ?? null);
  const [filter, setFilter] = useState<"all" | Sentiment>("all");
  const [resolved, setResolved] = useState<Set<string>>(new Set());
  const [demoModal, setDemoModal] = useState<Reply | null>(null);

  const visible = filter === "all" ? replies : replies.filter((r) => r.sentiment === filter);

  if (replies.length === 0) {
    return (
      <div className="p-10 text-center text-grey-400">
        <p className="text-[16px] font-medium">No replies yet</p>
        <p className="text-[13px] mt-2">Replies appear when leads respond to outreach.</p>
      </div>
    );
  }

  return (
    <>
      <div className="h-[calc(100vh-4rem)] flex flex-col overflow-hidden">
        {/* Header bar */}
        <div className="bg-white border-b border-grey-100 px-4 sm:px-6 lg:px-10 py-4 flex items-center justify-between shrink-0 flex-wrap gap-3">
          <div>
            <h1 className="text-[20px] font-bold text-primary">Replies</h1>
            <p className="text-[13px] text-grey-500 mt-0.5">
              Inbound replies classified by AI — review and route.
            </p>
          </div>
          <div className="flex gap-2">
            {(["all", "positive", "neutral", "negative"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={[
                  "px-3 py-1.5 rounded-lg text-[13px] font-medium capitalize transition-colors",
                  filter === f
                    ? "bg-primary text-white"
                    : "bg-grey-50 border border-grey-100 text-grey-700 hover:bg-ocean-wash",
                ].join(" ")}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        {/* Split pane */}
        <div className="flex-1 flex overflow-hidden">
          {/* Left list */}
          <section className="w-[260px] lg:w-[340px] bg-white border-r border-grey-100 flex flex-col overflow-y-auto shrink-0">
            {visible.length === 0 ? (
              <div className="flex-1 flex items-center justify-center text-grey-300 text-[13px]">
                No replies
              </div>
            ) : (
              visible.map((r) => {
                const cfg = sentimentConfig[r.sentiment];
                const isResolved = resolved.has(r.id);
                return (
                  <button
                    key={r.id}
                    onClick={() => setSelected(r)}
                    className={[
                      "w-full text-left p-4 border-b border-grey-100 transition-colors",
                      selected?.id === r.id
                        ? "bg-ocean-wash border-l-4 border-l-primary"
                        : "hover:bg-grey-50 border-l-4 border-l-transparent",
                      isResolved ? "opacity-50" : "",
                    ].join(" ")}
                  >
                    <div className="flex items-start justify-between mb-1">
                      <span className="text-[14px] font-semibold text-primary truncate max-w-[160px]">
                        {r.lead_name}
                      </span>
                      <span className={`px-2 py-0.5 text-[11px] font-medium rounded-full shrink-0 ${cfg.className}`}>
                        {cfg.label}
                      </span>
                    </div>
                    <p className="text-[12px] text-grey-500 mb-1">{r.lead_company}</p>
                    <p className="text-[12px] text-grey-700 line-clamp-2 leading-relaxed">{r.body}</p>
                    <div className="flex items-center justify-between mt-2">
                      <span className="text-[11px] text-grey-300">{formatDate(r.received_at)}</span>
                      {r.is_flagged && (
                        <span className="material-symbols-outlined text-warning text-[14px]">flag</span>
                      )}
                    </div>
                  </button>
                );
              })
            )}
          </section>

          {/* Right detail */}
          <section className="flex-1 bg-grey-50 overflow-y-auto p-4 sm:p-6 lg:p-8 flex flex-col gap-6">
            {selected && (
              <>
                {/* Contact card */}
                <div className="bg-white rounded-lg border border-grey-100 shadow-[0_1px_3px_rgba(27,45,91,0.08)] p-6">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-4">
                      <div className="w-11 h-11 rounded-full bg-primary-fixed flex items-center justify-center text-on-primary-fixed font-bold text-sm">
                        {selected.lead_name.split(" ").map((n) => n[0]).join("").slice(0, 2)}
                      </div>
                      <div>
                        <h2 className="text-[16px] font-bold text-primary">{selected.lead_name}</h2>
                        <p className="text-[13px] text-grey-500">{selected.lead_email}</p>
                        <p className="text-[12px] text-grey-400 mt-0.5">{selected.lead_company}</p>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <span className={`px-3 py-1 text-[13px] font-medium rounded-full ${sentimentConfig[selected.sentiment].className}`}>
                        {sentimentConfig[selected.sentiment].label}
                      </span>
                      <span className="text-[11px] text-grey-400">{selected.campaign_name}</span>
                    </div>
                  </div>
                </div>

                {/* Reply body */}
                <div className="bg-white rounded-lg border border-grey-100 shadow-[0_1px_3px_rgba(27,45,91,0.08)] p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-[14px] font-semibold text-primary">Reply</h3>
                    <span className="text-[11px] text-grey-400">{formatDate(selected.received_at)}</span>
                  </div>
                  <p className="text-[14px] text-grey-700 leading-relaxed whitespace-pre-wrap">
                    {selected.body}
                  </p>
                </div>

                {/* Category chip */}
                <div className="flex items-center gap-3">
                  <span className="text-[13px] text-grey-500">AI Classification:</span>
                  <span className="flex items-center gap-1.5 px-3 py-1 bg-white border border-grey-100 rounded-full text-[13px] font-medium text-primary">
                    <span className="material-symbols-outlined text-[16px]">
                      {sentimentConfig[selected.sentiment].icon}
                    </span>
                    {selected.category}
                  </span>
                  {selected.is_flagged && (
                    <span className="flex items-center gap-1.5 px-3 py-1 bg-warning-bg border border-warning rounded-full text-[13px] font-medium text-warning">
                      <span className="material-symbols-outlined text-[16px]">flag</span>
                      Flagged for Review
                    </span>
                  )}
                </div>

                {/* Action buttons */}
                <div className="flex gap-3">
                  {selected.sentiment === "positive" && !resolved.has(selected.id) && (
                    <button
                      onClick={() => setDemoModal(selected)}
                      className="flex items-center gap-2 px-5 py-2.5 bg-success text-white text-[14px] font-semibold rounded-lg shadow-[0_1px_3px_rgba(27,45,91,0.08)] active:scale-[0.98] transition-transform"
                    >
                      <span className="material-symbols-outlined text-[18px]">event_available</span>
                      Book Demo
                    </button>
                  )}
                  {!resolved.has(selected.id) && (
                    <button
                      onClick={async () => {
                        await resolveReply(selected.id);
                        setResolved((prev) => new Set(prev).add(selected.id));
                      }}
                      className="flex items-center gap-2 px-5 py-2.5 border border-grey-200 text-grey-700 text-[14px] font-semibold rounded-lg hover:bg-grey-50 transition-colors"
                    >
                      <span className="material-symbols-outlined text-[18px]">check_circle</span>
                      Mark Resolved
                    </button>
                  )}
                  {resolved.has(selected.id) && (
                    <span className="flex items-center gap-2 px-5 py-2.5 text-success text-[14px] font-semibold">
                      <span className="material-symbols-outlined text-[18px]">check_circle</span>
                      Resolved
                    </span>
                  )}
                  <button className="flex items-center gap-2 px-5 py-2.5 border border-grey-200 text-grey-700 text-[14px] font-semibold rounded-lg hover:bg-grey-50 transition-colors">
                    <span className="material-symbols-outlined text-[18px]">reply</span>
                    Reply Manually
                  </button>
                  {selected.sentiment === "negative" && (
                    <button className="flex items-center gap-2 px-5 py-2.5 border border-danger text-danger text-[14px] font-semibold rounded-lg hover:bg-danger-bg transition-colors">
                      <span className="material-symbols-outlined text-[18px]">block</span>
                      Suppress Lead
                    </button>
                  )}
                </div>
              </>
            )}
          </section>
        </div>
      </div>

      {demoModal && (
        <BookDemoModal
          reply={demoModal}
          onClose={() => setDemoModal(null)}
          onBooked={() => {
            setResolved((prev) => new Set(prev).add(demoModal.id));
            setDemoModal(null);
          }}
        />
      )}
    </>
  );
}
