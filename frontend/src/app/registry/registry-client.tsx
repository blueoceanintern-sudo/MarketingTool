"use client";

import { useMemo, useState } from "react";
import { createRegistrySource, type ScraperType, type SourceRegistry } from "@/lib/api";

const scraperTypeLabel: Record<ScraperType, string> = {
  cheerio: "Cheerio (static HTML)",
  crawl4ai: "Crawl4AI (JS-rendered)",
  api: "API (registry lookup)",
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-SG", { day: "numeric", month: "short", year: "numeric" });
}

interface Props {
  initialSources: SourceRegistry[];
}

export default function RegistryClient({ initialSources }: Props) {
  const [sources, setSources] = useState(initialSources);
  const [geoFilter, setGeoFilter] = useState<string>("all");
  const [verticalFilter, setVerticalFilter] = useState<string>("all");
  const [activeOnly, setActiveOnly] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    vertical: "",
    geo: "SG",
    url: "",
    scraper_type: "cheerio" as ScraperType,
    legal_flag: false,
    active: true,
  });

  const geos = useMemo(() => Array.from(new Set(sources.map((s) => s.geo))).sort(), [sources]);
  const verticals = useMemo(() => Array.from(new Set(sources.map((s) => s.vertical))).sort(), [sources]);

  const filtered = useMemo(() => {
    return sources.filter((s) => {
      if (geoFilter !== "all" && s.geo !== geoFilter) return false;
      if (verticalFilter !== "all" && s.vertical !== verticalFilter) return false;
      if (activeOnly && !s.active) return false;
      return true;
    });
  }, [sources, geoFilter, verticalFilter, activeOnly]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setFormError(null);
    const { source, error } = await createRegistrySource({
      name: form.name.trim(),
      vertical: form.vertical.trim(),
      geo: form.geo.trim().toUpperCase(),
      url: form.url.trim(),
      scraper_type: form.scraper_type,
      legal_flag: form.legal_flag,
      active: form.active,
    });
    setSubmitting(false);
    if (error || !source) {
      setFormError(error ?? "Failed to add source");
      return;
    }
    setSources((prev) => [source, ...prev]);
    setShowModal(false);
    setForm({
      name: "",
      vertical: "",
      geo: "SG",
      url: "",
      scraper_type: "cheerio",
      legal_flag: false,
      active: true,
    });
  }

  return (
    <div className="p-10 max-w-[1600px] mx-auto">
      <div className="flex justify-between items-end mb-8">
        <div>
          <nav className="flex items-center gap-2 mb-2">
            <span className="text-[13px] text-grey-500">Admin</span>
            <span className="material-symbols-outlined text-[14px] text-grey-300">chevron_right</span>
            <span className="text-[13px] font-medium text-primary">Source Registry</span>
          </nav>
          <h1 className="text-[20px] font-bold text-primary">Source Registry</h1>
          <p className="text-[13px] text-grey-500 mt-1">
            Scrape sources used when running a campaign. Sources are matched by vertical + geography.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowModal(true)}
          className="flex items-center gap-2 px-6 py-2 bg-primary text-white rounded-lg text-[14px] font-semibold"
        >
          <span className="material-symbols-outlined text-[20px]">add</span>
          Add Source
        </button>
      </div>

      <div className="grid grid-cols-4 gap-6 mb-8">
        <div className="bg-white p-5 rounded-lg border border-grey-100">
          <p className="text-[13px] text-grey-500">Total sources</p>
          <h3 className="text-[24px] font-bold font-mono mt-2">{sources.length}</h3>
        </div>
        <div className="bg-white p-5 rounded-lg border border-grey-100">
          <p className="text-[13px] text-grey-500">Active</p>
          <h3 className="text-[24px] font-bold text-success font-mono mt-2">
            {sources.filter((s) => s.active).length}
          </h3>
        </div>
        <div className="bg-white p-5 rounded-lg border border-grey-100">
          <p className="text-[13px] text-grey-500">Geographies</p>
          <h3 className="text-[24px] font-bold font-mono mt-2">{geos.length}</h3>
        </div>
        <div className="bg-white p-5 rounded-lg border border-grey-100">
          <p className="text-[13px] text-grey-500">Verticals</p>
          <h3 className="text-[24px] font-bold font-mono mt-2">{verticals.length}</h3>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-grey-100 overflow-hidden">
        <div className="px-5 py-4 border-b border-grey-100 bg-grey-50 flex flex-wrap gap-3 items-center justify-between">
          <div className="flex flex-wrap gap-2">
            <select
              value={geoFilter}
              onChange={(e) => setGeoFilter(e.target.value)}
              className="px-3 py-1.5 border border-grey-100 rounded text-[13px] bg-white"
            >
              <option value="all">All Geographies</option>
              {geos.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
            <select
              value={verticalFilter}
              onChange={(e) => setVerticalFilter(e.target.value)}
              className="px-3 py-1.5 border border-grey-100 rounded text-[13px] bg-white"
            >
              <option value="all">All Verticals</option>
              {verticals.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
            <button
              type="button"
              onClick={() => setActiveOnly((v) => !v)}
              className={[
                "px-3 py-1.5 border rounded text-[13px] font-medium",
                activeOnly ? "bg-primary text-white border-primary" : "bg-white border-grey-100",
              ].join(" ")}
            >
              Active only
            </button>
          </div>
          <p className="text-[13px] text-grey-500">Showing {filtered.length} sources</p>
        </div>

        {sources.length === 0 ? (
          <p className="px-6 py-16 text-center text-grey-400 text-[14px]">
            No sources yet. Add one to enable scraping for a campaign.
          </p>
        ) : filtered.length === 0 ? (
          <p className="px-6 py-12 text-center text-grey-400">No sources match these filters.</p>
        ) : (
          <table className="w-full border-collapse">
            <thead className="bg-grey-50 border-b border-grey-100">
              <tr className="text-left">
                <th className="px-6 py-4 text-[14px] font-semibold">Name</th>
                <th className="px-4 py-4 text-[14px] font-semibold">Vertical</th>
                <th className="px-4 py-4 text-[14px] font-semibold text-center">Geo</th>
                <th className="px-4 py-4 text-[14px] font-semibold">URL</th>
                <th className="px-4 py-4 text-[14px] font-semibold" title="Engine to try first; falls back to Cheerio if it fails">Engine (preferred)</th>
                <th className="px-4 py-4 text-[14px] font-semibold text-center">Active</th>
                <th className="px-4 py-4 text-[14px] font-semibold">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-grey-100">
              {filtered.map((s) => (
                <tr key={s.id} className="hover:bg-ocean-wash">
                  <td className="px-6 py-3 text-[14px] font-medium">{s.name}</td>
                  <td className="px-4 py-3 text-[13px]">{s.vertical}</td>
                  <td className="px-4 py-3 text-center text-[12px]">{s.geo}</td>
                  <td className="px-4 py-3 text-[12px] font-mono text-ocean-light truncate max-w-[300px]">
                    <a href={s.url} target="_blank" rel="noreferrer" className="hover:underline">{s.url}</a>
                  </td>
                  <td className="px-4 py-3 text-[12px] text-grey-500">{scraperTypeLabel[s.scraper_type]}</td>
                  <td className="px-4 py-3 text-center">
                    {s.active ? (
                      <span className="px-2 py-0.5 text-xs font-bold rounded-full bg-success-bg text-success">Active</span>
                    ) : (
                      <span className="px-2 py-0.5 text-xs font-bold rounded-full bg-neutral-bg text-neutral">Inactive</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-[13px] text-grey-500">{formatDate(s.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="bg-white rounded-lg w-full max-w-md p-6">
            <h3 className="text-[18px] font-bold mb-4">Add Source</h3>
            <form onSubmit={handleCreate} className="flex flex-col gap-4">
              <label className="flex flex-col gap-1 text-[13px]">
                Name
                <input
                  required
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. MOE Schools Directory"
                  className="border border-grey-200 rounded-lg px-3 py-2"
                />
              </label>
              <label className="flex flex-col gap-1 text-[13px]">
                Vertical
                <input
                  required
                  value={form.vertical}
                  onChange={(e) => setForm((f) => ({ ...f, vertical: e.target.value }))}
                  placeholder="e.g. education"
                  className="border border-grey-200 rounded-lg px-3 py-2"
                />
              </label>
              <label className="flex flex-col gap-1 text-[13px]">
                Geography
                <select
                  value={form.geo}
                  onChange={(e) => setForm((f) => ({ ...f, geo: e.target.value }))}
                  className="border border-grey-200 rounded-lg px-3 py-2"
                >
                  <option value="SG">SG</option>
                  <option value="AU">AU</option>
                  <option value="US">US</option>
                </select>
              </label>
              <label className="flex flex-col gap-1 text-[13px]">
                URL
                <input
                  required
                  type="url"
                  value={form.url}
                  onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
                  placeholder="https://..."
                  className="border border-grey-200 rounded-lg px-3 py-2 font-mono"
                />
              </label>
              <label className="flex flex-col gap-1 text-[13px]">
                Scraper type
                <select
                  value={form.scraper_type}
                  onChange={(e) => setForm((f) => ({ ...f, scraper_type: e.target.value as ScraperType }))}
                  className="border border-grey-200 rounded-lg px-3 py-2"
                >
                  <option value="cheerio">{scraperTypeLabel.cheerio}</option>
                  <option value="crawl4ai">{scraperTypeLabel.crawl4ai}</option>
                  <option value="api">{scraperTypeLabel.api}</option>
                </select>
              </label>
              <div className="flex gap-6">
                <label className="flex items-center gap-2 text-[13px]">
                  <input
                    type="checkbox"
                    checked={form.active}
                    onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))}
                  />
                  Active
                </label>
                <label className="flex items-center gap-2 text-[13px]">
                  <input
                    type="checkbox"
                    checked={form.legal_flag}
                    onChange={(e) => setForm((f) => ({ ...f, legal_flag: e.target.checked }))}
                  />
                  Legal sign-off
                </label>
              </div>
              {formError && <p className="text-danger text-[13px]">{formError}</p>}
              <div className="flex gap-3 justify-end">
                <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 border rounded-lg">
                  Cancel
                </button>
                <button type="submit" disabled={submitting} className="px-6 py-2 bg-primary text-white rounded-lg">
                  {submitting ? "Adding…" : "Add Source"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
