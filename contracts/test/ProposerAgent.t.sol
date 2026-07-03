// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/Registry.sol";
import "../src/DisputeResolution.sol";
import "../src/ArbitrationCommittee.sol";
import "../src/StakeOracle.sol";

/// @title ProposerAgentTest - 模拟Proposer Agent的完整行为测试
/// @notice 覆盖诚实审计、偷懒审计、质押不足、重复提交等场景
contract ProposerAgentTest is Test {
    Registry public registry;
    DisputeResolution public dispute;
    StakeOracle public oracle;

    address public projectTeam = makeAddr("projectTeam");
    address public honestProposer = makeAddr("honestProposer");
    address public lazyProposer = makeAddr("lazyProposer");
    address public poorProposer = makeAddr("poorProposer");
    address public unregisteredAgent = makeAddr("unregisteredAgent");

    bytes32 constant CODE_HASH = keccak256("contract Target { function foo() external {} }");

    function setUp() public {
        registry = new Registry();
        dispute = new DisputeResolution(address(registry));
        oracle = new StakeOracle(7000, 9500, 2 ether, 0.1 ether, 1 ether, 6000, address(this));

        registry.setDisputeContract(address(dispute));
        dispute.setStakeOracle(address(oracle));

        // Fund accounts
        vm.deal(projectTeam, 200 ether);
        vm.deal(honestProposer, 100 ether);
        vm.deal(lazyProposer, 100 ether);
        vm.deal(poorProposer, 2 ether); // Insufficient for oracle min
        vm.deal(unregisteredAgent, 100 ether);

        // Register agents
        vm.prank(honestProposer);
        registry.register{value: 5 ether}(keccak256("did:honest"), hex"01");
        vm.prank(lazyProposer);
        registry.register{value: 5 ether}(keccak256("did:lazy"), hex"02");
        vm.prank(poorProposer);
        registry.register{value: 1 ether}(keccak256("did:poor"), hex"03");
    }

    // ============ 诚实Proposer Agent行为 ============

    /// @notice 诚实Proposer提交完整审计报告，质押满足Oracle动态门槛
    function test_honestProposer_submitsValidProposal() public {
        bytes32 taskId = _publishTask(5 ether, 1 ether);

        // Oracle要求 ~2.857 ETH，提交5 ETH满足要求
        vm.prank(honestProposer);
        dispute.submitProposal{value: 5 ether}(
            taskId,
            keccak256("thorough_state_root"),
            keccak256("complete_evidence_ipfs"),
            keccak256("full_execution_trace"),
            "ipfs://QmCompleteAuditReport"
        );

        assertEq(uint256(dispute.taskStatus(taskId)), uint256(DisputeResolution.TaskStatus.Proposed));

        DisputeResolution.Proposal memory prop = dispute.getProposal(taskId);
        assertEq(prop.proposer, honestProposer);
        assertEq(prop.stake, 5 ether);
        assertGt(prop.challengeDeadline, block.timestamp);
    }

    /// @notice 诚实Proposer在无挑战情况下成功获得奖励
    function test_honestProposer_collectsRewardAfterFinalization() public {
        bytes32 taskId = _publishTask(10 ether, 1 ether);

        vm.prank(honestProposer);
        dispute.submitProposal{value: 5 ether}(
            taskId,
            keccak256("state"),
            keccak256("evidence"),
            keccak256("trace"),
            "ipfs://Qm"
        );

        // 跳过挑战期
        vm.warp(block.timestamp + 49 hours);

        uint256 balBefore = honestProposer.balance;
        dispute.finalizeOptimistic(taskId);

        // Proposer获得: 质押返还(5 ETH) + 奖励(10 ETH) = 15 ETH (减去verifier分成)
        uint256 gain = honestProposer.balance - balBefore;
        assertGt(gain, 14 ether); // 至少14 ETH (无verifier时全额)
        assertEq(uint256(dispute.taskStatus(taskId)), uint256(DisputeResolution.TaskStatus.Finalized));
    }

    /// @notice Proposer声誉在成功最终化后提升
    function test_honestProposer_reputationIncreasesOnSuccess() public {
        bytes32 taskId = _publishTask(5 ether, 1 ether);

        vm.prank(honestProposer);
        dispute.submitProposal{value: 5 ether}(
            taskId, keccak256("s"), keccak256("e"), keccak256("t"), "ipfs://Qm"
        );

        IRegistry.AgentInfo memory infoBefore = registry.getAgent(honestProposer);
        vm.warp(block.timestamp + 49 hours);
        dispute.finalizeOptimistic(taskId);

        IRegistry.AgentInfo memory infoAfter = registry.getAgent(honestProposer);
        assertGt(infoAfter.reputation, infoBefore.reputation);
    }

    // ============ 偷懒Proposer Agent行为 (Shirking) ============

    /// @notice 偷懒Proposer提交低质量审计，被低分自动罚没
    function test_lazyProposer_autoSlashedByLowScores() public {
        bytes32 taskId = _publishTask(5 ether, 1 ether);

        // 注册verifier
        address v1 = makeAddr("v1");
        vm.deal(v1, 10 ether);
        vm.prank(v1);
        registry.register{value: 1 ether}(keccak256("did:v1"), hex"05");

        vm.prank(lazyProposer);
        dispute.submitProposal{value: 5 ether}(
            taskId,
            keccak256("lazy_no_effort"),
            keccak256("empty_evidence"),
            keccak256("no_trace"),
            "ipfs://QmLazy"
        );

        // Verifier给出极低分
        bytes32 salt = keccak256("salt");
        bytes32 commitHash = keccak256(abi.encodePacked(uint256(10), salt));
        vm.prank(v1);
        dispute.commitScore(taskId, commitHash);
        vm.prank(v1);
        dispute.revealScore(taskId, 0, 10, salt);

        vm.warp(block.timestamp + 49 hours);

        uint256 lazyBalBefore = lazyProposer.balance;
        dispute.triggerScoreBasedSlash(taskId);

        // 偷懒者被罚没，余额不增加
        assertEq(uint256(dispute.taskStatus(taskId)), uint256(DisputeResolution.TaskStatus.Slashed));
        assertEq(lazyProposer.balance, lazyBalBefore); // 质押被没收
    }

    // ============ 质押不足场景 ============

    /// @notice 质押低于Oracle动态门槛时被拒绝
    function test_proposer_revert_insufficientStakeVsOracle() public {
        bytes32 taskId = _publishTask(5 ether, 1 ether);

        // Oracle要求 ~2.857 ETH，尝试用2 ETH提交
        vm.prank(honestProposer);
        vm.expectRevert("Dispute: insufficient proposer stake");
        dispute.submitProposal{value: 2 ether}(
            taskId, keccak256("s"), keccak256("e"), keccak256("t"), "ipfs://Qm"
        );
    }

    /// @notice 质押低于TaskSpec最低要求时被拒绝
    function test_proposer_revert_insufficientStakeVsTaskSpec() public {
        // 发布任务要求最低5 ETH质押
        bytes32 taskId = _publishTask(5 ether, 5 ether);

        vm.prank(honestProposer);
        vm.expectRevert("Dispute: insufficient proposer stake");
        dispute.submitProposal{value: 3 ether}(
            taskId, keccak256("s"), keccak256("e"), keccak256("t"), "ipfs://Qm"
        );
    }

    // ============ 未注册Agent场景 ============

    /// @notice 未注册Agent无法提交proposal
    function test_proposer_revert_unregisteredAgent() public {
        bytes32 taskId = _publishTask(5 ether, 1 ether);

        vm.prank(unregisteredAgent);
        vm.expectRevert("Dispute: proposer not registered");
        dispute.submitProposal{value: 5 ether}(
            taskId, keccak256("s"), keccak256("e"), keccak256("t"), "ipfs://Qm"
        );
    }

    // ============ 竞争场景 ============

    /// @notice 第二个Proposer无法提交已被占用的任务
    function test_proposer_revert_taskAlreadyProposed() public {
        bytes32 taskId = _publishTask(5 ether, 1 ether);

        vm.prank(honestProposer);
        dispute.submitProposal{value: 5 ether}(
            taskId, keccak256("s"), keccak256("e"), keccak256("t"), "ipfs://Qm"
        );

        vm.prank(lazyProposer);
        vm.expectRevert("Dispute: task not open");
        dispute.submitProposal{value: 5 ether}(
            taskId, keccak256("s2"), keccak256("e2"), keccak256("t2"), "ipfs://Qm2"
        );
    }

    /// @notice 不能在非Open状态的任务上提交
    function test_proposer_revert_taskNotOpen() public {
        bytes32 taskId = _publishTask(5 ether, 1 ether);

        // 先提交一个proposal
        vm.prank(honestProposer);
        dispute.submitProposal{value: 5 ether}(
            taskId, keccak256("s"), keccak256("e"), keccak256("t"), "ipfs://Qm"
        );

        // 任务已经是Proposed状态
        vm.prank(lazyProposer);
        vm.expectRevert("Dispute: task not open");
        dispute.submitProposal{value: 5 ether}(
            taskId, keccak256("s"), keccak256("e"), keccak256("t"), "ipfs://Qm"
        );
    }

    // ============ Helpers ============

    function _publishTask(uint256 reward, uint256 minStake) internal returns (bytes32) {
        vm.prank(projectTeam);
        return dispute.publishTask{value: reward}(
            CODE_HASH, "no_reentrancy;access_control", 48 hours, minStake
        );
    }
}
