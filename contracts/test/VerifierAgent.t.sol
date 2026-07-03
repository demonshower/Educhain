// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/Registry.sol";
import "../src/DisputeResolution.sol";

/// @title VerifierAgentTest - 模拟Verifier Agent的Commit-Reveal评分行为
/// @notice 覆盖正常评分、作弊评分、共谋检测、Shapley奖励分配
contract VerifierAgentTest is Test {
    Registry public registry;
    DisputeResolution public dispute;

    address public projectTeam = makeAddr("projectTeam");
    address public proposer = makeAddr("proposer");
    address public verifierA = makeAddr("verifierA"); // 诚实验证者
    address public verifierB = makeAddr("verifierB"); // 诚实验证者
    address public verifierC = makeAddr("verifierC"); // 偏离验证者
    address public verifierD = makeAddr("verifierD"); // 未注册验证者

    bytes32 constant CODE_HASH = keccak256("contract Target {}");

    function setUp() public {
        registry = new Registry();
        dispute = new DisputeResolution(address(registry));
        registry.setDisputeContract(address(dispute));

        vm.deal(projectTeam, 200 ether);
        vm.deal(proposer, 100 ether);
        vm.deal(verifierA, 10 ether);
        vm.deal(verifierB, 10 ether);
        vm.deal(verifierC, 10 ether);
        vm.deal(verifierD, 10 ether);

        vm.prank(proposer);
        registry.register{value: 2 ether}(keccak256("did:proposer"), hex"01");
        vm.prank(verifierA);
        registry.register{value: 1 ether}(keccak256("did:vA"), hex"02");
        vm.prank(verifierB);
        registry.register{value: 1 ether}(keccak256("did:vB"), hex"03");
        vm.prank(verifierC);
        registry.register{value: 1 ether}(keccak256("did:vC"), hex"04");
        // verifierD intentionally NOT registered
    }

    // ============ Commit-Reveal 正常流程 ============

    /// @notice Verifier正常提交commit并reveal
    function test_verifier_commitAndReveal() public {
        bytes32 taskId = _publishAndPropose();

        uint256 score = 85;
        bytes32 salt = keccak256("my_secret_salt");
        bytes32 commitHash = keccak256(abi.encodePacked(score, salt));

        // Commit phase
        vm.prank(verifierA);
        dispute.commitScore(taskId, commitHash);

        assertEq(dispute.getVerifierScoreCount(taskId), 1);

        // Reveal phase
        vm.prank(verifierA);
        dispute.revealScore(taskId, 0, score, salt);
    }

    /// @notice 多个Verifier独立评分
    function test_verifier_multipleIndependentScores() public {
        bytes32 taskId = _publishAndPropose();

        _commitAndReveal(taskId, verifierA, 80, keccak256("saltA"));
        _commitAndReveal(taskId, verifierB, 75, keccak256("saltB"));
        _commitAndReveal(taskId, verifierC, 60, keccak256("saltC"));

        assertEq(dispute.getVerifierScoreCount(taskId), 3);
    }

    // ============ Commit-Reveal 安全性 ============

    /// @notice Reveal时hash不匹配被拒绝 (防止事后修改分数)
    function test_verifier_revert_invalidReveal() public {
        bytes32 taskId = _publishAndPropose();

        uint256 realScore = 85;
        bytes32 salt = keccak256("salt");
        bytes32 commitHash = keccak256(abi.encodePacked(realScore, salt));

        vm.prank(verifierA);
        dispute.commitScore(taskId, commitHash);

        // 尝试reveal不同的分数
        vm.prank(verifierA);
        vm.expectRevert("Dispute: invalid reveal");
        dispute.revealScore(taskId, 0, 95, salt); // 95 != 85
    }

    /// @notice 不能重复reveal
    function test_verifier_revert_doubleReveal() public {
        bytes32 taskId = _publishAndPropose();

        uint256 score = 80;
        bytes32 salt = keccak256("salt");
        _commitAndReveal(taskId, verifierA, score, salt);

        // 尝试再次reveal
        vm.prank(verifierA);
        vm.expectRevert("Dispute: already revealed");
        dispute.revealScore(taskId, 0, score, salt);
    }

    /// @notice 分数超过100被拒绝
    function test_verifier_revert_scoreOutOfRange() public {
        bytes32 taskId = _publishAndPropose();

        uint256 score = 101;
        bytes32 salt = keccak256("salt");
        bytes32 commitHash = keccak256(abi.encodePacked(score, salt));

        vm.prank(verifierA);
        dispute.commitScore(taskId, commitHash);

        vm.prank(verifierA);
        vm.expectRevert("Dispute: score out of range");
        dispute.revealScore(taskId, 0, score, salt);
    }

    /// @notice 未注册Agent不能评分
    function test_verifier_revert_unregistered() public {
        bytes32 taskId = _publishAndPropose();

        vm.prank(verifierD);
        vm.expectRevert("Dispute: verifier not registered");
        dispute.commitScore(taskId, keccak256("fake"));
    }

    /// @notice 他人不能reveal别人的分数
    function test_verifier_revert_revealByOther() public {
        bytes32 taskId = _publishAndPropose();

        uint256 score = 80;
        bytes32 salt = keccak256("salt");
        bytes32 commitHash = keccak256(abi.encodePacked(score, salt));

        vm.prank(verifierA);
        dispute.commitScore(taskId, commitHash);

        // verifierB尝试reveal verifierA的分数
        vm.prank(verifierB);
        vm.expectRevert("Dispute: not your score");
        dispute.revealScore(taskId, 0, score, salt);
    }

    // ============ Shapley价值奖励分配 ============

    /// @notice 接近均值的Verifier获得更高奖励
    function test_verifier_shapleyReward_closerToMeanGetsMore() public {
        bytes32 taskId = _publishAndPropose();

        // A=80, B=80, C=50 → mean=70
        // A偏离10, B偏离10, C偏离20
        _commitAndReveal(taskId, verifierA, 80, keccak256("sA"));
        _commitAndReveal(taskId, verifierB, 80, keccak256("sB"));
        _commitAndReveal(taskId, verifierC, 50, keccak256("sC"));

        vm.warp(block.timestamp + 49 hours);

        uint256 aBalBefore = verifierA.balance;
        uint256 cBalBefore = verifierC.balance;

        dispute.finalizeOptimistic(taskId);

        uint256 aReward = verifierA.balance - aBalBefore;
        uint256 cReward = verifierC.balance - cBalBefore;

        // A更接近均值，获得更多
        assertGt(aReward, cReward);
    }

    /// @notice 所有Verifier评分相同时平均分配
    function test_verifier_shapleyReward_equalScoresEqualRewards() public {
        bytes32 taskId = _publishAndPropose();

        _commitAndReveal(taskId, verifierA, 75, keccak256("sA"));
        _commitAndReveal(taskId, verifierB, 75, keccak256("sB"));
        _commitAndReveal(taskId, verifierC, 75, keccak256("sC"));

        vm.warp(block.timestamp + 49 hours);

        uint256 aBalBefore = verifierA.balance;
        uint256 bBalBefore = verifierB.balance;
        uint256 cBalBefore = verifierC.balance;

        dispute.finalizeOptimistic(taskId);

        uint256 aReward = verifierA.balance - aBalBefore;
        uint256 bReward = verifierB.balance - bBalBefore;
        uint256 cReward = verifierC.balance - cBalBefore;

        // 所有人偏离度相同，奖励相等
        assertEq(aReward, bReward);
        assertEq(bReward, cReward);
    }

    /// @notice Verifier奖励总额 = 10% of reward pool
    function test_verifier_totalRewardEquals10Percent() public {
        bytes32 taskId = _publishAndPropose();

        _commitAndReveal(taskId, verifierA, 80, keccak256("sA"));
        _commitAndReveal(taskId, verifierB, 70, keccak256("sB"));

        vm.warp(block.timestamp + 49 hours);

        uint256 aBalBefore = verifierA.balance;
        uint256 bBalBefore = verifierB.balance;

        dispute.finalizeOptimistic(taskId);

        uint256 totalReward = (verifierA.balance - aBalBefore) + (verifierB.balance - bBalBefore);
        uint256 expectedPool = (10 ether * 10) / 100; // 10% of 10 ETH = 1 ETH

        // 允许1 wei舍入误差
        assertApproxEqAbs(totalReward, expectedPool, 2);
    }

    // ============ 低分触发自动罚没 ============

    /// @notice 平均分低于SLASH_THRESHOLD(30)触发自动罚没
    function test_verifier_lowScoresTriggerAutoSlash() public {
        bytes32 taskId = _publishAndPropose();

        _commitAndReveal(taskId, verifierA, 10, keccak256("sA"));
        _commitAndReveal(taskId, verifierB, 20, keccak256("sB"));
        _commitAndReveal(taskId, verifierC, 15, keccak256("sC"));

        vm.warp(block.timestamp + 49 hours);

        dispute.triggerScoreBasedSlash(taskId);
        assertEq(uint256(dispute.taskStatus(taskId)), uint256(DisputeResolution.TaskStatus.Slashed));
    }

    /// @notice 平均分在SLASH_THRESHOLD和SCORE_THRESHOLD之间：不能finalize也不能slash
    function test_verifier_midScores_cannotFinalizeOrSlash() public {
        bytes32 taskId = _publishAndPropose();

        // 平均分 = 40 (> SLASH_THRESHOLD=30, < SCORE_THRESHOLD=50)
        _commitAndReveal(taskId, verifierA, 40, keccak256("sA"));
        _commitAndReveal(taskId, verifierB, 40, keccak256("sB"));

        vm.warp(block.timestamp + 49 hours);

        // 不能finalize (分数低于50)
        vm.expectRevert("Dispute: verifier scores below threshold");
        dispute.finalizeOptimistic(taskId);

        // 不能auto-slash (分数高于30)
        vm.expectRevert("Dispute: score above slash threshold");
        dispute.triggerScoreBasedSlash(taskId);
    }

    // ============ Helpers ============

    function _publishAndPropose() internal returns (bytes32) {
        vm.prank(projectTeam);
        bytes32 taskId = dispute.publishTask{value: 10 ether}(
            CODE_HASH, "no_reentrancy", 48 hours, 1 ether
        );
        vm.prank(proposer);
        dispute.submitProposal{value: 3 ether}(
            taskId, keccak256("state"), keccak256("evidence"), keccak256("trace"), "ipfs://Qm"
        );
        return taskId;
    }

    function _commitAndReveal(
        bytes32 taskId, address verifier, uint256 score, bytes32 salt
    ) internal {
        bytes32 commitHash = keccak256(abi.encodePacked(score, salt));
        uint256 idx = dispute.getVerifierScoreCount(taskId);

        vm.prank(verifier);
        dispute.commitScore(taskId, commitHash);
        vm.prank(verifier);
        dispute.revealScore(taskId, idx, score, salt);
    }
}
