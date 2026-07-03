// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/Registry.sol";
import "../src/DisputeResolution.sol";
import "../src/ArbitrationCommittee.sol";
import "../src/StakeOracle.sol";
import "./mocks/VulnerableVault.sol";
import "./mocks/ReentrancyAttacker.sol";

/// @title E2EAgentInteractionTest - 端到端多Agent交互集成测试
/// @notice 模拟完整的去中心化AI审计生态系统运行周期
/// @dev 包含: 注册→任务发布→竞争提交→验证评分→挑战→仲裁→结算→声誉更新
contract E2EAgentInteractionTest is Test {
    // ============ 合约 ============
    Registry public registry;
    DisputeResolution public dispute;
    ArbitrationCommittee public committee;
    StakeOracle public oracle;

    // ============ 生态参与者 ============
    address public projectAlpha = makeAddr("projectAlpha");
    address public projectBeta = makeAddr("projectBeta");

    // Proposer Agent团队
    address public auditFirmA = makeAddr("auditFirmA");   // 顶级审计团队
    address public auditFirmB = makeAddr("auditFirmB");   // 中等审计团队
    address public soloAuditor = makeAddr("soloAuditor"); // 独立审计员

    // Challenger Agent团队
    address public bugHunter1 = makeAddr("bugHunter1");   // 专业漏洞猎人
    address public bugHunter2 = makeAddr("bugHunter2");   // 新手猎人

    // Verifier Agent团队
    address public reviewer1 = makeAddr("reviewer1");
    address public reviewer2 = makeAddr("reviewer2");
    address public reviewer3 = makeAddr("reviewer3");
    address public reviewer4 = makeAddr("reviewer4");

    // Arbitration Committee
    uint256 constant ARB1_KEY = 0xE001;
    uint256 constant ARB2_KEY = 0xE002;
    uint256 constant ARB3_KEY = 0xE003;
    uint256 constant ARB4_KEY = 0xE004;
    uint256 constant ARB5_KEY = 0xE005;
    address public arbNode1;
    address public arbNode2;
    address public arbNode3;
    address public arbNode4;
    address public arbNode5;

    function setUp() public {
        arbNode1 = vm.addr(ARB1_KEY);
        arbNode2 = vm.addr(ARB2_KEY);
        arbNode3 = vm.addr(ARB3_KEY);
        arbNode4 = vm.addr(ARB4_KEY);
        arbNode5 = vm.addr(ARB5_KEY);

        // Deploy protocol
        registry = new Registry();
        dispute = new DisputeResolution(address(registry));
        oracle = new StakeOracle(7000, 9500, 2 ether, 0.1 ether, 1 ether, 6000, address(this));
        committee = new ArbitrationCommittee(address(registry), 3, 200, 6700);

        registry.setDisputeContract(address(dispute));
        dispute.setArbitrationCommittee(address(committee));
        dispute.setStakeOracle(address(oracle));
        committee.setDisputeContract(address(dispute));

        // Fund ecosystem
        _fundEcosystem();
        // Register all agents
        _registerEcosystem();
    }

    function _fundEcosystem() internal {
        vm.deal(projectAlpha, 500 ether);
        vm.deal(projectBeta, 500 ether);
        vm.deal(auditFirmA, 200 ether);
        vm.deal(auditFirmB, 200 ether);
        vm.deal(soloAuditor, 100 ether);
        vm.deal(bugHunter1, 100 ether);
        vm.deal(bugHunter2, 100 ether);
        vm.deal(reviewer1, 20 ether);
        vm.deal(reviewer2, 20 ether);
        vm.deal(reviewer3, 20 ether);
        vm.deal(reviewer4, 20 ether);
        vm.deal(arbNode1, 20 ether);
        vm.deal(arbNode2, 20 ether);
        vm.deal(arbNode3, 20 ether);
        vm.deal(arbNode4, 20 ether);
        vm.deal(arbNode5, 20 ether);
    }

    function _registerEcosystem() internal {
        // Proposers - high stake
        vm.prank(auditFirmA);
        registry.register{value: 10 ether}(keccak256("did:auditFirmA:gpt4-security"), hex"01");
        vm.prank(auditFirmB);
        registry.register{value: 8 ether}(keccak256("did:auditFirmB:claude-audit"), hex"02");
        vm.prank(soloAuditor);
        registry.register{value: 5 ether}(keccak256("did:solo:slither-mythril"), hex"03");

        // Challengers - medium stake
        vm.prank(bugHunter1);
        registry.register{value: 5 ether}(keccak256("did:hunter1:smartpoc"), hex"04");
        vm.prank(bugHunter2);
        registry.register{value: 3 ether}(keccak256("did:hunter2:basic"), hex"05");

        // Verifiers - minimum stake
        vm.prank(reviewer1);
        registry.register{value: 2 ether}(keccak256("did:rev1"), hex"06");
        vm.prank(reviewer2);
        registry.register{value: 2 ether}(keccak256("did:rev2"), hex"07");
        vm.prank(reviewer3);
        registry.register{value: 2 ether}(keccak256("did:rev3"), hex"08");
        vm.prank(reviewer4);
        registry.register{value: 2 ether}(keccak256("did:rev4"), hex"09");

        // Arbitrators - high stake + boosted reputation
        address[5] memory arbs = [arbNode1, arbNode2, arbNode3, arbNode4, arbNode5];
        for (uint256 i = 0; i < 5; i++) {
            vm.prank(arbs[i]);
            registry.register{value: 5 ether}(
                keccak256(abi.encodePacked("did:arbNode", i)), hex"0A"
            );
            vm.prank(address(dispute));
            registry.updateReputation(arbs[i], 200); // rep = 300
        }
    }

    // ══════════════════════════════════════════════════════════════
    // E2E场景A: 完整乐观路径 - 高质量审计无争议通过
    // ══════════════════════════════════════════════════════════════

    function test_e2e_scenarioA_optimisticSuccess() public {
        // 1. 项目方发布审计任务
        vm.prank(projectAlpha);
        bytes32 taskId = dispute.publishTask{value: 20 ether}(
            keccak256("contract DeFiVault { ... }"),
            "no_reentrancy;no_flash_loan_manipulation;admin_timelock_enforced",
            48 hours,
            3 ether
        );

        // 2. 顶级审计团队A抢先提交
        vm.prank(auditFirmA);
        dispute.submitProposal{value: 5 ether}(
            taskId,
            keccak256("comprehensive_state_analysis"),
            keccak256("slither_mythril_manticore_results"),
            keccak256("full_symbolic_execution_trace"),
            "ipfs://QmAuditFirmA_FullReport_v2"
        );

        // 3. 四个Verifier独立评分
        _commitReveal(taskId, reviewer1, 88, keccak256("r1_salt"));
        _commitReveal(taskId, reviewer2, 92, keccak256("r2_salt"));
        _commitReveal(taskId, reviewer3, 85, keccak256("r3_salt"));
        _commitReveal(taskId, reviewer4, 90, keccak256("r4_salt"));

        // 4. 48小时无挑战
        vm.warp(block.timestamp + 49 hours);

        // 5. 乐观最终化
        uint256 firmABal = auditFirmA.balance;
        uint256 r1Bal = reviewer1.balance;

        dispute.finalizeOptimistic(taskId);

        // 验证: 审计团队获得奖励
        assertGt(auditFirmA.balance, firmABal);
        // 验证: Verifier获得Shapley分配
        assertGt(reviewer1.balance, r1Bal);
        // 验证: 任务最终化
        assertEq(uint256(dispute.taskStatus(taskId)), uint256(DisputeResolution.TaskStatus.Finalized));
        // 验证: 声誉提升
        IRegistry.AgentInfo memory firmInfo = registry.getAgent(auditFirmA);
        assertGt(firmInfo.reputation, 100);
    }

    // ══════════════════════════════════════════════════════════════
    // E2E场景B: 挑战成功路径 - 漏洞猎人发现审计遗漏
    // ══════════════════════════════════════════════════════════════

    function test_e2e_scenarioB_challengeUpheld() public {
        // 1. 项目方发布
        vm.prank(projectBeta);
        bytes32 taskId = dispute.publishTask{value: 15 ether}(
            keccak256("contract VulnerablePool { ... }"),
            "no_reentrancy;no_price_oracle_manipulation",
            48 hours,
            3 ether
        );

        // 2. 中等审计团队B提交 (遗漏了重入漏洞)
        vm.prank(auditFirmB);
        dispute.submitProposal{value: 5 ether}(
            taskId,
            keccak256("incomplete_analysis"),
            keccak256("partial_evidence"),
            keccak256("shallow_trace"),
            "ipfs://QmAuditFirmB_MissedReentrancy"
        );

        // 3. 专业漏洞猎人发现重入漏洞，生成PoC
        vm.prank(bugHunter1);
        dispute.raiseChallenge{value: 3 ether}(
            taskId,
            DisputeResolution.ChallengeType.FalseNegative,
            "ipfs://QmReentrancyPoC_Foundry_Test",
            keccak256("forge_test_exploit_reentrancy"),
            "VulnerablePool.withdraw() line 45: external call before state update"
        );

        // 4. 仲裁委员会选举
        vm.prank(bugHunter1);
        dispute.selectArbitrationCommittee(taskId);
        address[] memory selected = committee.getCommittee(taskId);

        // 5. 沙箱重放: PoC通过 → 挑战成立
        uint256 hunterBal = bugHunter1.balance;
        uint256 firmBBal = auditFirmB.balance;

        bytes[] memory sigs = _signArbitration(taskId, true, keccak256("poc_pass_trace"), selected, 2);
        dispute.submitArbitrationResult(taskId, true, keccak256("poc_pass_trace"), sigs);

        // 验证: 漏洞猎人获得奖励
        assertGt(bugHunter1.balance, hunterBal);
        // 验证: 审计团队B被罚没
        assertEq(auditFirmB.balance, firmBBal); // 没有退款
        // 验证: 声誉变化
        IRegistry.AgentInfo memory hunterInfo = registry.getAgent(bugHunter1);
        assertGt(hunterInfo.reputation, 100); // 猎人声誉提升
        IRegistry.AgentInfo memory firmBInfo = registry.getAgent(auditFirmB);
        assertLt(firmBInfo.reputation, 100); // 审计团队声誉下降
    }

    // ══════════════════════════════════════════════════════════════
    // E2E场景C: 无效挑战 - 新手猎人误判被罚
    // ══════════════════════════════════════════════════════════════

    function test_e2e_scenarioC_invalidChallengeDismissed() public {
        // 1+2. 发布+诚实审计
        vm.prank(projectAlpha);
        bytes32 taskId = dispute.publishTask{value: 10 ether}(
            keccak256("contract SafeVault { ... }"),
            "no_reentrancy",
            48 hours,
            3 ether
        );
        vm.prank(auditFirmA);
        dispute.submitProposal{value: 5 ether}(
            taskId,
            keccak256("thorough_analysis"),
            keccak256("complete_evidence"),
            keccak256("full_trace"),
            "ipfs://QmCorrectAudit"
        );

        // 3. 新手猎人误以为发现漏洞，提交无效PoC
        vm.prank(bugHunter2);
        dispute.raiseChallenge{value: 3 ether}(
            taskId,
            DisputeResolution.ChallengeType.FalseNegative,
            "ipfs://QmBrokenPoC_DoesNotCompile",
            keccak256("broken_test_file"),
            "Alleged reentrancy but PoC has compilation errors"
        );

        // 4. 仲裁: PoC编译失败 → 挑战不成立
        vm.prank(bugHunter2);
        dispute.selectArbitrationCommittee(taskId);
        address[] memory selected = committee.getCommittee(taskId);

        uint256 firmABal = auditFirmA.balance;
        uint256 hunter2Bal = bugHunter2.balance;

        bytes[] memory sigs = _signArbitration(taskId, false, keccak256("poc_compile_fail"), selected, 2);
        dispute.submitArbitrationResult(taskId, false, keccak256("poc_compile_fail"), sigs);

        // 验证: 审计团队A获得奖励+bonus
        assertGt(auditFirmA.balance, firmABal);
        // 验证: 新手猎人被罚没
        assertEq(bugHunter2.balance, hunter2Bal); // 质押被没收
        IRegistry.AgentInfo memory hunter2Info = registry.getAgent(bugHunter2);
        assertLt(hunter2Info.reputation, 100);
    }

    // ══════════════════════════════════════════════════════════════
    // E2E场景D: 多轮审计生态演化 - 声誉积累
    // ══════════════════════════════════════════════════════════════

    function test_e2e_scenarioD_reputationEvolution() public {
        // 第一轮: auditFirmA成功审计
        vm.prank(projectAlpha);
        bytes32 task1 = dispute.publishTask{value: 10 ether}(
            keccak256("contract1"), "no_reentrancy", 48 hours, 1 ether
        );
        vm.prank(auditFirmA);
        dispute.submitProposal{value: 5 ether}(
            task1, keccak256("s1"), keccak256("e1"), keccak256("t1"), "ipfs://Qm1"
        );
        vm.warp(block.timestamp + 49 hours);
        dispute.finalizeOptimistic(task1);

        IRegistry.AgentInfo memory afterRound1 = registry.getAgent(auditFirmA);
        uint256 rep1 = afterRound1.reputation;
        assertGt(rep1, 100); // 声誉提升

        // 第二轮: auditFirmA再次成功
        vm.prank(projectBeta);
        bytes32 task2 = dispute.publishTask{value: 10 ether}(
            keccak256("contract2"), "no_reentrancy", 48 hours, 1 ether
        );
        vm.prank(auditFirmA);
        dispute.submitProposal{value: 5 ether}(
            task2, keccak256("s2"), keccak256("e2"), keccak256("t2"), "ipfs://Qm2"
        );
        vm.warp(block.timestamp + 49 hours);
        dispute.finalizeOptimistic(task2);

        IRegistry.AgentInfo memory afterRound2 = registry.getAgent(auditFirmA);
        assertGt(afterRound2.reputation, rep1); // 声誉持续增长

        // 权重也随之增长
        uint256 weight = registry.getWeight(auditFirmA);
        assertGt(weight, 10 ether * 100); // 超过初始权重
    }

    // ══════════════════════════════════════════════════════════════
    // E2E场景E: 实际PoC重放 - 重入攻击端到端验证
    // ══════════════════════════════════════════════════════════════

    function test_e2e_scenarioE_actualPoCExecution() public {
        // 部署漏洞合约 (模拟链上目标)
        VulnerableVault vault = new VulnerableVault();
        address victim = makeAddr("defi_user");
        vm.deal(victim, 50 ether);
        vm.prank(victim);
        vault.deposit{value: 50 ether}();

        // Challenger Agent自动生成PoC并在本地验证
        address pocExecutor = makeAddr("poc_executor");
        vm.deal(pocExecutor, 5 ether);

        vm.startPrank(pocExecutor);
        ReentrancyAttacker exploit = new ReentrancyAttacker(address(vault), 10);
        exploit.attack{value: 2 ether}(2 ether);
        exploit.drain();
        vm.stopPrank();

        // PoC验证: 攻击成功
        assertGt(pocExecutor.balance, 5 ether, "PoC proves vulnerability exists");
        assertLt(address(vault).balance, 50 ether, "Vault funds drained");

        // 这个PoC结果会被编码为replayTraceHash提交到链上
        bytes32 replayTrace = keccak256(abi.encodePacked(
            address(vault),
            address(exploit),
            pocExecutor.balance,
            address(vault).balance
        ));
        assertTrue(replayTrace != bytes32(0), "Replay trace generated");
    }

    // ============ Helpers ============

    function _commitReveal(bytes32 taskId, address verifier, uint256 score, bytes32 salt) internal {
        bytes32 commitHash = keccak256(abi.encodePacked(score, salt));
        uint256 idx = dispute.getVerifierScoreCount(taskId);
        vm.prank(verifier);
        dispute.commitScore(taskId, commitHash);
        vm.prank(verifier);
        dispute.revealScore(taskId, idx, score, salt);
    }

    function _signArbitration(
        bytes32 taskId, bool upheld, bytes32 replayHash,
        address[] memory selected, uint256 count
    ) internal view returns (bytes[] memory) {
        bytes32 structHash = keccak256(abi.encode(
            committee.ARBITRATION_TYPEHASH(), taskId, upheld, replayHash
        ));
        bytes32 digest = keccak256(abi.encodePacked(
            "\x19\x01", committee.DOMAIN_SEPARATOR(), structHash
        ));
        bytes[] memory sigs = new bytes[](count);
        for (uint256 i = 0; i < count; i++) {
            uint256 key = _getKey(selected[i]);
            (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
            sigs[i] = abi.encodePacked(r, s, v);
        }
        return sigs;
    }

    function _getKey(address member) internal view returns (uint256) {
        if (member == arbNode1) return ARB1_KEY;
        if (member == arbNode2) return ARB2_KEY;
        if (member == arbNode3) return ARB3_KEY;
        if (member == arbNode4) return ARB4_KEY;
        if (member == arbNode5) return ARB5_KEY;
        revert("Unknown arb node");
    }
}
