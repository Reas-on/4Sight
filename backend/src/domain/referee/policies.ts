import { THREAT_CONFIDENCE_THRESHOLD } from '../narrative/scenarios/ssh-brute-force.js';
import type {
  RefereeActionType,
  RefereePolicy,
  RefereePolicyContext,
  RefereePolicyFinding,
  RefereePolicySet,
} from './types.js';

export const ACTION_TYPE_BY_STORYLET_ACTION_ID: Readonly<
  Record<string, RefereeActionType>
> = Object.freeze({
  'triage-alert': 'triage_alert',
  'block-source': 'perimeter_block',
  'escalate-soc': 'soc_escalation',
  'acknowledge-escalation': 'soc_acknowledgement',
  'close-incident': 'incident_closure',
});

function finding(
  status: RefereePolicyFinding['status'],
  reasonCode: string,
  message: string,
  evidence: readonly string[] = [],
): RefereePolicyFinding {
  return Object.freeze({
    status,
    reasonCode,
    message,
    ...(evidence.length === 0 ? {} : { evidence: Object.freeze([...evidence]) }),
  });
}

function notApplicable(actionType: RefereeActionType, actual: RefereeActionType): boolean {
  return actual !== actionType;
}

const externalPerimeterBlockPolicy: RefereePolicy = {
  policyId: 'POLICY-001',
  description:
    'Authorize a perimeter block only for an unprotected external source after triage.',
  evaluate(context: RefereePolicyContext): RefereePolicyFinding {
    if (notApplicable('perimeter_block', context.decision.actionType)) {
      return finding('NOT_APPLICABLE', 'ACTION_NOT_APPLICABLE', 'Not a perimeter block.');
    }

    const evidence = [
      `sourceClassification=${context.state.world.sourceClassification}`,
      `sourceProtected=${String(context.state.world.sourceProtected)}`,
      `assetProtected=${String(context.state.world.assetProtected)}`,
      `incidentStatus=${context.state.world.incidentStatus}`,
      `responseStatus=${context.state.world.responseStatus}`,
    ];
    const selectedActionId = context.selectedStorylet?.action.id ?? 'none';

    if (selectedActionId !== 'block-source') {
      return finding(
        'FAIL',
        'EXTERNAL_BLOCK_STORYLET_REQUIRED',
        'A perimeter block must bind to the block-source storylet.',
        [...evidence, `storyletAction=${selectedActionId}`],
      );
    }
    if (context.state.world.sourceClassification !== 'external') {
      return finding(
        'FAIL',
        'EXTERNAL_SOURCE_REQUIRED',
        'A perimeter block is authorized only for an external source.',
        evidence,
      );
    }
    if (context.state.world.sourceProtected || context.state.world.assetProtected) {
      return finding(
        'FAIL',
        'PROTECTED_SOURCE_BLOCK',
        'A perimeter block cannot target a protected source or protected asset.',
        evidence,
      );
    }
    if (
      context.state.world.incidentStatus !== 'triaged' ||
      context.state.world.responseStatus !== 'none'
    ) {
      return finding(
        'FAIL',
        'UNSAFE_BLOCK_STATE',
        'A perimeter block requires a triaged incident with no existing response.',
        evidence,
      );
    }

    return finding(
      'PASS',
      'EXTERNAL_BLOCK_AUTHORIZED',
      'The perimeter block is authorized for the unprotected external source.',
      evidence,
    );
  },
};

const protectedSourceBlockPolicy: RefereePolicy = {
  policyId: 'POLICY-002',
  description: 'Prohibit direct perimeter blocks against protected or internal sources.',
  evaluate(context: RefereePolicyContext): RefereePolicyFinding {
    if (notApplicable('perimeter_block', context.decision.actionType)) {
      return finding('NOT_APPLICABLE', 'ACTION_NOT_APPLICABLE', 'Not a perimeter block.');
    }

    const evidence = [
      `sourceClassification=${context.state.world.sourceClassification}`,
      `sourceProtected=${String(context.state.world.sourceProtected)}`,
      `assetProtected=${String(context.state.world.assetProtected)}`,
    ];

    if (
      context.state.world.sourceClassification === 'internal' ||
      context.state.world.sourceProtected ||
      context.state.world.assetProtected
    ) {
      return finding(
        'FAIL',
        'PROTECTED_SOURCE_BLOCK',
        'Direct blocking of a protected or internal source is prohibited.',
        evidence,
      );
    }

    return finding(
      'PASS',
      'PROTECTED_SOURCE_NOT_TARGETED',
      'The target is not a protected or internal source.',
      evidence,
    );
  },
};

