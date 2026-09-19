import { SimulationLifecycleError } from './errors.js';
import type { SimulationStatus } from './types.js';

export type SimulationLifecycleAction = 'start' | 'pause' | 'resume' | 'cancel';

const TERMINAL_STATUSES: readonly SimulationStatus[] = [
  'COMPLETED',
  'FAILED',
  'CANCELLED',
];

const ALLOWED_SOURCE_STATUSES: Readonly<
  Record<SimulationLifecycleAction, readonly SimulationStatus[]>
> = Object.freeze({
  start: ['CREATED'],
  pause: ['RUNNING'],
  resume: ['PAUSED'],
  cancel: ['CREATED', 'RUNNING', 'PAUSED'],
});

export function isTerminalStatus(status: SimulationStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

export function assertLifecycleTransition(
  status: SimulationStatus,
  action: SimulationLifecycleAction,
): void {
  if (ALLOWED_SOURCE_STATUSES[action].includes(status)) return;

  throw new SimulationLifecycleError(
    `Cannot ${action} a simulation run in status ${status}`,
    [`status=${status}`, `action=${action}`],
  );
}
