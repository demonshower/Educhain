// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/Registry.sol";
import "../src/DisputeResolution.sol";
import "../src/ArbitrationCommittee.sol";
import "../src/StakeOracle.sol";

/// @title FullPipelineTest - 完整五阶段争议流水线端到端集成测试
/// @notice 模拟真实场景：多个Proposer/Challenger/Verifier/Arbitrator Agent交互
contract FullPipelineTest is Test {
    // ============ 合约实例 ============
    Registry public registry;
    DisputeResolution public dispute;
    ArbitrationCommittee public committee;
    StakeOracle public oracle;

    // ============ Agent 角色地址 ============
    // 项目方
    address public projectTeam = makeAddr("projectTeam");

    // Proposer Agents (审计提交者)
    address public proposerA = makeAddr("proposerA");  // 诚实审计者
    address public proposerB = makeAddr("proposerB");  // 偷懒审计者(Shirker)

    // Challenger Agents (挑战者)
    address public challengerX = makeAddr("challengerX");  // 发现漏洞的挑战者
    address public challengerY = makeAddr("challengerY");  // 无效挑战者

    // Verifier Agents (验证者)
    address public verifier1 = makeAddr("verifier1");
    address public verifier2 = makeAddr("verifier2");
    address public verifier3 = makeAddr("verifier3");

    // Arbitration Committee Members (仲裁委员会)
    uint256 constant ARB1_KEY = 0xA001;
    uint256 constant ARB2_KEY = 0xA002;
    uint256 constant ARB3_KEY = 0xA003;
    uint256 constant ARB4_KEY = 0xA004;
    uint256 constant ARB5_KEY = 0xA005;
    address public arb1;
    address public arb2;
    address public arb3;
    address public arb4;
    address public arb5;

    // ============ 测试常量 ============
    bytes32 constant VAULT_CODE_HASH = keccak256("contract VulnerableVault { ... }");
    bytes32 constant STATE_ROOT = keccak256("audit_state_root_honest");
    bytes32 constant EVIDENCE_ROOT = keccak256("evidence_ipfs_cid_root");
    bytes32 constant TRACE_ROOT = keccak256("execution_trace_root");
    bytes32 constant SHIRK_STATE_ROOT = keccak256("lazy_audit_no_effort");
    bytes32 constant POC_HASH = keccak256("reentrancy_exploit_code");
    bytes32 constant REPLAY_TRACE = keccak256("sandbox_replay_output_hash");

    // ============ Setup ============
    function setUp() public {
        // 生成仲裁委员会成员地址
        arb1 = vm.addr(ARB1_KEY);
        arb2 = vm.addr(ARB2_KEY);
        arb3 = vm.addr(ARB3_KEY);
        arb4 = vm.addr(ARB4_KEY);
        arb5 = vm.addr(ARB5_KEY);

        // 部署合约
        registry = new Registry();
        dispute = new DisputeResolution(address(registry));
        oracle = new StakeOracle(
            7000, 9500, 2 ether, 0.1 ether, 1 ether, 6000, address(this)
        );
        committee = new ArbitrationCommittee(address(registry), 3, 200, 6700);

        // 连接合约
        registry.setDisputeContract(address(dispute));
        dispute.setArbitrationCommittee(address(committee));
        dispute.setStakeOracle(address(oracle));
        committee.setDisputeContract(address(dispute));

        // 资金分配
        _fundAll();

        // 注册所有Agent
        _registerAllAgents();
    }
// PLACEHOLDER_SETUP_HELPERS

    function _fundAll() internal {
        vm.deal(projectTeam, 200 ether);
        vm.deal(proposerA, 100 ether);
        vm.deal(proposerB, 100 ether);
        vm.deal(challengerX, 100 ether);
        vm.deal(challengerY, 100 ether);
        vm.deal(verifier1, 10 ether);
        vm.deal(verifier2, 10 ether);
        vm.deal(verifier3, 10 ether);
        vm.deal(arb1, 10 ether);
        vm.deal(arb2, 10 ether);
        vm.deal(arb3, 10 ether);
        vm.deal(arb4, 10 ether);
        vm.deal(arb5, 10 ether);
    }

    function _registerAllAgents() internal {
        // Proposer Agents - 高质押
        vm.prank(proposerA);
        registry.register{value: 5 ether}(keccak256("did:proposerA"), hex"01");
        vm.prank(proposerB);
        registry.register{value: 5 ether}(keccak256("did:proposerB"), hex"02");

        // Challenger Agents - 中等质押
        vm.prank(challengerX);
        registry.register{value: 3 ether}(keccak256("did:challengerX"), hex"03");
        vm.prank(challengerY);
        registry.register{value: 3 ether}(keccak256("did:challengerY"), hex"04");

        // Verifier Agents - 最低质押
        vm.prank(verifier1);
        registry.register{value: 1 ether}(keccak256("did:verifier1"), hex"05");
        vm.prank(verifier2);
        registry.register{value: 1 ether}(keccak256("did:verifier2"), hex"06");
        vm.prank(verifier3);
        registry.register{value: 1 ether}(keccak256("did:verifier3"), hex"07");

        // Arbitration Committee - 高质押 + 提升声誉到200+
        address[5] memory arbs = [arb1, arb2, arb3, arb4, arb5];
        for (uint256 i = 0; i < 5; i++) {
            vm.prank(arbs[i]);
            registry.register{value: 3 ether}(
                keccak256(abi.encodePacked("did:arb", i)), hex"08"
            );
            // 提升声誉到250 (初始100 + 150)
            vm.prank(address(dispute));
            registry.updateReputation(arbs[i], 150);
        }
    }

    // ══════════════════════════════════════════════════════════════
    // 场景1: 完整乐观路径 (无挑战，Proposer诚实审计成功)
    // 阶段1→2→3→5a: 发布→提交→验证→乐观最终化
    // ══════════════════════════════════════════════════════════════

    function test_scenario1_optimisticFinalization_honestProposer() public {
        console.log("=== Scenario 1: Honest Proposer Optimistic Path ===");

        // --- 阶段1: 项目方发布审计任务 ---
        console.log("[Phase 1] Project team publishes audit task...");
        vm.prank(projectTeam);
        bytes32 taskId = dispute.publishTask{value: 10 ether}(
            VAULT_CODE_HASH,
            "no_reentrancy;no_price_manipulation;access_control_enforced",
            48 hours,
            3 ether  // 最低质押要求
        );
        assertEq(uint256(dispute.taskStatus(taskId)), uint256(DisputeResolution.TaskStatus.Open));
        console.log("[Phase 1] Task published. Reward pool: 10 ETH");

        // --- 阶段2: Proposer A 提交诚实审计结果 ---
        console.log("[Phase 2] Proposer A submits honest audit...");
        vm.prank(proposerA);
        dispute.submitProposal{value: 5 ether}(
            taskId, STATE_ROOT, EVIDENCE_ROOT, TRACE_ROOT,
            "ipfs://QmHonestAuditEvidencePackage"
        );
        assertEq(uint256(dispute.taskStatus(taskId)), uint256(DisputeResolution.TaskStatus.Proposed));
        console.log("[Phase 2] Proposal submitted. Stake: 5 ETH. Challenge window: 48h");

        // --- 阶段3: 三个Verifier独立评分 (Commit-Reveal) ---
        console.log("[Phase 3] Verifiers scoring via commit-reveal...");
        _verifierCommitReveal(taskId, verifier1, 85, keccak256("salt_v1"));
        _verifierCommitReveal(taskId, verifier2, 78, keccak256("salt_v2"));
        _verifierCommitReveal(taskId, verifier3, 82, keccak256("salt_v3"));
        console.log("[Phase 3] Scores: V1=85, V2=78, V3=82. Avg=81.67 > threshold(50)");

        // --- 阶段5a: 48小时无挑战，乐观最终化 ---
        console.log("[Phase 5a] Warping past challenge period...");
        vm.warp(block.timestamp + 49 hours);

        uint256 proposerBalBefore = proposerA.balance;
        uint256 v1BalBefore = verifier1.balance;

        dispute.finalizeOptimistic(taskId);

        assertEq(uint256(dispute.taskStatus(taskId)), uint256(DisputeResolution.TaskStatus.Finalized));

        // Proposer 获得: 质押返还 + 90%奖励 (10%给Verifier)
        uint256 proposerGain = proposerA.balance - proposerBalBefore;
        assertGt(proposerGain, 0);
        console.log("[Phase 5a] Proposer A finalized. Gain:", proposerGain / 1e18, "ETH");

        // Verifier 获得 Shapley 价值分配
        uint256 v1Gain = verifier1.balance - v1BalBefore;
        assertGt(v1Gain, 0);
        console.log("[Phase 5a] Verifier rewards distributed (Shapley value)");
        console.log("=== Scenario 1 PASSED ===\n");
    }

    // ══════════════════════════════════════════════════════════════
    // 场景2: 挑战成功路径 (Proposer偷懒，Challenger发现漏洞)
    // 阶段1→2→4→5b: 发布→提交→挑战→仲裁(挑战成立)
    // ══════════════════════════════════════════════════════════════

    function test_scenario2_challengeUpheld_shirkerSlashed() public {
        console.log("=== Scenario 2: Shirker Proposer Gets Slashed ===");

        // --- 阶段1: 发布任务 ---
        vm.prank(projectTeam);
        bytes32 taskId = dispute.publishTask{value: 10 ether}(
            VAULT_CODE_HASH,
            "no_reentrancy;no_price_manipulation",
            48 hours,
            3 ether
        );
        console.log("[Phase 1] Task published");

        // --- 阶段2: Proposer B 偷懒提交 (Shirk策略) ---
        console.log("[Phase 2] Proposer B submits lazy audit (shirking)...");
        vm.prank(proposerB);
        dispute.submitProposal{value: 5 ether}(
            taskId, SHIRK_STATE_ROOT, keccak256("lazy_evidence"), keccak256("no_trace"),
            "ipfs://QmLazyAuditNoEffort"
        );
        console.log("[Phase 2] Shirker submitted. Stake at risk: 5 ETH");

        // --- 阶段4: Challenger X 发现重入漏洞，提交PoC ---
        console.log("[Phase 4] Challenger X discovers reentrancy, submitting PoC...");
        vm.prank(challengerX);
        dispute.raiseChallenge{value: 3 ether}(
            taskId,
            DisputeResolution.ChallengeType.FalseNegative,
            "ipfs://QmReentrancyExploitPoC",
            POC_HASH,
            "VulnerableVault.withdraw() has reentrancy: state update after external call"
        );
        assertEq(uint256(dispute.taskStatus(taskId)), uint256(DisputeResolution.TaskStatus.Challenged));
        console.log("[Phase 4] Challenge raised. Type: FalseNegative. Stake: 3 ETH");

        // --- 阶段5b: VRF选择仲裁委员会 ---
        console.log("[Phase 5b] Selecting arbitration committee via VRF...");
        vm.prank(challengerX);
        dispute.selectArbitrationCommittee(taskId);
        address[] memory selectedCommittee = committee.getCommittee(taskId);
        console.log("[Phase 5b] Committee selected:", selectedCommittee.length, "members");

        // --- 阶段5b: 仲裁委员会沙箱重放后签名投票 ---
        console.log("[Phase 5b] Committee signs arbitration vote (challenge UPHELD)...");
        uint256 challengerBalBefore = challengerX.balance;
        uint256 proposerBalBefore = proposerB.balance;

        bytes[] memory sigs = _signArbitrationVotes(
            taskId, true, REPLAY_TRACE, selectedCommittee, 2
        );

        dispute.submitArbitrationResult(taskId, true, REPLAY_TRACE, sigs);

        // 验证结果
        assertEq(uint256(dispute.taskStatus(taskId)), uint256(DisputeResolution.TaskStatus.Slashed));

        uint256 challengerGain = challengerX.balance - challengerBalBefore;
        assertGt(challengerGain, 0);
        console.log("[Phase 5b] Challenge UPHELD. Proposer B slashed.");
        console.log("[Phase 5b] Challenger X reward:", challengerGain / 1e18, "ETH");

        // Proposer B 声誉被扣减
        IRegistry.AgentInfo memory proposerInfo = registry.getAgent(proposerB);
        assertLt(proposerInfo.reputation, 100); // 初始100，被扣50
        console.log("[Phase 5b] Proposer B reputation:", proposerInfo.reputation);
        console.log("=== Scenario 2 PASSED ===\n");
    }

    // ══════════════════════════════════════════════════════════════
    // 场景3: 挑战失败路径 (Challenger提交无效PoC)
    // 阶段1→2→4→5b: 发布→提交→挑战→仲裁(挑战不成立)
    // ══════════════════════════════════════════════════════════════

    function test_scenario3_challengeDismissed_challengerSlashed() public {
        console.log("=== Scenario 3: Invalid Challenge Gets Dismissed ===");

        // 阶段1+2: 发布并提交诚实审计
        vm.prank(projectTeam);
        bytes32 taskId = dispute.publishTask{value: 10 ether}(
            VAULT_CODE_HASH, "no_reentrancy", 48 hours, 3 ether
        );
        vm.prank(proposerA);
        dispute.submitProposal{value: 5 ether}(
            taskId, STATE_ROOT, EVIDENCE_ROOT, TRACE_ROOT, "ipfs://QmHonest"
        );

        // 阶段4: Challenger Y 提交无效挑战
        console.log("[Phase 4] Challenger Y submits invalid challenge...");
        vm.prank(challengerY);
        dispute.raiseChallenge{value: 3 ether}(
            taskId,
            DisputeResolution.ChallengeType.FalsePositive,
            "ipfs://QmBrokenPoC",
            keccak256("broken_poc"),
            "Alleged false positive - but PoC doesn't compile"
        );

        // 阶段5b: 仲裁 - 挑战不成立
        vm.prank(challengerY);
        dispute.selectArbitrationCommittee(taskId);
        address[] memory selectedCommittee = committee.getCommittee(taskId);

        uint256 proposerBalBefore = proposerA.balance;
        uint256 challengerBalBefore = challengerY.balance;

        bytes[] memory sigs = _signArbitrationVotes(
            taskId, false, REPLAY_TRACE, selectedCommittee, 2
        );
        dispute.submitArbitrationResult(taskId, false, REPLAY_TRACE, sigs);

        // Proposer A 获胜
        assertEq(uint256(dispute.taskStatus(taskId)), uint256(DisputeResolution.TaskStatus.Finalized));
        assertGt(proposerA.balance, proposerBalBefore);

        // Challenger Y 被罚没
        IRegistry.AgentInfo memory chalInfo = registry.getAgent(challengerY);
        assertLt(chalInfo.reputation, 100);
        console.log("[Phase 5b] Challenge DISMISSED. Challenger Y slashed.");
        console.log("=== Scenario 3 PASSED ===\n");
    }

    // ══════════════════════════════════════════════════════════════
    // 场景4: 低分自动罚没 (Verifier评分极低触发auto-slash)
    // 阶段1→2→3→triggerScoreBasedSlash
    // ══════════════════════════════════════════════════════════════

    function test_scenario4_autoSlash_lowVerifierScores() public {
        console.log("=== Scenario 4: Auto-Slash on Low Verifier Scores ===");

        // 发布+提交
        vm.prank(projectTeam);
        bytes32 taskId = dispute.publishTask{value: 10 ether}(
            VAULT_CODE_HASH, "no_reentrancy", 48 hours, 3 ether
        );
        vm.prank(proposerB);
        dispute.submitProposal{value: 5 ether}(
            taskId, SHIRK_STATE_ROOT, keccak256("bad"), keccak256("bad"),
            "ipfs://QmTerribleAudit"
        );

        // Verifier 给出极低分数 (平均 < 30 = SLASH_THRESHOLD)
        console.log("[Phase 3] Verifiers give extremely low scores...");
        _verifierCommitReveal(taskId, verifier1, 15, keccak256("s1"));
        _verifierCommitReveal(taskId, verifier2, 20, keccak256("s2"));
        _verifierCommitReveal(taskId, verifier3, 10, keccak256("s3"));
        console.log("[Phase 3] Scores: 15, 20, 10. Average=15 < slash_threshold(30)");

        // 过了挑战期后触发自动罚没
        vm.warp(block.timestamp + 49 hours);

        uint256 v1Before = verifier1.balance;
        uint256 publisherBefore = projectTeam.balance;

        dispute.triggerScoreBasedSlash(taskId);

        assertEq(uint256(dispute.taskStatus(taskId)), uint256(DisputeResolution.TaskStatus.Slashed));
        assertGt(verifier1.balance, v1Before); // Verifier获得罚没分成
        assertGt(projectTeam.balance, publisherBefore); // 项目方获得奖励退还

        console.log("[Auto-Slash] Proposer B auto-slashed. Verifiers rewarded.");
        console.log("=== Scenario 4 PASSED ===\n");
    }

    // ══════════════════════════════════════════════════════════════
    // 场景5: 动态质押门槛 (StakeOracle调整最低质押)
    // ══════════════════════════════════════════════════════════════

    function test_scenario5_dynamicStakeThreshold() public {
        console.log("=== Scenario 5: Dynamic Stake via Oracle ===");

        // 发布任务 (minStakingAmount = 1 ether，但Oracle要求更高)
        vm.prank(projectTeam);
        bytes32 taskId = dispute.publishTask{value: 10 ether}(
            VAULT_CODE_HASH, "no_reentrancy", 48 hours, 1 ether
        );

        // Oracle计算的最低质押 ≈ 2.857 ETH
        uint256 oracleMin = oracle.computeMinProposerStake();
        console.log("[Oracle] Min proposer stake:", oracleMin / 1e18, "ETH");
        assertGt(oracleMin, 1 ether); // Oracle要求高于TaskSpec的1 ETH

        // 尝试用2 ETH提交 - 应该失败 (低于Oracle要求)
        vm.prank(proposerA);
        vm.expectRevert("Dispute: insufficient proposer stake");
        dispute.submitProposal{value: 2 ether}(
            taskId, STATE_ROOT, EVIDENCE_ROOT, TRACE_ROOT, "ipfs://Qm"
        );

        // 用3 ETH提交 - 应该成功
        vm.prank(proposerA);
        dispute.submitProposal{value: 3 ether}(
            taskId, STATE_ROOT, EVIDENCE_ROOT, TRACE_ROOT, "ipfs://Qm"
        );
        assertEq(uint256(dispute.taskStatus(taskId)), uint256(DisputeResolution.TaskStatus.Proposed));

        console.log("[Oracle] Dynamic stake enforcement working correctly");
        console.log("=== Scenario 5 PASSED ===\n");
    }

    // ══════════════════════════════════════════════════════════════
    // 场景6: Shapley价值验证者奖励分配公平性
    // ══════════════════════════════════════════════════════════════

    function test_scenario6_shapleyRewardFairness() public {
        console.log("=== Scenario 6: Shapley Value Reward Distribution ===");

        vm.prank(projectTeam);
        bytes32 taskId = dispute.publishTask{value: 10 ether}(
            VAULT_CODE_HASH, "no_reentrancy", 48 hours, 1 ether
        );
        vm.prank(proposerA);
        dispute.submitProposal{value: 5 ether}(
            taskId, STATE_ROOT, EVIDENCE_ROOT, TRACE_ROOT, "ipfs://Qm"
        );

        // V1=80(接近均值), V2=80(接近均值), V3=50(偏离均值)
        // 均值 = 70, V1偏离10, V2偏离10, V3偏离20
        _verifierCommitReveal(taskId, verifier1, 80, keccak256("s1"));
        _verifierCommitReveal(taskId, verifier2, 80, keccak256("s2"));
        _verifierCommitReveal(taskId, verifier3, 50, keccak256("s3"));

        vm.warp(block.timestamp + 49 hours);

        uint256 v1Before = verifier1.balance;
        uint256 v2Before = verifier2.balance;
        uint256 v3Before = verifier3.balance;

        dispute.finalizeOptimistic(taskId);

        uint256 v1Reward = verifier1.balance - v1Before;
        uint256 v2Reward = verifier2.balance - v2Before;
        uint256 v3Reward = verifier3.balance - v3Before;

        // V1和V2更接近均值，应获得更多奖励
        assertEq(v1Reward, v2Reward); // 相同偏离度 = 相同奖励
        assertGt(v1Reward, v3Reward); // 更接近均值 = 更高奖励

        console.log("[Shapley] V1 reward:", v1Reward);
        console.log("[Shapley] V2 reward:", v2Reward);
        console.log("[Shapley] V3 reward:", v3Reward);
        console.log("[Shapley] Closer to consensus = higher reward. Verified.");
        console.log("=== Scenario 6 PASSED ===\n");
    }

    // ══════════════════════════════════════════════════════════════
    // 场景7: 博弈论经济约束验证
    // 验证 Sp > (Ca - Ca') / (Pdetect * Parb_correct)
    // ══════════════════════════════════════════════════════════════

    function test_scenario7_gameTheoryConstraints() public view {
        console.log("=== Scenario 7: Game Theory Economic Constraints ===");

        // Oracle参数: pDetect=70%, pArbCorrect=95%, Ca=2ETH, Ca'=0.1ETH
        uint256 minProposerStake = oracle.computeMinProposerStake();
        uint256 minChallengerStake = oracle.computeMinChallengerStake();

        // 验证: Sp > (Ca - Ca') / (Pdetect * Parb_correct)
        // = (2 - 0.1) / (0.7 * 0.95) = 1.9 / 0.665 ≈ 2.857 ETH
        assertGt(minProposerStake, 2.8 ether);
        assertLt(minProposerStake, 2.9 ether);

        console.log("[GameTheory] Min proposer stake:", minProposerStake);
        console.log("[GameTheory] Min challenger stake:", minChallengerStake);

        // 验证: 5 ETH质押满足诚实审计约束
        assertGt(5 ether, minProposerStake);
        console.log("[GameTheory] 5 ETH stake satisfies honesty constraint");
        console.log("=== Scenario 7 PASSED ===\n");
    }

    // ══════════════════════════════════════════════════════════════
    // 场景8: 抗女巫攻击 - 未注册Agent无法参与
    // ══════════════════════════════════════════════════════════════

    function test_scenario8_sybilResistance() public {
        console.log("=== Scenario 8: Sybil Resistance ===");

        vm.prank(projectTeam);
        bytes32 taskId = dispute.publishTask{value: 10 ether}(
            VAULT_CODE_HASH, "no_reentrancy", 48 hours, 3 ether
        );

        // 未注册的地址无法提交proposal
        address sybilNode = makeAddr("sybil_attacker");
        vm.deal(sybilNode, 100 ether);

        vm.prank(sybilNode);
        vm.expectRevert("Dispute: proposer not registered");
        dispute.submitProposal{value: 5 ether}(
            taskId, STATE_ROOT, EVIDENCE_ROOT, TRACE_ROOT, "ipfs://Qm"
        );

        // 注册但质押不足也无法参与
        vm.prank(sybilNode);
        vm.expectRevert("Registry: insufficient stake");
        registry.register{value: 0.5 ether}(keccak256("did:sybil"), hex"FF");

        console.log("[Sybil] Unregistered agent blocked from proposing");
        console.log("[Sybil] Insufficient stake registration rejected");
        console.log("=== Scenario 8 PASSED ===\n");
    }

    // ══════════════════════════════════════════════════════════════
    // 场景9: 完整多Agent竞争场景
    // 多个Proposer竞争，第一个提交者获得权利
    // ══════════════════════════════════════════════════════════════

    function test_scenario9_multiAgentCompetition() public {
        console.log("=== Scenario 9: Multi-Agent Competition ===");

        vm.prank(projectTeam);
        bytes32 taskId = dispute.publishTask{value: 10 ether}(
            VAULT_CODE_HASH, "no_reentrancy", 48 hours, 3 ether
        );

        // Proposer A 先提交
        vm.prank(proposerA);
        dispute.submitProposal{value: 5 ether}(
            taskId, STATE_ROOT, EVIDENCE_ROOT, TRACE_ROOT, "ipfs://QmA"
        );

        // Proposer B 尝试提交同一任务 - 应失败
        vm.prank(proposerB);
        vm.expectRevert("Dispute: task not open");
        dispute.submitProposal{value: 5 ether}(
            taskId, SHIRK_STATE_ROOT, keccak256("b"), keccak256("b"), "ipfs://QmB"
        );

        console.log("[Competition] First proposer wins the slot");
        console.log("=== Scenario 9 PASSED ===\n");
    }

    // ══════════════════════════════════════════════════════════════
    // 场景10: 挑战期时间约束严格执行
    // ══════════════════════════════════════════════════════════════

    function test_scenario10_challengeWindowEnforcement() public {
        console.log("=== Scenario 10: Challenge Window Enforcement ===");

        vm.prank(projectTeam);
        bytes32 taskId = dispute.publishTask{value: 10 ether}(
            VAULT_CODE_HASH, "no_reentrancy", 48 hours, 3 ether
        );
        vm.prank(proposerA);
        dispute.submitProposal{value: 5 ether}(
            taskId, STATE_ROOT, EVIDENCE_ROOT, TRACE_ROOT, "ipfs://Qm"
        );

        // 48小时内可以挑战
        vm.warp(block.timestamp + 47 hours);
        // (不实际挑战，只验证时间窗口)

        // 48小时后不能挑战
        vm.warp(block.timestamp + 2 hours); // 总共49小时
        vm.prank(challengerX);
        vm.expectRevert("Dispute: challenge period expired");
        dispute.raiseChallenge{value: 3 ether}(
            taskId,
            DisputeResolution.ChallengeType.FalseNegative,
            "ipfs://QmPoC", POC_HASH, "Too late"
        );

        console.log("[Window] Challenge after 48h correctly rejected");
        console.log("=== Scenario 10 PASSED ===\n");
    }

    // ══════════════════════════════════════════════════════════════
    // Helper Functions
    // ══════════════════════════════════════════════════════════════

    function _verifierCommitReveal(
        bytes32 taskId, address verifier, uint256 score, bytes32 salt
    ) internal {
        bytes32 commitHash = keccak256(abi.encodePacked(score, salt));
        uint256 idx = dispute.getVerifierScoreCount(taskId);

        vm.prank(verifier);
        dispute.commitScore(taskId, commitHash);

        vm.prank(verifier);
        dispute.revealScore(taskId, idx, score, salt);
    }

    function _signArbitrationVotes(
        bytes32 taskId,
        bool challengeUpheld,
        bytes32 replayHash,
        address[] memory selectedCommittee,
        uint256 sigCount
    ) internal view returns (bytes[] memory) {
        bytes32 structHash = keccak256(abi.encode(
            committee.ARBITRATION_TYPEHASH(),
            taskId,
            challengeUpheld,
            replayHash
        ));
        bytes32 digest = keccak256(abi.encodePacked(
            "\x19\x01",
            committee.DOMAIN_SEPARATOR(),
            structHash
        ));

        bytes[] memory sigs = new bytes[](sigCount);
        for (uint256 i = 0; i < sigCount; i++) {
            uint256 key = _getKeyForMember(selectedCommittee[i]);
            (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
            sigs[i] = abi.encodePacked(r, s, v);
        }
        return sigs;
    }

    function _getKeyForMember(address member) internal view returns (uint256) {
        if (member == arb1) return ARB1_KEY;
        if (member == arb2) return ARB2_KEY;
        if (member == arb3) return ARB3_KEY;
        if (member == arb4) return ARB4_KEY;
        if (member == arb5) return ARB5_KEY;
        revert("Unknown committee member");
    }
}
