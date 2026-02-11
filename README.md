# FDC EVMTransaction Attestation PoC

Verify an Ethereum Sepolia transaction on-chain using the [Flare Data Connector (FDC)](https://dev.flare.network/fdc/overview) on Coston2 testnet.

## How it works

The FDC allows smart contracts on Flare to trustlessly access data from other chains. This PoC demonstrates the full attestation lifecycle for an `EVMTransaction` attestation type:

1. **Prepare** — encode an attestation request via the FDC verifier API
2. **Submit** — send the request to the `FdcHub` contract on Coston2 (pays a small C2FLR fee)
3. **Wait** — poll the Data Availability layer until the voting round finalizes (~2–4 min)
4. **Verify** — call `FdcVerification.verifyEVMTransaction()` on-chain, which checks Merkle inclusion against the consensus root signed by Flare's data providers
5. **Validate** — confirm the returned transaction details match expectations

If verification passes, the Sepolia transaction details (sender, receiver, value, status, events) are cryptographically proven correct via Flare's decentralized consensus.

## Prerequisites

- Node.js 18+
- A Coston2 wallet funded with testnet C2FLR — get some from the [Coston2 faucet](https://faucet.flare.network/coston2)
- A valid Ethereum Sepolia transaction hash to verify

## Setup

```bash
npm install
cp .env.example .env
```

Edit `.env` with your values:

```
COSTON2_PK=0x...         # Coston2 EOA private key (funded with C2FLR)
SEPOLIA_TX_HASH=0x...    # Sepolia tx hash to verify (64 hex chars)
```

Optional variables:

| Variable | Default | Description |
|---|---|---|
| `REQUIRED_CONFIRMATIONS` | `1` | Block confirmations required |
| `EXPECT_STATUS` | `1` | Expected tx status (`1` = success, `0` = reverted) |

## Run

```bash
npm start
```

The script takes ~2–4 minutes to complete due to the voting round finalization wait.

## Contract addresses (Coston2)

| Contract | Address |
|---|---|
| FdcHub | `0x48aC463d7975828989331F4De43341627b9c5f1D` |
| FdcFeeConfig | `0x191a1282Ac700edE65c5B0AaF313BAcC3eA7fC7e` |
| FdcVerification | `0x075bf301fF07C4920e5261f93a0609640F53487D` |

## Resources

- [FDC documentation](https://dev.flare.network/fdc/overview)
- [Flare TX SDK](https://www.npmjs.com/package/@flarenetwork/flare-tx-sdk)
- [Coston2 faucet](https://faucet.flare.network/coston2)
- [Coston2 explorer](https://coston2-explorer.flare.network)
