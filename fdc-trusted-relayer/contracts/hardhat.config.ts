import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "@oasisprotocol/sapphire-hardhat";
import "dotenv/config";

const config: HardhatUserConfig = {
  solidity: "0.8.24",
  paths: {
    sources: "./src",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
  networks: {
    sapphire_testnet: {
      url: "https://testnet.sapphire.oasis.io",
      chainId: 0x5aff,
      accounts: process.env.COSTON2_PK ? [process.env.COSTON2_PK] : [],
    },
  },
  sourcify: {
    enabled: true,
  },
};

export default config;
