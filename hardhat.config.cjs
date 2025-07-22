require("@nomicfoundation/hardhat-toolbox");
require("@openzeppelin/hardhat-upgrades");
require("@nomicfoundation/hardhat-verify"); // Updated to hardhat-verify
require("dotenv").config(); // Load environment variables from .env file

module.exports = {
  solidity: {
    version: "0.8.22",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200, // Adjust runs as needed (200 is a common default)
      },
      viaIR: true, // Enable Yul IR pipeline
    },
  },
  networks: {
    sepolia: {
      url: process.env.SEPOLIA_RPC_URL || "https://sepolia.infura.io/v3/ba41eda1184841cfbed0e2bd7e678e05", // Fallback URL
      accounts: [process.env.DEPLOYER_PRIVATE_KEY] || [], // Fallback to empty array if not set
    },
  },
  etherscan: {
    apiKey: process.env.ETHERSCAN_API_KEY, // Etherscan API key from .env
  },
};