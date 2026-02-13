## ADDED Requirements

### Requirement: FDC attestation request
The backend SHALL request an EVMTransaction attestation from the FDC protocol for a given Sepolia transaction hash, using the same flow as the existing PoC (`src/poc.ts`).

#### Scenario: Attestation requested successfully
- **WHEN** the backend is given a Sepolia transaction hash
- **THEN** it MUST submit an attestation request to the FDC protocol and poll until the proof is available (~2-3 minutes)

### Requirement: Root sync before proof submission
The backend SHALL check whether the Sapphire contract already has the Merkle root for the proof's voting round. If not, it MUST sync the root before submitting the proof.

#### Scenario: Root not yet synced
- **WHEN** the proof's voting round has no root on Sapphire
- **THEN** the backend MUST read the confirmed root from Coston2's Relay contract and call `syncRoot` on Sapphire before proceeding

#### Scenario: Root already synced
- **WHEN** the proof's voting round already has a root on Sapphire
- **THEN** the backend MUST skip the sync step and proceed to proof submission

### Requirement: Proof submission to Sapphire
The backend SHALL call `verifyAndCredit` on the Sapphire contract with the Merkle proof and all attestation response fields. The contract verifies the proof on-chain.

#### Scenario: Proof submitted and verified
- **WHEN** the backend calls `verifyAndCredit` with a valid proof
- **THEN** the transaction MUST succeed and the deposit MUST be credited on-chain

#### Scenario: Proof verification fails on-chain
- **WHEN** the contract reverts (e.g. invalid proof, duplicate txHash)
- **THEN** the backend MUST report the revert reason to the operator

### Requirement: End-to-end orchestration
The backend SHALL run the full flow as a single script: request attestation, wait for proof, sync root if needed, submit proof, and report the result (balance credited).

#### Scenario: Full flow completes successfully
- **WHEN** the backend is run with a valid Sepolia tx hash and environment config
- **THEN** it MUST complete all steps and log the depositor's updated balance from the Sapphire contract
