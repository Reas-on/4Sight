export type StepStatus = "ready" | "active" | "complete" | "failed" | "rejected" | "skipped" | "not-evaluated";
export type WorkflowStep = {
  id: string;
  name: string;
  description: string;
  category: string;
  technique: string;
  tool: string;
};

export const steps: WorkflowStep[] = [
  {
    id: "N-01",
    name: "Receive alert",
    description:
      "Capture the endpoint alert and establish the initial incident context. Normalize the available signals before continuing.",
    category: "Detection",
    technique: "T1566 · Phishing",
    tool: "Endpoint telemetry",
  },
  {
    id: "N-02",
    name: "Enrich context",
    description:
      "Connect the alert to asset information, identity context, and observed indicators. Gather supporting evidence for the next decision.",
    category: "Investigation",
    technique: "T1059 · Command execution",
    tool: "Context enrichment",
  },
  {
    id: "N-03",
    name: "Assess threat",
    description:
      "Review the collected evidence and identify the appropriate response path. This demonstration illustrates a decision point; no security evaluation is performed.",
    category: "Decision",
    technique: "T1071 · Application protocol",
    tool: "Analyst decision",
  },
  {
    id: "N-04",
    name: "Contain endpoint",
    description:
      "Illustrate an endpoint isolation action after the decision gate. No commands are sent and no real endpoint is modified.",
    category: "Response",
    technique: "T1021 · Remote services",
    tool: "Endpoint response",
  },
  {
    id: "N-05",
    name: "Review & report",
    description:
      "Assemble the incident timeline and hand the proposed response to an analyst for review. Preserve supporting context for the final report.",
    category: "Review",
    technique: "Analyst review",
    tool: "Incident workspace",
  },
];

export type GraphEntity = {
  id: string;
  name: string;
  kind: "workflow" | "metadata";
  parentId: string;
  description: string;
  position: [number, number, number];
};
export type GraphEdge = {
  source: string;
  target: string;
  kind: "workflow" | "relationship";
};

const metadata = [
  [
    "Alert source",
    "Signal timestamp",
    "Detection rule",
    "Host identity",
    "Process tree",
    "Raw event",
    "Severity context",
    "Sensor metadata",
    "Event signature",
    "Alert evidence",
    "Source address",
    "Device group",
    "Signal origin",
    "Initial context",
    "Alert payload",
    "Event correlation",
  ],
  [
    "Asset inventory",
    "User identity",
    "DNS context",
    "File indicator",
    "Network history",
    "Hash lookup",
    "Related events",
    "Domain context",
    "IP indicator",
    "Device owner",
    "Session context",
    "Known baseline",
    "Host profile",
    "Evidence link",
    "Observed process",
    "Context source",
  ],
  [
    "Evidence review",
    "Decision gate",
    "Analyst context",
    "Technique mapping",
    "Confidence input",
    "Policy reference",
    "Behavior context",
    "Indicator relation",
    "Review criteria",
    "Decision rationale",
    "Evidence cluster",
    "Observed pattern",
    "Response context",
    "Triage note",
    "Correlation rule",
    "Threat context",
  ],
  [
    "Isolation scope",
    "Approval check",
    "Action preview",
    "Response target",
    "Rollback note",
    "Access boundary",
    "Containment plan",
    "Target context",
    "Action dependency",
    "Response record",
    "Approval owner",
    "Change reference",
    "Action precondition",
    "Endpoint scope",
    "Control mapping",
    "Response evidence",
  ],
  [
    "Incident timeline",
    "Review owner",
    "Evidence bundle",
    "Report draft",
    "Audit context",
    "Analyst note",
    "Handoff record",
    "Follow-up task",
    "Summary context",
    "Related incident",
    "Review checklist",
    "Attachment link",
    "Report metadata",
    "Review reference",
    "Timeline event",
    "Outcome note",
  ],
];

const centers: [number, number, number][] = [
  [-5.5, 3.1, 2.2],
  [0.2, 5.1, -2.5],
  [4.5, 0.4, 3.4],
  [1.3, -5.2, -0.6],
  [-4.8, -2.4, -3.6],
];

