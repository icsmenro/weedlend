import { useEffect, useMemo, useRef, useState } from "react";
import { useReadContract, useWatchContractEvent } from "wagmi";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { Raycaster, Vector2, type InstancedMesh } from "three";
import { GreenFiLand, GreenFiLoan, GreenFiProducts, GreenFiSeed, GreenFiStaking } from "../config/contracts";
import { getMetadata } from "../utils/metadata";
import { sanitizeHTML } from "../utils/security";
import { toast } from "react-toastify";
import { Abi, AbiEvent } from "viem";
import { throttle } from "lodash";

// Type Definitions
interface LandListing {
  id: string;
  owner: string;
  metadataURI: string;
  collateralValue: bigint;
  isActive: boolean;
  contactInfo: string;
  loanId?: string;
  borrowId?: string;
}

interface Loan {
  id: string;
  grower: string;
  amount: bigint;
  duration: bigint;
  isActive: boolean;
  contactInfo: string;
  fee: bigint;
  createdAt: bigint;
  growPurpose: string;
  status: string;
  collateralAmount: bigint;
  lender: string;
  repaidAmount: bigint;
  interestRate: bigint;
}

interface ProductListing {
  id: string;
  seller: string;
  metadataURI: string;
  category: string;
  price: bigint;
  contactInfo: string;
  unitQuantity: bigint;
  quantityAvailable: bigint;
  discount: bigint;
  isActive: boolean;
}

interface SeedListing {
  id: string;
  seller: string;
  metadataURI: string;
  strain: string;
  price: bigint;
  contactInfo: string;
  packSize: bigint;
  packQuantity: bigint;
  discount: bigint;
  isActive: boolean;
}

interface Staking {
  user: string;
  amount: bigint;
  startTime: bigint;
  duration: bigint;
  rewardDebt: bigint;
  isActive: boolean;
  uuid: string;
}

interface Metadata {
  description?: string;
  image?: string;
  contact?: string;
  latitude?: string;
  longitude?: string;
  size?: string;
  zoning?: string;
  utilities?: string;
  strain?: string;
  strainType?: string;
  category?: string;
  unitQuantity?: number;
  quantityAvailable?: number;
  discount?: number;
}

interface EnrichedListing extends LandListing {
  metadata: Metadata;
}

interface EnrichedSeed extends SeedListing {
  metadata?: Metadata;
}

interface EnrichedProduct extends ProductListing {
  metadata?: Metadata;
}

interface EnrichedLoan extends Loan {
  metadata?: Metadata;
}

interface PlotUserData {
  listing?: EnrichedListing;
  seed?: EnrichedSeed;
  product?: EnrichedProduct;
  loan?: EnrichedLoan;
  stake?: Staking;
  tooltip: string;
}

// Contract Event ABIs
const landListedEventAbi: AbiEvent = {
  type: "event",
  name: "LandListed",
  inputs: [
    { indexed: true, name: "id", type: "string" },
    { indexed: true, name: "owner", type: "address" },
    { indexed: false, name: "metadataURI", type: "string" },
    { indexed: false, name: "collateralValue", type: "uint256" },
    { indexed: false, name: "contactInfo", type: "string" },
    { indexed: false, name: "fee", type: "uint256" },
  ],
};

const landDelistedEventAbi: AbiEvent = {
  type: "event",
  name: "LandDelisted",
  inputs: [
    { indexed: true, name: "id", type: "string" },
    { indexed: true, name: "owner", type: "address" },
    { indexed: false, name: "refundAmount", type: "uint256" },
  ],
};

const collateralUpdatedEventAbi: AbiEvent = {
  type: "event",
  name: "CollateralUpdated",
  inputs: [
    { indexed: true, name: "id", type: "string" },
    { indexed: true, name: "owner", type: "address" },
    { indexed: false, name: "newCollateralValue", type: "uint256" },
    { indexed: false, name: "fee", type: "uint256" },
  ],
};

const seedListedEventAbi: AbiEvent = {
  type: "event",
  name: "SeedListed",
  inputs: [
    { indexed: true, name: "seedId", type: "string" },
    { indexed: true, name: "seller", type: "address" },
    { indexed: false, name: "metadataURI", type: "string" },
    { indexed: false, name: "strain", type: "string" },
    { indexed: false, name: "price", type: "uint256" },
    { indexed: false, name: "contactInfo", type: "string" },
    { indexed: false, name: "packSize", type: "uint256" },
    { indexed: false, name: "packQuantity", type: "uint256" },
    { indexed: false, name: "discount", type: "uint256" },
    { indexed: false, name: "fee", type: "uint256" },
  ],
};

const seedDelistedEventAbi: AbiEvent = {
  type: "event",
  name: "SeedDelisted",
  inputs: [
    { indexed: true, name: "seedId", type: "string" },
    { indexed: true, name: "seller", type: "address" },
  ],
};

const productListedEventAbi: AbiEvent = {
  type: "event",
  name: "ProductListed",
  inputs: [
    { indexed: true, name: "productId", type: "string" },
    { indexed: true, name: "seller", type: "address" },
    { indexed: false, name: "metadataURI", type: "string" },
    { indexed: false, name: "category", type: "string" },
    { indexed: false, name: "price", type: "uint256" },
    { indexed: false, name: "contactInfo", type: "string" },
    { indexed: false, name: "unitQuantity", type: "uint256" },
    { indexed: false, name: "quantityAvailable", type: "uint256" },
    { indexed: false, name: "discount", type: "uint256" },
    { indexed: false, name: "fee", type: "uint256" },
  ],
};

const productDelistedEventAbi: AbiEvent = {
  type: "event",
  name: "ProductDelisted",
  inputs: [
    { indexed: true, name: "productId", type: "string" },
    { indexed: true, name: "seller", type: "address" },
  ],
};

const stakedEventAbi: AbiEvent = {
  type: "event",
  name: "Staked",
  inputs: [
    { indexed: true, name: "user", type: "address" },
    { indexed: false, name: "amount", type: "uint256" },
    { indexed: false, name: "duration", type: "uint256" },
    { indexed: false, name: "startTime", type: "uint256" },
    { indexed: true, name: "uuid", type: "bytes32" },
  ],
};

const unstakedEventAbi: AbiEvent = {
  type: "event",
  name: "Unstaked",
  inputs: [
    { indexed: true, name: "user", type: "address" },
    { indexed: false, name: "amount", type: "uint256" },
    { indexed: false, name: "reward", type: "uint256" },
    { indexed: true, name: "uuid", type: "bytes32" },
  ],
};

