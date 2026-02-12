// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract FdcAccounting {
    address public immutable authorizedRelayer;

    /// @dev Private mapping — on Sapphire, storage is encrypted and not readable by external observers.
    mapping(address => uint256) private balances;
    mapping(bytes32 => bool) private processedTxHashes;

    event DepositCredited(address indexed depositor, uint256 value, bytes32 txHash);

    error Unauthorized();
    error AlreadyProcessed(bytes32 txHash);
    error ZeroValue();

    modifier onlyRelayer() {
        if (msg.sender != authorizedRelayer) revert Unauthorized();
        _;
    }

    constructor(address _relayer) {
        authorizedRelayer = _relayer;
    }

    /// @notice Credit a deposit verified via FDC attestation.
    /// @param txHash The Sepolia transaction hash (prevents double-credit).
    /// @param depositor The address to credit.
    /// @param value The deposit amount in wei.
    function creditDeposit(bytes32 txHash, address depositor, uint256 value) external onlyRelayer {
        if (value == 0) revert ZeroValue();
        if (processedTxHashes[txHash]) revert AlreadyProcessed(txHash);

        processedTxHashes[txHash] = true;
        balances[depositor] += value;

        emit DepositCredited(depositor, value, txHash);
    }

    /// @notice Query your own balance.
    function getBalance() external view returns (uint256) {
        return balances[msg.sender];
    }

    /// @notice Query any user's balance (relayer only).
    function getBalanceOf(address user) external view onlyRelayer returns (uint256) {
        return balances[user];
    }
}
