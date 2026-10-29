/**
 * A configured database that cannot take a write is an outage, and the server
 * reports it as one (#257). It never keeps the write in memory instead: memory
 * is lost on restart and invisible to other server processes, so confirming
 * such a write told the client something untrue.
 *
 * `outcome` tells the client what it may assume:
 * - `not_stored`: the statement never reached the database, so nothing was
 *   written and a new attempt may start afresh.
 * - `unknown`: the statement may have committed before the connection failed.
 *   Whether a retry is safe depends on the endpoint; docs/LocalDB.md ("When
 *   the database fails") lists each one. Writes keyed by a client nonce are
 *   safe to retry with the same nonce.
 */
export class DatabaseUnavailableError extends Error {
  constructor(outcome, cause) {
    super('database_unavailable', cause ? { cause } : undefined);
    this.name = 'DatabaseUnavailableError';
    this.outcome = outcome;
  }
}

// Failures to open a connection: the statement was never sent.
const CONNECT_CODES = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EAI_AGAIN'
]);
const CONNECT_MESSAGES = [
  /timeout exceeded when trying to connect/i,
  /cannot use a pool after calling end/i
];
// SQLSTATEs after which nothing was written: invalid authorization (28), the
// database does not exist (3D000), too many connections (53300), cannot
// connect now (57P03), and query canceled (57014: a statement timeout or a
// cancel request rolls the statement back).
const CONNECT_SQLSTATE = /^(28...|3D000|53300|57P03|57014)$/;
// SQLSTATEs that mean the server or the connection failed, not that the
// database refused the statement: connection exception (08), insufficient
// resources (53), operator intervention (57P), system error (58).
const OUTAGE_SQLSTATE = /^(08...|53...|57P..|58...)$/;

/**
 * Classifies an error from a database call.
 *
 * Returns the error unchanged when the database answered and refused the
 * statement (a rule an RPC enforced, a constraint): that is the caller's
 * problem, not an outage. Otherwise returns a DatabaseUnavailableError.
 *
 * Postgres sets `severity` on every error it sends. An error without one never
 * got an answer from the database.
 *
 * @param {unknown} err
 * @param {{ wrote?: boolean }} [opts] `wrote: false` for a statement that
 *   writes nothing (a lookup before the write), whose failure is never
 *   `unknown`.
 */
export function databaseFailure(err, { wrote = true } = {}) {
  if (err instanceof DatabaseUnavailableError) return err;
  const code = typeof err?.code === 'string' ? err.code : '';
  if (err?.severity && !OUTAGE_SQLSTATE.test(code) && !CONNECT_SQLSTATE.test(code)) return err;
  const neverSent =
    !wrote ||
    CONNECT_CODES.has(code) ||
    CONNECT_SQLSTATE.test(code) ||
    CONNECT_MESSAGES.some((re) => re.test(String(err?.message ?? '')));
  return new DatabaseUnavailableError(neverSent ? 'not_stored' : 'unknown', err);
}

/**
 * Sends the 503 for a DatabaseUnavailableError. Returns false for any other
 * error, so a route can call it first in its catch block.
 */
export function sendIfDatabaseUnavailable(res, err) {
  if (!(err instanceof DatabaseUnavailableError)) return false;
  res.status(503).json({ ok: false, error: 'database_unavailable', outcome: err.outcome });
  return true;
}

/**
 * Runs one statement, turning an outage into a DatabaseUnavailableError. An
 * error the database answered with is rethrown unchanged.
 */
export async function queryOrUnavailable(pool, sql, params, opts) {
  try {
    return await pool.query(sql, params);
  } catch (err) {
    throw databaseFailure(err, opts);
  }
}

/**
 * Runs `fn(client)` in one transaction. A failure before COMMIT rolls the
 * transaction back (the database also discards it when the connection drops),
 * so an outage there is `not_stored`. Only a failed COMMIT is `unknown`.
 */
export async function inTransaction(pool, fn) {
  let client;
  try {
    client = await pool.connect();
  } catch (err) {
    throw databaseFailure(err, { wrote: false });
  }
  // A client whose connection failed is destroyed, not returned to the pool.
  let broken;
  try {
    let result;
    try {
      await client.query('BEGIN');
      result = await fn(client);
    } catch (err) {
      await client.query('ROLLBACK').catch((rollbackErr) => {
        broken = rollbackErr;
      });
      throw databaseFailure(err, { wrote: false });
    }
    try {
      await client.query('COMMIT');
    } catch (err) {
      broken = err;
      throw databaseFailure(err);
    }
    return result;
  } finally {
    client.release(broken);
  }
}
