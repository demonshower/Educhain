"""
EduChain Autonomous Review Agent - LLM-Powered Educational Assessment Agent

Uses LLM (DeepSeek/Kimi) to perform:
- Automated assignment code review and quality assessment (代码评审)
- Plagiarism evidence generation with compiler-in-the-loop (抄袭证据生成)
- Academic dispute arbitration reasoning (学术争议仲裁推理)
- Dynamic review depth adaptation based on assignment weight (动态评审深度)

Integrates with the EduChain blockchain-based smart education system.
Core functions in education context:
- perform_audit() → Review student assignment for quality and correctness
- generate_poc() → Generate plagiarism/issue verification code
- evaluate_arbitration() → Reason about academic integrity disputes
- compute_verifier_score() → Compute peer review quality score
"""

import json
import hashlib
import time
import subprocess
import os
import re
from dataclasses import dataclass, field, asdict
from enum import Enum
from typing import Optional
from pathlib import Path

import requests

from audit_agent import (
    SourceType, EvidenceItem, SemanticState, TaskSpec,
    AuditAgent, GameTheoryValidator, StakeOracleClient,
    EIP712ArbitrationSigner, CommitteeAwareness,
)


# ============ LLM Configuration ============

@dataclass
class LLMConfig:
    model_type: str = "api"        # "api" or "local"
    base_url: str = "https://api.deepseek.com/v1"
    api_key: str = ""              # Set via LLM_API_KEY env var / config.json
    model: str = "deepseek-chat"
    model_path: str = ""           # Local model path/HF repo (for model_type="local")
    max_tokens: int = 2048
    temperature: float = 0.3
    top_p: float = 0.9
    repetition_penalty: float = 1.1
    device: str = "auto"           # "auto", "cuda", "cpu"

    @classmethod
    def from_file(cls, path: str = "config.json") -> "LLMConfig":
        """Load LLM config from config file if available."""
        try:
            with open(path) as f:
                data = json.load(f)
            llm = data.get("llm_config", {})
            return cls(
                model_type=llm.get("model_type", cls.model_type),
                base_url=llm.get("base_url", cls.base_url),
                api_key=llm.get("api_key", cls.api_key),
                model=llm.get("model", cls.model),
                model_path=llm.get("model_path", cls.model_path),
                max_tokens=llm.get("max_tokens", cls.max_tokens),
                temperature=llm.get("temperature", cls.temperature),
                top_p=llm.get("top_p", cls.top_p),
                repetition_penalty=llm.get("repetition_penalty", cls.repetition_penalty),
                device=llm.get("device", cls.device),
            )
        except (FileNotFoundError, json.JSONDecodeError):
            return cls()


# ============ Economic Rationality ============

@dataclass
class EconomicContext:
    """Encapsulates all economic parameters for a single decision."""
    reward: float
    proposer_stake: float
    challenger_stake: float
    audit_cost: float
    poc_cost: float
    p_detect: float
    p_arb_correct: float
    alpha: float
    reputation: int
    reputation_point_value_eth: float = 0.01
    p_vuln_exists: float = 0.3

    @property
    def reward_stake_ratio(self) -> float:
        """Ratio of reward to proposer stake — drives audit depth."""
        if self.proposer_stake == 0:
            return 0.0
        return self.reward / self.proposer_stake

    @property
    def expected_proposer_profit(self) -> float:
        """EV = reward - audit_cost - P(false_slash) * stake + reputation_value."""
        p_false_slash = self.p_vuln_exists * self.p_detect * (1 - self.p_arb_correct)
        reputation_value = self.reputation * self.reputation_point_value_eth
        return (self.reward - self.audit_cost
                - p_false_slash * self.proposer_stake
                + reputation_value)

    @property
    def expected_challenger_profit(self) -> float:
        """EV_challenge = alpha * Sp * P(arb_correct) - poc_cost - (1 - P(arb_correct)) * Sc."""
        return (self.alpha * self.proposer_stake * self.p_arb_correct
                - self.poc_cost
                - (1 - self.p_arb_correct) * self.challenger_stake)


@dataclass
class AuditStrategy:
    """Audit strategy derived from economic context — maps reward/stake ratio to depth."""
    depth_level: int              # 1-4
    analysis_rounds: int
    vulnerability_search_passes: int
    use_multi_turn: bool
    max_tokens_per_call: int
    compiler_loop_iterations: int
    confidence_threshold: float

    @classmethod
    def from_economic_context(cls, ctx: EconomicContext, min_depth: int = 1) -> "AuditStrategy":
        """Map reward_stake_ratio to one of 4 depth levels."""
        ratio = ctx.reward_stake_ratio

        if ratio >= 2.0:
            level, rounds, passes, multi, tokens, loops, conf = 4, 2, 2, False, 2048, 2, 0.7
        elif ratio >= 1.0:
            level, rounds, passes, multi, tokens, loops, conf = 3, 1, 2, False, 2048, 2, 0.75
        elif ratio >= 0.5:
            level, rounds, passes, multi, tokens, loops, conf = 2, 1, 1, False, 2048, 2, 0.8
        else:
            level, rounds, passes, multi, tokens, loops, conf = 1, 1, 1, False, 1536, 1, 0.85

        # Enforce minimum depth
        if level < min_depth:
            level = min_depth
            if min_depth >= 2:
                rounds, tokens, loops = max(rounds, 1), max(tokens, 2048), max(loops, 2)
            if min_depth >= 3:
                passes, multi, loops = max(passes, 2), False, max(loops, 2)
            if min_depth >= 4:
                rounds, passes, tokens, loops = 2, 2, 2048, 2

        return cls(
            depth_level=level,
            analysis_rounds=rounds,
            vulnerability_search_passes=passes,
            use_multi_turn=multi,
            max_tokens_per_call=tokens,
            compiler_loop_iterations=loops,
            confidence_threshold=conf,
        )


# ============ LLM Client ============

