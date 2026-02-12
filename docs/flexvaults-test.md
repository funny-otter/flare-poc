# FlexVaults (Accounting Module) — Knowledge Document

> Source: [rube-de/flexvaults-test](https://github.com/rube-de/flexvaults-test) (private)
> License: MIT

## What It Does

A reusable ROFL-based accounting module that provides:

- **Cross-chain deposits** — users deposit native tokens or ERC-20s on any EVM chain; the module verifies the deposit on Oasis Sapphire via transaction inclusion proofs and credits the user's balance.
- **Private accounting** — all balances, locks, and transfers are managed on Sapphire, invisible to the public.
- **Fund locking** — users can lock funds for services (e.g. a game or escrow), authorized via EIP-712 signatures.
- **Cross-chain withdrawals** — the contract generates and signs withdrawal transactions on Sapphire using the `EIP155Signer` precompile, and the backend broadcasts them to the destination chain.

## Architecture Overview

```
Source Chain (e.g. Base Sepolia)        Oasis Sapphire
┌──────────────────────┐                ┌──────────────────────────────┐
│  User sends ETH or   │                │        Accounting.sol        │
│  ERC-20 to deposit   │─── proofs ────>│  creditEVMDeposit()          │
│  address             │                │  createLock() / modifyLock() │
│                      │                │  transferBalance()           │
│                      │<── signed tx ──│  requestWithdrawal()         │
│  User receives       │                │  resolveWithdrawal()         │
│  withdrawal          │                └──────────┬───────────────────┘
└──────────────────────┘                           │ inherits
                                         ┌─────────┴──────────┐
                                         │                     │
                                ┌────────┴──────┐   ┌─────────┴─────────┐
                                │EIP712Signature│   │EVMSignerAndVerifier│
                                │  Verifier     │   │ (tx decode, sign,  │
                                │               │   │  proof verify)     │
                                └───────────────┘   └─────────┬─────────┘
                                                              │ inherits
                                                    ┌─────────┴─────────┐
                                                    │  ProvethVerifier   │
                                                    │ (Merkle Patricia   │
                                                    │  Trie proofs)      │
                                                    └───────────────────┘

Python Backend (FastAPI in ROFL TEE)
┌──────────────────────────────────────────────────────────────────────┐
│  DepositListener  — polls source chains for deposits to deposit addr │
│  WithdrawalProcessor — polls for pending withdrawals, resolves/bcasts│
│  ProofGenerator   — builds tx + receipt Merkle Patricia Trie proofs  │
│  AccountingContractService — submits txs to Accounting via ROFL      │
│  RoflAppdClient   — ROFL daemon client (key gen, tx sign+submit)     │
│  FastAPI routes    — REST API at /v1/accounting/*                     │
└──────────────────────────────────────────────────────────────────────┘
```

## Smart Contracts

### Accounting.sol (main contract)

The central ledger. Manages `mapping(address => mapping(bytes32 tokenId => uint256))` balances. Inherits `EIP712SignatureVerifier` and `EVMSignerAndVerifier`.

**Deposit flow:**
- `creditEVMDeposit(userAddress, tokenId, txProof, receiptProof)` — verifies both the transaction and receipt inclusion proofs via `ProvethVerifier`, decodes the raw EVM transaction (supports Legacy, EIP-2930, EIP-1559), verifies the block hash via ShoyuBashi oracle, validates sender/recipient/amount, and credits the user's balance.

**Fund locking:**
- `createLock(user, service, tokenId, amount, expiry, signature)` — moves funds from balance to a time-locked escrow. Max 10 active locks per user.
- `modifyLock(user, lockId, amount, newExpiry, signature)` — add funds or extend expiry on an existing lock.
- `transferFromLock(user, to, lockId, amount, signature)` — the *service* signs to authorize transferring locked funds to a recipient.
- `unlockSingleLock(user, lockId)` / `unlockAllExpiredLocks(user)` — reclaim expired locks.

**Transfers:**
- `transferBalance(user, to, tokenId, amount, signature)` — off-chain-signed peer-to-peer transfer within the ledger.

**Withdrawal flow:**
- `requestWithdrawal(user, tokenId, amount, nonce, signature)` — debits balance, records a `WithdrawalRequest` with a chain-specific nonce.
- `resolveWithdrawal(index)` — generates a signed EVM transaction (via Sapphire's `EIP155Signer` precompile) for the destination chain. Idempotent — can be called multiple times to retry broadcast.

**Token registry:**
- `setTokenInfo(TokenInfo)` — owner registers supported tokens.
- `getTokenId(TokenInfo)` — deterministic `keccak256(abi.encode(tokenType, data))`.
- Token types: `NativeEVM` (32 bytes: chainId) or `ERC20` (52 bytes: chainId + address).

### EVMSignerAndVerifier.sol

Handles the cryptographic heavy lifting:

- **Transaction decoding** — `decodeEVMTransaction()` supports Legacy (>= 0xc0), EIP-2930 (type 1), and EIP-1559 (type 2) transactions. Recovers sender via ECDSA.
- **Transaction signing** — `generateNativeTransfer()` and `generateERC20Transfer()` use Sapphire's `EIP155Signer.sign()` precompile with a secret key generated at deployment via `EthereumUtils.generateKeypair()`.
- **Block hash verification** — `verifyBlockHash()` queries `ShoyuBashi.getUnanimousHash(chainId, blockNumber)`.
- **Receipt decoding** — `decodeEVMTxReceipt()` extracts status and gas used.
- **Nonce management** — per-chain nonces for withdrawal transactions.
- **Gas price management** — `setGasPrice(chainId, gasPrice)` — owner-only, must be set before generating withdrawal txs.

### EIP712SignatureVerifier.sol

Typed data signing for all user operations:

| Operation | Type Hash | Signer |
|---|---|---|
| `Withdraw` | `Withdraw(address userAddress,bytes32 tokenId,uint256 amount,uint256 nonce)` | User |
| `Lock` | `Lock(address userAddress,address serviceAddress,bytes32 tokenId,uint256 amount,uint256 expiry)` | User |
| `Transfer` | `Transfer(address userAddress,address toAddress,bytes32 tokenId,uint256 amount)` | User |
| `TransferLocked` | `TransferLocked(address userAddress,address toAddress,uint256 lockId,uint256 amount)` | Service |
| `ModifyLock` | `ModifyLock(address userAddress,uint256 lockId,uint256 amount,uint256 newExpiry)` | User |

Domain: `name="AccountingModule"`, `version="1"`. Signatures are single-use (tracked in `usedSignatures` mapping). Withdrawals use a per-user nonce instead.

### ProvethVerifier.sol

Merkle Patricia Trie proof verification for both transactions and receipts. Validates proofs against `transactionsRoot` and `receiptsRoot` in the block header.

### ShoyuBashi (external — Hashi)

Multi-oracle block hash consensus system. The `Accounting` contract calls `shoyuBashi.getUnanimousHash(chainId, blockNumber)` to verify that the block hash in a deposit proof is legitimate. The ROFL Header Oracle (see [rofl-header-oracle.md](./rofl-header-oracle.md)) feeds block hashes into the `ROFLAdapter`, which is one of ShoyuBashi's configured adapters.

## Python Backend

### Tech Stack

- **FastAPI** (uvicorn) — REST API
- **web3.py** — blockchain interaction
- **oasis-rofl-client** — ROFL daemon communication
- **rlp** / **trie** (HexaryTrie) — Merkle Patricia Trie proof generation
- **cbor2** — ROFL response decoding
- Runs in Docker inside a ROFL TEE container (TDX)

### Key Services

**DepositListener** (`src/services/deposit_listener.py`)
- Polls configured source chains for incoming transfers to the deposit address (both native and ERC-20 `Transfer` events).
- Waits for the block hash to appear in the ROFLAdapter on Sapphire (via `getHash(chainId, blockNumber)`).
- Generates Merkle Patricia Trie proofs (tx proof + receipt proof) using `debug_getRawBlock` and `debug_getRawReceipts` RPCs.
- Submits `creditEVMDeposit()` to the Accounting contract via ROFL.

**WithdrawalProcessor** (`src/services/withdrawal_processor.py`)
- Polls for pending `WithdrawalRequest` entries in the Accounting contract.
- Calls `resolveWithdrawal(index)` to get a signed transaction from the contract.
- Broadcasts the signed tx to the destination chain.
- Includes a catch-up mechanism that compares contract nonces vs destination chain nonces to find and re-broadcast missing withdrawals.

**ProofGenerator** (`src/services/proof_generator.py`)
- Builds both transaction and receipt Merkle Patricia Trie inclusion proofs.
- Uses `debug_getRawBlock` to get raw block data and reconstruct the trie.
- Uses `debug_getRawReceipts` for receipt proofs.
- Requires archive node access with debug API enabled.

**AccountingContractService** (`src/services/accounting_contract.py`)
- Wraps all contract interactions: deposits, locks, transfers, withdrawals.
- Submits transactions via the `RoflAppdClient`.

**RoflAppdClient** (`src/clients/rofl.py`)
- Singleton wrapper around `oasis-rofl-client`.
- `get_keypair(key_id)` — generates secp256k1 keys via ROFL daemon.
- `submit_tx(tx)` — signs and submits transactions, decodes CBOR responses, detects reverts by decoding error selectors.

### REST API

All routes under `/v1/accounting/`:

| Method | Endpoint | Description |
|---|---|---|
| POST | `/quote/deposit` | Get deposit instructions (address, tx data) |
| POST | `/deposits` | Submit deposit inclusion proof |
| POST | `/funds/lock` | Lock funds for a service |
| POST | `/funds/modify-lock` | Modify an existing lock |
| POST | `/funds/transfer` | Transfer between users |
| POST | `/funds/transfer-locked` | Transfer from locked funds (service-signed) |
| POST | `/funds/unlock` | Unlock expired lock |
| POST | `/funds/unlock-all-expired` | Unlock all expired locks |
| POST | `/withdrawals` | Request withdrawal |
| GET | `/balances/{user}/{tokenId}` | Get user balance |
| POST | `/balances/batch` | Get multiple balances |
| GET | `/locks/{user}` | Get user's active locks |
| GET | `/locks/{user}/expired` | Get expired locks |
| GET | `/tokens/{tokenId}` | Get token info |

### Configuration

Environment variables (loaded via `src/config/__init__.py`):

| Variable | Description |
|---|---|
| `ACCOUNTING_CONTRACT_ADDRESS` | Accounting contract on Sapphire |
| `ROFL_ADAPTER_ADDRESS` | ROFLAdapter for block hash lookups |
| `SAPPHIRE_RPC_URL` | Sapphire RPC endpoint |
| `SAPPHIRE_CHAIN_ID` | Sapphire chain ID |
| `ALCHEMY_API_KEY` | Used to construct source chain RPC URLs |
| `DEPOSIT_POLL_INTERVAL` | Seconds between deposit checks |

Currently configured for **Base Sepolia** (chain ID 84532) as the source chain, with USDC ERC-20 support.

## Deployment

- **ROFL TEE:** TDX container, 1 CPU, 1GB RAM, 8GB persistent disk
- **Docker:** Multi-stage build (see `Dockerfile`)
- **Secrets:** Encrypted in `rofl.yaml` via ROFL secrets management
- **Solidity tooling:** Hardhat with Sapphire plugin, deployed via `npx hardhat deploy --shoyubashi <addr>`

## Security Model

1. **Deposit verification** — tx + receipt Merkle Patricia Trie proofs verified on-chain by ProvethVerifier, block hash consensus via ShoyuBashi (multi-oracle).
2. **User authorization** — all balance-affecting operations require EIP-712 typed data signatures; signatures are single-use.
3. **Withdrawal security** — private key for destination chain signing lives only in the Sapphire contract (generated via `EthereumUtils.generateKeypair()`). Resolution requires a block delay to prevent simulation attacks.
4. **TEE isolation** — backend runs inside ROFL TDX enclave. ROFL daemon handles key derivation and transaction signing.

## Relevance to Flare FDC PoC

| FlexVaults | Flare FDC PoC |
|---|---|
| Verifies source chain txs via Merkle Patricia Trie proofs (ProvethVerifier) | Verifies Sepolia txs via FDC attestation + Merkle proof against attestation root |
| Block hash trust via ShoyuBashi (multi-oracle consensus) | Block/tx trust via FDC attestation providers (decentralized voting) |
| Full tx decoding on-chain (Legacy, EIP-2930, EIP-1559) | Verifies specific tx fields via FDC response structure |
| Proof generation uses `debug_getRawBlock` + HexaryTrie | Proof generation handled by FDC protocol / attestation clients |
| Balances live on Sapphire (private) | Verification result lives on Coston2 (public) |
| Two-phase withdrawal (request -> resolve -> broadcast) | Single-step attestation verification |

The key shared concept is **transaction inclusion proofs**: both systems need to prove that a specific transaction was included in a specific block on the source chain, and both verify this against a trusted block hash. FlexVaults does the Merkle proof verification itself on-chain, while the Flare FDC delegates proof verification to a network of attestation providers.
