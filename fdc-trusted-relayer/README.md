# FDC Trusted Relayer — Sapphire Accounting

Cross-chain deposit accounting on Oasis Sapphire using Flare Data Connector (FDC) attestations. Verifies Ethereum Sepolia transactions via FDC Merkle proofs, then credits deposits to a confidential Sapphire smart contract.

## How it works

1. **Deploy contract** — Deploys `FdcAccounting` on Sapphire, which generates an encumbered wallet keypair (secp256k1) in confidential storage
2. **Get deposit address** — Queries the encumbered wallet's Ethereum address from the contract — this is where users send deposits on Sepolia
3. **Sepolia deposit** — Sends ETH to the deposit address on Sepolia
4. **FDC attestation** — Submits an attestation request to FdcHub on Coston2 and waits for the voting round to finalize
5. **On-chain verification** — Verifies the Merkle proof against Flare's consensus root via `FdcVerification`
6. **Sapphire relay** — Calls `creditDeposit()` with `receivingAddress` validation to ensure the deposit went to the correct address
7. **Withdrawal** — Signs a raw ETH transfer from the encumbered wallet using `EIP155Signer` on Sapphire, then broadcasts it to Sepolia

## Prerequisites

- Node.js and npm
- A private key funded on three testnets (or separate keys per chain):
  - **Sepolia** — for the deposit tx ([faucet](https://sepoliafaucet.com/))
  - **Coston2** — for FDC attestation fees ([faucet](https://faucet.flare.network/coston2))
  - **Sapphire testnet** — for contract deployment + relay tx ([faucet](https://faucet.oasis.io/))

## Setup

```bash
# Install root dependencies (from repo root)
npm install

# Install Hardhat dependencies
cd fdc-trusted-relayer/contracts && npm install && cd ../..

# Compile the Solidity contract
cd fdc-trusted-relayer/contracts && npx hardhat compile && cd ../..
```

Add to `.env` (in repo root):

```
COSTON2_PK=0x...
# Optional: defaults to COSTON2_PK if not set
# SEPOLIA_PK=0x...
# SAPPHIRE_PK=0x...
```

## Run

```bash
npm run accounting-demo
```

The demo is fully self-contained — it sends its own Sepolia tx, attests it, and relays the deposit. Takes ~2-3 minutes (mostly waiting for the FDC voting round).

## Contract

`contracts/src/FdcAccounting.sol` — deployed on Sapphire with:

- Constructor generates an encumbered wallet keypair via `EthereumUtils.generateKeypair()`
- `getDepositAddress()` — returns the encumbered wallet's Ethereum address (deposit target on Sepolia)
- `creditDeposit(txHash, depositor, receivingAddress, value)` — relayer-only, validates `receivingAddress` matches the encumbered wallet
- `signWithdrawal(user, amount, gasPrice, nonce, chainId)` — relayer-only, debits balance and returns EIP-155 signed tx bytes
- `getBalance()` / `getBalanceOf(user)` — balance queries (private storage)

## Configuration

| Variable | Required | Default | Description |
|---|---|---|---|
| `COSTON2_PK` | Yes | — | Private key for Coston2 (FDC attestation) |
| `SEPOLIA_PK` | No | `COSTON2_PK` | Private key for Sepolia (deposit tx) |
| `SAPPHIRE_PK` | No | `COSTON2_PK` | Private key for Sapphire (deploy + relay) |
| `SEPOLIA_RPC` | No | `https://ethereum-sepolia-rpc.publicnode.com` | Sepolia RPC endpoint |
| `SAPPHIRE_RPC` | No | `https://testnet.sapphire.oasis.io` | Sapphire RPC endpoint |
| `DEPOSIT_AMOUNT` | No | `0.0001` | ETH amount for the Sepolia deposit |
| `ACCOUNTING_CONTRACT_ADDRESS` | No | — | Reuse an existing contract (skips deploy) |
