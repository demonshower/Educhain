"""
Loader for val_data_reason_public.jsonl dataset.

Format: each line is {"id": "s1234", "prompt": "...", "completion": "..."}
- Each unique submission has 5 prompt variants with different phrasing
- Label is embedded in the prompt: "vulnerable" (problematic) or "safe" (clean)
- Source code is in ```Solidiy blocks (note: intentional typo in dataset)
- Code is function-level with caller/callee context

Note: the literal label tokens "vulnerable"/"safe" are kept verbatim because
they are read directly from the source dataset prompts.

Stats: 5480 total lines, 1096 unique submissions (498 problematic + 598 clean)
"""

import json
import re
from pathlib import Path


_SOLIDIY_BLOCK = re.compile(r"```(?:Solidiy|solidity|Solidity)?\s*\n(.*?)```", re.DOTALL)


def _extract_label(prompt: str) -> str:
    """Extract 'vulnerable' or 'safe' from the prompt text."""
    p = prompt.lower()
    markers = [
        ("the input code is vulnerable", "vulnerable"),
        ("labeled vulnerable", "vulnerable"),
        ("label name.*vulnerable", "vulnerable"),
        ("recognizing vulnerable", "vulnerable"),
        ("given that the code is labeled vulnerable", "vulnerable"),
        ("considering vulnerable", "vulnerable"),
        ("designated label.*vulnerable", "vulnerable"),
        ("the input code is safe", "safe"),
        ("labeled safe", "safe"),
        ("recognizing safe", "safe"),
        ("given that the code is labeled safe", "safe"),
        ("considering safe", "safe"),
        ("designated label.*safe", "safe"),
        ("label name.*safe", "safe"),
    ]
    for pattern, label in markers:
        if re.search(pattern, p):
            return label
    # Fallback: check last line of response prompt
    if "vulnerable" in p.split("response:")[-1]:
        return "vulnerable"
    if "safe" in p.split("response:")[-1]:
        return "safe"
    return "unknown"


def _extract_code_blocks(prompt: str) -> list[str]:
    """Extract all Solidity code blocks from the prompt."""
    return [m.strip() for m in _SOLIDIY_BLOCK.findall(prompt) if m.strip()]


def _extract_function_name(prompt: str) -> str:
    """Extract function name from prompt like 'The function Foo from the contract bar'."""
    m = re.search(r"(?:function|method|procedure|code segment)\s+(\w+)\s+(?:from|in)", prompt, re.IGNORECASE)
    if m:
        return m.group(1)
    return "unknown"


def _extract_contract_name(prompt: str) -> str:
    """Extract contract name from prompt."""
    m = re.search(r"(?:from the contract|in the smart contract|in the blockchain contract|in the decentralized application)\s+(\w+)", prompt, re.IGNORECASE)
    if m:
        return m.group(1)
    return "Unknown"


def _build_source(code_blocks: list[str], fn_name: str, contract_name: str) -> str:
    """Wrap extracted code blocks into a compilable Solidity source skeleton."""
    if not code_blocks:
        return ""

    # Join all code blocks as the contract body
    body = "\n\n".join(code_blocks)

    return (
        "// SPDX-License-Identifier: MIT\n"
        "pragma solidity ^0.8.0;\n\n"
        f"// Contract: {contract_name} | Function: {fn_name}\n"
        f"contract {contract_name} {{\n"
        f"{body}\n"
        f"}}"
    )


def load_from_jsonl(
    path: str,
    n_vuln: int = 50,
    n_safe: int = 50,
    seed: int = 42,
    include_description: bool = True,
) -> list[dict]:
    """
    Load and parse the val_data_reason_public.jsonl dataset.

    De-duplicates by submission ID (takes first occurrence per unique ID),
    extracts source code and labels, and returns in EduChain experiment schema.

    Args:
        path: Path to the .jsonl file
        n_vuln: Number of problematic samples to include (default 50)
        n_safe: Number of clean samples to include (default 50)
        seed: Random seed for shuffling before selection
        include_description: Whether to include completion text as description

    Returns:
        List of dicts matching EduChain experiment schema
    """
    import random

    seen_ids: dict[str, dict] = {}  # id -> parsed entry

    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                continue

            contract_id = obj.get("id", "")
            if contract_id in seen_ids:
                continue  # Already have this submission, skip duplicate variants

            prompt = obj.get("prompt", "")
            completion = obj.get("completion", "")

            label = _extract_label(prompt)
            if label == "unknown":
                continue

            code_blocks = _extract_code_blocks(prompt)
            if not code_blocks:
                continue

            fn_name = _extract_function_name(prompt)
            contract_name = _extract_contract_name(prompt)
            source = _build_source(code_blocks, fn_name, contract_name)

            if not source:
                continue

            seen_ids[contract_id] = {
                "id": contract_id,
                "name": f"{fn_name}_{contract_name}",
                "source": source,
                "has_vulnerability": label == "vulnerable",
                "vulnerability_type": "real_world" if label == "vulnerable" else None,
                "severity": "High" if label == "vulnerable" else None,
                "difficulty": "Medium",
                "description": completion[:300] if include_description else "",
            }

    vulnerable = [v for v in seen_ids.values() if v["has_vulnerability"]]
    safe = [v for v in seen_ids.values() if not v["has_vulnerability"]]

    rng = random.Random(seed)
    rng.shuffle(vulnerable)
    rng.shuffle(safe)

    selected = vulnerable[:n_vuln] + safe[:n_safe]
    rng.shuffle(selected)
    return selected


def get_jsonl_stats(path: str) -> dict:
    """Count unique submissions and label distribution in the JSONL file."""
    seen: dict[str, str] = {}
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                continue
            cid = obj.get("id", "")
            if cid in seen:
                continue
            label = _extract_label(obj.get("prompt", ""))
            seen[cid] = label

    total = len(seen)
    vuln = sum(1 for v in seen.values() if v == "vulnerable")
    safe = sum(1 for v in seen.values() if v == "safe")
    unknown = sum(1 for v in seen.values() if v == "unknown")
    return {
        "total_unique": total,
        "vulnerable": vuln,
        "safe": safe,
        "unknown": unknown,
        "total_lines_approx": total * 5,
    }
