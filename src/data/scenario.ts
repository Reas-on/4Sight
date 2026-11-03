export type ScenarioSourceType =
  | "builtin"
  | "local_file"
  | "url"
  | "mitre_attack"
  | "sigma"
  | "atomic_red_team";
export type ImportedSource = {
  id: string;
  name: string;
  sourceType: ScenarioSourceType;
  originalFormat: string;
  sourceUrl?: string;
  description: string;
  mitreTechniqueIds: string[];
  rawContent: string;
  importedAt?: string;
  sample?: boolean;
  materialType:
    | "reference_scenario"
    | "technique_metadata"
    | "detection_rule"
    | "test_definition"
    | "source_material";
};
export type ScenarioWorkspace = {
  selectedSource: ImportedSource | null;
  additionalContext: string;
};
export const ADDITIONAL_CONTEXT_MAX_LENGTH = 8000;
export const REFERENCE_SCENARIO_ID = "builtin:endpoint-compromise";

export const builtinScenarios: ImportedSource[] = [
  {
    id: REFERENCE_SCENARIO_ID,
    name: "Endpoint compromise",
    sourceType: "builtin",
    originalFormat: "local demo",
    materialType: "reference_scenario",
    description:
      "The existing five-step illustrative incident-response playbook, from alert intake through analyst review. This is a local visual demonstration, not an evaluated security outcome.",
    mitreTechniqueIds: ["T1566", "T1059", "T1071", "T1021"],
    rawContent:
      "Endpoint alert reports suspicious process and network activity.\n\nN-01 Receive alert → N-02 Enrich context → N-03 Assess threat → N-04 Contain endpoint → N-05 Review & report.\n\nLocal demonstration only. No commands are executed.",
  },
];
export const sourceLabels: Record<ScenarioSourceType, string> = {
  builtin: "Built-in library",
  local_file: "Local file",
  url: "URL",
  mitre_attack: "MITRE ATT&CK",
  sigma: "Sigma Rules",
  atomic_red_team: "Atomic Red Team",
};
export type SourceAdapter = {
  type: "mitre_attack" | "sigma" | "atomic_red_team";
  label: string;
  contentType: string;
  live: false;
  description: string;
  samples: ImportedSource[];
};
export const sourceAdapters: SourceAdapter[] = [
  {
    type: "mitre_attack",
    label: "MITRE ATT&CK",
    contentType: "Technique metadata",
    live: false,
    description:
      "Sample technique metadata only. No live ATT&CK synchronization or scenario execution.",
    samples: [
      {
        id: "sample:mitre-ssh-brute-force",
        name: "SSH Brute Force",
        sourceType: "mitre_attack",
        originalFormat: "sample metadata",
        materialType: "technique_metadata",
        sample: true,
        sourceUrl: "https://attack.mitre.org/techniques/T1110/001/",
        description:
          "Illustrative metadata for password guessing against an SSH service. A technique reference is not an executable playbook.",
        mitreTechniqueIds: ["T1110.001"],
        rawContent:
          "Technique reference: T1110.001 — Password Guessing\nIllustrative scenario: repeated SSH authentication failures from a single source.\nSample metadata, not a live MITRE import or executable scenario.",
      },
    ],
  },
  {
    type: "sigma",
    label: "Sigma Rules",
    contentType: "Detection-rule material",
    live: false,
    description:
      "Sample detection-rule material only. No live rule retrieval, validation, or rule execution.",
    samples: [
      {
        id: "sample:sigma-powershell",
        name: "Suspicious PowerShell activity",
        sourceType: "sigma",
        originalFormat: "sample YAML",
        materialType: "detection_rule",
        sample: true,
        description:
          "Illustrative Sigma-style detection material. Detection rules describe matching conditions; they are not response playbooks.",
        mitreTechniqueIds: ["T1059.001"],
        rawContent:
          "title: Suspicious PowerShell activity (illustrative sample)\nstatus: experimental\nlogsource:\n  product: windows\n  category: process_creation\ntags:\n  - attack.t1059.001\n# Display-only rule material; no matching engine is connected.",
      },
    ],
  },
  {
    type: "atomic_red_team",
    label: "Atomic Red Team",
    contentType: "Test-definition material",
    live: false,
    description:
      "Sample test-definition metadata only. Commands are never executed and no live repository is connected.",
    samples: [
      {
        id: "sample:atomic-command-shell",
        name: "Command shell test definition",
        sourceType: "atomic_red_team",
        originalFormat: "sample metadata",
        materialType: "test_definition",
        sample: true,
        description:
          "Illustrative atomic-test metadata for command-shell behavior. Test definitions are untrusted source material, not approved executable scenarios.",
        mitreTechniqueIds: ["T1059.003"],
        rawContent:
          "attack_technique: T1059.003\ndisplay_name: Command shell behavior (illustrative sample)\n# No executor or commands are run by this workspace.",
      },
    ],
  },
];

export function additionalContextError(context: string): string | null {
  return context.length > ADDITIONAL_CONTEXT_MAX_LENGTH
    ? `Use ${ADDITIONAL_CONTEXT_MAX_LENGTH.toLocaleString("en-US")} characters or fewer.`
    : null;
}
export function compositionBlockReason(
  workspace: ScenarioWorkspace,
): string | null {
  if (!workspace.selectedSource) return "Select a base scenario to continue.";
  const invalid = additionalContextError(workspace.additionalContext);
  if (invalid) return invalid;
  if (workspace.additionalContext.trim())
    return "Additional Context is retained, but this demo cannot evaluate composed inputs. Clear the context to run the supported reference demo.";
  const source = workspace.selectedSource;
  if (source.sourceType !== "builtin" || source.id !== REFERENCE_SCENARIO_ID)
    return "This source is preview-only material. No imported-source validation or execution engine is connected.";
  return null;
}
export function filterSources(
  sources: ImportedSource[],
  query: string,
  technique: string,
) {
  const search = query.trim().toLowerCase();
  return sources.filter(
    (source) =>
      (!search || source.name.toLowerCase().includes(search)) &&
      (!technique || source.mitreTechniqueIds.includes(technique)),
  );
}
