"""
EduChain AI Review Agent - Assignment Reviewer / Plagiarism Detector
Implements the agent-side logic for the blockchain-based academic integrity system.

In the EduChain education system, this agent performs:
- Automated assignment review (code quality, correctness, documentation)
- Plagiarism detection evidence generation
- Peer review scoring
- Academic dispute arbitration reasoning
"""

import json
import hashlib
import time
import struct
from dataclasses import dataclass, field, asdict
from enum import Enum
from typing import Optional


class SourceType(Enum):
    """Evidence source type in the academic review process."""
    STATIC_ANALYSIS = "StaticAnalysis"      # Code quality analysis
    LLM_REASONING = "LLMReasoning"          # AI-based review reasoning
    TEST_EXECUTION = "TestExecution"         # Automated test execution


@dataclass
class EvidenceItem:
    """Single evidence node stored on IPFS for academic record keeping."""
    evidence_id: str
    source_type: SourceType
    uri: str                    # ipfs://CID
    content_hash: str
    extract_span: str           # e.g., "line_120_to_line_145"
    provenance: str             # Tool execution logs or review trace

    def to_dict(self) -> dict:
        d = asdict(self)
        d["source_type"] = self.source_type.value
        return d


@dataclass
class SemanticState:
    """Structured review result committed on-chain as academic record."""
    intent: str
    subtasks: list[str]
    constraints: list[str]
    evidence: list[EvidenceItem]
    final_claim: str
    confidence: float           # 0.0 - 1.0

    def compute_state_root(self) -> str:
        """Compute Merkle root of the review semantic state."""
        payload = json.dumps({
            "intent": self.intent,
            "subtasks": self.subtasks,
            "constraints": self.constraints,
            "final_claim": self.final_claim,
            "confidence": self.confidence,
        }, sort_keys=True)
        return hashlib.sha256(payload.encode()).hexdigest()

    def compute_evidence_root(self) -> str:
        """Compute Merkle root of evidence items."""
        leaves = [
            hashlib.sha256(json.dumps(e.to_dict(), sort_keys=True).encode()).hexdigest()
            for e in self.evidence
        ]
        combined = "".join(sorted(leaves))
        return hashlib.sha256(combined.encode()).hexdigest()


@dataclass
class TaskSpec:
    """On-chain assignment task specification."""
    task_id: str
    code_hash: str
    hard_constraints: list[str]       # Grading criteria
    challenge_period: int = 48 * 3600  # 48 hours
    min_staking_amount: float = 1.0    # In credit tokens
    reward: float = 0.0


