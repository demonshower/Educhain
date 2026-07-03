// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./IRegistry.sol";

/// @title ArbitrationCommittee - Academic Integrity Arbitration Committee
/// @notice Selects arbitration committees using VRF for fair academic dispute resolution.
///         Committee members are randomly selected from participants with high academic reputation.
/// @dev Uses block.prevrandao as VRF seed + Fisher-Yates shuffle for unbiased selection.
///      Verifies EIP-712 multi-sig submissions from selected committee members.
contract ArbitrationCommittee {
    // ============ EIP-712 Constants ============

    bytes32 public constant DOMAIN_TYPEHASH = keccak256(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    );
    bytes32 public constant ARBITRATION_TYPEHASH = keccak256(
        "ArbitrationVote(bytes32 taskId,bool challengeUpheld,bytes32 replayTraceHash)"
    );

    // ============ State ============

    IRegistry public registry;
    address public disputeContract;
    address public owner;

    uint256 public committeeSize;      // Number of committee members (default: 3)
    uint256 public minReputation;      // Min academic reputation for eligibility (default: 200)
    uint256 public quorumBps;          // Quorum in basis points (6700 = 67%)

    // taskId => selected committee members
    mapping(bytes32 => address[]) public committees;
    // taskId => whether committee has been selected
    mapping(bytes32 => bool) public committeeSelected;

    bytes32 public immutable DOMAIN_SEPARATOR;

    // ============ Events ============

    event CommitteeSelected(bytes32 indexed taskId, address[] members);
    event ArbitrationSubmitted(bytes32 indexed taskId, bool challengeUpheld);

    // ============ Modifiers ============

    modifier onlyDispute() {
        require(msg.sender == disputeContract, "ArbitrationCommittee: not dispute contract");
        _;
    }

    constructor(
        address _registry,
        uint256 _committeeSize,
        uint256 _minReputation,
        uint256 _quorumBps
    ) {
        require(_committeeSize >= 3, "ArbitrationCommittee: min 3 members");
        require(_quorumBps > 5000 && _quorumBps <= 10000, "ArbitrationCommittee: invalid quorum");

        registry = IRegistry(_registry);
        committeeSize = _committeeSize;
        minReputation = _minReputation;
        quorumBps = _quorumBps;
        owner = msg.sender;

        DOMAIN_SEPARATOR = keccak256(abi.encode(
            DOMAIN_TYPEHASH,
            keccak256("ArbitrationCommittee"),
            keccak256("1"),
            block.chainid,
            address(this)
        ));
    }

    function setDisputeContract(address _dispute) external {
        require(msg.sender == owner, "ArbitrationCommittee: not owner");
        require(disputeContract == address(0), "ArbitrationCommittee: already set");
        disputeContract = _dispute;
    }

    // ============ VRF Committee Selection ============

    /// @notice Select an arbitration committee for an academic dispute
    /// @dev Uses block.prevrandao as VRF seed with Fisher-Yates partial shuffle
    /// @param taskId The assignment/dispute task identifier
    function selectCommittee(bytes32 taskId) external onlyDispute returns (address[] memory) {
        require(!committeeSelected[taskId], "ArbitrationCommittee: already selected");

        // Gather eligible participants (academic reputation >= minReputation and active)
        uint256 totalAgents = registry.agentCount();
        address[] memory eligible = new address[](totalAgents);
        uint256 eligibleCount = 0;

        for (uint256 i = 0; i < totalAgents; i++) {
            address participant = registry.registeredAgents(i);
            IRegistry.AgentInfo memory info = registry.getAgent(participant);
            if (info.active && info.reputation >= minReputation) {
                eligible[eligibleCount] = participant;
                eligibleCount++;
            }
        }

        uint256 selectCount = eligibleCount < committeeSize ? eligibleCount : committeeSize;
        require(selectCount >= 3, "ArbitrationCommittee: insufficient eligible participants");

        // Deterministic pseudo-random shuffle using block.prevrandao as seed
        uint256 seed = uint256(keccak256(abi.encodePacked(block.prevrandao, taskId)));

        // Fisher-Yates partial shuffle to select committee members
        for (uint256 i = 0; i < selectCount; i++) {
            uint256 remaining = eligibleCount - i;
            uint256 j = i + (seed % remaining);
            seed = uint256(keccak256(abi.encodePacked(seed, i)));

            // Swap
            address temp = eligible[i];
            eligible[i] = eligible[j];
            eligible[j] = temp;
        }

        // Store selected committee
        address[] memory selected = new address[](selectCount);
        for (uint256 i = 0; i < selectCount; i++) {
            selected[i] = eligible[i];
        }

        committees[taskId] = selected;
        committeeSelected[taskId] = true;

        emit CommitteeSelected(taskId, selected);
        return selected;
    }

    // ============ Multi-sig Arbitration Verification ============

    /// @notice Verify arbitration result with EIP-712 signatures from committee
    /// @param taskId The disputed assignment task
    /// @param challengeUpheld Whether the academic dispute is upheld (plagiarism confirmed)
    /// @param replayTraceHash Hash of the sandbox verification trace
    /// @param signatures Concatenated signatures from committee members
    function verifyArbitrationSignatures(
        bytes32 taskId,
        bool challengeUpheld,
        bytes32 replayTraceHash,
        bytes[] calldata signatures
    ) external view returns (bool, address[] memory) {
        require(committeeSelected[taskId], "ArbitrationCommittee: no committee");

        address[] memory committee = committees[taskId];
        uint256 quorumRequired = (committee.length * quorumBps) / 10000;
        if (quorumRequired == 0) quorumRequired = 1;

        require(signatures.length >= quorumRequired, "ArbitrationCommittee: insufficient signatures");

        // Compute EIP-712 digest
        bytes32 structHash = keccak256(abi.encode(
            ARBITRATION_TYPEHASH,
            taskId,
            challengeUpheld,
            replayTraceHash
        ));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));

        // Verify each signature is from a committee member
        address[] memory validSigners = new address[](signatures.length);
        uint256 validCount = 0;

        for (uint256 i = 0; i < signatures.length; i++) {
            address signer = _recoverSigner(digest, signatures[i]);
            if (_isCommitteeMember(taskId, signer)) {
                bool duplicate = false;
                for (uint256 j = 0; j < validCount; j++) {
                    if (validSigners[j] == signer) {
                        duplicate = true;
                        break;
                    }
                }
                if (!duplicate) {
                    validSigners[validCount] = signer;
                    validCount++;
                }
            }
        }

        require(validCount >= quorumRequired, "ArbitrationCommittee: quorum not met");

        // Trim array
        address[] memory arbitrators = new address[](validCount);
        for (uint256 i = 0; i < validCount; i++) {
            arbitrators[i] = validSigners[i];
        }

        return (true, arbitrators);
    }

    // ============ View Functions ============

    function getCommittee(bytes32 taskId) external view returns (address[] memory) {
        return committees[taskId];
    }

    function isCommitteeMember(bytes32 taskId, address member) external view returns (bool) {
        return _isCommitteeMember(taskId, member);
    }

    // ============ Internal Functions ============

    function _isCommitteeMember(bytes32 taskId, address member) internal view returns (bool) {
        address[] storage committee = committees[taskId];
        for (uint256 i = 0; i < committee.length; i++) {
            if (committee[i] == member) return true;
        }
        return false;
    }

    function _recoverSigner(bytes32 digest, bytes memory signature) internal pure returns (address) {
        require(signature.length == 65, "ArbitrationCommittee: invalid sig length");

        bytes32 r;
        bytes32 s;
        uint8 v;

        assembly {
            r := mload(add(signature, 32))
            s := mload(add(signature, 64))
            v := byte(0, mload(add(signature, 96)))
        }

        if (v < 27) v += 27;
        require(v == 27 || v == 28, "ArbitrationCommittee: invalid v");

        return ecrecover(digest, v, r, s);
    }
}
