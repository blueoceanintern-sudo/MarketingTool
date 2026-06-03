"use client";

import { useMemo, useState, type SubmitEvent } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  createPromptTemplate,
  deletePromptTemplate,
  updatePromptTemplate,
  type PromptTemplate,
} from "@/lib/api";
import { templatesOptions, templateEngagementOptions, keys } from "@/lib/queries";

type ModalMode = { type: "create"; from?: PromptTemplate } | { type: "edit"; template: PromptTemplate } | null;

export default function TemplatesClient() {
  const queryClient = useQueryClient();
  const { data: templates = [] } = useQuery(templatesOptions());
  const { data: engagement = [] } = useQuery(templateEngagementOptions());
  const [modal, setModal] = useState<ModalMode>(null);
  const [error, setError] = useState<string | null>(null);

  const engagementById = useMemo(() => new Map(engagement.map((e) => [e.id, e])), [engagement]);
  const templatesById = useMemo(() => new Map(templates.map((t) => [t.id, t])), [templates]);

  const toggleMutation = useMutation({
    mutationFn: async (template: PromptTemplate) => {
      const { template: updated, error: err } = await updatePromptTemplate(template.id, { active: !template.active });
      if (err || !updated) throw new Error(err ?? "Update failed");
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.templates }),
    onError: (err) => setError(err instanceof Error ? err.message : "Update failed"),
  });

  const deleteMutation = useMutation({
    mutationFn: async (template: PromptTemplate) => {
      const { ok, error: err } = await deletePromptTemplate(template.id);
      if (!ok) throw new Error(err ?? "Delete failed");
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.templates }),
    onError: (err) => setError(err instanceof Error ? err.message : "Delete failed"),
  });

  function handleToggleActive(template: PromptTemplate) {
    setError(null);
    toggleMutation.mutate(template);
  }

  function handleDelete(template: PromptTemplate) {
    if (!confirm(`Delete template "${template.name}"? This cannot be undone.`)) return;
    setError(null);
    deleteMutation.mutate(template);
  }

  return (
    <div className="p-4 sm:p-6 lg:p-10 max-w-[1600px] mx-auto">
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

      <div className="bg-white rounded-lg border border-grey-100 overflow-x-auto">
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

      {modal && <TemplateModal mode={modal} onClose={() => setModal(null)} />}
    </div>
  );
}

interface ModalProps {
  mode: NonNullable<ModalMode>;
  onClose: () => void;
}

function TemplateModal({ mode, onClose }: ModalProps) {
  const queryClient = useQueryClient();
  const initial = mode.type === "edit" ? mode.template : mode.from;
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [systemPrompt, setSystemPrompt] = useState(initial?.system_prompt ?? "");
  const [weight, setWeight] = useState(initial?.weight ?? 1);
  const [active, setActive] = useState(initial?.active ?? true);
  const [error, setError] = useState<string | null>(null);

  const isEdit = mode.type === "edit";

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (isEdit) {
        const { template, error: err } = await updatePromptTemplate(mode.template.id, {
          name: name.trim(),
          description: description.trim() || null,
          weight,
          active,
        });
        if (err || !template) throw new Error(err ?? "Update failed");
      } else {
        const { template, error: err } = await createPromptTemplate({
          name: name.trim(),
          description: description.trim() || null,
          system_prompt: systemPrompt,
          weight,
          active,
          parent_template_id: mode.type === "create" && mode.from ? mode.from.id : null,
        });
        if (err || !template) throw new Error(err ?? "Create failed");
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: keys.templates });
      onClose();
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Save failed"),
  });

  function handleSubmit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    saveMutation.mutate();
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
              disabled={saveMutation.isPending}
              className="px-6 py-2 bg-primary text-white rounded-lg text-[13px] font-semibold disabled:opacity-60"
            >
              {saveMutation.isPending ? "Saving…" : isEdit ? "Save metadata" : "Create"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
