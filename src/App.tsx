import {
  useCallback,
  useEffect,
  useRef,
  useMemo,
  useState,
  type CSSProperties,
} from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Box,
  ChevronDown,
  ChevronRight,
  Circle,
  CircleHelp,
  Command,
  FlaskConical,
  FileCheck2,
  Focus,
  Layers3,
  List,
  Maximize2,
  Minimize2,
  Minus,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Search,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Square,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import GraphCanvas, { type GraphControls } from "./components/GraphCanvas";
import NodeDetails from "./components/NodeDetails";
import StepView from "./components/StepView";
import ScenarioExplorer from "./components/ScenarioExplorer";
import ResultsPanel from "./components/ResultsPanel";
import { useSimulationRun } from "./hooks/useSimulationRun";
import { useBackendCatalog } from "./hooks/useBackendCatalog";
import { backendResult, nodePresentation, scenarioSources } from "./data/backendPresentation";
import type { RunInput } from "./api/types";
import {
  graph,
  neighbors,
  nodeById,
  statusFor,
  statusLabel,
  steps,
} from "./data/graph";
import { useMotion, useReducedMotion } from "./hooks/useMotion";
import {
  HOLD_DURATION,
  HOLD_HINT,
  useHoldShortcut,
  type CursorMode,
} from "./hooks/useHoldShortcut";
import { useIntroSound } from "./hooks/useIntroSound";
import {
  ADDITIONAL_CONTEXT_MAX_LENGTH,
  additionalContextError,
  sourceLabels,
  type ImportedSource,
  type ScenarioWorkspace,
} from "./data/scenario";

