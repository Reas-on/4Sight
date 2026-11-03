import type { SimulationRepository } from './contracts.js';

export class RecoveryService {
  constructor(private readonly repository: SimulationRepository) {}

  recoverInterruptedRuns(): Promise<number> {
    return this.repository.recover();
  }
}
