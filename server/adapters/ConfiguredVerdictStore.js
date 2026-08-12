import { PostgresVerdictStore } from './PostgresVerdictStore.js';
import { MemoryVerdictStore } from './MemoryVerdictStore.js';

/**
 * Chooses a VerdictStore by configuration.
 *
 * Deliberately *not* a fallback. It routes on whether a database is configured,
 * never on whether one is failing: a configured database that errors surfaces
 * `database_unavailable` from the Postgres adapter and the request fails.
 * Answering from memory instead would tell a judge their verdict was recorded
 * when it was only held in a process about to restart.
 *
 * The decision is made per call rather than at construction because
 * server/rpc.js swaps the pool at runtime (__setDbPool), and tests rely on that.
 */
export class ConfiguredVerdictStore {
  constructor({ dbRef, durable, memory }) {
    this.dbRef = dbRef;
    this.durable = durable;
    this.memory = memory;
  }

  get delegate() {
    return this.dbRef.pool ? this.durable : this.memory;
  }

  submitVerdict(input) {
    return this.delegate.submitVerdict(input);
  }

  summary(roundId) {
    return this.delegate.summary(roundId);
  }

  claimTerm(submissionId, claimId) {
    return this.delegate.claimTerm(submissionId, claimId);
  }
}

/**
 * Builds the store the application uses: a Postgres adapter and a memory
 * adapter, selected by whether a database is configured.
 *
 * One place assembles the three pieces, so the composition root and the tests
 * exercise the same wiring rather than two hand-rolled approximations of it.
 */
export function createVerdictStore({ dbRef, verdicts, submissionIndex }) {
  return new ConfiguredVerdictStore({
    dbRef,
    durable: new PostgresVerdictStore({ dbRef }),
    memory: new MemoryVerdictStore({ verdicts, submissionIndex })
  });
}
