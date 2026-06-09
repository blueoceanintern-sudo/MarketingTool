"use client";

import { useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { resolveGeo } from "@/lib/geo";
import { toast } from "sonner";
import {
  createRegistrySource,
  importRegistrySources,
  triggerDiscovery,
  createDirectoryConfig,
  updateDirectoryConfig,
  deleteDirectoryConfig,
  type DirectoryConfig,
  type RegistryImportResult,
  type ScraperType,
} from "@/lib/api";
import {
  registrySourcesOptions,
  directoryConfigsOptions,
  activeCombinationsOptions,
  keys,
} from "@/lib/queries";
import { useJobEvents } from "@/lib/job-events";

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

const BLANK_COVERAGE_FORM = { vertical: "", geo: "", query: "", domains: "" };
const BLANK_SOURCE_FORM = { name: "", vertical: "", geo: "", url: "", scraper_type: "cheerio" as ScraperType, legal_flag: false, active: true };

export default function RegistryClient({ isAdmin }: { isAdmin: boolean }) {
  const queryClient = useQueryClient();
  const { data: sources = [] } = useQuery(registrySourcesOptions());
  const { data: directoryConfigs = [] } = useQuery(directoryConfigsOptions());
  const { data: activeCombinations = [] } = useQuery(activeCombinationsOptions());
  const [refreshing, setRefreshing] = useState<string | null>(null);
  const [geoFilter, setGeoFilter] = useState<string>("all");
  const [verticalFilter, setVerticalFilter] = useState<string>("all");
  const [activeOnly, setActiveOnly] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<RegistryImportResult | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState(BLANK_SOURCE_FORM);

  // Coverage config modals (admin only)
  const [showAddCoverageModal, setShowAddCoverageModal] = useState(false);
  const [editingConfig, setEditingConfig] = useState<DirectoryConfig | null>(null);
  const [coverageForm, setCoverageForm] = useState(BLANK_COVERAGE_FORM);
  const [coverageError, setCoverageError] = useState<string | null>(null);
  const [coverageDuplicate, setCoverageDuplicate] = useState<DirectoryConfig | null>(null);
  const [deletingConfig, setDeletingConfig] = useState<DirectoryConfig | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");

  const invalidateConfigs = () => queryClient.invalidateQueries({ queryKey: ["registry", "directory-configs"] });

  const createMutation = useMutation({
    mutationFn: async () => {
      const { source, error } = await createRegistrySource({
        name: form.name.trim(),
        vertical: form.vertical.trim(),
        geo: form.geo.trim().toUpperCase(),
        url: form.url.trim(),
        scraper_type: form.scraper_type,
        legal_flag: form.legal_flag,
        active: form.active,
      });
      if (error || !source) throw new Error(error ?? "Failed to add source");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: keys.registry });
      setShowAddModal(false);
      setForm(BLANK_SOURCE_FORM);
    },
    onError: (err) => setFormError(err instanceof Error ? err.message : "Failed to add source"),
  });

  const importMutation = useMutation({
    mutationFn: async (file: File) => {
      const { result, error } = await importRegistrySources(file);
      if (error || !result) throw new Error(error ?? "Import failed");
      return result;
    },
    onSuccess: (result) => {
      setImportResult(result);
      if (result.imported > 0) queryClient.invalidateQueries({ queryKey: keys.registry });
    },
    onError: (err) => setImportError(err instanceof Error ? err.message : "Import failed"),
  });

  const createConfigMutation = useMutation({
    mutationFn: async () => {
      const domains = coverageForm.domains.split(",").map((d) => d.trim()).filter(Boolean);
      return createDirectoryConfig({
        vertical: coverageForm.vertical.trim().toLowerCase(),
        geo: resolveGeo(coverageForm.geo),
        query: coverageForm.query.trim(),
        domains,
      });
    },
    onSuccess: (result) => {
      if (result.isDuplicate) {
        const vertical = coverageForm.vertical.trim().toLowerCase();
        const geo = resolveGeo(coverageForm.geo);
        const existing = directoryConfigs.find((c) => c.vertical === vertical && c.geo === geo) ?? null;
        setCoverageDuplicate(existing);
        return;
      }
      if (result.error || !result.config) {
        setCoverageError(result.error ?? "Failed to create config");
        return;
      }
      invalidateConfigs();
      setShowAddCoverageModal(false);
      setCoverageForm(BLANK_COVERAGE_FORM);
      setCoverageError(null);
      setCoverageDuplicate(null);
    },
  });

  const updateConfigMutation = useMutation({
    mutationFn: async () => {
      if (!editingConfig) return;
      const domains = coverageForm.domains.split(",").map((d) => d.trim()).filter(Boolean);
      const { config, error } = await updateDirectoryConfig(editingConfig.id, {
        query: coverageForm.query.trim(),
        domains,
      });
      if (error || !config) throw new Error(error ?? "Failed to update config");
    },
    onSuccess: () => {
      invalidateConfigs();
      setEditingConfig(null);
      setCoverageForm(BLANK_COVERAGE_FORM);
      setCoverageError(null);
    },
    onError: (err) => setCoverageError(err instanceof Error ? err.message : "Failed to update config"),
  });

  const deleteConfigMutation = useMutation({
    mutationFn: async (id: string) => {
      const { ok, error } = await deleteDirectoryConfig(id);
      if (!ok) throw new Error(error ?? "Failed to delete config");
    },
    onSuccess: () => {
      invalidateConfigs();
      setDeletingConfig(null);
      setDeleteConfirmText("");
      toast.success("Coverage config deleted");
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to delete config"),
  });

  const geos = useMemo(
    () => Array.from(new Set([...sources.map((s) => s.geo), ...directoryConfigs.map((c) => c.geo)])).sort(),
    [sources, directoryConfigs],
  );
  const verticals = useMemo(
    () => Array.from(new Set([...sources.map((s) => s.vertical), ...directoryConfigs.map((c) => c.vertical)])).sort(),
    [sources, directoryConfigs],
  );

  const filtered = useMemo(() => {
    return sources.filter((s) => {
      if (geoFilter !== "all" && s.geo !== geoFilter) return false;
      if (verticalFilter !== "all" && s.vertical !== verticalFilter) return false;
      if (activeOnly && !s.active) return false;
      return true;
    });
  }, [sources, geoFilter, verticalFilter, activeOnly]);

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    createMutation.mutate();
  }

  function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setShowImportModal(false);
    setImportResult(null);
    setImportError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    importMutation.mutate(file);
  }

  function downloadTemplate() {
    const blob = new Blob([SAMPLE_CSV], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "source_registry_template.csv";
    a.click();
  }

  useJobEvents((event) => {
    if (event.kind === "discovery") {
      setRefreshing(null);
    }
  });

  async function handleRefresh(vertical: string, geo: string, domains: string[]) {
    const key = `${vertical}:${geo}`;
    setRefreshing(key);
    const result = await triggerDiscovery(vertical, geo);

    if (!result.ok) {
      setRefreshing(null);
      if (result.retryAfter) {
        toast.warning(result.error ?? "Rate-limited", {
          description: `Try again in ${result.retryAfter}s.`,
        });
      } else {
        toast.error(result.error ?? "Discovery failed");
      }
      return;
    }

    toast.info(result.message ?? `Discovering sources for ${key}`, {
      description: domains.length ? `Searching: ${domains.join(", ")}` : undefined,
      duration: 8000,
    });
  }

  function openEditConfig(cfg: DirectoryConfig) {
    setEditingConfig(cfg);
    setCoverageForm({
      vertical: cfg.vertical,
      geo: cfg.geo,
      query: cfg.query,
      domains: cfg.domains.join(", "),
    });
    setCoverageError(null);
  }

  function handleCoverageSubmit(e: React.FormEvent) {
    e.preventDefault();
    setCoverageError(null);
    setCoverageDuplicate(null);
    if (editingConfig) {
      updateConfigMutation.mutate();
    } else {
      createConfigMutation.mutate();
    }
  }

  // Coverage rows: configured entries + gaps from active campaigns
  const coverageRows = useMemo(() => {
    const configured = directoryConfigs.map((c) => ({
      vertical: c.vertical,
      geo: c.geo,
      has_config: true,
      domains: c.domains,
      config: c,
    }));
    const configuredKeys = new Set(configured.map((c) => `${c.vertical}:${c.geo}`));
    const gaps = activeCombinations
      .filter((c) => !configuredKeys.has(`${c.vertical}:${c.geo}`))
      .map((c) => ({ ...c, domains: [] as string[], config: null }));
    return [...configured, ...gaps];
  }, [directoryConfigs, activeCombinations]);

  const isCoveragePending = createConfigMutation.isPending || updateConfigMutation.isPending;

  return (
    <div className="p-4 sm:p-6 lg:p-10 max-w-400 mx-auto">
      {/* Shared datalists — referenced by all modals */}
      <datalist id="all-verticals">
        {verticals.map((v) => <option key={v} value={v} />)}
      </datalist>
      <datalist id="all-geos">
        {Array.from(new Set(["SG", "AU", "US", ...geos])).sort().map((g) => <option key={g} value={g} />)}
      </datalist>
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
        {isAdmin && (
          <div className="flex items-center gap-3">
            <input ref={fileInputRef} type="file" accept=".csv" className="hidden" onChange={handleImport} />
            <button
              type="button"
              onClick={() => setShowImportModal(true)}
              disabled={importMutation.isPending}
              className="flex items-center gap-2 px-5 py-2 border border-grey-200 bg-white text-primary rounded-lg text-[14px] font-semibold hover:bg-grey-50 disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-[20px]">upload_file</span>
              {importMutation.isPending ? "Importing…" : "Import CSV"}
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
        )}
      </div>

      {isAdmin && importError && (
        <div className="mb-6 px-4 py-3 rounded-lg bg-danger-bg text-danger text-[13px] flex items-center justify-between">
          <span>{importError}</span>
          <button type="button" onClick={() => setImportError(null)} className="ml-4 hover:opacity-70">
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>
      )}

      {isAdmin && importResult && (
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

      {coverageRows.length > 0 && (
        <div className="bg-white rounded-lg border border-grey-100 overflow-hidden mb-8">
          <div className="px-5 py-4 border-b border-grey-100 bg-grey-50 flex items-start justify-between gap-4">
            <div>
              <h3 className="text-[14px] font-semibold text-primary">Auto-discovery coverage</h3>
              <p className="text-[12px] text-grey-500 mt-1">
                Tavily searches the whitelisted directories below and inserts new sources automatically.
                Refresh runs the search again — useful when a directory adds new entries.
              </p>
            </div>
            {isAdmin && (
              <button
                type="button"
                onClick={() => { setCoverageForm(BLANK_COVERAGE_FORM); setCoverageError(null); setCoverageDuplicate(null); setShowAddCoverageModal(true); }}
                className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 bg-primary text-white rounded-lg text-[12px] font-semibold"
              >
                <span className="material-symbols-outlined text-[16px]">add</span>
                Add coverage
              </button>
            )}
          </div>
          <table className="w-full border-collapse">
            <thead className="bg-grey-50 border-b border-grey-100">
              <tr className="text-left text-[13px]">
                <th className="px-5 py-3 font-semibold">Vertical</th>
                <th className="px-4 py-3 font-semibold text-center">Geo</th>
                <th className="px-4 py-3 font-semibold">Domains searched</th>
                <th className="px-4 py-3 font-semibold text-right pr-5"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-grey-100">
              {coverageRows.map((row) => {
                const key = `${row.vertical}:${row.geo}`;
                return (
                  <tr key={key} className="hover:bg-ocean-wash/40">
                    <td className="px-5 py-3 text-[13px] font-medium">{row.vertical}</td>
                    <td className="px-4 py-3 text-center text-[12px]">{row.geo}</td>
                    <td className="px-4 py-3">
                      {row.has_config ? (
                        <div className="flex flex-wrap gap-1">
                          {row.domains.map((d) => (
                            <span
                              key={d}
                              className="inline-flex items-center px-2 py-0.5 rounded-full bg-grey-50 border border-grey-200 text-[11px] font-mono text-grey-700"
                            >
                              {d}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[12px] text-warning">
                          <span className="material-symbols-outlined text-[14px]">info</span>
                          No directory config — sources must be added manually
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 pr-5">
                      <div className="flex items-center gap-2 justify-end">
                        {isAdmin && row.config && (
                          <button
                            type="button"
                            onClick={() => openEditConfig(row.config!)}
                            className="flex items-center gap-1 px-2.5 py-1.5 border border-grey-200 rounded-lg text-[12px] font-medium text-grey-700 hover:bg-grey-50"
                          >
                            <span className="material-symbols-outlined text-[14px]">edit</span>
                            Edit
                          </button>
                        )}
                        {row.has_config && (
                          <button
                            type="button"
                            onClick={() => handleRefresh(row.vertical, row.geo, row.domains)}
                            disabled={refreshing === key}
                            className="flex items-center gap-1.5 px-3 py-1.5 border border-grey-200 rounded-lg text-[12px] font-medium text-grey-700 hover:bg-grey-50 disabled:opacity-60"
                          >
                            <span className="material-symbols-outlined text-[14px]">refresh</span>
                            {refreshing === key ? "Refreshing…" : "Refresh"}
                          </button>
                        )}
                        {isAdmin && !row.has_config && (
                          <button
                            type="button"
                            onClick={() => {
                              setCoverageForm({ vertical: row.vertical, geo: row.geo, query: "", domains: "" });
                              setCoverageError(null);
                              setCoverageDuplicate(null);
                              setShowAddCoverageModal(true);
                            }}
                            className="flex items-center gap-1 px-2.5 py-1.5 border border-grey-200 rounded-lg text-[12px] font-medium text-grey-700 hover:bg-grey-50"
                          >
                            <span className="material-symbols-outlined text-[14px]">add</span>
                            Add config
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

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

      {/* ── Import CSV format modal ─────────────────────────────────────────── */}
      {isAdmin && showImportModal && (
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
      {isAdmin && showAddModal && (
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
                  list="all-verticals"
                  value={form.vertical}
                  onChange={(e) => setForm((f) => ({ ...f, vertical: e.target.value }))}
                  placeholder="e.g. education"
                  className="border border-grey-200 rounded-lg px-3 py-2"
                />
              </label>
              <label className="flex flex-col gap-1 text-[13px]">
                Geography
                <input
                  required
                  list="all-geos"
                  value={form.geo}
                  onChange={(e) => setForm((f) => ({ ...f, geo: e.target.value }))}
                  onBlur={(e) => setForm((f) => ({ ...f, geo: resolveGeo(e.target.value) }))}
                  onKeyDown={(e) => { if (e.key === "Enter") setForm((f) => ({ ...f, geo: resolveGeo(f.geo) })); }}
                  placeholder="e.g. SG"
                  className="border border-grey-200 rounded-lg px-3 py-2"
                />
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
                <button type="submit" disabled={createMutation.isPending} className="px-6 py-2 bg-primary text-white rounded-lg">
                  {createMutation.isPending ? "Adding…" : "Add Source"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Add / Edit coverage config modal (admin only) ───────────────────── */}
      {isAdmin && (showAddCoverageModal || editingConfig) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="bg-white rounded-lg w-full max-w-md p-6">
            <h3 className="text-[18px] font-bold mb-4">
              {editingConfig ? `Edit coverage — ${editingConfig.vertical}:${editingConfig.geo}` : "Add coverage config"}
            </h3>
            <form onSubmit={handleCoverageSubmit} className="flex flex-col gap-4">
              {!editingConfig && (
                <>
                  <label className="flex flex-col gap-1 text-[13px]">
                    Vertical
                    <input
                      required
                      list="all-verticals"
                      value={coverageForm.vertical}
                      onChange={(e) => setCoverageForm((f) => ({ ...f, vertical: e.target.value }))}
                      placeholder="e.g. education"
                      className="border border-grey-200 rounded-lg px-3 py-2"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-[13px]">
                    Geography
                    <input
                      required
                      list="all-geos"
                      value={coverageForm.geo}
                      onChange={(e) => setCoverageForm((f) => ({ ...f, geo: e.target.value }))}
                      onBlur={(e) => setCoverageForm((f) => ({ ...f, geo: resolveGeo(e.target.value) }))}
                      onKeyDown={(e) => { if (e.key === "Enter") setCoverageForm((f) => ({ ...f, geo: resolveGeo(f.geo) })); }}
                      placeholder="e.g. SG"
                      className="border border-grey-200 rounded-lg px-3 py-2"
                    />
                  </label>
                </>
              )}
              <label className="flex flex-col gap-1 text-[13px]">
                Tavily search query
                <input
                  required
                  value={coverageForm.query}
                  onChange={(e) => setCoverageForm((f) => ({ ...f, query: e.target.value }))}
                  placeholder="e.g. Singapore school contact principal"
                  className="border border-grey-200 rounded-lg px-3 py-2"
                />
              </label>
              <label className="flex flex-col gap-1 text-[13px]">
                Domains to search
                <input
                  required
                  value={coverageForm.domains}
                  onChange={(e) => setCoverageForm((f) => ({ ...f, domains: e.target.value }))}
                  placeholder="e.g. moe.edu.sg, cpe.gov.sg"
                  className="border border-grey-200 rounded-lg px-3 py-2 font-mono"
                />
                <span className="text-[11px] text-grey-400">Comma-separated. Tavily restricts results to these domains.</span>
              </label>
              {coverageDuplicate && !editingConfig && (
                <div className="flex items-center justify-between gap-2 rounded-lg bg-warning/10 border border-warning/30 px-3 py-2 text-[13px]">
                  <span>A config for <span className="font-mono font-semibold">{coverageDuplicate.vertical}:{coverageDuplicate.geo}</span> already exists.</span>
                  <button
                    type="button"
                    onClick={() => { setShowAddCoverageModal(false); setCoverageDuplicate(null); openEditConfig(coverageDuplicate); }}
                    className="shrink-0 text-primary hover:underline font-semibold"
                  >
                    Edit existing →
                  </button>
                </div>
              )}
              {coverageError && !coverageDuplicate && <p className="text-danger text-[13px]">{coverageError}</p>}
              <div className="flex items-center justify-between gap-3 pt-1">
                {editingConfig ? (
                  <button
                    type="button"
                    onClick={() => {
                      setEditingConfig(null);
                      setDeletingConfig(editingConfig);
                      setDeleteConfirmText("");
                      setCoverageError(null);
                    }}
                    className="text-[13px] text-danger hover:underline"
                  >
                    Delete config
                  </button>
                ) : (
                  <span />
                )}
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => { setShowAddCoverageModal(false); setEditingConfig(null); setCoverageError(null); setCoverageDuplicate(null); }}
                    className="px-4 py-2 border rounded-lg text-[14px]"
                  >
                    Cancel
                  </button>
                  <button type="submit" disabled={isCoveragePending} className="px-6 py-2 bg-primary text-white rounded-lg text-[14px] font-semibold">
                    {isCoveragePending ? "Saving…" : editingConfig ? "Save changes" : "Add coverage"}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Delete coverage config confirmation modal (admin only) ──────────── */}
      {isAdmin && deletingConfig && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="bg-white rounded-lg w-full max-w-md p-6 flex flex-col gap-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-[18px] font-bold text-primary">Delete coverage config</h3>
                <p className="text-[13px] text-grey-500 mt-1">
                  <span className="font-mono font-semibold text-primary">{deletingConfig.vertical}:{deletingConfig.geo}</span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => { setDeletingConfig(null); setDeleteConfirmText(""); }}
                className="text-grey-400 hover:text-grey-600 shrink-0"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <div className="rounded-lg border border-warning/40 bg-warning/5 px-4 py-3 flex flex-col gap-2">
              <p className="text-[13px] font-semibold text-warning">What this does</p>
              <ul className="text-[13px] text-grey-700 space-y-1 list-disc pl-4">
                <li>Tavily auto-discovery will <strong>stop running</strong> for <span className="font-mono">{deletingConfig.vertical}:{deletingConfig.geo}</span>. No new sources will be found automatically.</li>
                <li>All <strong>existing sources</strong> already in the registry for this vertical and geography are unaffected — they remain and can still be scraped.</li>
                <li>The next campaign run for this vertical/geo will show a &quot;no directory config&quot; gap in the coverage table.</li>
                <li>You can re-add coverage at any time via <strong>Add coverage</strong>.</li>
              </ul>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[13px] text-grey-600">
                Type <span className="font-mono font-semibold text-primary">delete</span> to confirm
              </label>
              <input
                type="text"
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                placeholder="delete"
                className="border border-grey-200 rounded-lg px-3 py-2 text-[14px] font-mono"
                autoFocus
              />
            </div>

            <div className="flex gap-3 justify-end">
              <button
                type="button"
                onClick={() => { setDeletingConfig(null); setDeleteConfirmText(""); }}
                className="px-4 py-2 border border-grey-200 rounded-lg text-[14px]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => deleteConfigMutation.mutate(deletingConfig.id)}
                disabled={deleteConfirmText !== "delete" || deleteConfigMutation.isPending}
                className="px-6 py-2 bg-danger text-white rounded-lg text-[14px] font-semibold disabled:opacity-40"
              >
                {deleteConfigMutation.isPending ? "Deleting…" : "Delete config"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
