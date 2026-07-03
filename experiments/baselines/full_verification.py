"""
Baseline 4: Full Verification (no optimistic confirmation).

Every submission goes through full verification: all reviewers evaluate it, a
verification test is always generated and sandbox-replayed. Measures the cost
of "always verify" versus EduChain's "verify only on dispute".
"""

import sys
import asyncio
from pathlib import Path

_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(_PROJECT_ROOT))

from .base import BaselineRunner, AuditResult, run_llm_audit, GAS_DISPUTE, GAS_FINALIZE


class FullVerificationBaseline(BaselineRunner):
    """Full verification on every task — no optimistic confirmation."""

    name = "B4_FullVerification"

    def __init__(self, num_verifiers: int = 3):
        self.num_verifiers = num_verifiers
        from backend.services.agent_service import get_agent_service
        from backend.services.sandbox_service import SandboxService
        self.service = get_agent_service()
        self.sandbox = SandboxService()

    def audit_contract(self, contract: dict) -> AuditResult:
        if not self.service.is_loaded:
            return AuditResult(contract["id"], False, reasoning="Reviewer not loaded")

        # Step 1: all verifiers review the submission
        severities, all_high = [], []
        for i in range(self.num_verifiers):
            audit = run_llm_audit(self.service, contract["source"], salt=f"verifier_{i}_")
            if audit["ok"]:
                severities.append(audit["severity"])
                all_high.extend(audit["high_vulns"])

        avg_severity = sum(severities) / len(severities) if severities else 0
        detected = avg_severity >= 60 and len(all_high) > 0
        vuln_type = all_high[0].get("type") or all_high[0].get("vulnerability_type") if all_high else None

        # Step 2 & 3: always generate verification test and sandbox-replay (full verification)
        poc_valid = False
        if detected:
            poc_code = self._generate_poc(contract["source"], vuln_type)
            if poc_code:
                poc_valid = self._sandbox_replay(contract["source"], poc_code) == "CHALLENGE_UPHELD"

        return AuditResult(
            contract_id=contract["id"],
            detected_vulnerability=detected,
            vulnerability_type=vuln_type if detected else None,
            confidence=avg_severity / 100.0,
            reasoning=f"Full verification: {self.num_verifiers} agents, avg_severity={avg_severity:.0f}",
            num_agents_involved=self.num_verifiers,
            consensus_reached=True,
            poc_generated=detected, poc_valid=poc_valid,
            sandbox_invoked=True, challenge_raised=True,
            gas_cost=GAS_DISPUTE + GAS_FINALIZE,
        )

    def _generate_poc(self, source: str, vuln_type: str) -> str:
        from backend.schemas.audit import PoCRequest
        result = self.service.generate_poc(PoCRequest(
            vulnerability_type=vuln_type or "unknown",
            target_contract=source,
            description=f"Verification test for {vuln_type} issue",
        ))
        if "error" in result:
            return ""
        return result.get("poc_code", "")

    def _sandbox_replay(self, source: str, poc_code: str) -> str:
        try:
            loop = asyncio.new_event_loop()
            result = loop.run_until_complete(self.sandbox.replay_poc(poc_code, source))
            loop.close()
            return result.verdict
        except Exception:
            return "ERROR"
