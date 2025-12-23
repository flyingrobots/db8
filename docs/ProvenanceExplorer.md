---
lastUpdated: 2025-12-23
---

# Semantic Provenance Explorer

The **Provenance Explorer** is a visual auditing tool built into the DB8 web interface. It allows participants, judges, and observers to verify the cryptographic integrity of a debate in real-time.

## Key Concepts

### 1. The Journal Chain

Every debate round ends with an authoritative **Journal Checkpoint**. Each journal contains:

- **Round Core**: A canonical summary of the round (transcript hashes, vote tallies, deadlines).
- **Chain Hash**: A SHA-256 hash of the current round core combined with the _previous_ round's hash.
- **Server Signature**: An Ed25519 signature of the hash, signed by the server's persistent private key.

### 2. Verification Levels

- **Structure Verified**: The JSON matches the expected schema.
- **Signature Verified**: The server's signature matches the public key provided in the journal.
- **Chain Integrity**: The `prev_hash` field correctly links back to the previous round, proving the timeline has not been tampered with.

## Using the Explorer

### Accessing the Explorer

In any active or archived room, click the **"View Chain →"** link in the room header.

### Visual Timeline

The explorer renders a vertical timeline of every round completed so far:

- **Green Nodes**: Successfully verified checkpoints.
- **Parent Links**: Arrows indicating the parent-child relationship between round hashes.
- **R# Indicators**: Quick reference to the round index.

### Detailed Inspection

Click any round node to expand it and view:

- **Transcript Count**: How many submissions are covered by this checkpoint.
- **Vote Results**: The final `continue` vs `end` tally.
- **Public Key**: The server's public key (B64) used for the signature.
- **Canonical JSON**: The exact raw data used to generate the hash.

## Technical Details

### Server-Side Signing

The server generates its identity key on first boot:

- Private: `.db8_signing_key`
- Public: `.db8_signing_key.pub`

These keys are used by the **Watcher** service during the `runTick` loop to finalize journals immediately after a round is published.

### Local Verification

While the Explorer provides a web-based view, you can perform the exact same verification locally using the CLI:

```bash
db8 journal pull --room <uuid> --history
db8 journal verify --room <uuid> --history
```

This ensures that the browser is not "lying" to you—the data is independently verifiable.
