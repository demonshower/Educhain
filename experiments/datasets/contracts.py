"""
Experiment dataset: labeled student code submissions for evaluation.

This benchmark reframes the underlying detection task as a Smart Education
academic-integrity review: each entry is a student code submission that is
either clean or contains a problem (plagiarism, logic error, style/defect).

Each submission has:
- id: unique identifier
- name: descriptive name
- source: submitted source code
- has_vulnerability: ground truth label (True = problematic submission)
- vulnerability_type: issue category (if problematic)
- severity: High/Medium/Low
- description: what the issue is
- difficulty: Easy/Medium/Hard (how hard to detect)
"""

VULNERABLE_CONTRACTS = [
    # ===== REENTRANCY / UNSAFE STATE UPDATE (Classic defect) =====
    {
        "id": "vuln_001",
        "name": "ReentrancyVault_Unchecked",
        "vulnerability_type": "reentrancy",
        "severity": "High",
        "difficulty": "Easy",
        "description": "Problematic submission: state update after external call with unchecked arithmetic (classic reentrancy defect)",
        "source": """// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract ReentrancyVault {
    mapping(address => uint256) public balances;

    function deposit() external payable {
        balances[msg.sender] += msg.value;
    }

    function withdraw(uint256 amount) external {
        require(balances[msg.sender] >= amount, "Insufficient balance");
        (bool success, ) = msg.sender.call{value: amount}("");
        require(success, "Transfer failed");
        unchecked { balances[msg.sender] -= amount; }
    }

    function getBalance() external view returns (uint256) {
        return address(this).balance;
    }
}""",
    },
    {
        "id": "vuln_002",
        "name": "CrossFunctionReentrancy",
        "vulnerability_type": "reentrancy",
        "severity": "High",
        "difficulty": "Medium",
        "description": "Problematic submission: cross-function reentrancy where withdraw and transfer share state",
        "source": """// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract TokenBank {
    mapping(address => uint256) public balances;
    mapping(address => bool) public hasAccount;

    function deposit() external payable {
        balances[msg.sender] += msg.value;
        hasAccount[msg.sender] = true;
    }

    function withdraw() external {
        uint256 amount = balances[msg.sender];
        require(amount > 0, "No balance");
        (bool success, ) = msg.sender.call{value: amount}("");
        require(success);
        balances[msg.sender] = 0;
    }

    function transfer(address to, uint256 amount) external {
        require(balances[msg.sender] >= amount);
        balances[msg.sender] -= amount;
        balances[to] += amount;
    }
}""",
    },
    # ===== ACCESS CONTROL (missing permission checks) =====
    {
        "id": "vuln_003",
        "name": "UnprotectedSelfDestruct",
        "vulnerability_type": "access_control",
        "severity": "High",
        "difficulty": "Easy",
        "description": "Problematic submission: missing access control on a destructive operation lets anyone trigger it",
        "source": """// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract Wallet {
    address public owner;

    constructor() {
        owner = msg.sender;
    }

    function deposit() external payable {}

    function withdraw(uint256 amount) external {
        require(msg.sender == owner, "Not owner");
        payable(owner).transfer(amount);
    }

    function destroy(address payable recipient) external {
        // BUG: missing onlyOwner check
        selfdestruct(recipient);
    }
}""",
    },
    {
        "id": "vuln_004",
        "name": "UnprotectedInitialize",
        "vulnerability_type": "access_control",
        "severity": "High",
        "difficulty": "Medium",
        "description": "Problematic submission: initializer can be called by anyone to take ownership",
        "source": """// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract VaultV2 {
    address public owner;
    bool public initialized;
    mapping(address => uint256) public deposits;

    function initialize(address _owner) external {
        // BUG: no check if already initialized
        owner = _owner;
        initialized = true;
    }

    function deposit() external payable {
        require(initialized, "Not initialized");
        deposits[msg.sender] += msg.value;
    }

    function withdrawAll() external {
        require(msg.sender == owner, "Not owner");
        payable(owner).transfer(address(this).balance);
    }
}""",
    },
    # ===== INTEGER OVERFLOW/UNDERFLOW (arithmetic logic error) =====
    {
        "id": "vuln_005",
        "name": "UncheckedTokenTransfer",
        "vulnerability_type": "integer_overflow",
        "severity": "High",
        "difficulty": "Easy",
        "description": "Problematic submission: unchecked arithmetic in transfer allows balance manipulation (logic error)",
        "source": """// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract SimpleToken {
    mapping(address => uint256) public balanceOf;
    uint256 public totalSupply;

    constructor(uint256 _initialSupply) {
        balanceOf[msg.sender] = _initialSupply;
        totalSupply = _initialSupply;
    }

    function transfer(address to, uint256 value) external returns (bool) {
        unchecked {
            // BUG: no underflow check
            balanceOf[msg.sender] -= value;
            balanceOf[to] += value;
        }
        return true;
    }
}""",
    },
    # ===== ORACLE MANIPULATION (unreliable input source) =====
    {
        "id": "vuln_006",
        "name": "SpotPriceOracle",
        "vulnerability_type": "oracle_manipulation",
        "severity": "High",
        "difficulty": "Hard",
        "description": "Problematic submission: relies on a manipulable spot price as a trusted input source",
        "source": """// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface IUniswapV2Pair {
    function getReserves() external view returns (uint112, uint112, uint32);
}

contract LendingPool {
    IUniswapV2Pair public priceFeed;
    mapping(address => uint256) public collateral;
    mapping(address => uint256) public debt;

    constructor(address _pair) {
        priceFeed = IUniswapV2Pair(_pair);
    }

    function getPrice() public view returns (uint256) {
        // BUG: spot price is manipulable via flash loan
        (uint112 reserve0, uint112 reserve1, ) = priceFeed.getReserves();
        return (uint256(reserve1) * 1e18) / uint256(reserve0);
    }

    function borrow(uint256 amount) external {
        uint256 price = getPrice();
        uint256 collateralValue = collateral[msg.sender] * price / 1e18;
        require(collateralValue >= debt[msg.sender] + amount, "Undercollateralized");
        debt[msg.sender] += amount;
    }

    function depositCollateral() external payable {
        collateral[msg.sender] += msg.value;
    }
}""",
    },
    # ===== FRONT-RUNNING (predictable / leaked logic) =====
    {
        "id": "vuln_007",
        "name": "PredictableCommitReveal",
        "vulnerability_type": "frontrunning",
        "severity": "Medium",
        "difficulty": "Medium",
        "description": "Problematic submission: commit-reveal scheme with a predictable salt that can be exploited",
        "source": """// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract Auction {
    struct Bid {
        bytes32 commitment;
        uint256 deposit;
        bool revealed;
    }

    mapping(address => Bid) public bids;
    address public highestBidder;
    uint256 public highestBid;
    uint256 public revealDeadline;

    function commitBid(bytes32 commitment) external payable {
        bids[msg.sender] = Bid(commitment, msg.value, false);
    }

    function revealBid(uint256 amount, bytes32 salt) external {
        Bid storage bid = bids[msg.sender];
        // BUG: commitment uses only amount + sender, salt is not secret
        require(keccak256(abi.encodePacked(amount, msg.sender, salt)) == bid.commitment);
        require(!bid.revealed);
        bid.revealed = true;

        if (amount > highestBid && bid.deposit >= amount) {
            highestBidder = msg.sender;
            highestBid = amount;
        }
    }
}""",
    },
    # ===== DELEGATECALL INJECTION (unsafe code execution path) =====
    {
        "id": "vuln_008",
        "name": "OpenDelegatecall",
        "vulnerability_type": "delegatecall_injection",
        "severity": "High",
        "difficulty": "Medium",
        "description": "Problematic submission: unrestricted delegatecall allows arbitrary code execution",
        "source": """// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract Proxy {
    address public owner;
    address public implementation;

    constructor(address _impl) {
        owner = msg.sender;
        implementation = _impl;
    }

    function upgrade(address newImpl) external {
        require(msg.sender == owner);
        implementation = newImpl;
    }

    // BUG: anyone can call execute with arbitrary data
    function execute(address target, bytes calldata data) external returns (bytes memory) {
        (bool success, bytes memory result) = target.delegatecall(data);
        require(success, "Delegatecall failed");
        return result;
    }

    fallback() external payable {
        (bool success, ) = implementation.delegatecall(msg.data);
        require(success);
    }
}""",
    },
    # ===== SIGNATURE REPLAY (missing validation) =====
    {
        "id": "vuln_009",
        "name": "MissingNonceSignature",
        "vulnerability_type": "signature_replay",
        "severity": "High",
        "difficulty": "Medium",
        "description": "Problematic submission: signature verification without a nonce allows replay",
        "source": """// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract MetaTxRelayer {
    mapping(address => uint256) public balances;

    function deposit() external payable {
        balances[msg.sender] += msg.value;
    }

    function transferWithSig(
        address from,
        address to,
        uint256 amount,
        bytes memory signature
    ) external {
        // BUG: no nonce - signature can be replayed
        bytes32 hash = keccak256(abi.encodePacked(from, to, amount));
        bytes32 ethHash = keccak256(abi.encodePacked("\\x19Ethereum Signed Message:\\n32", hash));

        address signer = recoverSigner(ethHash, signature);
        require(signer == from, "Invalid signature");
        require(balances[from] >= amount, "Insufficient");

        balances[from] -= amount;
        balances[to] += amount;
    }

    function recoverSigner(bytes32 hash, bytes memory sig) internal pure returns (address) {
        (uint8 v, bytes32 r, bytes32 s) = splitSig(sig);
        return ecrecover(hash, v, r, s);
    }

    function splitSig(bytes memory sig) internal pure returns (uint8, bytes32, bytes32) {
        require(sig.length == 65);
        bytes32 r; bytes32 s; uint8 v;
        assembly {
            r := mload(add(sig, 32))
            s := mload(add(sig, 64))
            v := byte(0, mload(add(sig, 96)))
        }
        return (v, r, s);
    }
}""",
    },
    # ===== FLASH LOAN ATTACK (state-snapshot logic error) =====
    {
        "id": "vuln_010",
        "name": "FlashLoanGovernance",
        "vulnerability_type": "flash_loan_governance",
        "severity": "High",
        "difficulty": "Hard",
        "description": "Problematic submission: voting uses current balance instead of a snapshot (exploitable logic error)",
        "source": """// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface IERC20 {
    function balanceOf(address) external view returns (uint256);
    function totalSupply() external view returns (uint256);
}

contract FlashGov {
    IERC20 public token;

    struct Proposal {
        address target;
        bytes data;
        uint256 forVotes;
        uint256 againstVotes;
        uint256 deadline;
        bool executed;
        mapping(address => bool) hasVoted;
    }

    uint256 public proposalCount;
    mapping(uint256 => Proposal) public proposals;

    constructor(address _token) {
        token = IERC20(_token);
    }

    function propose(address target, bytes calldata data) external returns (uint256) {
        uint256 id = proposalCount++;
        Proposal storage p = proposals[id];
        p.target = target;
        p.data = data;
        p.deadline = block.timestamp + 1 days;
        return id;
    }

    function vote(uint256 proposalId, bool support) external {
        Proposal storage p = proposals[proposalId];
        require(block.timestamp < p.deadline, "Voting ended");
        require(!p.hasVoted[msg.sender], "Already voted");

        // BUG: uses current balance, not snapshot - flash loan can inflate votes
        uint256 weight = token.balanceOf(msg.sender);
        p.hasVoted[msg.sender] = true;

        if (support) p.forVotes += weight;
        else p.againstVotes += weight;
    }

    function execute(uint256 proposalId) external {
        Proposal storage p = proposals[proposalId];
        require(block.timestamp >= p.deadline, "Voting active");
        require(!p.executed, "Already executed");
        require(p.forVotes > p.againstVotes, "Not passed");

        p.executed = true;
        (bool success, ) = p.target.call(p.data);
        require(success);
    }
}""",
    },
]

