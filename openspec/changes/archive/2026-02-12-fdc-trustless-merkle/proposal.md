## Why

The existing FDC PoC (`src/poc.ts`) verifies attestations on Coston2, but a production accounting system on Sapphire needs to verify FDC Merkle proofs locally — without trusting a relayer for proof data. By porting FDC's Merkle verification to Sapphire, the backend can only relay roots (not forge deposits), matching FlexVaults' trust model but with much simpler proof logic (~120 lines vs ~1000+ MPT verification).

## What Changes

- New Solidity contract `FdcAccountingTrustless.sol` on Sapphire that stores FDC Merkle roots and verifies proofs on-chain
- New TypeScript backend that orchestrates the full flow: request FDC attestation, wait for proof, sync Merkle root to Sapphire, submit proof for on-chain verification
- Root relay mechanism: backend reads confirmed Merkle roots from Coston2's Relay contract and syncs them to Sapphire
- Private balance tracking on Sapphire (leveraging confidential state)

## Capabilities

### New Capabilities
- `merkle-verification`: On-chain FDC Merkle proof verification on Sapphire — leaf reconstruction, proof walk, root comparison
- `root-sync`: Relay FDC Merkle roots from Coston2 Relay contract to Sapphire root store
- `deposit-accounting`: Verify deposit proofs and credit private balances on Sapphire, with replay protection
- `relayer-backend`: TypeScript orchestrator that drives the FDC attestation request, root sync, and proof submission flow

### Modified Capabilities

## Impact

- New `fdc-trustless-merkle/` directory with Solidity contracts and TypeScript backend
- Dependencies: ethers.js v6, @flarenetwork/flare-tx-sdk, Solidity ^0.8.20, Hardhat or Foundry for contract compilation
- Requires research into FDC's exact leaf encoding format (`FdcVerification` contract source) and Merkle tree convention
- Interacts with: Coston2 Relay contract (read roots), Sapphire (deploy + call contract), FDC protocol (attestation requests)
- No changes to existing `src/poc.ts`
