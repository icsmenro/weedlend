// src/config/contracts.ts
import { Abi } from 'viem';
import WEEDLArtifact from '../../artifacts/contracts/WEEDL.sol/WEEDL.json';
import GreenFiStakingArtifact from '../../artifacts/contracts/GreenFiStaking.sol/GreenFiStaking.json';
import GreenFiLandArtifact from '../../artifacts/contracts/GreenFiLand.sol/GreenFiLand.json';
import GreenFiLoanArtifact from '../../artifacts/contracts/GreenFiLoan.sol/GreenFiLoan.json';
import GreenFiSeedArtifact from '../../artifacts/contracts/GreenFiSeed.sol/GreenFiSeed.json';
import GreenFiBorrowArtifact from '../../artifacts/contracts/GreenFiBorrow.sol/GreenFiBorrow.json';

export const WEEDL = {
  address: '0x9ba4a6D5B3eb5B63Ce203dE1D233619BAdC4f86c' as `0x${string}`,
  abi: WEEDLArtifact.abi as Abi,
};

export const GreenFiStaking = {
  address: '0x5C0ca083e79e6CF06C176AF7313B1A5a04936c6E' as `0x${string}`,
  abi: GreenFiStakingArtifact.abi as Abi,
};

export const GreenFiLand = {
  address: '0x164a2d93E1334ad231246b3c1A634883Bb0CF737' as `0x${string}`,
  abi: GreenFiLandArtifact.abi as Abi,
};

export const GreenFiLoan = {
  address: '0x0f1Baa8Db756321286E11Ad3A0BaF9C595d78cB0' as `0x${string}`,
  abi: GreenFiLoanArtifact.abi as Abi,
};

export const GreenFiSeed = {
  address: '0xAaB1599e58Fc0382346eAE83dD3171d5b2984E1e' as `0x${string}`,
  abi: GreenFiSeedArtifact.abi as Abi,
};

export const GreenFiBorrow = {
  address: '0xE6EC64655994997864526f0594e0d1E080b5f7Cd' as `0x${string}`,
  abi: GreenFiBorrowArtifact.abi as Abi,
};