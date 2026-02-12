/**
 * FDC Trusted Relayer — Sapphire Accounting Demo
 *
 * Fully self-contained end-to-end flow:
 * 0. Send a small ETH transfer to self on Sepolia (creates the tx to attest)
 * 1. Deploy FdcAccounting contract on Sapphire (or connect to existing)
 * 2. Prepare FDC attestation request for the Sepolia tx
 * 3. Submit attestation request to FdcHub on Coston2
 * 4. Wait for proof availability
 * 5. Verify the Merkle proof on-chain
 * 6. Relay verified deposit to the Sapphire accounting contract
 * 7. Query the depositor's private balance
 */

import "dotenv/config";
import { ethers } from "ethers";
import * as sapphire from "@oasisprotocol/sapphire-paratime";
import { FdcSourceNetwork } from "@flarenetwork/flare-tx-sdk";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ═══════════════════════════════════════════════════════════════════════════
// Contract artifact (ABI + bytecode from Hardhat compilation)
// ═══════════════════════════════════════════════════════════════════════════

const __dirname = dirname(fileURLToPath(import.meta.url));
const artifactPath = resolve(
  __dirname,
  "../contracts/artifacts/src/FdcAccounting.sol/FdcAccounting.json"
);
const artifact = JSON.parse(readFileSync(artifactPath, "utf-8"));
const FDC_ACCOUNTING_ABI = artifact.abi;
const FDC_ACCOUNTING_BYTECODE = artifact.bytecode;

// ═══════════════════════════════════════════════════════════════════════════
// Configuration
// ═══════════════════════════════════════════════════════════════════════════

const SEPOLIA_RPC = process.env.SEPOLIA_RPC ?? "https://ethereum-sepolia-rpc.publicnode.com";
const COSTON2_RPC = "https://coston2-api.flare.network/ext/C/rpc";
const SAPPHIRE_TESTNET_RPC = process.env.SAPPHIRE_RPC ?? "https://testnet.sapphire.oasis.io";
const DEPOSIT_AMOUNT = process.env.DEPOSIT_AMOUNT ?? "0.0001";
const VERIFIER_BASE_URL = "https://fdc-verifiers-testnet.flare.network/";
const DA_LAYER_URL = "https://ctn2-data-availability.flare.network/";
const API_KEY = "00000000-0000-0000-0000-000000000000";

// Coston2 contract addresses
const FDC_HUB_ADDRESS = "0x48aC463d7975828989331F4De43341627b9c5f1D";
const FDC_FEE_CONFIG_ADDRESS = "0x191a1282Ac700edE65c5B0AaF313BAcC3eA7fC7e";
const FDC_VERIFICATION_ADDRESS = "0x075bf301fF07C4920e5261f93a0609640F53487D";

// Coston2 voting round timing
const FIRST_VOTING_ROUND_START_TS = 1658430000n;
const VOTING_EPOCH_DURATION_S = 90n;

// FDC verification ABI (same as poc.ts)
const FDC_HUB_ABI = [
  "function requestAttestation(bytes calldata _data) external payable returns (bool)",
];
const FDC_FEE_CONFIG_ABI = [
  "function getRequestFee(bytes calldata _data) external view returns (uint256)",
];
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

function toBytes32String(s: string): string {
  const bytes = new TextEncoder().encode(s);
  if (bytes.length > 32) throw new Error(`String too long for bytes32: ${s}`);
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return "0x" + hex.padEnd(64, "0");
}

// ═══════════════════════════════════════════════════════════════════════════
// Step 0: Send ETH to self on Sepolia (creates the deposit tx to attest)
// ═══════════════════════════════════════════════════════════════════════════

