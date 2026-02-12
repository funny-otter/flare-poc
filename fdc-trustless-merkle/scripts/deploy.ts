/**
 * Deploy FdcAccountingTrustless to Sapphire testnet.
 *
 * Usage: npx tsx scripts/deploy.ts
 */

import "dotenv/config";
import { ethers } from "ethers";
import { readFileSync } from "fs";

const SAPPHIRE_TESTNET_RPC = "https://testnet.sapphire.oasis.io";

async function main() {
  const privateKey = process.env.SAPPHIRE_PK;
  const depositAddress = process.env.DEPOSIT_ADDRESS;

  if (!privateKey) throw new Error("Missing SAPPHIRE_PK in .env");
  if (!depositAddress) throw new Error("Missing DEPOSIT_ADDRESS in .env");

  const provider = new ethers.JsonRpcProvider(SAPPHIRE_TESTNET_RPC);
  const signer = new ethers.Wallet(privateKey, provider);

  console.log(`Deployer:         ${signer.address}`);
  console.log(`Root relayer:     ${signer.address} (same as deployer for PoC)`);
  console.log(`Deposit address:  ${depositAddress}`);

  const balance = await provider.getBalance(signer.address);
  console.log(`Balance:          ${ethers.formatEther(balance)} ROSE`);

  if (balance === 0n) {
    throw new Error(
      "Zero ROSE balance. Fund at https://faucet.testnet.oasis.io/"
    );
  }

  // Load compiled artifact
  const artifact = JSON.parse(
    readFileSync(
      new URL(
        "../artifacts/contracts/FdcAccountingTrustless.sol/FdcAccountingTrustless.json",
        import.meta.url
      ),
      "utf-8"
    )
  );

  const factory = new ethers.ContractFactory(
    artifact.abi,
    artifact.bytecode,
    signer
  );

  console.log("\nDeploying FdcAccountingTrustless...");
  const contract = await factory.deploy(signer.address, depositAddress);
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  console.log(`Deployed at:      ${address}`);
  console.log(
    `\nAdd to .env:\nCONTRACT_ADDRESS=${address}`
  );
}

main().catch((err) => {
  console.error(`\nFATAL: ${err.message}`);
  process.exit(1);
});
