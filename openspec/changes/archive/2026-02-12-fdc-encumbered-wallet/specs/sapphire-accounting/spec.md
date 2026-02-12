## MODIFIED Requirements

### Requirement: Authorized relayer credit

The `FdcAccounting` contract SHALL accept deposit credits only from the authorized relayer address set at construction time. Any call to `creditDeposit` from a non-relayer address MUST revert with `Unauthorized()`. **BREAKING**: `creditDeposit` now requires a 4th parameter `receivingAddress` for deposit validation.

#### Scenario: Relayer credits a deposit

- **WHEN** the authorized relayer calls `creditDeposit(txHash, depositor, receivingAddress, value)` with a valid tx hash, depositor address, valid receiving address, and non-zero value
- **THEN** the contract records the deposit, increments the depositor's balance by `value`, and emits `DepositCredited(depositor, value, txHash)`

#### Scenario: Non-relayer attempts credit

- **WHEN** any address other than the authorized relayer calls `creditDeposit`
- **THEN** the transaction MUST revert with `Unauthorized()`
