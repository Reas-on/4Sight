import {
  ArrowDownRight,
  ArrowUpRight,
  Braces,
  Check,
  CircleDot,
  Link2,
  X,
} from "lucide-react";
import {
  legacyGraph,
  statusFor,
  statusLabel,
  type GraphDataset,
  type StepStatus,
} from "../data/graph";
import type { AuditEvent, DurableRun } from "../api/types";

export default function NodeDetails({
  id,
  demoIndex,
  compact = false,
  onClose,
  onSelect,
  nodeStatuses,
  dataset = legacyGraph,
  run,
  events = [],
}: {
  id: string | null;
  demoIndex: number;
  compact?: boolean;
  onClose?: () => void;
  onSelect: (id: string) => void;
  nodeStatuses?: Record<string, StepStatus>;
  dataset?: GraphDataset;
  run?: DurableRun | null;
  events?: readonly AuditEvent[];
}) {
  const { neighbors, nodeById, steps } = dataset;
  const node = id ? nodeById.get(id) : undefined;
  if (!node)
    return (
      <div className="inspector-empty">
        <CircleDot size={28} strokeWidth={1} />
        <h3>A little more context.</h3>
        <p>
          Select a node to explore its role, connections, and demonstration
          state.
        </p>
        <span>Click a node in the graph to begin</span>
      </div>
    );
  const step = steps.find((step) => step.id === (node.kind === 'workflow' ? node.id : node.parentId))!;
  const status = nodeStatuses?.[node.id] ?? statusFor(node.id, demoIndex);
  const explanation = events.find(event => event.eventType === "decision.proposed");
  const evaluated = [...events].reverse().find(event => event.eventType === 'decision.evaluated' && event.nodeId === node.id);
  const decision = evaluated ? run?.records.find(record => record.sequence === evaluated.payload.decisionSequence) ??
    run?.records.find(record => record.decision.storyletId === evaluated.storyletId)
    : run?.workflow && ['N-07', 'N-10'].includes(node.id) ? run.records[0] : null;
  const proposal = explanation ? run?.workflow?.proposal : decision?.decision;
  const decisionNode = !["ready", "skipped", "not-evaluated"].includes(status) && (!!decision || !!run?.workflow && ["N-04", "N-05", "N-06"].includes(node.id));
  const incident = run?.configuration.incidentContext;
  return (
    <div
      className={`node-detail ${compact ? "compact" : ""}`}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <div className="detail-eyebrow">
        <span>
          {node.kind === "workflow" ? "WORKFLOW STEP" : "DISPLAY-ONLY CONTEXT"}
        </span>
        {onClose && (
          <button
            className="icon-button"
            aria-label="Dismiss node details"
            onClick={onClose}
          >
            <X size={16} />
          </button>
        )}
      </div>
      <div className="detail-id">
        <CircleDot size={13} />
        {node.id}
      </div>
      <h2>{node.name}</h2>
      <div className={`status-pill ${status}`}>
        <span />
        {node.kind === "metadata" ? "Context entity" : statusLabel(status)}
      </div>
      <p className="detail-description">{node.description}</p>
      <div className="detail-rule" />
      <h4>OVERVIEW</h4>
      <dl className="detail-properties">
        <div>
          <dt>Type</dt>
          <dd>{node.kind === "workflow" ? step.category : "Metadata"}</dd>
        </div>
        <div>
          <dt>Execution</dt>
          <dd>
            {node.kind === "workflow" && node.id !== 'PREVIEW' ? "Simulated only" : "Non-executable"}
          </dd>
        </div>
        <div>
          <dt>Connections</dt>
          <dd>{neighbors.get(node.id)?.size ?? 0} relationships</dd>
        </div>
        <div>
          <dt>Source</dt>
          <dd>{run ? "Backend executable scenario" : "Scenario preview"}</dd>
        </div>
      </dl>
      {run && node.kind === "workflow" && (
        <>
          <div className="detail-rule" />
          <h4>EXECUTION EVIDENCE</h4>
          <dl className="detail-properties" data-testid="node-execution-evidence">
            <div><dt>Incident</dt><dd>{incident?.incident ?? "Incident context unavailable."}</dd></div>
            {incident && <>
              <div><dt>Source address</dt><dd>{incident.sourceId} · simulated</dd></div>
              <div><dt>Target</dt><dd>{incident.targetAsset}</dd></div>
              <div><dt>Evidence</dt><dd>{incident.failedLogins} failed logins / {incident.windowSeconds} seconds</dd></div>
            </>}
            <div><dt>Source</dt><dd>{run.narrative.world.sourceClassification} · {run.narrative.world.sourceProtected ? "protected" : "not protected"}</dd></div>
            <div><dt>Confidence</dt><dd>{run.narrative.world.threatConfidence}% · {run.narrative.world.threatConfidence > 70 ? "above" : "below"} policy threshold</dd></div>
            {decisionNode && <div><dt>Available actions</dt><dd>{(explanation?.payload.availableActions as string[] | undefined)?.join(", ") ?? "perimeter_block, soc_escalation"}</dd></div>}
            {decisionNode && proposal && <>
              <div><dt>AI proposal</dt><dd>{proposal.actionType}</dd></div>
              <div><dt>Parameters</dt><dd>{Object.entries(proposal.parameters ?? {}).map(([key, value]) => `${key}: ${value}`).join(" · ") || "None provided"}</dd></div>
              <div><dt>Model explanation</dt><dd>{proposal.reasoning ?? "No public explanation provided."} Supporting information only.</dd></div>
            </>}
            {decisionNode && decision && <>
              <div><dt>Referee</dt><dd>{decision.referee.verdict}</dd></div>
              {decision.referee.evaluatedPolicies.filter(policy => policy.status !== "NOT_APPLICABLE").map(policy => (
                <div key={policy.policyId}><dt>{policy.policyId}</dt><dd>{policy.message}</dd></div>
              ))}
            </>}
            {status === "skipped" && <div><dt>Branch</dt><dd>This branch was not selected. No action was executed here.</dd></div>}
          </dl>
        </>
      )}
      {!compact && (
        <>
          <div className="detail-rule" />
          <h4>CONTEXT & VALIDATION</h4>
          <div className="technique-card">
            <Braces size={16} />
            <div>
              <strong>{step.technique}</strong>
              <span>{run ? "Backend scenario · persisted evidence" : "Scenario preview · not evaluated"}</span>
            </div>
            <ArrowUpRight size={13} />
          </div>
          <div className="validation-note">
            <CircleDot size={14} />
            <p>
              {nodeStatuses ? statusLabel(status) : "No validation has been performed."}
              <br />
              <span>{nodeStatuses ? "Authoritative run state · simulated actions only." : "This workspace demonstrates the interface."}</span>
            </p>
          </div>
        </>
      )}
      <div className="detail-rule" />
      <h4>
        CONNECTED NODES <span>{neighbors.get(node.id)?.size}</span>
      </h4>
      <div className="related-nodes">
        {[...(neighbors.get(node.id) ?? [])]
          .slice(0, compact ? 3 : 5)
          .map((relatedId) => (
            <button key={relatedId} onClick={() => onSelect(relatedId)}>
              <Link2 size={13} />
              <span>{nodeById.get(relatedId)?.name}</span>
              <ArrowDownRight size={13} />
            </button>
          ))}
      </div>
      {!compact && (
        <div className="detail-footer">
          <Check size={13} /> Stable node identity <code>{node.id}</code>
        </div>
      )}
    </div>
  );
}
