## ADDED Requirements

### Requirement: Verify and credit deposits
The contract SHALL credit a depositor's private balance only after successfully verifying the FDC Merkle proof and validating deposit semantics.

#### Scenario: Valid deposit proof is credited
- **WHEN** `verifyAndCredit` is called with a valid Merkle proof for a successful ETH transfer to the deposit address
- **THEN** the sender's balance MUST increase by the transfer value and a `DepositCredited(sourceAddress, value, txHash)` event MUST be emitted

#### Scenario: Failed transaction is rejected
- **WHEN** the attestation shows `status != 1` (transaction failed on source chain)
- **THEN** the transaction MUST revert with "Tx not successful"

#### Scenario: Wrong receiver is rejected
- **WHEN** the attestation's `receivingAddress` does not match the contract's `depositAddress`
- **THEN** the transaction MUST revert with "Wrong receiver"

#### Scenario: Zero value is rejected
- **WHEN** the attestation's `value` is 0
- **THEN** the transaction MUST revert with "Zero value"

### Requirement: Replay protection via txHash deduplication
The contract SHALL track processed transaction hashes and reject any proof for an already-processed hash.

#### Scenario: Duplicate proof is rejected
- **WHEN** `verifyAndCredit` is called with a txHash that has already been processed
- **THEN** the transaction MUST revert with "Already processed"

#### Scenario: Different txHash for same depositor is accepted
- **WHEN** a depositor submits two proofs with different txHashes, both valid
- **THEN** both MUST be credited and the balance MUST reflect both deposits

### Requirement: Private balance queries
Balances SHALL be stored in Sapphire's confidential storage. Only the depositor SHALL be able to query their own balance.

#### Scenario: Depositor queries own balance
- **WHEN** a depositor calls `getBalance()`
- **THEN** the contract MUST return their current balance (using `msg.sender`)

### Requirement: Immutable deposit address
The deposit address (the Sepolia address that receives deposits) SHALL be set at construction time and MUST NOT be changeable.

#### Scenario: Deposit address is set at deployment
- **WHEN** the contract is deployed with `_depositAddress`
- **THEN** the `depositAddress` MUST be stored as immutable and readable via the public getter