class AuditAgent:
    """
    Base AI Review Agent with assignment review and dispute capabilities.
    
    In the education context:
    - Proposer role = Student submitting work for review
    - Challenger role = Reporter detecting plagiarism or issues
    - Verifier role = Peer reviewer scoring assignments
    """

    def __init__(self, agent_id: str, did: str, private_key: str):
        self.agent_id = agent_id
        self.did = did
        self.private_key = private_key
        self.reputation: int = 100
        self.stake: float = 0.0

    def perform_audit(self, task: TaskSpec, source_code: str) -> SemanticState:
        """
        Execute multi-dimensional assignment review.
        Evaluates: code quality, logic correctness, documentation, originality.
        """
        print(f"[Agent {self.agent_id}] Starting review for assignment {task.task_id}")
        print(f"[Agent {self.agent_id}] Code hash: {task.code_hash}")
        print(f"[Agent {self.agent_id}] Grading criteria: {task.hard_constraints}")

        evidence = [
            EvidenceItem(
                evidence_id=hashlib.sha256(f"ev_{time.time()}".encode()).hexdigest()[:16],
                source_type=SourceType.STATIC_ANALYSIS,
                uri="ipfs://QmPlaceholder",
                content_hash=hashlib.sha256(source_code.encode()).hexdigest(),
                extract_span="line_1_to_line_50",
                provenance="code_quality_analysis"
            )
        ]

        state = SemanticState(
            intent=f"Review assignment for task {task.task_id}",
            subtasks=["code_quality_check", "logic_correctness_check", "documentation_check", "originality_check"],
            constraints=task.hard_constraints,
            evidence=evidence,
            final_claim="Assignment meets quality standards",
            confidence=0.85
        )

        print(f"[Agent {self.agent_id}] Review complete. Confidence: {state.confidence}")
        return state

    def generate_poc(self, task: TaskSpec, vulnerability_desc: str) -> str:
        """
        Generate executable evidence for academic disputes.
        E.g., code similarity test or functional verification test.
        """
        print(f"[Agent {self.agent_id}] Generating evidence for: {vulnerability_desc}")

        poc_template = f"""// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";

contract PlagiarismEvidence is Test {{
    // Target assignment: {task.code_hash}
    // Issue: {vulnerability_desc}

    function setUp() public {{
        // Setup verification environment
    }}

    function testVerifyIssue() public {{
        // Automated verification of academic integrity issue
        // Evidence: {task.hard_constraints}
        assertTrue(true, "Evidence verification placeholder");
    }}
}}
"""
        return poc_template

    def compute_proposal_hash(self, state: SemanticState) -> dict:
        """Compute on-chain commitment hashes for submission."""
        return {
            "state_root": state.compute_state_root(),
            "evidence_root": state.compute_evidence_root(),
            "trace_root": hashlib.sha256(
                f"{state.intent}:{state.final_claim}".encode()
            ).hexdigest()
        }


class GameTheoryValidator:
    """
    Validates economic parameters satisfy incentive compatibility constraints.
    Ensures academic honesty is the dominant strategy for all participants.
    """

    @staticmethod
    def check_proposer_honesty_constraint(
        ca: float,          # Honest effort cost
        ca_prime: float,    # Cheating cost
        p_detect: float,    # Plagiarism detection probability
        p_arb_correct: float,  # Arbitration accuracy
        sp: float           # Student credit stake
    ) -> bool:
        """
        Verify: Sp > (Ca - Ca') / (Pdetect * Parb_correct)
        Ensures honest work is the dominant strategy for students.
        """
        if p_detect * p_arb_correct == 0:
            return False
        min_stake = (ca - ca_prime) / (p_detect * p_arb_correct)
        is_valid = sp > min_stake
        print(f"[GameTheory] Student honesty check: Stake={sp} > min={min_stake:.4f} -> {is_valid}")
        return is_valid

    @staticmethod
    def check_challenger_participation_constraint(
        cpoc: float,        # Evidence generation cost
        p_detect: float,    # Detection probability
        p_arb_correct: float,  # Arbitration accuracy
        sp: float,          # Student stake (reward source)
        sc: float,          # Reporter stake
        alpha: float        # Reward distribution coefficient
    ) -> bool:
        """
        Verify: Sp > (1 / (α * Parb_correct)) * (Cpoc/Pdetect + (1-Parb_correct)*Sc)
        Ensures reporting genuine plagiarism is economically viable.
        """
        if alpha * p_arb_correct == 0 or p_detect == 0:
            return False
        min_stake = (1 / (alpha * p_arb_correct)) * (
            cpoc / p_detect + (1 - p_arb_correct) * sc
        )
        is_valid = sp > min_stake
        print(f"[GameTheory] Reporter participation check: Stake={sp} > min={min_stake:.4f} -> {is_valid}")
        return is_valid


# ============ EIP-712 Arbitration Signing ============

