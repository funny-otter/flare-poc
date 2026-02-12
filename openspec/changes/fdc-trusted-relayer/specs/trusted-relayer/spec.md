## ADDED Requirements

### Requirement: FDC proof verification before relay

The relayer SHALL verify the FDC attestation proof on Coston2 via the `FdcVerification` contract view call before submitting any data to Sapphire. The relayer MUST NOT relay data from an unverified or invalid proof.

#### Scenario: Valid FDC proof

- **WHEN** the relayer obtains a proof from the FDC DA layer and the `FdcVerification` view call returns true
- **THEN** the relayer extracts `sourceAddress`, `value`, and `transactionHash` from the proof response body and submits them to the Sapphire accounting contract

#### Scenario: Invalid FDC proof

- **WHEN** the FDC proof verification view call returns false
- **THEN** the relayer MUST abort and NOT call `creditDeposit` on the Sapphire contract

### Requirement: End-to-end attestation flow

The relayer SHALL execute the full FDC attestation lifecycle: prepare the attestation request, submit it to Coston2, wait for the voting round to finalize, retrieve the proof, verify it, and relay the result.

#### Scenario: Successful end-to-end flow

- **WHEN** the relayer is invoked with a Sepolia transaction hash
- **THEN** it performs these steps in order: (1) prepare ABI-encoded attestation request, (2) submit to FDC on Coston2, (3) wait for proof availability, (4) verify proof on-chain, (5) call `creditDeposit` on Sapphire, (6) log the credited balance

### Requirement: Sapphire contract deployment

The relayer SHALL deploy the `FdcAccounting` contract to Sapphire if no existing deployment address is configured, using the relayer's own address as the authorized relayer.

#### Scenario: Fresh deployment

- **WHEN** no contract address is configured in environment variables
- **THEN** the relayer deploys `FdcAccounting` with `authorizedRelayer` set to the relayer signer's address and uses the newly deployed contract for the remainder of the flow

#### Scenario: Existing deployment

- **WHEN** a contract address is provided via environment variable
- **THEN** the relayer connects to the existing contract without redeploying

### Requirement: Cross-chain provider management

The relayer SHALL maintain separate provider connections to Coston2 (for FDC attestation and verification) and Sapphire (for accounting contract interaction), with the Sapphire provider wrapped for transaction encryption.

#### Scenario: Provider initialization

- **WHEN** the relayer starts
- **THEN** it creates a standard ethers.js provider for Coston2 and a `sapphire.wrap()`-ed provider for Sapphire, both using RPC URLs from environment configuration
