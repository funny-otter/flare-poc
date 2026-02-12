// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {EthereumUtils} from "@oasisprotocol/sapphire-contracts/contracts/EthereumUtils.sol";
import {EIP155Signer} from "@oasisprotocol/sapphire-contracts/contracts/EIP155Signer.sol";

contract FdcAccounting {
    address public immutable authorizedRelayer;
    address private encumberedAddress;
    bytes32 private encumberedSecretKey;

    /// @dev Private mapping — on Sapphire, storage is encrypted and not readable by external observers.
    mapping(address => uint256) private balances;
    mapping(bytes32 => bool) private processedTxHashes;

    event DepositCredited(address indexed depositor, uint256 value, bytes32 txHash);
    event WithdrawalSigned(address indexed user, uint256 amount, uint64 nonce);

    error Unauthorized();
    error AlreadyProcessed(bytes32 txHash);
    error ZeroValue();
    error InsufficientBalance(uint256 requested, uint256 available);
    error InvalidReceivingAddress(address expected, address actual);

    modifier onlyRelayer() {
        if (msg.sender != authorizedRelayer) revert Unauthorized();
        _;
    }

    constructor(address _relayer) {
        authorizedRelayer = _relayer;
        (encumberedAddress, encumberedSecretKey) = EthereumUtils.generateKeypair();
    }

    /// @notice Returns the encumbered wallet's Ethereum address (deposit target on source chain).
    function getDepositAddress() external view returns (address) {
        return encumberedAddress;
    }

    /// @notice Credit a deposit verified via FDC attestation.
    /// @param txHash The Sepolia transaction hash (prevents double-credit).
    /// @param depositor The address to credit.
    /// @param receivingAddress The address that received the deposit (must match encumbered wallet).
    /// @param value The deposit amount in wei.
    function creditDeposit(bytes32 txHash, address depositor, address receivingAddress, uint256 value) external onlyRelayer {
        if (value == 0) revert ZeroValue();
        if (receivingAddress != encumberedAddress)
            revert InvalidReceivingAddress(encumberedAddress, receivingAddress);
        if (processedTxHashes[txHash]) revert AlreadyProcessed(txHash);

        processedTxHashes[txHash] = true;
        balances[depositor] += value;

        emit DepositCredited(depositor, value, txHash);
    }

    /// @notice Sign a withdrawal transaction from the encumbered wallet.
    /// @param user The user withdrawing (destination address on source chain).
    /// @param amount The amount to withdraw in wei.
    /// @param gasPrice The gas price for the source chain transaction.
    /// @param nonce The nonce for the encumbered wallet on the source chain.
    /// @param chainId The chain ID of the source chain.
    /// @return signedTx The RLP-encoded signed transaction bytes.
    function signWithdrawal(
        address user,
        uint256 amount,
        uint256 gasPrice,
        uint64 nonce,
        uint256 chainId
    ) external onlyRelayer returns (bytes memory signedTx) {
        if (amount == 0) revert ZeroValue();
        uint256 balance = balances[user];
        if (amount > balance) revert InsufficientBalance(amount, balance);

        balances[user] -= amount;

        signedTx = EIP155Signer.sign(
            encumberedAddress,
            encumberedSecretKey,
            EIP155Signer.EthTx({
                nonce: nonce,
                gasPrice: gasPrice,
                gasLimit: 21000,
                to: user,
                value: amount,
                data: "",
                chainId: chainId
            })
        );

        emit WithdrawalSigned(user, amount, nonce);
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
