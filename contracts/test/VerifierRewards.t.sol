// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/Registry.sol";
import "../src/DisputeResolution.sol";

/// @title VerifierRewardsTest - Tests for Shapley distribution and auto-slash trigger
contract VerifierRewardsTest is Test {
    Registry public registry;
    DisputeResolution public dispute;

    address public publisher = makeAddr("publisher");
    address public proposer = makeAddr("proposer");
    address public verifier1 = makeAddr("verifier1");
    address public verifier2 = makeAddr("verifier2");
    address public verifier3 = makeAddr("verifier3");

    bytes32 constant CODE_HASH = keccak256("contract Vault {}");

    function setUp() public {
        registry = new Registry();
        dispute = new DisputeResolution(address(registry));
        registry.setDisputeContract(address(dispute));

        vm.deal(publisher, 100 ether);
        vm.deal(proposer, 100 ether);
        vm.deal(verifier1, 10 ether);
        vm.deal(verifier2, 10 ether);
        vm.deal(verifier3, 10 ether);

        vm.prank(proposer);
        registry.register{value: 2 ether}(keccak256("did:proposer"), hex"01");
        vm.prank(verifier1);
        registry.register{value: 1 ether}(keccak256("did:v1"), hex"02");
        vm.prank(verifier2);
        registry.register{value: 1 ether}(keccak256("did:v2"), hex"03");
        vm.prank(verifier3);
        registry.register{value: 1 ether}(keccak256("did:v3"), hex"04");
    }
// PLACEHOLDER_TESTS_CONTINUE

    // ============ Shapley Verifier Reward Tests ============

    function test_verifierRewards_distributed() public {
        bytes32 taskId = _publishAndPropose();

        // Three verifiers score: 80, 75, 85 (all above threshold)
        _commitAndReveal(taskId, verifier1, 80, keccak256("s1"));
        _commitAndReveal(taskId, verifier2, 75, keccak256("s2"));
        _commitAndReveal(taskId, verifier3, 85, keccak256("s3"));

        // Warp past challenge period
        vm.warp(block.timestamp + 49 hours);

        uint256 v1Before = verifier1.balance;
        uint256 v2Before = verifier2.balance;
        uint256 v3Before = verifier3.balance;

        dispute.finalizeOptimistic(taskId);

        // All verifiers should receive some reward
        assertGt(verifier1.balance, v1Before);
        assertGt(verifier2.balance, v2Before);
        assertGt(verifier3.balance, v3Before);
    }

    function test_verifierRewards_closerToMeanGetsMore() public {
        bytes32 taskId = _publishAndPropose();

        // verifier1 scores 80 (mean), verifier2 scores 80 (same), verifier3 scores 60 (far)
        _commitAndReveal(taskId, verifier1, 80, keccak256("s1"));
        _commitAndReveal(taskId, verifier2, 80, keccak256("s2"));
        _commitAndReveal(taskId, verifier3, 60, keccak256("s3"));

        vm.warp(block.timestamp + 49 hours);

        uint256 v1Before = verifier1.balance;
        uint256 v3Before = verifier3.balance;

        dispute.finalizeOptimistic(taskId);

        uint256 v1Reward = verifier1.balance - v1Before;
        uint256 v3Reward = verifier3.balance - v3Before;

        // verifier1 (at mean) should get more than verifier3 (far from mean)
        assertGt(v1Reward, v3Reward);
    }

    function test_verifierRewards_totalEquals10Percent() public {
        bytes32 taskId = _publishAndPropose();

        _commitAndReveal(taskId, verifier1, 80, keccak256("s1"));
        _commitAndReveal(taskId, verifier2, 75, keccak256("s2"));

        vm.warp(block.timestamp + 49 hours);

        uint256 v1Before = verifier1.balance;
        uint256 v2Before = verifier2.balance;

        dispute.finalizeOptimistic(taskId);

        uint256 totalVerifierReward = (verifier1.balance - v1Before) + (verifier2.balance - v2Before);
        // 10% of 5 ether reward = 0.5 ether
        uint256 expectedPool = (5 ether * 10) / 100;
        // Allow 1 wei rounding error per verifier
        assertApproxEqAbs(totalVerifierReward, expectedPool, 2);
    }

    // ============ Auto-Slash Tests ============

    function test_triggerScoreBasedSlash_lowScores() public {
        bytes32 taskId = _publishAndPropose();

        // Verifiers give very low scores (below SLASH_THRESHOLD of 30)
        _commitAndReveal(taskId, verifier1, 10, keccak256("s1"));
        _commitAndReveal(taskId, verifier2, 20, keccak256("s2"));
        _commitAndReveal(taskId, verifier3, 15, keccak256("s3"));

        vm.warp(block.timestamp + 49 hours);

        uint256 v1Before = verifier1.balance;

        dispute.triggerScoreBasedSlash(taskId);

        // Task should be slashed
        assertEq(
            uint256(dispute.taskStatus(taskId)),
            uint256(DisputeResolution.TaskStatus.Slashed)
        );
        // Verifiers should receive slashed stake
        assertGt(verifier1.balance, v1Before);
    }

    function test_triggerScoreBasedSlash_revert_aboveThreshold() public {
        bytes32 taskId = _publishAndPropose();

        // Scores above slash threshold (30)
        _commitAndReveal(taskId, verifier1, 40, keccak256("s1"));
        _commitAndReveal(taskId, verifier2, 45, keccak256("s2"));

        vm.warp(block.timestamp + 49 hours);

        vm.expectRevert("Dispute: score above slash threshold");
        dispute.triggerScoreBasedSlash(taskId);
    }

    function test_triggerScoreBasedSlash_revert_challengePeriodActive() public {
        bytes32 taskId = _publishAndPropose();

        _commitAndReveal(taskId, verifier1, 10, keccak256("s1"));

        // Don't warp past challenge period
        vm.expectRevert("Dispute: challenge period active");
        dispute.triggerScoreBasedSlash(taskId);
    }

    function test_triggerScoreBasedSlash_publisherRefunded() public {
        bytes32 taskId = _publishAndPropose();

        _commitAndReveal(taskId, verifier1, 10, keccak256("s1"));
        _commitAndReveal(taskId, verifier2, 20, keccak256("s2"));

        vm.warp(block.timestamp + 49 hours);

        uint256 publisherBefore = publisher.balance;
        dispute.triggerScoreBasedSlash(taskId);

        // Publisher should get reward back
        assertEq(publisher.balance, publisherBefore + 5 ether);
    }

    // ============ Helpers ============

    function _publishAndPropose() internal returns (bytes32) {
        vm.prank(publisher);
        bytes32 taskId = dispute.publishTask{value: 5 ether}(
            CODE_HASH, "no_reentrancy", 48 hours, 1 ether
        );
        vm.prank(proposer);
        dispute.submitProposal{value: 2 ether}(
            taskId,
            keccak256("state"),
            keccak256("evidence"),
            keccak256("trace"),
            "ipfs://QmEvidence"
        );
        return taskId;
    }

    function _commitAndReveal(
        bytes32 taskId,
        address verifier,
        uint256 score,
        bytes32 salt
    ) internal {
        bytes32 commitHash = keccak256(abi.encodePacked(score, salt));
        uint256 index = dispute.getVerifierScoreCount(taskId);

        vm.prank(verifier);
        dispute.commitScore(taskId, commitHash);

        vm.prank(verifier);
        dispute.revealScore(taskId, index, score, salt);
    }
}
