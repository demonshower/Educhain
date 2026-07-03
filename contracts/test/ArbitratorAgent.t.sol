// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/Registry.sol";
import "../src/DisputeResolution.sol";
import "../src/ArbitrationCommittee.sol";

/// @title ArbitratorAgentTest - 模拟仲裁委员会Agent的VRF选举与EIP-712签名投票
/// @notice 覆盖委员会选举、法定人数验证、签名伪造防护、沙箱重放判定
contract ArbitratorAgentTest is Test {
    Registry public registry;
    DisputeResolution public dispute;
    ArbitrationCommittee public committee;

    address public projectTeam = makeAddr("projectTeam");
    address public proposer = makeAddr("proposer");
    address public challenger = makeAddr("challenger");

    // 仲裁委员会成员私钥 (用于EIP-712签名)
    uint256 constant ARB1_KEY = 0xC001;
    uint256 constant ARB2_KEY = 0xC002;
    uint256 constant ARB3_KEY = 0xC003;
    uint256 constant ARB4_KEY = 0xC004;
    uint256 constant ARB5_KEY = 0xC005;
    uint256 constant ARB6_KEY = 0xC006;
    uint256 constant ARB7_KEY = 0xC007;

    address public arb1;
    address public arb2;
    address public arb3;
    address public arb4;
    address public arb5;
    address public arb6;
    address public arb7;

    // 非委员会成员
    uint256 constant FAKE_KEY = 0xDEAD;
    address public fakeArbitrator;

    function setUp() public {
        arb1 = vm.addr(ARB1_KEY);
        arb2 = vm.addr(ARB2_KEY);
        arb3 = vm.addr(ARB3_KEY);
        arb4 = vm.addr(ARB4_KEY);
        arb5 = vm.addr(ARB5_KEY);
        arb6 = vm.addr(ARB6_KEY);
        arb7 = vm.addr(ARB7_KEY);
        fakeArbitrator = vm.addr(FAKE_KEY);

        registry = new Registry();
        dispute = new DisputeResolution(address(registry));
        committee = new ArbitrationCommittee(address(registry), 3, 200, 6700);

        registry.setDisputeContract(address(dispute));
        dispute.setArbitrationCommittee(address(committee));
        committee.setDisputeContract(address(dispute));

        // Fund and register all
        vm.deal(projectTeam, 200 ether);
        vm.deal(proposer, 100 ether);
        vm.deal(challenger, 100 ether);

        vm.prank(proposer);
        registry.register{value: 5 ether}(keccak256("did:proposer"), hex"01");
        vm.prank(challenger);
        registry.register{value: 3 ether}(keccak256("did:challenger"), hex"02");

        // Register 7 arbitration-eligible agents (reputation >= 200)
        address[7] memory arbs = [arb1, arb2, arb3, arb4, arb5, arb6, arb7];
        for (uint256 i = 0; i < 7; i++) {
            vm.deal(arbs[i], 10 ether);
            vm.prank(arbs[i]);
            registry.register{value: 3 ether}(
                keccak256(abi.encodePacked("did:arb", i)), hex"08"
            );
            vm.prank(address(dispute));
            registry.updateReputation(arbs[i], 150); // 100 + 150 = 250
        }

        // Register fake arbitrator with LOW reputation (not eligible)
        vm.deal(fakeArbitrator, 10 ether);
        vm.prank(fakeArbitrator);
        registry.register{value: 1 ether}(keccak256("did:fake"), hex"FF");
        // reputation stays at 100 < 200 threshold
    }

    // ============ VRF委员会选举 ============

    /// @notice 成功选举3人委员会
    function test_arbitrator_selectCommittee_success() public {
        bytes32 taskId = _createChallengedTask();

        vm.prank(challenger);
        dispute.selectArbitrationCommittee(taskId);

        address[] memory selected = committee.getCommittee(taskId);
        assertEq(selected.length, 3);

        // 所有成员必须是高声誉注册Agent
        for (uint256 i = 0; i < selected.length; i++) {
            IRegistry.AgentInfo memory info = registry.getAgent(selected[i]);
            assertTrue(info.active);
            assertGe(info.reputation, 200);
        }
    }

    /// @notice 委员会成员不重复
    function test_arbitrator_selectCommittee_noDuplicates() public {
        bytes32 taskId = _createChallengedTask();

        vm.prank(challenger);
        dispute.selectArbitrationCommittee(taskId);
        address[] memory selected = committee.getCommittee(taskId);

        for (uint256 i = 0; i < selected.length; i++) {
            for (uint256 j = i + 1; j < selected.length; j++) {
                assertTrue(selected[i] != selected[j], "Duplicate committee member");
            }
        }
    }

    /// @notice 不能重复选举同一任务的委员会
    function test_arbitrator_revert_doubleSelection() public {
        bytes32 taskId = _createChallengedTask();

        vm.prank(challenger);
        dispute.selectArbitrationCommittee(taskId);

        vm.prank(challenger);
        vm.expectRevert("ArbitrationCommittee: already selected");
        dispute.selectArbitrationCommittee(taskId);
    }

    /// @notice 非Challenged状态不能选举委员会
    function test_arbitrator_revert_selectOnNonChallenged() public {
        bytes32 taskId = _publishAndPropose();

        vm.prank(challenger);
        vm.expectRevert("Dispute: not challenged");
        dispute.selectArbitrationCommittee(taskId);
    }

    /// @notice 低声誉Agent不会被选入委员会
    function test_arbitrator_lowRepNotSelected() public {
        bytes32 taskId = _createChallengedTask();

        vm.prank(challenger);
        dispute.selectArbitrationCommittee(taskId);
        address[] memory selected = committee.getCommittee(taskId);

        for (uint256 i = 0; i < selected.length; i++) {
            assertTrue(selected[i] != fakeArbitrator, "Low-rep agent should not be selected");
        }
    }

    // ============ EIP-712多签验证 ============

    /// @notice 法定人数(67%)签名通过验证
    function test_arbitrator_quorumSignaturesValid() public {
        bytes32 taskId = _createChallengedTask();
        vm.prank(challenger);
        dispute.selectArbitrationCommittee(taskId);
        address[] memory selected = committee.getCommittee(taskId);

        bool challengeUpheld = true;
        bytes32 replayHash = keccak256("sandbox_replay_trace_pass");

        // 67% of 3 = 2 signatures needed
        bytes[] memory sigs = _signVotes(taskId, challengeUpheld, replayHash, selected, 2);

        (bool valid, address[] memory arbitrators) = committee.verifyArbitrationSignatures(
            taskId, challengeUpheld, replayHash, sigs
        );

        assertTrue(valid);
        assertGe(arbitrators.length, 2);
    }

    /// @notice 签名不足法定人数被拒绝
    function test_arbitrator_revert_insufficientQuorum() public {
        bytes32 taskId = _createChallengedTask();
        vm.prank(challenger);
        dispute.selectArbitrationCommittee(taskId);
        address[] memory selected = committee.getCommittee(taskId);

        bytes32 replayHash = keccak256("trace");

        // Only 1 signature (need 2)
        bytes[] memory sigs = _signVotes(taskId, true, replayHash, selected, 1);

        vm.expectRevert("ArbitrationCommittee: insufficient signatures");
        committee.verifyArbitrationSignatures(taskId, true, replayHash, sigs);
    }

    /// @notice 非委员会成员的签名无效
    function test_arbitrator_revert_nonMemberSignature() public {
        bytes32 taskId = _createChallengedTask();
        vm.prank(challenger);
        dispute.selectArbitrationCommittee(taskId);

        bytes32 replayHash = keccak256("trace");

        // 用非委员会成员的私钥签名
        bytes32 structHash = keccak256(abi.encode(
            committee.ARBITRATION_TYPEHASH(), taskId, true, replayHash
        ));
        bytes32 digest = keccak256(abi.encodePacked(
            "\x19\x01", committee.DOMAIN_SEPARATOR(), structHash
        ));

        bytes[] memory sigs = new bytes[](2);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(FAKE_KEY, digest);
        sigs[0] = abi.encodePacked(r, s, v);
        (v, r, s) = vm.sign(FAKE_KEY + 1, digest);
        sigs[1] = abi.encodePacked(r, s, v);

        vm.expectRevert("ArbitrationCommittee: quorum not met");
        committee.verifyArbitrationSignatures(taskId, true, replayHash, sigs);
    }

    /// @notice 重复签名不计入法定人数
    function test_arbitrator_duplicateSignaturesNotCounted() public {
        bytes32 taskId = _createChallengedTask();
        vm.prank(challenger);
        dispute.selectArbitrationCommittee(taskId);
        address[] memory selected = committee.getCommittee(taskId);

        bytes32 replayHash = keccak256("trace");
        bytes32 structHash = keccak256(abi.encode(
            committee.ARBITRATION_TYPEHASH(), taskId, true, replayHash
        ));
        bytes32 digest = keccak256(abi.encodePacked(
            "\x19\x01", committee.DOMAIN_SEPARATOR(), structHash
        ));

        // 同一个成员签两次
        uint256 key = _getKey(selected[0]);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        bytes memory sig = abi.encodePacked(r, s, v);

        bytes[] memory sigs = new bytes[](2);
        sigs[0] = sig;
        sigs[1] = sig; // duplicate

        vm.expectRevert("ArbitrationCommittee: quorum not met");
        committee.verifyArbitrationSignatures(taskId, true, replayHash, sigs);
    }

    // ============ 完整仲裁流程 ============

    /// @notice 仲裁判定挑战成立 → Proposer被罚没
    function test_arbitrator_fullFlow_challengeUpheld() public {
        bytes32 taskId = _createChallengedTask();
        vm.prank(challenger);
        dispute.selectArbitrationCommittee(taskId);
        address[] memory selected = committee.getCommittee(taskId);

        uint256 challengerBal = challenger.balance;
        uint256 proposerBal = proposer.balance;

        bytes[] memory sigs = _signVotes(taskId, true, keccak256("poc_pass"), selected, 2);
        dispute.submitArbitrationResult(taskId, true, keccak256("poc_pass"), sigs);

        assertEq(uint256(dispute.taskStatus(taskId)), uint256(DisputeResolution.TaskStatus.Slashed));
        assertGt(challenger.balance, challengerBal); // Challenger获利
    }

    /// @notice 仲裁判定挑战不成立 → Challenger被罚没
    function test_arbitrator_fullFlow_challengeDismissed() public {
        bytes32 taskId = _createChallengedTask();
        vm.prank(challenger);
        dispute.selectArbitrationCommittee(taskId);
        address[] memory selected = committee.getCommittee(taskId);

        uint256 proposerBal = proposer.balance;

        bytes[] memory sigs = _signVotes(taskId, false, keccak256("poc_fail"), selected, 2);
        dispute.submitArbitrationResult(taskId, false, keccak256("poc_fail"), sigs);

        assertEq(uint256(dispute.taskStatus(taskId)), uint256(DisputeResolution.TaskStatus.Finalized));
        assertGt(proposer.balance, proposerBal); // Proposer获利
    }

    // ============ 沙箱重放确定性验证 ============

    /// @notice 相同输入产生相同replayTraceHash (确定性)
    function test_arbitrator_replayDeterminism() public pure {
        // 模拟沙箱重放: 相同的合约代码 + 相同的PoC + 相同的区块高度
        bytes memory contractCode = hex"6080604052";
        bytes memory pocCode = hex"6080604052348015";
        uint256 forkBlock = 18_500_000;

        bytes32 trace1 = keccak256(abi.encodePacked(contractCode, pocCode, forkBlock));
        bytes32 trace2 = keccak256(abi.encodePacked(contractCode, pocCode, forkBlock));

        assertEq(trace1, trace2, "Replay must be deterministic");
    }

    /// @notice 不同PoC产生不同replayTraceHash
    function test_arbitrator_differentPoCDifferentTrace() public pure {
        bytes memory contractCode = hex"6080604052";
        uint256 forkBlock = 18_500_000;

        bytes32 trace1 = keccak256(abi.encodePacked(contractCode, hex"AAAA", forkBlock));
        bytes32 trace2 = keccak256(abi.encodePacked(contractCode, hex"BBBB", forkBlock));

        assertTrue(trace1 != trace2, "Different PoC should produce different trace");
    }

    // ============ Helpers ============

    function _publishAndPropose() internal returns (bytes32) {
        vm.prank(projectTeam);
        bytes32 taskId = dispute.publishTask{value: 10 ether}(
            keccak256("code"), "no_reentrancy", 48 hours, 1 ether
        );
        vm.prank(proposer);
        dispute.submitProposal{value: 5 ether}(
            taskId, keccak256("s"), keccak256("e"), keccak256("t"), "ipfs://Qm"
        );
        return taskId;
    }

    function _createChallengedTask() internal returns (bytes32) {
        bytes32 taskId = _publishAndPropose();
        vm.prank(challenger);
        dispute.raiseChallenge{value: 3 ether}(
            taskId, DisputeResolution.ChallengeType.FalseNegative,
            "ipfs://QmPoC", keccak256("poc"), "Reentrancy found"
        );
        return taskId;
    }

    function _signVotes(
        bytes32 taskId, bool challengeUpheld, bytes32 replayHash,
        address[] memory selected, uint256 count
    ) internal view returns (bytes[] memory) {
        bytes32 structHash = keccak256(abi.encode(
            committee.ARBITRATION_TYPEHASH(), taskId, challengeUpheld, replayHash
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
        if (member == arb6) return ARB6_KEY;
        if (member == arb7) return ARB7_KEY;
        revert("Unknown member");
    }
}
