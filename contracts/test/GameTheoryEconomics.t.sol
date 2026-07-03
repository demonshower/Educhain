// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/Registry.sol";
import "../src/DisputeResolution.sol";
import "../src/ArbitrationCommittee.sol";
import "../src/StakeOracle.sol";

/// @title GameTheoryEconomicsTest - 博弈论经济模型验证
/// @notice 验证激励相容约束、质押门槛公式、经济均衡条件
contract GameTheoryEconomicsTest is Test {
    Registry public registry;
    DisputeResolution public dispute;
    ArbitrationCommittee public committee;
    StakeOracle public oracle;

    address public projectTeam = makeAddr("projectTeam");
    address public proposer = makeAddr("proposer");
    address public challenger = makeAddr("challenger");

    uint256 constant ARB1_KEY = 0xD001;
    uint256 constant ARB2_KEY = 0xD002;
    uint256 constant ARB3_KEY = 0xD003;
    uint256 constant ARB4_KEY = 0xD004;
    uint256 constant ARB5_KEY = 0xD005;
    address public arb1;
    address public arb2;
    address public arb3;
    address public arb4;
    address public arb5;

    function setUp() public {
        arb1 = vm.addr(ARB1_KEY);
        arb2 = vm.addr(ARB2_KEY);
        arb3 = vm.addr(ARB3_KEY);
        arb4 = vm.addr(ARB4_KEY);
        arb5 = vm.addr(ARB5_KEY);

        registry = new Registry();
        dispute = new DisputeResolution(address(registry));
        oracle = new StakeOracle(7000, 9500, 2 ether, 0.1 ether, 1 ether, 6000, address(this));
        committee = new ArbitrationCommittee(address(registry), 3, 200, 6700);

        registry.setDisputeContract(address(dispute));
        dispute.setArbitrationCommittee(address(committee));
        dispute.setStakeOracle(address(oracle));
        committee.setDisputeContract(address(dispute));

        vm.deal(projectTeam, 500 ether);
        vm.deal(proposer, 200 ether);
        vm.deal(challenger, 200 ether);

        vm.prank(proposer);
        registry.register{value: 10 ether}(keccak256("did:proposer"), hex"01");
        vm.prank(challenger);
        registry.register{value: 5 ether}(keccak256("did:challenger"), hex"02");

        address[5] memory arbs = [arb1, arb2, arb3, arb4, arb5];
        for (uint256 i = 0; i < 5; i++) {
            vm.deal(arbs[i], 10 ether);
            vm.prank(arbs[i]);
            registry.register{value: 3 ether}(
                keccak256(abi.encodePacked("did:arb", i)), hex"08"
            );
            vm.prank(address(dispute));
            registry.updateReputation(arbs[i], 150);
        }
    }

    // ══════════════════════════════════════════════════════════════
    // 约束1: Proposer诚实审计硬约束
    // Sp > (Ca - Ca') / (Pdetect * Parb_correct)
    // ══════════════════════════════════════════════════════════════

    /// @notice 验证Oracle计算的最低Proposer质押满足诚实约束
    function test_constraint1_proposerHonestyFormula() public view {
        uint256 minStake = oracle.computeMinProposerStake();
        assertGt(minStake, 2.85 ether, "Min stake must exceed 2.85 ETH");
        assertLt(minStake, 2.9 ether, "Min stake should be ~2.857 ETH");
    }

    /// @notice 验证: 降低检测概率 → 最低质押升高
    function test_constraint1_lowerDetectionRaisesStake() public {
        uint256 stakeNormal = oracle.computeMinProposerStake();
        oracle.updateParameters(4000, 9500, 2 ether, 0.1 ether, 1 ether, 6000);
        uint256 stakeLowDetect = oracle.computeMinProposerStake();
        assertGt(stakeLowDetect, stakeNormal, "Lower detection = higher stake required");
        assertGt(stakeLowDetect, 4.9 ether);
    }

    /// @notice 验证: 降低仲裁精度 → 最低质押升高
    function test_constraint1_lowerArbAccuracyRaisesStake() public {
        uint256 stakeNormal = oracle.computeMinProposerStake();
        oracle.updateParameters(7000, 6000, 2 ether, 0.1 ether, 1 ether, 6000);
        uint256 stakeLowArb = oracle.computeMinProposerStake();
        assertGt(stakeLowArb, stakeNormal, "Lower arb accuracy = higher stake required");
    }

    /// @notice 验证: 审计成本差值增大 → 最低质押升高
    function test_constraint1_higherCostDiffRaisesStake() public {
        uint256 stakeNormal = oracle.computeMinProposerStake();
        oracle.updateParameters(7000, 9500, 5 ether, 0.1 ether, 1 ether, 6000);
        uint256 stakeHighCost = oracle.computeMinProposerStake();
        assertGt(stakeHighCost, stakeNormal, "Higher cost diff = higher stake required");
    }

    // ══════════════════════════════════════════════════════════════
    // 约束2: Challenger积极挑战硬约束
    // ══════════════════════════════════════════════════════════════

    /// @notice 验证Challenger质押门槛计算
    function test_constraint2_challengerViabilityFormula() public view {
        uint256 minChalStake = oracle.computeMinChallengerStake();
        assertGt(minChalStake, 0, "Challenger min stake must be positive");
    }

    /// @notice 验证: PoC成本增加 → Challenger门槛升高
    function test_constraint2_higherPocCostRaisesThreshold() public {
        uint256 stakeNormal = oracle.computeMinChallengerStake();
        oracle.updateParameters(7000, 9500, 2 ether, 0.1 ether, 3 ether, 6000);
        uint256 stakeHighPoc = oracle.computeMinChallengerStake();
        assertGt(stakeHighPoc, stakeNormal, "Higher PoC cost = higher threshold");
    }

    // ══════════════════════════════════════════════════════════════
    // 经济均衡验证
    // ══════════════════════════════════════════════════════════════

    /// @notice 模拟诚实Proposer的期望收益
    function test_equilibrium_honestProposerPositiveEV() public {
        bytes32 taskId = _publishTask(10 ether);
        vm.prank(proposer);
        dispute.submitProposal{value: 5 ether}(
            taskId, keccak256("s"), keccak256("e"), keccak256("t"), "ipfs://Qm"
        );
        vm.warp(block.timestamp + 49 hours);
        uint256 balBefore = proposer.balance;
        dispute.finalizeOptimistic(taskId);
        uint256 gain = proposer.balance - balBefore;
        assertEq(gain, 15 ether);
    }

    /// @notice 模拟偷懒Proposer被抓的损失
    function test_equilibrium_shirkerNegativeEV() public {
        bytes32 taskId = _publishTask(10 ether);
        vm.prank(proposer);
        dispute.submitProposal{value: 5 ether}(
            taskId, keccak256("lazy"), keccak256("e"), keccak256("t"), "ipfs://Qm"
        );
        vm.prank(challenger);
        dispute.raiseChallenge{value: 3 ether}(
            taskId, DisputeResolution.ChallengeType.FalseNegative,
            "ipfs://QmPoC", keccak256("poc"), "Found bug"
        );
        vm.prank(challenger);
        dispute.selectArbitrationCommittee(taskId);
        address[] memory selected = committee.getCommittee(taskId);
        uint256 proposerBalBefore = proposer.balance;
        bytes[] memory sigs = _signVotes(taskId, true, keccak256("r"), selected, 2);
        dispute.submitArbitrationResult(taskId, true, keccak256("r"), sigs);
        assertEq(proposer.balance, proposerBalBefore);
        assertEq(uint256(dispute.taskStatus(taskId)), uint256(DisputeResolution.TaskStatus.Slashed));
    }

    /// @notice 验证: E[Honest] > E[Shirk]
    function test_equilibrium_honestyDominates() public view {
        uint256 Ra = 10 ether;
        uint256 Ca = oracle.auditCost();
        uint256 CaPrime = oracle.auditCostPrime();
        uint256 Sp = 5 ether;
        int256 eHonest = int256(Ra) - int256(Ca);
        uint256 pDetect = oracle.pDetect();
        uint256 pArb = oracle.pArbCorrect();
        uint256 expectedLoss = (Sp * pDetect * pArb) / (10000 * 10000);
        int256 eShirk = int256(Ra) - int256(CaPrime) - int256(expectedLoss);
        assertGt(eHonest, eShirk, "Honest strategy must dominate shirking");
    }

    // ══════════════════════════════════════════════════════════════
    // Alpha分配系数验证
    // ══════════════════════════════════════════════════════════════

    /// @notice 验证挑战成功时alpha=60%分配给Challenger
    function test_alpha_challengerGets60Percent() public {
        bytes32 taskId = _publishTask(10 ether);
        vm.prank(proposer);
        dispute.submitProposal{value: 5 ether}(
            taskId, keccak256("s"), keccak256("e"), keccak256("t"), "ipfs://Qm"
        );
        vm.prank(challenger);
        dispute.raiseChallenge{value: 3 ether}(
            taskId, DisputeResolution.ChallengeType.FalseNegative,
            "ipfs://QmPoC", keccak256("poc"), "Bug"
        );
        vm.prank(challenger);
        dispute.selectArbitrationCommittee(taskId);
        address[] memory selected = committee.getCommittee(taskId);
        uint256 chalBefore = challenger.balance;
        bytes[] memory sigs = _signVotes(taskId, true, keccak256("r"), selected, 2);
        dispute.submitArbitrationResult(taskId, true, keccak256("r"), sigs);
        uint256 chalGain = challenger.balance - chalBefore;
        // Challenger获得: 质押返还(3) + alpha*Sp(0.6*5=3) + reward(10) = 16 ETH
        assertEq(chalGain, 16 ether);
    }

    /// @notice 验证挑战失败时alpha=60%分配给Proposer
    function test_alpha_proposerGets60PercentOnDismissal() public {
        bytes32 taskId = _publishTask(10 ether);
        vm.prank(proposer);
        dispute.submitProposal{value: 5 ether}(
            taskId, keccak256("s"), keccak256("e"), keccak256("t"), "ipfs://Qm"
        );
        vm.prank(challenger);
        dispute.raiseChallenge{value: 3 ether}(
            taskId, DisputeResolution.ChallengeType.FalseNegative,
            "ipfs://QmPoC", keccak256("poc"), "Bug"
        );
        vm.prank(challenger);
        dispute.selectArbitrationCommittee(taskId);
        address[] memory selected = committee.getCommittee(taskId);
        uint256 propBefore = proposer.balance;
        bytes[] memory sigs = _signVotes(taskId, false, keccak256("r"), selected, 2);
        dispute.submitArbitrationResult(taskId, false, keccak256("r"), sigs);
        uint256 propGain = proposer.balance - propBefore;
        // Proposer获得: 质押返还(5) + reward(10) + alpha*Sc(0.6*3=1.8) = 16.8 ETH
        assertEq(propGain, 16.8 ether);
    }

    // ══════════════════════════════════════════════════════════════
    // 动态参数调整验证
    // ══════════════════════════════════════════════════════════════

    /// @notice 当Pdetect降低时，系统自动提高质押门槛
    function test_dynamic_stakeAdjustment() public {
        uint256 normalMin = oracle.computeMinProposerStake();
        oracle.updateParameters(3000, 9500, 2 ether, 0.1 ether, 1 ether, 6000);
        uint256 adjustedMin = oracle.computeMinProposerStake();
        assertGt(adjustedMin, normalMin * 2, "Stake must increase significantly");
        assertGt(adjustedMin, 6.6 ether);
    }

    // ============ Helpers ============

    function _publishTask(uint256 reward) internal returns (bytes32) {
        vm.prank(projectTeam);
        return dispute.publishTask{value: reward}(
            keccak256("code"), "no_reentrancy", 48 hours, 1 ether
        );
    }

    function _signVotes(
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
        if (member == arb1) return ARB1_KEY;
        if (member == arb2) return ARB2_KEY;
        if (member == arb3) return ARB3_KEY;
        if (member == arb4) return ARB4_KEY;
        if (member == arb5) return ARB5_KEY;
        revert("Unknown member");
    }
}
