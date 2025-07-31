// deployProducts.cjs
const { ethers, upgrades, run } = require("hardhat");

async function main() {
  // Validate environment variables
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
  const GreenFiProducts = await ethers.getContractFactory("GreenFiProducts");

  console.log("Deploying GreenFiProducts...");

  // Deploy the contract as a UUPS proxy
  const greenFiProducts = await upgrades.deployProxy(
    GreenFiProducts,
    [weedlTokenAddress],
    {
      initializer: "initialize",
      kind: "uups",
      timeout: 600000, // 10 minutes
      pollingInterval: 1000 // Poll every 1 second
    }
  );

  // Wait for deployment to complete
  await greenFiProducts.waitForDeployment();
  const greenFiProductsAddress = await greenFiProducts.getAddress();
  console.log("GreenFiProducts proxy deployed to:", greenFiProductsAddress);

  // Get and log the implementation address
  const implementationAddress = await upgrades.erc1967.getImplementationAddress(greenFiProductsAddress);
  console.log("Implementation address:", implementationAddress);

  // Verify the WEEDL token address in the contract
  const deployedWeedlToken = await greenFiProducts.weedlToken();
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
      address: greenFiProductsAddress,
      constructorArguments: [], // Proxy has no constructor args
      contract: "contracts/GreenFiProducts.sol:GreenFiProducts",
    });
    console.log("Contract verified on Etherscan");
  } catch (error) {
    console.error("Etherscan verification failed:", error.message);
    console.log("You can manually verify the contract later using: npx hardhat verify --network sepolia", greenFiProductsAddress);
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