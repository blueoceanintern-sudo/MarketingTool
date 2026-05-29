"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, type SubmitEvent } from "react";
import { createCampaign, type Campaign, type CampaignStatus } from "@/lib/api";

const statusConfig: Record<CampaignStatus, { label: string; className: string }> = {
  active: { label: "Active", className: "bg-success-bg text-success" },
  paused: { label: "Paused", className: "bg-neutral-bg text-neutral" },
  draft: { label: "Draft", className: "bg-neutral-bg text-neutral" },
  complete: { label: "Complete", className: "bg-grey-100 text-grey-500" },
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-SG", { day: "numeric", month: "short", year: "numeric" });
}

interface Props {
  initialCampaigns: Campaign[];
}

export default function CampaignsClient({ initialCampaigns }: Props) {
  const router = useRouter();
  const [campaigns, setCampaigns] = useState(initialCampaigns);
  const [statusFilter, setStatusFilter] = useState<CampaignStatus | "all">("all");
  const [showModal, setShowModal] = useState(false);
  const [modalStep, setModalStep] = useState<1 | 2>(1);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    vertical: "",
    geography: "SG",
    company_size_target: "medium",
    description: "",
    pain_points: "",
    call_to_action: "",
  });

  function resetForm() {
    setForm({
      name: "",
      vertical: "",
      geography: "SG",
      company_size_target: "medium",
      description: "",
      pain_points: "",
      call_to_action: "",
    });
    setModalStep(1);
    setFormError(null);
  }

  function closeModal() {
    setShowModal(false);
    resetForm();
  }

  function handleNext(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!form.name.trim() || !form.vertical.trim() || !form.geography.trim()) {
      setFormError("Name, vertical, and geography are required.");
      return;
    }
    setFormError(null);
    setModalStep(2);
  }

  const filtered = useMemo(
    () => (statusFilter === "all" ? campaigns : campaigns.filter((c) => c.status === statusFilter)),
    [campaigns, statusFilter]
  );

  const totalLeads = campaigns.reduce((s, c) => s + c.leads_count, 0);
  const avgOpenRate =
    campaigns.length ? Math.round((campaigns.reduce((s, c) => s + c.open_rate, 0) / campaigns.length) * 10) / 10 : 0;
  const totalSent = campaigns.reduce((s, c) => s + c.sent, 0);
  const totalPending = campaigns.reduce((s, c) => s + c.drafts_pending, 0);

  async function handleCreate(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setFormError(null);
    const painPoints = form.pain_points
      .split("\n")
      .map((p) => p.trim())
      .filter(Boolean);
    const { campaign, error } = await createCampaign({
      name: form.name.trim(),
      vertical: form.vertical.trim(),
      geography: form.geography.split(",").map((g) => g.trim().toUpperCase()).filter(Boolean),
      company_size_target: form.company_size_target,
      status: "draft",
      description: form.description.trim() || null,
      pain_points: painPoints,
      call_to_action: form.call_to_action.trim() || null,
    });
    setSubmitting(false);
    if (error || !campaign) {
      setFormError(error ?? "Failed to create campaign");
      return;
    }
    setCampaigns((prev) => [campaign, ...prev]);
    setShowModal(false);
    resetForm();
    router.push(`/campaigns/${campaign.id}`);
  }

  return (
    <div className="p-4 sm:p-6 lg:p-10 max-w-[1600px] mx-auto">
      <div className="flex justify-between items-end mb-8">
        <div>
          <h2 className="text-[20px] font-bold text-primary">Campaigns</h2>
          <p className="text-[13px] text-grey-500 mt-1">Manage outreach campaigns.</p>
        </div>
        <button
          type="button"
          onClick={() => setShowModal(true)}
          className="flex items-center gap-2 px-6 py-2 bg-primary text-white rounded-lg text-[14px] font-semibold"
        >
          <span className="material-symbols-outlined text-[20px]">add</span>
          New Campaign
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-6 mb-8">
        <div className="bg-white p-5 rounded-lg border border-grey-100">
          <p className="text-[13px] text-grey-500">Active Leads</p>
          <h3 className="text-[24px] font-bold font-mono mt-2">{totalLeads.toLocaleString()}</h3>
        </div>
        <div className="bg-white p-5 rounded-lg border border-grey-100">
          <p className="text-[13px] text-grey-500">Avg. Open Rate</p>
          <h3 className="text-[24px] font-bold font-mono mt-2">{avgOpenRate}%</h3>
        </div>
        <div className="bg-white p-5 rounded-lg border border-grey-100">
          <p className="text-[13px] text-grey-500">Total Sent</p>
          <h3 className="text-[24px] font-bold font-mono mt-2">{totalSent.toLocaleString()}</h3>
        </div>
        <div className="bg-white p-5 rounded-lg border border-grey-100">
          <p className="text-[13px] text-grey-500">Pending Drafts</p>
          <h3 className="text-[24px] font-bold font-mono mt-2">{totalPending}</h3>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-grey-100 overflow-hidden">
        <div className="px-5 py-4 border-b border-grey-100 flex justify-between items-center bg-grey-50 flex-wrap gap-2">
          <div className="flex gap-2 flex-wrap">
            {(["all", "active", "draft", "paused", "complete"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStatusFilter(s)}
                className={[
                  "px-3 py-1.5 rounded text-[13px] font-medium border",
                  statusFilter === s ? "bg-primary text-white border-primary" : "bg-white border-grey-100",
                ].join(" ")}
              >
                {s === "all" ? "All Statuses" : statusConfig[s as CampaignStatus].label}
              </button>
            ))}
          </div>
          <p className="text-[13px] text-grey-500">Showing {filtered.length} campaigns</p>
        </div>

        {filtered.length === 0 ? (
          <p className="px-6 py-16 text-center text-grey-400 text-[14px]">
            {campaigns.length === 0 ? "No campaigns yet." : "No campaigns match this filter."}
          </p>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead className="bg-grey-50">
              <tr className="text-left border-b border-grey-100">
                <th className="px-6 py-4 text-[14px] font-semibold">Name</th>
                <th className="px-4 py-4 text-[14px] font-semibold">Vertical</th>
                <th className="px-4 py-4 text-[14px] font-semibold text-center">Geo</th>
                <th className="px-4 py-4 text-[14px] font-semibold text-center">Status</th>
                <th className="px-4 py-4 text-[14px] font-semibold text-right">Leads</th>
                <th className="px-4 py-4 text-[14px] font-semibold">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-grey-100">
              {filtered.map((c) => {
                const badge = statusConfig[c.status];
                return (
                  <tr key={c.id} className="hover:bg-ocean-wash">
                    <td className="px-6 py-3">
                      <Link href={`/campaigns/${c.id}`} className="font-bold text-primary hover:underline">
                        {c.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-[13px]">{c.vertical}</td>
                    <td className="px-4 py-3 text-center text-[12px]">{c.geography.join(", ")}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`px-2 py-0.5 text-xs font-bold rounded-full ${badge.className}`}>
                        {badge.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-[13px]">{c.leads_count}</td>
                    <td className="px-4 py-3 text-[13px] text-grey-500">{formatDate(c.created_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        )}
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="bg-white rounded-lg w-full max-w-md p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-[18px] font-bold">New Campaign</h3>
              <span className="text-[12px] text-grey-400">Step {modalStep} of 2</span>
            </div>
            <p className="text-[12px] text-grey-500 mb-4">
              {modalStep === 1
                ? "Required details"
                : "Campaign context (optional) — helps the AI personalise emails for this campaign."}
            </p>

            {modalStep === 1 ? (
              <form onSubmit={handleNext} className="flex flex-col gap-4">
                <label className="flex flex-col gap-1 text-[13px]">
                  Name
                  <input
                    required
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    className="border border-grey-200 rounded-lg px-3 py-2"
                  />
                </label>
                <label className="flex flex-col gap-1 text-[13px]">
                  Vertical
                  <input
                    required
                    value={form.vertical}
                    onChange={(e) => setForm((f) => ({ ...f, vertical: e.target.value }))}
                    className="border border-grey-200 rounded-lg px-3 py-2"
                  />
                </label>
                <label className="flex flex-col gap-1 text-[13px]">
                  Geography (e.g. SG, AU)
                  <input
                    required
                    value={form.geography}
                    onChange={(e) => setForm((f) => ({ ...f, geography: e.target.value }))}
                    className="border border-grey-200 rounded-lg px-3 py-2"
                  />
                </label>
                <label className="flex flex-col gap-1 text-[13px]">
                  Company size
                  <select
                    value={form.company_size_target}
                    onChange={(e) => setForm((f) => ({ ...f, company_size_target: e.target.value }))}
                    className="border border-grey-200 rounded-lg px-3 py-2"
                  >
                    <option value="small">Small</option>
                    <option value="medium">Medium</option>
                    <option value="large">Large</option>
                    <option value="enterprise">Enterprise</option>
                  </select>
                </label>
                {formError && <p className="text-danger text-[13px]">{formError}</p>}
                <div className="flex gap-3 justify-end">
                  <button type="button" onClick={closeModal} className="px-4 py-2 border rounded-lg">
                    Cancel
                  </button>
                  <button type="submit" className="px-6 py-2 bg-primary text-white rounded-lg">
                    Next
                  </button>
                </div>
              </form>
            ) : (
              <form onSubmit={handleCreate} className="flex flex-col gap-4">
                <label className="flex flex-col gap-1 text-[13px]">
                  Goal / value proposition
                  <textarea
                    rows={2}
                    value={form.description}
                    onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                    placeholder="e.g. Help SG international schools cut admissions admin time by 40%"
                    className="border border-grey-200 rounded-lg px-3 py-2"
                  />
                </label>
                <label className="flex flex-col gap-1 text-[13px]">
                  Pain points (one per line)
                  <textarea
                    rows={3}
                    value={form.pain_points}
                    onChange={(e) => setForm((f) => ({ ...f, pain_points: e.target.value }))}
                    placeholder={"Manual application processing\nSlow parent response times\nDisconnected admissions data"}
                    className="border border-grey-200 rounded-lg px-3 py-2 font-mono text-[12px]"
                  />
                </label>
                <label className="flex flex-col gap-1 text-[13px]">
                  Preferred call to action
                  <input
                    value={form.call_to_action}
                    onChange={(e) => setForm((f) => ({ ...f, call_to_action: e.target.value }))}
                    placeholder="e.g. Book a 15-min admissions walkthrough"
                    className="border border-grey-200 rounded-lg px-3 py-2"
                  />
                </label>
                {formError && <p className="text-danger text-[13px]">{formError}</p>}
                <div className="flex gap-3 justify-between">
                  <button type="button" onClick={() => setModalStep(1)} className="px-4 py-2 border rounded-lg">
                    Back
                  </button>
                  <div className="flex gap-3">
                    <button type="button" onClick={closeModal} className="px-4 py-2 border rounded-lg">
                      Cancel
                    </button>
                    <button type="submit" disabled={submitting} className="px-6 py-2 bg-primary text-white rounded-lg">
                      {submitting ? "Creating…" : "Create"}
                    </button>
                  </div>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
