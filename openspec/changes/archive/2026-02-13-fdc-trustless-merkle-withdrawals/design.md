## Context

The fdc-trustless-merkle PoC verifies FDC Merkle proofs on Sapphire and credits private deposit balances. This change adds the withdrawal path using Sapphire's encumbered wallet pattern — the contract holds an Ethereum keypair in confidential storage and can sign transactions on behalf of the deposit wallet.

## Goals / Non-Goals

**Goals:**
- Complete the deposit→credit→withdrawal round trip
- Use the Sapphire encumbered wallet pattern (TEE-generated keypair, EIP-155 signing)
- Eliminate the manual `DEPOSIT_ADDRESS` configuration
- Demonstrate full flow in the relay script with balance tracking

**Non-Goals:**
- Multi-user withdrawal queuing or batching
- ERC-20 withdrawal support
- Gas price oracle or dynamic gas estimation beyond `getFeeData()`
- Withdrawal to arbitrary chains (Sepolia only, configured via `withdrawalChainId`)

## Decisions

### 1. Encumbered wallet replaces manual deposit address

**Decision**: The contract generates its own Ethereum keypair at deploy time using `EthereumUtils.generateKeypair()`. The public address becomes `encumberedWalletAddr` (the deposit target on Sepolia), and the private key is stored in `encumberedWalletKey` (Sapphire confidential storage).

**Rationale**: This is the standard Sapphire pattern for holding assets on other chains. The private key never leaves the TEE. It also simplifies setup — no need to manually configure a deposit address.

**Alternatives considered**:
- Keep manual deposit address + separate withdrawal signer — more complex, same trust model
- Off-chain hot wallet for withdrawals — weaker trust guarantees

### 2. Withdrawal signs EIP-155 tx on-chain

**Decision**: `withdraw()` builds an `EIP155Signer.EthTx` struct with the user-specified recipient, amount, gas price, and gas limit, then signs it with the encumbered wallet key. The signed tx bytes are emitted in a `WithdrawalSigned` event and returned from the function.

**Rationale**: The signed tx is a self-contained Sepolia transaction that anyone can broadcast. The contract is the sole signer for the encumbered wallet, so it manages the nonce internally (`encumberedWalletNonce`).

**Alternatives considered**:
- Return signed tx only via return value (no event) — harder for off-chain indexing
- Queue withdrawals for batch processing — overkill for PoC

### 3. Gas cost deducted from withdrawal amount

**Decision**: The relay script queries Sepolia's current gas price, calculates `gasCost = gasPrice * 21000`, and deducts it from the credited balance before calling `withdraw()`. The contract receives the net amount.

**Rationale**: The encumbered wallet on Sepolia holds exactly the deposited ETH. The withdrawal tx needs gas, which must come from that same ETH. Deducting gas in the script keeps the contract simple.

### 4. Sapphire signer wrapped with sapphire-ethers-v6

**Decision**: Both deploy and relay scripts wrap the ethers Wallet with `wrapEthersSigner()` before interacting with the Sapphire contract.

**Rationale**: Sapphire's confidential storage requires authenticated view calls. Without the wrapper, `getBalance()` and `encumberedWalletAddr()` calls fail or return incorrect values because `msg.sender` isn't authenticated in plain `eth_call`.

## Risks / Trade-offs

- **Constructor breaking change** — existing deployments are incompatible. The constructor now takes `(address, uint256)` instead of `(address, address)`. Requires fresh deploy.
- **Nonce desync** — if a withdrawal tx is signed but never broadcast (or fails on Sepolia), the on-chain nonce increments but the Sepolia nonce doesn't, blocking future withdrawals. Mitigation: acceptable for PoC; production would need nonce recovery.
- **Gas estimation** — the script uses a simple `getFeeData().gasPrice * 21000` estimate. If Sepolia gas prices spike between estimation and broadcast, the tx could get stuck. Mitigation: the user can retry with a higher gas price.
