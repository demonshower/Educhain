// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/Registry.sol";
import "../src/DisputeResolution.sol";

/// @title DisputeResolutionTest - Integration tests for the full dispute pipeline
contract DisputeResolutionTest is Test {
    Registry public registry;
    DisputeResolution public dispute;

    address public publisher = makeAddr("publisher");
    address public proposer = makeAddr("proposer");
    address public challenger = makeAddr("challenger");
    address public verifier1 = makeAddr("verifier1");
    address public arbitrator = makeAddr("arbitrator");

    bytes32 constant CODE_HASH = keccak256("contract Vault {}");
    bytes32 constant STATE_ROOT = keccak256("state_root_data");
    bytes32 constant EVIDENCE_ROOT = keccak256("evidence_root_data");
    bytes32 constant TRACE_ROOT = keccak256("trace_root_data");

    function setUp() public {
        // Deploy contracts
        registry = new Registry();
        dispute = new DisputeResolution(address(registry));
        registry.setDisputeContract(address(dispute));

        // Fund accounts
        vm.deal(publisher, 100 ether);
        vm.deal(proposer, 100 ether);
        vm.deal(challenger, 100 ether);
        vm.deal(verifier1, 10 ether);

        // Register agents
        vm.prank(proposer);
        registry.register{value: 2 ether}(keccak256("did:proposer"), hex"01");

        vm.prank(challenger);
        registry.register{value: 2 ether}(keccak256("did:challenger"), hex"02");

        vm.prank(verifier1);
        registry.register{value: 1 ether}(keccak256("did:verifier1"), hex"03");
    }

    // ============ Phase 1: Task Publication ============

    function test_publishTask() public {
        vm.prank(publisher);
        bytes32 taskId = dispute.publishTask{value: 5 ether}(
            CODE_HASH,
            "no_reentrancy;no_price_manipulation",
            48 hours,
            1 ether
        );

        assertEq(uint256(dispute.taskStatus(taskId)), uint256(DisputeResolution.TaskStatus.Open));
    }

    // ============ Phase 2: Proposal Submission ============

    function test_submitProposal() public {
        bytes32 taskId = _publishTask();

        vm.prank(proposer);
        dispute.submitProposal{value: 2 ether}(
            taskId, STATE_ROOT, EVIDENCE_ROOT, TRACE_ROOT, "ipfs://QmEvidence"
        );

        assertEq(uint256(dispute.taskStatus(taskId)), uint256(DisputeResolution.TaskStatus.Proposed));

        DisputeResolution.Proposal memory prop = dispute.getProposal(taskId);
        assertEq(prop.proposer, proposer);
        assertEq(prop.stateRoot, STATE_ROOT);
        assertEq(prop.stake, 2 ether);
    }

    // ============ Phase 5a: Optimistic Finalization ============

    function test_optimisticFinalization() public {
        bytes32 taskId = _publishAndPropose();

        // Verifier commits and reveals a passing score
        bytes32 salt = keccak256("salt123");
        uint256 score = 80;
        bytes32 commitHash = keccak256(abi.encodePacked(score, salt));

        vm.prank(verifier1);
        dispute.commitScore(taskId, commitHash);

        vm.prank(verifier1);
        dispute.revealScore(taskId, 0, score, salt);

        // Warp past challenge period
        vm.warp(block.timestamp + 49 hours);

        uint256 proposerBalBefore = proposer.balance;
        dispute.finalizeOptimistic(taskId);

        assertEq(uint256(dispute.taskStatus(taskId)), uint256(DisputeResolution.TaskStatus.Finalized));
        assertGt(proposer.balance, proposerBalBefore);
    }

    // ============ Phase 4: Challenge ============

    function test_raiseChallenge() public {
        bytes32 taskId = _publishAndPropose();

        bytes32 pocHash = keccak256("exploit_code");

        vm.prank(challenger);
        dispute.raiseChallenge{value: 2 ether}(
            taskId,
            DisputeResolution.ChallengeType.FalseNegative,
            "ipfs://QmPoC",
            pocHash,
            "Reentrancy vulnerability in withdraw()"
        );

        assertEq(uint256(dispute.taskStatus(taskId)), uint256(DisputeResolution.TaskStatus.Challenged));
    }

    // ============ Phase 5b: Arbitration - Challenge Upheld ============

    function test_arbitration_challengeUpheld() public {
        bytes32 taskId = _publishProposeAndChallenge();

        uint256 challengerBalBefore = challenger.balance;

        address[] memory arbitrators = new address[](1);
        arbitrators[0] = arbitrator;

        dispute.submitArbitrationResult(
            taskId, true, keccak256("replay_trace"), arbitrators
        );

        assertEq(uint256(dispute.taskStatus(taskId)), uint256(DisputeResolution.TaskStatus.Slashed));
        assertGt(challenger.balance, challengerBalBefore);
    }

    // ============ Phase 5b: Arbitration - Challenge Dismissed ============

    function test_arbitration_challengeDismissed() public {
        bytes32 taskId = _publishProposeAndChallenge();

        uint256 proposerBalBefore = proposer.balance;

        address[] memory arbitrators = new address[](1);
        arbitrators[0] = arbitrator;

        dispute.submitArbitrationResult(
            taskId, false, keccak256("replay_trace"), arbitrators
        );

        assertEq(uint256(dispute.taskStatus(taskId)), uint256(DisputeResolution.TaskStatus.Finalized));
        assertGt(proposer.balance, proposerBalBefore);
    }

    // ============ Negative Tests ============

    function test_revert_challengeAfterDeadline() public {
        bytes32 taskId = _publishAndPropose();

        // Warp past challenge period
        vm.warp(block.timestamp + 49 hours);

        vm.prank(challenger);
        vm.expectRevert("Dispute: challenge period expired");
        dispute.raiseChallenge{value: 2 ether}(
            taskId,
            DisputeResolution.ChallengeType.FalseNegative,
            "ipfs://QmPoC",
            keccak256("poc"),
            "Too late"
        );
    }

    function test_revert_proposerChallengesSelf() public {
        bytes32 taskId = _publishAndPropose();

        vm.prank(proposer);
        vm.expectRevert("Dispute: cannot challenge own proposal");
        dispute.raiseChallenge{value: 2 ether}(
            taskId,
            DisputeResolution.ChallengeType.FalseNegative,
            "ipfs://QmPoC",
            keccak256("poc"),
            "Self challenge"
        );
    }

    // ============ Helpers ============

    function _publishTask() internal returns (bytes32) {
        vm.prank(publisher);
        return dispute.publishTask{value: 5 ether}(
            CODE_HASH, "no_reentrancy", 48 hours, 1 ether
        );
    }

    function _publishAndPropose() internal returns (bytes32) {
        bytes32 taskId = _publishTask();
        vm.prank(proposer);
        dispute.submitProposal{value: 2 ether}(
            taskId, STATE_ROOT, EVIDENCE_ROOT, TRACE_ROOT, "ipfs://QmEvidence"
        );
        return taskId;
    }

    function _publishProposeAndChallenge() internal returns (bytes32) {
        bytes32 taskId = _publishAndPropose();
        vm.prank(challenger);
        dispute.raiseChallenge{value: 2 ether}(
            taskId,
            DisputeResolution.ChallengeType.FalseNegative,
            "ipfs://QmPoC",
            keccak256("poc"),
            "Reentrancy in withdraw()"
        );
        return taskId;
    }
}
