import { useEffect, useMemo, useRef, useState } from "react";
import { Check, FileText, Globe, Search, Upload, X } from "lucide-react";
import {
  builtinScenarios,
  filterSources,
  sourceAdapters,
  sourceLabels,
  type ImportedSource,
} from "../data/scenario";
import {
  importLocalFile,
  MAX_IMPORT_BYTES,
  URL_IMPORT_UNAVAILABLE,
  validateSourceUrl,
} from "../data/scenarioImport";

type Tab = "library" | "file" | "url";
type Props = {
  open: boolean;
  selectedSource: ImportedSource | null;
  importedSources: ImportedSource[];
  onConfirm: (source: ImportedSource) => void;
  onDismiss: () => void;
};

export default function ScenarioExplorer({
  open,
  selectedSource,
  importedSources,
  onConfirm,
  onDismiss,
}: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const request = useRef(0);
  const [tab, setTab] = useState<Tab>("library");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("library");
  const [technique, setTechnique] = useState("");
  const [pending, setPending] = useState<ImportedSource | null>(null);
  const [fileStatus, setFileStatus] = useState("");
  const [fileError, setFileError] = useState("");
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState("");
  const [urlStatus, setUrlStatus] = useState("");
  const [mobilePane, setMobilePane] = useState<"sources" | "preview">(
    "sources",
  );
  const previewText = useMemo(() => {
    if (!pending) return "";
    if (pending.originalFormat === "json") {
      try {
        return JSON.stringify(JSON.parse(pending.rawContent), null, 2);
      } catch {
        /* Preserve literal source text if formatting is unavailable. */
      }
    }
    return pending.rawContent;
  }, [pending]);

  useEffect(() => {
    if (open) {
      setPending(selectedSource);
      setTab("library");
      setQuery("");
      setCategory("library");
      setTechnique("");
      setFileError("");
      setFileStatus("");
      setBusy(false);
      setUrl("");
      setUrlStatus("");
      setMobilePane("sources");
      if (!dialog.current?.open) dialog.current?.showModal();
    } else {
      request.current++;
      dialog.current?.close();
    }
    return () => {
      request.current++;
    };
    // A new opening snapshots the current selection; editing the preview never commits it.
  }, [open, selectedSource]);
  const adapter = sourceAdapters.find((adapter) => adapter.type === category);
  const sources = adapter
    ? adapter.samples
    : category === "local_file"
      ? importedSources
      : category === "builtin"
        ? builtinScenarios
        : [...builtinScenarios, ...importedSources];
  const techniques = [
    ...new Set(sources.flatMap((source) => source.mitreTechniqueIds)),
  ].sort();
  const visible = filterSources(sources, query, technique);
  const switchTab = (next: Tab) => {
    request.current++;
    setTab(next);
    setPending(null);
    setBusy(false);
    setFileStatus("");
    setFileError("");
    setUrlStatus("");
    setMobilePane("sources");
  };
  const readFile = async (file: File | undefined) => {
    if (!file) return;
    const token = ++request.current;
    setPending(null);
    setBusy(true);
    setFileStatus(`Reading ${file.name}…`);
    setFileError("");
    try {
      const source = await importLocalFile(file);
      if (token === request.current) {
        setPending(source);
        setMobilePane("preview");
        setFileStatus(`${file.name} · validated for text preview only`);
      }
    } catch (error) {
      if (token === request.current) {
        setFileStatus("");
        setFileError(
          error instanceof Error
            ? error.message
            : "Could not read the file. Try a supported text file.",
        );
      }
    } finally {
      if (token === request.current) setBusy(false);
    }
  };

  return (
    <dialog
      ref={dialog}
      className="scenario-explorer"
      aria-labelledby="explorer-title"
      onCancel={onDismiss}
      onClose={onDismiss}
    >
      <header className="explorer-header">
        <div>
          <h2 id="explorer-title">Scenario Explorer</h2>
          <p>Browse, import and inspect security scenarios.</p>
        </div>
        <button
          className="icon-button"
          aria-label="Close Scenario Explorer"
          onClick={onDismiss}
        >
          <X size={18} />
        </button>
      </header>
      <div className="explorer-navigation">
        <div
          className="explorer-tabs"
          role="tablist"
          aria-label="Scenario source method"
        >
          {(
            [
              ["library", "Library"],
              ["file", "Import File"],
              ["url", "From URL"],
            ] as const
          ).map(([id, label], index) => (
            <button
              key={id}
              role="tab"
              tabIndex={tab === id ? 0 : -1}
              id={`source-tab-${id}`}
              aria-controls={`source-panel-${id}`}
              aria-selected={tab === id}
              onClick={() => switchTab(id)}
              onKeyDown={(event) => {
                const tabs: Tab[] = ["library", "file", "url"];
                let next = index;
                if (event.key === "ArrowRight")
                  next = (index + 1) % tabs.length;
                else if (event.key === "ArrowLeft")
                  next = (index + tabs.length - 1) % tabs.length;
                else if (event.key === "Home") next = 0;
                else if (event.key === "End") next = tabs.length - 1;
                else return;
                event.preventDefault();
                event.stopPropagation();
                switchTab(tabs[next]);
                dialog.current
                  ?.querySelector<HTMLButtonElement>(
                    `#source-tab-${tabs[next]}`,
                  )
                  ?.focus();
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <div
          className="explorer-mobile-navigation"
          role="group"
          aria-label="Explorer panel"
        >
          <button
            aria-pressed={mobilePane === "sources"}
            onClick={() => setMobilePane("sources")}
          >
            Browse sources
          </button>
          <button
            aria-pressed={mobilePane === "preview"}
            onClick={() => setMobilePane("preview")}
          >
            Preview source
          </button>
        </div>
      </div>
      <div className="explorer-columns" data-pane={mobilePane}>
        <section
          className="explorer-source-panel"
          id={`source-panel-${tab}`}
          role="tabpanel"
          aria-labelledby={`source-tab-${tab}`}
        >
          {tab === "library" && (
            <>
              <div className="explorer-source-controls">
                <label className="explorer-search">
                  <Search size={15} />
                  <input
                    aria-label="Search scenarios"
                    placeholder="Search scenarios by name…"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                </label>
                <div className="explorer-filters">
                  <label>
                    Source category
                    <select
                      aria-label="Source category"
                      value={category}
                      onChange={(event) => {
                        setCategory(event.target.value);
                        setTechnique("");
                        setPending(null);
                      }}
                    >
                      <option value="library">Available library</option>
                      <option value="builtin">Built-in library</option>
                      <option value="local_file">Imported files</option>
                      {sourceAdapters.map((adapter) => (
                        <option value={adapter.type} key={adapter.type}>
                          {adapter.label} · samples
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    MITRE technique
                    <select
                      aria-label="MITRE technique"
                      value={technique}
                      onChange={(event) => setTechnique(event.target.value)}
                    >
                      <option value="">All techniques</option>
                      {techniques.map((id) => (
                        <option key={id}>{id}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <p className="explorer-source-note">
                  {adapter
                    ? `${adapter.contentType} · samples only. ${adapter.description}`
                    : "Local library and session imports. The original Endpoint compromise demo is the only supported demonstration."}
                </p>
                <h3 className="section-label">
                  Available scenarios & material
                </h3>
              </div>
              <div className="source-list">
                {visible.map((source) => (
                  <button
                    key={source.id}
                    className={`source-list-item ${pending?.id === source.id ? "is-selected" : ""}`}
                    aria-pressed={pending?.id === source.id}
                    title={source.name}
                    onClick={() => {
                      setPending(source);
                      setMobilePane("preview");
                    }}
                  >
                    <FileText size={15} />
                    <span>
                      <strong>{source.name}</strong>
                      <small>
                        {sourceLabels[source.sourceType]}
                        {source.sample ? " · sample metadata" : ""}
                        <br />
                        {source.mitreTechniqueIds.join(" · ") ||
                          "No technique provided"}
                      </small>
                    </span>
                    {pending?.id === source.id && <Check size={14} />}
                  </button>
                ))}
                {!visible.length && (
                  <p className="explorer-empty">
                    No matching sources. Try another search or import a text
                    file.
                  </p>
                )}
              </div>
            </>
          )}
          {tab === "file" && (
            <div className="explorer-import-content">
              <Upload size={23} className="import-panel-icon" />
              <h3>Import a local source</h3>
              <p>
                JSON, YAML / YML, TXT, or LOG · up to {MAX_IMPORT_BYTES / 1024}{" "}
                KiB. Files stay in this session; no upload occurs.
              </p>
              <label className="source-file-label">
                Choose source file
                <input
                  type="file"
                  accept=".json,.yaml,.yml,.txt,.log"
                  aria-label="Import source file"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    void readFile(file);
                  }}
                />
              </label>
              <p className="explorer-source-note">
                Structured files are syntax-checked. YAML aliases/custom tags,
                binary data and oversized files are rejected. Imported commands
                remain inert text.
              </p>
              {fileStatus && (
                <p role="status" className="import-status">
                  {fileStatus}
                </p>
              )}
              {fileError && (
                <p role="alert" className="field-error import-status">
                  {fileError}
                </p>
              )}
            </div>
          )}
          {tab === "url" && (
            <div className="explorer-import-content">
              <Globe size={23} className="import-panel-icon" />
              <h3>Add from URL</h3>
              <p>
                Check a source address. Direct URL retrieval is not connected in
                this MVP.
              </p>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  setPending(null);
                  setUrlStatus(
                    validateSourceUrl(url.trim()) ?? URL_IMPORT_UNAVAILABLE,
                  );
                }}
              >
                <label className="explorer-url-label">
                  Source URL
                  <input
                    type="text"
                    inputMode="url"
                    maxLength={2048}
                    placeholder="https://example.org/scenario.json"
                    value={url}
                    onChange={(event) => {
                      setUrl(event.target.value);
                      setUrlStatus("");
                    }}
                  />
                </label>
                <button className="explorer-secondary" type="submit">
                  Check URL
                </button>
              </form>
              {urlStatus && (
                <p role="status" className="import-status">
                  {urlStatus}
                </p>
              )}
              <p className="explorer-source-note">
                No unrestricted proxy or background fetch is used. Download
                supported material and choose Import File.
              </p>
            </div>
          )}
        </section>
        <section
          className="source-preview"
          aria-labelledby="source-preview-title"
          aria-busy={busy}
        >
          <h3 className="section-label" id="source-preview-title">
            Scenario preview
          </h3>
          {pending ? (
            <>
              <div className="source-summary">
                <h3 className="source-preview-name">{pending.name}</h3>
                <dl>
                  <div>
                    <dt>Source</dt>
                    <dd>
                      {sourceLabels[pending.sourceType]}
                      {pending.sample ? " · sample, not live" : ""}
                    </dd>
                  </div>
                  <div>
                    <dt>Format</dt>
                    <dd>{pending.originalFormat}</dd>
                  </div>
                  <div>
                    <dt>Material</dt>
                    <dd>{pending.materialType.replaceAll("_", " ")}</dd>
                  </div>
                  <div>
                    <dt>MITRE</dt>
                    <dd>
                      {pending.mitreTechniqueIds.join(", ") || "Not provided"}
                    </dd>
                  </div>
                  {pending.sourceUrl && (
                    <div>
                      <dt>Reference URL</dt>
                      <dd>{pending.sourceUrl}</dd>
                    </div>
                  )}
                  {pending.importedAt && (
                    <div>
                      <dt>Imported</dt>
                      <dd>{new Date(pending.importedAt).toLocaleString()}</dd>
                    </div>
                  )}
                </dl>
                <p className="source-description">{pending.description}</p>
              </div>
              <div className="source-code-panel">
                <h4>
                  Source content{" "}
                  <span>{pending.originalFormat.toUpperCase()}</span>
                </h4>
                <pre
                  className="source-raw-preview"
                  aria-label="Source text preview"
                >
                  {previewText}
                </pre>
              </div>
              <p className="source-capability">
                {pending.sourceType === "builtin"
                  ? "Local reference demonstration available without additional context."
                  : "Preview-only source material. Not a validated executable scenario."}
              </p>
            </>
          ) : (
            <p className="explorer-empty">
              {busy
                ? "Reading your source…"
                : "Select a library item or import a file to preview its content before confirming."}
            </p>
          )}
        </section>
      </div>
      <footer className="explorer-actions">
        <span className="explorer-action-note">
          Preview first. Selection is applied only when confirmed.
        </span>
        <button className="explorer-secondary" onClick={onDismiss}>
          Cancel
        </button>
        <button
          className="run-button"
          disabled={!pending || busy}
          onClick={() => {
            if (pending && !busy) onConfirm(pending);
          }}
        >
          Use Scenario
          <Check size={14} />
        </button>
      </footer>
    </dialog>
  );
}
