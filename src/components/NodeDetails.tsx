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
  neighbors,
  nodeById,
  statusFor,
  statusLabel,
  steps,
} from "../data/graph";

export default function NodeDetails({
  id,
  demoIndex,
  compact = false,
  onClose,
  onSelect,
}: {
  id: string | null;
  demoIndex: number;
  compact?: boolean;
  onClose?: () => void;
  onSelect: (id: string) => void;
}) {
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
  const step = steps.find((step) => step.id === node.parentId)!;
  const status = statusFor(node.id, demoIndex);
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
            {node.kind === "workflow" ? "Simulated only" : "Non-executable"}
          </dd>
        </div>
        <div>
          <dt>Connections</dt>
          <dd>{neighbors.get(node.id)?.size ?? 0} relationships</dd>
        </div>
        <div>
          <dt>Source</dt>
          <dd>Illustrative dataset</dd>
        </div>
      </dl>
      {!compact && (
        <>
          <div className="detail-rule" />
          <h4>CONTEXT & VALIDATION</h4>
          <div className="technique-card">
            <Braces size={16} />
            <div>
              <strong>{step.technique}</strong>
              <span>Illustrative reference · not evaluated</span>
            </div>
            <ArrowUpRight size={13} />
          </div>
          <div className="validation-note">
            <CircleDot size={14} />
            <p>
              No validation has been performed.
              <br />
              <span>This workspace demonstrates the interface.</span>
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
