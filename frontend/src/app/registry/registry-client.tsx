"use client";

import { useMemo, useRef, useState } from "react";
import { createRegistrySource, importRegistrySources, type RegistryImportResult, type ScraperType, type SourceRegistry } from "@/lib/api";

const scraperTypeLabel: Record<ScraperType, string> = {
  cheerio: "Cheerio (static HTML)",
  crawl4ai: "Crawl4AI (JS-rendered)",
  api: "API (registry lookup)",
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-SG", { day: "numeric", month: "short", year: "numeric" });
}

const CSV_COLUMNS = [
  { name: "name",         description: "Display name for the source",                       example: "MOE Schools Directory" },
  { name: "vertical",     description: "Industry vertical (e.g. education, childcare, ihl)", example: "education" },
  { name: "geo",          description: "Geography — must be SG, AU, or US",                 example: "SG" },
  { name: "url",          description: "Full URL to scrape (must be unique)",                example: "https://moe.gov.sg/schools" },
  { name: "scraper_type", description: "Engine — crawl4ai (JS pages), cheerio (static HTML), or api", example: "cheerio" },
  { name: "legal_flag",   description: "Legal sign-off obtained — true or false",           example: "true" },
  { name: "active",       description: "Include in scrape runs — true or false",            example: "true" },
];

const SAMPLE_CSV = `name,vertical,geo,url,scraper_type,legal_flag,active
MOE Schools Directory,education,SG,https://moe.gov.sg/schools,cheerio,true,true
ACECQA Provider List,childcare,AU,https://www.acecqa.gov.au/providers,crawl4ai,false,true
US Daycare Registry,childcare,US,https://childcare.gov/index/registry,cheerio,false,false`;

interface Props {
  initialSources: SourceRegistry[];
}

export default function RegistryClient({ initialSources }: Props) {
  const [sources, setSources] = useState(initialSources);
  const [geoFilter, setGeoFilter] = useState<string>("all");
  const [verticalFilter, setVerticalFilter] = useState<string>("all");
  const [activeOnly, setActiveOnly] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<RegistryImportResult | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
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
    if (error || !source) { setFormError(error ?? "Failed to add source"); return; }
    setSources((prev) => [source, ...prev]);
    setShowAddModal(false);
    setForm({ name: "", vertical: "", geo: "SG", url: "", scraper_type: "cheerio", legal_flag: false, active: true });
  }

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setShowImportModal(false);
    setImporting(true);
    setImportResult(null);
    setImportError(null);
    const { result, error } = await importRegistrySources(file);
    setImporting(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (error || !result) { setImportError(error ?? "Import failed"); return; }
    setImportResult(result);
    if (result.imported > 0) {
      const fresh = await import("@/lib/api").then((m) => m.getRegistrySources());
      setSources(fresh);
    }
  }

  function downloadTemplate() {
    const blob = new Blob([SAMPLE_CSV], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "source_registry_template.csv";
    a.click();
  }

  return (
    <div className="p-4 sm:p-6 lg:p-10 max-w-[1600px] mx-auto">
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
        <div className="flex items-center gap-3">
          <input ref={fileInputRef} type="file" accept=".csv" className="hidden" onChange={handleImport} />
          <button
            type="button"
            onClick={() => setShowImportModal(true)}
            disabled={importing}
            className="flex items-center gap-2 px-5 py-2 border border-grey-200 bg-white text-primary rounded-lg text-[14px] font-semibold hover:bg-grey-50 disabled:opacity-50"
          >
            <span className="material-symbols-outlined text-[20px]">upload_file</span>
            {importing ? "Importing…" : "Import CSV"}
          </button>
          <button
            type="button"
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-2 px-6 py-2 bg-primary text-white rounded-lg text-[14px] font-semibold"
          >
            <span className="material-symbols-outlined text-[20px]">add</span>
            Add Source
          </button>
        </div>
      </div>

      {importError && (
        <div className="mb-6 px-4 py-3 rounded-lg bg-danger-bg text-danger text-[13px] flex items-center justify-between">
          <span>{importError}</span>
          <button type="button" onClick={() => setImportError(null)} className="ml-4 hover:opacity-70">
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>
      )}

      {importResult && (
        <div className="mb-6 px-4 py-3 rounded-lg bg-success-bg text-[13px] flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-success font-semibold">
              Import complete — {importResult.imported} added, {importResult.skipped} skipped (duplicates)
              {importResult.errors.length - importResult.skipped > 0
                ? `, ${importResult.errors.length - importResult.skipped} invalid rows`
                : ""}
            </span>
            <button type="button" onClick={() => setImportResult(null)} className="ml-4 text-success hover:opacity-70">
              <span className="material-symbols-outlined text-[18px]">close</span>
            </button>
          </div>
          {importResult.errors.length > 0 && (
            <ul className="list-disc pl-5 text-grey-600 space-y-0.5">
              {importResult.errors.map((e) => (
                <li key={e.row}>Row {e.row}: {e.reason}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-6 mb-8">
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

      <div className="bg-white rounded-lg border border-grey-100 overflow-x-auto">
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

      {/* ── Import CSV format modal ─────────────────────────────────────────── */}
      {showImportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="bg-white rounded-xl w-full max-w-2xl p-6 flex flex-col gap-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-[18px] font-bold text-primary">Import CSV</h3>
                <p className="text-[13px] text-grey-500 mt-1">All 7 columns are required. Rows with missing or invalid values are skipped.</p>
              </div>
              <button type="button" onClick={() => setShowImportModal(false)} className="text-grey-400 hover:text-grey-600">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <div className="border border-grey-100 rounded-lg overflow-auto max-h-56">
              <table className="w-full text-[13px]">
                <thead className="bg-grey-50 border-b border-grey-100 sticky top-0">
                  <tr className="text-left">
                    <th className="px-4 py-2.5 font-semibold text-primary">Column</th>
                    <th className="px-4 py-2.5 font-semibold text-primary">Description</th>
                    <th className="px-4 py-2.5 font-semibold text-primary">Example</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-grey-100">
                  {CSV_COLUMNS.map((col) => (
                    <tr key={col.name}>
                      <td className="px-4 py-2.5 font-mono font-semibold text-ocean-light">{col.name}</td>
                      <td className="px-4 py-2.5 text-grey-600">{col.description}</td>
                      <td className="px-4 py-2.5 font-mono text-grey-500">{col.example}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div>
              <p className="text-[12px] font-semibold text-grey-500 uppercase tracking-wide mb-2">Sample CSV</p>
              <pre className="bg-grey-50 border border-grey-100 rounded-lg px-4 py-3 text-[12px] font-mono text-grey-700 overflow-x-auto whitespace-pre">
                {SAMPLE_CSV}
              </pre>
            </div>

            <div className="flex gap-3 justify-end pt-1">
              <button
                type="button"
                onClick={downloadTemplate}
                className="flex items-center gap-2 px-4 py-2 border border-grey-200 rounded-lg text-[14px] text-grey-600 hover:bg-grey-50"
              >
                <span className="material-symbols-outlined text-[18px]">download</span>
                Download template
              </button>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-2 px-6 py-2 bg-primary text-white rounded-lg text-[14px] font-semibold"
              >
                <span className="material-symbols-outlined text-[18px]">upload_file</span>
                Choose file
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Add source modal ────────────────────────────────────────────────── */}
      {showAddModal && (
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
                <button type="button" onClick={() => setShowAddModal(false)} className="px-4 py-2 border rounded-lg">
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
