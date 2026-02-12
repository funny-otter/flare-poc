## Why

FlexVaults requires ~1600 lines of code across a Python backend, ROFL TEE oracle, ShoyuBashi bridge, and ProvethVerifier contract to verify cross-chain Ethereum deposits on Sapphire. Flare's FDC (Flare Data Connector) replaces all of this with a single attestation request and view-call verification, reducing complexity by an order of magnitude while maintaining equivalent trust guarantees.

## What Changes

- Add a Solidity accounting contract (`FdcAccounting`) deployed on Oasis Sapphire that tracks private deposit balances using confidential storage
- Add a TypeScript relayer backend that orchestrates the full flow: request FDC attestation on Coston2, wait for proof finalization, verify the proof via on-chain view call, and relay verified deposit data to Sapphire
- Introduce cross-chain interaction between Coston2 (Flare testnet) and Sapphire testnet, with the relayer bridging both
- Add `@oasisprotocol/sapphire-paratime` dependency for encrypted Sapphire transactions
- Add Hardhat tooling in a `contracts/` subdirectory for Solidity compilation and deployment

## Capabilities

### New Capabilities
- `sapphire-accounting`: Solidity contract on Sapphire that maintains private per-depositor balances, prevents double-crediting via tx hash tracking, and restricts writes to an authorized relayer
- `trusted-relayer`: TypeScript backend that verifies FDC proofs on Coston2 and submits verified deposit data (depositor address, ETH value, tx hash) to the Sapphire accounting contract

### Modified Capabilities
<!-- None — this is a new subsystem alongside the existing FDC PoC -->

## Impact

- **New contract deployment**: `FdcAccounting.sol` on Sapphire testnet (requires Sapphire testnet ROSE for gas)
- **New dependency**: `@oasisprotocol/sapphire-paratime` wraps ethers provider for encrypted transactions
- **New tooling**: Hardhat in `contracts/` for Solidity compilation (separate from the tsx-based TS runtime)
- **Environment**: Requires additional env vars for Sapphire RPC and contract address
- **Reuses existing FDC flow**: Attestation request, proof waiting, and verification logic from `src/poc.ts` will be extracted or imported
