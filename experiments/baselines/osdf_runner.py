"""
EduChain Full Pipeline Runner.

Simulates the complete EduChain academic integrity framework applied to
reviewing student code submissions:
  Submitter reviews → optimistic finalize if confident
  Submitter misses → Reporter second opinion → verification test + sandbox
  replay → arbitration

Key EduChain property: a "problematic submission" verdict is only upheld when a
verification test is confirmed by deterministic sandbox replay, filtering out
LLM false positives.

Bidirectional verification (Phase 2b): when the submitter claims "clean", the
LLM generates an invariant fuzz test from the assignment's hard constraints.
The sandbox runs it with randomised call sequences. If an invariant is broken,
the counterexample is escalated as a reported issue, catching false negatives
that no reporter ever raised.
"""

import sys
import asyncio
from pathlib import Path

_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(_PROJECT_ROOT))

from experiments.baselines.base import (
    BaselineRunner, AuditResult, run_llm_audit, GAS_OPTIMISTIC, GAS_DISPUTE,
)


class EduChainRunner(BaselineRunner):
    """Full EduChain pipeline with optimistic confirmation and dispute mechanism."""

    name = "EduChain"

    # Submitter detection thresholds by review strength
    _THRESHOLDS = {"strong": 35, "normal": 50, "weak": 70}

    # Default fuzz runs for invariant verification (scales with reward in production)
    _FUZZ_RUNS = 128

    def __init__(self, proposer_strength: str = "normal", challenger_enabled: bool = True,
                 bidirectional: bool = True):
        """
        Args:
            proposer_strength: "strong" / "normal" / "weak"
            challenger_enabled: whether the reporter agent is active
            bidirectional: when True, 'clean' verdicts are verified via LLM-generated
                           invariant fuzz tests (bidirectional verification test)
        """
        self.proposer_strength = proposer_strength
        self.challenger_enabled = challenger_enabled
        self.bidirectional = bidirectional
        from backend.services.agent_service import get_agent_service
        from backend.services.sandbox_service import SandboxService
        self.service = get_agent_service()
        self.sandbox = SandboxService()

    def audit_contract(self, contract: dict) -> AuditResult:
        if not self.service.is_loaded:
            return AuditResult(contract["id"], False, reasoning="Reviewer not loaded")

        cid = contract["id"]
        source = contract["source"]
        hard_constraints = contract.get("hard_constraints") or []

        # Phase 1: Submitter review → optimistic finalize on confident detection
        proposer = run_llm_audit(self.service, source)
        threshold = self._THRESHOLDS[self.proposer_strength]
        if proposer["severity"] >= threshold and proposer["high_vulns"]:
            return self._result(cid, True, proposer,
                                f"Submitter detected: {proposer['vuln_type']}", GAS_OPTIMISTIC)

        # Phase 2: Submitter claims "clean"
        # Phase 2b (Bidirectional): verify the 'clean' claim via LLM-generated invariant fuzz
        if self.bidirectional and hard_constraints:
            fuzz_result = self._run_invariant_fuzz(source, hard_constraints)
            if fuzz_result and fuzz_result.get("verdict") == "INVARIANT_BROKEN":
                # Fuzzer found a counterexample — escalate as auto-reported issue
                return AuditResult(
                    contract_id=cid,
                    detected_vulnerability=True,
                    vulnerability_type="invariant_violation",
                    confidence=0.90,
                    reasoning=(
                        f"Bidirectional invariant fuzz detected violation: "
                        f"{fuzz_result.get('reason')}. "
                        f"Counterexample found after {fuzz_result.get('runs', 0)} runs."
                    ),
                    num_agents_involved=1,
                    poc_generated=True,
                    poc_valid=True,
                    sandbox_invoked=True,
                    challenge_raised=True,
                    gas_cost=GAS_DISPUTE,
                )

        # Phase 3: Reporter second opinion (only if enabled)
        if not self.challenger_enabled:
            return self._result(cid, False, proposer,
                                "Submitter: no issue. No reporter active.", GAS_OPTIMISTIC)

        challenger = run_llm_audit(
            self.service, source, salt="challenger_",
            constraints=[
                "Focus on issues the submitter might have missed",
                "Look for plagiarism, logic errors, incorrect output, and style problems",
                "Only report if you have HIGH confidence in the issue",
            ],
        )
        if not (challenger["severity"] >= 60 and challenger["high_vulns"]):
            return self._result(cid, False, proposer,
                                "Both submitter and reporter: no issue found",
                                GAS_OPTIMISTIC, agents=2)

        # Phase 4: Verification-test generation — disagreement triggers a verifiable challenge
        poc_code = self._generate_poc(source, challenger["vuln_type"])
        if not poc_code:
            return self._result(cid, False, proposer,
                                "Reporter suspected an issue but produced no verifiable test",
                                GAS_OPTIMISTIC, agents=2)

        # Phase 5: Sandbox replay — deterministic verdict
        verdict = self._sandbox_replay(source, poc_code)
        upheld = verdict == "CHALLENGE_UPHELD"
        return AuditResult(
            contract_id=cid,
            detected_vulnerability=upheld,
            vulnerability_type=challenger["vuln_type"] if upheld else None,
            confidence=0.95 if upheld else proposer["severity"] / 100.0,
            reasoning=(f"Challenge upheld: verification test confirmed in sandbox ({challenger['vuln_type']})"
                       if upheld else f"Challenge dismissed: verification test failed replay ({verdict})"),
            num_agents_involved=2,
            poc_generated=True, poc_valid=upheld,
            sandbox_invoked=True, challenge_raised=True,
            gas_cost=GAS_DISPUTE,
        )

    # ──────────────────────────────────────────────────────────────
    # Internal helpers
    # ──────────────────────────────────────────────────────────────

    def _result(self, cid, detected, audit, reasoning, gas, agents=1) -> AuditResult:
        """Build an optimistic-path result (no sandbox invoked)."""
        return AuditResult(
            contract_id=cid,
            detected_vulnerability=detected,
            vulnerability_type=audit["vuln_type"] if detected else None,
            confidence=audit["severity"] / 100.0,
            reasoning=reasoning,
            num_agents_involved=agents,
            gas_cost=gas,
        )

    def _run_invariant_fuzz(self, source: str, hard_constraints: list) -> dict | None:
        """Generate an invariant test via LLM then run it in the sandbox.

        Returns a dict with verdict/reason/runs, or None if generation failed.
        """
        try:
            # Build a minimal TaskSpec for the invariant generator
            from agent.autonomous_agent import AutonomousAuditAgent
            from audit_agent import TaskSpec
            import hashlib

            agent = AutonomousAuditAgent(
                agent_id="invariant_gen",
                did="did:educhain:invariant",
                private_key="0x0",
            )
            task = TaskSpec(
                task_id="fuzz_task",
                code_hash=hashlib.sha256(source.encode()).hexdigest(),
                hard_constraints=hard_constraints,
                reward=0.0,
            )
            invariant_code = agent.generate_invariant_test(task, source)
            if not invariant_code:
                return None

            loop = asyncio.new_event_loop()
            fuzz = loop.run_until_complete(
                self.sandbox.run_invariant_fuzz(
                    invariant_code, source, fuzz_runs=self._FUZZ_RUNS
                )
            )
            loop.close()
            return {
                "verdict": fuzz.verdict,
                "reason": fuzz.reason,
                "counterexample": fuzz.counterexample,
                "runs": fuzz.runs,
            }
        except Exception as e:
            return None

    def _generate_poc(self, source: str, vuln_type: str) -> str:
        """Generate a verification test; returns code if it contains a runnable test."""
        from backend.schemas.audit import PoCRequest
        result = self.service.generate_poc(PoCRequest(
            vulnerability_type=vuln_type or "unknown",
            target_contract=source,
            description=f"Verification test for {vuln_type} issue in the submission",
        ))
        if "error" in result:
            return ""
        poc_code = result.get("poc_code", "")
        return poc_code if "testExploit" in poc_code else ""

    def _sandbox_replay(self, source: str, poc_code: str) -> str:
        """Run the verification test in the isolated sandbox and return its verdict."""
        try:
            loop = asyncio.new_event_loop()
            result = loop.run_until_complete(self.sandbox.replay_poc(poc_code, source))
            loop.close()
            return result.verdict
        except Exception as e:
            return f"ERROR: {e}"
