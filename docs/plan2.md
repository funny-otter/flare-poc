# Plan 2: On-Chain Merkle Verification on Sapphire

## Overview

Port the FDC Merkle proof verification logic directly to Sapphire, so the accounting contract can verify FDC proofs without any trusted relayer or Coston2 interaction at transaction time. The FDC Merkle root is synced from Coston2 to Sapphire, and the contract verifies proofs locally.

## Architecture

```
Sepolia                    Coston2 (Flare)              Oasis Sapphire
+----------------+         +-------------------+        +------------------------------+
| User sends     |         | FDC providers     |        | FdcAccountingTrustless.sol   |
| ETH deposit    |         | vote on Merkle    |        |                              |
|                |         | root each round   |        | verifyAndCredit(proof)       |
|                |         |                   |        | |-- check Merkle root        |
|                |         | Relay contract    |        | |-- verify Merkle proof      |
|                |         | stores roots      |        | +-- credit balance           |
+-------+--------+         +--------+----------+        +-------------+----------------+
        |                           |                                 |
        |                    TypeScript Backend                       |
        |              +--------------------------------+             |
        |              | 1. Request FDC attestation     |             |
        |              | 2. Wait for proof (~2-3 min)   |             |
        |              | 3. Sync Merkle root to         |--- root ----+
        |              |    Sapphire (if needed)         |
        |              | 4. Submit proof to Sapphire     |--- proof ---+
        |              |    (contract verifies locally)  |
        |              +--------------------------------+
```

## How FDC Merkle Verification Works

The FDC `FdcVerification` contract on Coston2 does three things:
1. **Reconstruct the leaf**: Hash the attestation response data (tx details, block number, events, etc.) into a `bytes32` leaf
2. **Compute the root**: Walk the Merkle proof path from leaf to root using `keccak256` hashing
3. **Compare**: Check that the computed root matches the root stored in the `Relay` contract for that voting round

