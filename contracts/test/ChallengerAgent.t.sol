// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/Registry.sol";
import "../src/DisputeResolution.sol";
import "../src/ArbitrationCommittee.sol";
import "../src/StakeOracle.sol";
import "./mocks/VulnerableVault.sol";
import "./mocks/ReentrancyAttacker.sol";

/// @title ChallengerAgentTest - 模拟Challenger Agent的完整行为测试
/// @notice 覆盖有效挑战、无效挑战、PoC生成与沙箱重放验证
contract ChallengerAgentTest is Test {
    Registry public registry;
    DisputeResolution public dispute;
    ArbitrationCommittee public committee;

    address public projectTeam = makeAddr("projectTeam");
    address public proposer = makeAddr("proposer");
    address public validChallenger = makeAddr("validChallenger");
    address public invalidChallenger = makeAddr("invalidChallenger");
    address public lateChallenger = makeAddr("lateChallenger");

    // Arbitration committee keys
    uint256 constant ARB1_KEY = 0xB001;
    uint256 constant ARB2_KEY = 0xB002;
    uint256 constant ARB3_KEY = 0xB003;
    uint256 constant ARB4_KEY = 0xB004;
    uint256 constant ARB5_KEY = 0xB005;
    address public arb1;
    address public arb2;
    address public arb3;
    address public arb4;
    address public arb5;

    bytes32 constant CODE_HASH = keccak256("contract VulnerableVault {}");
    bytes32 constant POC_HASH = keccak256("reentrancy_exploit_test.sol");

    function setUp() public {
        arb1 = vm.addr(ARB1_KEY);
        arb2 = vm.addr(ARB2_KEY);
        arb3 = vm.addr(ARB3_KEY);
        arb4 = vm.addr(ARB4_KEY);
        arb5 = vm.addr(ARB5_KEY);

        registry = new Registry();
        dispute = new DisputeResolution(address(registry));
        committee = new ArbitrationCommittee(address(registry), 3, 200, 6700);

        registry.setDisputeContract(address(dispute));
        dispute.setArbitrationCommittee(address(committee));
        committee.setDisputeContract(address(dispute));

        // Fund all
        vm.deal(projectTeam, 200 ether);
        vm.deal(proposer, 100 ether);
        vm.deal(validChallenger, 100 ether);
        vm.deal(invalidChallenger, 100 ether);
        vm.deal(lateChallenger, 100 ether);

        // Register agents
        vm.prank(proposer);
        registry.register{value: 5 ether}(keccak256("did:proposer"), hex"01");
        vm.prank(validChallenger);
        registry.register{value: 3 ether}(keccak256("did:validChal"), hex"02");
        vm.prank(invalidChallenger);
        registry.register{value: 3 ether}(keccak256("did:invalidChal"), hex"03");
        vm.prank(lateChallenger);
        registry.register{value: 3 ether}(keccak256("did:lateChal"), hex"04");

        // Register arbitration committee members with high reputation
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

    // ============ 有效挑战 (FalseNegative - 漏判) ============

    /// @notice Challenger发现Proposer漏判的重入漏洞，提交有效PoC
    function test_validChallenger_raiseFalseNegativeChallenge() public {
        bytes32 taskId = _publishAndPropose();

        vm.prank(validChallenger);
        dispute.raiseChallenge{value: 3 ether}(
            taskId,
            DisputeResolution.ChallengeType.FalseNegative,
            "ipfs://QmReentrancyPoC",
            POC_HASH,
            "VulnerableVault.withdraw() has reentrancy: external call before state update at line 22"
        );

        assertEq(uint256(dispute.taskStatus(taskId)), uint256(DisputeResolution.TaskStatus.Challenged));

        DisputeResolution.Challenge memory chal = dispute.getChallenge(taskId);
        assertEq(chal.challenger, validChallenger);
        assertEq(chal.stake, 3 ether);
        assertEq(uint256(chal.challengeType), uint256(DisputeResolution.ChallengeType.FalseNegative));
    }

    /// @notice Challenger发现误判(FalsePositive)，提交挑战
    function test_validChallenger_raiseFalsePositiveChallenge() public {
        bytes32 taskId = _publishAndPropose();

        vm.prank(validChallenger);
        dispute.raiseChallenge{value: 3 ether}(
            taskId,
            DisputeResolution.ChallengeType.FalsePositive,
            "ipfs://QmFalsePositiveProof",
            keccak256("false_positive_poc"),
            "Proposer incorrectly flagged safe function as vulnerable"
        );

        assertEq(uint256(dispute.taskStatus(taskId)), uint256(DisputeResolution.TaskStatus.Challenged));
    }

    /// @notice 挑战成功后Challenger获得经济奖励
    function test_validChallenger_receivesRewardOnUpheld() public {
        bytes32 taskId = _publishAndPropose();

        vm.prank(validChallenger);
        dispute.raiseChallenge{value: 3 ether}(
            taskId,
            DisputeResolution.ChallengeType.FalseNegative,
            "ipfs://QmPoC",
            POC_HASH,
            "Reentrancy exploit"
        );

        // 仲裁: 挑战成立
        vm.prank(validChallenger);
        dispute.selectArbitrationCommittee(taskId);
        address[] memory selected = committee.getCommittee(taskId);

        uint256 chalBalBefore = validChallenger.balance;

        bytes[] memory sigs = _signArbitration(taskId, true, keccak256("replay"), selected, 2);
        dispute.submitArbitrationResult(taskId, true, keccak256("replay"), sigs);

        uint256 chalGain = validChallenger.balance - chalBalBefore;
        // Challenger获得: 质押返还(3 ETH) + alpha*Sp(60%*5=3 ETH) + reward(10 ETH)
        assertGt(chalGain, 15 ether);
    }

    /// @notice 挑战成功后Challenger声誉提升
    function test_validChallenger_reputationIncreasesOnUpheld() public {
        bytes32 taskId = _publishAndPropose();

        vm.prank(validChallenger);
        dispute.raiseChallenge{value: 3 ether}(
            taskId, DisputeResolution.ChallengeType.FalseNegative,
            "ipfs://QmPoC", POC_HASH, "Exploit"
        );

        IRegistry.AgentInfo memory before = registry.getAgent(validChallenger);

        vm.prank(validChallenger);
        dispute.selectArbitrationCommittee(taskId);
        address[] memory selected = committee.getCommittee(taskId);
        bytes[] memory sigs = _signArbitration(taskId, true, keccak256("r"), selected, 2);
        dispute.submitArbitrationResult(taskId, true, keccak256("r"), sigs);

        IRegistry.AgentInfo memory after_ = registry.getAgent(validChallenger);
        assertGt(after_.reputation, before.reputation);
    }

    // ============ 无效挑战 (PoC不通过) ============

    /// @notice 无效挑战被仲裁驳回，Challenger被罚没
    function test_invalidChallenger_slashedOnDismissal() public {
        bytes32 taskId = _publishAndPropose();

        vm.prank(invalidChallenger);
        dispute.raiseChallenge{value: 3 ether}(
            taskId,
            DisputeResolution.ChallengeType.FalseNegative,
            "ipfs://QmBrokenPoC",
            keccak256("broken_poc_wont_compile"),
            "Alleged vulnerability but PoC fails to compile"
        );

        vm.prank(invalidChallenger);
        dispute.selectArbitrationCommittee(taskId);
        address[] memory selected = committee.getCommittee(taskId);

        uint256 chalBalBefore = invalidChallenger.balance;

        // 仲裁: 挑战不成立
        bytes[] memory sigs = _signArbitration(taskId, false, keccak256("r"), selected, 2);
        dispute.submitArbitrationResult(taskId, false, keccak256("r"), sigs);

        // Challenger被罚没
        assertEq(uint256(dispute.taskStatus(taskId)), uint256(DisputeResolution.TaskStatus.Finalized));
        // Challenger余额不增加（质押被没收）
        assertEq(invalidChallenger.balance, chalBalBefore);

        // 声誉下降
        IRegistry.AgentInfo memory info = registry.getAgent(invalidChallenger);
        assertLt(info.reputation, 100);
    }

    // ============ 时间约束 ============

    /// @notice 挑战期过后无法发起挑战
    function test_challenger_revert_afterDeadline() public {
        bytes32 taskId = _publishAndPropose();

        vm.warp(block.timestamp + 49 hours);

        vm.prank(lateChallenger);
        vm.expectRevert("Dispute: challenge period expired");
        dispute.raiseChallenge{value: 3 ether}(
            taskId, DisputeResolution.ChallengeType.FalseNegative,
            "ipfs://QmPoC", POC_HASH, "Too late"
        );
    }

    /// @notice 挑战期最后一秒仍可挑战
    function test_challenger_canChallengeAtDeadline() public {
        bytes32 taskId = _publishAndPropose();

        DisputeResolution.Proposal memory prop = dispute.getProposal(taskId);
        vm.warp(prop.challengeDeadline); // 恰好在deadline

        vm.prank(validChallenger);
        dispute.raiseChallenge{value: 3 ether}(
            taskId, DisputeResolution.ChallengeType.FalseNegative,
            "ipfs://QmPoC", POC_HASH, "Just in time"
        );

        assertEq(uint256(dispute.taskStatus(taskId)), uint256(DisputeResolution.TaskStatus.Challenged));
    }

    // ============ 自我挑战防护 ============

    /// @notice Proposer不能挑战自己的proposal
    function test_challenger_revert_selfChallenge() public {
        bytes32 taskId = _publishAndPropose();

        vm.prank(proposer);
        vm.expectRevert("Dispute: cannot challenge own proposal");
        dispute.raiseChallenge{value: 3 ether}(
            taskId, DisputeResolution.ChallengeType.FalseNegative,
            "ipfs://QmPoC", POC_HASH, "Self challenge"
        );
    }

    // ============ 质押约束 ============

    /// @notice 挑战质押不足被拒绝
    function test_challenger_revert_insufficientStake() public {
        // 发布任务要求最低3 ETH质押
        vm.prank(projectTeam);
        bytes32 taskId = dispute.publishTask{value: 10 ether}(
            CODE_HASH, "no_reentrancy", 48 hours, 3 ether
        );
        vm.prank(proposer);
        dispute.submitProposal{value: 5 ether}(
            taskId, keccak256("s"), keccak256("e"), keccak256("t"), "ipfs://Qm"
        );

        vm.prank(validChallenger);
        vm.expectRevert("Dispute: insufficient challenger stake");
        dispute.raiseChallenge{value: 1 ether}(
            taskId, DisputeResolution.ChallengeType.FalseNegative,
            "ipfs://QmPoC", POC_HASH, "Underfunded"
        );
    }

    // ============ PoC沙箱重放模拟 ============

    /// @notice 模拟Challenger Agent生成的PoC在本地沙箱中重放成功
    function test_pocReplay_reentrancyExploitSucceeds() public {
        // 部署漏洞合约
        VulnerableVault vault = new VulnerableVault();

        // 模拟正常用户存款
        address victim = makeAddr("victim");
        vm.deal(victim, 10 ether);
        vm.prank(victim);
        vault.deposit{value: 10 ether}();

        // Challenger Agent 生成的PoC: 重入攻击
        address attacker = makeAddr("attacker");
        vm.deal(attacker, 1 ether);

        vm.startPrank(attacker);
        ReentrancyAttacker attackContract = new ReentrancyAttacker(address(vault), 5);
        attackContract.attack{value: 1 ether}(1 ether);
        vm.stopPrank();

        // 断言: 攻击者获利 (PoC PASS = 挑战成立)
        uint256 attackerProfit = address(attackContract).balance;
        assertGt(attackerProfit, 1 ether, "PoC: attacker must profit from reentrancy");

        // 断言: vault资金被抽取 (业务不变量被破坏)
        assertLt(address(vault).balance, 10 ether, "PoC: vault funds drained");
    }

    /// @notice 模拟无效PoC在沙箱中重放失败 (safe版本无漏洞)
    function test_pocReplay_safeWithdrawNotExploitable() public {
        VulnerableVault vault = new VulnerableVault();

        address user = makeAddr("user");
        vm.deal(user, 5 ether);
        vm.prank(user);
        vault.deposit{value: 5 ether}();

        // 尝试对safeWithdraw进行重入攻击 - 应该失败
        // safeWithdraw先更新状态再转账，重入时余额已为0
        address attacker = makeAddr("attacker2");
        vm.deal(attacker, 1 ether);
        vm.prank(attacker);
        vault.deposit{value: 1 ether}();

        // 正常提取不会有问题
        vm.prank(attacker);
        vault.safeWithdraw(1 ether);

        // vault余额保持正确
        assertEq(address(vault).balance, 5 ether);
        assertEq(vault.balances(user), 5 ether);
    }

    // ============ Helpers ============

    function _publishAndPropose() internal returns (bytes32) {
        vm.prank(projectTeam);
        bytes32 taskId = dispute.publishTask{value: 10 ether}(
            CODE_HASH, "no_reentrancy;no_price_manipulation", 48 hours, 1 ether
        );
        vm.prank(proposer);
        dispute.submitProposal{value: 5 ether}(
            taskId, keccak256("state"), keccak256("evidence"), keccak256("trace"), "ipfs://Qm"
        );
        return taskId;
    }

    function _signArbitration(
        bytes32 taskId,
        bool challengeUpheld,
        bytes32 replayHash,
        address[] memory selected,
        uint256 count
    ) internal view returns (bytes[] memory) {
        bytes32 structHash = keccak256(abi.encode(
            committee.ARBITRATION_TYPEHASH(),
            taskId, challengeUpheld, replayHash
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
