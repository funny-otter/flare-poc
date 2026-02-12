/**
 * End-to-end FDC trustless relay:
 *   0. Deploy contract to Sapphire (if needed)
 *   1. Send deposit on Sepolia (self-transfer)
 *   2. Request attestation from FDC (Coston2)
 *   3. Wait for proof (DA layer)
 *   4. Sync Merkle root from Coston2 Relay to Sapphire
 *   5. Submit proof to verifyAndCredit on Sapphire
 *   6. Query and display updated balance
 *
 * Usage: npx tsx scripts/relay.ts
 */

import "dotenv/config";
import { ethers } from "ethers";
import { readFileSync, writeFileSync, existsSync } from "fs";

// ═══════════════════════════════════════════════════════════════════════════
// Configuration
// ═══════════════════════════════════════════════════════════════════════════

const SEPOLIA_RPCS = [
  "https://ethereum-sepolia-rpc.publicnode.com",
  "https://rpc2.sepolia.org",
  "https://rpc.sepolia.org",
];
const COSTON2_RPC = "https://coston2-api.flare.network/ext/C/rpc";
const SAPPHIRE_TESTNET_RPC = "https://testnet.sapphire.oasis.io";
const VERIFIER_BASE_URL = "https://fdc-verifiers-testnet.flare.network/";
const DA_LAYER_URL = "https://ctn2-data-availability.flare.network/";
const API_KEY = "00000000-0000-0000-0000-000000000000";

// Coston2 contract addresses
const FDC_HUB_ADDRESS = "0x48aC463d7975828989331F4De43341627b9c5f1D";
const FDC_FEE_CONFIG_ADDRESS = "0x191a1282Ac700edE65c5B0AaF313BAcC3eA7fC7e";
const FLARE_CONTRACT_REGISTRY = "0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019";
const FDC_PROTOCOL_ID = 200;

const DEPOSIT_AMOUNT = ethers.parseEther("0.0001");

// Voting round timing
const FIRST_VOTING_ROUND_START_TS = 1658430000n;
const VOTING_EPOCH_DURATION_S = 90n;

// ═══════════════════════════════════════════════════════════════════════════
// ABIs
// ═══════════════════════════════════════════════════════════════════════════

const FDC_HUB_ABI = [
  "function requestAttestation(bytes calldata _data) external payable returns (bool)",
];

const FDC_FEE_CONFIG_ABI = [
  "function getRequestFee(bytes calldata _data) external view returns (uint256)",
];

const RELAY_ABI = [
  "function merkleRoots(uint256 _protocolId, uint256 _votingRoundId) external view returns (bytes32)",
];

