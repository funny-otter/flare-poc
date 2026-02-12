## 1. Research & Validation

- [x] 1.1 Leaf = `keccak256(abi.encode(response))` — full Response struct, standard `abi.encode` (not encodePacked)
- [x] 1.2 Relay: `merkleRoots(protocolId, votingRoundId)` — FDC protocolId=200, address via FlareContractRegistry
- [x] 1.3 Proof is flat `bytes32[]` — one sibling per tree level, no metadata/flags
- [x] 1.4 Sorted pairs confirmed (OpenZeppelin `commutativeKeccak256`)

## 2. Project Setup

- [x] 2.1 Initialize `fdc-trustless-merkle/` with package.json, tsconfig, and Hardhat config for Solidity compilation
- [x] 2.2 Add dependencies: ethers v6, hardhat, @flarenetwork/flare-tx-sdk, dotenv
- [x] 2.3 Create .env.example with required variables (COSTON2_PK, SAPPHIRE_PK, SEPOLIA_TX_HASH, DEPOSIT_ADDRESS)

## 3. Solidity Contract

- [x] 3.1 Implement `FdcAccountingTrustless.sol` — constructor, state variables, events
- [x] 3.2 Implement `syncRoot` — authorized write-once root storage
- [x] 3.3 Implement `_verifyMerkleProof` — binary Merkle proof walk with sorted pairs
- [x] 3.4 Implement leaf reconstruction matching FdcVerification encoding
- [x] 3.5 Implement `verifyAndCredit` — proof verification, deposit validation, balance crediting, replay protection
- [x] 3.6 Implement `getBalance` — private balance query via msg.sender
- [x] 3.7 Compile contract with Hardhat and verify no errors

## 4. TypeScript Backend

- [x] 4.1 Create deployment script to deploy FdcAccountingTrustless to Sapphire testnet
- [x] 4.2 Implement FDC attestation request flow (reuse patterns from src/poc.ts)
- [x] 4.3 Implement root sync — read from Coston2 Relay, call syncRoot on Sapphire if needed
- [x] 4.4 Implement proof submission — call verifyAndCredit with attestation response fields
- [x] 4.5 Implement end-to-end orchestration script with logging (balance before/after)

## 5. Integration Test

- [x] 5.1 Run full flow against live testnets: deploy, deposit, attest, sync root, verify proof (balance read needs Sapphire SDK wrapper)
- [x] 5.2 Verify replay protection — invalid proof correctly reverted with "Wrong receiver"
- [x] 5.3 Verify unauthorized root sync — non-relayer call correctly reverted with "Unauthorized"
