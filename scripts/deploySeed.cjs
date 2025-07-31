// deploySeed.cjs
const { ethers, upgrades, run } = require("hardhat");

async function main() {
  // Validate environment positional arguments
  const sepoliaRpcUrl = process.env.SEPOLIA_RPC_URL;
  const deployerPrivateKey = process.env.DEPLOYER_PRIVATE_KEY;
  const etherscanApiKey = process.env.ETHERSCAN_API_KEY;

  if (!sepoliaRpcUrl || !deployerPrivateKey || !etherscanApiKey) {
    throw new Error("Missing required environment variables: SEPOLIA_RPC_URL, DEPLOYER_PRIVATE_KEY, or ETHERSCAN_API_KEY");
  }

  // Replace with the actual WEEDL token address for Sepolia
  const weedlTokenAddress = "0x9ba4a6D5B3eb5B63Ce203dE1D233619BAdC4f86c"; // TODO: Update this address
  if (!ethers.isAddress(weedlTokenAddress)) {
    throw new Error("Invalid WEEDL token address");
  }

  // Get the contract factory
  const GreenFiSeed = await ethers.getContractFactory("GreenFiSeed");

  console.log("Deploying GreenFiSeed...");

  // Deploy the contract as a UUPS proxy
  const greenFiSeed = await upgrades.deployProxy(
    GreenFiSeed,
    [weedlTokenAddress],
    {
      initializer: "initialize",
      kind: "uups",
      timeout: 600000, // 10 minutes
      pollingInterval: 1000 // Poll every 1 second
    }
  );

  // Wait for deployment to complete
  await greenFiSeed.waitForDeployment();
  const greenFiSeedAddress = await greenFiSeed.getAddress();
  console.log("GreenFiSeed proxy deployed to:", greenFiSeedAddress);

  // Get and log the implementation address
  const implementationAddress = await upgrades.erc1967.getImplementationAddress(greenFiSeedAddress);
  console.log("Implementation address:", implementationAddress);

  // Verify the WEEDL token address in the contract
  const deployedWeedlToken = await greenFiSeed.weedlToken();
  if (deployedWeedlToken.toLowerCase() !== weedlTokenAddress.toLowerCase()) {
    throw new Error("WEEDL token address mismatch in deployed contract");
  }

  // Wait 5 seconds to avoid Etherscan rate-limiting
  console.log("Waiting 5 seconds before verifying on Etherscan...");
  await new Promise(resolve => setTimeout(resolve, 5000));

  // Verify the contract on Etherscan
  console.log("Verifying contract on Etherscan...");
  try {
    await run("verify:verify", {
      address: greenFiSeedAddress,
      constructorArguments: [], // Proxy has no constructor args
      contract: "contracts/GreenFiSeed.sol:GreenFiSeed",
    });
    console.log("Contract verified on Etherscan");
  } catch (error) {
    console.error("Etherscan verification failed:", error.message);
    console.log("You can manually verify the contract later using: npx hardhat verify --network sepolia", greenFiSeedAddress);
  }
}

main()
  .then(() => {
    console.log("Deployment and verification completed successfully");
    process.exit(0);
  })
  .catch((error) => {
    console.error("Deployment failed:", error);
    process.exit(1);
  });