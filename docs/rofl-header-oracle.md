# ROFL Header Oracle — Knowledge Document

> Source: [oasisprotocol/rofl-header-oracle](https://github.com/oasisprotocol/rofl-header-oracle)
> License: Apache 2.0

## What It Does

A Python-based oracle that relays block headers from EVM source chains to Oasis Sapphire via ROFL (Runtime OFf-chain Logic). It's designed for Hashi-based cross-chain bridge verification — the oracle stores block hashes on-chain so that downstream contracts can verify Merkle proofs against them.

## Why It Matters for This Project

The flare-poc verifies Sepolia transactions on Coston2 via Merkle proof attestation. ROFL Header Oracle solves the same fundamental problem on the Oasis side: getting trusted block headers cross-chain so proofs can be verified. It's a reference for how a production-grade block header relay works end-to-end.

## Architecture Overview

```
Source Chain (any EVM)          Oasis Sapphire (target)
┌────────────────────┐          ┌─────────────────────┐
│ BlockHeaderRequester│          │    ROFLAdapter       │
│ (Solidity)          │          │    (Solidity)        │
│                     │          │                      │
│ emits               │          │ storeBlockHeader()   │
│ BlockHeaderRequested│──oracle──│ storeBlockheaders()  │
│ events              │          │ getHash(chainId, bn) │
└────────────────────┘          └─────────────────────┘
                                        │
                                  inherits from
                                        │
                                ┌───────┴───────┐
                                │BlockHashAdapter│
                                │  (Hashi)       │
                                │                │
                                │ proveAncestral │
                                │ BlockHashes()  │
                                └───────┬───────┘
                                        │
                                ┌───────┴───────┐
                                │   Adapter      │
                                │  _storeHash()  │
                                │  getHash()     │
                                └───────────────┘
```

### Key components

| Component | Path | Role |
|---|---|---|
| **HeaderOracle** | `rofl_oracle/header_oracle.py` | Main orchestrator — connects to source chain, dispatches to the correct run mode, manages lifecycle |
| **BlockSubmitter** | `rofl_oracle/block_submitter.py` | Submits block headers to ROFLAdapter on Sapphire (single or batch) |
| **EventProcessor** | `rofl_oracle/event_processor.py` | Parses, validates, deduplicates `BlockHeaderRequested` events |
| **RoflUtility** | `rofl_oracle/utils/rofl_utility.py` | Communicates with the ROFL appd daemon over a Unix socket — key derivation and tx submission |
| **ContractUtility** | `rofl_oracle/utils/contract_utility.py` | Web3 contract interaction helper, loads ABIs from compiled artifacts |
| **PollingEventListener** | `rofl_oracle/utils/polling_event_listener.py` | Polls source chain for new events with configurable lookback |
| **HealthCheckServer** | `rofl_oracle/health_check.py` | HTTP health endpoints on port 8080 (`/health`, `/health/live`, `/health/ready`) |
| **Config** | `rofl_oracle/config.py` | Loads all config from environment variables, validates per mode |

## Operating Modes

### 1. Event Listener (`ORACLE_MODE=event_listener`) — default

Polls the source chain for `BlockHeaderRequested` events emitted by the `BlockHeaderRequester` contract. When a request is found, fetches the block header and submits it to the ROFLAdapter.

**Flow:** `BlockHeaderRequester.requestBlockHeader()` -> event emitted -> oracle polls -> fetches block header from source RPC -> `ROFLAdapter.storeBlockHeader()`

### 2. Push (`ORACLE_MODE=push`)

Proactively pushes the latest block headers from the source chain at a fixed interval. No event listening required — simply keeps the target chain's view of the source chain up to date.

**Config:** `PUSH_INTERVAL` (default 60s), `PUSH_BATCH_SIZE` (default 20)

### 3. Watcher (`ORACLE_MODE=watcher`)

Monitors specific addresses on the source chain for any interaction (transactions to/from). When activity is detected, submits the relevant block headers. Useful when you want block headers for blocks that contain specific address activity.

**Config:** `WATCH_ADDRESSES` (comma-separated), `SCAN_INTERVAL` (default 60s), optional `ENABLE_INTERNAL_TX_DETECTION` (requires archive node with `debug_traceTransaction`)

### 4. Token Watcher (`ORACLE_MODE=token_watcher`)

Specialization of watcher mode that monitors ERC-20 `Transfer` events for specific token/recipient pairs. Submits block headers for blocks containing matching transfers.

## Smart Contracts

### ROFLAdapter (target chain — Sapphire)

Inherits from Hashi's `BlockHashAdapter -> Adapter`. Stores block hashes keyed by `(chainId, blockNumber)`.

**Key features:**
- `onlyROFL` modifier — uses `Subcall.roflEnsureAuthorizedOrigin(roflAppID)` to verify the caller is the authorized ROFL app
- `onlyChainReporter(chainId)` — each chain has a dedicated reporter address (avoids nonce collisions when multiple oracle instances run concurrently)
- `storeBlockHeader(chainId, blockNumber, blockHash)` — single header submission
- `storeBlockheaders(chainId, blockNumbers[], blockHashes[])` — batch submission
- `getHash(domain, id)` — inherited from Adapter, retrieves stored block hash
- `proveAncestralBlockHashes(chainId, rlpHeaders[])` — inherited from BlockHashAdapter, verifies parent hash chain from a known stored block hash and stores ancestor hashes
- `lastStoredBlock[chainId]` — tracks the highest stored block per chain

### BlockHeaderRequester (source chain)

Simple contract that lets anyone request a block header for a specific chain/block combination:
- `requestBlockHeader(chainId, blockNumber, context)` — emits `BlockHeaderRequested` event, deduplicates via `requestedBlocks` mapping
- The oracle listens for this event in event_listener mode

## ROFL Integration

The oracle runs inside an Oasis ROFL TEE (TDX) container. Communication with the ROFL runtime daemon happens over a Unix socket at `/run/rofl-appd.sock`:

- **Key derivation:** `POST /rofl/v1/keys/generate` with `{"key_id": "rofl-oracle-signer-{chainId}", "kind": "secp256k1"}` — generates deterministic chain-specific signing keys
- **Tx submission:** `POST /rofl/v1/tx/sign-submit` — signs and submits transactions via the ROFL runtime; response is CBOR-encoded

This means the oracle's signing key is derived inside the TEE and never leaves it.

## Deployment

- **Runtime:** Python 3.12 with `uv` package manager
- **Container:** Multi-stage Docker build — Bun compiles Solidity contracts and extracts ABIs, then Python runtime copies them into `/app/abis/`
- **Orchestration:** Docker Compose (`compose.yaml` for production, `compose.local.yaml` for local testing)
- **ROFL config:** `rofl.yaml` / `rofl-dev.yaml` — defines TEE requirements (TDX, 4GB RAM, 2 CPUs, 10GB persistent disk)
- **Dependencies:** `web3`, `httpx`, `cbor2`, `aiohttp`, `eth-typing`

## Resilience Patterns

- **Exponential backoff** with jitter on retries (configurable `RETRY_COUNT`, default 3)
- **Circuit breakers** for source and target RPC connections (fail-open after threshold, auto-recover)
- **Event deduplication** via `OrderedDict` with FIFO eviction (default window: 1000 events)
- **Balance monitoring** — pauses operation if reporter wallet balance drops below threshold (`MIN_REPORTER_BALANCE`)
- **Health checks** — HTTP liveness/readiness probes for container orchestration

## Local Development Mode

Setting `--local` flag (or using `compose.local.yaml`) skips ROFL utilities entirely:
- Uses a `LOCAL_PRIVATE_KEY` instead of TEE-derived keys
- Submits transactions directly via web3 instead of through ROFL daemon
- Full event listening and processing still works — useful for integration testing

## Relevance to Flare FDC PoC

| ROFL Header Oracle | Flare FDC PoC |
|---|---|
| Stores block hashes on Sapphire via `ROFLAdapter.storeBlockHeader()` | Requests attestation of Sepolia tx via FDC protocol |
| Uses Hashi's `proveAncestralBlockHashes()` for parent chain proof | Uses FDC's Merkle proof verification against attestation root |
| ROFL TEE provides trust for the oracle | FDC attestation providers provide trust |
| Source chain: any EVM, Target: Sapphire | Source chain: Sepolia, Target: Coston2 |
| Continuous block header relay | On-demand tx verification |

Both solve cross-chain data availability, but through different trust models: ROFL uses TEE attestation for the oracle operator, while FDC uses a decentralized network of attestation providers with voting.