class LLMClient:
    """Anthropic-compatible API client for DeepSeek / LLM providers."""

    def __init__(self, config: Optional[LLMConfig] = None):
        self.config = config or LLMConfig()
        self.session = requests.Session()
        self.session.headers.update({
            "x-api-key": self.config.api_key,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
            "User-Agent": "Mozilla/5.0 (EduChain-Agent/1.0)",
            "Accept": "application/json",
        })
        self.conversation_history: list[dict] = []

    def _call_via_curl(self, url: str, payload: dict) -> dict:
        """Fallback: call LLM API via curl subprocess (bypasses Python HTTP issues)."""
        import subprocess
        data = json.dumps(payload)
        try:
            result = subprocess.run(
                ["curl", "-s", "-m", "60", url,
                 "-H", f"x-api-key: {self.config.api_key}",
                 "-H", "anthropic-version: 2023-06-01",
                 "-H", "Content-Type: application/json",
                 "-d", data],
                capture_output=True, timeout=65,
            )
            return json.loads(result.stdout)
        except Exception:
            return {}

    def _extract_text(self, data: dict) -> str:
        """Extract text from Anthropic response, skipping thinking blocks."""
        if "content" in data:
            for item in data["content"]:
                if isinstance(item, dict) and item.get("type") == "text":
                    return item.get("text", "").strip()
        # Fallback: try OpenAI format
        if "choices" in data and len(data["choices"]) > 0:
            choice = data["choices"][0]
            msg = choice.get("message", {})
            content = msg.get("content", "")
            if content:
                return content.strip()
        return ""

    @staticmethod
    def _strip_markdown(text: str) -> str:
        """Strip markdown code block wrappers (```json ... ```) from LLM output."""
        import re as _re
        text = text.strip()
        # Strip leading ```json or ``` and trailing ```
        text = _re.sub(r'^```(?:json)?\s*\n', '', text)
        text = _re.sub(r'\n```\s*$', '', text)
        return text.strip()

    def chat(
        self,
        messages: list[dict],
        temperature: Optional[float] = None,
        max_tokens: Optional[int] = None,
        json_mode: bool = False,
    ) -> str:
        """Send a chat completion request using Anthropic Messages API format."""
        # Extract system message; Anthropic puts it as a top-level field
        system_prompt = ""
        api_messages = []
        for msg in messages:
            if msg["role"] == "system":
                system_prompt = msg["content"] if isinstance(msg["content"], str) else str(msg["content"])
            elif msg["role"] in ("user", "assistant"):
                api_messages.append({"role": msg["role"], "content": msg["content"]})

        payload = {
            "model": self.config.model,
            "messages": api_messages,
            "temperature": temperature if temperature is not None else self.config.temperature,
            "max_tokens": max_tokens if max_tokens is not None else self.config.max_tokens,
            "thinking": {"type": "disabled"},
        }
        if system_prompt:
            payload["system"] = system_prompt

        # Append JSON instruction to last message if needed
        if json_mode and api_messages:
            last_msg = api_messages[-1]
            if isinstance(last_msg["content"], str):
                last_msg["content"] = last_msg["content"] + "\n\nReturn ONLY valid JSON. No markdown, no explanation outside the JSON."

        url = f"{self.config.base_url}/messages"
        try:
            resp = self.session.post(url, json=payload, timeout=120)
            resp.raise_for_status()
            data = resp.json()
            text = self._extract_text(data)
            if not text:
                print(f"[LLM] WARNING: no text content, types: {[c.get('type','?') for c in data.get('content',[])]}")
                return ""
            text = self._strip_markdown(text)
            return text
        except requests.exceptions.RequestException as e:
            print(f"[LLM] requests failed ({e}), trying curl fallback...")
            data = self._call_via_curl(url, payload)
            text = self._extract_text(data)
            if not text:
                print(f"[LLM] curl also failed, data: {list(data.keys()) if data else 'EMPTY'}")
                return ""
            text = self._strip_markdown(text)
            return text
        except (KeyError, IndexError) as e:
            print(f"[LLM] Unexpected response format: {e}")
            return ""

    def ask(self, prompt: str, system: str = "", **kwargs) -> str:
        """Simple single-turn query."""
        messages = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})
        return self.chat(messages, **kwargs)

    def multi_turn(self, user_msg: str, system: str = "") -> str:
        """Continue a multi-turn conversation."""
        if not self.conversation_history and system:
            self.conversation_history.append({"role": "system", "content": system})
        self.conversation_history.append({"role": "user", "content": user_msg})
        response = self.chat(self.conversation_history)
        self.conversation_history.append({"role": "assistant", "content": response})
        return response

    def reset_conversation(self):
        """Clear conversation history."""
        self.conversation_history = []


# ============ Local LLM Client (transformers) ============

