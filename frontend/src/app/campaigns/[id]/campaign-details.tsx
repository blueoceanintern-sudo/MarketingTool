"use client";

import { useRouter } from "next/navigation";
import { useState, type SubmitEvent } from "react";
import { updateCampaign, type Campaign } from "@/lib/api";

interface Props {
  campaign: Campaign;
}

const sizeLabel: Record<string, string> = {
  small: "Small",
  medium: "Medium",
  large: "Large",
  enterprise: "Enterprise",
};

export default function CampaignDetails({ campaign }: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: campaign.name,
    vertical: campaign.vertical,
    geography: campaign.geography.join(", "),
    company_size_target: campaign.company_size_target,
    description: campaign.description ?? "",
    pain_points: campaign.pain_points.join("\n"),
    call_to_action: campaign.call_to_action ?? "",
  });

  function openEdit() {
    setForm({
      name: campaign.name,
      vertical: campaign.vertical,
      geography: campaign.geography.join(", "),
      company_size_target: campaign.company_size_target,
      description: campaign.description ?? "",
      pain_points: campaign.pain_points.join("\n"),
      call_to_action: campaign.call_to_action ?? "",
    });
    setFormError(null);
    setEditing(true);
  }

  async function handleSave(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    const painPoints = form.pain_points
      .split("\n")
      .map((p) => p.trim())
      .filter(Boolean);
    const { error } = await updateCampaign(campaign.id, {
      name: form.name.trim(),
      vertical: form.vertical.trim(),
      geography: form.geography.split(",").map((g) => g.trim().toUpperCase()).filter(Boolean),
      company_size_target: form.company_size_target,
      description: form.description.trim() || null,
      pain_points: painPoints,
      call_to_action: form.call_to_action.trim() || null,
    });
    setSaving(false);
    if (error) {
      setFormError(error);
      return;
    }
    setEditing(false);
    router.refresh();
  }

  const hasContext =
    !!campaign.description || campaign.pain_points.length > 0 || !!campaign.call_to_action;

  return (
    <div className="bg-white rounded-lg shadow-[0_1px_3px_rgba(27,45,91,0.08)] border border-grey-100 mb-8">
      <div className="px-6 py-4 border-b border-grey-100 flex items-center justify-between bg-grey-50">
        <h3 className="text-[14px] font-semibold text-primary">Campaign Details</h3>
        <button
          type="button"
          onClick={openEdit}
          className="flex items-center gap-1.5 px-3 py-1.5 border border-grey-200 rounded-lg text-[13px] font-medium text-grey-700 hover:bg-white"
        >
          <span className="material-symbols-outlined text-[16px]">edit</span>
          Edit
        </button>
      </div>

      <div className="px-6 py-5 grid grid-cols-3 gap-x-8 gap-y-4 text-[13px]">
        <div>
          <p className="text-grey-500 mb-1">Vertical</p>
          <p className="text-primary font-medium">{campaign.vertical}</p>
        </div>
        <div>
          <p className="text-grey-500 mb-1">Geography</p>
          <p className="text-primary font-medium">{campaign.geography.join(", ") || "—"}</p>
        </div>
        <div>
          <p className="text-grey-500 mb-1">Company size</p>
          <p className="text-primary font-medium">
            {sizeLabel[campaign.company_size_target] ?? campaign.company_size_target}
          </p>
        </div>
      </div>

      <div className="px-6 pb-5 border-t border-grey-100 pt-5">
        <p className="text-[12px] font-semibold text-grey-500 uppercase tracking-wide mb-3">
          Drafting context
        </p>
        {hasContext ? (
          <div className="grid grid-cols-1 gap-4 text-[13px]">
            <div>
              <p className="text-grey-500 mb-1">Goal / value proposition</p>
              <p className="text-primary leading-relaxed">
                {campaign.description ?? <span className="text-grey-400 italic">Not set</span>}
              </p>
            </div>
            <div>
              <p className="text-grey-500 mb-1">Pain points</p>
              {campaign.pain_points.length > 0 ? (
                <ul className="list-disc pl-5 text-primary leading-relaxed space-y-0.5">
                  {campaign.pain_points.map((p, i) => <li key={i}>{p}</li>)}
                </ul>
              ) : (
                <p className="text-grey-400 italic">Not set</p>
              )}
            </div>
            <div>
              <p className="text-grey-500 mb-1">Call to action</p>
              <p className="text-primary leading-relaxed">
                {campaign.call_to_action ?? <span className="text-grey-400 italic">Not set</span>}
              </p>
            </div>
          </div>
        ) : (
          <p className="text-[13px] text-grey-400 italic">
            No drafting context set. Drafts will use generic per-persona templates until you add a goal, pain points,
            or call to action.
          </p>
        )}
      </div>

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="bg-white rounded-lg w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
            <h3 className="text-[18px] font-bold mb-4">Edit Campaign</h3>
            <form onSubmit={handleSave} className="flex flex-col gap-4">
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

              <div className="border-t border-grey-100 pt-4 mt-1">
                <p className="text-[12px] font-semibold text-grey-500 uppercase tracking-wide mb-1">
                  Drafting context
                </p>
                <p className="text-[12px] text-grey-400 mb-3">
                  Optional — helps the AI write emails specific to this campaign rather than a generic persona template.
                </p>
                <div className="flex flex-col gap-4">
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
                </div>
              </div>

              {formError && <p className="text-danger text-[13px]">{formError}</p>}
              <div className="flex gap-3 justify-end">
                <button
                  type="button"
                  onClick={() => setEditing(false)}
                  className="px-4 py-2 border rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-6 py-2 bg-primary text-white rounded-lg disabled:opacity-60"
                >
                  {saving ? "Saving…" : "Save"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