async function sendSepoliaDeposit(
  sepoliaSigner: ethers.Wallet,
  confirmations: number
): Promise<string> {
  const amount = ethers.parseEther(DEPOSIT_AMOUNT);
  console.log(`  Sending ${DEPOSIT_AMOUNT} ETH to self on Sepolia...`);

  const tx = await sepoliaSigner.sendTransaction({
    to: sepoliaSigner.address,
    value: amount,
  });
  console.log(`  Sepolia tx: ${tx.hash}`);

  console.log(`  Waiting for ${confirmations} confirmation(s)...`);
  const receipt = await tx.wait(confirmations);
  if (!receipt || receipt.status !== 1) {
    throw new Error(`Sepolia tx reverted: ${tx.hash}`);
  }
  console.log(`  Confirmed in block ${receipt.blockNumber}`);

  return tx.hash;
}

// ═══════════════════════════════════════════════════════════════════════════
// Step 1: Deploy or Connect to FdcAccounting on Sapphire
// ═══════════════════════════════════════════════════════════════════════════

async function deployOrConnect(
  sapphireSigner: ethers.Signer
): Promise<ethers.Contract> {
  const existingAddress = process.env.ACCOUNTING_CONTRACT_ADDRESS;

  if (existingAddress) {
    console.log(`  Connecting to existing contract at ${existingAddress}`);
    return new ethers.Contract(existingAddress, FDC_ACCOUNTING_ABI, sapphireSigner);
  }

  console.log(`  Deploying FdcAccounting to Sapphire testnet...`);
  const factory = new ethers.ContractFactory(
    FDC_ACCOUNTING_ABI,
    FDC_ACCOUNTING_BYTECODE,
    sapphireSigner
  );

  const signerAddress = await sapphireSigner.getAddress();
  const contract = await factory.deploy(signerAddress);
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  console.log(`  Deployed at ${address}`);
  console.log(`  Authorized relayer: ${signerAddress}`);

  return contract as ethers.Contract;
}

// ═══════════════════════════════════════════════════════════════════════════
// Step 2: Prepare Attestation Request
// ═══════════════════════════════════════════════════════════════════════════

async function prepareAttestationRequest(
  txHash: string,
  requiredConfirmations: number
): Promise<string> {
  const sourceNetwork = FdcSourceNetwork.ETH;
  const sourceId = toBytes32String(sourceNetwork === "ETH" ? "testETH" : sourceNetwork);
  const attestationType = toBytes32String("EVMTransaction");

  const requestBody = {
    transactionHash: txHash,
    requiredConfirmations: String(requiredConfirmations),
    provideInput: true,
    listEvents: true,
    logIndices: [],
  };

  const url = `${VERIFIER_BASE_URL}verifier/eth/EVMTransaction/prepareRequest`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-KEY": API_KEY,
    },
    body: JSON.stringify({ attestationType, sourceId, requestBody }),
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
// Step 3: Submit Attestation Request to FdcHub
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

  let fee: bigint;
  try {
    fee = await feeConfig.getRequestFee(abiEncodedRequest);
    console.log(`  Attestation fee: ${ethers.formatEther(fee)} C2FLR`);
  } catch {
    fee = ethers.parseEther("0.5");
    console.log(`  Using default fee: ${ethers.formatEther(fee)} C2FLR`);
  }

  const balance = await signer.provider!.getBalance(signer.address);
  if (balance < fee) {
    throw new Error(
      `Insufficient C2FLR balance!\n` +
        `  Have: ${ethers.formatEther(balance)} C2FLR\n` +
        `  Need: ${ethers.formatEther(fee)} C2FLR\n` +
        `  Get testnet funds at: https://faucet.flare.network/coston2`
    );
  }

  const tx = await fdcHub.requestAttestation(abiEncodedRequest, { value: fee });
  console.log(`  Submitted Coston2 tx: ${tx.hash}`);

  const receipt = await tx.wait(1);
  if (!receipt || receipt.status !== 1) {
    throw new Error(`Transaction reverted: ${tx.hash}`);
  }

  const block = await signer.provider!.getBlock(receipt.blockNumber);
  if (!block) throw new Error("Failed to get block");

  const votingRoundId =
    (BigInt(block.timestamp) - FIRST_VOTING_ROUND_START_TS) / VOTING_EPOCH_DURATION_S;

  return { coston2TxHash: tx.hash, votingRoundId };
}

