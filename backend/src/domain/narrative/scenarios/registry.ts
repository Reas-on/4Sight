import { beginnerInitialStates, beginnerScenario, BEGINNER_SCENARIO_VERSION } from './ssh-beginner.js';
import { sshBruteForceInitialStates, sshBruteForceScenario } from './ssh-brute-force.js';
import { branchInitialStates, branchScenario } from './policy-branch.js';

export const scenarioRegistry = [
  { scenario: beginnerScenario, version: BEGINNER_SCENARIO_VERSION, initialStates: beginnerInitialStates },
  { scenario: sshBruteForceScenario, version: '1.0.0', initialStates: sshBruteForceInitialStates },
  { scenario: branchScenario, version: '1.0.0', initialStates: branchInitialStates },
];