const socEscalationPolicy: RefereePolicy = {
  policyId: 'POLICY-003',
  description: 'Authorize SOC escalation for protected or internal sources.',
  evaluate(context: RefereePolicyContext): RefereePolicyFinding {
    if (notApplicable('soc_escalation', context.decision.actionType)) {
      return finding('NOT_APPLICABLE', 'ACTION_NOT_APPLICABLE', 'Not a SOC escalation.');
    }

    const evidence = [
      `sourceClassification=${context.state.world.sourceClassification}`,
      `sourceProtected=${String(context.state.world.sourceProtected)}`,
      `assetProtected=${String(context.state.world.assetProtected)}`,
      `escalationStatus=${context.state.world.escalationStatus}`,
    ];
    const selectedActionId = context.selectedStorylet?.action.id ?? 'none';

    if (selectedActionId !== 'escalate-soc') {
      return finding(
        'FAIL',
        'SOC_ESCALATION_STORYLET_REQUIRED',
        'A SOC escalation must bind to the escalate-soc storylet.',
        [...evidence, `storyletAction=${selectedActionId}`],
      );
    }
    if (
      context.state.world.sourceClassification !== 'internal' &&
      !context.state.world.sourceProtected &&
      !context.state.world.assetProtected
    ) {
      return finding(
        'FAIL',
        'PROTECTED_SOURCE_REQUIRED',
        'SOC escalation is authorized only for a protected or internal source.',
        evidence,
      );
    }
    if (
      context.state.world.incidentStatus !== 'triaged' ||
      context.state.world.escalationStatus !== 'required'
    ) {
      return finding(
        'FAIL',
        'UNSAFE_ESCALATION_STATE',
        'SOC escalation requires a triaged incident with escalation marked as required.',
        evidence,
      );
    }

    return finding(
      'PASS',
      'SOC_ESCALATION_AUTHORIZED',
      'The SOC escalation is authorized for the protected source.',
      evidence,
    );
  },
};

const stateTransitionSafetyPolicy: RefereePolicy = {
  policyId: 'POLICY-004',
  description: 'Require the current narrative state to be safe for the proposed action.',
  evaluate(context: RefereePolicyContext): RefereePolicyFinding {
    const evidence = [
      `incidentStatus=${context.state.world.incidentStatus}`,
      `escalationStatus=${context.state.world.escalationStatus}`,
      `responseStatus=${context.state.world.responseStatus}`,
      `threatConfidence=${String(context.state.world.threatConfidence)}`,
    ];

    switch (context.decision.actionType) {
      case 'triage_alert':
        if (
          context.state.world.incidentStatus !== 'detected' ||
          context.state.world.threatConfidence <= THREAT_CONFIDENCE_THRESHOLD
        ) {
          return finding(
            'FAIL',
            'UNSAFE_TRIAGE_STATE',
            'Alert triage requires a detected incident above the confidence threshold.',
            evidence,
          );
        }
        break;
      case 'perimeter_block':
        if (
          context.state.world.incidentStatus !== 'triaged' ||
          context.state.world.responseStatus !== 'none'
        ) {
          return finding(
            'FAIL',
            'UNSAFE_BLOCK_STATE',
            'A perimeter block requires a triaged incident with no existing response.',
            evidence,
          );
        }
        break;
      case 'soc_escalation':
        if (
          context.state.world.incidentStatus !== 'triaged' ||
          context.state.world.escalationStatus !== 'required'
        ) {
          return finding(
            'FAIL',
            'UNSAFE_ESCALATION_STATE',
            'SOC escalation requires a triaged incident with escalation marked as required.',
            evidence,
          );
        }
        break;
      case 'soc_acknowledgement':
        if (
          context.state.world.incidentStatus !== 'escalated' ||
          context.state.world.escalationStatus !== 'requested' ||
          context.state.world.responseStatus !== 'none'
        ) {
          return finding(
            'FAIL',
            'UNSAFE_ACKNOWLEDGEMENT_STATE',
            'SOC acknowledgement requires a requested escalation with no existing response.',
            evidence,
          );
        }
        break;
      case 'incident_closure':
        if (
          context.state.world.incidentStatus !== 'contained' ||
          (context.state.world.responseStatus !== 'blocked' &&
            context.state.world.responseStatus !== 'isolated')
        ) {
          return finding(
            'FAIL',
            'UNSAFE_CLOSURE_STATE',
            'Incident closure requires a contained incident with a completed response.',
            evidence,
          );
        }
        break;
    }

    return finding(
      'PASS',
      'STATE_TRANSITION_SAFE',
      'The current state is safe for the proposed action.',
      evidence,
    );
  },
};

const triagePolicy: RefereePolicy = {
  policyId: 'POLICY-005',
  description: 'Authorize alert triage for a detected incident above the confidence threshold.',
  evaluate(context: RefereePolicyContext): RefereePolicyFinding {
    if (notApplicable('triage_alert', context.decision.actionType)) {
      return finding('NOT_APPLICABLE', 'ACTION_NOT_APPLICABLE', 'Not alert triage.');
    }

    const evidence = [
      `incidentStatus=${context.state.world.incidentStatus}`,
      `threatConfidence=${String(context.state.world.threatConfidence)}`,
    ];

    if (
      context.state.world.incidentStatus !== 'detected' ||
      context.state.world.threatConfidence <= THREAT_CONFIDENCE_THRESHOLD
    ) {
      return finding(
        'FAIL',
        'UNSAFE_TRIAGE_STATE',
        'Alert triage requires a detected incident above the confidence threshold.',
        evidence,
      );
    }

    return finding('PASS', 'TRIAGE_AUTHORIZED', 'Alert triage is authorized.', evidence);
  },
};

