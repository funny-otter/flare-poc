## Why

The fdc-trustless-merkle PoC can credit deposit balances on Sapphire but has no way to withdraw — ETH goes in but can't come back out. Adding withdrawals completes the round-trip and demonstrates the full encumbered wallet pattern from Sapphire: the contract generates its own Ethereum keypair inside the TEE, that address becomes the deposit target on Sepolia, and the contract can sign withdrawal transactions from it.

## What Changes

- Contract generates an encumbered wallet keypair at deploy time via `EthereumUtils.generateKeypair()` (replaces the manual `DEPOSIT_ADDRESS` configuration)
- New `withdraw()` function that deducts the user's balance and signs an EIP-155 transaction from the encumbered wallet
- Deploy and relay scripts updated to use `wrapEthersSigner` from `@oasisprotocol/sapphire-ethers-v6` for confidential reads
- Relay script extended with withdrawal request + Sepolia broadcast steps (Steps 6-8)
- `DEPOSIT_ADDRESS` env var removed — the deposit address is auto-generated

## Capabilities

### New Capabilities
- `encumbered-wallet`: TEE-generated Ethereum keypair for deposits and withdrawals — `EthereumUtils.generateKeypair()` at deploy, `EIP155Signer.sign()` at withdrawal
- `withdrawal-flow`: Balance deduction, EIP-155 tx signing on Sapphire, event-based signed tx relay, and broadcast on Sepolia

### Modified Capabilities
- `deposit-accounting`: Deposit target changed from configurable address to auto-generated encumbered wallet
- `relayer-backend`: Extended with withdrawal request (Step 6), broadcast (Step 7), and round-trip results (Step 8)

## Impact

- New dependencies: `@oasisprotocol/sapphire-contracts` (Solidity), `@oasisprotocol/sapphire-ethers-v6` (TypeScript)
- Constructor signature changed: `(address, address)` → `(address, uint256)` — existing deployments are incompatible
- `DEPOSIT_ADDRESS` env var removed from `.env.example`
- Relay script flow extended from 6 steps to 8 steps