class LocalLLMClient:
    """Local LLM client using HuggingFace transformers (e.g., MetaTrustSig/13b_reasoner)."""

    def __init__(self, config: Optional[LLMConfig] = None):
        self.config = config or LLMConfig()
        self._model = None
        self._tokenizer = None
        self._device = None
        self.conversation_history: list[dict] = []

    def _ensure_loaded(self):
        """Lazy-load the model and tokenizer."""
        if self._model is not None:
            return

        model_path = self.config.model_path or self.config.model
        print(f"[LocalLLM] Loading model from {model_path} ...")

        try:
            from transformers import AutoTokenizer, AutoModelForCausalLM
            import torch
        except ImportError as e:
            raise ImportError(
                "Local model requires transformers and torch. "
                "Install with: pip install transformers torch"
            ) from e

        # Tokenizer
        self._tokenizer = AutoTokenizer.from_pretrained(model_path, trust_remote_code=True)
        if self._tokenizer.eos_token is None:
            self._tokenizer.add_special_tokens({
                'eos_token': '</s>', 'bos_token': '<s>',
                'unk_token': '<unk>', 'pad_token': '<pad>',
            })
        if self._tokenizer.pad_token is None:
            self._tokenizer.pad_token = self._tokenizer.eos_token

        # Device
        device_cfg = self.config.device
        if device_cfg == "auto":
            import torch
            self._device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
        else:
            import torch
            self._device = torch.device(device_cfg)

        # Model
        import torch
        dtype = torch.float16 if self._device.type == 'cuda' else torch.float32
        self._model = AutoModelForCausalLM.from_pretrained(
            model_path,
            torch_dtype=dtype,
            device_map="auto" if self._device.type == 'cuda' else None,
            trust_remote_code=True,
        )
        if self._device.type == 'cpu':
            self._model.to(self._device)
        self._model.resize_token_embeddings(len(self._tokenizer))
        self._model.eval()

        print(f"[LocalLLM] Model loaded on {self._device} ({'fp16' if dtype == torch.float16 else 'fp32'})")

    def chat(
        self,
        messages: list[dict],
        temperature: Optional[float] = None,
        max_tokens: Optional[int] = None,
        json_mode: bool = False,
    ) -> str:
        """Generate a response using the local model."""
        self._ensure_loaded()
        import torch

        # Build prompt via chat template
        msgs = list(messages)  # copy to avoid mutating caller
        if json_mode and msgs:
            last = msgs[-1]
            if isinstance(last.get("content"), str):
                last["content"] = last["content"] + "\n\nReturn ONLY valid JSON. No markdown, no explanation outside the JSON."
                msgs[-1] = last

        try:
            prompt = self._tokenizer.apply_chat_template(msgs, tokenize=False, add_generation_prompt=True)
        except Exception:
            # Fallback: manual formatting
            prompt = self._format_messages_manual(msgs)

        inputs = self._tokenizer(prompt, return_tensors="pt").to(self._device)
        input_len = inputs['input_ids'].shape[1]

        temp = temperature if temperature is not None else self.config.temperature
        max_tok = max_tokens if max_tokens is not None else self.config.max_tokens

        with torch.no_grad():
            outputs = self._model.generate(
                input_ids=inputs['input_ids'],
                attention_mask=inputs['attention_mask'],
                max_new_tokens=max_tok,
                do_sample=True,
                temperature=temp,
                top_p=self.config.top_p,
                repetition_penalty=self.config.repetition_penalty,
                eos_token_id=self._tokenizer.eos_token_id,
                pad_token_id=self._tokenizer.pad_token_id,
            )

        # Decode only the generated part (skip input tokens)
        generated_ids = outputs[0][input_len:]
        text = self._tokenizer.decode(generated_ids, skip_special_tokens=True).strip()

        # Strip markdown wrappers if needed
        text = LLMClient._strip_markdown(text)
        return text

    def _format_messages_manual(self, messages: list[dict]) -> str:
        """Manual prompt formatting fallback."""
        parts = []
        for msg in messages:
            role = msg["role"]
            content = msg.get("content", "")
            if role == "system":
                parts.append(f"<|system|>\n{content}\n")
            elif role == "user":
                parts.append(f"<|user|>\n{content}\n")
            elif role == "assistant":
                parts.append(f"<|assistant|>\n{content}\n")
        parts.append("<|assistant|>\n")
        return "\n".join(parts)

    def ask(self, prompt: str, system: str = "", **kwargs) -> str:
        """Simple single-turn query."""
        messages = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})
        return self.chat(messages, **kwargs)

    def multi_turn(self, user_msg: str, system: str = "") -> str:
        """Continue a multi-turn conversation."""
        if not self.conversation_history and system:
            self.conversation_history.append({"role": "system", "content": system})
        self.conversation_history.append({"role": "user", "content": user_msg})
        response = self.chat(self.conversation_history)
        self.conversation_history.append({"role": "assistant", "content": response})
        return response

    def reset_conversation(self):
        """Clear conversation history."""
        self.conversation_history = []


# ============ Client Factory ============

def create_llm_client(config: Optional[LLMConfig] = None) -> object:
    """Create the appropriate LLM client based on config.model_type."""
    cfg = config or LLMConfig()
    if cfg.model_type == "local":
        return LocalLLMClient(cfg)
    else:
        return LLMClient(cfg)


# ============ Autonomous Audit Agent ============

AUDIT_SYSTEM_PROMPT = """You are an AI teaching assistant for a smart education system (智慧教育).
You review student-submitted code assignments for quality, correctness, and academic integrity.

Your review dimensions include:
- Code correctness and logic soundness
- Code style and documentation quality
- Algorithm efficiency and design patterns
- Plagiarism indicators (unusual code patterns, inconsistent style)
- Compliance with assignment requirements (hard constraints)
- Innovation and creative problem-solving

When reviewing code:
1. Identify the code's purpose and key functionality
2. Check correctness against the assignment requirements
3. Assess code quality (naming, comments, structure, error handling)
4. Look for plagiarism indicators (copy-paste patterns, style inconsistencies)
5. Assign severity levels (Critical/High/Medium/Low/Informational)
6. Provide constructive feedback for improvement

Output structured JSON when asked for structured analysis."""

POC_SYSTEM_PROMPT = """You are an expert at writing automated test code to verify academic integrity issues.
You write complete, compilable Foundry test contracts that demonstrate plagiarism or code issues.

In the education context, your "exploits" prove:
- Code similarity between a student's submission and a known source
- Functional incorrectness (code doesn't match claimed behavior)
- Violation of assignment constraints

Rules:
- Use forge-std/Test.sol as the base
- Include setUp() and testVerifyIssue() functions
- Use proper assertions to prove the issue concretely
- Assert concrete outcomes (similarity > threshold, function behavior mismatch)
- Keep tests minimal and focused on the specific issue"""

ARBITRATION_SYSTEM_PROMPT = """You are an academic integrity arbitration committee member for a blockchain-based smart education system.
You must evaluate academic disputes including plagiarism accusations and grade challenges.

You evaluate:
1. The original submission (what the student claimed about their work)
2. The challenger's evidence (e.g., plagiarism proof, functional test failures)
3. The sandbox verification results (automated code comparison/test execution)

Based on the evidence, determine if the challenge should be UPHELD (academic dishonesty confirmed)
or DISMISSED (accusation unfounded, student's work is original).

Provide your reasoning step by step, then give a final verdict."""