const rewardClaimedEventAbi: AbiEvent = {
  type: "event",
  name: "RewardClaimed",
  inputs: [
    { indexed: true, name: "user", type: "address" },
    { indexed: false, name: "reward", type: "uint256" },
    { indexed: true, name: "uuid", type: "bytes32" },
  ],
};

const stakeResetEventAbi: AbiEvent = {
  type: "event",
  name: "StakeReset",
  inputs: [
    { indexed: true, name: "user", type: "address" },
    { indexed: true, name: "uuid", type: "bytes32" },
  ],
};

const loanCreatedEventAbi: AbiEvent = {
  type: "event",
  name: "LoanCreated",
  inputs: [
    { indexed: true, name: "id", type: "string" },
    { indexed: true, name: "grower", type: "address" },
    { indexed: false, name: "amount", type: "uint256" },
    { indexed: false, name: "duration", type: "uint256" },
    { indexed: false, name: "contactInfo", type: "string" },
    { indexed: false, name: "fee", type: "uint256" },
    { indexed: false, name: "growPurpose", type: "string" },
    { indexed: false, name: "collateralAmount", type: "uint256" },
    { indexed: true, name: "interestRate", type: "uint256" },
  ],
};

const loanFundedEventAbi: AbiEvent = {
  type: "event",
  name: "LoanFunded",
  inputs: [
    { indexed: true, name: "id", type: "string" },
    { indexed: true, name: "lender", type: "address" },
    { indexed: true, name: "grower", type: "address" },
  ],
};

const loanRepaidEventAbi: AbiEvent = {
  type: "event",
  name: "LoanRepaid",
  inputs: [
    { indexed: true, name: "id", type: "string" },
    { indexed: true, name: "grower", type: "address" },
    { indexed: false, name: "amount", type: "uint256" },
    { indexed: false, name: "interest", type: "uint256" },
  ],
};

const loanCanceledEventAbi: AbiEvent = {
  type: "event",
  name: "LoanCanceled",
  inputs: [
    { indexed: true, name: "id", type: "string" },
    { indexed: true, name: "grower", type: "address" },
  ],
};

const collateralClaimedEventAbi: AbiEvent = {
  type: "event",
  name: "CollateralClaimed",
  inputs: [
    { indexed: true, name: "id", type: "string" },
    { indexed: true, name: "lender", type: "address" },
  ],
};

const loanStatusChangedEventAbi: AbiEvent = {
  type: "event",
  name: "LoanStatusChanged",
  inputs: [
    { indexed: true, name: "id", type: "string" },
    { indexed: false, name: "status", type: "string" },
  ],
};

// Constants
const PLOT_TYPES = {
  LAND: "LAND",
  SEED: "SEED",
  PRODUCT: "PRODUCT",
  LOAN: "LOAN",
  STAKE: "STAKE",
} as const;

type PlotType = keyof typeof PLOT_TYPES;

const PLOT_CONFIG: Record<PlotType, { geometry: () => THREE.BufferGeometry; color: number; radius: number }> = {
  [PLOT_TYPES.LAND]: {
    geometry: () => new THREE.BoxGeometry(0.6, 0.6, 0.6),
    color: 0x8b4513,
    radius: 10.2,
  },
  [PLOT_TYPES.SEED]: {
    geometry: () => new THREE.SphereGeometry(0.4, 32, 16),
    color: 0x00ff00,
    radius: 10.4,
  },
  [PLOT_TYPES.PRODUCT]: {
    geometry: () => new THREE.ConeGeometry(0.3, 0.6, 32),
    color: 0xff4500,
    radius: 10.6,
  },
  [PLOT_TYPES.LOAN]: {
    geometry: () => new THREE.CylinderGeometry(0.3, 0.3, 0.6, 32),
    color: 0x4169e1,
    radius: 10.7,
  },
  [PLOT_TYPES.STAKE]: {
    geometry: () => new THREE.TetrahedronGeometry(0.3),
    color: 0xffd700,
    radius: 10.8,
  },
};

// Utility Functions
const addJitter = (value: number, maxJitter: number = 0.5): number => {
  return value + (Math.random() - 0.5) * maxJitter;
};

