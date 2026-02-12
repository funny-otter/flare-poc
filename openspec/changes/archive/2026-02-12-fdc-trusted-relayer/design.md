## Context

The existing `src/poc.ts` demonstrates FDC attestation end-to-end: prepare request, submit to Coston2, wait for proof, verify on-chain. This design extends that flow to relay verified deposit data to a Sapphire accounting contract, mirroring FlexVaults' architecture with dramatically less infrastructure.

The codebase uses TypeScript (strict ESM), ethers.js v6, and runs via tsx. There are no existing Solidity contracts or Hardhat tooling in the project.

## Goals / Non-Goals

**Goals:**
- Demonstrate FDC-verified cross-chain deposit accounting on Sapphire with private balances
- Keep the relayer simple — single TypeScript entry point, no queue or persistence
- Reuse existing FDC attestation logic from `src/poc.ts` where possible
- Provide a self-contained demo that deploys the contract and runs the full flow

**Non-Goals:**
- Production relayer (no retries, no event watching, no queue)
- ROFL TEE integration for the relayer (plain EOA signer for PoC)
- ERC-20 token support (native ETH only)
- Withdrawals, transfers, or fund locking
- Mainnet deployment or gas optimization

## Decisions

### 1. Separate `contracts/` subdirectory with Hardhat

**Decision**: Solidity compilation via Hardhat in `fdc-trusted-relayer/contracts/`, separate from the tsx-based TypeScript runtime.

**Rationale**: Hardhat handles Solidity compilation, ABI generation, and deployment scripts cleanly. Keeping it in a subdirectory avoids polluting the root `package.json` with Solidity tooling.

**Alternative considered**: Inline ABI as a JSON constant in TypeScript. Rejected because it makes the contract source non-compilable and harder to verify/modify.

### 2. Single-file relayer at `src/accounting-demo.ts`

**Decision**: One TypeScript file orchestrates the full flow (deploy → attest → verify → relay → query).

**Rationale**: Matches the project's existing pattern (`src/poc.ts` is single-file). For a PoC, a linear script is clearer than a modular architecture.

**Alternative considered**: Extract shared FDC logic into a library module. Worth doing if the codebase grows, but premature for two files.

### 3. Sapphire provider wrapping with `@oasisprotocol/sapphire-paratime`

**Decision**: Wrap the ethers.js provider with `sapphire.wrap()` for automatic transaction encryption.

**Rationale**: This is the standard Sapphire integration pattern. It encrypts calldata so balance queries and deposits stay confidential on-chain.

### 4. Contract deploys fresh each run (no address persistence)

**Decision**: The demo script deploys `FdcAccounting` on each run rather than persisting a contract address.

**Rationale**: Simplifies the PoC — no state file or env var management for contract addresses. The demo is self-contained. Users can easily modify to connect to an existing deployment.

### 5. Double-credit prevention via tx hash mapping

**Decision**: `processedTxHashes` mapping in the contract prevents the same Sepolia tx from being credited twice.

**Rationale**: Essential correctness property. Even though the PoC relayer only runs once, the contract must be safe against replays for any real usage.

## Risks / Trade-offs

- **[Trusted relayer is a single point of trust]** → Acceptable for PoC. In production, wrap in ROFL TEE or use multisig. The contract's `onlyRelayer` modifier is already designed for a single authorized address, which maps cleanly to a ROFL app address.

- **[FDC proof verified on Coston2, not on Sapphire]** → The relayer bridges two separate chains. The Sapphire contract trusts the relayer's attestation. This is architecturally identical to FlexVaults (ROFL backend verifies proof, then writes to Sapphire).

- **[Sapphire testnet availability]** → Sapphire testnet may have downtime. No mitigation needed for a PoC.

- **[Hardhat adds dependency weight]** → Only needed in `contracts/` subdirectory. Does not affect the tsx runtime. Could use solc directly but Hardhat provides better DX for deployment.
