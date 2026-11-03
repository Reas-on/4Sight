import { ArrowDown, ArrowUpRight, Check, CircleDot } from "lucide-react";
import { statusFor, statusLabel, steps as legacySteps, type WorkflowStep, type StepStatus } from "../data/graph";

export default function StepView({
  selectedId,
  demoIndex,
  onSelect,
  nodeStatuses,
  steps = legacySteps,
}: {
  selectedId: string | null;
  demoIndex: number;
  onSelect: (id: string) => void;
  nodeStatuses?: Record<string, StepStatus>;
  steps?: WorkflowStep[];
}) {
  return (
    <section className="step-view" aria-label="Step-by-step demo workflow">
      <div className="step-heading">
        <span className="eyebrow">THE PLAYBOOK</span>
        <h2>One signal. A considered response.</h2>
        <p>{steps.length} workflow nodes, from the first alert to the final report.</p>
      </div>
      <div className="step-chain">
        {steps.map((step, i) => {
          const status = nodeStatuses?.[step.id] ?? statusFor(step.id, demoIndex);
          return (
            <div key={step.id}>
              <button
                className={`step-card ${selectedId === step.id ? "selected" : ""} ${status}`}
                data-node-id={step.id}
                data-status={status}
                onClick={() => onSelect(step.id)}
              >
                <span className="step-number">
                  {status === "complete" ? <Check size={17} /> : String(i + 1).padStart(2, "0")}
                </span>
                <div>
                  <span className="step-category">
                    {step.category} <span>· {step.id}</span>
                  </span>
                  <h3>{step.name}</h3>
                  <span className={`step-status ${status}`}>
                    <CircleDot size={10} />
                    {statusLabel(status)}
                  </span>
                </div>
                <ArrowUpRight size={16} />
              </button>
              {i < steps.length - 1 && (
                <div className="step-connector">
                  <ArrowDown size={14} />
                </div>
              )}
            </div>
          );
        })}
      </div>
      <p className="step-disclaimer">
        Backend-evaluated proposals · no real security commands executed
      </p>
    </section>
  );
}
