"""
Baseline 3: Traditional Automated Tools.

Simulates running static analysis + symbolic-style checkers over a student
submission. Uses pattern matching heuristics to approximate what such tools
would flag (common defect and copied-code patterns).
"""

import re
from .base import BaselineRunner, AuditResult


# Detection patterns that approximate static-analysis tool capabilities
SLITHER_PATTERNS = {
    "reentrancy": [
        # External call before state update
        r"\.call\{value:.*\}.*\n.*(?:balances|balance)\[.*\]\s*[-=]",
        r"\.call\{value:.*\}.*\n.*(?!.*=\s*0).*\-=",
    ],
    "access_control": [
        r"selfdestruct\(",  # selfdestruct without onlyOwner in same function
        r"function\s+\w+\([^)]*\)\s+external\s*\{[^}]*(?:owner\s*=|selfdestruct)",
    ],
    "integer_overflow": [
        r"unchecked\s*\{[^}]*[-+]",
    ],
    "delegatecall_injection": [
        r"\.delegatecall\(",
    ],
}

MYTHRIL_PATTERNS = {
    "reentrancy": [
        # State change after external call (symbolic execution would catch)
        r"msg\.sender\.call\{value:",
        r"\.call\{value:.*\}\(\"\"\)",
    ],
    "signature_replay": [
        # Missing nonce in signature hash
        r"keccak256\(abi\.encodePacked\([^)]*\)\)(?!.*nonce)",
    ],
    "oracle_manipulation": [
        r"getReserves\(\)",
    ],
}


class TraditionalToolsBaseline(BaselineRunner):
    """Simulates static-analysis tool detection capabilities."""

    name = "B3_TraditionalTools"

    def audit_contract(self, contract: dict) -> AuditResult:
        source = contract["source"]
        detected_types = set()

        # Run static-analysis-style pattern matching
        for vuln_type, patterns in SLITHER_PATTERNS.items():
            for pattern in patterns:
                if re.search(pattern, source, re.MULTILINE | re.DOTALL):
                    detected_types.add(vuln_type)
                    break

        # Run symbolic-style pattern matching
        for vuln_type, patterns in MYTHRIL_PATTERNS.items():
            for pattern in patterns:
                if re.search(pattern, source, re.MULTILINE | re.DOTALL):
                    detected_types.add(vuln_type)
                    break

        # Filter out false positives using context
        filtered_types = self._filter_false_positives(source, detected_types)

        detected = len(filtered_types) > 0
        vuln_type = list(filtered_types)[0] if filtered_types else None

        # Confidence based on number of matching patterns
        confidence = min(len(filtered_types) * 0.4, 0.95) if detected else 0.1

        return AuditResult(
            contract_id=contract["id"],
            detected_vulnerability=detected,
            vulnerability_type=vuln_type,
            confidence=confidence,
            reasoning=f"Pattern match: {filtered_types or 'none'}",
            num_agents_involved=0,  # No reviewers, just tools
            poc_generated=False,
            poc_valid=False,
            sandbox_invoked=False,
            challenge_raised=False,
            # Static-analysis tools run off-chain: 0 gas
            gas_cost=0,
        )

    def _filter_false_positives(self, source: str, detected: set) -> set:
        """Apply heuristics to reduce false positives."""
        filtered = set(detected)

        # If reentrancy detected but has nonReentrant modifier or CEI pattern, remove it
        if "reentrancy" in filtered:
            if "nonReentrant" in source:
                filtered.discard("reentrancy")
            elif "locked" in source and "require(!locked" in source:
                filtered.discard("reentrancy")
            else:
                # Check for CEI pattern: balance update BEFORE external call
                import re as _re
                # If state update comes before .call{value:} in the same function
                funcs = _re.findall(r"function\s+withdraw[^{]*\{([^}]+)\}", source, _re.DOTALL)
                for func_body in funcs:
                    lines = func_body.strip().split("\n")
                    state_update_line = -1
                    call_line = -1
                    for i, line in enumerate(lines):
                        if "-=" in line or "= 0" in line:
                            if state_update_line == -1:
                                state_update_line = i
                        if ".call{value:" in line:
                            call_line = i
                    if state_update_line != -1 and call_line != -1 and state_update_line < call_line:
                        filtered.discard("reentrancy")

        # If delegatecall detected but has onlyOwner on the function, it's safe
        if "delegatecall_injection" in filtered:
            import re as _re
            # Check if delegatecall is in a function with access control
            funcs_with_dc = _re.findall(r"function\s+\w+[^{]*\{[^}]*delegatecall[^}]*\}", source, _re.DOTALL)
            all_protected = True
            for func in funcs_with_dc:
                if "onlyOwner" not in func and "msg.sender == owner" not in func:
                    all_protected = False
            if all_protected and funcs_with_dc:
                filtered.discard("delegatecall_injection")

        # Access control: check if selfdestruct has require(msg.sender == owner)
        if "access_control" in filtered:
            import re as _re
            funcs = _re.findall(r"function\s+\w+[^{]*\{[^}]*selfdestruct[^}]*\}", source, _re.DOTALL)
            all_protected = True
            for func in funcs:
                if "msg.sender == owner" not in func and "onlyOwner" not in func:
                    all_protected = False
            if all_protected and funcs:
                filtered.discard("access_control")
            # Also check initialize without protection
            init_funcs = _re.findall(r"function\s+initialize[^{]*\{([^}]+)\}", source, _re.DOTALL)
            for func_body in init_funcs:
                if "initialized" in source and "require" not in func_body:
                    filtered.add("access_control")

        # Signature replay: check if nonce is used
        if "signature_replay" in filtered:
            if "nonces[" in source or "nonce ==" in source:
                filtered.discard("signature_replay")

        return filtered
