import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Check, Download, FlaskConical, ShieldCheck, X } from "lucide-react";
import { formatAuditTime, type EvaluationResult } from "../data/demoLifecycle";
import { useReducedMotion } from "../hooks/useMotion";

export default function ResultsPanel({
  result,
  open,
  onClose,
  onDismissFocus,
}: {
  result: EvaluationResult | null;
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
        data-run-id={result.runId}
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
            <span className="results-pass-badge">
              <Check size={13} />
              PASS
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
                  {result.overall}
                </strong>
              </div>
              <span className="results-demo-label">
                <FlaskConical size={13} />
                Simulated fixture
              </span>
            </div>
            <div className="results-metrics">
              <div>
                <span>Hallucination Rate</span>
                <strong>
                  0.0<span>%</span>
                </strong>
                <small>Simulated · not measured</small>
              </div>
              <div>
                <span>Total Steps</span>
                <strong data-testid="results-step-count">
                  {result.totalSteps}
                </strong>
                <small>Executed workflow nodes</small>
              </div>
              <div>
                <span>Rule Adherence</span>
                <strong>
                  100<span>%</span>
                </strong>
                <small>Simulated · not verified</small>
              </div>
            </div>
            <div className="results-run-meta">
              <span>
                Run {result.runId} · {result.configuration.sourceName}
              </span>
              <span>
                {result.configuration.agent === "demo-runner"
                  ? "Local demo runner · simulated"
                  : "No live model connected"}
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
              <span>Demo execution log</span>
            </div>
            <p>
              The entries below record local playback. No backend referee or
              security evaluation was run.
            </p>
            <ol>
              {result.auditTrail.map((event) => (
                <li
                  key={event.id}
                  data-audit-kind={event.kind}
                  data-node-id={event.subject}
                >
                  <time>{formatAuditTime(event.elapsedMs)}</time>
                  <span className="audit-subject">{event.subject}</span>
                  <span className="audit-description">{event.description}</span>
                  <span
                    className={`audit-outcome ${event.outcome === "INFO" ? "info" : "pass"}`}
                  >
                    {event.outcome}
                  </span>
                </li>
              ))}
            </ol>
          </section>
        </div>
        <footer className="results-footer">
          <div>
            <p id="results-fixture-note">
              <FlaskConical size={13} />
              Demonstration results · not backend-verified evidence
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
