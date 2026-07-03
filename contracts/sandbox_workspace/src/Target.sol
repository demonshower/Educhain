// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

// NOTE: This file is a transient scratch target. At runtime the SandboxService
// overwrites it with the student's submitted assignment code before running the
// peer/reporter verification test in test/Exploit.t.sol.
//
// Example student assignment submission: a simple on-chain counter.
contract StudentSubmission {
    uint256 public count;
    address public owner;

    constructor() {
        owner = msg.sender;
    }

    /// @notice Increment the counter (assignment requirement)
    function increment() external {
        count += 1;
    }

    /// @notice Reset the counter — must be owner-only (assignment constraint)
    function reset() external {
        require(msg.sender == owner, "Only owner can reset");
        count = 0;
    }
}
