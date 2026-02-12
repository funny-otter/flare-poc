## Context

The existing FDC PoC (`src/poc.ts`) demonstrates cross-chain attestation verification on Coston2. This design moves verification to Oasis Sapphire, where a contract independently verifies FDC Merkle proofs against synced roots. The backend's role reduces to relaying roots — it cannot forge deposits.

Three chains are involved:
- **Sepolia** — source chain where users send ETH deposits
- **Coston2** — Flare testnet where FDC providers vote on Merkle roots per voting round, stored in the Relay contract
- **Sapphire** — Oasis confidential EVM where the accounting contract lives

## Goals / Non-Goals

**Goals:**
- Verify FDC Merkle proofs entirely on Sapphire (no Coston2 interaction at verification time)
- Maintain private balance state using Sapphire's confidential storage
- Demonstrate the trustless property: backend relays roots but cannot fabricate deposits
- Match FDC's exact leaf encoding so proofs verify correctly

**Non-Goals:**
- ERC-20 token deposits (ETH only for PoC)
- Decentralized root relay (single relayer address is acceptable for PoC)
- Withdrawal mechanism (deposit crediting only)
- Production hardening (upgradability, access control patterns, gas optimization)
- ROFL TEE integration for the relayer

## Decisions

### 1. Leaf encoding: match FdcVerification exactly

**Decision**: Research and replicate the exact `keccak256(abi.encode(...))` leaf construction used by Flare's `FdcVerification` contract, rather than inventing our own encoding.

**Rationale**: FDC proofs are generated against a specific leaf format. If our leaf hash doesn't match, proof verification fails. The leaf likely includes the full `EVMTransaction.Response` struct (attestationType, sourceId, votingRound, lowestUsedTimestamp, requestBody, responseBody) — not just flat fields.

**Alternatives considered**:
- Simplified flat encoding (fewer fields) — would break proof verification
- Passing pre-computed leaf hash from backend — defeats the trustless property

**Open risk**: The exact encoding needs to be confirmed by reading `FdcVerification` source code or testing against a known proof.

### 2. Merkle proof convention: sorted pairs (OpenZeppelin style)

**Decision**: Use sorted-pair hashing (`min(a,b) || max(a,b)`) for internal Merkle nodes, matching the OpenZeppelin `MerkleProof` convention.

**Rationale**: This is the most common convention and likely what FDC uses. If FDC uses a different convention (e.g., positional left/right with an index bitmap), we'll adapt during implementation.

**Alternatives considered**:
- Positional proof with left/right indicators — more complex, only needed if FDC uses this format

### 3. Single contract with inline verification

**Decision**: Keep all logic in one `FdcAccountingTrustless.sol` contract — root storage, Merkle verification, and balance accounting.

**Rationale**: PoC scope. Splitting into libraries or separate contracts adds complexity without benefit at this stage. The total is ~120 lines.

**Alternatives considered**:
- Separate `MerkleVerifier` library — overkill for PoC
- OpenZeppelin's `MerkleProof` library — could use, but inlining ~15 lines is simpler than adding a dependency

### 4. Root sync: backend reads Relay, calls syncRoot

**Decision**: The TypeScript backend reads confirmed Merkle roots from Coston2's `Relay` contract and calls `syncRoot(votingRound, merkleRoot)` on the Sapphire contract. Roots are write-once (cannot be overwritten).

**Rationale**: Simplest approach. The backend is the only entity that needs Coston2 access. The contract trusts the relayer for root values but the relayer cannot forge proofs against those roots.

**Alternatives considered**:
- Cross-chain message bridge (Coston2 → Sapphire) — no production bridge exists for this path
- ROFL TEE relayer — production direction but out of scope for PoC

### 5. Project structure: standalone subdirectory

**Decision**: All code lives in `fdc-trustless-merkle/` with its own `package.json`, Hardhat config for Solidity compilation, and TypeScript backend.

**Rationale**: Keeps the new subsystem isolated from the existing PoC in `src/poc.ts`. Allows independent dependency management (Hardhat for Solidity, ethers for backend).

### 6. Replay protection: txHash-based deduplication

**Decision**: Track processed transaction hashes in a `mapping(bytes32 => bool)`. Reject any proof for an already-processed txHash.

**Rationale**: Simple and sufficient. Each Sepolia deposit tx has a unique hash. Prevents the same proof from being submitted twice.

## Risks / Trade-offs

- **Leaf encoding mismatch** → Proofs will fail silently. Mitigation: test with a real FDC proof early; compare our leaf hash with the one FDC generates. This is the highest-risk item.
- **Merkle convention mismatch** → Same failure mode. Mitigation: if sorted pairs don't work, inspect the proof structure and switch to positional.
- **Root relayer censorship** → Relayer can delay or withhold roots, preventing deposit crediting. Mitigation: acceptable for PoC; production would use decentralized relay or on-chain bridge.
- **No root validation** → The contract trusts whatever root the relayer provides. A compromised relayer key could set a fake root. Mitigation: write-once roots limit damage; production would add multi-sig or bridge verification.
- **Sapphire gas costs** → Merkle proof verification is cheap (~5k gas per proof level), not a concern for PoC.

## Open Questions

1. **Exact FdcVerification leaf encoding** — What struct fields are included and in what order? Does it use `abi.encode` or `abi.encodePacked`? Does it include nested structs (events, input data)?
2. **Relay contract API** — What is the exact function signature to read confirmed Merkle roots? (`merkleRoots(protocolId, votingRound)` or `getConfirmedMerkleRoot(votingRound)`?)
3. **Proof format from FDC** — How are Merkle proof nodes returned from the DA layer? Array of `bytes32`? Any metadata (indices, flags)?