class AutonomousAuditAgent:
    """
    LLM-powered autonomous AI review agent for the EduChain smart education system.
    
    In the education context, this agent:
    - Reviews student code submissions for quality and correctness
    - Detects potential plagiarism and generates verification evidence
    - Participates in academic dispute arbitration
    - Adapts review depth based on assignment weight (credit incentives)
    
    Operates within the blockchain-based academic integrity framework where
    all review records are immutably stored on-chain.
    """

    def __init__(
        self,
        agent_id: str,
        did: str,
        private_key: str,
        config: Optional[LLMConfig] = None,
        work_dir: str = "/tmp/agent_workspace",
    ):
        self.agent_id = agent_id
        self.did = did
        self.private_key = private_key
        self.work_dir = Path(work_dir)
        self.work_dir.mkdir(parents=True, exist_ok=True)

        # Core components
        self.llm = create_llm_client(config)
        self.base_agent = AuditAgent(agent_id, did, private_key)
        config_path = str(Path(__file__).parent.parent / "config.json")
        self.stake_oracle = StakeOracleClient(config_path=config_path)
        self.committee = CommitteeAwareness(agent_address=did)
        self.signer = None  # Initialized when chain info is available

        # State tracking
        self.audit_history: list[dict] = []
        self.active_tasks: dict[str, dict] = {}

        # Load rationality parameters
        try:
            with open(config_path) as f:
                full_config = json.load(f)
            self._rationality = full_config.get("rationality_parameters", {})
        except (FileNotFoundError, json.JSONDecodeError):
            self._rationality = {}

    # ============ Economic Rationality Helpers ============

    def _build_economic_context(self, task: TaskSpec) -> EconomicContext:
        """Build EconomicContext from task, stake oracle, and config."""
        reward = task.reward
        if reward == 0:
            reward = self._rationality.get("default_reward_when_unspecified", 2.0)

        return EconomicContext(
            reward=reward,
            proposer_stake=self.base_agent.stake,
            challenger_stake=self.base_agent.stake,
            audit_cost=self.stake_oracle.honest_effort,
            poc_cost=self.stake_oracle.evidence_cost,
            p_detect=self.stake_oracle.p_detect,
            p_arb_correct=self.stake_oracle.p_arb_correct,
            alpha=self.stake_oracle.alpha,
            reputation=self.base_agent.reputation,
            reputation_point_value_eth=self._rationality.get("reputation_point_value", 0.01),
            p_vuln_exists=self._rationality.get("p_plagiarism_prior", 0.1),
        )

    # ============ Phase 2: LLM-Powered Audit ============

    def perform_audit(self, task: TaskSpec, contract_source: str) -> SemanticState:
        """Review a student assignment using LLM reasoning, depth driven by assignment weight."""
        print(f"[Agent {self.agent_id}] Starting LLM-powered review for {task.task_id}")

        # Step 0: Determine review strategy from economic context (assignment weight)
        ctx = self._build_economic_context(task)
        min_depth = self._rationality.get("min_depth_level", 1)
        strategy = AuditStrategy.from_economic_context(ctx, min_depth=min_depth)
        print(f"[Agent {self.agent_id}] Incentive: reward={ctx.reward:.2f} credits, "
              f"stake={ctx.proposer_stake:.2f} credits, ratio={ctx.reward_stake_ratio:.2f} "
              f"-> review depth level {strategy.depth_level}/4")

        # Step 1: Initial analysis (with strategy-aware tokens)
        analysis = self._analyze_contract(contract_source, task.hard_constraints, strategy)

        # Step 2: Multi-pass issue search across education review dimensions
        vulnerabilities = []
        vuln_categories = [
            ["correctness_bug", "logic_error", "edge_case_handling"],
            ["plagiarism_indicator", "style_inconsistency", "copy_paste_pattern"],
            ["code_quality", "documentation_missing", "poor_naming"],
        ]
        for pass_idx in range(strategy.vulnerability_search_passes):
            focus = vuln_categories[pass_idx % len(vuln_categories)]
            found = self._search_vulnerabilities(contract_source, analysis, strategy, focus)
            vulnerabilities.extend(found)

        # Deduplicate by type+location
        seen = set()
        unique_vulns = []
        for v in vulnerabilities:
            key = (v.get("type", ""), v.get("location", ""))
            if key not in seen:
                seen.add(key)
                unique_vulns.append(v)
        vulnerabilities = unique_vulns

        # Step 3: Hard constraint verification (always runs regardless of depth)
        constraint_results = self._verify_hard_constraints(contract_source, task.hard_constraints)
        for cr in constraint_results:
            if cr.get("violated"):
                vulnerabilities.append({
                    "type": "constraint_violation",
                    "severity": "Critical",
                    "location": cr.get("location", "unknown"),
                    "description": cr.get("description", ""),
                    "constraint_violated": cr.get("constraint"),
                })

        # Step 4: Multi-turn follow-up (depth 3-4 only)
        if strategy.use_multi_turn and vulnerabilities:
            self.llm.reset_conversation()
            followup = self.llm.multi_turn(
                f"I found these potential issues in a student code assignment. "
                f"For each, assess how serious it is for grading and estimate severity:\n"
                f"{json.dumps(vulnerabilities[:5], indent=2, default=str)}",
                system=AUDIT_SYSTEM_PROMPT,
            )
            # Parse any upgraded severities from the follow-up
            try:
                refined = json.loads(followup)
                if isinstance(refined, list):
                    for i, r in enumerate(refined):
                        if i < len(vulnerabilities) and r.get("severity"):
                            vulnerabilities[i]["severity"] = r["severity"]
            except (json.JSONDecodeError, TypeError):
                pass  # Keep original severities

        # Step 5: Generate evidence items
        evidence = self._build_evidence(contract_source, analysis, vulnerabilities)

        # Step 6: Determine final claim and confidence
        final_claim, confidence = self._determine_verdict(
            analysis, vulnerabilities, task.hard_constraints
        )

        state = SemanticState(
            intent=f"Comprehensive assignment review for task {task.task_id}",
            subtasks=[
                "static_analysis",
                "llm_issue_search",
                "requirement_verification",
                "plagiarism_assessment",
            ],
            constraints=task.hard_constraints,
            evidence=evidence,
            final_claim=final_claim,
            confidence=confidence,
        )

        self.audit_history.append({
            "task_id": task.task_id,
            "timestamp": time.time(),
            "confidence": confidence,
            "vulnerabilities_found": len(vulnerabilities),
            "depth_level": strategy.depth_level,
            "reward_stake_ratio": ctx.reward_stake_ratio,
        })

        print(f"[Agent {self.agent_id}] Review complete. "
              f"Found {len(vulnerabilities)} issues. Confidence: {confidence:.2f}")
        return state

    def _analyze_contract(self, source: str, constraints: list[str], strategy: Optional[AuditStrategy] = None) -> dict:
        """Initial assignment analysis via LLM, depth-aware."""
        depth_instructions = {
            1: "Focus on critical correctness issues only. Skip minor style findings.",
            2: "Standard review depth. Cover correctness and major quality categories.",
            3: "Thorough review. Examine logic flow, edge cases, and plagiarism indicators.",
            4: "Maximum depth. Analyze all paths, edge cases, originality and design quality.",
        }
        depth_level = strategy.depth_level if strategy else 2
        max_tokens = strategy.max_tokens_per_call if strategy else 4096

        economic_context_block = ""
        if strategy:
            economic_context_block = f"""

[INCENTIVE CONTEXT]
- Review depth: Level {depth_level}/4
- Level {depth_level} instruction: {depth_instructions[depth_level]}
- MANDATORY: Verify all assignment requirements regardless of depth: {json.dumps(constraints)}
"""

        prompt = f"""Analyze this student code submission. Identify:
1. The code's purpose and key functionality
2. Whether it implements the required features correctly
3. Key properties/requirements that should hold

Assignment requirements: {json.dumps(constraints)}

Submitted code:
```
{source[:3000]}
```
{economic_context_block}
JSON keys: purpose, mechanisms, correctness_notes, originality_notes, requirements_coverage"""

        response = self.llm.ask(prompt, system=AUDIT_SYSTEM_PROMPT, json_mode=True, max_tokens=max_tokens)
        try:
            return json.loads(response)
        except json.JSONDecodeError:
            return {"purpose": "analysis_failed", "raw": response[:500]}

    def _search_vulnerabilities(self, source: str, analysis: dict, strategy: Optional[AuditStrategy] = None, focus_categories: Optional[list[str]] = None) -> list[dict]:
        """Deep issue search using LLM, optionally focused on specific review categories."""
        max_tokens = strategy.max_tokens_per_call if strategy else 4096

        focus_instruction = ""
        if focus_categories:
            focus_instruction = f"\nFocus this pass on: {', '.join(focus_categories)}\n"

        prompt = f"""Find issues in this student code submission (bugs, plagiarism indicators, quality problems).
{focus_instruction}
Analysis context:
{json.dumps({k: v for k, v in analysis.items() if k in ("purpose", "correctness_notes", "originality_notes")}, default=str)}

Submitted code:
```
{source[:3000]}
```

For each issue: type, severity (Critical/High/Medium/Low), location, description, impact_on_grade.
JSON array of issue objects."""

        response = self.llm.ask(prompt, system=AUDIT_SYSTEM_PROMPT, json_mode=True, max_tokens=max_tokens)
        try:
            data = json.loads(response)
            if isinstance(data, list):
                return data
            return data.get("vulnerabilities", data.get("issues", []))
        except json.JSONDecodeError:
            preview = response[:200].replace("\n", "\\n") if response else "EMPTY"
            print(f"[Agent] _search_vulnerabilities: JSON parse failed, preview: {preview}")
            return []

    def _verify_hard_constraints(self, source: str, constraints: list[str]) -> list[dict]:
        """Verify assignment requirements regardless of review depth (quality floor)."""
        if not constraints:
            return []

        prompt = f"""Verify these assignment requirements against the submitted code. For each: satisfied/violated, location, brief reason.

Requirements: {json.dumps(constraints)}

Submitted code:
```
{source[:2000]}
```

JSON array, each item: constraint, satisfied (bool), violated (bool), location, description."""

        response = self.llm.ask(prompt, system=AUDIT_SYSTEM_PROMPT, json_mode=True, max_tokens=2048)
        try:
            data = json.loads(response)
            if isinstance(data, list):
                return data
            return data.get("constraints", [])
        except json.JSONDecodeError:
            return []

    def _build_evidence(
        self, source: str, analysis: dict, vulnerabilities: list[dict]
    ) -> list[EvidenceItem]:
        """Build evidence items from analysis results."""
        evidence = []

        # LLM analysis evidence
        analysis_hash = hashlib.sha256(
            json.dumps(analysis, sort_keys=True, default=str).encode()
        ).hexdigest()
        evidence.append(EvidenceItem(
            evidence_id=analysis_hash[:16],
            source_type=SourceType.LLM_REASONING,
            uri=f"ipfs://Qm{analysis_hash[:44]}",
            content_hash=analysis_hash,
            extract_span="full_contract",
            provenance=f"llm-review analysis at {time.time():.0f}",
        ))

        # Per-vulnerability evidence — only Critical/High make it in
        for i, vuln in enumerate(vulnerabilities):
            if vuln.get("severity") not in ("Critical", "High"):
                continue
            vuln_hash = hashlib.sha256(
                json.dumps(vuln, sort_keys=True, default=str).encode()
            ).hexdigest()
            evidence.append(EvidenceItem(
                evidence_id=vuln_hash[:16],
                source_type=SourceType.LLM_REASONING,
                uri=f"ipfs://Qm{vuln_hash[:44]}",
                content_hash=vuln_hash,
                extract_span=vuln.get("location", f"vuln_{i}"),
                provenance=f"vulnerability|{vuln.get('severity', 'unknown')}|{vuln.get('type', 'unknown')}",
            ))

        return evidence

    def _determine_verdict(
        self, analysis: dict, vulnerabilities: list[dict], constraints: list[str]
    ) -> tuple[str, float]:
        """Determine final review verdict and confidence."""
        critical = [v for v in vulnerabilities if v.get("severity") == "Critical"]
        high = [v for v in vulnerabilities if v.get("severity") == "High"]

        if critical:
            claim = (f"CRITICAL issues found: {len(critical)} critical, "
                     f"{len(high)} high severity issues detected in the submission")
            confidence = 0.9
        elif high:
            claim = (f"HIGH severity issues found: {len(high)} issues require attention")
            confidence = 0.8
        elif vulnerabilities:
            claim = (f"Minor issues found: {len(vulnerabilities)} low/medium findings")
            confidence = 0.75
        else:
            claim = "Submission meets requirements; no significant issues detected"
            confidence = 0.85

        # Adjust confidence based on constraint coverage
        constraint_violations = [
            v for v in vulnerabilities if v.get("constraint_violated")
        ]
        if constraint_violations:
            confidence = min(0.95, confidence + 0.05)

        return claim, confidence

    # ============ Phase 4b: Invariant Test Generation (Bidirectional PoC) ============

    INVARIANT_SYSTEM_PROMPT = """You are an expert at writing Foundry invariant tests for Solidity smart contracts.
Invariant tests express safety properties that must ALWAYS hold regardless of the
sequence of external calls made to the contract.  Foundry will fuzz random call
sequences and check these properties after every step.

Rules:
- The contract MUST be named exactly InvariantTest and inherit from Test.
- Deploy the target contract in setUp().
- Each invariant function MUST be named with the prefix invariant_
  (e.g. invariant_balanceNeverExceedsDeposit).
- Each invariant function checks ONE concrete safety property and reverts if violated.
- Import the target from "../src/Target.sol".
- Do NOT use vm.assume — let the fuzzer explore freely.
- Keep invariants minimal and directly tied to the supplied hard constraints."""

    def generate_invariant_test(
        self, task: "TaskSpec", contract_source: str
    ) -> str:
        """Generate a Foundry invariant test from the task's hard constraints via LLM.

        The generated test is used for bidirectional verification: the sandbox
        runs it with fuzz testing so that a 'safe' verdict is only issued when
        the invariants provably hold across many randomised call sequences.

        Returns:
            Solidity source of the InvariantTest contract, or empty string on failure.
        """
        print(
            f"[Agent {self.agent_id}] Generating invariant test for task {task.task_id}"
        )

        constraints_text = "\n".join(
            f"  - {c}" for c in (task.hard_constraints or ["No specific constraints provided"])
        )

        prompt = f"""Generate a Foundry invariant test for the following smart contract.

## Hard Constraints (these must ALWAYS hold)
{constraints_text}

## Target Contract
```solidity
{contract_source}
```

## Instructions
1. For each hard constraint above, write one invariant_ function.
2. Each function should revert (using assert or require) when the constraint is violated.
3. Example pattern for a balance constraint:
   invariant_totalBalanceNotExceeded checks that the sum of all user balances
   never exceeds the ETH held by the contract.
4. Deploy the target contract in setUp() as:  target = new Target();

Return ONLY the complete Solidity source, no markdown fences."""

        code = self.llm.ask(prompt, system=self.INVARIANT_SYSTEM_PROMPT)
        code = self._extract_solidity(code)
        if not code:
            return ""

        # Run through compiler loop to ensure it at least compiles
        code = self._compiler_loop(
            code,
            max_iterations=3,
            filename="InvariantTest.t.sol",
        )
        return code

    # ============ Phase 4: PoC Generation ============

    def generate_poc(
        self, task: TaskSpec, vulnerability: dict, contract_source: str
    ) -> str:
        """Generate executable PoC using LLM with compiler-in-the-loop, depth-aware."""
        print(f"[Agent {self.agent_id}] Generating PoC for: {vulnerability.get('type')}")

        # Determine compiler loop iterations from economic context
        ctx = self._build_economic_context(task)
        min_depth = self._rationality.get("min_depth_level", 1)
        strategy = AuditStrategy.from_economic_context(ctx, min_depth=min_depth)
        print(f"[Agent {self.agent_id}] PoC strategy: {strategy.compiler_loop_iterations} compiler loops (depth {strategy.depth_level})")

        prompt = f"""Write a complete Foundry test that verifies an academic integrity issue:

Issue:
{json.dumps(vulnerability, indent=2, default=str)}

Submitted code:
```solidity
{contract_source}
```

Assignment requirements: {json.dumps(task.hard_constraints)}

[INCENTIVE CONTEXT]
- Your credit stake: {ctx.proposer_stake:.2f} at risk
- Be precise and thorough — an incorrect verification means lost credits

Requirements:
- Complete, compilable Foundry test
- Assert a concrete outcome (functional mismatch, or similarity/behaviour proof)
- Include all necessary interface definitions
- Function must be named testExploit()"""

        poc_code = self.llm.ask(prompt, system=POC_SYSTEM_PROMPT)
        print(f"[Agent {self.agent_id}] LLM raw response length: {len(poc_code)}")

        # Extract Solidity code from markdown if wrapped
        poc_code = self._extract_solidity(poc_code)
        print(f"[Agent {self.agent_id}] After extract: {len(poc_code)} chars")

        if not poc_code:
            print(f"[Agent {self.agent_id}] ERROR: LLM returned empty PoC code!")
            return ""

        # Compiler-in-the-loop: iterations driven by strategy (skip if forge unavailable)
        try:
            subprocess.run(["forge", "--version"], capture_output=True, timeout=5)
            poc_code = self._compiler_loop(poc_code, max_iterations=strategy.compiler_loop_iterations)
        except (FileNotFoundError, subprocess.TimeoutExpired, OSError):
            print(f"[Agent {self.agent_id}] forge not available, skipping compilation check")

        return poc_code

    def _extract_solidity(self, text: str) -> str:
        """Extract Solidity code from markdown code blocks."""
        pattern = r"```(?:solidity)?\s*\n(.*?)```"
        matches = re.findall(pattern, text, re.DOTALL)
        if matches:
            return matches[0].strip()
        # If no code block, assume the whole thing is code
        if "pragma solidity" in text:
            return text.strip()
        return text

    def _compiler_loop(self, code: str, max_iterations: int = 3, filename: str = "Exploit.t.sol") -> str:
        """Iteratively fix compilation errors using LLM."""
        for i in range(max_iterations):
            poc_path = self.work_dir / filename
            poc_path.write_text(code, encoding="utf-8")

            # Try to compile
            try:
                result = subprocess.run(
                    ["forge", "build", "--root", str(self.work_dir)],
                    capture_output=True, text=True, timeout=60,
                )
            except FileNotFoundError:
                print(f"[Agent {self.agent_id}] forge not available, skipping compilation check")
                return code
            except subprocess.TimeoutExpired:
                print(f"[Agent {self.agent_id}] Compilation timed out")
                return code

            if result.returncode == 0:
                print(f"[Agent {self.agent_id}] PoC compiled successfully (iteration {i+1})")
                return code

            # Ask LLM to fix errors
            error_output = result.stderr[:2000]
            fix_prompt = f"""This Solidity code has compilation errors. Fix them.

Code:
```solidity
{code}
```

Compiler errors:
```
{error_output}
```

Return ONLY the fixed Solidity code, no explanations."""

            fixed = self.llm.ask(fix_prompt, system=POC_SYSTEM_PROMPT)
            code = self._extract_solidity(fixed) if fixed else code
            print(f"[Agent {self.agent_id}] Compilation fix attempt {i+1}")

        print(f"[Agent {self.agent_id}] Warning: PoC may have compilation issues")
        return code

    # ============ Arbitration Voting ============

    def evaluate_arbitration(
        self,
        task_id: str,
        proposal_claim: str,
        challenge_description: str,
        poc_code: str,
        replay_result: dict,
    ) -> tuple[bool, str]:
        """Evaluate a dispute as an arbitration committee member."""
        print(f"[Agent {self.agent_id}] Evaluating arbitration for {task_id}")

        prompt = f"""Evaluate this academic integrity dispute:

## Original Student Claim
{proposal_claim}

## Challenger's Argument
{challenge_description}

## Challenger's Verification Code
```solidity
{poc_code}
```

## Sandbox Verification Result
{json.dumps(replay_result, indent=2, default=str)}

Based on the evidence:
1. Is the verification code valid and does it demonstrate a real issue (plagiarism / functional defect)?
2. Was this issue within the scope of the original assignment requirements?
3. Should the student's submission be penalized?

Respond in JSON with:
- verdict: "UPHELD" or "DISMISSED"
- reasoning: step-by-step explanation
- confidence: 0.0-1.0"""

        response = self.llm.ask(prompt, system=ARBITRATION_SYSTEM_PROMPT, json_mode=True)
        try:
            data = json.loads(response)
            upheld = data.get("verdict", "").upper() == "UPHELD"
            reasoning = data.get("reasoning", "No reasoning provided")
            return upheld, reasoning
        except json.JSONDecodeError:
            # Conservative: dismiss if we can't parse
            return False, "Failed to parse arbitration response"

    def sign_arbitration_vote(
        self,
        task_id: str,
        challenge_upheld: bool,
        replay_trace_hash: str,
        chain_id: int = 1,
        committee_address: str = "",
    ) -> dict:
        """Sign an EIP-712 arbitration vote."""
        if not self.signer:
            self.signer = EIP712ArbitrationSigner(chain_id, committee_address)

        return self.signer.sign_vote(
            private_key=self.private_key,
            task_id=task_id,
            challenge_upheld=challenge_upheld,
            replay_trace_hash=replay_trace_hash,
        )

    # ============ Strategy & Decision Making ============

    def should_challenge(
        self, task: TaskSpec, proposal_claim: str, contract_source: str
    ) -> tuple[bool, Optional[dict]]:
        """Decide whether to challenge a proposal using expected value analysis."""
        # Step 1: Check stake threshold
        if not self.stake_oracle.validate_stake_sufficient(
            self.base_agent.stake, "reporter"
        ):
            print(f"[Agent {self.agent_id}] Insufficient stake to challenge")
            return False, None

        # Step 2: Compute EV before spending audit cost
        ctx = self._build_economic_context(task)
        ev_challenge = ctx.expected_challenger_profit
        print(f"[Agent {self.agent_id}] Challenge EV (pre-audit): {ev_challenge:.4f} ETH")

        if ev_challenge <= 0:
            print(f"[Agent {self.agent_id}] Challenge EV negative, skipping")
            return False, None

        # Step 3: Perform independent audit
        state = self.perform_audit(task, contract_source)

        # Step 4: Check confidence threshold
        min_confidence = self._rationality.get("min_challenge_confidence", 0.75)

        # If we found critical issues the reviewer missed
        if "no significant issues" in proposal_claim.lower() or "meets requirements" in proposal_claim.lower():
            critical_vulns = [
                e for e in state.evidence
                if "Critical" in e.provenance or "High" in e.provenance
            ]
            if critical_vulns and state.confidence >= min_confidence:
                adjusted_ev = ev_challenge * state.confidence
                print(f"[Agent {self.agent_id}] Found missed issues. "
                      f"Adjusted EV: {adjusted_ev:.4f}, confidence: {state.confidence:.2f}")
                if adjusted_ev > 0:
                    return True, {"reason": "missed_issue", "evidence": state,
                                  "ev": adjusted_ev, "confidence": state.confidence}

        return False, None

    def should_propose(self, task: TaskSpec) -> bool:
        """Decide whether to submit a proposal using expected value analysis."""
        # Check stake requirements
        min_stake = self.stake_oracle.compute_min_submitter_stake()
        if self.base_agent.stake < min_stake:
            print(f"[Agent {self.agent_id}] Stake {self.base_agent.stake} < min {min_stake}")
            return False

        # Compute expected value
        ctx = self._build_economic_context(task)
        ev = ctx.expected_proposer_profit
        print(f"[Agent {self.agent_id}] Submitter EV: {ev:.4f} credits "
              f"(reward={ctx.reward:.2f}, effort_cost={ctx.audit_cost:.2f}, "
              f"stake={ctx.proposer_stake:.2f})")

        if ev <= 0:
            print(f"[Agent {self.agent_id}] EV negative ({ev:.4f}), declining task")
            return False

        # Sanity check via GameTheoryValidator
        validator = GameTheoryValidator()
        honesty_ok = validator.check_proposer_honesty_constraint(
            ca=ctx.audit_cost,
            ca_prime=self.stake_oracle.cheat_effort,
            p_detect=ctx.p_detect,
            p_arb_correct=ctx.p_arb_correct,
            sp=ctx.proposer_stake,
        )

        if not honesty_ok:
            print(f"[Agent {self.agent_id}] Honesty constraint not satisfied, declining")
            return False

        return True

    # ============ Verifier Scoring ============

    def compute_verifier_score(
        self, task: TaskSpec, proposal_state: SemanticState, contract_source: str
    ) -> int:
        """Compute a verification score for a proposal."""
        prompt = f"""As a peer reviewer, score this assignment submission from 0-100.

Assignment requirements: {json.dumps(task.hard_constraints)}

Review claim: {proposal_state.final_claim}
Reviewer confidence: {proposal_state.confidence}
Evidence count: {len(proposal_state.evidence)}
Review steps completed: {json.dumps(proposal_state.subtasks)}

Submitted code (first 200 lines):
```
{contract_source[:5000]}
```

Scoring criteria:
- 90-100: Excellent — all requirements met, correct, original, well-documented
- 70-89: Good — minor gaps in quality or completeness
- 50-69: Acceptable but incomplete
- 30-49: Significant problems (incorrect logic or missing requirements)
- 0-29: Clearly insufficient, incorrect, or plagiarized

Respond with JSON: {{"score": <int>, "reasoning": "<brief>"}}"""

        response = self.llm.ask(prompt, system=AUDIT_SYSTEM_PROMPT, json_mode=True)
        try:
            data = json.loads(response)
            score = int(data.get("score", 50))
            return max(0, min(100, score))
        except (json.JSONDecodeError, ValueError):
            return 50  # Default neutral score

    # ============ Agent Loop ============

    def run_loop(self, poll_interval: int = 30):
        """Main agent event loop - monitors tasks and acts autonomously."""
        print(f"[Agent {self.agent_id}] Starting autonomous loop...")
        print(f"[Agent {self.agent_id}] LLM: {self.llm.config.model} @ {self.llm.config.base_url}")

        while True:
            try:
                self._tick()
            except KeyboardInterrupt:
                print(f"\n[Agent {self.agent_id}] Shutting down...")
                break
            except Exception as e:
                print(f"[Agent {self.agent_id}] Error in loop: {e}")

            time.sleep(poll_interval)

    def _tick(self):
        """Single iteration of the agent loop."""
        # Check for pending arbitration votes
        pending = self.committee.get_pending_votes()
        if pending:
            print(f"[Agent {self.agent_id}] {len(pending)} pending arbitration votes")

        # In production, this would:
        # 1. Poll on-chain for new Open tasks
        # 2. Check if any Proposed tasks need verification
        # 3. Look for challengeable proposals
        # 4. Submit arbitration votes for assigned committees
        pass


