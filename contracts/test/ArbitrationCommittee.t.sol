// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/Registry.sol";
import "../src/DisputeResolution.sol";
import "../src/ArbitrationCommittee.sol";

/// @title ArbitrationCommitteeTest - Tests for VRF selection, quorum, and multi-sig
contract ArbitrationCommitteeTest is Test {
    Registry public registry;
    DisputeResolution public dispute;
    ArbitrationCommittee public committee;

    address public publisher = makeAddr("publisher");
    address public proposer = makeAddr("proposer");
    address public challenger = makeAddr("challenger");

    // Committee member private keys for signing
    uint256 constant MEMBER1_KEY = 0xA1;
    uint256 constant MEMBER2_KEY = 0xA2;
    uint256 constant MEMBER3_KEY = 0xA3;
    uint256 constant MEMBER4_KEY = 0xA4;
    uint256 constant MEMBER5_KEY = 0xA5;

    address member1;
    address member2;
    address member3;
    address member4;
    address member5;

    function setUp() public {
        member1 = vm.addr(MEMBER1_KEY);
        member2 = vm.addr(MEMBER2_KEY);
        member3 = vm.addr(MEMBER3_KEY);
        member4 = vm.addr(MEMBER4_KEY);
        member5 = vm.addr(MEMBER5_KEY);

        // Deploy contracts
        registry = new Registry();
        dispute = new DisputeResolution(address(registry));
        committee = new ArbitrationCommittee(address(registry), 3, 200, 6700);

        // Wire contracts
        registry.setDisputeContract(address(dispute));
        dispute.setArbitrationCommittee(address(committee));
        committee.setDisputeContract(address(dispute));

        // Fund and register agents with high reputation for committee eligibility
        address[] memory members = new address[](5);
        members[0] = member1;
        members[1] = member2;
        members[2] = member3;
        members[3] = member4;
        members[4] = member5;

        for (uint256 i = 0; i < members.length; i++) {
            vm.deal(members[i], 10 ether);
            vm.prank(members[i]);
            registry.register{value: 2 ether}(
                keccak256(abi.encodePacked("did:member", i)),
                hex"01"
            );
            // Boost reputation to 200+ (initial is 100, need +100)
            vm.prank(address(dispute));
            registry.updateReputation(members[i], 150);
        }

        // Register proposer and challenger (lower rep, not eligible for committee)
        vm.deal(publisher, 100 ether);
        vm.deal(proposer, 100 ether);
        vm.deal(challenger, 100 ether);

        vm.prank(proposer);
        registry.register{value: 2 ether}(keccak256("did:proposer"), hex"01");
        vm.prank(challenger);
        registry.register{value: 2 ether}(keccak256("did:challenger"), hex"02");
    }

    // ============ VRF Committee Selection Tests ============

    function test_selectCommittee_selects3Members() public {
        bytes32 taskId = _createChallengedTask();

        vm.prank(challenger);
        dispute.selectArbitrationCommittee(taskId);

        address[] memory selected = committee.getCommittee(taskId);
        assertEq(selected.length, 3);

        // All selected members should be eligible (rep >= 200)
        for (uint256 i = 0; i < selected.length; i++) {
            IRegistry.AgentInfo memory info = registry.getAgent(selected[i]);
            assertGe(info.reputation, 200);
            assertTrue(info.active);
        }
    }

    function test_selectCommittee_deterministic() public {
        bytes32 taskId = _createChallengedTask();

        // Selection should be deterministic for same block
        vm.prank(challenger);
        dispute.selectArbitrationCommittee(taskId);
        address[] memory selected = committee.getCommittee(taskId);

        // Cannot re-select
        vm.prank(challenger);
        vm.expectRevert("ArbitrationCommittee: already selected");
        dispute.selectArbitrationCommittee(taskId);

        // Verify committee is stored
        assertTrue(committee.committeeSelected(taskId));
        assertEq(selected.length, 3);
    }

    function test_selectCommittee_revert_notChallenged() public {
        bytes32 taskId = _publishAndPropose();

        vm.prank(challenger);
        vm.expectRevert("Dispute: not challenged");
        dispute.selectArbitrationCommittee(taskId);
    }

    // ============ Multi-sig Verification Tests ============

    function test_verifySignatures_quorumMet() public {
        bytes32 taskId = _createChallengedTask();
        vm.prank(challenger);
        dispute.selectArbitrationCommittee(taskId);

        address[] memory selected = committee.getCommittee(taskId);
        bool challengeUpheld = true;
        bytes32 replayHash = keccak256("replay_trace");

        // Sign with quorum (67% of 3 = 2 required)
        bytes[] memory sigs = _signVotes(taskId, challengeUpheld, replayHash, selected, 2);

        (bool valid, address[] memory arbitrators) = committee.verifyArbitrationSignatures(
            taskId, challengeUpheld, replayHash, sigs
        );

        assertTrue(valid);
        assertGe(arbitrators.length, 2);
    }

    function test_verifySignatures_revert_insufficientSigs() public {
        bytes32 taskId = _createChallengedTask();
        vm.prank(challenger);
        dispute.selectArbitrationCommittee(taskId);

        address[] memory selected = committee.getCommittee(taskId);
        bytes32 replayHash = keccak256("replay_trace");

        // Only 1 signature (need 2 for 67% of 3)
        bytes[] memory sigs = _signVotes(taskId, true, replayHash, selected, 1);

        vm.expectRevert("ArbitrationCommittee: insufficient signatures");
        committee.verifyArbitrationSignatures(taskId, true, replayHash, sigs);
    }

    // ============ Helpers ============

    function _publishAndPropose() internal returns (bytes32) {
        vm.prank(publisher);
        bytes32 taskId = dispute.publishTask{value: 5 ether}(
            keccak256("code"), "no_reentrancy", 48 hours, 1 ether
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

    function _createChallengedTask() internal returns (bytes32) {
        bytes32 taskId = _publishAndPropose();
        vm.prank(challenger);
        dispute.raiseChallenge{value: 2 ether}(
            taskId,
            DisputeResolution.ChallengeType.FalseNegative,
            "ipfs://QmPoC",
            keccak256("poc"),
            "Reentrancy found"
        );
        return taskId;
    }

    function _signVotes(
        bytes32 taskId,
        bool challengeUpheld,
        bytes32 replayHash,
        address[] memory selected,
        uint256 count
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

        bytes[] memory sigs = new bytes[](count);
        for (uint256 i = 0; i < count; i++) {
            uint256 key = _getKeyForAddress(selected[i]);
            (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
            sigs[i] = abi.encodePacked(r, s, v);
        }
        return sigs;
    }

    function _getKeyForAddress(address addr) internal view returns (uint256) {
        if (addr == member1) return MEMBER1_KEY;
        if (addr == member2) return MEMBER2_KEY;
        if (addr == member3) return MEMBER3_KEY;
        if (addr == member4) return MEMBER4_KEY;
        if (addr == member5) return MEMBER5_KEY;
        revert("Unknown member");
    }
}