To port this to Sapphire, we need:
- The **leaf reconstruction** logic (hash the response struct)
- The **Merkle proof walk** logic (standard binary Merkle tree)
- A **root store** on Sapphire (synced from Coston2's Relay contract)

## Trust Model

| Component | FlexVaults | This PoC |
|---|---|---|
| Proof generation | Python backend | FDC protocol (managed) |
| Block hash trust | ShoyuBashi multi-oracle | FDC Merkle root (50%+ provider consensus) |
| Proof verification | ProvethVerifier on Sapphire | FDC Merkle verifier on Sapphire |
| Root source | ROFL oracle relays block headers | Backend relays FDC Merkle roots |
| Backend trust | ROFL TEE (for relay + proof gen) | Only relays roots (can't forge proofs) |
| Balance privacy | Sapphire | Sapphire (same) |

**Key advantage over Plan 1**: The backend only needs to relay Merkle roots -- it cannot fabricate deposits because the Merkle proof must verify against the root. This is analogous to how FlexVaults trusts ShoyuBashi for block hashes but verifies proofs independently.

**Key advantage over FlexVaults**: No ROFL TEE needed for proof generation. FDC handles proof generation off-chain. The Sapphire contract only needs ~50 lines of Merkle verification (vs ~400 lines of ProvethVerifier MPT logic).

## Sapphire Contract: `FdcAccountingTrustless.sol`

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract FdcAccountingTrustless {
    address public rootRelayer;       // Can only set Merkle roots (not forge proofs)
    address public immutable depositAddress;

    // FDC Merkle roots per voting round (synced from Coston2)
    mapping(uint256 votingRound => bytes32 merkleRoot) public fdcRoots;

    // Private balances
    mapping(address depositor => uint256 balance) private balances;
    mapping(bytes32 txHash => bool processed) public processedTxHashes;

    event RootSynced(uint256 indexed votingRound, bytes32 merkleRoot);
    event DepositCredited(address indexed depositor, uint256 amount, bytes32 indexed txHash);

    constructor(address _rootRelayer, address _depositAddress) {
        rootRelayer = _rootRelayer;
        depositAddress = _depositAddress;
    }

    /// @notice Sync an FDC Merkle root from Coston2 (called by root relayer)
    function syncRoot(uint256 votingRound, bytes32 merkleRoot) external {
        require(msg.sender == rootRelayer, "Unauthorized");
        require(fdcRoots[votingRound] == bytes32(0), "Root already set");
        fdcRoots[votingRound] = merkleRoot;
        emit RootSynced(votingRound, merkleRoot);
    }

    /// @notice Verify an FDC proof and credit the deposit -- fully trustless
    /// @param merkleProof The Merkle proof nodes from the FDC DA layer
    /// @param attestationType bytes32 "EVMTransaction"
    /// @param sourceId bytes32 "testETH"
    /// @param votingRound The FDC voting round
    /// @param lowestUsedTimestamp Timestamp from attestation
    /// @param txHash The Sepolia tx hash
    /// @param blockNumber Source chain block number
    /// @param timestamp Source chain block timestamp
    /// @param sourceAddress Sender on Sepolia
    /// @param receivingAddress Receiver on Sepolia
    /// @param value Wei transferred
    /// @param status 1 = success
    function verifyAndCredit(
        bytes32[] calldata merkleProof,
        bytes32 attestationType,
        bytes32 sourceId,
        uint64 votingRound,
        uint64 lowestUsedTimestamp,
        bytes32 txHash,
        uint64 blockNumber,
        uint64 timestamp,
        address sourceAddress,
        address receivingAddress,
        uint256 value,
        uint8 status
    ) external {
        // 1. Reconstruct the Merkle leaf (hash of the response data)
        bytes32 leaf = keccak256(abi.encode(
            attestationType, sourceId, votingRound, lowestUsedTimestamp,
            txHash, blockNumber, timestamp, sourceAddress,
            receivingAddress, value, status
        ));

        // 2. Verify Merkle proof against stored root
        bytes32 root = fdcRoots[votingRound];
        require(root != bytes32(0), "Root not synced for this round");
        require(_verifyMerkleProof(merkleProof, root, leaf), "Invalid Merkle proof");

        // 3. Validate deposit semantics
        require(status == 1, "Tx not successful");
        require(receivingAddress == depositAddress, "Wrong receiver");
        require(!processedTxHashes[txHash], "Already processed");
        require(value > 0, "Zero value");

        // 4. Credit balance
        processedTxHashes[txHash] = true;
        balances[sourceAddress] += value;

        emit DepositCredited(sourceAddress, value, txHash);
    }

    /// @notice Standard binary Merkle proof verification
    function _verifyMerkleProof(
        bytes32[] calldata proof,
        bytes32 root,
        bytes32 leaf
    ) internal pure returns (bool) {
        bytes32 computedHash = leaf;
        for (uint256 i = 0; i < proof.length; i++) {
            bytes32 proofElement = proof[i];
            if (computedHash <= proofElement) {
                computedHash = keccak256(abi.encodePacked(computedHash, proofElement));
            } else {
                computedHash = keccak256(abi.encodePacked(proofElement, computedHash));
            }
        }
        return computedHash == root;
    }

    function getBalance() external view returns (uint256) {
        return balances[msg.sender];
    }
}
```

## Research Required

The leaf reconstruction (`keccak256(abi.encode(...))`) must exactly match how FDC's `FdcVerification` contract constructs the leaf. This needs investigation:

1. **Leaf encoding**: Read the `FdcVerification` source or the Flare FDC spec to understand exact leaf encoding. It may include the full `RequestBody` and `ResponseBody` structs (including events, input data), not just the flat fields above.

2. **Merkle tree convention**: FDC may use a specific sorted/unsorted convention for internal nodes. The `_verifyMerkleProof` above uses sorted pairs (OpenZeppelin convention). FDC might differ.

3. **Root source on Coston2**: The Merkle root is stored in the `Relay` contract. We need the exact function to read it (`getConfirmedMerkleRoot(votingRound)` or similar).

These can be investigated by:
- Reading the FdcVerification source code on Coston2 block explorer
- Checking the Flare FDC documentation/spec
- Testing with a known proof: compute the leaf ourselves and verify it produces the right root

## TypeScript Backend Flow

```typescript
// Step 1-4: Same FDC attestation flow as Plan 1

// Step 5: Sync Merkle root to Sapphire (if not already synced)
//   Read root from Coston2 Relay contract for this voting round
//   Call accounting.syncRoot(votingRound, root) on Sapphire
const relay = new ethers.Contract(RELAY_ADDRESS, RELAY_ABI, coston2Provider);
const root = await relay.getConfirmedMerkleRoot(votingRoundId);
await accounting.syncRoot(votingRoundId, root);

// Step 6: Submit proof to Sapphire (contract verifies locally)
await accounting.verifyAndCredit(
    proofData.proof,           // Merkle proof nodes
    resp.attestationType,
    resp.sourceId,
    BigInt(resp.votingRound),
    BigInt(resp.lowestUsedTimestamp),
    resp.requestBody.transactionHash,
    BigInt(body.blockNumber),
    BigInt(body.timestamp),
    body.sourceAddress,
    body.receivingAddress,
    BigInt(body.value),
    Number(body.status)
);
```

## What This Proves

1. FDC Merkle proofs can be verified on any chain, not just Coston2
2. Sapphire can independently verify deposit proofs (no trusted relayer for proof data)
3. Root relay is the only trusted component (cannot forge proofs, only censor)
4. Equivalent to FlexVaults' model: ShoyuBashi provides trusted block hashes -> ProvethVerifier verifies proofs. Here: root relayer provides trusted Merkle roots -> Sapphire verifies FDC proofs.

## Limitations

- Leaf encoding must exactly match FDC's internal format (requires research)
- Root relayer can censor (delay roots) but cannot forge deposits
- No ERC-20 support in PoC
- Simplified proof struct (may need events/input for full leaf hash)

## Complexity

- ~120 lines Solidity (vs ~1000+ in FlexVaults, but much simpler logic)
- ~250 lines TypeScript
- Root relay is the only infrastructure (vs ROFL TEE + oracle + Hashi)

## Comparison with Plan 1

| Aspect | Plan 1 (Trusted Relayer) | Plan 2 (Merkle on Sapphire) |
|---|---|---|
| **Implementation effort** | Low (~2-3 hours) | Medium (~4-6 hours + research) |
| **Trust model** | Relayer trusted for accuracy | Relayer only trusted for root freshness |
| **Can relayer forge deposits?** | Yes (it submits raw data) | No (must have valid Merkle proof) |
| **Research needed** | None | FDC leaf encoding format |
| **Solidity complexity** | ~80 lines, trivial | ~120 lines, needs exact FDC encoding |
| **Closest to FlexVaults model** | Yes (trusted backend) | Yes (trustless proofs, trusted root source) |
| **Production path** | Add ROFL TEE for relayer | Add decentralized root relay |

## Recommendation

Start with Plan 1 for fast validation that FDC provides all necessary data. Then attempt Plan 2 to prove the stronger trustless property. Plan 1 can be completed in a single session; Plan 2 may need iteration to match FDC's exact leaf encoding.
