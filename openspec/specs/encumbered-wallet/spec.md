## Purpose

Encumbered wallet functionality for the FdcAccounting contract — generates a Sapphire-native keypair at deploy time, exposes the deposit address, and signs withdrawal transactions.

## Requirements

### Requirement: Keypair generation at deploy time

The `FdcAccounting` contract SHALL generate a secp256k1 keypair in the constructor using `EthereumUtils.generateKeypair()`. The private key SHALL be stored in Sapphire confidential storage. The derived Ethereum address SHALL serve as the deposit address.

#### Scenario: Contract deployment generates keypair

- **WHEN** the `FdcAccounting` contract is deployed on Sapphire
- **THEN** a secp256k1 keypair is generated, the secret key is stored in private state, and the derived address is stored as `encumberedAddress`

### Requirement: Deposit address exposure

The contract SHALL expose the encumbered wallet's Ethereum address via `getDepositAddress()` so users and the relayer know where to send deposits on the source chain.

#### Scenario: Query deposit address

- **WHEN** any address calls `getDepositAddress()`
- **THEN** the contract returns the Ethereum address derived from the generated keypair

### Requirement: Withdrawal transaction signing

The contract SHALL sign raw EVM transactions from the encumbered wallet using `EIP155Signer.sign()`. The `signWithdrawal` function SHALL debit the user's balance and return signed transaction bytes that the relayer broadcasts to the destination chain.

#### Scenario: Successful withdrawal

- **WHEN** the authorized relayer calls `signWithdrawal(user, amount, gasPrice, nonce, chainId)` with a valid user who has sufficient balance
- **THEN** the contract debits `amount` from the user's balance, signs a raw ETH transfer tx from the encumbered wallet to `user`, and returns the RLP-encoded signed transaction bytes
- **AND** emits `WithdrawalSigned(user, amount, nonce)`

#### Scenario: Withdrawal with insufficient balance

- **WHEN** the relayer calls `signWithdrawal` with `amount` exceeding the user's balance
- **THEN** the transaction MUST revert with `InsufficientBalance(requested, available)`

#### Scenario: Zero-value withdrawal

- **WHEN** the relayer calls `signWithdrawal` with `amount = 0`
- **THEN** the transaction MUST revert with `ZeroValue()`

#### Scenario: Non-relayer attempts withdrawal

- **WHEN** any address other than the authorized relayer calls `signWithdrawal`
- **THEN** the transaction MUST revert with `Unauthorized()`
