/**
 * FDC EVMTransaction Attestation Proof-of-Concept
 *
 * Verifies an Ethereum Sepolia transaction using Flare Data Connector (FDC)
 * via the @flarenetwork/flare-tx-sdk.
 *
 * Flow:
 * 1. Prepare attestation request via verifier API
 * 2. Submit attestation request to FdcHub on Coston2
 * 3. Wait for voting round finalization (poll DA layer)
 * 4. Fetch Merkle proof from Data Availability layer
 * 5. Verify proof on-chain via FdcVerification contract
 * 6. Validate and display transaction details
 *
 * What verification does (Merkle inclusion + on-chain root binding):
 * - The FdcVerification contract reconstructs the Merkle leaf from response data
 * - It computes the Merkle root using the provided proof path
 * - It checks that this computed root matches the root stored on-chain (in Relay contract)
 * - The on-chain root was signed by 50%+ of Flare's data providers
 * - This binds the attestation to Flare's consensus - if verification passes,
 *   the Sepolia transaction details are cryptographically proven correct
 */

import "dotenv/config";
import { ethers } from "ethers";
import { FdcSourceNetwork } from "@flarenetwork/flare-tx-sdk";

// ═══════════════════════════════════════════════════════════════════════════
// Configuration
// ═══════════════════════════════════════════════════════════════════════════

const COSTON2_RPC = "https://coston2-api.flare.network/ext/C/rpc";
const VERIFIER_BASE_URL = "https://fdc-verifiers-testnet.flare.network/";
const DA_LAYER_URL = "https://ctn2-data-availability.flare.network/";
const API_KEY = "00000000-0000-0000-0000-000000000000";

// Coston2 contract addresses
const FDC_HUB_ADDRESS = "0x48aC463d7975828989331F4De43341627b9c5f1D";
const FDC_FEE_CONFIG_ADDRESS = "0x191a1282Ac700edE65c5B0AaF313BAcC3eA7fC7e";
const FDC_VERIFICATION_ADDRESS = "0x075bf301fF07C4920e5261f93a0609640F53487D";

// Coston2 voting round timing constants
const FIRST_VOTING_ROUND_START_TS = 1658430000n;
const VOTING_EPOCH_DURATION_S = 90n;

// ═══════════════════════════════════════════════════════════════════════════
// Contract ABIs
// ═══════════════════════════════════════════════════════════════════════════

const FDC_HUB_ABI = [
  "function requestAttestation(bytes calldata _data) external payable returns (bool)",
];

const FDC_FEE_CONFIG_ABI = [
  "function getRequestFee(bytes calldata _data) external view returns (uint256)",
];

