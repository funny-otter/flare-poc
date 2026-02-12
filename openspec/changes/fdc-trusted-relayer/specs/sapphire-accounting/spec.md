## ADDED Requirements

### Requirement: Authorized relayer credit

The `FdcAccounting` contract SHALL accept deposit credits only from the authorized relayer address set at construction time. Any call to `creditDeposit` from a non-relayer address MUST revert with `Unauthorized()`.

#### Scenario: Relayer credits a deposit

- **WHEN** the authorized relayer calls `creditDeposit(txHash, depositor, value)` with a valid tx hash, depositor address, and non-zero value
- **THEN** the contract records the deposit, increments the depositor's balance by `value`, and emits `DepositCredited(depositor, value, txHash)`

#### Scenario: Non-relayer attempts credit

- **WHEN** any address other than the authorized relayer calls `creditDeposit`
- **THEN** the transaction MUST revert with `Unauthorized()`

### Requirement: Double-credit prevention

The contract SHALL track processed Sepolia transaction hashes and reject any attempt to credit the same tx hash twice.

#### Scenario: First credit for a tx hash

- **WHEN** the relayer calls `creditDeposit` with a tx hash that has not been processed before
- **THEN** the deposit is credited and the tx hash is marked as processed

#### Scenario: Duplicate credit attempt

- **WHEN** the relayer calls `creditDeposit` with a tx hash that has already been processed
- **THEN** the transaction MUST revert with `AlreadyProcessed(txHash)`

### Requirement: Zero-value rejection

The contract SHALL reject deposits with zero value to prevent meaningless state changes.

#### Scenario: Zero-value deposit

- **WHEN** the relayer calls `creditDeposit` with `value = 0`
- **THEN** the transaction MUST revert with `ZeroValue()`

### Requirement: Private balance storage

Depositor balances SHALL be stored in Sapphire confidential storage (private mapping). Balances MUST NOT be readable by arbitrary external observers.

#### Scenario: Depositor queries own balance

- **WHEN** a depositor calls `getBalance()` from their own address
- **THEN** the contract returns that depositor's current balance

#### Scenario: Relayer queries any balance

- **WHEN** the authorized relayer calls `getBalanceOf(user)`
- **THEN** the contract returns the specified user's balance

#### Scenario: Unauthorized balance query

- **WHEN** a non-relayer address calls `getBalanceOf(user)` for another user
- **THEN** the transaction MUST revert with `Unauthorized()`
