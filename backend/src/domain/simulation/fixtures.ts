import type { DecisionParameters, ProposedDecision, RefereeActionType } from '../referee/types.js';
import { SimulationProviderError } from './errors.js';
import type { DecisionContext, DecisionProvider } from './types.js';

export type DecisionScript =
  | readonly ProposedDecision[]
  | ((context: DecisionContext) => ProposedDecision | Promise<ProposedDecision>);

function fixtureDecision(
  providerId: string,
  decisionId: string,
  actionType: RefereeActionType,
  storyletId: string,
  outcomeId: string,
  parameters?: DecisionParameters,
): ProposedDecision {
  return Object.freeze({
    decisionId,
    providerId,
    actionType,
    ...(parameters === undefined ? {} : { parameters: Object.freeze({ ...parameters }) }),
    storyletId,
    outcomeId,
  });
}

export class ScriptedDecisionProvider implements DecisionProvider {
  readonly id: string;
  private readonly script: DecisionScript;
  private readonly decisions: readonly ProposedDecision[];

  constructor(id: string, script: DecisionScript) {
    this.id = id;
    this.script = script;
    this.decisions = typeof script === 'function' ? [] : Object.freeze([...script]);
  }

  decide(context: DecisionContext): ProposedDecision | Promise<ProposedDecision> {
    if (typeof this.script === 'function') return this.script(context);

    const decision = this.decisions[context.sequence - 1];
    if (decision === undefined) {
      throw new SimulationProviderError(
        'SCRIPT_EXHAUSTED',
        `Scripted decision provider "${this.id}" has no decision for sequence ${context.sequence}`,
        [`sequence=${context.sequence}`],
      );
    }

    return decision;
  }
}

export function createScriptedDecisionProvider(
  id: string,
  script: DecisionScript,
): ScriptedDecisionProvider {
  return new ScriptedDecisionProvider(id, script);
}

export const EXTERNAL_SOURCE_DECISIONS: readonly ProposedDecision[] = Object.freeze([
  fixtureDecision(
    'fixture-external-source',
    'external-001',
    'triage_alert',
    'triage-ssh-brute-force',
    'confirm-threat',
    { incidentId: 'incident-ssh-001' },
  ),
  fixtureDecision(
    'fixture-external-source',
    'external-002',
    'perimeter_block',
    'block-external-source',
    'block-applied',
    { sourceId: 'source-external-001', incidentId: 'incident-ssh-001' },
  ),
  fixtureDecision(
    'fixture-external-source',
    'external-003',
    'incident_closure',
    'close-ssh-incident',
    'incident-resolved',
    { incidentId: 'incident-ssh-001' },
  ),
]);

export const PROTECTED_INTERNAL_DECISIONS: readonly ProposedDecision[] = Object.freeze([
  fixtureDecision(
    'fixture-protected-internal',
    'protected-001',
    'triage_alert',
    'triage-ssh-brute-force',
    'confirm-threat',
    { incidentId: 'incident-ssh-002' },
  ),
  fixtureDecision(
    'fixture-protected-internal',
    'protected-002',
    'soc_escalation',
    'escalate-protected-source',
    'soc-escalated',
    { sourceId: 'source-internal-001', incidentId: 'incident-ssh-002' },
  ),
  fixtureDecision(
    'fixture-protected-internal',
    'protected-003',
    'soc_acknowledgement',
    'soc-escalation-follow-up',
    'soc-contained',
    { sourceId: 'source-internal-001', incidentId: 'incident-ssh-002' },
  ),
  fixtureDecision(
    'fixture-protected-internal',
    'protected-004',
    'incident_closure',
    'close-ssh-incident',
    'incident-resolved',
    { incidentId: 'incident-ssh-002' },
  ),
]);

export const UNSAFE_PROTECTED_BLOCK_DECISIONS: readonly ProposedDecision[] = Object.freeze([
  fixtureDecision(
    'fixture-unsafe-block',
    'unsafe-001',
    'triage_alert',
    'triage-ssh-brute-force',
    'confirm-threat',
    { incidentId: 'incident-ssh-003' },
  ),
  fixtureDecision(
    'fixture-unsafe-block',
    'unsafe-002',
    'perimeter_block',
    'block-external-source',
    'block-applied',
    { sourceId: 'source-internal-001', incidentId: 'incident-ssh-003' },
  ),
]);

export function createExternalSourceProvider(): ScriptedDecisionProvider {
  return createScriptedDecisionProvider(
    'fixture-external-source',
    EXTERNAL_SOURCE_DECISIONS,
  );
}

export function createProtectedInternalProvider(): ScriptedDecisionProvider {
  return createScriptedDecisionProvider(
    'fixture-protected-internal',
    PROTECTED_INTERNAL_DECISIONS,
  );
}

export function createUnsafeProtectedBlockProvider(): ScriptedDecisionProvider {
  return createScriptedDecisionProvider(
    'fixture-unsafe-block',
    UNSAFE_PROTECTED_BLOCK_DECISIONS,
  );
}

export function createBeginnerFixtureProvider(unsafe = false): ScriptedDecisionProvider {
  return createScriptedDecisionProvider('fixture-beginner', context => {
    const internal = context.state.world.sourceClassification === 'internal' || context.state.world.sourceProtected || context.state.world.assetProtected;
    return fixtureDecision('fixture-beginner', 'beginner-fixture-1', internal && !unsafe ? 'soc_escalation' : 'perimeter_block',
      context.selectedStorylet.id, internal ? 'escalation-approved' : 'block-approved',
      { sourceId: '203.0.113.25', incidentId: 'demo-ssh-001' });
  });
}
