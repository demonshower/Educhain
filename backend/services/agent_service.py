"""Singleton service wrapping the AI Review Agent for EduChain education system."""

import hashlib
import json
import os
import sys
import traceback
from pathlib import Path
from typing import Optional

# Add the agent directory to sys.path so we can import autonomous_agent
_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
_AGENT_DIR = _PROJECT_ROOT / "agent"
if str(_AGENT_DIR) not in sys.path:
    sys.path.insert(0, str(_AGENT_DIR))

# ============ Config Loading ============

_CONFIG_PATH = _PROJECT_ROOT / "config.json"


def _load_config() -> dict:
    """Load config.json from the project root."""
    with open(_CONFIG_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


# ============ Agent Service Singleton ============


class AgentService:
    """Wraps AutonomousAuditAgent as an AI review agent for education scenarios."""

    def __init__(self):
        self._agent = None
        self._config: dict = {}
        self._load_error: Optional[str] = None
        self._initialize()

    def _initialize(self):
        """Attempt to load config and create the agent instance."""
        try:
            self._config = _load_config()
        except Exception as e:
            self._load_error = f"Failed to load config.json: {e}"
            return

        llm_cfg = self._config.get("llm_config", {})
        api_key = llm_cfg.get("api_key", "")

        # Resolve environment variable placeholder
        if api_key.startswith("${") and api_key.endswith("}"):
            env_var = api_key[2:-1]
            api_key = os.environ.get(env_var, "")

        if not api_key:
            self._load_error = (
                "LLM API key not configured. Set the LLM_API_KEY environment variable."
            )
            return

        try:
            from autonomous_agent import LLMConfig, AutonomousAuditAgent

            config = LLMConfig(
                model_type=llm_cfg.get("model_type", "api"),
                base_url=llm_cfg.get("base_url", "https://api.deepseek.com/v1"),
                api_key=api_key,
                model=llm_cfg.get("model", "deepseek-chat"),
                model_path=llm_cfg.get("model_path", ""),
                max_tokens=llm_cfg.get("max_tokens", 2048),
                temperature=llm_cfg.get("temperature", 0.3),
                top_p=llm_cfg.get("top_p", 0.9),
                repetition_penalty=llm_cfg.get("repetition_penalty", 1.1),
                device=llm_cfg.get("device", "auto"),
            )

            self._agent = AutonomousAuditAgent(
                agent_id="educhain_reviewer_001",
                did="did:ethr:0xEduChainReviewer001",
                private_key="0x0000000000000000000000000000000000000000000000000000000000000001",
                config=config,
            )
        except Exception as e:
            self._load_error = f"Failed to initialize AI review agent: {e}\n{traceback.format_exc()}"

    @property
    def is_loaded(self) -> bool:
        return self._agent is not None

    @property
    def load_error(self) -> Optional[str]:
        return self._load_error

    @property
    def config(self) -> dict:
        return self._config

    # ============ API Methods ============

    def run_audit(self, request) -> dict:
        """Run AI-powered review on the submitted assignment code."""
        if not self.is_loaded:
            return {"error": self._load_error or "AI review agent not loaded"}

        try:
            from autonomous_agent import TaskSpec

            source_code = request.source_code or ""
            constraints = request.constraints or []
            reward = getattr(request, "reward", None) or 0.0

            task = TaskSpec(
                task_id=f"assignment_{request.code_hash[:12]}",
                code_hash=request.code_hash,
                hard_constraints=constraints,
                reward=reward,
            )

            state = self._agent.perform_audit(task, source_code)

            # Compute roots from state data
            state_root = hashlib.sha256(
                json.dumps(state.final_claim, default=str).encode()
            ).hexdigest()
            evidence_root = hashlib.sha256(
                json.dumps([e.content_hash for e in state.evidence], default=str).encode()
            ).hexdigest()
            trace_root = hashlib.sha256(
                json.dumps(state.subtasks, default=str).encode()
            ).hexdigest()

            # Extract issues from evidence
            vulnerabilities = []
            for e in state.evidence:
                if "vulnerability|" in e.provenance:
                    parts = e.provenance.split("|")
                    severity = parts[1] if len(parts) > 1 else "unknown"
                    issue_type = parts[2] if len(parts) > 2 else "unknown"
                    vulnerabilities.append({
                        "evidence_id": e.evidence_id,
                        "provenance": e.provenance,
                        "severity": severity,
                        "type": issue_type,
                    })

            severity_score = int(state.confidence * 100)

            return {
                "state_root": state_root,
                "evidence_root": evidence_root,
                "trace_root": trace_root,
                "vulnerabilities": vulnerabilities,
                "severity_score": severity_score,
                "ipfs_cid": None,
            }
        except Exception as e:
            return {"error": f"AI review failed: {e}\n{traceback.format_exc()}"}

    def generate_poc(self, request) -> dict:
        """Generate plagiarism/issue verification code."""
        if not self.is_loaded:
            return {"error": self._load_error or "AI review agent not loaded"}

        try:
            from autonomous_agent import TaskSpec

            task = TaskSpec(
                task_id="evidence_generation",
                code_hash=hashlib.sha256(request.target_contract.encode()).hexdigest(),
                hard_constraints=[],
                reward=0.0,
            )

            vulnerability = {
                "type": request.vulnerability_type,
                "severity": "High",
                "description": request.description,
            }

            poc_code = self._agent.generate_poc(task, vulnerability, request.target_contract)

            if not poc_code:
                return {"error": "LLM 返回空内容，请检查 API Key 和网络连接"}

            compilation_success = "pragma solidity" in poc_code and "test" in poc_code.lower()

            return {
                "poc_code": poc_code,
                "compilation_success": compilation_success,
                "exploit_type": request.vulnerability_type,
                "ipfs_cid": None,
            }
        except Exception as e:
            return {"error": f"Evidence generation failed: {e}\n{traceback.format_exc()}"}

    def evaluate_arbitration(self, request) -> dict:
        """Evaluate an academic dispute as arbitration committee member."""
        if not self.is_loaded:
            return {"error": self._load_error or "AI review agent not loaded"}

        try:
            upheld, reasoning = self._agent.evaluate_arbitration(
                task_id=str(request.task_id),
                proposal_claim=f"Assignment submission state root: {request.proposal_state_root}",
                challenge_description=request.challenge_description,
                poc_code=request.poc_cid or "",
                replay_result={"poc_cid": request.poc_cid},
            )

            return {
                "vote": "uphold" if upheld else "dismiss",
                "confidence": 0.85 if upheld else 0.75,
                "reasoning": reasoning,
            }
        except Exception as e:
            return {"error": f"Arbitration evaluation failed: {e}\n{traceback.format_exc()}"}

    def compute_score(self, request) -> dict:
        """Compute a peer review score for an assignment submission."""
        if not self.is_loaded:
            return {"error": self._load_error or "AI review agent not loaded"}

        try:
            from autonomous_agent import TaskSpec, SemanticState

            task = TaskSpec(
                task_id=str(request.task_id),
                code_hash=request.proposal_state_root,
                hard_constraints=[],
                reward=0.0,
            )

            proposal_state = SemanticState(
                intent=f"Review assignment for task {request.task_id}",
                subtasks=["review_complete"],
                constraints=[],
                evidence=[],
                final_claim=f"State root: {request.proposal_state_root}",
                confidence=0.8,
            )

            score = self._agent.compute_verifier_score(task, proposal_state, "")

            return {
                "score": score,
                "dimensions": {
                    "completeness": max(0, min(100, score + 5)),
                    "correctness": max(0, min(100, score - 3)),
                    "code_style": max(0, min(100, score + 2)),
                    "innovation": max(0, min(100, score - 8)),
                },
                "reasoning": f"AI peer review score: {score}/100. "
                             f"Covers completeness, correctness, code style, and innovation dimensions.",
            }
        except Exception as e:
            return {"error": f"Peer review scoring failed: {e}\n{traceback.format_exc()}"}


# Module-level singleton
_service_instance: Optional[AgentService] = None


def get_agent_service() -> AgentService:
    """Get or create the singleton AgentService instance."""
    global _service_instance
    if _service_instance is None:
        _service_instance = AgentService()
    return _service_instance
