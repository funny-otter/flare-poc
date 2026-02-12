# Plan 1: Trusted Relayer Backend

## Overview

A TypeScript backend verifies the FDC proof on Coston2 (view call to `FdcVerification`), then submits the verified transaction data to a Sapphire accounting contract as an authorized signer. This mirrors FlexVaults' trust model (ROFL TEE backend -> Sapphire contract) but replaces proof generation entirely with FDC.

## Architecture

```
Sepolia                    Coston2 (Flare)              Oasis Sapphire
+----------------+         +-------------------+        +-----------------------+
| User sends     |         | FDC attestation   |        | FdcAccounting.sol     |
| ETH deposit    |         | providers vote    |        | (private balances)    |
|                |         |                   |        |                       |
|                |         | FdcVerification   |        | creditDeposit()       |
|                |         | .verifyEVM...()   |        | getBalance()          |
+-------+--------+         +--------+----------+        +----------+------------+
        |                           |                              |
        |                    TypeScript Backend                    |
        |              +-------------------------------+           |
        |              | 1. Request FDC attestation    |           |
        |              | 2. Wait for proof (~2-3 min)  |           |
        |              | 3. Verify on Coston2 (view)   |-- verify -+
        |              | 4. Submit to Sapphire         |-- credit -+
        |              +-------------------------------+
```

## Trust Model

| Component | FlexVaults | This PoC |
|---|---|---|
| Proof generation | Python backend + `debug_getRawBlock` + HexaryTrie | FDC attestation providers (fully managed) |
| Block hash trust | ROFL TEE -> ROFLAdapter -> ShoyuBashi | FDC decentralized voting (50%+ provider consensus) |
| Proof verification | ProvethVerifier on Sapphire (~400 lines) | FdcVerification on Coston2 (1 view call) |
| Backend trust anchor | ROFL TEE attestation (`onlyROFL` modifier) | Authorized signer (EOA or could be ROFL TEE) |
| Balance privacy | Sapphire confidential compute | Sapphire confidential compute (same) |

**Key tradeoff**: The backend is trusted to relay accurate FDC results. In production, this relayer could itself run inside a ROFL TEE for the same trust guarantees as FlexVaults, or a multisig/threshold scheme could be used. For the PoC, a simple authorized signer demonstrates the concept.

## Sapphire Contract: `FdcAccounting.sol`

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract FdcAccounting {
    address public immutable authorizedRelayer;

    // Private balances (Sapphire confidential storage)
    mapping(address depositor => uint256 balance) private balances;
    mapping(bytes32 txHash => bool processed) public processedTxHashes;

    event DepositCredited(address indexed depositor, uint256 amount, bytes32 indexed txHash);

    error Unauthorized();
    error AlreadyProcessed(bytes32 txHash);
    error ZeroValue();

    modifier onlyRelayer() {
        if (msg.sender != authorizedRelayer) revert Unauthorized();
        _;
    }

    constructor(address _relayer) {
        authorizedRelayer = _relayer;
    }

    /// @notice Credit a deposit after the relayer has verified the FDC proof on Coston2.
    /// @param txHash The Sepolia transaction hash (prevents double-crediting)
    /// @param depositor The sender address on Sepolia (from FDC responseBody.sourceAddress)
    /// @param value The ETH value in wei (from FDC responseBody.value)
    function creditDeposit(
        bytes32 txHash,
        address depositor,
        uint256 value
    ) external onlyRelayer {
        if (processedTxHashes[txHash]) revert AlreadyProcessed(txHash);
        if (value == 0) revert ZeroValue();

        processedTxHashes[txHash] = true;
        balances[depositor] += value;

        emit DepositCredited(depositor, value, txHash);
    }

    /// @notice Query balance (only callable by the depositor themselves for privacy)
    function getBalance() external view returns (uint256) {
        return balances[msg.sender];
    }

    /// @notice Relayer can query any balance (for operational purposes)
    function getBalanceOf(address user) external view onlyRelayer returns (uint256) {
        return balances[user];
    }
}
```

## TypeScript Backend Flow

```typescript
// src/accounting-demo.ts

// Step 0: Connect to both chains
const coston2Provider = new ethers.JsonRpcProvider(COSTON2_RPC);
const sapphireProvider = sapphire.wrap(new ethers.JsonRpcProvider(SAPPHIRE_RPC));
const signer = new ethers.Wallet(PRIVATE_KEY, sapphireProvider);

// Step 1: Deploy FdcAccounting on Sapphire (or connect to existing)
const accounting = await deployOrConnect(signer);

// Step 2-4: FDC attestation on Coston2 (reuse from fdc.ts)
const abiEncodedRequest = await prepareAttestationRequest(sepoliaTxHash);
const { votingRoundId } = await submitAttestationRequest(coston2Signer, abiEncodedRequest);
const proofData = await waitForProof(votingRoundId, abiEncodedRequest);

// Step 5: Verify FDC proof on Coston2 (view call -- no gas)
const isValid = await verifyOnChain(coston2Provider, proofData);
assert(isValid, "FDC proof invalid");

// Step 6: Relay verified data to Sapphire
const { sourceAddress, value } = proofData.response.responseBody;
const txHash = proofData.response.requestBody.transactionHash;
await accounting.creditDeposit(txHash, sourceAddress, BigInt(value));

// Step 7: Query balance on Sapphire
const balance = await accounting.getBalanceOf(sourceAddress);
console.log(`Balance credited: ${ethers.formatEther(balance)} ETH`);
```

## Dependencies

- Existing: ethers.js, @flarenetwork/flare-tx-sdk, dotenv, tsx
- New: `@oasisprotocol/sapphire-paratime` (wraps ethers provider for Sapphire encrypted txs)
- Hardhat in `contracts/` subdirectory (for Solidity compilation)

## What This Proves

1. FDC attestation provides all data FlexVaults needs (sender, receiver, value, status)
2. No ROFL oracle, ShoyuBashi, or ProvethVerifier needed
3. Accounting stays on Sapphire (private balances)
4. Backend trust model is equivalent to FlexVaults (trusted relayer)

## Limitations

- Relayer is a simple EOA (FlexVaults uses ROFL TEE attestation)
- No ERC-20 support (only native ETH)
- No fund locking, transfers, or withdrawals (deposit crediting only)
- The FDC proof is verified off-Sapphire (Coston2 view call), then relayed

## Complexity

- ~80 lines Solidity (vs ~1000+ lines in FlexVaults contracts)
- ~200 lines TypeScript (vs ~600 lines Python backend in FlexVaults)
- Zero infrastructure (vs ROFL TEE + oracle + Hashi)