const fetchMetadataWithRetry = async (uri: string, retries = 3, delay = 1000): Promise<Metadata | undefined> => {
  for (let i = 0; i < retries; i++) {
    try {
      return await getMetadata(uri);
    } catch (error) {
      if (i < retries - 1) {
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
      console.warn(`Failed to fetch metadata for URI ${uri} after ${retries} attempts:`, error);
      return undefined;
    }
  }
};

// Parse blockchain errors
function parseBlockchainError(message: string): string {
  if (message.includes('User rejected')) return 'Transaction rejected by user.';
  if (message.includes('InvalidCollateralValue')) return 'Collateral value must be a positive number.';
  if (message.includes('LandNotActive')) return 'Land is not active.';
  if (message.includes('Unauthorized')) return 'You are not authorized to perform this action.';
  if (message.includes('Pausable: paused')) return 'Contract is paused.';
  if (message.includes('InsufficientPayment')) return 'Payment amount is less than collateral value.';
  if (message.includes('InvalidMessageLength')) return 'Message must be between 1 and 500 characters.';
  if (message.includes('InvalidLeaseDuration')) return 'Lease duration must be between 1 and 365 days.';
  if (message.includes('InvalidLeasePrice')) return 'Lease price must be positive.';
  if (message.includes('LandAlreadyLeased')) return 'Land is currently leased.';
  if (message.includes('LeaseNotExpired')) return 'Lease has not yet expired.';
  if (message.includes('Insufficient allowance')) return 'Insufficient allowance. Please approve the required WEEDL amount.';
  if (message.includes('InvalidListingType')) return 'This listing is not available for this action.';
  if (message.includes('InvalidPaginationParameters')) return 'No active listings available or invalid pagination parameters.';
  if (message.includes('InvalidPrice')) return 'Price must be at least 0.0001 WEEDL.';
  if (message.includes('ProductIdInUse')) return 'Product ID is already in use.';
  if (message.includes('InvalidUnitQuantity')) return 'Unit quantity must be 1, 10, 50, or 100.';
  if (message.includes('CORS')) return 'CORS policy error: Blockchain provider does not allow requests from localhost. Consider using a proxy server or configuring provider CORS settings.';
  return message || 'Unknown error occurred.';
}

// Throttle refetch function to prevent excessive retries
const throttleRefetch = throttle((refetch: () => void) => {
  refetch();
}, 5000); // Throttle refetch to every 5 seconds

export default function VirtualLandShowcase({ address }: { address: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const globeRef = useRef<THREE.Mesh>(null);
  const plotsRef = useRef<THREE.Object3D[]>([]);
  const [enrichedListings, setEnrichedListings] = useState<EnrichedListing[]>([]);
  const [enrichedSeeds, setEnrichedSeeds] = useState<EnrichedSeed[]>([]);
  const [enrichedProducts, setEnrichedProducts] = useState<EnrichedProduct[]>([]);
  const [enrichedLoans, setEnrichedLoans] = useState<EnrichedLoan[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isCorsError, setIsCorsError] = useState<boolean>(false);

  // Fetch total listings to determine if getUserListingsPaginated should be called
  const { data: totalListingsData, error: totalListingsError, refetch: refetchTotalListings } = useReadContract({
    address: GreenFiLand.address as `0x${string}`,
    abi: GreenFiLand.abi as Abi,
    functionName: "getTotalActiveListings",
    query: {
      enabled: !!address,
      refetchInterval: isCorsError ? false : 10000,
      retry: 2,
      retryDelay: 2000,
    },
  }) as { data: bigint | undefined; error: Error | null; refetch: () => void };

  // Contract data fetching with polling interval configuration
  const { data: landData, error: landError, refetch: refetchLandData } = useReadContract({
    address: GreenFiLand.address as `0x${string}`,
    abi: GreenFiLand.abi as Abi,
    functionName: "getUserListingsPaginated",
    args: address && totalListingsData && totalListingsData > 0n
      ? [address as `0x${string}`, BigInt(0), BigInt(10)]
      : [address as `0x${string}`, BigInt(0), BigInt(1)], // Fallback to minimal pageSize to avoid revert
    query: {
      enabled: !!address && !!totalListingsData && totalListingsData > 0n, // Only enable if there are listings
      refetchInterval: isCorsError ? false : 10000, // Disable polling on CORS error
      retry: 2,
      retryDelay: 2000,
    },
  }) as { data: [LandListing[], bigint] | undefined; error: Error | null; refetch: () => void };

  const { data: loanData, error: loanError, refetch: refetchLoanData } = useReadContract({
    address: GreenFiLoan.address as `0x${string}`,
    abi: GreenFiLoan.abi as Abi,
    functionName: "getAllLoans",
    query: {
      enabled: !!address,
      refetchInterval: isCorsError ? false : 10000,
      retry: 2,
      retryDelay: 2000,
    },
  }) as { data: Loan[] | undefined; error: Error | null; refetch: () => void };

  const { data: productData, error: productError, refetch: refetchProductData } = useReadContract({
    address: GreenFiProducts.address as `0x${string}`,
    abi: GreenFiProducts.abi as Abi,
    functionName: "getAllProducts",
    query: {
      enabled: !!address,
      refetchInterval: isCorsError ? false : 10000,
      retry: 2,
      retryDelay: 2000,
    },
  }) as { data: ProductListing[] | undefined; error: Error | null; refetch: () => void };

  const { data: seedData, error: seedError, refetch: refetchSeedData } = useReadContract({
    address: GreenFiSeed.address as `0x${string}`,
    abi: GreenFiSeed.abi as Abi,
    functionName: "getAllSeeds",
    query: {
      enabled: !!address,
      refetchInterval: isCorsError ? false : 10000,
      retry: 2,
      retryDelay: 2000,
    },
  }) as { data: SeedListing[] | undefined; error: Error | null; refetch: () => void };

  const { data: stakeData, error: stakeError, refetch: refetchStakeData } = useReadContract({
    address: GreenFiStaking.address as `0x${string}`,
    abi: GreenFiStaking.abi as Abi,
    functionName: "getUserStakes",
    args: [address as `0x${string}`],
    query: {
      enabled: !!address,
      refetchInterval: isCorsError ? false : 10000,
      retry: 2,
      retryDelay: 2000,
    },
  }) as { data: Staking[] | undefined; error: Error | null; refetch: () => void };

  // Handle totalListingsData
  useEffect(() => {
    if (totalListingsError) {
      setError(parseBlockchainError(totalListingsError.message));
      toast.error(parseBlockchainError(totalListingsError.message));
      console.error('Total listings error:', totalListingsError);
    } else if (totalListingsData !== undefined) {
      if (totalListingsData === 0n) {
        setEnrichedListings([]);
        setError('No active land listings available for your address.');
        toast.info('No active land listings available for your address.');
      }
    }
  }, [totalListingsData, totalListingsError]);

  // Event listeners for contract updates
  useWatchContractEvent({
    address: GreenFiLand.address as `0x${string}`,
    abi: [landListedEventAbi],
    eventName: "LandListed",
    onLogs(logs) {
      const log = logs[0] as { args: { owner?: string; id?: string } };
      if (log.args.owner?.toLowerCase() === address?.toLowerCase()) {
        throttleRefetch(refetchLandData);
        throttleRefetch(refetchTotalListings);
        toast.success("New land listed in your showcase!");
      }
    },
    poll: !isCorsError,
  });

  useWatchContractEvent({
    address: GreenFiLand.address as `0x${string}`,
    abi: [landDelistedEventAbi],
    eventName: "LandDelisted",
    onLogs(logs) {
      const log = logs[0] as { args: { owner?: string; id?: string } };
      if (log.args.owner?.toLowerCase() === address?.toLowerCase()) {
        throttleRefetch(refetchLandData);
        throttleRefetch(refetchTotalListings);
        toast.success("Land removed from your showcase!");
      }
    },
    poll: !isCorsError,
  });

  useWatchContractEvent({
    address: GreenFiLand.address as `0x${string}`,
    abi: [collateralUpdatedEventAbi],
    eventName: "CollateralUpdated",
    onLogs(logs) {
      const log = logs[0] as { args: { owner?: string; id?: string } };
      if (log.args.owner?.toLowerCase() === address?.toLowerCase()) {
        throttleRefetch(refetchLandData);
        toast.success("Land collateral updated in your showcase!");
      }
    },
    poll: !isCorsError,
  });

  useWatchContractEvent({
    address: GreenFiSeed.address as `0x${string}`,
    abi: [seedListedEventAbi],
    eventName: "SeedListed",
    onLogs(logs) {
      const log = logs[0] as { args: { seller?: string; seedId?: string } };
      if (log.args.seller?.toLowerCase() === address?.toLowerCase()) {
        throttleRefetch(refetchSeedData);
        toast.success("New seed listed in your showcase!");
      }
    },
    poll: !isCorsError,
  });

  useWatchContractEvent({
    address: GreenFiSeed.address as `0x${string}`,
    abi: [seedDelistedEventAbi],
    eventName: "SeedDelisted",
    onLogs(logs) {
      const log = logs[0] as { args: { seller?: string; seedId?: string } };
      if (log.args.seller?.toLowerCase() === address?.toLowerCase()) {
        throttleRefetch(refetchSeedData);
        toast.success("Seed removed from your showcase!");
      }
    },
    poll: !isCorsError,
  });

  useWatchContractEvent({
    address: GreenFiProducts.address as `0x${string}`,
    abi: [productListedEventAbi],
    eventName: "ProductListed",
    onLogs(logs) {
      const log = logs[0] as { args: { seller?: string; productId?: string } };
      if (log.args.seller?.toLowerCase() === address?.toLowerCase()) {
        throttleRefetch(refetchProductData);
        toast.success("New product listed in your showcase!");
      }
    },
    poll: !isCorsError,
  });

  useWatchContractEvent({
    address: GreenFiProducts.address as `0x${string}`,
    abi: [productDelistedEventAbi],
    eventName: "ProductDelisted",
    onLogs(logs) {
      const log = logs[0] as { args: { seller?: string; productId?: string } };
      if (log.args.seller?.toLowerCase() === address?.toLowerCase()) {
        throttleRefetch(refetchProductData);
        toast.success("Product removed from your showcase!");
      }
    },
    poll: !isCorsError,
  });

  useWatchContractEvent({
    address: GreenFiStaking.address as `0x${string}`,
    abi: [stakedEventAbi],
    eventName: "Staked",
    onLogs(logs) {
      const log = logs[0] as { args: { user?: string; uuid?: string } };
      if (log.args.user?.toLowerCase() === address?.toLowerCase()) {
        throttleRefetch(refetchStakeData);
        toast.success("New stake added to your showcase!");
      }
    },
    poll: !isCorsError,
  });

  useWatchContractEvent({
    address: GreenFiStaking.address as `0x${string}`,
    abi: [unstakedEventAbi],
    eventName: "Unstaked",
    onLogs(logs) {
      const log = logs[0] as { args: { user?: string; uuid?: string } };
      if (log.args.user?.toLowerCase() === address?.toLowerCase()) {
        throttleRefetch(refetchStakeData);
        toast.success("Stake removed from your showcase!");
      }
    },
    poll: !isCorsError,
  });

  useWatchContractEvent({
    address: GreenFiStaking.address as `0x${string}`,
    abi: [rewardClaimedEventAbi],
    eventName: "RewardClaimed",
    onLogs(logs) {
      const log = logs[0] as { args: { user?: string; uuid?: string } };
      if (log.args.user?.toLowerCase() === address?.toLowerCase()) {
        throttleRefetch(refetchStakeData);
        toast.success("Stake reward claimed in your showcase!");
      }
    },
    poll: !isCorsError,
  });

  useWatchContractEvent({
    address: GreenFiStaking.address as `0x${string}`,
    abi: [stakeResetEventAbi],
    eventName: "StakeReset",
    onLogs(logs) {
      const log = logs[0] as { args: { user?: string; uuid?: string } };
      if (log.args.user?.toLowerCase() === address?.toLowerCase()) {
        throttleRefetch(refetchStakeData);
        toast.success("Stake reset in your showcase!");
      }
    },
    poll: !isCorsError,
  });

  useWatchContractEvent({
    address: GreenFiLoan.address as `0x${string}`,
    abi: [loanCreatedEventAbi],
    eventName: "LoanCreated",
    onLogs(logs) {
      const log = logs[0] as { args: { grower?: string; id?: string } };
      if (log.args.grower?.toLowerCase() === address?.toLowerCase()) {
        throttleRefetch(refetchLoanData);
        toast.success("New loan listed in your showcase!");
      }
    },
    poll: !isCorsError,
  });

  useWatchContractEvent({
    address: GreenFiLoan.address as `0x${string}`,
    abi: [loanFundedEventAbi],
    eventName: "LoanFunded",
    onLogs(logs) {
      const log = logs[0] as { args: { grower?: string; id?: string } };
      if (log.args.grower?.toLowerCase() === address?.toLowerCase()) {
        throttleRefetch(refetchLoanData);
        toast.success("Loan funded in your showcase!");
      }
    },
    poll: !isCorsError,
  });

  useWatchContractEvent({
    address: GreenFiLoan.address as `0x${string}`,
    abi: [loanRepaidEventAbi],
    eventName: "LoanRepaid",
    onLogs(logs) {
      const log = logs[0] as { args: { grower?: string; id?: string } };
      if (log.args.grower?.toLowerCase() === address?.toLowerCase()) {
        throttleRefetch(refetchLoanData);
        toast.success("Loan repaid in your showcase!");
      }
    },
    poll: !isCorsError,
  });

  useWatchContractEvent({
    address: GreenFiLoan.address as `0x${string}`,
    abi: [loanCanceledEventAbi],
    eventName: "LoanCanceled",
    onLogs(logs) {
      const log = logs[0] as { args: { grower?: string; id?: string } };
      if (log.args.grower?.toLowerCase() === address?.toLowerCase()) {
        throttleRefetch(refetchLoanData);
        toast.success("Loan canceled in your showcase!");
      }
    },
    poll: !isCorsError,
  });

  useWatchContractEvent({
    address: GreenFiLoan.address as `0x${string}`,
    abi: [collateralClaimedEventAbi],
    eventName: "CollateralClaimed",
    onLogs(logs) {
      const log = logs[0] as { args: { lender?: string; id?: string } };
      if (log.args.lender?.toLowerCase() === address?.toLowerCase()) {
        throttleRefetch(refetchLoanData);
        toast.success("Collateral claimed for loan in your showcase!");
      }
    },
    poll: !isCorsError,
  });

  useWatchContractEvent({
    address: GreenFiLoan.address as `0x${string}`,
    abi: [loanStatusChangedEventAbi],
    eventName: "LoanStatusChanged",
    onLogs(logs) {
      const log = logs[0] as { args: { id?: string } };
      if (enrichedLoans.some((loan: EnrichedLoan) => loan.id === log.args.id && loan.grower.toLowerCase() === address?.toLowerCase())) {
        throttleRefetch(refetchLoanData);
        toast.success(`Loan status updated in your showcase!`);
      }
    },
    poll: !isCorsError,
  });

  // Enhanced Error Handling
  useEffect(() => {
    const errors = [
      { error: landError, message: "Failed to fetch land listings", refetch: refetchLandData },
      { error: loanError, message: "Failed to fetch loan data", refetch: refetchLoanData },
      { error: productError, message: "Failed to fetch product listings", refetch: refetchProductData },
      { error: seedError, message: "Failed to fetch seed listings", refetch: refetchSeedData },
      { error: stakeError, message: "Failed to fetch stake listings", refetch: refetchStakeData },
    ];

    let hasCorsError = false;
    errors.forEach(({ error, message, refetch }) => {
      if (error) {
        const errorMessage = parseBlockchainError(error.message);
        console.error(`${message}:`, error);
        setError(`${message}: ${errorMessage}`);
        if (error.message.includes("CORS")) {
          hasCorsError = true;
          toast.error(`${message}: ${errorMessage}`, {
            position: "top-center",
            autoClose: 10000,
            style: { backgroundColor: "#ff4444", color: "#fff" },
          });
        } else if (error.message.includes("InvalidPaginationParameters")) {
          setEnrichedListings([]);
          setError('No active land listings available for your address.');
          toast.info('No active land listings available for your address.');
        } else {
          toast.error(`${message}: ${errorMessage}`, {
            position: "top-center",
            autoClose: 5000,
            style: { backgroundColor: "#ff4444", color: "#fff" },
          });
        }
        if (refetch) throttleRefetch(refetch);
      }
    });
    setIsCorsError(hasCorsError);
  }, [landError, loanError, productError, seedError, stakeError, refetchLandData, refetchLoanData, refetchProductData, refetchSeedData, refetchStakeData]);

  // Data loading with memoization
  const loadData = useMemo(
    () => ({
      async loadListings() {
        if (!landData || !landData[0]) return [];
        try {
          const listings = landData[0];
          const enriched = await Promise.all(
            listings
              .filter((listing: LandListing) => listing.isActive && listing.owner.toLowerCase() === address.toLowerCase())
              .map(async (listing: LandListing): Promise<EnrichedListing | null> => {
                const metadata = await fetchMetadataWithRetry(listing.metadataURI);
                return metadata ? { ...listing, metadata } : null;
              })
          );
          return enriched.filter((l): l is EnrichedListing => l !== null);
        } catch (error) {
          console.error("Land listings error:", error);
          toast.error("Error loading land listings.");
          return [];
        }
      },

      async loadSeeds() {
        if (!seedData) return [];
        try {
          const enriched = await Promise.all(
            seedData
              .filter((seed: SeedListing) => seed.isActive && seed.seller.toLowerCase() === address.toLowerCase())
              .map(async (seed: SeedListing): Promise<EnrichedSeed | null> => {
                const metadata = await fetchMetadataWithRetry(seed.metadataURI);
                return { ...seed, metadata };
              })
          );
          return enriched.filter((s): s is EnrichedSeed => s !== null);
        } catch (error) {
          console.error("Seed listings error:", error);
          toast.error("Error loading seed listings.");
          return [];
        }
      },

      async loadProducts() {
        if (!productData) return [];
        try {
          const enriched = await Promise.all(
            productData
              .filter((product: ProductListing) => product.isActive && product.seller.toLowerCase() === address.toLowerCase())
              .map(async (product: ProductListing): Promise<EnrichedProduct | null> => {
                const metadata = await fetchMetadataWithRetry(product.metadataURI);
                return { ...product, metadata };
              })
          );
          return enriched.filter((p): p is EnrichedProduct => p !== null) as EnrichedProduct[];
        } catch (error) {
          console.error("Product listings error:", error);
          toast.error("Error loading product listings.");
          return [];
        }
      },

      async loadLoans() {
        if (!loanData) return [];
        try {
          const enriched = await Promise.all(
            loanData
              .filter((loan: Loan) => loan.isActive && loan.grower.toLowerCase() === address.toLowerCase())
              .map(async (loan: Loan): Promise<EnrichedLoan | null> => {
                const metadata = undefined; // No metadataURI in CannabisLoan struct
                return { ...loan, metadata };
              })
          );
          return enriched.filter((l): l is EnrichedLoan => l !== null) as EnrichedLoan[];
        } catch (error) {
          console.error("Loan listings error:", error);
          toast.error("Error loading loan listings.");
          return [];
        }
      },

      async loadStakes() {
        if (!stakeData) return [];
        try {
          return stakeData.filter((stake: Staking) => stake.isActive && stake.user.toLowerCase() === address.toLowerCase());
        } catch (error) {
          console.error("Stake listings error:", error);
          toast.error("Error loading stake listings.");
          return [];
        }
      },
    }),
    [landData, seedData, productData, loanData, stakeData, address]
  );

  useEffect(() => {
    Promise.all([
      loadData.loadListings().then(setEnrichedListings),
      loadData.loadSeeds().then(setEnrichedSeeds),
      loadData.loadProducts().then((products) => setEnrichedProducts(products as EnrichedProduct[])),
      loadData.loadLoans().then((loans) => setEnrichedLoans(loans as EnrichedLoan[])),
      loadData.loadStakes(),
    ])
      .then(() => setIsLoading(false))
      .catch((error) => {
        setError(parseBlockchainError(error.message));
        toast.error("Error initializing 3D scene.");
        console.error("Load error:", error);
        setIsLoading(false);
      });
  }, [loadData]);

  // 3D Scene Setup
  useEffect(() => {
    const canvas = canvasRef.current;
    const tooltip = tooltipRef.current;
    if (!canvas || !tooltip) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000011);

    const camera = new THREE.PerspectiveCamera(75, window.innerWidth / 600, 0.1, 1000);
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setSize(window.innerWidth, 600);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.minDistance = 12;
    controls.maxDistance = 50;

    const starGeometry = new THREE.BufferGeometry();
    const starMaterial = new THREE.PointsMaterial({ color: 0xffffff, size: 0.1 });
    const starVertices = new Float32Array(1000 * 3).map(() => (Math.random() - 0.5) * 200);
    starGeometry.setAttribute("position", new THREE.Float32BufferAttribute(starVertices, 3));
    scene.add(new THREE.Points(starGeometry, starMaterial));

    const globeGeometry = new THREE.SphereGeometry(10, 32, 32);
    let globeMaterial: THREE.MeshPhongMaterial;
    try {
      const globeTexture = new THREE.TextureLoader().load("/textures/8k_earth_daymap.png", (texture) => {
        texture.flipY = false;
        texture.colorSpace = THREE.SRGBColorSpace;
      });
      globeMaterial = new THREE.MeshPhongMaterial({ map: globeTexture, shininess: 50, emissive: 0x112244, emissiveIntensity: 0.2 });
    } catch (error) {
      console.warn("Using fallback material:", error);
      globeMaterial = new THREE.MeshPhongMaterial({ color: 0x1a3c5a, shininess: 50, emissive: 0x112244, emissiveIntensity: 0.2 });
    }
    const globe = new THREE.Mesh(globeGeometry, globeMaterial);
    globeRef.current = globe;
    scene.add(globe);

    const atmosphereGeometry = new THREE.SphereGeometry(10.2, 32, 32);
    const atmosphereMaterial = new THREE.ShaderMaterial({
      uniforms: { glowColor: { value: new THREE.Color(0x66aaff) }, intensity: { value: 0.5 } },
      vertexShader: `
        varying vec3 vNormal;
        void main() {
          vNormal = normalize(normalMatrix * normal);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 glowColor;
        uniform float intensity;
        varying vec3 vNormal;
        void main() {
          float glow = pow(1.0 - dot(vNormal, vec3(0, 0, 1)), 2.0) * intensity;
          gl_FragColor = vec4(glowColor * glow, glow);
        }
      `,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      transparent: true,
    });
    scene.add(new THREE.Mesh(atmosphereGeometry, atmosphereMaterial));

    scene.add(new THREE.HemisphereLight(0xaaaaaa, 0x444444, 0.8));
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1.2);
    directionalLight.position.set(15, 20, 15);
    directionalLight.castShadow = true;
    directionalLight.shadow.mapSize.set(1024, 1024);
    scene.add(directionalLight);

    const plots: THREE.Object3D[] = [];
    plotsRef.current = plots;

    const addPlots = async <T extends EnrichedListing | EnrichedSeed | EnrichedProduct | EnrichedLoan | Staking>(
      items: T[],
      type: PlotType,
      getTooltip: (item: T, loanData?: Loan[], productData?: ProductListing[]) => string,
      getCoordinates: (item: T) => { lat: number; lon: number }
    ) => {
      if (!items.length) {
        console.log(`No ${type} to add`);
        return;
      }

      const config = PLOT_CONFIG[type];
      const geometry = config.geometry();
      const material = new THREE.MeshPhongMaterial({ color: config.color, specular: 0x555555, shininess: 30 });
      const instancedMesh = new THREE.InstancedMesh(geometry, material, items.length);
      const dummy = new THREE.Object3D();
      let instanceIndex = 0;

      for (const item of items) {
        const { lat, lon } = getCoordinates(item);
        if (isNaN(lat) || isNaN(lon)) {
          console.warn(`Skipping ${type} due to invalid coordinates: lat=${lat}, lon=${lon}`);
          continue;
        }

        const jitteredLat = addJitter(lat, 0.5);
        const jitteredLon = addJitter(lon, 0.5);
        const phi = (90 - jitteredLat) * (Math.PI / 180);
        const theta = (jitteredLon + 180) * (Math.PI / 180);
        dummy.position.set(
          config.radius * Math.sin(phi) * Math.cos(theta),
          config.radius * Math.cos(phi),
          config.radius * Math.sin(phi) * Math.sin(theta)
        );
        dummy.lookAt(0, 0, 0);
        dummy.updateMatrix();
        instancedMesh.setMatrixAt(instanceIndex, dummy.matrix);

        instancedMesh.userData[instanceIndex] = {
          [type.toLowerCase()]: item,
          tooltip: getTooltip(item, loanData, productData),
        } as PlotUserData;
        instanceIndex++;
      }

      if (instanceIndex > 0) {
        instancedMesh.count = instanceIndex;
        scene.add(instancedMesh);
        plots.push(instancedMesh);
        console.log(`Added ${instanceIndex} ${type} to scene`);
      }
    };

    const addLandListings = () =>
      addPlots<EnrichedListing>(
        enrichedListings,
        PLOT_TYPES.LAND,
        (listing) => {
          const loan = loanData?.find((l: Loan) => l.id === listing.loanId && l.isActive);
          return `
            <strong>Land ID:</strong> ${sanitizeHTML(listing.id)}<br>
            <strong>Owner:</strong> ${sanitizeHTML(listing.owner)}<br>
            <strong>Collateral:</strong> ${(Number(listing.collateralValue) / 1e18).toFixed(4)} WEEDL<br>
            <strong>Location:</strong> (${sanitizeHTML(listing.metadata.latitude || "N/A")}, ${sanitizeHTML(listing.metadata.longitude || "N/A")})<br>
            <strong>Description:</strong> ${sanitizeHTML(listing.metadata.description || "No description available")}<br>
            ${listing.metadata.size ? `<strong>Size:</strong> ${sanitizeHTML(listing.metadata.size)}<br>` : ""}
            ${listing.metadata.zoning ? `<strong>Zoning:</strong> ${sanitizeHTML(listing.metadata.zoning)}<br>` : ""}
            ${listing.metadata.utilities ? `<strong>Utilities:</strong> ${sanitizeHTML(listing.metadata.utilities)}<br>` : ""}
            ${loan ? `<strong>Loan:</strong> ${(Number(loan.amount) / 1e18).toFixed(4)} WEEDL, Duration: ${(Number(loan.duration) / 86400).toFixed(0)} days, Purpose: ${sanitizeHTML(loan.growPurpose)}<br>` : ""}
            <button class="google-maps-btn" data-lat="${sanitizeHTML(listing.metadata.latitude || "0")}" data-lon="${sanitizeHTML(listing.metadata.longitude || "0")}">View on Google Maps</button>
          `;
        },
        (listing) => ({
          lat: parseFloat(listing.metadata.latitude || "0"),
          lon: parseFloat(listing.metadata.longitude || "0"),
        })
      );

    const addSeedListings = () =>
      addPlots<EnrichedSeed>(
        enrichedSeeds,
        PLOT_TYPES.SEED,
        (seed) => `
          <strong>Seed ID:</strong> ${sanitizeHTML(seed.id)}<br>
          <strong>Seller:</strong> ${sanitizeHTML(seed.seller)}<br>
          <strong>Strain:</strong> ${sanitizeHTML(seed.metadata?.strainType || seed.metadata?.strain || seed.strain || "N/A")}<br>
          <strong>Price:</strong> ${(Number(seed.price) / 1e18).toFixed(4)} WEEDL<br>
          <strong>Pack Size:</strong> ${sanitizeHTML(String(seed.packSize))}<br>
          <strong>Pack Quantity:</strong> ${sanitizeHTML(String(seed.packQuantity))}<br>
          ${seed.discount > 0 ? `<strong>Discount:</strong> ${Number(seed.discount)}%` : ""}
          ${seed.metadata?.description ? `<strong>Description:</strong> ${sanitizeHTML(seed.metadata.description)}<br>` : ""}
        `,
        (seed) => ({
          lat: parseFloat(seed.metadata?.latitude || String(Math.random() * 180 - 90)),
          lon: parseFloat(seed.metadata?.longitude || String(Math.random() * 360 - 180)),
        })
      );

    const addProductListings = () =>
      addPlots<EnrichedProduct>(
        enrichedProducts,
        PLOT_TYPES.PRODUCT,
        (product) => `
          <strong>Product ID:</strong> ${sanitizeHTML(product.id)}<br>
          <strong>Seller:</strong> ${sanitizeHTML(product.seller)}<br>
          <strong>Category:</strong> ${sanitizeHTML(product.metadata?.category || product.category || "N/A")}<br>
          <strong>Price:</strong> ${(Number(product.price) / 1e18).toFixed(4)} WEEDL<br>
          <strong>Unit Quantity:</strong> ${sanitizeHTML(String(product.unitQuantity))}<br>
          <strong>Quantity Available:</strong> ${sanitizeHTML(String(product.quantityAvailable))}<br>
          ${product.discount > 0 ? `<strong>Discount:</strong> ${Number(product.discount)}%` : ""}
          ${product.metadata?.description ? `<strong>Description:</strong> ${sanitizeHTML(product.metadata.description)}<br>` : ""}
          ${product.metadata?.latitude && product.metadata?.longitude ? `<strong>Location:</strong> (${sanitizeHTML(product.metadata.latitude)}, ${sanitizeHTML(product.metadata.longitude)})<br>` : ""}
          ${product.metadata?.latitude && product.metadata?.longitude ? `<button class="google-maps-btn" data-lat="${sanitizeHTML(product.metadata.latitude)}" data-lon="${sanitizeHTML(product.metadata.longitude)}">View on Google Maps</button>` : ""}
        `,
        (product) => ({
          lat: parseFloat(product.metadata?.latitude || String(Math.random() * 180 - 90)),
          lon: parseFloat(product.metadata?.longitude || String(Math.random() * 360 - 180)),
        })
      );

    const addLoanListings = () =>
      addPlots<EnrichedLoan>(
        enrichedLoans,
        PLOT_TYPES.LOAN,
        (loan) => `
          <strong>Loan ID:</strong> ${sanitizeHTML(loan.id)}<br>
          <strong>Grower:</strong> ${sanitizeHTML(loan.grower)}<br>
          <strong>Amount:</strong> ${(Number(loan.amount) / 1e18).toFixed(4)} WEEDL<br>
          <strong>Fee:</strong> ${(Number(loan.fee) / 1e18).toFixed(4)} WEEDL<br>
          <strong>Duration:</strong> ${(Number(loan.duration) / 86400).toFixed(0)} days<br>
          <strong>Interest Rate:</strong> ${(Number(loan.interestRate) / 100).toFixed(2)}% APR<br>
          <strong>Purpose:</strong> ${sanitizeHTML(loan.growPurpose || "N/A")}<br>
          <strong>Contact:</strong> ${sanitizeHTML(loan.contactInfo || "N/A")}<br>
          <strong>Collateral Amount:</strong> ${(Number(loan.collateralAmount) / 1e18).toFixed(4)} WEEDL<br>
          <strong>Status:</strong> ${sanitizeHTML(loan.status)}<br>
          <strong>Created At:</strong> ${new Date(Number(loan.createdAt) * 1000).toLocaleString()}<br>
          ${loan.lender !== "0x0000000000000000000000000000000000000000" ? `<strong>Lender:</strong> ${sanitizeHTML(loan.lender)}<br>` : ""}
          ${loan.repaidAmount > 0 ? `<strong>Repaid Amount:</strong> ${(Number(loan.repaidAmount) / 1e18).toFixed(4)} WEEDL<br>` : ""}
          <button class="google-maps-btn" data-lat="${sanitizeHTML(loan.metadata?.latitude || "0")}" data-lon="${sanitizeHTML(loan.metadata?.longitude || "0")}">View on Google Maps</button>
        `,
        (loan) => ({
          lat: parseFloat(loan.metadata?.latitude || String(Math.random() * 180 - 90)),
          lon: parseFloat(loan.metadata?.longitude || String(Math.random() * 360 - 180)),
        })
      );

    const addStakeListings = () =>
      addPlots<Staking>(
        stakeData || [],
        PLOT_TYPES.STAKE,
        (stake) => {
          const isMatured = Number(stake.startTime + stake.duration) <= Math.floor(Date.now() / 1000);
          return `
            <strong>Stake UUID:</strong> ${sanitizeHTML(stake.uuid)}<br>
            <strong>User:</strong> ${sanitizeHTML(stake.user)}<br>
            <strong>Amount:</strong> ${(Number(stake.amount) / 1e18).toFixed(4)} WEEDL<br>
            <strong>Start Time:</strong> ${new Date(Number(stake.startTime) * 1000).toLocaleString()}<br>
            <strong>Duration:</strong> ${(Number(stake.duration) / 86400).toFixed(0)} days<br>
            <strong>Reward Debt:</strong> ${(Number(stake.rewardDebt) / 1e18).toFixed(4)} WEEDL<br>
            <strong>Status:</strong> ${stake.isActive ? "Active" : "Inactive"}<br>
            <strong>Maturity:</strong> ${isMatured ? "Matured" : `Matures on ${new Date(Number(stake.startTime + stake.duration) * 1000).toLocaleString()}`}
          `;
        },
        () => ({
          lat: Math.random() * 180 - 90,
          lon: Math.random() * 360 - 180,
        })
      );

    const addPlaceholderPlots = () => {
      if (enrichedListings.length || enrichedSeeds.length || enrichedProducts.length || enrichedLoans.length || (stakeData && stakeData.length)) return;
      const geometry = new THREE.BoxGeometry(0.5, 0.5, 0.5);
      const material = new THREE.MeshPhongMaterial({ color: 0x666666, specular: 0x555555, shininess: 30 });
      for (let i = 0; i < 3; i++) {
        const plot = new THREE.Mesh(geometry, material);
        const lat = addJitter(Math.random() * 180 - 90, 0.5);
        const lon = addJitter(Math.random() * 360 - 180, 0.5);
        const phi = (90 - lat) * (Math.PI / 180);
        const theta = (lon + 180) * (Math.PI / 180);
        plot.position.set(10.2 * Math.sin(phi) * Math.cos(theta), 10.2 * Math.cos(phi), 10.2 * Math.sin(phi) * Math.sin(theta));
        plot.lookAt(0, 0, 0);
        plot.userData = { tooltip: "No assets found for your address." } as PlotUserData;
        scene.add(plot);
        plots.push(plot);
      }
      console.log("Added placeholder plots");
    };

    camera.position.set(0, 15, 25);
    camera.lookAt(0, 0, 0);

    const raycaster = new Raycaster();
    const mouse = new Vector2();
    const onMouseMove = throttle((event: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(mouse, camera);
      const intersects = raycaster.intersectObjects(plots, true);

      if (intersects.length > 0) {
        const intersect = intersects[0].object as THREE.Mesh | InstancedMesh;
        const instanceId = intersects[0].instanceId;
        const userData = instanceId !== undefined ? intersect.userData[instanceId] : intersect.userData;
        if (userData?.tooltip) {
          tooltip.style.display = "block";
          tooltip.style.left = `${event.clientX + 10}px`;
          tooltip.style.top = `${event.clientY + 10}px`;
          tooltip.innerHTML = userData.tooltip;

          const buttons = tooltip.querySelectorAll(".google-maps-btn");
          buttons.forEach((button) => {
            button.addEventListener("click", () => {
              const lat = button.getAttribute("data-lat") || "0";
              const lon = button.getAttribute("data-lon") || "0";
              if (!isNaN(parseFloat(lat)) && !isNaN(parseFloat(lon))) {
                window.open(`https://www.google.com/maps?q=${encodeURIComponent(lat)},${encodeURIComponent(lon)}`, "_blank", "noopener,noreferrer");
              } else {
                toast.error("Invalid coordinates for Google Maps.");
              }
            });
          });
        }
      } else {
        tooltip.style.display = "none";
      }
    }, 100);

    canvas.addEventListener("mousemove", onMouseMove);

    const handleResize = () => {
      const width = window.innerWidth;
      const height = 600;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    };
    window.addEventListener("resize", handleResize);

    let animationId: number;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          animationId = requestAnimationFrame(animate);
        } else {
          cancelAnimationFrame(animationId);
        }
      },
      { threshold: 0 }
    );
    observer.observe(canvas);

    const animate = (currentTime: number) => {
      controls.update();
      if (globeRef.current) {
        globeRef.current.rotation.y += 0.002;
      }
      plotsRef.current.forEach((plot) => {
        if (plot instanceof THREE.InstancedMesh) {
          const dummy = new THREE.Object3D();
          for (let i = 0; i < plot.count; i++) {
            plot.getMatrixAt(i, dummy.matrix);
            dummy.matrix.decompose(dummy.position, dummy.quaternion, dummy.scale);
            dummy.scale.setScalar(1 + 0.1 * Math.sin(currentTime * 0.001 + i));
            dummy.updateMatrix();
            plot.setMatrixAt(i, dummy.matrix);
          }
          plot.instanceMatrix.needsUpdate = true;
        }
      });
      renderer.render(scene, camera);
      animationId = requestAnimationFrame(animate);
    };

    Promise.all([
      addLandListings(),
      addSeedListings(),
      addProductListings(),
      addLoanListings(),
      addStakeListings(),
      addPlaceholderPlots(),
    ])
      .then(() => {
        console.log("All plots added successfully");
        setIsLoading(false);
      })
      .catch((error) => {
        setError(parseBlockchainError(error.message));
        toast.error("Error adding 3D plots.");
        console.error("Error adding plots:", error);
        setIsLoading(false);
      });

    return () => {
      canvas.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("resize", handleResize);
      observer.disconnect();
      cancelAnimationFrame(animationId);
      controls.dispose();
      renderer.dispose();
      scene.clear();
    };
  }, [enrichedListings, enrichedSeeds, enrichedProducts, enrichedLoans, stakeData, loanData, productData, address]);

  return (
    <div style={{ position: "relative" }}>
      {isLoading && (
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            color: "#fff",
            fontSize: "16px",
            backgroundColor: "rgba(0,0,0,0.75)",
            padding: "10px",
            borderRadius: "4px",
            zIndex: 10,
            display: "flex",
            alignItems: "center",
            gap: "8px",
          }}
          role="alert"
          aria-label="Loading 3D Scene"
        >
          <div
            style={{
              border: "2px solid #fff",
              borderTop: "2px solid transparent",
              borderRadius: "50%",
              width: "16px",
              height: "16px",
              animation: "spin 1s linear infinite",
            }}
          />
          Loading 3D Scene...
        </div>
      )}
      {error && (
        <div
          style={{
            position: "absolute",
            top: "10px",
            left: "50%",
            transform: "translateX(-50%)",
            color: "#ff4444",
            fontSize: "14px",
            backgroundColor: "rgba(0,0,0,0.75)",
            padding: "10px",
            borderRadius: "4px",
            zIndex: 10,
          }}
          role="alert"
          aria-label="Error"
        >
          {error}
        </div>
      )}
      <canvas
        ref={canvasRef}
        style={{ width: "100%", height: "600px", display: "block" }}
        role="img"
        aria-label="3D Globe Visualization of Land, Seed, Product, Loan, and Stake Listings"
      />
      <div
        ref={tooltipRef}
        style={{
          position: "fixed",
          backgroundColor: "rgba(0,0,0,0.85)",
          color: "#fff",
          padding: "12px",
          borderRadius: "6px",
          fontSize: "14px",
          maxWidth: "320px",
          display: "none",
          zIndex: 10,
          whiteSpace: "normal",
          boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
          transition: "opacity 0.2s ease-in-out",
        }}
        role="tooltip"
      />
      <style>
        {`
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
          .google-maps-btn {
            margin-top: 8px;
            padding: 6px 12px;
            background-color: #1a73e8;
            color: white;
            border: none;
            borderRadius: 4px;
            cursor: pointer;
            transition: background-color 0.2s;
          }
          .google-maps-btn:hover {
            background-color: #1557b0;
          }
        `}
      </style>
    </div>
  );
}