# ===== PLACEHOLDER FOR REMAINING SUBMISSIONS =====
# SAFE_CONTRACTS_PLACEHOLDER

SAFE_CONTRACTS = [
    {
        "id": "safe_001",
        "name": "SecureVault_CEI",
        "vulnerability_type": None,
        "severity": None,
        "difficulty": None,
        "description": "Clean submission: vault with proper Checks-Effects-Interactions pattern",
        "source": """// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract SecureVault {
    mapping(address => uint256) public balances;

    function deposit() external payable {
        balances[msg.sender] += msg.value;
    }

    function withdraw(uint256 amount) external {
        require(balances[msg.sender] >= amount, "Insufficient");
        balances[msg.sender] -= amount; // Effects before interactions
        (bool success, ) = msg.sender.call{value: amount}("");
        require(success, "Transfer failed");
    }

    function getBalance() external view returns (uint256) {
        return address(this).balance;
    }
}""",
    },
    {
        "id": "safe_002",
        "name": "SecureVault_ReentrancyGuard",
        "vulnerability_type": None,
        "severity": None,
        "difficulty": None,
        "description": "Clean submission: vault with a reentrancy guard modifier",
        "source": """// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract GuardedVault {
    mapping(address => uint256) public balances;
    bool private locked;

    modifier nonReentrant() {
        require(!locked, "Reentrant call");
        locked = true;
        _;
        locked = false;
    }

    function deposit() external payable {
        balances[msg.sender] += msg.value;
    }

    function withdraw(uint256 amount) external nonReentrant {
        require(balances[msg.sender] >= amount, "Insufficient");
        (bool success, ) = msg.sender.call{value: amount}("");
        require(success, "Transfer failed");
        balances[msg.sender] -= amount;
    }
}""",
    },
    {
        "id": "safe_003",
        "name": "SecureToken_Checked",
        "vulnerability_type": None,
        "severity": None,
        "difficulty": None,
        "description": "Clean submission: token with proper checked arithmetic (Solidity 0.8 default)",
        "source": """// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract SecureToken {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    uint256 public totalSupply;
    string public name = "SecureToken";
    string public symbol = "STK";

    constructor(uint256 _supply) {
        balanceOf[msg.sender] = _supply;
        totalSupply = _supply;
    }

    function transfer(address to, uint256 value) external returns (bool) {
        require(balanceOf[msg.sender] >= value, "Insufficient");
        balanceOf[msg.sender] -= value;
        balanceOf[to] += value;
        return true;
    }

    function approve(address spender, uint256 value) external returns (bool) {
        allowance[msg.sender][spender] = value;
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        require(balanceOf[from] >= value, "Insufficient");
        require(allowance[from][msg.sender] >= value, "Not approved");
        allowance[from][msg.sender] -= value;
        balanceOf[from] -= value;
        balanceOf[to] += value;
        return true;
    }
}""",
    },
    {
        "id": "safe_004",
        "name": "SecureOwnable",
        "vulnerability_type": None,
        "severity": None,
        "difficulty": None,
        "description": "Clean submission: proper access control with an ownership pattern",
        "source": """// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract SecureOwnable {
    address public owner;
    address public pendingOwner;

    event OwnershipTransferred(address indexed prev, address indexed next);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Zero address");
        pendingOwner = newOwner;
    }

    function acceptOwnership() external {
        require(msg.sender == pendingOwner, "Not pending owner");
        emit OwnershipTransferred(owner, msg.sender);
        owner = msg.sender;
        pendingOwner = address(0);
    }

    function emergencyWithdraw() external onlyOwner {
        payable(owner).transfer(address(this).balance);
    }

    receive() external payable {}
}""",
    },
    {
        "id": "safe_005",
        "name": "SecureMetaTx_WithNonce",
        "vulnerability_type": None,
        "severity": None,
        "difficulty": None,
        "description": "Clean submission: meta-transaction relayer with proper nonce tracking",
        "source": """// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract SecureRelayer {
    mapping(address => uint256) public balances;
    mapping(address => uint256) public nonces;

    function deposit() external payable {
        balances[msg.sender] += msg.value;
    }

    function transferWithSig(
        address from,
        address to,
        uint256 amount,
        uint256 nonce,
        bytes memory signature
    ) external {
        require(nonce == nonces[from], "Invalid nonce");
        nonces[from]++;

        bytes32 hash = keccak256(abi.encodePacked(from, to, amount, nonce, address(this), block.chainid));
        bytes32 ethHash = keccak256(abi.encodePacked("\\x19Ethereum Signed Message:\\n32", hash));

        (uint8 v, bytes32 r, bytes32 s) = splitSig(signature);
        address signer = ecrecover(ethHash, v, r, s);
        require(signer == from, "Invalid signature");
        require(balances[from] >= amount, "Insufficient");

        balances[from] -= amount;
        balances[to] += amount;
    }

    function splitSig(bytes memory sig) internal pure returns (uint8, bytes32, bytes32) {
        require(sig.length == 65);
        bytes32 r; bytes32 s; uint8 v;
        assembly {
            r := mload(add(sig, 32))
            s := mload(add(sig, 64))
            v := byte(0, mload(add(sig, 96)))
        }
        return (v, r, s);
    }
}""",
    },
    {
        "id": "safe_006",
        "name": "SecureProxy_Restricted",
        "vulnerability_type": None,
        "severity": None,
        "difficulty": None,
        "description": "Clean submission: proxy with restricted delegatecall - only owner can upgrade",
        "source": """// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract SecureProxy {
    address public owner;
    address public implementation;

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    constructor(address _impl) {
        owner = msg.sender;
        implementation = _impl;
    }

    function upgrade(address newImpl) external onlyOwner {
        require(newImpl != address(0), "Zero address");
        implementation = newImpl;
    }

    fallback() external payable {
        address impl = implementation;
        require(impl != address(0), "No implementation");
        assembly {
            calldatacopy(0, 0, calldatasize())
            let result := delegatecall(gas(), impl, 0, calldatasize(), 0, 0)
            returndatacopy(0, 0, returndatasize())
            switch result
            case 0 { revert(0, returndatasize()) }
            default { return(0, returndatasize()) }
        }
    }

    receive() external payable {}
}""",
    },
    {
        "id": "safe_007",
        "name": "TWAPOracle",
        "vulnerability_type": None,
        "severity": None,
        "difficulty": None,
        "description": "Clean submission: time-weighted average price oracle resistant to manipulation",
        "source": """// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract TWAPOracle {
    struct Observation {
        uint256 timestamp;
        uint256 priceCumulative;
    }

    Observation[] public observations;
    uint256 public constant PERIOD = 30 minutes;

    function update(uint256 currentPrice) external {
        uint256 timeElapsed = block.timestamp - (observations.length > 0 ? observations[observations.length - 1].timestamp : 0);
        if (timeElapsed >= PERIOD || observations.length == 0) {
            uint256 cumulative = observations.length > 0
                ? observations[observations.length - 1].priceCumulative + currentPrice * timeElapsed
                : currentPrice;
            observations.push(Observation(block.timestamp, cumulative));
        }
    }

    function consult() external view returns (uint256) {
        require(observations.length >= 2, "Not enough data");
        Observation memory oldest = observations[observations.length - 2];
        Observation memory newest = observations[observations.length - 1];
        uint256 timeElapsed = newest.timestamp - oldest.timestamp;
        require(timeElapsed > 0, "Zero elapsed");
        return (newest.priceCumulative - oldest.priceCumulative) / timeElapsed;
    }
}""",
    },
    {
        "id": "safe_008",
        "name": "SnapshotGovernance",
        "vulnerability_type": None,
        "severity": None,
        "difficulty": None,
        "description": "Clean submission: governance with snapshot-based voting, resistant to manipulation",
        "source": """// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract SnapshotGov {
    mapping(address => uint256) public balanceOf;
    mapping(uint256 => mapping(address => uint256)) public snapshotBalances;
    uint256 public currentSnapshotId;

    struct Proposal {
        uint256 snapshotId;
        uint256 forVotes;
        uint256 againstVotes;
        uint256 deadline;
        bool executed;
        mapping(address => bool) hasVoted;
    }

    mapping(uint256 => Proposal) public proposals;
    uint256 public proposalCount;

    function snapshot() external returns (uint256) {
        currentSnapshotId++;
        return currentSnapshotId;
    }

    function propose(uint256 snapshotId) external returns (uint256) {
        require(snapshotId <= currentSnapshotId, "Future snapshot");
        uint256 id = proposalCount++;
        Proposal storage p = proposals[id];
        p.snapshotId = snapshotId;
        p.deadline = block.timestamp + 3 days;
        return id;
    }

    function vote(uint256 proposalId, bool support) external {
        Proposal storage p = proposals[proposalId];
        require(block.timestamp < p.deadline, "Ended");
        require(!p.hasVoted[msg.sender], "Voted");

        // Uses snapshot balance, not current - flash loan resistant
        uint256 weight = snapshotBalances[p.snapshotId][msg.sender];
        require(weight > 0, "No voting power at snapshot");
        p.hasVoted[msg.sender] = true;

        if (support) p.forVotes += weight;
        else p.againstVotes += weight;
    }
}""",
    },
]


