const { ethers, upgrades } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  const owner = deployer.address;
  const ecosystemWallet = "0x1Ce468FACec05BEe2556b3CaA91E1264FDD976EE"; // Replace with valid address

  const WEEDL = await ethers.getContractFactory("WEEDL");
  const weedl = await WEEDL.deploy(owner, ecosystemWallet);
  await weedl.waitForDeployment();
  console.log("WEEDL deployed to:", weedl.target);

  const GreenFi = await ethers.getContractFactory("GreenFi");
  const greenfi = await upgrades.deployProxy(
    GreenFi,
    [weedl.target, owner, ecosystemWallet],
    { kind: "uups" }
  );
  await greenfi.waitForDeployment();
  console.log("GreenFi deployed to:", greenfi.target);

  const totalSupply = ethers.parseUnits("4200000000", 18);
  await weedl.approve(greenfi.target, totalSupply);
  console.log("GreenFi approved to spend WEEDL tokens");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});