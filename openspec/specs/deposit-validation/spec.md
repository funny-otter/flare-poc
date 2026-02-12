## Purpose

Receiving address validation for deposits credited to the FdcAccounting contract — ensures only deposits sent to the encumbered wallet address are credited.

## Requirements

### Requirement: Receiving address validation

The `creditDeposit` function SHALL validate that the deposit's receiving address matches the contract's encumbered wallet address. This ensures only deposits actually sent to the deposit address are credited.

#### Scenario: Deposit to correct address

- **WHEN** the relayer calls `creditDeposit` with `receivingAddress` matching the encumbered wallet address
- **THEN** the deposit is credited normally

#### Scenario: Deposit to wrong address

- **WHEN** the relayer calls `creditDeposit` with `receivingAddress` that does NOT match the encumbered wallet address
- **THEN** the transaction MUST revert with `InvalidReceivingAddress(expected, actual)`