def load_from_test_public_json(path: str, n_vuln: int = 8, n_safe: int = 8, seed: int = 42) -> list:
    """
    Load student submissions from an external test_public.json dataset.

    Randomly samples n_vuln problematic and n_safe clean entries, converting
    each to the standard experiment schema.

    Args:
        path: Path to test_public.json
        n_vuln: Number of problematic samples to select
        n_safe: Number of clean samples to select
        seed: Random seed for reproducibility

    Returns:
        List of submission dicts matching the experiment schema.
    """
    import json
    import random

    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)

    vulnerable = []
    safe = []
    for key, entry in data.items():
        label = entry.get("ground_truth_label", "")
        if label == "vulnerable":
            vulnerable.append((key, entry))
        elif label == "safe":
            safe.append((key, entry))

    rng = random.Random(seed)
    rng.shuffle(vulnerable)
    rng.shuffle(safe)

    selected = vulnerable[:n_vuln] + safe[:n_safe]

    dataset = []
    for key, entry in selected:
        meta = entry["meta"]
        fn_name = meta.get("fn_name", "Unknown")
        contract_name = meta.get("contract", "Unknown")
        context = meta.get("context", "")
        target_reason = entry.get("target_reason", "")
        is_vulnerable = entry["ground_truth_label"] == "vulnerable"

        # Assemble callable code from in_calls and out_calls
        call_code_parts = []
        for call in meta.get("in_calls", []) or []:
            if isinstance(call, dict) and call.get("code"):
                call_code_parts.append(call["code"])
        for call in meta.get("out_calls", []) or []:
            if isinstance(call, dict) and call.get("code"):
                call_code_parts.append(call["code"])

        calls_code = "\n\n".join(call_code_parts)

        # Build full Solidity source
        body_parts = [context]
        if calls_code.strip():
            body_parts.append(calls_code)
        body = "\n\n".join(p for p in body_parts if p.strip())

        source = (
            "// SPDX-License-Identifier: MIT\n"
            "pragma solidity ^0.8.0;\n\n"
            f"contract Target {{\n"
            f"{body}\n"
            f"}}"
        )

        dataset.append({
            "id": key,
            "name": f"{fn_name}_{contract_name}",
            "source": source,
            "has_vulnerability": is_vulnerable,
            "vulnerability_type": "real_world" if is_vulnerable else None,
            "severity": "High" if is_vulnerable else None,
            "difficulty": "Medium",
            "description": target_reason[:200] if target_reason else "",
        })

    return dataset


def get_full_dataset():
    """Return all submissions with unified schema."""
    dataset = []
    for c in VULNERABLE_CONTRACTS:
        dataset.append({**c, "has_vulnerability": True})
    for c in SAFE_CONTRACTS:
        dataset.append({**c, "has_vulnerability": False})
    return dataset


def get_vulnerable_only():
    return [{**c, "has_vulnerability": True} for c in VULNERABLE_CONTRACTS]


def get_safe_only():
    return [{**c, "has_vulnerability": False} for c in SAFE_CONTRACTS]


def get_dataset_stats():
    vuln = len(VULNERABLE_CONTRACTS)
    safe = len(SAFE_CONTRACTS)
    types = {}
    for c in VULNERABLE_CONTRACTS:
        t = c["vulnerability_type"]
        types[t] = types.get(t, 0) + 1
    return {
        "total": vuln + safe,
        "vulnerable": vuln,
        "safe": safe,
        "vulnerability_types": types,
    }