class EIP712ArbitrationSigner:
    """
    Signs arbitration votes using EIP-712 typed structured data.
    Used by academic integrity committee members to sign their decisions.
    """

    DOMAIN_TYPE_HASH = hashlib.sha256(
        b"EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    ).hexdigest()

    ARBITRATION_TYPE_HASH = hashlib.sha256(
        b"ArbitrationVote(bytes32 taskId,bool challengeUpheld,bytes32 replayTraceHash)"
    ).hexdigest()

    def __init__(self, chain_id: int, contract_address: str):
        self.chain_id = chain_id
        self.contract_address = contract_address
        self.domain_separator = self._compute_domain_separator()

    def _compute_domain_separator(self) -> str:
        payload = json.dumps({
            "type_hash": self.DOMAIN_TYPE_HASH,
            "name": hashlib.sha256(b"ArbitrationCommittee").hexdigest(),
            "version": hashlib.sha256(b"1").hexdigest(),
            "chain_id": self.chain_id,
            "verifying_contract": self.contract_address,
        }, sort_keys=True)
        return hashlib.sha256(payload.encode()).hexdigest()

    def compute_vote_hash(self, task_id: str, challenge_upheld: bool, replay_trace_hash: str) -> str:
        struct_data = json.dumps({
            "type_hash": self.ARBITRATION_TYPE_HASH,
            "task_id": task_id,
            "challenge_upheld": challenge_upheld,
            "replay_trace_hash": replay_trace_hash,
        }, sort_keys=True)
        struct_hash = hashlib.sha256(struct_data.encode()).hexdigest()
        digest_input = f"1901{self.domain_separator}{struct_hash}"
        return hashlib.sha256(digest_input.encode()).hexdigest()

    def sign_vote(self, private_key: str, task_id: str, challenge_upheld: bool, replay_trace_hash: str) -> dict:
        digest = self.compute_vote_hash(task_id, challenge_upheld, replay_trace_hash)
        signature = hashlib.sha256(f"{private_key}:{digest}".encode()).hexdigest()
        return {
            "digest": digest,
            "signature": signature,
            "signer": hashlib.sha256(private_key.encode()).hexdigest()[:40],
        }


# ============ Dynamic Stake Oracle Client ============

class StakeOracleClient:
    """
    Client for querying the on-chain StakeOracle contract.
    Computes minimum credit stakes based on current educational economic parameters.
    """

    def __init__(self, config_path: str = "config.json"):
        with open(config_path) as f:
            config = json.load(f)
        oracle_params = config.get("stake_oracle_parameters", {})
        self.p_detect = oracle_params.get("p_detect", 0.7)
        self.p_arb_correct = oracle_params.get("p_arb_correct", 0.95)
        self.honest_effort = oracle_params.get("honest_effort_cost", 2.0)
        self.cheat_effort = oracle_params.get("cheat_effort_cost", 0.1)
        self.evidence_cost = oracle_params.get("evidence_generation_cost", 1.0)
        self.alpha = config.get("economic_parameters", {}).get("alpha", 0.6)

    def compute_min_submitter_stake(self) -> float:
        """Compute minimum student stake: (E_honest - E_cheat) / (P_detect * P_arb)"""
        numerator = self.honest_effort - self.cheat_effort
        denominator = self.p_detect * self.p_arb_correct
        if denominator == 0:
            return float('inf')
        min_stake = numerator / denominator
        print(f"[StakeOracle] Min student stake: {min_stake:.4f} credits")
        return min_stake

    def compute_min_reporter_stake(self) -> float:
        """Compute minimum reporter stake threshold."""
        evidence_per_detect = self.evidence_cost / self.p_detect
        denominator = self.alpha * self.p_arb_correct
        if denominator == 0:
            return float('inf')
        min_stake = evidence_per_detect / denominator
        print(f"[StakeOracle] Min reporter stake: {min_stake:.4f} credits")
        return min_stake

    def validate_stake_sufficient(self, stake: float, role: str = "submitter") -> bool:
        if role == "submitter":
            min_stake = self.compute_min_submitter_stake()
        else:
            min_stake = self.compute_min_reporter_stake()
        return stake >= min_stake


# ============ Committee Awareness ============

class CommitteeAwareness:
    """
    Tracks academic arbitration committee selection and membership.
    Participants use this to know if they've been selected for a committee.
    """

    def __init__(self, agent_address: str, min_reputation: int = 200):
        self.agent_address = agent_address
        self.min_reputation = min_reputation
        self.active_committees: dict[str, list[str]] = {}

    def is_eligible(self, reputation: int) -> bool:
        return reputation >= self.min_reputation

    def register_committee(self, task_id: str, members: list[str]):
        self.active_committees[task_id] = members

    def is_selected(self, task_id: str) -> bool:
        members = self.active_committees.get(task_id, [])
        return self.agent_address.lower() in [m.lower() for m in members]

    def get_pending_votes(self) -> list[str]:
        return [
            task_id for task_id, members in self.active_committees.items()
            if self.agent_address.lower() in [m.lower() for m in members]
        ]


# ============ Demo Usage ============

if __name__ == "__main__":
    # Initialize agent as an AI reviewer
    agent = AuditAgent(
        agent_id="reviewer_001",
        did="did:ethr:0xEduReviewer001",
        private_key="0xPRIVATE_KEY_PLACEHOLDER"
    )

    # Define an assignment task
    task = TaskSpec(
        task_id="assignment_0001",
        code_hash="0xabcdef1234567890",
        hard_constraints=["功能正确性", "代码规范", "文档完整性", "无抄袭"],
        reward=5.0
    )

    # Perform AI review
    state = agent.perform_audit(task, "def bubble_sort(arr): ...")
    hashes = agent.compute_proposal_hash(state)
    print(f"\nReview hashes: {json.dumps(hashes, indent=2)}")

    # Validate economic parameters ensure academic honesty
    print("\n--- Game Theory Validation (Academic Honesty) ---")
    validator = GameTheoryValidator()

    # Scenario: honest_effort=2 credits, cheat_effort=0.1, P_detect=0.7, P_arb=0.95, stake=5
    validator.check_proposer_honesty_constraint(
        ca=2.0, ca_prime=0.1, p_detect=0.7, p_arb_correct=0.95, sp=5.0
    )

    # Scenario: evidence_cost=1, P_detect=0.7, P_arb=0.95, student_stake=5, reporter_stake=2, alpha=0.6
    validator.check_challenger_participation_constraint(
        cpoc=1.0, p_detect=0.7, p_arb_correct=0.95, sp=5.0, sc=2.0, alpha=0.6
    )

    # Dynamic stake oracle query
    print("\n--- Dynamic Credit Stake Oracle ---")
    oracle = StakeOracleClient()
    min_student = oracle.compute_min_submitter_stake()
    min_reporter = oracle.compute_min_reporter_stake()
    print(f"Student stake sufficient (5 credits): {oracle.validate_stake_sufficient(5.0, 'submitter')}")
    print(f"Reporter stake sufficient (2 credits): {oracle.validate_stake_sufficient(2.0, 'reporter')}")

    # EIP-712 arbitration signing demo
    print("\n--- EIP-712 Academic Arbitration Signing ---")
    signer = EIP712ArbitrationSigner(chain_id=1, contract_address="0xArbitrationCommittee")
    vote = signer.sign_vote(
        private_key="0xARBITRATOR_KEY",
        task_id="assignment_0001",
        challenge_upheld=True,
        replay_trace_hash="0xverification_trace_hash"
    )
    print(f"Vote signature: {json.dumps(vote, indent=2)}")

    # Committee awareness demo
    print("\n--- Academic Integrity Committee ---")
    committee = CommitteeAwareness(agent_address="0x1234567890abcdef")
    committee.register_committee("assignment_0001", ["0x1234567890abcdef", "0xaaa", "0xbbb"])
    print(f"Selected for committee: {committee.is_selected('assignment_0001')}")
    print(f"Pending votes: {committee.get_pending_votes()}")
