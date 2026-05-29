"use client";

import { useMemo, useState, type SubmitEvent } from "react";
import {
  createPromptTemplate,
  deletePromptTemplate,
  updatePromptTemplate,
  type PromptTemplate,
  type TemplateEngagement,
} from "@/lib/api";

interface Props {
  initialTemplates: PromptTemplate[];
  initialEngagement: TemplateEngagement[];
}

type ModalMode = { type: "create"; from?: PromptTemplate } | { type: "edit"; template: PromptTemplate } | null;

export default function TemplatesClient({ initialTemplates, initialEngagement }: Props) {
  const [templates, setTemplates] = useState(initialTemplates);
  const [engagement, setEngagement] = useState(initialEngagement);
  const [modal, setModal] = useState<ModalMode>(null);
  const [error, setError] = useState<string | null>(null);

  const engagementById = useMemo(() => new Map(engagement.map((e) => [e.id, e])), [engagement]);
  const templatesById = useMemo(() => new Map(templates.map((t) => [t.id, t])), [templates]);

  async function refreshEngagement() {
    const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001"}/api/v1/analytics/templates`, {
      cache: "no-store",
    });
    if (res.ok) setEngagement((await res.json()) as TemplateEngagement[]);
  }

  async function handleToggleActive(template: PromptTemplate) {
    setError(null);
    const { template: updated, error: err } = await updatePromptTemplate(template.id, { active: !template.active });
    if (err || !updated) {
      setError(err ?? "Update failed");
      return;
    }
    setTemplates((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
  }

  async function handleDelete(template: PromptTemplate) {
    if (!confirm(`Delete template "${template.name}"? This cannot be undone.`)) return;
    setError(null);
    const { ok, error: err } = await deletePromptTemplate(template.id);
    if (!ok) {
      setError(err ?? "Delete failed");
      return;
    }
    setTemplates((prev) => prev.filter((t) => t.id !== template.id));
  }

  return (
    <div className="p-10 max-w-[1600px] mx-auto">
      <div className="flex justify-between items-end mb-8">
        <div>
          <nav className="flex items-center gap-2 mb-2">
            <span className="text-[13px] text-grey-500">Admin</span>
            <span className="material-symbols-outlined text-[14px] text-grey-300">chevron_right</span>
            <span className="text-[13px] font-medium text-primary">Email Templates</span>
          </nav>
          <h1 className="text-[20px] font-bold text-primary">Email Templates</h1>
          <p className="text-[13px] text-grey-500 mt-1">
            Prompt-style variants the drafting service can pick from. Engagement is tracked per template so you can
            compare which styles land best. The system prompt is locked after creation — to iterate, duplicate an
            existing template.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setModal({ type: "create" })}
          className="flex items-center gap-2 px-6 py-2 bg-primary text-white rounded-lg text-[14px] font-semibold"
        >
          <span className="material-symbols-outlined text-[20px]">add</span>
          New Template
        </button>
      </div>

      {error && (
        <p className="mb-4 text-danger text-[13px] border border-danger-bg bg-danger-bg/30 px-3 py-2 rounded-lg">
          {error}
        </p>
      )}

      <div className="bg-white rounded-lg border border-grey-100 overflow-hidden">
        {templates.length === 0 ? (
          <p className="px-6 py-16 text-center text-grey-400 text-[14px]">
            No templates yet. Drafting will fail until you add one.
          </p>
        ) : (
          <table className="w-full border-collapse">
            <thead className="bg-grey-50 border-b border-grey-100">
              <tr className="text-left text-[13px]">
                <th className="px-6 py-3 font-semibold">Name</th>
                <th className="px-4 py-3 font-semibold text-center">Weight</th>
                <th className="px-4 py-3 font-semibold text-center">Active</th>
                <th className="px-4 py-3 font-semibold text-right">Sent</th>
                <th className="px-4 py-3 font-semibold text-right">Open rate</th>
                <th className="px-4 py-3 font-semibold text-right">Reply rate</th>
                <th className="px-4 py-3 font-semibold">Source</th>
                <th className="px-4 py-3 font-semibold text-right pr-6"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-grey-100">
              {templates.map((t) => {
                const eng = engagementById.get(t.id);
                const sent = eng?.sent ?? 0;
                const parent = t.parent_template_id ? templatesById.get(t.parent_template_id) : null;
                return (
                  <tr key={t.id} className="hover:bg-ocean-wash">
                    <td className="px-6 py-3">
                      <p className="text-[14px] font-medium text-primary">{t.name}</p>
                      {t.description && <p className="text-[12px] text-grey-500 mt-0.5">{t.description}</p>}
                    </td>
                    <td className="px-4 py-3 text-center font-mono text-[13px]">{t.weight}</td>
                    <td className="px-4 py-3 text-center">
                      <button
                        type="button"
                        onClick={() => handleToggleActive(t)}
                        className={
                          t.active
                            ? "px-2 py-0.5 text-xs font-bold rounded-full bg-success-bg text-success"
                            : "px-2 py-0.5 text-xs font-bold rounded-full bg-neutral-bg text-neutral"
                        }
                      >
                        {t.active ? "Active" : "Inactive"}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-[13px]">{sent}</td>
                    <td className="px-4 py-3 text-right font-mono text-[13px]">
                      {sent > 0 ? `${eng?.open_rate ?? 0}%` : "—"}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-[13px]">
                      {sent > 0 ? `${eng?.reply_rate ?? 0}%` : "—"}
                    </td>
                    <td className="px-4 py-3 text-[12px] text-grey-500">
                      {t.created_by === "system" ? "System" : "Manual"}
                      {parent && (
                        <span className="block text-[11px] text-grey-400">
                          from {parent.name}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right pr-6 whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => setModal({ type: "edit", template: t })}
                        className="px-2 py-1 text-[12px] text-grey-600 hover:text-primary hover:bg-grey-50 rounded"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => setModal({ type: "create", from: t })}
                        className="px-2 py-1 text-[12px] text-grey-600 hover:text-primary hover:bg-grey-50 rounded"
                      >
                        Duplicate
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(t)}
                        className="px-2 py-1 text-[12px] text-danger hover:bg-danger-bg/30 rounded"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {modal && (
        <TemplateModal
          mode={modal}
          onClose={() => setModal(null)}
          onCreated={(t) => {
            setTemplates((prev) => [t, ...prev]);
            void refreshEngagement();
            setModal(null);
          }}
          onUpdated={(t) => {
            setTemplates((prev) => prev.map((x) => (x.id === t.id ? t : x)));
            setModal(null);
          }}
        />
      )}
    </div>
  );
}

interface ModalProps {
  mode: NonNullable<ModalMode>;
  onClose: () => void;
  onCreated: (t: PromptTemplate) => void;
  onUpdated: (t: PromptTemplate) => void;
}

function TemplateModal({ mode, onClose, onCreated, onUpdated }: ModalProps) {
  const initial = mode.type === "edit" ? mode.template : mode.from;
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [systemPrompt, setSystemPrompt] = useState(initial?.system_prompt ?? "");
  const [weight, setWeight] = useState(initial?.weight ?? 1);
  const [active, setActive] = useState(initial?.active ?? true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isEdit = mode.type === "edit";

  async function handleSubmit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    if (isEdit) {
      const { template, error: err } = await updatePromptTemplate(mode.template.id, {
        name: name.trim(),
        description: description.trim() || null,
        weight,
        active,
      });
      setSubmitting(false);
      if (err || !template) { setError(err ?? "Update failed"); return; }
      onUpdated(template);
    } else {
      const { template, error: err } = await createPromptTemplate({
        name: name.trim(),
        description: description.trim() || null,
        system_prompt: systemPrompt,
        weight,
        active,
        parent_template_id: mode.type === "create" && mode.from ? mode.from.id : null,
      });
      setSubmitting(false);
      if (err || !template) { setError(err ?? "Create failed"); return; }
      onCreated(template);
    }
  }

  const title = isEdit
    ? "Edit template metadata"
    : mode.from
      ? `Duplicate "${mode.from.name}"`
      : "New template";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-lg w-full max-w-2xl p-6 max-h-[90vh] overflow-y-auto">
        <h3 className="text-[18px] font-bold mb-4">{title}</h3>
        {isEdit && (
          <p className="text-[12px] text-grey-500 mb-4 border-l-2 border-grey-200 pl-3 italic">
            System prompt is locked to preserve engagement history. To iterate, close this and click Duplicate on the
            template row.
          </p>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-[13px]">
            Name
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Direct & punchy"
              className="border border-grey-200 rounded-lg px-3 py-2"
            />
          </label>
          <label className="flex flex-col gap-1 text-[13px]">
            Description (optional)
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Short, peer-to-peer cold email"
              className="border border-grey-200 rounded-lg px-3 py-2"
            />
          </label>

          <label className="flex flex-col gap-1 text-[13px]">
            System prompt {isEdit && <span className="text-grey-400 text-[11px]">(read-only)</span>}
            <textarea
              required={!isEdit}
              readOnly={isEdit}
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              rows={14}
              placeholder="You are an expert B2B cold email writer..."
              className={
                isEdit
                  ? "border border-grey-200 rounded-lg px-3 py-2 font-mono text-[12px] bg-grey-50 text-grey-600"
                  : "border border-grey-200 rounded-lg px-3 py-2 font-mono text-[12px]"
              }
            />
          </label>

          <div className="grid grid-cols-2 gap-4">
            <label className="flex flex-col gap-1 text-[13px]">
              Weight
              <input
                type="number"
                min={0}
                value={weight}
                onChange={(e) => setWeight(Number(e.target.value))}
                className="border border-grey-200 rounded-lg px-3 py-2 font-mono"
              />
              <span className="text-[11px] text-grey-400">Relative pick frequency. 0 = never picked.</span>
            </label>
            <label className="flex items-center gap-2 text-[13px] mt-6">
              <input
                type="checkbox"
                checked={active}
                onChange={(e) => setActive(e.target.checked)}
              />
              Active
            </label>
          </div>

          {error && <p className="text-danger text-[13px]">{error}</p>}

          <div className="flex gap-3 justify-end">
            <button type="button" onClick={onClose} className="px-4 py-2 border border-grey-200 rounded-lg text-[13px]">
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-6 py-2 bg-primary text-white rounded-lg text-[13px] font-semibold disabled:opacity-60"
            >
              {submitting ? "Saving…" : isEdit ? "Save metadata" : "Create"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