# ============ Demo & Entry Point ============

def demo():
    """Demonstrate the autonomous AI review agent with incentive-driven rationality."""
    print("=" * 60)
    print(" EduChain Autonomous AI Review Agent - Rationality Demo")
    print("=" * 60)

    # Initialize agent
    agent = AutonomousAuditAgent(
        agent_id="reviewer_001",
        did="did:edu:0xReviewAgent001",
        private_key="0xAGENT_PRIVATE_KEY",
        config=LLMConfig(),
        work_dir="/tmp/educhain_agent",
    )

    # Sample student assignment submission to review
    sample_contract = """// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// Student assignment: implement a simple savings vault
contract SavingsVault {
    mapping(address => uint256) public balances;

    function deposit() external payable {
        balances[msg.sender] += msg.value;
    }

    function withdraw(uint256 amount) external {
        require(balances[msg.sender] >= amount, "Insufficient balance");
        (bool success, ) = msg.sender.call{value: amount}("");
        require(success, "Transfer failed");
        balances[msg.sender] -= amount;
    }

    function getBalance() external view returns (uint256) {
        return address(this).balance;
    }
}"""

    # --- Incentive Rationality Demo ---
    print("\n--- Incentive Rationality: Review Depth Levels ---")
    agent.base_agent.stake = 5.0
    test_rewards = [0.5, 2.0, 5.0, 10.0]
    for reward in test_rewards:
        task = TaskSpec(
            task_id=f"assignment_{reward}",
            code_hash=hashlib.sha256(sample_contract.encode()).hexdigest(),
            hard_constraints=["correct_balance_accounting", "no_unauthorized_withdrawal"],
            reward=reward,
        )
        ctx = agent._build_economic_context(task)
        strategy = AuditStrategy.from_economic_context(ctx)
        print(f"  Reward={reward:.1f} credits | ratio={ctx.reward_stake_ratio:.2f} | "
              f"depth={strategy.depth_level} | rounds={strategy.analysis_rounds} | "
              f"passes={strategy.vulnerability_search_passes} | "
              f"compiler_loops={strategy.compiler_loop_iterations}")

    # --- should_propose EV demo ---
    print("\n--- Economic Rationality: should_propose ---")
    for reward in [0.5, 2.0, 5.0, 10.0]:
        task = TaskSpec(
            task_id=f"task_propose_{reward}",
            code_hash="0xdemo",
            hard_constraints=["no_reentrancy"],
            reward=reward,
        )
        result = agent.should_propose(task)
        ctx = agent._build_economic_context(task)
        print(f"  Reward={reward:.1f} ETH | EV={ctx.expected_proposer_profit:.4f} | propose={result}")

    # --- Full audit with economic context ---
    print("\n--- Phase 2: LLM-Powered Audit (reward=5.0 ETH) ---")
    task = TaskSpec(
        task_id="task_demo_001",
        code_hash=hashlib.sha256(sample_contract.encode()).hexdigest(),
        hard_constraints=["no_reentrancy", "no_unauthorized_withdrawal"],
        reward=5.0,
    )
    state = agent.perform_audit(task, sample_contract)
    print(f"Final claim: {state.final_claim}")
    print(f"Confidence: {state.confidence}")
    print(f"Evidence items: {len(state.evidence)}")

    # Generate PoC for found vulnerability
    if state.evidence:
        print("\n--- Phase 4: PoC Generation ---")
        vuln = {
            "type": "reentrancy",
            "severity": "Critical",
            "location": "withdraw()",
            "description": "State update after external call allows reentrancy",
            "constraint_violated": "no_reentrancy",
        }
        poc = agent.generate_poc(task, vuln, sample_contract)
        print(f"PoC generated ({len(poc)} chars)")
        print(poc[:500] + "..." if len(poc) > 500 else poc)

    # Arbitration evaluation
    print("\n--- Arbitration Evaluation ---")
    upheld, reasoning = agent.evaluate_arbitration(
        task_id="task_demo_001",
        proposal_claim="No critical vulnerabilities detected",
        challenge_description="Reentrancy in withdraw() - state updated after external call",
        poc_code="function testExploit() { /* reentrancy attack */ }",
        replay_result={"verdict": "CHALLENGE_UPHELD", "exit_code": 0},
    )
    print(f"Verdict: {'UPHELD' if upheld else 'DISMISSED'}")
    print(f"Reasoning: {reasoning[:200]}")

    print("\n" + "=" * 60)
    print(" Agent demo complete")
    print("=" * 60)


if __name__ == "__main__":
    demo()
