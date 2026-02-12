import type { HardhatUserConfig } from "hardhat/config";
require("@nomicfoundation/hardhat-toolbox");

const config: HardhatUserConfig = {
  solidity: "0.8.24",
  paths: {
    sources: "./contracts",
    artifacts: "./artifacts",
    cache: "./cache",
  },
};

export default config;
