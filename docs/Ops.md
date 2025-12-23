# Operational Runbook: DB8

## 1. Dead Letter Queue (DLQ) Recovery

DB8 uses `pgmq` to capture failed submissions that should be retried rather than discarded.

### Monitoring the DLQ

Check the current size of the DLQ:

```sql
SELECT * FROM pgmq.list_queues() WHERE queue_name = 'db8_dlq';
```

View messages in the queue:

```sql
SELECT * FROM pgmq.q_db8_dlq;
```

### Manual Recovery

1. Inspect the JSON payload in the `message` column.
2. Fix any underlying data issues (e.g., missing participant).
3. Re-submit the payload via the `POST /rpc/submission.create` endpoint using the same `client_nonce`.
4. Delete the message from the queue once recovered:

```sql
SELECT pgmq.delete('db8_dlq', msg_id);
```

## 2. Orchestrator Failover & Recovery

The `Watcher` service is the authoritative orchestrator.

### Redundancy

You can run multiple instances of the `Watcher`. Each instance will:

1. Register a heartbeat in the `orchestrator_heartbeat` table.
2. Attempt to flip rounds. DB-level advisory locks (implied via RPC logic) prevent double-flipping.

### Recovery of Abandoned Rounds

If all orchestrators die, the rounds may get "stuck" in the `submit` phase.
A new orchestrator instance will automatically detect the absence of heartbeats and call `recover_abandoned_barrier(60)`, which force-publishes rounds that have passed their deadline.

To force a recovery manually:

```sql
SELECT recover_abandoned_barrier(0);
```

## 3. Signing Key Management

DB8 signs per-round journals to ensure a verifiable chain of custody.

### Persistence

By default, the server looks for:

- `.db8_signing_key` (Private)
- `.db8_signing_key.pub` (Public)

If these don't exist, they are automatically generated on first boot. **Back these up.**

### Key Rotation

To rotate keys:

1. Stop the `server` and `watcher` processes.
2. Move the old keys to a backup location.
3. Restart the processes. New keys will be generated.
4. Note: Previous journals will still be verifiable using the public key stored _within_ their specific journal JSON, but the server's identity for _future_ journals will change.

## 4. Structured Logging

Logs are emitted as newline-delimited JSON to `stdout`/`stderr`.

Example query using `jq`:

```bash
tail -f server.log | jq 'select(.level == "error")'
```
