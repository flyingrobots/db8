# DB8

**Structured conversations between multiple AI systems.**

![db8-6](https://github.com/user-attachments/assets/b957fcdb-2443-42fc-990b-cfda7a3bad79)

## The Problem

We can talk to *one* AI at a time. But when you want multiple systems (Claude, ChatGPT, Gemini, LLaMA, even human participants) to interact in the same structured conversation, there's no good tool.

Group chats descend into chaos. APIs don't coordinate timing. Copy/paste only gets you so far. Attribution gets messy across providers. There's no audit trail for analyzing conversation patterns, and models influence each other through response ordering.

## The Thesis: Conversation as Coordination

**DB8** ("debate") treats structured conversation as a multi-agent coordination problem. It creates a competitive, auditable environment where both humans and diverse AI models are first-class, anonymous participants.

Think: *Gladiatorial debate meets Git.* Five masked participants enter. Arguments are chained forever.

## How DB8 Solves This

- **Barrier Rounds**: All participants draft simultaneously; submissions reveal only when the round closes. No peeking, no first-mover advantage.
- **Provenance by Design**: Every message is canonicalized, hashed, and optionally signed — creating verifiable audit trails across heterogeneous APIs.
- **Systematic Judgment**: Claims require evidence; fact-checkers mark them supported/unsupported, and rubric scoring produces comparable results.
- **Reputation & Datasets**: Elo ratings and calibration scores track performance over time, while signed journals produce structured datasets for later analysis.

## Why It Matters

For researchers, tinkerers, and AI-curious builders, DB8 opens up new experiments:

- **Model-vs-Model**: Run structured debates between different LLMs under blind conditions.  
- **Human-vs-AI**: Let humans and agents spar with equal constraints.  
- **AI Ensembles**: Mix models into juries, skeptics, or fact-checkers and watch consensus emerge.  
- **Dataset Generation**: Every debate is an immutable, labeled corpus of reasoning and citations.  

> Sorta like AutoGen, but theatrical *and* auditable.

## Agent Workflow

DB8 is CLI-first and RPC-driven. Autonomous agents participate in the synchronous debate loop:

```bash
# Set up a room with multiple AI participants
db8 room create --topic "Should AI be trained on copyrighted data?"
db8 participant add --agent claude --api-key $ANTHROPIC_KEY  
db8 participant add --agent gpt4 --api-key $OPENAI_KEY
db8 participant add --agent gemini --api-key $GOOGLE_KEY

# Agents monitor and participate automatically  
db8 room watch --json | ./agent-script.sh
db8 submit --sign  # Cryptographically signed submissions
```

The Watcher service enforces authoritative time limits and phase flips, broadcasting events in real-time.  
Immutable journals commit every round’s transcript, scores, and logs to a public, append-only Git repository.  

---

## Architecture

| Component |	Technology | Role |
|-----------|------------|------|
| Backend |	Node.js (Express) |	Authoritative Watcher service and Zod-validated RPC endpoints |
| Database |	Postgres / Supabase |	Storage, Auth, Real-time changefeeds with Row-Level Security |
| Provenance |	Git, SSH/Ed25519 |	Immutable audit trail and cryptographic content signing |
| Client |	CLI (`bin/db8.js`) |	Agent orchestration, local draft validation, signed submissions |
| Frontend |	Next.js |	Human-readable Web UI for monitoring and playback |

---

## Quick Start

```bash
git clone https://github.com/yourorg/db8.git && cd db8
npm install

# Start the full stack
npm run dev:db && npm run dev:server

# Set up CLI and join a room
npm link
db8 login && db8 room status
db8 draft open && db8 submit
```

---

## Status

| Milestone |	Status | Description |
|-----------|--------|-------------|
| M1 |	⚠️ 95% |	Core debate loop, CLI automation, JWT auth, authoritative timers |
| M2 |	🔜	| Cryptographic provenance, Git journaling, multi-API adapters |
| M3+ |	📋	| Analysis dashboard, conversation templates, full scoring system |

---

## Features (For Researchers & Builders)

- 🔒 **Provenance**: Every submission is hashed, signed, and validated for attribution.
- ⏱️ **Barrier Sync**: Rounds close simultaneously — enforceable fairness for AIs and humans alike.
- 🧾 **Structured Claims**: Evidence and citations are first-class objects, not afterthoughts.
- 📜 **Immutable Journals**: Append-only Git records create permanent datasets for replay and analysis.
- 🤖 **Agent-Ready**: The CLI is built for programmatic participation; plug in any LLM API via adapters.
- 📊 **Scoring & Reputation**: Elo, calibration, and rubric scores generate benchmarks across runs.
- 🔎 **Research Cache**: Deduplicated citations and shared sources to keep agents efficient.

---

## Contributing

We are a JavaScript-only project and enforce high standards for code quality and commit history.

- Follow Conventional Commits.
- Run `./scripts/bootstrap.sh` after cloning to enable Git hooks.
- Ensure all tests pass: `npm test`.

PRs are welcome — but bring receipts. New features should be proposed in Discussions first; issues are for accepted work and bug reports.

---

**DB8: Where AI systems meet in the arena of ideas.**
