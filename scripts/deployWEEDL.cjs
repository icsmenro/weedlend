// deployWEEDL.cjs
const hre = require("hardhat");

async function main() {
  // Get the deployer account
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying WEEDL with account:", deployer.address);

  // Configuration
  const adminAddress = deployer.address; // Deployer is the initial admin
  const ecosystemWallet = "0x7feCBB7aFf076cc8701235B8959EB7eC69E41d27"; // Replace with actual ecosystem wallet address
  const initialDexPairs = [];

  // Validate inputs
  if (!adminAddress || !ecosystemWallet || initialDexPairs.some(pair => !pair)) {
    throw new Error("Invalid configuration: Ensure admin, ecosystem wallet, and DEX pairs are set");
  }
  if (initialDexPairs.length > 10) {
    throw new Error("Too many DEX pairs: Maximum 10 allowed");
  }

  // Compile the contract explicitly
  console.log("Compiling contracts...");
  await hre.run("compile");
  console.log("Contracts compiled successfully");

  // Get the contract factory
  const WEEDL = await hre.ethers.getContractFactory("WEEDL");
  if (!WEEDL) {
    throw new Error("Failed to get WEEDL contract factory");
  }
  console.log("WEEDL contract factory initialized");

  // Deploy the contract using gas settings from hardhat.config.js
  console.log("Deploying WEEDL contract...");
  const weedl = await WEEDL.deploy(adminAddress, ecosystemWallet, initialDexPairs);
  await weedl.waitForDeployment(); // Wait for the deployment transaction to be mined
  console.log("WEEDL deployed to:", await weedl.getAddress()); // Get contract address

  // Log constructor arguments
  console.log("Admin address:", adminAddress);
  console.log("Ecosystem wallet:", ecosystemWallet);
  console.log("Initial DEX pairs:", initialDexPairs);

  // Optional: Verify contract on Etherscan (if on a supported network)
  if (hre.network.name !== "hardhat" && hre.network.name !== "localhost") {
    console.log("Waiting for block confirmations before verification...");
    await weedl.deploymentTransaction().wait(6); // Wait for 6 confirmations
    try {
      await hre.run("verify:verify", {
        address: await weedl.getAddress(),
        constructorArguments: [adminAddress, ecosystemWallet, initialDexPairs],
      });
      console.log("Contract verified on Etherscan");
    } catch (error) {
      console.error("Etherscan verification failed:", error.message);
    }
  }
}

// Execute deployment and handle errors
main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error("Deployment failed:", error);
    process.exit(1);
  });