// Deterministic spring/repulsion relaxation, computed only once per module.
function buildGraph() {
  const nodes: GraphEntity[] = [];
  const edges: GraphEdge[] = steps.slice(1).map((step, i) => ({
    source: steps[i].id,
    target: step.id,
    kind: "workflow",
  }));
  steps.forEach((step, group) => {
    const center = centers[group];
    nodes.push({
      ...step,
      kind: "workflow",
      parentId: step.id,
      position: [...center],
    });
    metadata[group].forEach((name, i) => {
      const phi = Math.acos(1 - (2 * (i + 0.5)) / metadata[group].length);
      const theta = i * 2.399963 + group * 0.83;
      const r = 2.2 + Math.sin(i * 4.7 + group) * 0.65;
      const id = `M-${group + 1}-${String(i + 1).padStart(2, "0")}`;
      nodes.push({
        id,
        name,
        kind: "metadata",
        parentId: step.id,
        description: `Display-only ${name.toLowerCase()} relationship associated with ${step.name.toLowerCase()}. This entity is context, not an executable workflow step.`,
        position: [
          center[0] + r * Math.sin(phi) * Math.cos(theta),
          center[1] + r * Math.cos(phi),
          center[2] + r * Math.sin(phi) * Math.sin(theta),
        ],
      });
      edges.push({ source: step.id, target: id, kind: "relationship" });
      if (i > 0)
        edges.push({
          source: `M-${group + 1}-${String(i).padStart(2, "0")}`,
          target: id,
          kind: "relationship",
        });
      if (i > 3 && i % 3 === 0)
        edges.push({
          source: `M-${group + 1}-${String(i - 2).padStart(2, "0")}`,
          target: id,
          kind: "relationship",
        });
    });
  });
  const indexed = new Map(nodes.map((n, i) => [n.id, i]));
  for (let iteration = 0; iteration < 100; iteration++) {
    const force = nodes.map(() => [0, 0, 0]);
    nodes.forEach((a, i) => {
      nodes.slice(i + 1).forEach((b, offset) => {
        const j = i + offset + 1;
        const delta = a.position.map((v, axis) => v - b.position[axis]);
        const distance = Math.max(0.4, Math.hypot(...delta));
        delta.forEach((v, axis) => {
          const f = ((v / distance) * 0.18) / (distance * distance);
          force[i][axis] += f;
          force[j][axis] -= f;
        });
      });
      const center = centers[Number(a.parentId.slice(-1)) - 1];
      a.position.forEach((v, axis) => {
        force[i][axis] +=
          (center[axis] - v) * (a.kind === "workflow" ? 0.08 : 0.008);
      });
    });
    edges.forEach((edge) => {
      if (edge.kind === "workflow") return;
      const i = indexed.get(edge.source)!;
      const j = indexed.get(edge.target)!;
      const delta = nodes[j].position.map(
        (v, axis) => v - nodes[i].position[axis],
      );
      const d = Math.max(0.1, Math.hypot(...delta));
      const length = nodes[i].kind === "workflow" ? 2.65 : 1.8;
      delta.forEach((v, axis) => {
        const f = (v / d) * (d - length) * 0.012;
        force[i][axis] += f;
        force[j][axis] -= f;
      });
    });
    nodes.forEach((n, i) =>
      n.position.forEach((_, axis) => {
        n.position[axis] += force[i][axis] * 0.6;
      }),
    );
  }
  const mean = [0, 1, 2].map(
    (axis) =>
      nodes.reduce((sum, n) => sum + n.position[axis], 0) / nodes.length,
  );
  nodes.forEach((n) =>
    n.position.forEach((_, axis) => {
      n.position[axis] -= mean[axis];
    }),
  );
  return { nodes, edges };
}

export const graph = buildGraph();
export const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
export const neighbors = new Map(
  graph.nodes.map((node) => [
    node.id,
    new Set(
      graph.edges.flatMap((edge) =>
        edge.source === node.id
          ? [edge.target]
          : edge.target === node.id
            ? [edge.source]
            : [],
      ),
    ),
  ]),
);
export function statusFor(id: string, demoIndex: number): StepStatus {
  const node = nodeById.get(id);
  const index = steps.findIndex((step) => step.id === (node?.parentId ?? id));
  return demoIndex > index
    ? "complete"
    : demoIndex === index
      ? "active"
      : "ready";
}
export const statusLabel = (status: StepStatus) =>
  status === "complete"
    ? "Passed"
    : status === "active"
      ? "Running"
      : status === "rejected" ? "Referee rejected" : status === "failed" ? "Execution failed"
        : status === "skipped" ? "Skipped · contextual node" : status === "not-evaluated" ? "Not evaluated" : "Pending";
