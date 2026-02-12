## Context

The existing `FdcAccounting.sol` is a simple balance ledger — the relayer calls `creditDeposit(txHash, depositor, value)` and balances go up. But there's no actual deposit address and no way to withdraw. The demo sends ETH to self on Sepolia, which doesn't prove anything about cross-chain accounting.

FlexVaults solves this with encumbered wallets: a Sapphire contract generates a secp256k1 keypair at deploy time, stores the private key in confidential storage, and derives an Ethereum address that serves as the deposit target. For withdrawals, the contract signs raw EVM transactions using `EIP155Signer` that the backend broadcasts to the destination chain.

We adapt this pattern for the FDC PoC with dramatically less complexity (no EIP-712, no pending queue, no multi-chain nonce tracking).

## Goals / Non-Goals

**Goals:**
- Generate an encumbered wallet keypair on Sapphire at deploy time
- Expose the deposit address so users know where to send ETH on Sepolia
- Validate that deposits were actually sent to the deposit address (receivingAddress check in `creditDeposit`)
- Sign withdrawal transactions on Sapphire and broadcast them to Sepolia
- Demonstrate the full deposit → attest → credit → withdraw lifecycle end-to-end

**Non-Goals:**
- EIP-712 signed withdrawal requests (direct relayer call is fine for PoC)
- Pending withdrawal queue or two-phase withdrawal
- On-chain nonce tracking (relayer passes nonce from Sepolia)
- Multi-chain support (Sepolia only)
- Partial withdrawal (demo withdraws full balance minus gas)

## Decisions

### 1. Keypair generation via `EthereumUtils.generateKeypair()`

**Decision**: Use Sapphire's `EthereumUtils.generateKeypair()` to generate the encumbered wallet in the constructor.

**Rationale**: This is the standard Sapphire pattern (used by FlexVaults). Returns `(address, bytes32)` — the derived address and secret key. The secret key never leaves confidential storage.

**Alternative considered**: Import or derive a key from an external source. Rejected — the whole point is that the key is born and dies inside Sapphire.

### 2. Relayer-passed nonce for withdrawal signing

**Decision**: The relayer queries `eth_getTransactionCount` on Sepolia and passes the nonce to `signWithdrawal()`.

**Rationale**: Simpler than on-chain per-chain nonce tracking (which FlexVaults does). For a single-relayer PoC with one withdrawal per run, this is sufficient.

**Alternative considered**: Track nonce on-chain per chain ID (FlexVaults pattern). Overkill for a PoC that does one withdrawal per run.

### 3. `staticCall` + real call pattern for getting signed tx bytes

**Decision**: Call `signWithdrawal.staticCall()` first to get the return value, then call the real `signWithdrawal()` to mutate state (debit balance).

**Rationale**: Solidity `returns (bytes memory)` on a state-mutating function — ethers.js returns a tx receipt, not the return value. The `staticCall` simulates the call and gives us the bytes. Then the real call debits the balance. Two calls, but simple and correct for a PoC.

**Alternative considered**: Emit signed tx bytes in an event and parse logs. More complex, same result.

### 4. Withdrawal amount = deposit - gas cost

**Decision**: The demo calculates `withdrawalAmount = depositAmount - (gasPrice * 21000)` and withdraws that. The gas comes from the encumbered wallet's Sepolia balance (which holds the deposited ETH).

**Rationale**: The encumbered wallet IS the deposit address on Sepolia, so it holds the deposited ETH. A simple ETH transfer costs exactly 21000 gas.

### 5. `creditDeposit` validates `receivingAddress`

**Decision**: Add a `receivingAddress` parameter to `creditDeposit` and validate it matches the encumbered wallet address.

**Rationale**: Without this check, the relayer could credit any Sepolia tx as a "deposit" even if the ETH went elsewhere. The FDC attestation response body already provides `receivingAddress`, so the data is available.

## Risks / Trade-offs

- **[`signWithdrawal` requires two calls]** → Acceptable for PoC. The `staticCall` + real call pattern is a well-known ethers.js pattern for getting return values from mutating functions.

- **[Nonce race condition]** → If the relayer crashes between debiting the balance and broadcasting, the nonce is consumed but the tx is lost. Acceptable for PoC — single run, single withdrawal.

- **[Gas estimation is approximate]** → `gasPrice * 21000` may differ from actual Sepolia base fee at execution time. For a PoC with small amounts, this is fine. Could fail if gas spikes between estimation and broadcast.

- **[Sapphire precompiles don't work on local Hardhat]** → `EthereumUtils.generateKeypair()` is a Sapphire-specific precompile. Contract will compile but can't be tested locally. Only works on Sapphire testnet/mainnet. Acceptable for a PoC.
