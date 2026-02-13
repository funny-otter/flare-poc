# FDC Trustless Merkle Verification

Verify FDC Merkle proofs entirely on-chain on [Oasis Sapphire](https://oasisprotocol.org/sapphire), with private deposit balances stored in confidential storage. Withdrawals are signed inside the TEE using an encumbered wallet.

## How it works

Three chains are involved:

- **Sepolia** — source chain where users send ETH deposits
- **Coston2** — Flare testnet where FDC data providers vote on Merkle roots per voting round
- **Sapphire** — Oasis confidential EVM where the accounting contract verifies proofs, credits balances, and signs withdrawal transactions

The flow:

1. **Deploy** — contract generates an encumbered wallet keypair inside the TEE (`EthereumUtils.generateKeypair()`)
2. **Deposit** — user sends ETH to the encumbered wallet address on Sepolia
3. **Attest** — backend requests an EVMTransaction attestation from FDC on Coston2
4. **Wait** — poll the DA layer until the voting round finalizes (~2 min)
5. **Sync root** — backend reads the confirmed Merkle root from Coston2's Relay contract and writes it to the Sapphire contract (write-once per round)
6. **Verify & credit** — backend submits the Merkle proof to the Sapphire contract, which reconstructs the leaf hash, walks the proof, and credits the depositor's private balance
7. **Withdraw** — user calls `withdraw()` on Sapphire; the contract deducts the balance and signs an EIP-155 transaction from the encumbered wallet
8. **Broadcast** — backend broadcasts the signed withdrawal tx on Sepolia, returning ETH to the user

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

The deposit address is **auto-generated** by the contract at deploy time — no need to configure it.

## Run

The relay script handles everything — deploy, deposit, attest, sync, verify, withdraw, broadcast:

```bash
npm run relay
```

This takes ~3 minutes (mostly waiting for the FDC voting round to finalize).

On subsequent runs, the deployed contract address is reused from `.env`.

## Scripts

| Script | Description |
|---|---|
| `npm run relay` | Full end-to-end flow (deploy + deposit + attest + verify + withdraw) |
| `npm run deploy` | Deploy contract only |
| `npm run compile` | Compile Solidity with Hardhat |
| `npm run typecheck` | TypeScript type-check |

## Contract

`contracts/FdcAccountingTrustless.sol` (~220 lines):

- **`syncRoot(votingRound, merkleRoot)`** — authorized write-once root storage
- **`verifyAndCredit(proof, response)`** — Merkle proof verification + deposit crediting
- **`getBalance()`** — private balance query (msg.sender only)
- **`getDepositAddress()`** — returns the encumbered wallet address (deposit target on Sepolia)
- **`withdraw(to, amount, gasPrice, gasLimit)`** — deducts balance, signs an EIP-155 tx from the encumbered wallet, emits `WithdrawalSigned` event

Leaf hash: `keccak256(abi.encode(response))` — matches FdcVerification exactly.
Merkle proof: sorted-pair hashing (OpenZeppelin convention).

### Encumbered wallet

At deploy time, the contract calls `EthereumUtils.generateKeypair()` inside Sapphire's TEE to create an Ethereum-compatible keypair. The resulting address becomes the deposit target on Sepolia. The private key is stored in Sapphire's confidential storage — only the contract can sign transactions from it.

When a user withdraws, the contract builds an EIP-155 transaction, signs it with `EIP155Signer.sign()`, and emits the signed tx bytes in a `WithdrawalSigned` event. The backend parses this event and broadcasts the raw tx on Sepolia.

## Architecture

```
Sepolia                  Coston2                    Sapphire
───────                  ───────                    ────────
ETH deposit    ──→    FDC attestation    ──→    Merkle proof verification
(to encumbered         Relay (roots)      ──→    syncRoot (write-once)
 wallet)                                         verifyAndCredit
                                                   ├─ reconstruct leaf
                                                   ├─ walk proof (sorted pairs)
                                                   ├─ check root matches
                                                   ├─ validate deposit fields
                                                   └─ credit private balance

ETH withdrawal  ←──────────────────────────── withdraw()
(broadcast                                      ├─ deduct balance
 signed tx)                                     ├─ build EIP-155 tx
                                                ├─ sign with encumbered key
                                                └─ emit WithdrawalSigned
```

## Dependencies

| Package | Purpose |
|---|---|
| `ethers` v6 | Ethereum interactions |
| `@oasisprotocol/sapphire-contracts` | `EthereumUtils`, `EIP155Signer` (Solidity) |
| `@oasisprotocol/sapphire-ethers-v6` | Wrap ethers signer for Sapphire confidential calls |
| `@flarenetwork/flare-tx-sdk` | FDC attestation utilities |
| `dotenv` | Environment variable loading |

## Known limitations

- **Balance reads require Sapphire SDK** — `getBalance()` uses confidential storage. The signer must be wrapped with `wrapEthersSigner` from `@oasisprotocol/sapphire-ethers-v6` for view calls to authenticate `msg.sender` properly.
- **Single relayer** — root sync is authorized to one address (set at deploy). Production would use a decentralized bridge or ROFL TEE relayer.
- **ETH only** — no ERC-20 support.
- **Withdrawal gas** — the user's withdrawal amount must exceed the Sepolia gas cost (gasPrice * 21000). The script deducts gas cost automatically.

## Contract addresses

| Contract | Network | Address |
|---|---|---|
| FdcHub | Coston2 | `0x48aC463d7975828989331F4De43341627b9c5f1D` |
| Relay | Coston2 | Resolved via FlareContractRegistry |
| FlareContractRegistry | Coston2 | `0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019` |
| FDC Protocol ID | — | `200` |
