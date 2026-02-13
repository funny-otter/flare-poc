# Withdrawal Flow

Balance deduction and EIP-155 transaction signing on Sapphire, with broadcast on Sepolia.

## Contract Function

```solidity
function withdraw(
    address to,
    uint256 amount,
    uint256 gasPrice,
    uint64 gasLimit
) external returns (bytes memory)
```

### Behavior

1. Validates `amount > 0`, `balances[msg.sender] >= amount`, `to != address(0)`
2. Deducts `amount` from `balances[msg.sender]`
3. Builds `EIP155Signer.EthTx` struct with `encumberedWalletNonce`, `withdrawalChainId`, and caller-provided gas parameters
4. Signs with `EIP155Signer.sign(encumberedWalletAddr, encumberedWalletKey, ethTx)`
5. Increments `encumberedWalletNonce`
6. Emits `WithdrawalSigned(msg.sender, to, amount, signedTx)`
7. Returns `signedTx` bytes

### Event

```solidity
event WithdrawalSigned(address indexed user, address indexed to, uint256 amount, bytes signedTx);
```

## Script Flow

### Step 6: Request Withdrawal

1. Query Sepolia gas price via `provider.getFeeData()`
2. Calculate `gasCost = gasPrice * 21000`
3. Compute `withdrawalAmount = creditedBalance - gasCost`
4. Call `contract.withdraw(userAddress, withdrawalAmount, gasPrice, 21000)`
5. Parse `WithdrawalSigned` event from receipt to extract `signedTx` bytes

### Step 7: Broadcast Withdrawal

1. Call `sepoliaProvider.broadcastTransaction(signedTx)`
2. Wait for confirmation (1 block)

### Step 8: Display Results

Show Sapphire balance (before / credited / after withdrawal) and Sepolia balance (before / after / recovered).

## Gas Model

The withdrawal tx is a simple ETH transfer (21000 gas). Gas comes from the deposited ETH sitting in the encumbered wallet on Sepolia. The script deducts the estimated gas cost from the withdrawal amount so the encumbered wallet has enough ETH to pay for the tx.

## Constraints

- Withdrawal amount must exceed gas cost
- Nonce is managed by the contract — if a signed tx is never broadcast, the nonce desyncs (PoC limitation)
- Only the contract can sign from the encumbered wallet (sole signer)
