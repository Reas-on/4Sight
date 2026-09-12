import type {
  Condition,
  ConditionValue,
  Effect,
  NarrativeEventId,
  NumericWorldField,
  ScalarWorldField,
  ScenarioDefinition,
  StoryletDefinition,
  WorldState,
} from '../types.js';

export const SSH_BRUTE_FORCE_SCENARIO_ID = 'ssh-brute-force';
export const SSH_BRUTE_FORCE_TECHNIQUE = 'T1110.001';
export const THREAT_CONFIDENCE_THRESHOLD = 70;

const equals = (field: ScalarWorldField, value: ConditionValue): Condition => ({
  op: 'equals',
  field,
  value,
});

const greaterThan = (field: NumericWorldField, value: number): Condition => ({
  op: 'greater_than',
  field,
  value,
});

const all = (...conditions: Condition[]): Condition => ({
  op: 'all',
  conditions,
});

const any = (...conditions: Condition[]): Condition => ({
  op: 'any',
  conditions,
});

const set = (field: ScalarWorldField, value: ConditionValue): Effect => ({
  type: 'set',
  field,
  value,
});

const increment = (field: NumericWorldField, by: number): Effect => ({
  type: 'increment',
  field,
  by,
});

const append = (value: NarrativeEventId): Effect => ({
  type: 'append',
  field: 'completedEvents',
  value,
});

const externalSource: WorldState = {
  sourceClassification: 'external',
  sourceProtected: false,
  assetClassification: 'server',
  assetProtected: false,
  threatConfidence: 85,
  incidentStatus: 'detected',
  escalationStatus: 'not_required',
  responseStatus: 'none',
  escalationAttempts: 0,
  completedEvents: [],
};

const protectedInternalSource: WorldState = {
  sourceClassification: 'internal',
  sourceProtected: true,
  assetClassification: 'domain-controller',
  assetProtected: true,
  threatConfidence: 92,
  incidentStatus: 'detected',
  escalationStatus: 'required',
  responseStatus: 'none',
  escalationAttempts: 0,
  completedEvents: [],
};

const socEscalation: WorldState = {
  ...protectedInternalSource,
  threatConfidence: 95,
};

const triageStorylet: StoryletDefinition = {
  id: 'triage-ssh-brute-force',
  description: 'Review the SSH authentication anomaly and confirm whether it is malicious.',
  graphNodeId: 'N-01',
  priority: 100,
  oneShot: true,
  terminal: false,
  preconditions: all(
    equals('incidentStatus', 'detected'),
    greaterThan('threatConfidence', THREAT_CONFIDENCE_THRESHOLD),
  ),
  action: {
    id: 'triage-alert',
    description: 'Triage the SSH brute-force alert.',
  },
  outcomes: [
    {
      id: 'confirm-threat',
      description: 'The authentication failures are confirmed as a brute-force attempt.',
      effects: [
        set('incidentStatus', 'triaged'),
        append('event:ssh-brute-force-confirmed'),
      ],
    },
  ],
};

const blockExternalSourceStorylet: StoryletDefinition = {
  id: 'block-external-source',
  description: 'Apply a simulated perimeter block for the unprotected external source.',
  graphNodeId: 'N-04',
  priority: 90,
  oneShot: true,
  terminal: false,
  preconditions: all(
    equals('sourceClassification', 'external'),
    equals('sourceProtected', false),
    equals('assetProtected', false),
    equals('incidentStatus', 'triaged'),
    equals('responseStatus', 'none'),
    greaterThan('threatConfidence', THREAT_CONFIDENCE_THRESHOLD),
  ),
  action: {
    id: 'block-source',
    description: 'Block the external source at the simulated perimeter.',
  },
  outcomes: [
    {
      id: 'block-applied',
      description: 'The simulated perimeter block is applied to the external source.',
      effects: [
        set('responseStatus', 'blocked'),
        set('incidentStatus', 'contained'),
        append('event:perimeter-block-applied'),
      ],
    },
  ],
};

const escalateProtectedSourceStorylet: StoryletDefinition = {
  id: 'escalate-protected-source',
  description:
    'Escalate the protected internal source to the SOC instead of applying a direct block.',
  graphNodeId: 'N-04',
  priority: 90,
  oneShot: true,
  terminal: false,
  preconditions: all(
    equals('sourceClassification', 'internal'),
    any(equals('sourceProtected', true), equals('assetProtected', true)),
    equals('escalationStatus', 'required'),
    equals('incidentStatus', 'triaged'),
    greaterThan('threatConfidence', THREAT_CONFIDENCE_THRESHOLD),
  ),
  action: {
    id: 'escalate-soc',
    description: 'Request SOC escalation for the protected internal source.',
  },
  outcomes: [
    {
      id: 'soc-escalated',
      description: 'The SOC escalation request is recorded and the incident is escalated.',
      effects: [
        set('escalationStatus', 'requested'),
        set('incidentStatus', 'escalated'),
        increment('escalationAttempts', 1),
        append('event:soc-escalation-requested'),
      ],
    },
  ],
};

const socEscalationFollowUpStorylet: StoryletDefinition = {
  id: 'soc-escalation-follow-up',
  description: 'Acknowledge the SOC escalation and apply safe containment.',
  graphNodeId: 'N-04',
  priority: 80,
  oneShot: true,
  terminal: false,
  preconditions: all(
    equals('escalationStatus', 'requested'),
    equals('incidentStatus', 'escalated'),
    equals('responseStatus', 'none'),
  ),
  action: {
    id: 'acknowledge-escalation',
    description: 'Record SOC acknowledgement and apply safe containment.',
  },
  outcomes: [
    {
      id: 'soc-contained',
      description: 'The SOC accepts the escalation and the protected asset is isolated safely.',
      effects: [
        set('escalationStatus', 'accepted'),
        set('responseStatus', 'isolated'),
        set('incidentStatus', 'contained'),
        append('event:soc-containment-applied'),
      ],
    },
  ],
};

const closeIncidentStorylet: StoryletDefinition = {
  id: 'close-ssh-incident',
  description: 'Review the contained response and close the simulated incident.',
  graphNodeId: 'N-05',
  priority: 70,
  oneShot: true,
  terminal: true,
  preconditions: all(
    equals('incidentStatus', 'contained'),
    any(equals('responseStatus', 'blocked'), equals('responseStatus', 'isolated')),
  ),
  action: {
    id: 'close-incident',
    description: 'Close the simulated SSH brute-force incident.',
  },
  outcomes: [
    {
      id: 'incident-resolved',
      description: 'The incident is closed as resolved in the simulation.',
      effects: [
        set('incidentStatus', 'resolved'),
        set('responseStatus', 'resolved'),
        append('event:incident-resolved'),
      ],
    },
  ],
};

export const sshBruteForceScenario: ScenarioDefinition = {
  id: SSH_BRUTE_FORCE_SCENARIO_ID,
  title: 'SSH Brute Force',
  description:
    'Deterministic SSH brute-force response scenario inspired by MITRE ATT&CK T1110.001.',
  technique: SSH_BRUTE_FORCE_TECHNIQUE,
  maxTransitions: 10,
  storylets: [
    triageStorylet,
    blockExternalSourceStorylet,
    escalateProtectedSourceStorylet,
    socEscalationFollowUpStorylet,
    closeIncidentStorylet,
  ],
};

export const sshBruteForceInitialStates = {
  externalSource,
  protectedInternalSource,
  socEscalation,
} as const;