const REGISTRY_ABI = [
  "function getContractAddressByName(string calldata _name) external view returns (address)",
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

function loadArtifact() {
  return JSON.parse(
    readFileSync(
      new URL(
        "../artifacts/contracts/FdcAccountingTrustless.sol/FdcAccountingTrustless.json",
        import.meta.url
      ),
      "utf-8"
    )
  );
}

async function getSepoliaProvider(): Promise<ethers.JsonRpcProvider> {
  for (const rpc of SEPOLIA_RPCS) {
    try {
      const provider = new ethers.JsonRpcProvider(rpc);
      await provider.getBlockNumber();
      console.log(`  Using Sepolia RPC: ${rpc}`);
      return provider;
    } catch {
      // try next
    }
  }
  throw new Error("All Sepolia RPCs failed");
}

// ═══════════════════════════════════════════════════════════════════════════
// Step 0: Deploy contract (if needed)
// ═══════════════════════════════════════════════════════════════════════════

async function ensureDeployed(
  sapphireSigner: ethers.Wallet,
  depositAddress: string
): Promise<string> {
  if (process.env.CONTRACT_ADDRESS) {
    console.log(`  Already deployed: ${process.env.CONTRACT_ADDRESS}`);
    return process.env.CONTRACT_ADDRESS;
  }

  const artifact = loadArtifact();
  const factory = new ethers.ContractFactory(
    artifact.abi,
    artifact.bytecode,
    sapphireSigner
  );

  console.log("  Deploying FdcAccountingTrustless...");
  const contract = await factory.deploy(sapphireSigner.address, depositAddress);
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  console.log(`  Deployed at: ${address}`);

  // Append to .env for future runs
  const envPath = new URL("../.env", import.meta.url).pathname;
  if (existsSync(envPath)) {
    const envContent = readFileSync(envPath, "utf-8");
    if (!envContent.includes("CONTRACT_ADDRESS")) {
      writeFileSync(envPath, envContent + `\nCONTRACT_ADDRESS=${address}\n`);
      console.log("  Saved CONTRACT_ADDRESS to .env");
    }
  }

  return address;
}

// ═══════════════════════════════════════════════════════════════════════════
// Step 1: Send deposit on Sepolia
// ═══════════════════════════════════════════════════════════════════════════

async function sendDeposit(privateKey: string): Promise<string> {
  const provider = await getSepoliaProvider();
  const signer = new ethers.Wallet(privateKey, provider);

  const balance = await provider.getBalance(signer.address);
  console.log(`  Sepolia balance: ${ethers.formatEther(balance)} ETH`);

  if (balance < DEPOSIT_AMOUNT * 2n) {
    throw new Error(
      `Insufficient Sepolia ETH (need >${ethers.formatEther(DEPOSIT_AMOUNT)} + gas)`
    );
  }

  console.log(
    `  Sending ${ethers.formatEther(DEPOSIT_AMOUNT)} ETH to self (${signer.address})...`
  );
  const tx = await signer.sendTransaction({
    to: signer.address,
    value: DEPOSIT_AMOUNT,
  });
  console.log(`  TX hash: ${tx.hash}`);

  const receipt = await tx.wait(1);
  console.log(`  Confirmed in block ${receipt!.blockNumber}`);

  return tx.hash;
}

// ═══════════════════════════════════════════════════════════════════════════
// Step 2: Request FDC attestation
// ═══════════════════════════════════════════════════════════════════════════

async function prepareAttestationRequest(txHash: string): Promise<string> {
  const sourceId = toBytes32String("testETH");
  const attestationType = toBytes32String("EVMTransaction");

  const requestBody = {
    transactionHash: txHash,
    requiredConfirmations: "1",
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
    throw new Error(`Verifier API error (${response.status}): ${text}`);
  }

  const data = await response.json();
  if (data.status === "INVALID" || !data.abiEncodedRequest) {
    throw new Error(`Verifier rejected request: ${JSON.stringify(data)}`);
  }

  return data.abiEncodedRequest;
}

async function submitAttestationRequest(
  signer: ethers.Wallet,
  abiEncodedRequest: string
): Promise<{ votingRoundId: bigint }> {
  const fdcHub = new ethers.Contract(FDC_HUB_ADDRESS, FDC_HUB_ABI, signer);
  const feeConfig = new ethers.Contract(
    FDC_FEE_CONFIG_ADDRESS,
    FDC_FEE_CONFIG_ABI,
    signer.provider
  );

  let fee: bigint;
  try {
    fee = await feeConfig.getRequestFee(abiEncodedRequest);
  } catch {
    fee = ethers.parseEther("0.5");
  }
  console.log(`  Fee: ${ethers.formatEther(fee)} C2FLR`);

  const tx = await fdcHub.requestAttestation(abiEncodedRequest, { value: fee });
  console.log(`  Coston2 tx: ${tx.hash}`);
  const receipt = await tx.wait(1);
  if (!receipt || receipt.status !== 1) throw new Error("Tx reverted");

  const block = await signer.provider!.getBlock(receipt.blockNumber);
  if (!block) throw new Error("Failed to get block");

  const votingRoundId =
    (BigInt(block.timestamp) - FIRST_VOTING_ROUND_START_TS) /
    VOTING_EPOCH_DURATION_S;

  return { votingRoundId };
}

// ═══════════════════════════════════════════════════════════════════════════
// Step 3: Wait for proof
// ═══════════════════════════════════════════════════════════════════════════

async function waitForProof(
  votingRoundId: bigint,
  abiEncodedRequest: string
): Promise<ProofData> {
  const url = `${DA_LAYER_URL}api/v0/fdc/get-proof-round-id-bytes`;
  const startTime = Date.now();
  const maxWaitMs = 10 * 60 * 1000;
  let delay = 10_000;
  let attempts = 0;

  console.log("  Waiting ~90s for voting round to complete...");
  await sleep(95_000);

  while (true) {
    attempts++;
    const elapsed = Math.floor((Date.now() - startTime) / 1000);

    if (Date.now() - startTime > maxWaitMs) {
      throw new Error(`Timed out waiting for proof (round ${votingRoundId})`);
    }

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-KEY": API_KEY },
        body: JSON.stringify({
          votingRoundId: Number(votingRoundId),
          requestBytes: abiEncodedRequest,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        if (data.proof && data.response) {
          console.log(`  Proof available after ${elapsed}s (${attempts} polls)`);
          return data as ProofData;
        }
      }

      console.log(
        `  [${elapsed}s] Poll ${attempts}: not yet available, retrying in ${Math.floor(delay / 1000)}s...`
      );
    } catch {
      console.log(
        `  [${elapsed}s] Poll ${attempts}: network error, retrying...`
      );
    }

    await sleep(delay);
    delay = Math.min(delay * 1.5, 30_000);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Step 4: Sync Merkle root to Sapphire
// ═══════════════════════════════════════════════════════════════════════════

async function syncRoot(
  coston2Provider: ethers.JsonRpcProvider,
  contract: ethers.Contract,
  votingRoundId: bigint
): Promise<void> {
  const existingRoot = await contract.roots(votingRoundId);
  if (existingRoot !== ethers.ZeroHash) {
    console.log("  Root already synced, skipping");
    return;
  }

  const registry = new ethers.Contract(
    FLARE_CONTRACT_REGISTRY,
    REGISTRY_ABI,
    coston2Provider
  );
  const relayAddress = await registry.getContractAddressByName("Relay");
  console.log(`  Relay address: ${relayAddress}`);

  const relay = new ethers.Contract(relayAddress, RELAY_ABI, coston2Provider);
  const merkleRoot = await relay.merkleRoots(FDC_PROTOCOL_ID, votingRoundId);

  if (merkleRoot === ethers.ZeroHash) {
    throw new Error(
      `Merkle root not available on Relay for round ${votingRoundId}`
    );
  }
  console.log(`  Merkle root: ${merkleRoot}`);

  const tx = await contract.syncRoot(votingRoundId, merkleRoot);
  console.log(`  Sapphire tx: ${tx.hash}`);
  const receipt = await tx.wait(1);
  if (!receipt || receipt.status !== 1) throw new Error("syncRoot reverted");
  console.log("  Root synced to Sapphire");
}

// ═══════════════════════════════════════════════════════════════════════════
// Step 5: Submit proof to Sapphire
// ═══════════════════════════════════════════════════════════════════════════

async function submitProof(
  contract: ethers.Contract,
  proofData: ProofData
): Promise<void> {
  const resp = proofData.response;
  const body = resp.responseBody;

  const responseStruct = {
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
  };

  const tx = await contract.verifyAndCredit(proofData.proof, responseStruct);
  console.log(`  Sapphire tx: ${tx.hash}`);
  const receipt = await tx.wait(1);
  if (!receipt || receipt.status !== 1)
    throw new Error("verifyAndCredit reverted");
  console.log("  Proof verified and deposit credited!");
}

// ═══════════════════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════════════════

async function main() {
  const coston2Pk = process.env.COSTON2_PK;
  const sapphirePk = process.env.SAPPHIRE_PK;

  if (!coston2Pk) throw new Error("Missing COSTON2_PK in .env");
  if (!sapphirePk) throw new Error("Missing SAPPHIRE_PK in .env");

  const coston2Provider = new ethers.JsonRpcProvider(COSTON2_RPC);
  const coston2Signer = new ethers.Wallet(coston2Pk, coston2Provider);

  const sapphireProvider = new ethers.JsonRpcProvider(SAPPHIRE_TESTNET_RPC);
  const sapphireSigner = new ethers.Wallet(sapphirePk, sapphireProvider);

  // The deposit address is the wallet's own address (self-transfer)
  const depositAddress = coston2Signer.address;

  console.log(`\n${"═".repeat(70)}`);
  console.log("  FDC Trustless Merkle Relay — Full Integration Test");
  console.log(`${"═".repeat(70)}`);
  console.log(`Wallet:           ${coston2Signer.address}`);
  console.log(`Deposit address:  ${depositAddress}`);

  // Step 0: Deploy
  console.log(`\n${"─".repeat(70)}`);
  console.log("Step 0: Ensuring contract is deployed on Sapphire");
  console.log(`${"─".repeat(70)}`);
  const contractAddress = await ensureDeployed(sapphireSigner, depositAddress);

  const artifact = loadArtifact();
  const contract = new ethers.Contract(
    contractAddress,
    artifact.abi,
    sapphireSigner
  );

  // Check balance before
  const balanceBefore = await contract.getBalance();
  console.log(`\nBalance before:   ${ethers.formatEther(balanceBefore)} ETH`);

  // Step 1: Send deposit on Sepolia
  console.log(`\n${"─".repeat(70)}`);
  console.log("Step 1: Sending deposit on Sepolia");
  console.log(`${"─".repeat(70)}`);
  const sepoliaTxHash = await sendDeposit(coston2Pk);
  console.log(`  Deposit TX: ${sepoliaTxHash}`);

  // Step 2: Request attestation
  console.log(`\n${"─".repeat(70)}`);
  console.log("Step 2: Requesting FDC attestation");
  console.log(`${"─".repeat(70)}`);
  const abiEncodedRequest = await prepareAttestationRequest(sepoliaTxHash);
  console.log(`  Request prepared (${abiEncodedRequest.length} hex chars)`);

  const { votingRoundId } = await submitAttestationRequest(
    coston2Signer,
    abiEncodedRequest
  );
  console.log(`  Voting round: ${votingRoundId}`);

  // Step 3: Wait for proof
  console.log(`\n${"─".repeat(70)}`);
  console.log("Step 3: Waiting for proof");
  console.log(`${"─".repeat(70)}`);
  const proofData = await waitForProof(votingRoundId, abiEncodedRequest);
  console.log(`  Proof nodes: ${proofData.proof.length}`);

  // Step 4: Sync root
  console.log(`\n${"─".repeat(70)}`);
  console.log("Step 4: Syncing Merkle root to Sapphire");
  console.log(`${"─".repeat(70)}`);
  await syncRoot(
    coston2Provider,
    contract,
    BigInt(proofData.response.votingRound)
  );

  // Step 5: Submit proof
  console.log(`\n${"─".repeat(70)}`);
  console.log("Step 5: Submitting proof to Sapphire");
  console.log(`${"─".repeat(70)}`);
  await submitProof(contract, proofData);

  // Step 6: Check balance after
  const balanceAfter = await contract.getBalance();
  console.log(`\n${"═".repeat(70)}`);
  console.log("  RESULT");
  console.log(`${"═".repeat(70)}`);
  console.log(`Balance before:   ${ethers.formatEther(balanceBefore)} ETH`);
  console.log(`Balance after:    ${ethers.formatEther(balanceAfter)} ETH`);
  console.log(
    `Credited:         ${ethers.formatEther(balanceAfter - balanceBefore)} ETH`
  );
  console.log(`\n  Deposit verified trustlessly via on-chain Merkle proof!`);
  console.log(`${"═".repeat(70)}\n`);
}

main().catch((err) => {
  console.error(`\nFATAL: ${err.message}`);
  process.exit(1);
});
