# Encumbered Wallet

TEE-generated Ethereum keypair for cross-chain deposit receipt and withdrawal signing on Oasis Sapphire.

## Overview

The contract generates an Ethereum-compatible secp256k1 keypair at deploy time using Sapphire's `EthereumUtils.generateKeypair()`. The public address (`encumberedWalletAddr`) serves as the deposit target on Sepolia. The private key (`encumberedWalletKey`) is stored in Sapphire's confidential storage and used to sign EIP-155 withdrawal transactions.

## State

| Variable | Type | Visibility | Description |
|---|---|---|---|
| `encumberedWalletAddr` | `address` | public | Ethereum address derived from TEE-generated keypair |
| `encumberedWalletKey` | `bytes32` | private | Secret key in confidential storage |
| `encumberedWalletNonce` | `uint256` | public | Tracks tx nonce for the encumbered wallet (sole signer) |
| `withdrawalChainId` | `uint256` | public immutable | EIP-155 chain ID for signed withdrawal txs (e.g. 11155111 for Sepolia) |

## Constructor

```solidity
constructor(address _rootRelayer, uint256 _withdrawalChainId)
```

Generates the keypair and stores both the address and secret key. The `withdrawalChainId` is set once and cannot be changed.

## Sapphire SDK Integration

TypeScript scripts must wrap the ethers signer with `wrapEthersSigner()` from `@oasisprotocol/sapphire-ethers-v6` to authenticate confidential view calls (e.g. `getBalance()`, `encumberedWalletAddr()`).

## Dependencies

- `@oasisprotocol/sapphire-contracts`: `EthereumUtils` (keypair generation), `EIP155Signer` (tx signing)
- `@oasisprotocol/sapphire-ethers-v6`: `wrapEthersSigner` (confidential call wrapping)