// ═══════════════════════════════════════════════════════════════════════════
// Step 4: Wait for Proof
// ═══════════════════════════════════════════════════════════════════════════

async function waitForProof(
  votingRoundId: bigint,
  abiEncodedRequest: string,
  maxWaitMs: number = 10 * 60 * 1000
): Promise<ProofData> {
  const url = `${DA_LAYER_URL}api/v0/fdc/get-proof-round-id-bytes`;
  const startTime = Date.now();
  let delay = 10_000;
  let attempts = 0;

  console.log(`  Waiting initial ~90s for voting round to complete...`);
  await sleep(95_000);

  while (true) {
    attempts++;
    const elapsed = Math.floor((Date.now() - startTime) / 1000);

    if (Date.now() - startTime > maxWaitMs) {
      throw new Error(
        `Timed out after ${elapsed}s waiting for proof (voting round ${votingRoundId}).`
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

      console.log(
        `  [${elapsed}s] Attempt ${attempts}: proof not yet available (status ${response.status}), ` +
          `retrying in ${Math.floor(delay / 1000)}s...`
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(
        `  [${elapsed}s] Attempt ${attempts}: ${msg}, retrying in ${Math.floor(delay / 1000)}s...`
      );
    }

    await sleep(delay);
    delay = Math.min(delay * 1.5, 30_000);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Step 5: Verify Proof On-Chain
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

  return await contract.verifyEVMTransaction(proofStruct);
}

// ═══════════════════════════════════════════════════════════════════════════
// Step 6: Relay to Sapphire
// ═══════════════════════════════════════════════════════════════════════════

async function relayToSapphire(
  accountingContract: ethers.Contract,
  proofData: ProofData
): Promise<void> {
  const body = proofData.response.responseBody;
  const txHash = proofData.response.requestBody.transactionHash;
  const depositor = body.sourceAddress;
  const value = BigInt(body.value);

  console.log(`  Relaying deposit:`);
  console.log(`    TX hash:    ${txHash}`);
  console.log(`    Depositor:  ${depositor}`);
  console.log(`    Value:      ${ethers.formatEther(value)} ETH`);

  const tx = await accountingContract.creditDeposit(txHash, depositor, value);
  console.log(`  Sapphire tx: ${tx.hash}`);

  const receipt = await tx.wait(1);
  if (!receipt || receipt.status !== 1) {
    throw new Error(`creditDeposit reverted: ${tx.hash}`);
  }
  console.log(`  Deposit credited successfully`);

  // Query the depositor's balance
  const balance = await accountingContract.getBalanceOf(depositor);
  console.log(`  Depositor balance: ${ethers.formatEther(balance)} ETH`);
}

// ═══════════════════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════════════════

async function main() {
  const coston2Pk = process.env.COSTON2_PK;
  const sapphirePk = process.env.SAPPHIRE_PK ?? coston2Pk;
  const sepoliaPk = process.env.SEPOLIA_PK ?? coston2Pk;
  const requiredConfirmations = parseInt(process.env.REQUIRED_CONFIRMATIONS ?? "1", 10);

  if (!coston2Pk) {
    throw new Error(
      "Missing COSTON2_PK in .env\n" +
        "  Fund at: https://faucet.flare.network/coston2"
    );
  }
  if (!sapphirePk) {
    throw new Error(
      "Missing SAPPHIRE_PK in .env\n" +
        "  Fund at: https://faucet.oasis.io/"
    );
  }
  if (!sepoliaPk) {
    throw new Error(
      "Missing SEPOLIA_PK (or COSTON2_PK) in .env\n" +
        "  This should be a private key funded with Sepolia ETH"
    );
  }

  // Sepolia provider + signer (for creating the deposit tx)
  const sepoliaProvider = new ethers.JsonRpcProvider(SEPOLIA_RPC);
  const sepoliaSigner = new ethers.Wallet(sepoliaPk, sepoliaProvider);

  // Coston2 provider + signer (for FDC attestation)
  const coston2Provider = new ethers.JsonRpcProvider(COSTON2_RPC);
  const coston2Signer = new ethers.Wallet(coston2Pk, coston2Provider);

  // Sapphire provider + signer (wrapped for encryption)
  const sapphireProvider = sapphire.wrap(
    new ethers.JsonRpcProvider(SAPPHIRE_TESTNET_RPC)
  );
  const sapphireSigner = sapphire.wrap(
    new ethers.Wallet(sapphirePk, sapphireProvider)
  );

  console.log(`\n${"═".repeat(70)}`);
  console.log(`  FDC Trusted Relayer — Sapphire Accounting Demo`);
  console.log(`${"═".repeat(70)}`);
  console.log(`Sepolia wallet:    ${sepoliaSigner.address}`);
  console.log(`Coston2 wallet:    ${coston2Signer.address}`);
  console.log(`Sapphire wallet:   ${await sapphireSigner.getAddress()}`);
  console.log(`Deposit amount:    ${DEPOSIT_AMOUNT} ETH`);

  // Step 0: Send ETH to self on Sepolia
  console.log(`\n${"─".repeat(70)}`);
  console.log(`Step 0: Send deposit tx on Sepolia`);
  console.log(`${"─".repeat(70)}`);
  const sepoliaTxHash = await sendSepoliaDeposit(sepoliaSigner, requiredConfirmations);

  // Step 1: Deploy or connect to FdcAccounting on Sapphire
  console.log(`\n${"─".repeat(70)}`);
  console.log(`Step 1: Deploy/connect FdcAccounting on Sapphire`);
  console.log(`${"─".repeat(70)}`);
  const accountingContract = await deployOrConnect(sapphireSigner);

  // Step 2: Prepare attestation request
  console.log(`\n${"─".repeat(70)}`);
  console.log(`Step 2: Preparing attestation request`);
  console.log(`${"─".repeat(70)}`);
  const abiEncodedRequest = await prepareAttestationRequest(sepoliaTxHash, requiredConfirmations);
  console.log(`  Request prepared (${abiEncodedRequest.length} hex chars)`);

  // Step 3: Submit to FdcHub on Coston2
  console.log(`\n${"─".repeat(70)}`);
  console.log(`Step 3: Submitting attestation request to FdcHub`);
  console.log(`${"─".repeat(70)}`);
  const { coston2TxHash, votingRoundId } = await submitAttestationRequest(
    coston2Signer,
    abiEncodedRequest
  );
  console.log(`  Coston2 TX: ${coston2TxHash}`);
  console.log(`  Voting round: ${votingRoundId}`);

  // Step 4: Wait for proof
  console.log(`\n${"─".repeat(70)}`);
  console.log(`Step 4: Waiting for proof`);
  console.log(`${"─".repeat(70)}`);
  const proofData = await waitForProof(votingRoundId, abiEncodedRequest);

  // Step 5: Verify on-chain
  console.log(`\n${"─".repeat(70)}`);
  console.log(`Step 5: On-chain verification via FdcVerification`);
  console.log(`${"─".repeat(70)}`);
  const isValid = await verifyOnChain(coston2Provider, proofData);
  if (!isValid) {
    throw new Error("On-chain verification FAILED — aborting relay.");
  }
  console.log(`  Verification PASSED`);

  // Step 6: Relay to Sapphire
  console.log(`\n${"─".repeat(70)}`);
  console.log(`Step 6: Relay deposit to Sapphire accounting contract`);
  console.log(`${"─".repeat(70)}`);
  await relayToSapphire(accountingContract, proofData);

  console.log(`\n${"═".repeat(70)}`);
  console.log(`  DONE — Deposit verified via FDC and credited on Sapphire`);
  console.log(`${"═".repeat(70)}\n`);
}

main().catch((err) => {
  console.error(`\nFATAL ERROR: ${err.message}`);
  if (err.code) console.error(`Error code: ${err.code}`);
  process.exit(1);
});
