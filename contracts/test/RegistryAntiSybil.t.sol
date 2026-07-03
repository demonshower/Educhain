// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/Registry.sol";

/// @title RegistryAntiSybilTest - 注册机制与抗女巫攻击测试
/// @notice 覆盖DID注册、质押门槛、声誉管理、罚没机制、去注册
contract RegistryAntiSybilTest is Test {
    Registry public registry;
    address public disputeContract = makeAddr("disputeContract");

    address public agent1 = makeAddr("agent1");
    address public agent2 = makeAddr("agent2");
    address public sybilAttacker = makeAddr("sybilAttacker");

    function setUp() public {
        registry = new Registry();
        registry.setDisputeContract(disputeContract);

        vm.deal(agent1, 100 ether);
        vm.deal(agent2, 100 ether);
        vm.deal(sybilAttacker, 100 ether);
    }

    // ============ 正常注册 ============

    /// @notice 满足所有条件的正常注册
    function test_register_success() public {
        vm.prank(agent1);
        registry.register{value: 2 ether}(keccak256("did:agent1"), hex"01");

        IRegistry.AgentInfo memory info = registry.getAgent(agent1);
        assertTrue(info.active);
        assertEq(info.stake, 2 ether);
        assertEq(info.reputation, 100); // INITIAL_REPUTATION
        assertEq(info.did, keccak256("did:agent1"));
    }

    /// @notice 注册后权重 = stake * reputation
    function test_register_weightCalculation() public {
        vm.prank(agent1);
        registry.register{value: 3 ether}(keccak256("did:agent1"), hex"01");

        uint256 weight = registry.getWeight(agent1);
        assertEq(weight, 3 ether * 100); // 3 ETH * 100 reputation
    }

    // ============ 抗女巫攻击 ============

    /// @notice 质押低于最低要求(1 ETH)被拒绝
    function test_sybil_revert_insufficientStake() public {
        vm.prank(sybilAttacker);
        vm.expectRevert("Registry: insufficient stake");
        registry.register{value: 0.5 ether}(keccak256("did:sybil"), hex"01");
    }

    /// @notice 零质押被拒绝
    function test_sybil_revert_zeroStake() public {
        vm.prank(sybilAttacker);
        vm.expectRevert("Registry: insufficient stake");
        registry.register{value: 0}(keccak256("did:sybil"), hex"01");
    }

    /// @notice 空DID被拒绝
    function test_sybil_revert_emptyDID() public {
        vm.prank(sybilAttacker);
        vm.expectRevert("Registry: invalid DID");
        registry.register{value: 1 ether}(bytes32(0), hex"01");
    }

    /// @notice 空VC证明被拒绝
    function test_sybil_revert_emptyVCProof() public {
        vm.prank(sybilAttacker);
        vm.expectRevert("Registry: empty VC proof");
        registry.register{value: 1 ether}(keccak256("did:sybil"), hex"");
    }

    /// @notice 不能重复注册
    function test_sybil_revert_doubleRegister() public {
        vm.prank(agent1);
        registry.register{value: 1 ether}(keccak256("did:agent1"), hex"01");

        vm.prank(agent1);
        vm.expectRevert("Registry: already registered");
        registry.register{value: 1 ether}(keccak256("did:agent1_v2"), hex"02");
    }

    /// @notice 女巫攻击成本分析: 创建N个身份需要N*MIN_STAKE
    function test_sybil_costAnalysis() public {
        uint256 numSybils = 10;
        uint256 totalCost = 0;

        for (uint256 i = 0; i < numSybils; i++) {
            address sybil = address(uint160(0x1000 + i));
            vm.deal(sybil, 2 ether);
            vm.prank(sybil);
            registry.register{value: 1 ether}(
                keccak256(abi.encodePacked("did:sybil", i)), hex"01"
            );
            totalCost += 1 ether;
        }

        // 创建10个女巫身份需要10 ETH质押
        assertEq(totalCost, 10 ether);
        assertEq(registry.agentCount(), 10);

        // 但每个身份的权重很低 (1 ETH * 100 rep = 100 ETH weight)
        // 而一个高质押高声誉的诚实节点可以有更高权重
        vm.prank(agent1);
        registry.register{value: 50 ether}(keccak256("did:honest"), hex"01");

        uint256 honestWeight = registry.getWeight(agent1);
        uint256 sybilWeight = registry.getWeight(address(uint160(0x1000)));

        // 诚实节点权重远超单个女巫节点
        assertGt(honestWeight, sybilWeight * numSybils);
    }

    // ============ 声誉管理 ============

    /// @notice 正向声誉更新
    function test_reputation_increase() public {
        vm.prank(agent1);
        registry.register{value: 1 ether}(keccak256("did:agent1"), hex"01");

        vm.prank(disputeContract);
        registry.updateReputation(agent1, 50);

        IRegistry.AgentInfo memory info = registry.getAgent(agent1);
        assertEq(info.reputation, 150); // 100 + 50
    }

    /// @notice 负向声誉更新
    function test_reputation_decrease() public {
        vm.prank(agent1);
        registry.register{value: 1 ether}(keccak256("did:agent1"), hex"01");

        vm.prank(disputeContract);
        registry.updateReputation(agent1, -30);

        IRegistry.AgentInfo memory info = registry.getAgent(agent1);
        assertEq(info.reputation, 70); // 100 - 30
    }

    /// @notice 声誉不能超过MAX_REPUTATION
    function test_reputation_cappedAtMax() public {
        vm.prank(agent1);
        registry.register{value: 1 ether}(keccak256("did:agent1"), hex"01");

        vm.prank(disputeContract);
        registry.updateReputation(agent1, 99999);

        IRegistry.AgentInfo memory info = registry.getAgent(agent1);
        assertEq(info.reputation, 10000); // MAX_REPUTATION
    }

    /// @notice 声誉不能低于0
    function test_reputation_floorAtZero() public {
        vm.prank(agent1);
        registry.register{value: 1 ether}(keccak256("did:agent1"), hex"01");

        vm.prank(disputeContract);
        registry.updateReputation(agent1, -200);

        IRegistry.AgentInfo memory info = registry.getAgent(agent1);
        assertEq(info.reputation, 0);
    }

    /// @notice 只有dispute合约能更新声誉
    function test_reputation_revert_unauthorized() public {
        vm.prank(agent1);
        registry.register{value: 1 ether}(keccak256("did:agent1"), hex"01");

        vm.prank(agent2);
        vm.expectRevert("Registry: caller is not dispute contract");
        registry.updateReputation(agent1, 50);
    }

    // ============ 罚没机制 ============

    /// @notice 罚没减少质押
    function test_slash_reducesStake() public {
        vm.prank(agent1);
        registry.register{value: 5 ether}(keccak256("did:agent1"), hex"01");

        vm.prank(disputeContract);
        registry.slash(agent1, 2 ether, "Challenge upheld");

        IRegistry.AgentInfo memory info = registry.getAgent(agent1);
        assertEq(info.stake, 3 ether);
        assertTrue(info.active); // 仍高于MIN_STAKE
    }

    /// @notice 罚没至低于MIN_STAKE时自动停用
    function test_slash_deactivatesIfBelowMin() public {
        vm.prank(agent1);
        registry.register{value: 1.5 ether}(keccak256("did:agent1"), hex"01");

        vm.prank(disputeContract);
        registry.slash(agent1, 1 ether, "Severe violation");

        IRegistry.AgentInfo memory info = registry.getAgent(agent1);
        assertEq(info.stake, 0.5 ether);
        assertFalse(info.active); // 低于1 ETH，被停用
    }

    /// @notice 罚没不能超过实际质押
    function test_slash_cappedAtStake() public {
        vm.prank(agent1);
        registry.register{value: 2 ether}(keccak256("did:agent1"), hex"01");

        vm.prank(disputeContract);
        registry.slash(agent1, 100 ether, "Max slash");

        IRegistry.AgentInfo memory info = registry.getAgent(agent1);
        assertEq(info.stake, 0);
        assertFalse(info.active);
    }

    /// @notice 只有dispute合约能执行罚没
    function test_slash_revert_unauthorized() public {
        vm.prank(agent1);
        registry.register{value: 2 ether}(keccak256("did:agent1"), hex"01");

        vm.prank(agent2);
        vm.expectRevert("Registry: caller is not dispute contract");
        registry.slash(agent1, 1 ether, "Unauthorized");
    }

    // ============ 去注册 ============

    /// @notice 正常去注册并退还质押
    function test_deregister_refundsStake() public {
        vm.prank(agent1);
        registry.register{value: 5 ether}(keccak256("did:agent1"), hex"01");

        uint256 balBefore = agent1.balance;

        vm.prank(agent1);
        registry.deregister();

        assertEq(agent1.balance, balBefore + 5 ether);

        IRegistry.AgentInfo memory info = registry.getAgent(agent1);
        assertFalse(info.active);
        assertEq(info.stake, 0);
    }

    /// @notice 未注册Agent不能去注册
    function test_deregister_revert_notRegistered() public {
        vm.prank(agent2);
        vm.expectRevert("Registry: agent not registered");
        registry.deregister();
    }

    // ============ disputeContract设置 ============

    /// @notice disputeContract只能设置一次
    function test_setDisputeContract_revert_alreadySet() public {
        vm.expectRevert("Registry: dispute contract already set");
        registry.setDisputeContract(address(0x123));
    }
}
