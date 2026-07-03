"""Base class and shared types for all experiment runners."""

import hashlib
import time
from abc import ABC, abstractmethod
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from typing import Optional

# ===== Shared on-chain gas cost estimates =====
GAS_PUBLISH_TASK = 150_000
GAS_SUBMIT_PROPOSAL = 200_000
GAS_RAISE_CHALLENGE = 180_000
GAS_SELECT_COMMITTEE = 250_000
GAS_SUBMIT_ARBITRATION = 300_000
GAS_FINALIZE = 100_000

# Optimistic path: publish + propose + finalize (no dispute)
GAS_OPTIMISTIC = GAS_PUBLISH_TASK + GAS_SUBMIT_PROPOSAL + GAS_FINALIZE
# Dispute path: full pipeline with challenge + committee + arbitration
GAS_DISPUTE = (GAS_PUBLISH_TASK + GAS_SUBMIT_PROPOSAL + GAS_RAISE_CHALLENGE +
               GAS_SELECT_COMMITTEE + GAS_SUBMIT_ARBITRATION)


def run_llm_audit(service, source: str, salt: str = "", constraints: Optional[list] = None) -> dict:
    """Run an LLM review of a student code submission and normalize the result.

    Returns a dict with keys: ok, severity, vulns, high_vulns, vuln_type.
    Using a salt varies the code_hash so independent reviewers can get diverse responses.
    """
    from backend.schemas.audit import AuditRequest

    code_hash = hashlib.sha256(f"{salt}{source}".encode()).hexdigest()
    result = service.run_audit(AuditRequest(
        code_hash=code_hash, source_code=source, constraints=constraints,
    ))
    if "error" in result:
        return {"ok": False, "severity": 0, "vulns": [], "high_vulns": [], "vuln_type": None}

    severity = result.get("severity_score", 0)
    vulns = result.get("vulnerabilities", [])
    high_vulns = [v for v in vulns if v.get("severity") in ("Critical", "High")]
    vuln_type = None
    if high_vulns:
        vuln_type = high_vulns[0].get("type") or high_vulns[0].get("vulnerability_type")
    elif vulns:
        vuln_type = vulns[0].get("type")
    return {
        "ok": True, "severity": severity, "vulns": vulns,
        "high_vulns": high_vulns, "vuln_type": vuln_type,
    }


@dataclass
class AuditResult:
    """Unified result from any review method."""
    contract_id: str
    detected_vulnerability: bool
    vulnerability_type: Optional[str] = None
    confidence: float = 0.0
    poc_generated: bool = False
    poc_valid: bool = False  # Sandbox verified
    time_seconds: float = 0.0
    gas_cost: int = 0
    reasoning: str = ""
    # For multi-reviewer systems
    num_agents_involved: int = 1
    consensus_reached: bool = True
    challenge_raised: bool = False
    sandbox_invoked: bool = False


@dataclass
class ExperimentMetrics:
    """Aggregated metrics from running a baseline on the full dataset."""
    name: str
    # Review metrics
    true_positives: int = 0
    false_positives: int = 0
    true_negatives: int = 0
    false_negatives: int = 0
    poc_success_rate: float = 0.0
    missed_vulnerability_recovery_rate: float = 0.0
    # Efficiency metrics
    total_time_seconds: float = 0.0
    avg_time_per_contract: float = 0.0
    total_gas: int = 0
    sandbox_invocation_rate: float = 0.0
    # Game theory metrics (only for EduChain)
    honest_ev: float = 0.0
    shirk_ev: float = 0.0
    sybil_cost: float = 0.0
    # Raw results
    results: list = field(default_factory=list)

    @property
    def precision(self) -> float:
        denom = self.true_positives + self.false_positives
        return self.true_positives / denom if denom > 0 else 0.0

    @property
    def recall(self) -> float:
        denom = self.true_positives + self.false_negatives
        return self.true_positives / denom if denom > 0 else 0.0

    @property
    def f1(self) -> float:
        p, r = self.precision, self.recall
        return 2 * p * r / (p + r) if (p + r) > 0 else 0.0

    @property
    def fpr(self) -> float:
        denom = self.false_positives + self.true_negatives
        return self.false_positives / denom if denom > 0 else 0.0

    @property
    def accuracy(self) -> float:
        total = self.true_positives + self.true_negatives + self.false_positives + self.false_negatives
        return (self.true_positives + self.true_negatives) / total if total > 0 else 0.0


class BaselineRunner(ABC):
    """Abstract base class for experiment runners."""

    name: str = "BaselineRunner"

    @abstractmethod
    def audit_contract(self, contract: dict) -> AuditResult:
        """Review a single student submission and return the result."""
        ...

    def run_dataset(self, dataset: list[dict], max_workers: int = 4) -> ExperimentMetrics:
        """Run the baseline on the full dataset with parallel execution."""
        metrics = ExperimentMetrics(name=self.name)
        total_poc_attempts = 0
        total_poc_success = 0
        completed_count = 0
        total_count = len(dataset)

        def _audit_one(contract: dict) -> tuple[dict, AuditResult]:
            start = time.time()
            result = self.audit_contract(contract)
            result.time_seconds = time.time() - start
            return contract, result

        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            futures = {executor.submit(_audit_one, c): c for c in dataset}
            for future in as_completed(futures):
                contract, result = future.result()
                completed_count += 1
                ground_truth = contract["has_vulnerability"]

                if result.detected_vulnerability and ground_truth:
                    metrics.true_positives += 1
                elif result.detected_vulnerability and not ground_truth:
                    metrics.false_positives += 1
                elif not result.detected_vulnerability and not ground_truth:
                    metrics.true_negatives += 1
                else:
                    metrics.false_negatives += 1

                if result.poc_generated:
                    total_poc_attempts += 1
                    if result.poc_valid:
                        total_poc_success += 1

                metrics.total_time_seconds += result.time_seconds
                metrics.total_gas += result.gas_cost
                metrics.results.append(result)

                print(f"    [{completed_count}/{total_count}] {contract['id']} "
                      f"({'flagged' if result.detected_vulnerability else 'clean'}) "
                      f"{result.time_seconds:.1f}s")

        n = len(dataset)
        metrics.avg_time_per_contract = metrics.total_time_seconds / n if n > 0 else 0
        metrics.poc_success_rate = total_poc_success / total_poc_attempts if total_poc_attempts > 0 else 0.0

        sandbox_count = sum(1 for r in metrics.results if r.sandbox_invoked)
        metrics.sandbox_invocation_rate = sandbox_count / n if n > 0 else 0.0

        return metrics
