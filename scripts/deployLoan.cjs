// deployLoan.cjs
const { ethers, upgrades, run } = require("hardhat");

async function main() {
  const sepoliaRpcUrl = process.env.SEPOLIA_RPC_URL;
  const deployerPrivateKey = process.env.DEPLOYER_PRIVATE_KEY;
  const etherscanApiKey = process.env.ETHERSCAN_API_KEY;

  if (!sepoliaRpcUrl || !deployerPrivateKey || !etherscanApiKey) {
    throw new Error("Missing required environment variables: SEPOLIA_RPC_URL, DEPLOYER_PRIVATE_KEY, or ETHERSCAN_API_KEY");
  }

  const weedlTokenAddress = "0x9ba4a6D5B3eb5B63Ce203dE1D233619BAdC4f86c"; // Ensure this is correct for Sepolia
  if (!ethers.isAddress(weedlTokenAddress)) {
    throw new Error("Invalid WEEDL token address");
  }

  const GreenFiLoan = await ethers.getContractFactory("GreenFiLoan");

  console.log("Deploying GreenFiLoan...");

  const greenFiLoan = await upgrades.deployProxy(
    GreenFiLoan,
    [weedlTokenAddress],
    {
      initializer: "initialize",
      kind: "uups",
      timeout: 600000,
      pollingInterval: 1000
    }
  );

  await greenFiLoan.waitForDeployment();
  const greenFiLoanAddress = await greenFiLoan.getAddress();
  console.log("GreenFiLoan proxy deployed to:", greenFiLoanAddress);

  const implementationAddress = await upgrades.erc1967.getImplementationAddress(greenFiLoanAddress);
  console.log("Implementation address:", implementationAddress);

  const deployedWeedlToken = await greenFiLoan.weedlToken();
  if (deployedWeedlToken.toLowerCase() !== weedlTokenAddress.toLowerCase()) {
    throw new Error("WEEDL token address mismatch in deployed contract");
  }

  console.log("Waiting 5 seconds before verifying on Etherscan...");
  await new Promise(resolve => setTimeout(resolve, 5000));

  console.log("Verifying contract on Etherscan...");
  try {
    await run("verify:verify", {
      address: greenFiLoanAddress,
      constructorArguments: [],
      contract: "contracts/GreenFiLoan.sol:GreenFiLoan",
    });
    console.log("Contract verified on Etherscan");
  } catch (error) {
    console.error("Etherscan verification failed:", error.message);
    console.log("You can manually verify the contract later using: npx hardhat verify --network sepolia", greenFiLoanAddress);
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