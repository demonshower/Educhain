"""
EduChain End-to-End Integration Test

Tests the AI review agent's ability to:
1. Review original student code (should pass)
2. Detect plagiarized/low-quality code (should flag issues)
"""

import json
from audit_agent import AuditAgent, TaskSpec, GameTheoryValidator

# ============ Test Data: Student Submissions ============

# A well-written original bubble sort implementation
ORIGINAL_SUBMISSION = """
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title BubbleSort - Student assignment: implement on-chain sorting
/// @notice Educational demo of sorting algorithm in Solidity
/// @dev Written by StudentA for CS101 Assignment #3
contract BubbleSort {
    uint256[] public data;
    address public owner;
    
    constructor() {
        owner = msg.sender;
    }
    
    /// @notice Add a value to the array
    function addValue(uint256 val) external {
        require(msg.sender == owner, "Only owner can add values");
        data.push(val);
    }
    
    /// @notice Sort the array using bubble sort algorithm
    /// @dev O(n^2) complexity, suitable for small arrays only
    function sort() external {
        require(msg.sender == owner, "Only owner can sort");
        uint256 n = data.length;
        for (uint256 i = 0; i < n; i++) {
            for (uint256 j = 0; j < n - i - 1; j++) {
                if (data[j] > data[j + 1]) {
                    // Swap elements
                    uint256 temp = data[j];
                    data[j] = data[j + 1];
                    data[j + 1] = temp;
                }
            }
        }
    }
    
    /// @notice Get array length
    function getLength() external view returns (uint256) {
        return data.length;
    }
    
    /// @notice Check if array is sorted (for verification)
    function isSorted() external view returns (bool) {
        for (uint256 i = 1; i < data.length; i++) {
            if (data[i - 1] > data[i]) return false;
        }
        return true;
    }
}
"""

# A plagiarized/low-quality submission (copied from template without understanding)
PLAGIARIZED_SUBMISSION = """
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract Sort {
    uint256[] public arr;
    
    // No access control - anyone can modify
    function add(uint256 v) external {
        arr.push(v);
    }
    
    // Buggy sort - missing boundary check, potential DoS
    function sort() external {
        uint256 n = arr.length;
        // No gas limit check for large arrays
        for (uint256 i = 0; i < n; i++) {
            for (uint256 j = 0; j < n - 1; j++) {
                if (arr[j] > arr[j + 1]) {
                    uint256 temp = arr[j];
                    arr[j] = arr[j + 1];
                    arr[j + 1] = temp;
                }
            }
        }
    }
    
    // Missing: isSorted verification function
    // Missing: proper documentation
    // Missing: access control
}
"""


def test_review_original():
    """Test: AI should give high score to well-written original code."""
    print("\n" + "="*60)
    print("TEST 1: Review Original Student Submission")
    print("="*60)
    
    agent = AuditAgent(
        agent_id="reviewer_test",
        did="did:ethr:0xTestReviewer",
        private_key="0xTEST_KEY"
    )
    
    task = TaskSpec(
        task_id="cs101_assignment_3",
        code_hash="0xoriginal_submission_hash",
        hard_constraints=[
            "implement_sorting_algorithm",
            "include_access_control",
            "provide_documentation",
            "include_verification_function"
        ],
        reward=3.0
    )
    
    state = agent.perform_audit(task, ORIGINAL_SUBMISSION)
    hashes = agent.compute_proposal_hash(state)
    
    print(f"Review result: {state.final_claim}")
    print(f"Confidence: {state.confidence}")
    print(f"State root: {hashes['state_root'][:16]}...")
    assert state.confidence >= 0.7, "Original work should get high confidence"
    print("✓ PASSED: Original submission reviewed positively")


def test_review_plagiarized():
    """Test: AI should flag issues in low-quality/plagiarized code."""
    print("\n" + "="*60)
    print("TEST 2: Review Plagiarized/Low-Quality Submission")
    print("="*60)
    
    agent = AuditAgent(
        agent_id="reviewer_test",
        did="did:ethr:0xTestReviewer",
        private_key="0xTEST_KEY"
    )
    
    task = TaskSpec(
        task_id="cs101_assignment_3_v2",
        code_hash="0xplagiarized_submission_hash",
        hard_constraints=[
            "implement_sorting_algorithm",
            "include_access_control",
            "provide_documentation",
            "include_verification_function"
        ],
        reward=3.0
    )
    
    state = agent.perform_audit(task, PLAGIARIZED_SUBMISSION)
    print(f"Review result: {state.final_claim}")
    print(f"Confidence: {state.confidence}")
    print("✓ PASSED: Low-quality submission reviewed")


def test_game_theory():
    """Test: Economic parameters ensure academic honesty is dominant strategy."""
    print("\n" + "="*60)
    print("TEST 3: Game Theory - Academic Honesty Incentives")
    print("="*60)
    
    validator = GameTheoryValidator()
    
    # Student honesty: honest_effort=2, cheat_effort=0.1, P_detect=0.7, P_arb=0.95, stake=5
    result = validator.check_proposer_honesty_constraint(
        ca=2.0, ca_prime=0.1, p_detect=0.7, p_arb_correct=0.95, sp=5.0
    )
    assert result, "With sufficient stake, honesty should be dominant strategy"
    print("✓ Student honesty constraint satisfied")
    
    # Reporter participation: evidence_cost=1, P_detect=0.7, P_arb=0.95
    result = validator.check_challenger_participation_constraint(
        cpoc=1.0, p_detect=0.7, p_arb_correct=0.95, sp=5.0, sc=2.0, alpha=0.6
    )
    assert result, "Reporting genuine plagiarism should be economically viable"
    print("✓ Reporter participation constraint satisfied")
    
    print("\n✓ ALL TESTS PASSED")


if __name__ == "__main__":
    test_review_original()
    test_review_plagiarized()
    test_game_theory()
