# FDC Trustless Merkle Verification

Verify FDC Merkle proofs entirely on-chain on [Oasis Sapphire](https://oasisprotocol.org/sapphire), with private deposit balances stored in confidential storage.

## How it works

Three chains are involved:

- **Sepolia** — source chain where users send ETH deposits
- **Coston2** — Flare testnet where FDC data providers vote on Merkle roots per voting round
- **Sapphire** — Oasis confidential EVM where the accounting contract verifies proofs and credits balances

The flow:

1. **Deposit** — user sends ETH to a deposit address on Sepolia
2. **Attest** — backend requests an EVMTransaction attestation from FDC on Coston2
3. **Wait** — poll the DA layer until the voting round finalizes (~2 min)
4. **Sync root** — backend reads the confirmed Merkle root from Coston2's Relay contract and writes it to the Sapphire contract (write-once per round)
5. **Verify & credit** — backend submits the Merkle proof to the Sapphire contract, which reconstructs the leaf hash, walks the proof, and credits the depositor's private balance

The backend relays roots but **cannot forge deposits** — proof verification happens entirely on-chain using the same sorted-pair Merkle algorithm as Flare's `FdcVerification` contract.

## Prerequisites

- Node.js 18+
- A wallet funded on Coston2 (C2FLR), Sapphire testnet (ROSE), and Sepolia (ETH)
  - [Coston2 faucet](https://faucet.flare.network/coston2)
  - [Sapphire faucet](https://faucet.testnet.oasis.io/)
  - [Sepolia faucet](https://sepoliafaucet.com/)

## Setup

```bash
cd fdc-trustless-merkle
npm install
npm run compile
cp .env.example .env
```

Edit `.env` with your private keys. The same key can be used for all three chains.

## Run

The relay script handles everything — deploy, deposit, attest, sync, verify:

```bash
npm run relay
```

This takes ~3 minutes (mostly waiting for the FDC voting round to finalize).

On subsequent runs, the deployed contract address is reused from `.env`.

## Scripts

| Script | Description |
|---|---|
| `npm run relay` | Full end-to-end flow (deploy + deposit + attest + verify) |
| `npm run deploy` | Deploy contract only |
| `npm run compile` | Compile Solidity with Hardhat |
| `npm run typecheck` | TypeScript type-check |

## Contract

`contracts/FdcAccountingTrustless.sol` (~150 lines):

- **`syncRoot(votingRound, merkleRoot)`** — authorized write-once root storage
- **`verifyAndCredit(proof, response)`** — Merkle proof verification + deposit crediting
- **`getBalance()`** — private balance query (msg.sender only)

Leaf hash: `keccak256(abi.encode(response))` — matches FdcVerification exactly.
Merkle proof: sorted-pair hashing (OpenZeppelin convention).

## Architecture

```
Sepolia                  Coston2                    Sapphire
───────                  ───────                    ────────
ETH deposit    ──→    FDC attestation    ──→    Merkle proof verification
                      Relay (roots)      ──→    syncRoot (write-once)
                                                verifyAndCredit
                                                  ├─ reconstruct leaf
                                                  ├─ walk proof (sorted pairs)
                                                  ├─ check root matches
                                                  ├─ validate deposit fields
                                                  └─ credit private balance
```

## Known limitations

- **Balance reads require Sapphire SDK** — `getBalance()` uses confidential storage. Without `@oasisprotocol/sapphire-paratime` wrapping the provider, view calls can't authenticate `msg.sender` properly. The on-chain verification works correctly regardless.
- **Single relayer** — root sync is authorized to one address (set at deploy). Production would use a decentralized bridge or ROFL TEE relayer.
- **No withdrawals** — deposit crediting only (PoC scope).
- **ETH only** — no ERC-20 support.

## Contract addresses

| Contract | Network | Address |
|---|---|---|
| FdcHub | Coston2 | `0x48aC463d7975828989331F4De43341627b9c5f1D` |
| Relay | Coston2 | Resolved via FlareContractRegistry |
| FlareContractRegistry | Coston2 | `0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019` |
| FDC Protocol ID | — | `200` |
