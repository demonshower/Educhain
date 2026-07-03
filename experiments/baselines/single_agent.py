"""
Baseline 1: Single Agent LLM Review (no dispute mechanism).

A single LLM reviewer evaluates the student submission and outputs a verdict.
No challenge, no arbitration, no verification test.
"""

from .base import BaselineRunner, AuditResult, run_llm_audit


class SingleAgentBaseline(BaselineRunner):
    """Single LLM reviewer without any dispute mechanism."""

    name = "B1_SingleAgent"

    def __init__(self):
        from backend.services.agent_service import get_agent_service
        self.service = get_agent_service()

    def audit_contract(self, contract: dict) -> AuditResult:
        if not self.service.is_loaded:
            return AuditResult(contract["id"], False, reasoning="Reviewer not loaded")

        audit = run_llm_audit(self.service, contract["source"])
        # Flag only when severity is high AND a Critical/High issue exists
        detected = audit["severity"] >= 65 and len(audit["high_vulns"]) > 0

        return AuditResult(
            contract_id=contract["id"],
            detected_vulnerability=detected,
            vulnerability_type=audit["vuln_type"],
            confidence=audit["severity"] / 100.0,
            reasoning=f"Severity={audit['severity']}, found {len(audit['vulns'])} issues",
            num_agents_involved=1,
            gas_cost=0,
        )