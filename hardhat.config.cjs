require("@nomicfoundation/hardhat-toolbox");
require("@openzeppelin/hardhat-upgrades");

module.exports = {
  solidity: "0.8.22",
  networks: {
    hardhat: {}, // For local testing
    sepolia: { // Example for Sepolia testnet
      url: "https://sepolia.infura.io/v3/ba41eda1184841cfbed0e2bd7e678e05", // Replace with your provider
      accounts: ["6b265a05732f9122f9fbfb2409d46a22a18207ce6ae4a022b50d63cddd258e11"] // Replace with your wallet's private key
    }
  }
};