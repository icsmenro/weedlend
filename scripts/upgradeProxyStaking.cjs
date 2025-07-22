// scripts/upgradeProxyStaking.cjs
const { ethers, upgrades } = require("hardhat");

async function main() {
  // Configuration
  const proxyAddress = "0x372648851bcb380d6737a11d6935a68579a64c57";
  const ownerPrivateKey = process.env.OWNER_PRIVATE_KEY; // Set in .env file
  const userToReset = "0x7feCBB7aFf076cc8701235B8959EB7eC69E41d27";

  if (!ownerPrivateKey) {
    throw new Error("OWNER_PRIVATE_KEY not set in environment variables. Please set it in the .env file.");
  }

  // Get the owner signer
  const owner = new ethers.Wallet(ownerPrivateKey, ethers.provider);
  console.log("Owner address:", owner.address);

  // Verify network
  const network = await ethers.provider.getNetwork();
  console.log("Connected to network:", network.name, "Chain ID:", network.chainId);

  // Deploy new implementation
  console.log("Deploying new GreenFiStaking implementation...");
  const GreenFiStaking = await ethers.getContractFactory("GreenFiStaking", owner);
  const newImplementation = await upgrades.prepareUpgrade(proxyAddress, GreenFiStaking, {
    kind: "uups",
  });
  console.log("New implementation address:", newImplementation);

  // Deploy the implementation contract explicitly
  const implementationContract = await GreenFiStaking.deploy();
  const deployTx = await implementationContract.deployTransaction.wait();
  console.log("Implementation contract deployed at:", implementationContract.address);
  console.log("Deployment transaction hash:", deployTx.transactionHash);

  // Upgrade the proxy
  console.log("Upgrading proxy to new implementation...");
  const proxyContract = await ethers.getContractAt("GreenFiStaking", proxyAddress, owner);
  const upgradeTx = await proxyContract.upgradeTo(newImplementation);
  const upgradeReceipt = await upgradeTx.wait();
  console.log("Proxy upgraded to new implementation. Transaction hash:", upgradeReceipt.transactionHash);

  // Connect to the proxy with the new implementation
  const contract = GreenFiStaking.attach(proxyAddress).connect(owner);

  // Verify current owner
  const contractOwner = await contract.owner();
  if (contractOwner.toLowerCase() !== owner.address.toLowerCase()) {
    throw new Error(`Caller ${owner.address} is not the contract owner. Current owner: ${contractOwner}`);
  }

  // Find and reset corrupted stake
  console.log(`Checking stakes for user ${userToReset}...`);
  const stakes = await contract.getUserStakes(userToReset);
  let corruptedIndex = -1;
  for (let i = 0; i < stakes.length; i++) {
    try {
      // Attempt to access isActive to detect corruption
      const isActive = stakes[i].isActive;
      console.log(`Stake ${i}:`, {
        amount: ethers.BigNumber.from(stakes[i].amount).toString(),
        startTime: ethers.BigNumber.from(stakes[i].startTime).toString(),
        duration: ethers.BigNumber.from(stakes[i].duration).toString(),
        rewardDebt: ethers.BigNumber.from(stakes[i].rewardDebt).toString(),
        isActive,
      });
    } catch (error) {
      console.log(`Corrupted stake found at index ${i}:`, error.message);
      corruptedIndex = i;
      break;
    }
  }

  if (corruptedIndex >= 0) {
    console.log(`Resetting corrupted stake at index ${corruptedIndex} for user ${userToReset}...`);
    const resetTx = await contract.resetStake(userToReset, corruptedIndex, { gasLimit: 300000 });
    const resetReceipt = await resetTx.wait();
    console.log(`Stake reset successfully for ${userToReset} at index ${corruptedIndex}. Transaction hash:`, resetReceipt.transactionHash);
  } else {
    console.log(`No corrupted stakes found for ${userToReset}.`);
  }

  // Verify the reset
  console.log(`Verifying stake data for ${userToReset}...`);
  const updatedStakes = await contract.getUserStakes(userToReset);
  console.log("Stake data after reset:", updatedStakes.map((stake, index) => ({
    index,
    amount: ethers.BigNumber.from(stake.amount).toString(),
    startTime: ethers.BigNumber.from(stake.startTime).toString(),
    duration: ethers.BigNumber.from(stake.duration).toString(),
    rewardDebt: ethers.BigNumber.from(stake.rewardDebt).toString(),
    isActive: stake.isActive,
  })));
}

main()
  .then(() => {
    console.log("Upgrade and reset completed successfully.");
    process.exit(0);
  })
  .catch((error) => {
    console.error("Error during upgrade or reset:", error);
    process.exit(1);
  });