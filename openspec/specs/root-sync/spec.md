## ADDED Requirements

### Requirement: Authorized root sync
The contract SHALL accept FDC Merkle roots from the designated `rootRelayer` address only. The root relayer address SHALL be set at construction time.

#### Scenario: Relayer syncs a new root
- **WHEN** the `rootRelayer` calls `syncRoot(votingRound, merkleRoot)` for a voting round with no existing root
- **THEN** the root MUST be stored and a `RootSynced(votingRound, merkleRoot)` event MUST be emitted

#### Scenario: Unauthorized caller is rejected
- **WHEN** any address other than `rootRelayer` calls `syncRoot`
- **THEN** the transaction MUST revert with "Unauthorized"

### Requirement: Write-once root immutability
Once a Merkle root is stored for a voting round, it SHALL NOT be overwritten. This prevents a compromised relayer from replacing a legitimate root.

#### Scenario: Overwrite attempt is rejected
- **WHEN** `syncRoot` is called for a voting round that already has a stored root
- **THEN** the transaction MUST revert with "Root already set"

### Requirement: Root read from Coston2 Relay
The TypeScript backend SHALL read confirmed Merkle roots from the Coston2 Relay contract for the appropriate voting round before calling `syncRoot` on Sapphire.

#### Scenario: Backend syncs root for a new voting round
- **WHEN** the backend detects a proof for a voting round whose root is not yet on Sapphire
- **THEN** it MUST read the root from Coston2's Relay contract and call `syncRoot` on the Sapphire contract before submitting the proof