const socAcknowledgementPolicy: RefereePolicy = {
  policyId: 'POLICY-006',
  description: 'Authorize SOC acknowledgement only after an escalation request.',
  evaluate(context: RefereePolicyContext): RefereePolicyFinding {
    if (notApplicable('soc_acknowledgement', context.decision.actionType)) {
      return finding('NOT_APPLICABLE', 'ACTION_NOT_APPLICABLE', 'Not a SOC acknowledgement.');
    }

    const evidence = [
      `incidentStatus=${context.state.world.incidentStatus}`,
      `escalationStatus=${context.state.world.escalationStatus}`,
      `responseStatus=${context.state.world.responseStatus}`,
    ];

    if (
      context.state.world.incidentStatus !== 'escalated' ||
      context.state.world.escalationStatus !== 'requested' ||
      context.state.world.responseStatus !== 'none'
    ) {
      return finding(
        'FAIL',
        'UNSAFE_ACKNOWLEDGEMENT_STATE',
        'SOC acknowledgement requires a requested escalation with no existing response.',
        evidence,
      );
    }

    return finding(
      'PASS',
      'SOC_ACKNOWLEDGEMENT_AUTHORIZED',
      'SOC acknowledgement is authorized.',
      evidence,
    );
  },
};

const incidentClosurePolicy: RefereePolicy = {
  policyId: 'POLICY-007',
  description: 'Authorize incident closure only after safe containment.',
  evaluate(context: RefereePolicyContext): RefereePolicyFinding {
    if (notApplicable('incident_closure', context.decision.actionType)) {
      return finding('NOT_APPLICABLE', 'ACTION_NOT_APPLICABLE', 'Not an incident closure.');
    }

    const evidence = [
      `incidentStatus=${context.state.world.incidentStatus}`,
      `responseStatus=${context.state.world.responseStatus}`,
    ];

    if (
      context.state.world.incidentStatus !== 'contained' ||
      (context.state.world.responseStatus !== 'blocked' &&
        context.state.world.responseStatus !== 'isolated')
    ) {
      return finding(
        'FAIL',
        'UNSAFE_CLOSURE_STATE',
        'Incident closure requires a contained incident with a completed response.',
        evidence,
      );
    }

    return finding('PASS', 'CLOSURE_AUTHORIZED', 'Incident closure is authorized.', evidence);
  },
};

export const DECISION_BINDING_POLICY: RefereePolicy = Object.freeze({
  policyId: 'POLICY-008',
  description: 'Bind the decision to the selected eligible storylet, outcome, and action.',
  evaluate(context: RefereePolicyContext): RefereePolicyFinding {
    if (context.selectedStorylet === null) {
      return finding(
        'FAIL',
        'NO_ELIGIBLE_STORYLET',
        'No eligible storylet is available for the proposed decision.',
        [`stateVersion=${String(context.state.version)}`],
      );
    }

    const evidence = [
      `selectedStorylet=${context.selectedStorylet.id}`,
      `proposedStorylet=${context.decision.storyletId}`,
      `selectedAction=${context.selectedStorylet.action.id}`,
      `expectedActionType=${context.expectedActionType ?? 'none'}`,
      `proposedActionType=${context.decision.actionType}`,
      `proposedOutcome=${context.decision.outcomeId}`,
    ];

    if (context.decision.storyletId !== context.selectedStorylet.id) {
      return finding(
        'FAIL',
        'STORYLET_BINDING_MISMATCH',
        'The decision does not bind to the selected eligible storylet.',
        evidence,
      );
    }
    if (context.selectedOutcome === null) {
      return finding(
        'FAIL',
        'UNKNOWN_OUTCOME',
        'The proposed outcome is not defined by the selected storylet.',
        evidence,
      );
    }
    if (context.expectedActionType === null) {
      return finding(
        'FAIL',
        'UNMAPPED_STORYLET_ACTION',
        'The selected storylet action has no referee action type.',
        evidence,
      );
    }
    if (context.decision.actionType !== context.expectedActionType) {
      return finding(
        'FAIL',
        'ACTION_BINDING_MISMATCH',
        'The proposed action type does not match the selected storylet action.',
        evidence,
      );
    }

    return finding(
      'PASS',
      'DECISION_BOUND',
      'The decision is bound to the selected storylet, outcome, and action.',
      evidence,
    );
  },
});

export const DEFAULT_REFEREE_POLICY_SET: RefereePolicySet = Object.freeze({
  id: '4sight-default-referee',
  version: '1.0.0',
  policies: Object.freeze([
    externalPerimeterBlockPolicy,
    protectedSourceBlockPolicy,
    socEscalationPolicy,
    stateTransitionSafetyPolicy,
    triagePolicy,
    socAcknowledgementPolicy,
    incidentClosurePolicy,
    DECISION_BINDING_POLICY,
  ].map((policy) => Object.freeze(policy))),
});
