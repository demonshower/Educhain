// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title VulnerableVault - Intentionally vulnerable contract for PoC testing
/// @notice Contains a reentrancy vulnerability for challenger agents to exploit
contract VulnerableVault {
    mapping(address => uint256) public balances;
    uint256 public totalDeposits;

    event Deposit(address indexed user, uint256 amount);
    event Withdrawal(address indexed user, uint256 amount);

    function deposit() external payable {
        balances[msg.sender] += msg.value;
        totalDeposits += msg.value;
        emit Deposit(msg.sender, msg.value);
    }

    /// @notice VULNERABLE: state update after external call (reentrancy)
    function withdraw(uint256 amount) external {
        require(balances[msg.sender] >= amount, "Insufficient balance");

        // BUG: External call BEFORE state update
        (bool success, ) = msg.sender.call{value: amount}("");
        require(success, "Transfer failed");

        // State update AFTER external call - reentrancy vulnerability
        // Using unchecked to allow the exploit to succeed (simulates pre-0.8 behavior)
        unchecked {
            balances[msg.sender] -= amount;
            totalDeposits -= amount;
        }

        emit Withdrawal(msg.sender, amount);
    }

    /// @notice Safe version for comparison
    function safeWithdraw(uint256 amount) external {
        require(balances[msg.sender] >= amount, "Insufficient balance");

        balances[msg.sender] -= amount;
        totalDeposits -= amount;

        (bool success, ) = msg.sender.call{value: amount}("");
        require(success, "Transfer failed");

        emit Withdrawal(msg.sender, amount);
    }

    receive() external payable {}
}
