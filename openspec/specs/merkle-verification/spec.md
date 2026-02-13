## ADDED Requirements

### Requirement: Leaf reconstruction from attestation response
The contract SHALL reconstruct the Merkle leaf by hashing the full FDC attestation response data using `keccak256(abi.encode(...))`, matching the exact encoding used by Flare's `FdcVerification` contract.

#### Scenario: Leaf matches FDC encoding
- **WHEN** the contract receives attestation response fields (attestationType, sourceId, votingRound, lowestUsedTimestamp, requestBody, responseBody)
- **THEN** the computed leaf hash MUST equal the leaf hash that FDC's `FdcVerification` contract would produce for the same data

#### Scenario: Incorrect field produces different leaf
- **WHEN** any attestation response field is altered (e.g. wrong txHash or wrong value)
- **THEN** the computed leaf hash MUST differ from the original, causing proof verification to fail

### Requirement: Binary Merkle proof verification
The contract SHALL verify a Merkle proof by walking from the leaf to the root using sorted-pair `keccak256` hashing (OpenZeppelin convention). The computed root MUST match the stored root for the given voting round.

#### Scenario: Valid proof verifies successfully
- **WHEN** a valid Merkle proof is submitted with correct leaf data and the root for that voting round is stored
- **THEN** the proof verification MUST return true

#### Scenario: Invalid proof is rejected
- **WHEN** a Merkle proof is submitted with tampered proof nodes
- **THEN** the computed root MUST NOT match the stored root and the transaction MUST revert with "Invalid Merkle proof"

#### Scenario: Proof against missing root is rejected
- **WHEN** a proof is submitted for a voting round with no stored root
- **THEN** the transaction MUST revert with "Root not synced for this round"