export default function App() {
  const reduced = useReducedMotion();
  const {
    isImmersive,
    setImmersive,
    introComplete,
    introStartedAt,
    introStage,
    phase,
  } = useMotion(reduced);
  const {
    soundEnabled,
    toggleSound,
    audioState,
    emitAudio,
    stopSimulationAudio,
  } = useIntroSound(introStage, introStartedAt, reduced);
  const [cursorMode, setCursorMode] = useState<CursorMode>("visible");
  const [leftOpen, setLeftOpen] = useState(() => window.innerWidth >= 1100);
  const [rightOpen, setRightOpen] = useState(() => window.innerWidth >= 1100);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null);
  const [hoverPoint, setHoverPoint] = useState({ x: 0, y: 0 });
  const [compactOpen, setCompactOpen] = useState(false);
  const [view, setView] = useState<"graph" | "steps">("graph");
  const [showContext, setShowContext] = useState(true);
  const [selectedAgent, setSelectedAgent] = useState("");
  const { scenarios, models, catalogError, loading } = useBackendCatalog();
  const executableSources = useMemo(() => scenarioSources(scenarios), [scenarios]);
  const modelKey = (model: { providerId: string; modelId: string | null }) => `${model.providerId}:${model.modelId ?? ""}`;
  const [workspace, setWorkspace] = useState<ScenarioWorkspace>({
    selectedSource: null,
    additionalContext: "",
  });
  const [importedSources, setImportedSources] = useState<ImportedSource[]>([]);
  const [explorerOpen, setExplorerOpen] = useState(false);
  useEffect(() => {
    if (executableSources.length) setWorkspace((current) => current.selectedSource ? current : { ...current, selectedSource: executableSources[0] });
    const available = models.find((model) => model.configured);
    if (available) setSelectedAgent((current) => current || modelKey(available));
  }, [executableSources, models]);
  const selectedModel = models.find((model) => modelKey(model) === selectedAgent && model.configured);
  const supportedSource = executableSources.find((source) => source.id === workspace.selectedSource?.id);
  const executionBlock = loading ? "Connecting to backend…" : catalogError ? `Backend connection error: ${catalogError}`
    : !supportedSource ? "This source is preview-only. Select a backend-supported scenario in the Explorer."
    : additionalContextError(workspace.additionalContext) ?? (workspace.additionalContext.trim() ? "Additional Context is retained, but arbitrary context is unsupported by the backend. Clear it to run."
    : !selectedModel ? "No configured provider/model is available. Configure the backend provider."
    : null);
  const contextError = additionalContextError(workspace.additionalContext);
  const [browserOpen, setBrowserOpen] = useState(false);
  const [query, setQuery] = useState("");
  const input: RunInput | null = supportedSource && selectedModel ? {
    scenarioId: "ssh-brute-force", initialVariant: supportedSource.id.endsWith(":protectedInternalSource") ? "protectedInternalSource" : "externalSource",
    providerId: selectedModel.providerId, modelId: selectedModel.modelId, additionalContext: workspace.additionalContext,
  } : null;
  const {
    running,
    runId,
    snapshot,
    events,
    error: runError,
    pending,
    completed,
    isResultsOpen,
    pause: pauseDemonstration,
    stop: stopDemonstration,
    run: runDemonstration,
    retry: retryDemonstration,
    setResultsOpen,
    toggleResults,
    canRetry,
  } = useSimulationRun(input, executionBlock);
  const simulationStatus = snapshot?.status ?? "IDLE";
  const restoredSelection = useRef<string | null>(null);
  useEffect(() => {
    if (!snapshot || restoredSelection.current === snapshot.id || !executableSources.length) return;
    restoredSelection.current = snapshot.id;
    const source = executableSources.find((item) => item.id === `backend:${snapshot.configuration.scenario.id}:${snapshot.configuration.initialVariant}`);
    if (source) setWorkspace((current) => ({ ...current, selectedSource: source }));
    const providerId = snapshot.configuration.providerId.startsWith("fixture-") ? "fixture" : snapshot.configuration.providerId;
    setSelectedAgent(`${providerId}:${snapshot.configuration.modelId ?? ""}`);
  }, [snapshot, executableSources]);
  const evaluationResult = backendResult(snapshot, events);
  const { statuses: nodeStatuses, activeNodeId } = nodePresentation(snapshot, events);
  const demoIndex = activeNodeId ? steps.findIndex((step) => step.id === activeNodeId) : -1;
  const simulationDisabled = pending || !!runId && !snapshot || !!executionBlock && !completed && !running;
  const simulationAction = useCallback(() => {
    if (pending) return;
    if (completed) {
      toggleResults();
      return;
    }
    if (executionBlock && !running) return;
    if (running)
      stopDemonstration();
    else runDemonstration();
  }, [
    completed,
    toggleResults,
    executionBlock,
    running,
    stopDemonstration,
    runDemonstration,
    pending,
  ]);
  const simulationActionName = completed
    ? isResultsOpen
      ? "Hide results"
      : "Show results"
    : running
      ? "Stop demonstration"
      : snapshot?.status === "PAUSED"
        ? "Resume demonstration"
        : "Run demonstration";
  const confirmSource = (source: ImportedSource) => {
    if (source.id !== workspace.selectedSource?.id) pauseDemonstration();
    setWorkspace((current) => ({ ...current, selectedSource: source }));
    if (source.sourceType === "local_file")
      setImportedSources((current) =>
        current.some((item) => item.id === source.id)
          ? current
          : [...current, source],
      );
    setExplorerOpen(false);
  };
  const audioCursor = useRef({ runId: "", sequence: 0 });
  const audioMountedAt = useRef(Date.now());
  useEffect(() => {
    if (!runId) return;
    if (audioCursor.current.runId !== runId) audioCursor.current = { runId, sequence: 0 };
    for (const event of events) {
      if (event.sequence <= audioCursor.current.sequence) continue;
      if (Date.parse(event.createdAt) < audioMountedAt.current) {
        audioCursor.current.sequence = event.sequence;
        continue;
      }
      if (event.eventType === "step.started") emitAudio("NODE_ENTERED");
      if (event.eventType === "transition.committed") emitAudio("NODE_COMPLETED");
      if (event.eventType === "decision.evaluated" && event.payload.verdict === "REJECTED") emitAudio("NODE_INTERCEPTED");
      if (event.eventType === "run.finished" && event.payload.outcome === "PASS") emitAudio("SIMULATION_COMPLETED");
      if (event.eventType === "run.finished" && event.payload.status === "FAILED") emitAudio("NODE_FAILED");
      audioCursor.current.sequence = event.sequence;
    }
  }, [events, runId, emitAudio]);
  useEffect(() => {
    if (snapshot?.status === "PAUSED" || snapshot?.status === "CANCELLED") stopSimulationAudio();
  }, [snapshot?.status, stopSimulationAudio]);
  const graphApi = useRef<GraphControls>(null);
  const helpDialog = useRef<HTMLDialogElement>(null);
  const settingsDialog = useRef<HTMLDialogElement>(null);
  const nodeBrowser = useRef<HTMLDivElement>(null);
  const dismissResultsFocus = useCallback(() => graphApi.current?.focus(), []);
  const closeResults = useCallback(
    () => setResultsOpen(false),
    [setResultsOpen],
  );
  const toggleImmersive = useCallback(() => {
    setView("graph");
    setBrowserOpen(false);
    setCompactOpen(false);
    setHoveredNodeId(null);
    setCursorMode(isImmersive ? "visible" : "hidden");
    setImmersive((value) => !value);
    // A pointer-activated fullscreen button must not retain native Space-to-click
    // focus: subsequent graph gestures belong to the canvas, not that button.
    graphApi.current?.focus();
  }, [setImmersive, isImmersive]);
  const exitImmersive = useCallback(() => {
    setImmersive(false);
    setCompactOpen(false);
    setCursorMode("visible");
  }, [setImmersive]);
  const holding = useHoldShortcut(toggleImmersive, exitImmersive, isImmersive, {
    simulation: simulationAction,
    resultsOpen: isResultsOpen,
    closeResults,
    toggleCursor: () =>
      setCursorMode((mode) => (mode === "hidden" ? "visible" : "hidden")),
    orbit: (key, pressed) => graphApi.current?.orbit(key, pressed),
    graphActive: () =>
      view === "graph" &&
      document.activeElement?.matches('[data-graph-keyboard="true"]') === true,
  });
  const openLeftDrawer = () => {
    if (window.innerWidth < 1100) setRightOpen(false);
    setLeftOpen(true);
  };
  const openRightDrawer = () => {
    if (window.innerWidth < 1100) setLeftOpen(false);
    setRightOpen(true);
  };
  const selectNode = useCallback(
    (id: string, navigated = false) => {
      if (id !== selectedNodeId || navigated)
        emitAudio(
          navigated ? "NODE_NAVIGATED" : "NODE_SELECTED",
          Math.max(
            -0.5,
            Math.min(0.5, (nodeById.get(id)?.position[0] ?? 0) / 15),
          ),
        );
      setSelectedNodeId(id);
      if (nodeById.get(id)?.kind === "metadata") setShowContext(true);
      setBrowserOpen(false);
      if (isImmersive) setCompactOpen(true);
      else {
        if (window.innerWidth < 1100) setLeftOpen(false);
        setRightOpen(true);
      }
    },
    [isImmersive, selectedNodeId, emitAudio],
  );
  const dismissSelection = useCallback(() => {
    setSelectedNodeId(null);
    setHoveredNodeId(null);
    setFocusedNodeId(null);
    setCompactOpen(false);
  }, []);
  const navigateToNode = useCallback(
    (id: string) => {
      if (!nodeById.has(id)) return;
      selectNode(id, true);
      graphApi.current?.navigateToNode(id);
    },
    [selectNode],
  );
  const onHover = useCallback(
    (id: string | null, point?: { x: number; y: number }) => {
      setHoveredNodeId(id);
      if (point) setHoverPoint(point);
    },
    [],
  );

  useEffect(() => {
    const narrow = window.matchMedia("(max-width: 1099px)");
    const collapseForNarrow = () => {
      if (narrow.matches) {
        setLeftOpen(false);
        setRightOpen(false);
      }
    };
    narrow.addEventListener("change", collapseForNarrow);
    return () => narrow.removeEventListener("change", collapseForNarrow);
  }, []);

  useEffect(() => {
    if (!browserOpen) {
      setFocusedNodeId(null);
      return;
    }
    const dismiss = (event: PointerEvent) => {
      if (!nodeBrowser.current?.contains(event.target as Node))
        setBrowserOpen(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setBrowserOpen(false);
      }
    };
    document.addEventListener("pointerdown", dismiss);
    nodeBrowser.current?.addEventListener("keydown", key);
    const element = nodeBrowser.current;
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      element?.removeEventListener("keydown", key);
    };
  }, [browserOpen]);
  const hoverNode = hoveredNodeId ? nodeById.get(hoveredNodeId) : null;
  const demoState = snapshot ? `${snapshot.status}${snapshot.evaluation ? ` · ${snapshot.evaluation.outcome}` : ""}` : pending ? "Creating run…" : "Ready to explore";

  return (
    <div
      className={`app ${isImmersive ? "immersive" : ""} ${introComplete ? "intro-complete" : "intro-running"} ${reduced ? "reduced-motion" : ""} ${isImmersive && cursorMode === "hidden" ? "cursor-hidden" : ""}`}
      data-phase={phase}
      data-immersive={isImmersive}
      data-cursor={isImmersive ? cursorMode : "visible"}
      data-intro-stage={introStage}
      data-audio-state={audioState}
      data-demo-index={demoIndex}
      data-demo-running={running}
      data-simulation-status={simulationStatus}
      data-run-id={runId}
      data-results-open={isResultsOpen}
      style={{ "--hold-duration": `${HOLD_DURATION}ms` } as CSSProperties}
    >
      <header className="top-header" inert={isImmersive}>
        <a className="brand" href="/" aria-label="4Sight home">
          <span className="brand-mark">
            <span />
            <span />
            <span />
            <span />
          </span>
          <span>
            4sight<span className="brand-period">.</span>
          </span>
        </a>
        <div className="header-divider" />
        <span className="workspace-label">Workspace</span>
        <ChevronRight size={13} className="header-chevron" />
        <span className="header-current">Sandbox</span>
        <span className="version-badge">BETA</span>
        <div className="header-right">
          <span className="demo-badge">
            <FlaskConical size={12} />
            Backend sandbox
          </span>
          <button
            className="icon-button help-trigger"
            aria-label="Open guide"
            title="Quick guide"
            onClick={() => helpDialog.current?.showModal()}
          >
            <CircleHelp size={17} />
          </button>
          <button
            className="icon-button header-settings"
            aria-label="Open settings"
            title="Settings"
            onClick={() => settingsDialog.current?.showModal()}
          >
            <Settings size={18} />
          </button>
          <span className="avatar" aria-label="Local workspace">
            LS
          </span>
        </div>
      </header>

      <main className="workspace">
        <aside
          className={`left-drawer drawer ${leftOpen && !isImmersive ? "is-open" : ""}`}
          inert={!leftOpen || isImmersive}
          aria-label="Scenario configuration"
        >
          <div className="left-drawer-inner">
            <div className="drawer-title">
              <span>
                <Box size={16} />
                4Sight Sandbox
              </span>
              <button
                className="icon-button"
                aria-label="Collapse scenario drawer"
                onClick={() => setLeftOpen(false)}
              >
                <PanelLeftClose size={16} />
              </button>
            </div>
            <div className="sidebar-form">
              <section
                className="sidebar-section agent-section"
                aria-labelledby="agent-section-title"
              >
                <label
                  htmlFor="agent-model"
                  className="section-label"
                  id="agent-section-title"
                >
                  AI AGENT / MODEL
                </label>
                <div className="select-wrap">
                  <Sparkles size={15} />
                  <span className="agent-select-value" aria-hidden="true">
                    {selectedModel ? `${selectedModel.providerId === "fixture" ? "Backend fixture · simulated" : selectedModel.providerId} ${selectedModel.modelId ?? ""}` : "No model connected"}
                  </span>
                  <select
                    id="agent-model"
                    aria-label="AI Agent / Model"
                    aria-describedby="agent-availability"
                    value={selectedAgent}
                    onChange={(event) =>
                      setSelectedAgent(event.target.value)
                    }
                  >
                    <option value="">No model connected</option>
                    {models.map((model) => <option key={modelKey(model)} value={modelKey(model)} disabled={!model.configured}>
                      {model.providerId === "fixture" ? "Backend fixture · simulated" : `${model.providerId} · ${model.modelId ?? "not configured"}`}
                    </option>)}
                  </select>
                  <ChevronDown size={13} />
                </div>
                <p
                  className="field-caption"
                  id="agent-availability"
                  role="status"
                >
                  {selectedModel ? selectedModel.providerId === "fixture" ? "Explicit backend fixture mode · no AI inference." : "Configured backend AI provider · simulated proposals only."
                    : catalogError ?? "No agents/models configured on the backend."}
                </p>
              </section>
              <div className="sidebar-section scenario-section">
                <span className="section-label">SCENARIO SOURCE</span>
                <button
                  className="scenario-source-selector"
                  aria-label="Open Scenario Explorer"
                  aria-haspopup="dialog"
                  onClick={() => setExplorerOpen(true)}
                >
                  <ShieldCheck size={16} />
                  <span>
                    <strong>
                      {workspace.selectedSource?.name ?? "Choose a scenario"}
                    </strong>
                    <small>
                      {workspace.selectedSource
                        ? sourceLabels[workspace.selectedSource.sourceType]
                        : "No source selected"}
                    </small>
                    <small>
                      {workspace.selectedSource?.mitreTechniqueIds.join(
                        " · ",
                      ) || "No MITRE technique provided"}
                    </small>
                  </span>
                  <ChevronDown size={13} />
                </button>
              </div>
              <div className="sidebar-section additional-context-section">
                <label htmlFor="additional-context" className="section-label">
                  ADDITIONAL CONTEXT <span>OPTIONAL</span>
                </label>
                <div className="custom-scenario-input">
                  <textarea
                    id="additional-context"
                    name="additionalContext"
                    aria-label="Additional Context"
                    rows={6}
                    maxLength={ADDITIONAL_CONTEXT_MAX_LENGTH}
                    placeholder="Add conditions or extra details to this scenario…"
                    value={workspace.additionalContext}
                    onChange={(event) => {
                      const additionalContext = event.target.value;
                      setWorkspace((current) => ({
                        ...current,
                        additionalContext,
                      }));
                      if (additionalContext.trim()) pauseDemonstration();
                    }}
                    aria-invalid={!!contextError}
                    aria-describedby="context-count composition-status"
                  />
                  <div className="custom-character-count" id="context-count">
                    {workspace.additionalContext.length.toLocaleString("en-US")}{" "}
                    / {ADDITIONAL_CONTEXT_MAX_LENGTH.toLocaleString("en-US")}
                  </div>
                </div>
                <p
                  className={`custom-execution-note ${contextError ? "field-error" : ""}`}
                  id="composition-status"
                  role="status"
                >
                  {runError ?? executionBlock ?? "Ready for backend Narrative and Referee execution. No real security actions."}
                </p>
              </div>
            </div>
            <div className="demo-controls">
              <div className="demo-control-title">
                <span>
                  <span
                    className={`tiny-dot ${running ? "running-dot" : ""}`}
                  />
                  {completed
                    ? demoState
                    : executionBlock
                      ? "Composition · not executed"
                      : demoState}
                </span>
                <button
                  className="icon-button"
                  title={
                    executionBlock
                      ? `Retry unavailable · ${executionBlock}`
                      : "Retry demonstration · start a fresh run"
                  }
                  aria-label="Retry Demonstration"
                  data-simulation-control="true"
                  disabled={!canRetry}
                  onClick={retryDemonstration}
                >
                  <RotateCcw size={13} />
                </button>
              </div>
              <button
                className="run-button"
                data-simulation-control="true"
                disabled={simulationDisabled}
                title={
                  completed
                    ? `${simulationActionName} · Ctrl + Space`
                    : undefined
                }
                aria-expanded={completed ? isResultsOpen : undefined}
                aria-describedby="composition-status"
                onClick={() => {
                  if (completed) {
                    toggleResults();
                    return;
                  }
                  if (pending || executionBlock && !running) return;
                  if (running) pauseDemonstration();
                  else runDemonstration();
                }}
              >
                {completed ? (
                  <FileCheck2 size={15} />
                ) : running ? (
                  <Pause size={14} />
                ) : (
                  <Play size={14} fill="currentColor" />
                )}
                {completed
                  ? simulationActionName
                  : executionBlock
                    ? "Evaluation unavailable"
                    : running
                      ? "Pause demonstration"
                      : snapshot?.status === "PAUSED"
                        ? "Resume demo"
                        : "Run demonstration"}
                <span>{running ? "II" : <ArrowRight size={15} />}</span>
              </button>
              <p>
                {runError ?? (executionBlock
                  ? "Source + context retained · not evaluated"
                  : "Backend-persisted evaluation · simulated actions only")}
              </p>
            </div>
            <div className="sidebar-bottom">
              <span className="local-status">
                <span />
                Local sandbox
              </span>
              <span>v0.1</span>
            </div>
          </div>
        </aside>

        <section className="graph-stage" aria-label="Playbook workspace">
          <div className="stage-top" inert={isImmersive}>
            <div className="stage-title-row">
              <div className="stage-heading">
                {!leftOpen && (
                  <button
                    className="icon-button drawer-open-button"
                    aria-label="Expand scenario drawer"
                    onClick={openLeftDrawer}
                  >
                    <PanelLeftOpen size={17} />
                  </button>
                )}
                <span className="eyebrow">SANDBOX / PLAYBOOK 001</span>
              </div>
              <div className="stage-top-actions">
                <span className="saved-indicator">
                  <span />
                  Local dataset
                </span>
                {!rightOpen && (
                  <button
                    className="icon-button"
                    aria-label="Expand node inspector"
                    onClick={openRightDrawer}
                  >
                    <PanelRightOpen size={17} />
                  </button>
                )}
              </div>
            </div>
            <div className="stage-title-main">
              <div>
                <h1>
                  {snapshot?.configuration.scenario.title ?? workspace.selectedSource?.name ?? "Security playbook"}<span className="title-dot">.</span>
                </h1>
                <p>
                  {executionBlock
                    ? "Reference playbook only · not generated from the selected source or context."
                    : "A clearer view of every decision."}
                </p>
              </div>
            </div>
            <div className="stage-subtoolbar">
              <div className="view-tabs" aria-label="Visualization mode">
                <button
                  className={view === "graph" ? "active" : ""}
                  onClick={() => setView("graph")}
                >
                  <Network size={14} />
                  Graph
                </button>
                <button
                  className={view === "steps" ? "active" : ""}
                  onClick={() => setView("steps")}
                >
                  <List size={14} />
                  Steps
                </button>
              </div>
              <span className="graph-stats">
                5 steps
                <span />
                80 context nodes
              </span>
            </div>
          </div>

          <div className="canvas-area">
            <div
              className={`scene-layer ${view === "graph" ? "" : "scene-hidden"}`}
              inert={view !== "graph"}
            >
              <GraphCanvas
                ref={graphApi}
                selectedNodeId={selectedNodeId}
                hoveredNodeId={hoveredNodeId}
                focusedNodeId={focusedNodeId}
                onHover={onHover}
                onSelect={selectNode}
                onDeselect={dismissSelection}
                introStartedAt={introStartedAt}
                introComplete={introComplete}
                isImmersive={isImmersive}
                reducedMotion={reduced}
                demoIndex={demoIndex}
                running={running}
                runId={runId ?? ""}
                executionIdentity={`${runId ?? ""}:${events.filter((event) => event.eventType === "step.started").at(-1)?.sequence ?? 0}`}
                nodeStatuses={nodeStatuses}
                activeNodeId={activeNodeId}
                terminal={completed}
                showContext={showContext}
                visible={view === "graph"}
              />
            </div>
            {view === "steps" && (
              <StepView
                selectedId={selectedNodeId}
                demoIndex={demoIndex}
                nodeStatuses={nodeStatuses}
                onSelect={selectNode}
              />
            )}

            <div className="canvas-top-left" inert={isImmersive}>
              <div className="spatial-label">
                <span />
                {view === "graph" ? "SPATIAL NETWORK" : "WORKFLOW SEQUENCE"}
              </div>
              <span className="spatial-subtitle">
                {view === "graph"
                  ? "Connected context. Considered action."
                  : "A directed, five-step demonstration."}
              </span>
            </div>
            <div className="canvas-top-right">
              <button
                className="icon-button canvas-button"
                aria-label={
                  soundEnabled ? "Mute intro sound" : "Enable intro sound"
                }
                aria-pressed={soundEnabled}
                title={
                  soundEnabled
                    ? `Sound on${audioState === "waiting" ? " · waiting for browser audio permission" : audioState === "reduced-motion" ? " · silent with reduced motion" : " · spatial ambience and interaction cues"} · click to mute`
                    : "Sound off · click to enable"
                }
                onClick={toggleSound}
              >
                {soundEnabled ? <Volume2 size={15} /> : <VolumeX size={15} />}
              </button>
              <div className="node-browser-anchor" ref={nodeBrowser}>
                <button
                  className={`icon-button canvas-button ${browserOpen ? "active" : ""}`}
                  aria-label="Browse graph nodes"
                  title="Browse nodes"
                  aria-expanded={browserOpen}
                  onClick={() => setBrowserOpen((value) => !value)}
                >
                  <Search size={16} />
                </button>
                {browserOpen && (
                  <div
                    className="node-browser"
                    role="dialog"
                    aria-label="Node browser"
                  >
                    <div className="node-browser-search">
                      <Search size={14} />
                      <input
                        aria-label="Find a node"
                        placeholder="Find a node…"
                        autoFocus
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                      />
                      <button
                        className="icon-button"
                        aria-label="Close node browser"
                        onClick={() => setBrowserOpen(false)}
                      >
                        <X size={14} />
                      </button>
                    </div>
                    <div className="node-browser-list">
                      {graph.nodes
                        .filter((node) =>
                          `${node.name} ${node.id}`
                            .toLowerCase()
                            .includes(query.toLowerCase()),
                        )
                        .map((node) => (
                          <button
                            key={node.id}
                            onFocus={() => setFocusedNodeId(node.id)}
                            onBlur={() => setFocusedNodeId(null)}
                            onClick={() => selectNode(node.id)}
                          >
                            <span className={`browser-node-dot ${node.kind}`} />
                            <span>
                              {node.name}
                              <small>
                                {node.kind === "workflow"
                                  ? "Workflow step"
                                  : "Display-only context"}
                              </small>
                            </span>
                            <code>{node.id}</code>
                          </button>
                        ))}
                    </div>
                  </div>
                )}
              </div>
              <button
                className={`immersive-toggle icon-button canvas-button ${holding ? "is-holding" : ""}`}
                aria-label={
                  isImmersive ? "Exit immersive mode" : "Enter immersive mode"
                }
                aria-pressed={isImmersive}
                title={`${isImmersive ? "Exit" : "Enter"} immersive mode · hold Space ${HOLD_HINT}`}
                onClick={toggleImmersive}
              >
                <svg
                  className="hold-ring"
                  viewBox="0 0 40 40"
                  aria-hidden="true"
                >
                  <circle cx="20" cy="20" r="18" />
                </svg>
                {isImmersive ? (
                  <Minimize2 size={17} />
                ) : (
                  <Maximize2 size={17} />
                )}
              </button>
            </div>

            {view === "graph" && (
              <>
                <div className="canvas-bottom-left">
                  {isImmersive && (
                    <button
                      className="icon-button immersive-simulation-button"
                      data-simulation-control="true"
                      disabled={simulationDisabled}
                      aria-label={
                        simulationDisabled
                          ? "Demonstration unavailable"
                          : simulationActionName
                      }
                      aria-keyshortcuts="Control+Space"
                      aria-describedby={
                        executionBlock ? "composition-status" : undefined
                      }
                      title={
                        simulationDisabled
                          ? `Demonstration unavailable · Ctrl + Space · ${executionBlock}`
                          : `${simulationActionName} · Ctrl + Space`
                      }
                      onClick={() => {
                        simulationAction();
                        graphApi.current?.focus();
                      }}
                    >
                      {completed ? (
                        <FileCheck2 size={17} />
                      ) : running ? (
                        <Square size={17} fill="currentColor" />
                      ) : (
                        <Play size={17} fill="currentColor" />
                      )}
                    </button>
                  )}
                  {isImmersive && (
                    <button
                      className="icon-button immersive-retry-button"
                      data-simulation-control="true"
                      aria-label="Retry Demonstration"
                      title={
                        executionBlock
                          ? `Retry unavailable · ${executionBlock}`
                          : "Retry demonstration · start a fresh run"
                      }
                      disabled={!canRetry}
                      onClick={() => {
                        retryDemonstration();
                        graphApi.current?.focus();
                      }}
                    >
                      <RotateCcw size={17} />
                    </button>
                  )}
                  <div className="zoom-controls">
                    <button
                      aria-label="Zoom in"
                      title="Zoom in"
                      onClick={() => graphApi.current?.zoom(0.85)}
                    >
                      <Plus size={15} />
                    </button>
                    <button
                      aria-label="Zoom out"
                      title="Zoom out"
                      onClick={() => graphApi.current?.zoom(1.18)}
                    >
                      <Minus size={15} />
                    </button>
                    <span />
                    <button
                      aria-label="Recenter graph"
                      title="Recenter graph"
                      onClick={() => graphApi.current?.reset()}
                    >
                      <Focus size={15} />
                    </button>
                  </div>
                  <div className="graph-legend">
                    <span>
                      <i className="legend-workflow" />
                      Workflow
                    </span>
                    <span>
                      <i className="legend-context" />
                      Context
                    </span>
                  </div>
                </div>
                <div className="canvas-bottom-right">
                  <span className="drag-hint">
                    Drag / scroll / arrows to orbit<span>·</span>+ / − to zoom
                  </span>
                  <span className="space-hint">
                    <kbd>space</kbd> {HOLD_HINT} to{" "}
                    {isImmersive ? "exit" : "immerse"}
                    {isImmersive && " · double press: cursor"}
                  </span>
                </div>
              </>
            )}
            {isImmersive && compactOpen && selectedNodeId && (
              <div className="immersive-detail">
                <NodeDetails
                  id={selectedNodeId}
                  demoIndex={demoIndex}
                  nodeStatuses={nodeStatuses}
                  compact
                  onClose={dismissSelection}
                  onSelect={navigateToNode}
                />
              </div>
            )}
            {!introComplete && (
              <div className="intro-caption" aria-live="polite">
                <span />
                Connecting the context
              </div>
            )}
          </div>

          <footer className="stage-footer" inert={isImmersive}>
            <span>
              <span className={`tiny-dot ${running ? "running-dot" : ""}`} />
              {completed
                ? demoState
                : executionBlock
                  ? "Composition · not executed"
                  : demoState}
            </span>
            <span>
              <FlaskConical size={11} />
              Backend run<span className="footer-divider">/</span>Simulated actions
            </span>
            <button
              aria-label="Open interaction guide"
              onClick={() => helpDialog.current?.showModal()}
            >
              <Command size={12} />
              Shortcuts
            </button>
          </footer>
        </section>

        <aside
          className={`right-drawer drawer ${rightOpen && !isImmersive ? "is-open" : ""}`}
          inert={!rightOpen || isImmersive}
          aria-label="Node inspector"
        >
          <div className="right-drawer-inner">
            <div className="drawer-title">
              <span>
                <SlidersHorizontal size={15} />
                Inspector
              </span>
              <button
                className="icon-button"
                aria-label="Collapse node inspector"
                onClick={() => setRightOpen(false)}
              >
                <PanelRightClose size={16} />
              </button>
            </div>
            <div className="inspector-scroll">
              <NodeDetails
                id={selectedNodeId}
                demoIndex={demoIndex}
                nodeStatuses={nodeStatuses}
                onSelect={navigateToNode}
                onClose={dismissSelection}
              />
            </div>
            <div className="inspector-bottom">
              <Circle size={10} />
              Selection persists across views
            </div>
          </div>
        </aside>
      </main>

      {!isImmersive && (leftOpen || rightOpen) && (
        <button
          className="drawer-backdrop"
          aria-label="Close overlay drawers"
          onClick={() => {
            setLeftOpen(false);
            setRightOpen(false);
          }}
        />
      )}
      {hoverNode && view === "graph" && (
        <div
          className="node-tooltip"
          style={{
            left: Math.max(
              12,
              Math.min(hoverPoint.x + 18, window.innerWidth - 256),
            ),
            top: Math.max(
              12,
              Math.min(hoverPoint.y + 16, window.innerHeight - 140),
            ),
          }}
          role="tooltip"
        >
          <div>
            <span className={`browser-node-dot ${hoverNode.kind}`} />
            <strong>{hoverNode.name}</strong>
            <code>{hoverNode.id}</code>
          </div>
          <span>
            {hoverNode.kind === "workflow"
              ? statusLabel(nodeStatuses[hoverNode.id] ?? statusFor(hoverNode.id, demoIndex))
              : "Display-only context · not executable"}
          </span>
          <p>
            {hoverNode.kind === "workflow"
              ? "Persisted backend execution state."
              : "Related metadata, not a workflow step."}
          </p>
          <small>
            {neighbors.get(hoverNode.id)?.size ?? 0} related entities · click to
            inspect <ArrowUpRight size={11} />
          </small>
        </div>
      )}

      <ScenarioExplorer
        open={explorerOpen}
        selectedSource={workspace.selectedSource}
        importedSources={importedSources}
        executableSources={executableSources}
        onConfirm={confirmSource}
        onDismiss={() => setExplorerOpen(false)}
      />
      <ResultsPanel
        result={evaluationResult}
        open={isResultsOpen}
        onClose={closeResults}
        onDismissFocus={dismissResultsFocus}
      />

      <dialog
        ref={settingsDialog}
        className="help-dialog settings-dialog"
        aria-labelledby="settings-title"
      >
        <div className="help-header">
          <span className="eyebrow">WORKSPACE PREFERENCES</span>
          <button
            className="icon-button"
            aria-label="Close settings"
            onClick={() => settingsDialog.current?.close()}
          >
            <X size={18} />
          </button>
        </div>
        <h2 id="settings-title">Settings</h2>
        <section aria-labelledby="graph-preferences-title">
          <h3 id="graph-preferences-title" className="section-label">
            GRAPH PREFERENCES
          </h3>
          <button
            className="switch-row"
            role="switch"
            aria-checked={showContext}
            aria-describedby="context-setting-description"
            onClick={() => setShowContext((value) => !value)}
          >
            <span>
              <Layers3 size={14} />
              Context relationships
            </span>
            <span className={`switch ${showContext ? "on" : ""}`} />
          </button>
          <p id="context-setting-description" className="field-caption">
            Show display-only context around the five workflow steps. This
            preference is retained for the current session.
          </p>
        </section>
      </dialog>

      <dialog ref={helpDialog} className="help-dialog">
        <div className="help-header">
          <span className="eyebrow">A QUICK GUIDE</span>
          <button
            className="icon-button"
            aria-label="Close guide"
            onClick={() => helpDialog.current?.close()}
          >
            <X size={18} />
          </button>
        </div>
        <h2>Make room for perspective.</h2>
        <p>
          Explore the relationships behind a security playbook. Every state in
          execution result is supplied by the backend Referee.
        </p>
        <div className="help-rows">
          <div>
            <span>Rotate the network</span>
            <kbd>Drag / two-finger scroll</kbd>
          </div>
          <div>
            <span>Rotate with keyboard (focus graph)</span>
            <kbd>↑ ↓ ← →</kbd>
          </div>
          <div>
            <span>Zoom in or out</span>
            <kbd>+ / − · pinch / Ctrl+scroll</kbd>
          </div>
          <div>
            <span>Pan the camera</span>
            <kbd>Ctrl + drag / right drag / two fingers</kbd>
          </div>
          <div>
            <span>Inspect a node</span>
            <kbd>Click / node browser</kbd>
          </div>
          <div>
            <span>Toggle immersive mode</span>
            <kbd>Hold Space · {HOLD_HINT}</kbd>
          </div>
          <div>
            <span>Run / resume / stop demonstration</span>
            <kbd>Ctrl + Space</kbd>
          </div>
          <div>
            <span>Toggle cursor in immersive mode</span>
            <kbd>Double Space · 350ms</kbd>
          </div>
          <div>
            <span>Clear selected node</span>
            <kbd>Empty space / details ×</kbd>
          </div>
          <div>
            <span>Exit immersive mode</span>
            <kbd>Esc</kbd>
          </div>
        </div>
        <div className="help-note">
          <FlaskConical size={15} />
          Backend-evaluated proposals only. No real endpoint or SOAR actions.
        </div>
        <button
          className="run-button"
          onClick={() => helpDialog.current?.close()}
        >
          Start exploring
          <ArrowRight size={15} />
        </button>
      </dialog>
    </div>
  );
}
