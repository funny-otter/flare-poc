## Why

The current PoC sends ETH to *self* on Sepolia, which doesn't demonstrate real deposit/withdrawal accounting. By adding a Sapphire-generated encumbered wallet (following the FlexVaults pattern), the demo becomes a proper cross-chain deposit system: users send ETH to a contract-controlled deposit address, and the contract signs withdrawal transactions using Sapphire's confidential key storage. This closes the loop on the full deposit-credit-withdraw lifecycle.

## What Changes

- **BREAKING**: `creditDeposit` gains a 4th parameter (`receivingAddress`) and validates it matches the encumbered wallet address
- Contract generates a secp256k1 keypair at deploy time via `EthereumUtils.generateKeypair()` (Sapphire precompile)
- New `getDepositAddress()` view exposes the derived Ethereum address as the deposit target
- New `signWithdrawal()` function debits balance and returns a signed raw EVM transaction (via `EIP155Signer`) for the relayer to broadcast on Sepolia
- Demo flow reordered: deploy first (to get deposit address), then send ETH to the encumbered address on Sepolia, then attest/verify/credit/withdraw
- New Step 8 in demo: sign withdrawal on Sapphire, broadcast to Sepolia, confirm ETH returns to user

## Capabilities

### New Capabilities
- `encumbered-wallet`: Sapphire-native keypair generation, deposit address derivation, and withdrawal transaction signing via EIP155Signer
- `deposit-validation`: Validate that deposits were sent to the contract's encumbered wallet address before crediting

### Modified Capabilities
- `sapphire-accounting`: `creditDeposit` signature changes (adds `receivingAddress` param), adds `InsufficientBalance` and `InvalidReceivingAddress` errors

## Impact

- `fdc-trusted-relayer/contracts/src/FdcAccounting.sol` — major changes (new imports, state, functions)
- `fdc-trusted-relayer/contracts/package.json` — new dep: `@oasisprotocol/sapphire-contracts`
- `fdc-trusted-relayer/src/accounting-demo.ts` — reordered flow, new withdrawal step
- `fdc-trusted-relayer/README.md` — updated documentation
- Hardhat recompile required (ABI changes)