// Full ABI for FdcVerification.verifyEVMTransaction with nested IEVMTransaction.Proof struct
const FDC_VERIFICATION_ABI = [
  {
    name: "verifyEVMTransaction",
    type: "function",
    stateMutability: "view",
    inputs: [
      {
        name: "_proof",
        type: "tuple",
        components: [
          { name: "merkleProof", type: "bytes32[]" },
          {
            name: "data",
            type: "tuple",
            components: [
              { name: "attestationType", type: "bytes32" },
              { name: "sourceId", type: "bytes32" },
              { name: "votingRound", type: "uint64" },
              { name: "lowestUsedTimestamp", type: "uint64" },
              {
                name: "requestBody",
                type: "tuple",
                components: [
                  { name: "transactionHash", type: "bytes32" },
                  { name: "requiredConfirmations", type: "uint16" },
                  { name: "provideInput", type: "bool" },
                  { name: "listEvents", type: "bool" },
                  { name: "logIndices", type: "uint32[]" },
                ],
              },
              {
                name: "responseBody",
                type: "tuple",
                components: [
                  { name: "blockNumber", type: "uint64" },
                  { name: "timestamp", type: "uint64" },
                  { name: "sourceAddress", type: "address" },
                  { name: "isDeployment", type: "bool" },
                  { name: "receivingAddress", type: "address" },
                  { name: "value", type: "uint256" },
                  { name: "input", type: "bytes" },
                  { name: "status", type: "uint8" },
                  {
                    name: "events",
                    type: "tuple[]",
                    components: [
                      { name: "logIndex", type: "uint32" },
                      { name: "emitterAddress", type: "address" },
                      { name: "topics", type: "bytes32[]" },
                      { name: "data", type: "bytes" },
                      { name: "removed", type: "bool" },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

interface EventData {
  logIndex: number;
  emitterAddress: string;
  topics: string[];
  data: string;
  removed: boolean;
}

interface ResponseBody {
  blockNumber: string;
  timestamp: string;
  sourceAddress: string;
  isDeployment: boolean;
  receivingAddress: string;
  value: string;
  input: string;
  status: string;
  events: EventData[];
}

interface RequestBody {
  transactionHash: string;
  requiredConfirmations: string;
  provideInput: boolean;
  listEvents: boolean;
  logIndices: number[];
}

interface AttestationResponse {
  attestationType: string;
  sourceId: string;
  votingRound: string;
  lowestUsedTimestamp: string;
  requestBody: RequestBody;
  responseBody: ResponseBody;
}

interface ProofData {
  response: AttestationResponse;
  proof: string[];
}

// ═══════════════════════════════════════════════════════════════════════════
// Utilities
// ═══════════════════════════════════════════════════════════════════════════

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Encodes a string to bytes32 hex (right-padded with zeros)
 * e.g., "testETH" -> "0x7465737445544800000000000000000000000000000000000000000000000000"
 */
function toBytes32String(s: string): string {
  const bytes = new TextEncoder().encode(s);
  if (bytes.length > 32) throw new Error(`String too long for bytes32: ${s}`);
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return "0x" + hex.padEnd(64, "0");
}

// ═══════════════════════════════════════════════════════════════════════════
// Step 1: Prepare Attestation Request
// ═══════════════════════════════════════════════════════════════════════════

async function prepareAttestationRequest(
  txHash: string,
  requiredConfirmations: number
): Promise<string> {
  // Use SDK's FdcSourceNetwork enum to map to the correct source ID
  // For Coston2 (testnet), ETH maps to "testETH"
  const sourceNetwork = FdcSourceNetwork.ETH;
  const sourceId = toBytes32String(sourceNetwork === "ETH" ? "testETH" : sourceNetwork);
  const attestationType = toBytes32String("EVMTransaction");

  const requestBody = {
    transactionHash: txHash,
    requiredConfirmations: String(requiredConfirmations),
    provideInput: true,
    listEvents: true,
    logIndices: [], // empty = all events
  };

  const url = `${VERIFIER_BASE_URL}verifier/eth/EVMTransaction/prepareRequest`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-KEY": API_KEY,
    },
    body: JSON.stringify({
      attestationType,
      sourceId,
      requestBody,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Verifier API error (${response.status}): ${text}\n` +
        `This may indicate the transaction hash is invalid or doesn't exist on Sepolia.`
    );
  }

  const data = await response.json();

  if (data.status === "INVALID" || !data.abiEncodedRequest) {
    throw new Error(
      `Verifier rejected request: ${JSON.stringify(data)}\n` +
        `Possible causes: invalid tx hash, insufficient confirmations, or tx doesn't exist.`
    );
  }

  return data.abiEncodedRequest;
}

// ═══════════════════════════════════════════════════════════════════════════
// Step 2: Submit Attestation Request to FdcHub
// ═══════════════════════════════════════════════════════════════════════════

async function submitAttestationRequest(
  signer: ethers.Wallet,
  abiEncodedRequest: string
): Promise<{ coston2TxHash: string; votingRoundId: bigint }> {
  const fdcHub = new ethers.Contract(FDC_HUB_ADDRESS, FDC_HUB_ABI, signer);
  const feeConfig = new ethers.Contract(
    FDC_FEE_CONFIG_ADDRESS,
    FDC_FEE_CONFIG_ABI,
    signer.provider
  );

  // Get required attestation fee
  let fee: bigint;
  try {
    fee = await feeConfig.getRequestFee(abiEncodedRequest);
    console.log(`  Attestation fee: ${ethers.formatEther(fee)} C2FLR`);
  } catch {
    // Fallback if fee config call fails
    fee = ethers.parseEther("0.5");
    console.log(`  Using default fee: ${ethers.formatEther(fee)} C2FLR`);
  }

  // Check wallet balance
  const balance = await signer.provider!.getBalance(signer.address);
  if (balance < fee) {
    throw new Error(
      `Insufficient C2FLR balance!\n` +
        `  Have: ${ethers.formatEther(balance)} C2FLR\n` +
        `  Need: ${ethers.formatEther(fee)} C2FLR\n` +
        `  Get testnet funds at: https://faucet.flare.network/coston2`
    );
  }

  // Submit the attestation request
  const tx = await fdcHub.requestAttestation(abiEncodedRequest, { value: fee });
  console.log(`  Submitted Coston2 tx: ${tx.hash}`);

  const receipt = await tx.wait(1);
  if (!receipt || receipt.status !== 1) {
    throw new Error(`Transaction reverted: ${tx.hash}`);
  }

  // Calculate voting round ID from block timestamp
  const block = await signer.provider!.getBlock(receipt.blockNumber);
  if (!block) throw new Error("Failed to get block");

  const votingRoundId =
    (BigInt(block.timestamp) - FIRST_VOTING_ROUND_START_TS) / VOTING_EPOCH_DURATION_S;

  return { coston2TxHash: tx.hash, votingRoundId };
}

// ═══════════════════════════════════════════════════════════════════════════
// Step 3: Wait for Proof Availability (polls DA layer with exponential backoff)
// ═══════════════════════════════════════════════════════════════════════════

async function waitForProof(
  votingRoundId: bigint,
  abiEncodedRequest: string,
  maxWaitMs: number = 10 * 60 * 1000 // 10 minutes
): Promise<ProofData> {
  const url = `${DA_LAYER_URL}api/v0/fdc/get-proof-round-id-bytes`;
  const startTime = Date.now();
  let delay = 10_000; // start with 10s
  let attempts = 0;

  // Wait at least 90s for the voting epoch to complete
  console.log(`  Waiting initial ~90s for voting round to complete...`);
  await sleep(95_000);

  while (true) {
    attempts++;
    const elapsed = Math.floor((Date.now() - startTime) / 1000);

    if (Date.now() - startTime > maxWaitMs) {
      throw new Error(
        `Timed out after ${elapsed}s waiting for proof (voting round ${votingRoundId}).\n` +
          `The round may not have been finalized or the attestation was not accepted.`
      );
    }

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-KEY": API_KEY,
        },
        body: JSON.stringify({
          votingRoundId: Number(votingRoundId),
          requestBytes: abiEncodedRequest,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        if (data.proof && data.response) {
          console.log(`  Proof available after ${elapsed}s (${attempts} attempts)`);
          return data as ProofData;
        }
      }

      const status = response.status;
      console.log(
        `  [${elapsed}s] Attempt ${attempts}: proof not yet available (status ${status}), ` +
          `retrying in ${Math.floor(delay / 1000)}s...`
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(
        `  [${elapsed}s] Attempt ${attempts}: ${msg}, retrying in ${Math.floor(delay / 1000)}s...`
      );
    }

    await sleep(delay);
    delay = Math.min(delay * 1.5, 30_000); // exponential backoff, max 30s
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Step 4: Verify Proof On-Chain
// ═══════════════════════════════════════════════════════════════════════════

async function verifyOnChain(
  provider: ethers.JsonRpcProvider,
  proofData: ProofData
): Promise<boolean> {
  const contract = new ethers.Contract(
    FDC_VERIFICATION_ADDRESS,
    FDC_VERIFICATION_ABI,
    provider
  );

  const resp = proofData.response;
  const body = resp.responseBody;

  // Construct the proof struct matching IEVMTransaction.Proof
  // Use BigInt for uint64 fields to avoid JS number overflow
  const proofStruct = {
    merkleProof: proofData.proof,
    data: {
      attestationType: resp.attestationType,
      sourceId: resp.sourceId,
      votingRound: BigInt(resp.votingRound),
      lowestUsedTimestamp: BigInt(resp.lowestUsedTimestamp),
      requestBody: {
        transactionHash: resp.requestBody.transactionHash,
        requiredConfirmations: Number(resp.requestBody.requiredConfirmations),
        provideInput: resp.requestBody.provideInput,
        listEvents: resp.requestBody.listEvents,
        logIndices: (resp.requestBody.logIndices || []).map(Number),
      },
      responseBody: {
        blockNumber: BigInt(body.blockNumber),
        timestamp: BigInt(body.timestamp),
        sourceAddress: body.sourceAddress,
        isDeployment: body.isDeployment,
        receivingAddress: body.receivingAddress || ethers.ZeroAddress,
        value: BigInt(body.value),
        input: body.input || "0x",
        status: Number(body.status),
        events: (body.events || []).map((e) => ({
          logIndex: Number(e.logIndex),
          emitterAddress: e.emitterAddress,
          topics: e.topics,
          data: e.data || "0x",
          removed: e.removed || false,
        })),
      },
    },
  };

  // Call the on-chain verification (view function)
  // This verifies Merkle inclusion against the on-chain root
  return await contract.verifyEVMTransaction(proofStruct);
}

// ═══════════════════════════════════════════════════════════════════════════
// Step 5: Semantic Validation
// ═══════════════════════════════════════════════════════════════════════════

function validateAndPrintResults(
  proofData: ProofData,
  expectedTxHash: string,
  expectedStatus: number
): void {
  const resp = proofData.response;
  const body = resp.responseBody;

  // Check source network (must be testETH for Sepolia)
  const expectedSourceId = toBytes32String("testETH");
  if (resp.sourceId.toLowerCase() !== expectedSourceId.toLowerCase()) {
    throw new Error(
      `Source network mismatch!\n` +
        `  Expected: testETH (${expectedSourceId})\n` +
        `  Got: ${resp.sourceId}`
    );
  }

  // Check transaction hash matches
  if (resp.requestBody.transactionHash.toLowerCase() !== expectedTxHash.toLowerCase()) {
    throw new Error(
      `Transaction hash mismatch!\n` +
        `  Expected: ${expectedTxHash}\n` +
        `  Got: ${resp.requestBody.transactionHash}`
    );
  }

  // Check status matches expected
  const actualStatus = Number(body.status);
  if (actualStatus !== expectedStatus) {
    throw new Error(
      `Transaction status mismatch!\n` +
        `  Expected: ${expectedStatus} (${expectedStatus === 1 ? "success" : "reverted"})\n` +
        `  Got: ${actualStatus} (${actualStatus === 1 ? "success" : "reverted"})`
    );
  }

  // Print verified results
  console.log(`\n${"═".repeat(70)}`);
  console.log(`  VERIFIED TRANSACTION DETAILS`);
  console.log(`${"═".repeat(70)}`);
  console.log(`Source chain:      testETH (Sepolia)`);
  console.log(`TX hash:           ${resp.requestBody.transactionHash}`);
  console.log(`Block number:      ${body.blockNumber}`);
  console.log(
    `Timestamp:         ${body.timestamp} (${new Date(Number(body.timestamp) * 1000).toISOString()})`
  );
  console.log(`Status:            ${actualStatus} (${actualStatus === 1 ? "success" : "reverted"})`);
  console.log(`From:              ${body.sourceAddress}`);
  console.log(`To:                ${body.receivingAddress || "(contract creation)"}`);
  console.log(`Value:             ${ethers.formatEther(BigInt(body.value))} ETH`);
  console.log(`Is deployment:     ${body.isDeployment}`);
  console.log(`Events:            ${body.events?.length ?? 0}`);

  if (body.events?.length) {
    console.log(`\n  Event Details:`);
    body.events.forEach((e, i) => {
      console.log(`    [${i}] emitter=${e.emitterAddress}`);
      console.log(`        topics=${e.topics.length}, logIdx=${e.logIndex}`);
    });
  }

  console.log(`\nVoting round:      ${resp.votingRound}`);
  console.log(`Merkle proof nodes: ${proofData.proof.length}`);
  console.log(`${"═".repeat(70)}`);
}

// ═══════════════════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════════════════

async function main() {
  // Load and validate environment variables
  const privateKey = process.env.COSTON2_PK;
  const sepoliaTxHash = process.env.SEPOLIA_TX_HASH;
  const requiredConfirmations = parseInt(process.env.REQUIRED_CONFIRMATIONS ?? "1", 10);
  const expectedStatus = parseInt(process.env.EXPECT_STATUS ?? "1", 10);

  if (!privateKey) {
    throw new Error(
      "Missing COSTON2_PK in .env\n" +
        "  This should be your Coston2 EOA private key (with 0x prefix)\n" +
        "  Fund it at: https://faucet.flare.network/coston2"
    );
  }

  if (!sepoliaTxHash) {
    throw new Error(
      "Missing SEPOLIA_TX_HASH in .env\n" + "  This should be a valid Sepolia transaction hash (0x + 64 hex chars)"
    );
  }

  if (!/^0x[0-9a-fA-F]{64}$/.test(sepoliaTxHash)) {
    throw new Error(
      `Invalid SEPOLIA_TX_HASH format: must be 0x followed by 64 hex characters\n` +
        `  Got: ${sepoliaTxHash}`
    );
  }

  // Connect to Coston2
  const provider = new ethers.JsonRpcProvider(COSTON2_RPC);
  const signer = new ethers.Wallet(privateKey, provider);

  console.log(`\n${"═".repeat(70)}`);
  console.log(`  FDC EVMTransaction Attestation PoC`);
  console.log(`${"═".repeat(70)}`);
  console.log(`Wallet:            ${signer.address}`);
  console.log(`Sepolia TX:        ${sepoliaTxHash}`);
  console.log(`Confirmations:     ${requiredConfirmations}`);
  console.log(`Expected status:   ${expectedStatus}`);

  // Step 1: Prepare attestation request
  console.log(`\n${"─".repeat(70)}`);
  console.log(`Step 1: Preparing attestation request via verifier API`);
  console.log(`${"─".repeat(70)}`);
  const abiEncodedRequest = await prepareAttestationRequest(sepoliaTxHash, requiredConfirmations);
  console.log(`  Request prepared (${abiEncodedRequest.length} hex chars)`);

  // Step 2: Submit to FdcHub on Coston2
  console.log(`\n${"─".repeat(70)}`);
  console.log(`Step 2: Submitting attestation request to FdcHub`);
  console.log(`${"─".repeat(70)}`);
  const { coston2TxHash, votingRoundId } = await submitAttestationRequest(signer, abiEncodedRequest);
  console.log(`  Coston2 TX hash: ${coston2TxHash}`);
  console.log(`  Voting round ID: ${votingRoundId}`);

  // Step 3: Wait for proof availability
  console.log(`\n${"─".repeat(70)}`);
  console.log(`Step 3: Waiting for proof (voting round finalization + DA layer)`);
  console.log(`${"─".repeat(70)}`);
  const proofData = await waitForProof(votingRoundId, abiEncodedRequest);
  console.log(`  Proof retrieved with ${proofData.proof.length} Merkle nodes`);

  // Step 4: Verify on-chain
  console.log(`\n${"─".repeat(70)}`);
  console.log(`Step 4: On-chain verification via FdcVerification contract`);
  console.log(`${"─".repeat(70)}`);
  const isValid = await verifyOnChain(provider, proofData);

  if (!isValid) {
    throw new Error(
      `On-chain verification FAILED!\n` +
        `  The Merkle proof did not verify against the on-chain root.\n` +
        `  This could indicate:\n` +
        `  - The proof data is corrupted\n` +
        `  - The voting round root hasn't been finalized yet\n` +
        `  - An issue with the attestation request`
    );
  }
  console.log(`  On-chain verification PASSED`);
  console.log(`  (Merkle inclusion verified against Flare's on-chain consensus root)`);

  // Step 5: Semantic validation and output
  console.log(`\n${"─".repeat(70)}`);
  console.log(`Step 5: Semantic validation`);
  console.log(`${"─".repeat(70)}`);
  validateAndPrintResults(proofData, sepoliaTxHash, expectedStatus);

  console.log(`\n  ALL CHECKS PASSED - Transaction verified via Flare FDC!`);
  console.log(`${"═".repeat(70)}\n`);
}

// Run
main().catch((err) => {
  console.error(`\nFATAL ERROR: ${err.message}`);
  if (err.code) console.error(`Error code: ${err.code}`);
  process.exit(1);
});
