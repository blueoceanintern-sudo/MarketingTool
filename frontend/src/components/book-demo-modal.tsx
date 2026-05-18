"use client";

import { useState } from "react";
import type { Reply } from "@/lib/api";
import { bookDemo } from "@/lib/api";

interface Props {
  reply: Reply;
  onClose: () => void;
  onBooked: () => void;
}

const REPS = ["Alice Tan", "Ben Okafor", "Clara Singh", "David Mur"];

export default function BookDemoModal({ reply, onClose, onBooked }: Props) {
  const [assignee, setAssignee] = useState(REPS[0]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    const result = await bookDemo({
      lead_id: reply.lead_id,
      campaign_id: reply.campaign_id,
      reply_id: reply.id,
      assigned_to: assignee,
    });
    setSubmitting(false);
    if (result) {
      onBooked();
    } else {
      setError("Failed to book demo. Please try again.");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl w-[480px] p-8 relative">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 material-symbols-outlined text-grey-400 hover:text-primary transition-colors"
        >
          close
        </button>

        <div className="mb-6">
          <h2 className="text-[18px] font-bold text-primary mb-1">Book a Demo</h2>
          <p className="text-[13px] text-grey-500">
            A demo record will be created and assigned to the selected rep.
          </p>
        </div>

        {/* Lead summary */}
        <div className="flex items-center gap-3 p-4 bg-grey-50 rounded-lg border border-grey-100 mb-6">
          <div className="w-10 h-10 rounded-full bg-success-bg flex items-center justify-center text-success font-bold text-sm shrink-0">
            {reply.lead_name.split(" ").map((n) => n[0]).join("").slice(0, 2)}
          </div>
          <div>
            <p className="text-[14px] font-semibold text-primary">{reply.lead_name}</p>
            <p className="text-[12px] text-grey-500">{reply.lead_email} · {reply.lead_company}</p>
          </div>
          <span className="ml-auto px-2 py-0.5 bg-success-bg text-success text-[11px] font-medium rounded-full">
            Positive Reply
          </span>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          <div>
            <label className="block text-[13px] font-medium text-grey-700 mb-1.5">
              Assign to Rep
            </label>
            <select
              value={assignee}
              onChange={(e) => setAssignee(e.target.value)}
              className="w-full border border-grey-200 rounded-lg px-3 py-2 text-[14px] text-primary bg-white focus:outline-none focus:ring-2 focus:ring-primary/20"
            >
              {REPS.map((rep) => (
                <option key={rep} value={rep}>{rep}</option>
              ))}
            </select>
          </div>

          <div className="p-3 bg-ocean-wash rounded-lg border border-primary/10 text-[13px] text-primary flex gap-2 items-start">
            <span className="material-symbols-outlined text-[18px] shrink-0 mt-0.5">info</span>
            <span>
              The rep will be notified via the dashboard. A <strong>pending</strong> demo record
              will appear under <em>Demos</em>.
            </span>
          </div>

          {error && (
            <p className="text-[13px] text-danger">{error}</p>
          )}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 border border-grey-200 rounded-lg text-[14px] font-semibold text-grey-700 hover:bg-grey-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 py-2.5 bg-success text-white rounded-lg text-[14px] font-semibold shadow-[0_1px_3px_rgba(27,45,91,0.08)] disabled:opacity-60 active:scale-[0.98] transition-transform"
            >
              {submitting ? "Booking…" : "Confirm Demo"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
