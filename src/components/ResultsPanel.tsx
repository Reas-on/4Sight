import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Check, Download, FlaskConical, ShieldCheck, X } from "lucide-react";
import { formatAuditTime } from "../data/formatAuditTime";
import { storyletNodes, type BackendResult } from "../data/backendPresentation";
import { useReducedMotion } from "../hooks/useMotion";

export default function ResultsPanel({
  result,
  open,
  onClose,
  onDismissFocus,
}: {
  result: BackendResult | null;
  open: boolean;
  onClose: () => void;
  onDismissFocus: () => void;
}) {
  const panel = useRef<HTMLElement>(null);
  const reduced = useReducedMotion();
  const [retainedResult, setRetainedResult] = useState(result);
  const [present, setPresent] = useState(open && !!result);
  const animation = useRef<Animation | null>(null);
  const hasEntered = useRef(false);
  const displayResult = result ?? retainedResult;
  useLayoutEffect(() => {
    if (result) setRetainedResult(result);
    if (open && result) {
      setPresent(true);
    }
  }, [open, result]);
  useLayoutEffect(() => {
    const element = panel.current;
    if (!element || !present) return;
    const current = getComputedStyle(element);
    const from = animation.current
      ? { opacity: current.opacity, transform: current.transform }
      : hasEntered.current
        ? { opacity: "1", transform: "translateY(0) scale(1)" }
        : { opacity: "0", transform: "translateY(14px) scale(.97)" };
    animation.current?.cancel();
    const entering = open && !!result;
    element.dataset.presence = entering ? "entering" : "exiting";
    if (reduced) {
      element.style.opacity = "1";
      element.style.transform = "none";
      if (!entering) {
        hasEntered.current = false;
        setPresent(false);
      } else {
        hasEntered.current = true;
        element.dataset.presence = "open";
      }
      animation.current = null;
      return;
    }
    const motion = element.animate(
      [
        from,
        entering
          ? { opacity: 1, transform: "translateY(0) scale(1)" }
          : { opacity: 0, transform: "translateY(8px) scale(.98)" },
      ],
      {
        duration: entering ? 250 : 190,
        easing: entering
          ? "cubic-bezier(.2,.7,.2,1)"
          : "cubic-bezier(.4,0,1,1)",
        fill: "forwards",
      },
    );
    animation.current = motion;
    hasEntered.current = true;
    motion.onfinish = () => {
      if (animation.current !== motion) return;
      if (!entering) {
        hasEntered.current = false;
        animation.current = null;
        setPresent(false);
      } else element.dataset.presence = "open";
    };
    return () => {
      motion.onfinish = null;
    };
  }, [open, present, reduced, result]);
  useEffect(() => () => animation.current?.cancel(), []);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement;
    panel.current?.focus({ preventScroll: true });
    return () => {
      if (
        previous instanceof HTMLElement &&
        previous.isConnected &&
        !previous.closest("[inert]")
      )
        previous.focus({ preventScroll: true });
      else onDismissFocus();
    };
  }, [open, present, onDismissFocus]);
  if (!displayResult || !present) return null;
  // Retain the completed snapshot during exit even when Retry clears its source.
  result = displayResult;
  const { run, ruleAdherence } = result;
  const evaluation = run.evaluation!;
  const providerLabel = run.configuration.modelId
    ? `${run.configuration.providerId} · ${run.configuration.modelId}` : `${run.configuration.providerId} · deterministic fixture`;
  return (
    <div className="results-overlay">
      <section
        ref={panel}
        className="results-panel"
        data-results-panel="true"
        role="dialog"
        aria-modal="false"
        aria-labelledby="results-title"
        aria-describedby="results-fixture-note"
        tabIndex={-1}
        data-run-id={run.id}
        inert={!open}
        aria-hidden={!open}
      >
        <header className="results-header">
          <div>
            <span className="results-eyebrow">CISO GO/NO-GO GATE</span>
            <h2 id="results-title">Simulation Results</h2>
            <p>CISO Go/No-Go Evaluation</p>
          </div>
          <div className="results-header-actions">
            <span className="results-pass-badge" style={evaluation.outcome === "PASS" ? undefined : { color: "var(--text-secondary)", background: "transparent" }}>
              {evaluation.outcome === "PASS" ? <Check size={13} /> : <FlaskConical size={13} />}
              {evaluation.outcome}
            </span>
            <button
              className="icon-button"
              aria-label="Close simulation results"
              title="Close results · Escape / Ctrl + Space"
              onClick={onClose}
            >
              <X size={19} />
            </button>
          </div>
        </header>
        <div className="results-content">
          <section className="results-summary" aria-label="Evaluation summary">
            <div className="results-outcome">
              <div>
                <span className="results-eyebrow">OVERALL RESULT</span>
                <strong>
                  <ShieldCheck size={23} />
                  {evaluation.outcome}
                </strong>
              </div>
              <span className="results-demo-label">
                <FlaskConical size={13} />
                {run.status}
              </span>
            </div>
            <div className="results-metrics">
              <div>
                <span>Hallucination Rate</span>
                <strong>
                  N/A
                </strong>
                <small>No measurement available</small>
              </div>
              <div>
                <span>Total Steps</span>
                <strong data-testid="results-step-count">
                  {run.workflow ? new Set(run.workflow.transitions.map(transition => transition.graphNodeId)).size : run.records.filter((record) => record.transition || record.rejectionTransition).length}
                </strong>
                <small>Committed narrative steps</small>
              </div>
              <div>
                <span>Rule Adherence</span>
                <strong>
                  {ruleAdherence === null ? "N/A" : Number(ruleAdherence.toFixed(1))}{ruleAdherence !== null && <span>%</span>}
                </strong>
                <small>Measured Referee decisions</small>
              </div>
            </div>
            <div className="results-run-meta">
              <span>
                Run {run.id} · {run.configuration.scenario.title}
              </span>
              <span>
                {providerLabel}
              </span>
            </div>
          </section>
          <section
            className="results-audit"
            aria-labelledby="results-audit-title"
          >
            <div className="results-audit-heading">
              <h3 id="results-audit-title">
                State Machine Referee Audit Trail
              </h3>
              <span>Persisted execution log</span>
            </div>
            <p>
              {evaluation.totalDecisions} evaluated · {evaluation.approvedDecisions} approved · {evaluation.rejectedDecisions} rejected.
              {run.error && ` ${run.error.code}: ${run.error.message}`}
            </p>
            <ol>
              {result.events.map((event) => {
                const record = run.records.find((item) => item.sequence === event.payload.decisionSequence);
                const outcome = event.eventType === "decision.evaluated" ? record?.referee.verdict ?? "INFO"
                  : event.eventType === "run.finished" ? evaluation.outcome : "INFO";
                const subject = event.nodeId ?? (event.storyletId ? storyletNodes[event.storyletId] : null) ?? "SYSTEM";
                return (
                <li
                  key={event.id}
                  data-audit-kind={event.eventType}
                  data-node-id={subject}
                >
                  <time>{formatAuditTime(Math.max(0, Date.parse(event.createdAt) - Date.parse(run.startedAt ?? run.createdAt)))}</time>
                  <span className="audit-subject">{subject}</span>
                  <span className="audit-description">{event.eventType}{event.storyletId ? ` · ${event.storyletId}` : ""}
                    {event.eventType === "decision.evaluated" && record && ` · ${record.referee.reasonCode} · ${record.referee.violatedPolicies.map((policy) => `${policy.policyId}: ${policy.reasonCode}`).join("; ")} · ${record.referee.reasons.join("; ")} ${record.referee.evidence.join("; ")}`}
                  </span>
                  <span
                    className={`audit-outcome ${outcome === "PASS" || outcome === "APPROVED" ? "pass" : outcome === "REJECTED" || outcome === "FAIL" ? "rejected" : "info"}`}
                  >
                    {outcome}
                  </span>
                </li>
              ); })}
            </ol>
          </section>
        </div>
        <footer className="results-footer">
          <div>
            <p id="results-fixture-note">
              <FlaskConical size={13} />
              Backend-persisted Referee evidence · simulated actions only
            </p>
            <span>SOAR integration and verified export are not connected.</span>
          </div>
          <button
            disabled
            className="results-export"
            title="Verified SOAR JSON export is unavailable; no CrowdStrike or external integration is connected."
          >
            <Download size={14} />
            Export SOAR JSON
          </button>
        </footer>
      </section>
    </div>
  );
}
