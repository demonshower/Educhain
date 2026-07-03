"""
Baseline 2: Multi-Reviewer Voting (no economic incentives).

Multiple LLM reviewers independently evaluate the student submission.
Simple majority vote determines the final verdict.
No staking, no slashing, no verification test.
"""

from .base import BaselineRunner, AuditResult, run_llm_audit


class MultiAgentVoteBaseline(BaselineRunner):
    """Multiple reviewers vote on whether a submission is problematic. Majority wins."""

    name = "B2_MultiAgentVote"

    def __init__(self, num_agents: int = 3):
        self.num_agents = num_agents
        from backend.services.agent_service import get_agent_service
        self.service = get_agent_service()

    def audit_contract(self, contract: dict) -> AuditResult:
        if not self.service.is_loaded:
            return AuditResult(contract["id"], False, reasoning="Reviewer not loaded")

        votes_vuln = 0
        severities = []
        vuln_type = None

        for i in range(self.num_agents):
            # Distinct salt per reviewer → diverse independent responses
            audit = run_llm_audit(self.service, contract["source"], salt=f"agent_{i}_")
            if not audit["ok"]:
                continue
            severities.append(audit["severity"])
            if audit["severity"] >= 60 and len(audit["high_vulns"]) > 0:
                votes_vuln += 1
                vuln_type = vuln_type or audit["vuln_type"]

        detected = votes_vuln > self.num_agents / 2
        avg_severity = sum(severities) / len(severities) if severities else 0

        return AuditResult(
            contract_id=contract["id"],
            detected_vulnerability=detected,
            vulnerability_type=vuln_type if detected else None,
            confidence=avg_severity / 100.0,
            reasoning=f"Vote: {votes_vuln}/{self.num_agents} problematic (avg severity={avg_severity:.0f})",
            num_agents_involved=self.num_agents,
            consensus_reached=(votes_vuln == 0 or votes_vuln == self.num_agents),
            gas_cost=0,
        )
