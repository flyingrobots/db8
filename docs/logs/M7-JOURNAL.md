# Developer's Journal: Milestone M7

**Objective**: Finalize core JITOS Causal Kernel functionality for db8, including SLAPS v2 and HTN Method v1 integration concepts, and establish robust production hardening.

**Tasks**:

- Implement production rate limiting and DLQ (Dead Letter Queue) via pgmq.
- Integrate SLAPS v2 syscall patterns into the RPC layer.
- Develop SSH CA management UX and automated key rotation.
- Establish structured logging and telemetry metrics.
- Finalize Shiplog provenance publishing for all room state transitions.
- Write comprehensive integration tests for hardening logic.

**Dependencies**:

- Stable M1-M6 codebase.
- Redis (installed via Homebrew).
- JITOS Causal Kernel Go models (as reference).

**Timeline**:

- **Start**: 2025-12-23
- **End**: 2026-01-15

**Risks**:

- Complexity of integrating SLAPS syscall concepts into an existing Express RPC layer.
- Resource contention during high-frequency telemetry logging.
- Concurrency issues in automated key rotation.

**Metrics**:

- 100% pass rate on all hardening and ops tests.
- Successful recovery from simulated submission failures via DLQ.
- End-to-end verified provenance chain for a full debate lifecycle.

---

## Retrospective (M1-M6)

**Most Interesting**: The implementation of the **Research Tools**. Seeing the loop close between an LLM's internal reasoning and verifiable external evidence via the "One-Click Cite" UI was a breakthrough moment for the platform's utility.

**Most Challenging**: The **Test Isolation**. Debugging parallel race conditions in the database while maintaining a "tests as spec" philosophy was a brutal but necessary lesson in the dangers of shared state in causal systems.

**Most Rewarding**: Achieving a **100% green test suite** across six milestones of complex, cryptographically-bound logic. It proves that the "Causal Kernel" architecture is not just a theory, but a buildable, testable reality.

**Looking Forward Most**: Milestone 7's **Hardening**. Moving from a functional prototype to a system that can withstand adversarial input and recover from infrastructure failure is the ultimate test of JITOS.

**Next Step Post-M7**: Once db8 is hardened, the next leap in the JITOS roadmap is the **TASKS Planner**. We will move beyond static HTN methods to a dynamic Loader/Linker system that allow the kernel to autonomously synthesize and execute new methods based on real-time room objectives.
