import { useState, useEffect, ReactNode, Component } from "react";
import { useReadContract, useWriteContract, useWaitForTransactionReceipt, useEstimateGas, useAccount } from "wagmi";
import { encodeFunctionData, formatEther } from "viem";
import { GreenFiSeed, WEEDL } from "../config/contracts";
import { getMetadata } from "../utils/metadata";
import { sanitizeHTML } from "../utils/security";

// Define the props interface for SeedListings
interface SeedListingsProps {
  address?: `0x${string}`; // Optional Ethereum address
}

interface Seed {
  id: string;
  seller: string;
  metadataURI: string;
  strain: string;
  price: bigint;
  packSize: number;
  packQuantity: number;
  discount: bigint;
  isActive: boolean;
  contactInfo: string;
  metadata?: {
    name?: string;
    description?: string;
    image?: string;
    contact?: string;
    disclaimer?: string;
    packSize?: number;
    packQuantity?: number;
    discount?: number;
    strainType?: string;
  };
}

class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; error: Error | undefined }> {
  state = { hasError: false, error: undefined };

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <p>
          Something went wrong while displaying seed packs: {(this.state.error as unknown as Error)?.message || "Unknown error"}. Please try again.
        </p>
      );
    }
    return this.props.children;
  }
}

// Update the SeedListings component to accept props
export default function SeedListings({ address: propAddress }: SeedListingsProps) {
  const [seeds, setSeeds] = useState<Seed[]>([]);
  const [filteredSeeds, setFilteredSeeds] = useState<Seed[]>([]);
  const [selectedSeed, setSelectedSeed] = useState<Seed | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [transactionHash, setTransactionHash] = useState<`0x${string}` | undefined>(undefined);
  const [currentPage, setCurrentPage] = useState(1);
  const [filters, setFilters] = useState({
    strain: "",
    minPrice: "",
    maxPrice: "",
    minPackQuantity: "",
    packSize: "",
  });
  const [sortBy, setSortBy] = useState<"priceAsc" | "priceDesc" | "none">("none");
  const seedsPerPage = 10;

  // Use useAccount to get the connected wallet address (optional for purchasing)
  const { address: accountAddress } = useAccount();
  const address = propAddress || accountAddress; // Use propAddress if provided, fallback to accountAddress

  // Fetch all active seeds using getAllSeeds
  const { data: seedData } = useReadContract({
    address: GreenFiSeed.address as `0x${string}`,
    abi: GreenFiSeed.abi,
    functionName: "getAllSeeds",
  }) as { data: Seed[] | undefined };

  // Fetch balance only if address is available
  const { data: balance } = useReadContract({
    address: WEEDL.address as `0x${string}`,
    abi: WEEDL.abi,
    functionName: "balanceOf",
    args: [address ?? "0x0"], // Use fallback if address is undefined
    query: { enabled: !!address },
  }) as { data: bigint | undefined };

  const { data: writeData, error: writeError } = useWriteContract();
  const { error: txError, isSuccess: isConfirmed } = useWaitForTransactionReceipt({ hash: transactionHash });

  async function loadMetadata(metadataURI: string) {
    try {
      const validUri = metadataURI.startsWith("ipfs://") ? metadataURI : `ipfs://${metadataURI}`;
      const metadata = await getMetadata(validUri);
      return metadata;
    } catch (error) {
      console.error("Error fetching metadata for URI:", metadataURI, error);
      return undefined;
    }
  }

  useEffect(() => {
    async function fetchMetadata() {
      setLoading(true);
      setError(null);
      try {
        if (seedData) {
          const metadataPromises = (seedData as Seed[]).map(async (seed) => ({
            ...seed,
            metadata: await loadMetadata(seed.metadataURI),
          }));
          const seedsWithMetadata = await Promise.all(metadataPromises);
          setSeeds(seedsWithMetadata.filter((seed) => seed.isActive && seed.metadata?.description));
        } else {
          setSeeds([]);
        }
      } catch (error) {
        setError("Failed to fetch seed pack metadata.");
        console.error("Fetch error:", error);
        setSeeds([]);
      } finally {
        setLoading(false);
      }
    }
    fetchMetadata();
  }, [seedData]);

  useEffect(() => {
    const sortedSeeds = [...seeds].sort((a, b) => {
      if (sortBy === "priceAsc") return Number(a.price - b.price);
      if (sortBy === "priceDesc") return Number(b.price - a.price);
      return 0;
    });
    setFilteredSeeds(
      sortedSeeds.filter((seed) => {
        const price = Number(formatEther(seed.price));
        const strain = seed.metadata?.strainType || seed.strain || "";
        return (
          (!filters.strain || strain.toLowerCase().includes(filters.strain.toLowerCase())) &&
          (!filters.minPrice || price >= Number(filters.minPrice)) &&
          (!filters.maxPrice || price <= Number(filters.maxPrice)) &&
          (!filters.minPackQuantity || seed.packQuantity >= Number(filters.minPackQuantity)) &&
          (!filters.packSize || seed.packSize === Number(filters.packSize))
        );
      })
    );
  }, [seeds, filters, sortBy]);

  useEffect(() => {
    if (writeData && !transactionHash) {
      setTransactionHash(writeData);
      console.log("Transaction Hash:", writeData);
    }
  }, [writeData, transactionHash]);

  useEffect(() => {
    if (writeError) {
      setError(writeError.message || "Transaction failed.");
      console.error("Transaction error:", writeError);
      setTransactionHash(undefined);
    }
    if (txError) {
      setError(txError.message || "Transaction confirmation failed.");
      console.error("Transaction confirmation error:", txError);
      setTransactionHash(undefined);
    }
    if (isConfirmed && transactionHash) {
      setSuccess(`Transaction successful! Check Sepolia Etherscan: https://sepolia.etherscan.io/tx/${transactionHash}`);
      console.log("Transaction confirmed:", transactionHash);
      setTransactionHash(undefined);
    }
  }, [writeError, txError, isConfirmed, transactionHash]);

  const indexOfLastSeed = currentPage * seedsPerPage;
  const indexOfFirstSeed = indexOfLastSeed - seedsPerPage;
  const currentSeeds = filteredSeeds.slice(indexOfFirstSeed, indexOfLastSeed);
  const totalPages = Math.ceil(filteredSeeds.length / seedsPerPage);

  return (
    <ErrorBoundary>
      <div className="filters">
        <input
          type="text"
          placeholder="Filter by strain"
          value={filters.strain}
          onChange={(e) => setFilters({ ...filters, strain: e.target.value })}
          className="action-input"
          aria-label="Filter by strain"
        />
        <input
          type="number"
          placeholder="Min Price per Pack (WEEDL)"
          value={filters.minPrice}
          onChange={(e) => setFilters({ ...filters, minPrice: e.target.value })}
          className="action-input"
          aria-label="Minimum Price per Pack"
        />
        <input
          type="number"
          placeholder="Max Price per Pack (WEEDL)"
          value={filters.maxPrice}
          onChange={(e) => setFilters({ ...filters, maxPrice: e.target.value })}
          className="action-input"
          aria-label="Maximum Price per Pack"
        />
        <input
          type="number"
          placeholder="Min Number of Packs"
          value={filters.minPackQuantity}
          onChange={(e) => setFilters({ ...filters, minPackQuantity: e.target.value })}
          className="action-input"
          aria-label="Minimum Number of Packs"
        />
        <select
          value={filters.packSize}
          onChange={(e) => setFilters({ ...filters, packSize: e.target.value })}
          className="action-input"
          aria-label="Filter by Pack Size"
        >
          <option value="">All Pack Sizes</option>
          {[3, 5, 10].map((size) => (
            <option key={size} value={size}>
              {size} Seeds per Pack
            </option>
          ))}
        </select>
        <select
          onChange={(e) => setSortBy(e.target.value as "priceAsc" | "priceDesc" | "none")}
          className="action-input"
          aria-label="Sort Options"
        >
          <option value="none">Sort By</option>
          <option value="priceAsc">Price: Low to High</option>
          <option value="priceDesc">Price: High to Low</option>
        </select>
      </div>
      <div className="grid" role="grid" aria-label="Grid of Seed Pack Listings">
        {error && <p className="error-message" role="alert">{error}</p>}
        {success && <p className="success-message" role="alert">{success}</p>}
        {loading ? (
          <p>Loading seed pack listings...</p>
        ) : currentSeeds.length > 0 ? (
          currentSeeds.map((seed) => (
            <SeedItem
              key={seed.id}
              seed={seed}
              address={address ?? "0x0"} // Provide fallback for address
              balance={balance}
              onSelect={() => setSelectedSeed(seed)}
              setTransactionHash={setTransactionHash}
            />
          ))
        ) : (
          <p>No active seed packs available.</p>
        )}
        <div className="pagination">
          <button
            onClick={() => setCurrentPage((p) => Math.max(p - 1, 1))}
            disabled={currentPage === 1}
            className="action-button"
            aria-label="Previous Page"
          >
            Previous
          </button>
          <span aria-label="Current Page Info">
            Page {currentPage} of {totalPages}
          </span>
          <button
            onClick={() => setCurrentPage((p) => Math.min(p + 1, totalPages))}
            disabled={currentPage === totalPages}
            className="action-button"
            aria-label="Next Page"
          >
            Next
          </button>
        </div>
        {selectedSeed && (
          <SeedModal
            seed={selectedSeed}
            address={address ?? "0x0"} // Provide fallback for address
            balance={balance}
            onClose={() => setSelectedSeed(null)}
            setTransactionHash={setTransactionHash}
          />
        )}
      </div>
    </ErrorBoundary>
  );
}

function SeedItem({
  seed,
  address,
  balance,
  onSelect,
  setTransactionHash,
}: {
  seed: Seed;
  address: string; // Changed to string to match usage, but ensured safe handling
  balance: bigint | undefined;
  onSelect: () => void;
  setTransactionHash: (hash: `0x${string}` | undefined) => void;
}) {
  const [purchasePackQuantity, setPurchasePackQuantity] = useState(1);
  const [showConfirm, setShowConfirm] = useState(false);
  const { writeContract, isPending } = useWriteContract();
  const { data: purchaseGasEstimate } = useEstimateGas({
    account: address as `0x${string}`,
    to: GreenFiSeed.address as `0x${string}`,
    data: encodeFunctionData({
      abi: GreenFiSeed.abi,
      functionName: "purchaseSeed",
      args: [seed.id, purchasePackQuantity],
    }),
    query: { enabled: !!address && address !== "0x0" },
  });

  const totalPurchaseCost = () => {
    const priceWei = seed.price * BigInt(purchasePackQuantity);
    const greenFiFee = (priceWei * BigInt(420)) / BigInt(100000);
    const total = priceWei + greenFiFee;
    return Number(formatEther(total)).toFixed(4);
  };

  const canPurchase = (() => {
    if (!address || address === "0x0") return false; // No wallet connected
    if (balance === undefined || purchasePackQuantity <= 0 || purchasePackQuantity > seed.packQuantity) {
      console.log("Cannot purchase: Invalid balance or quantity", {
        balance,
        purchasePackQuantity,
        packQuantity: seed.packQuantity,
      });
      return false;
    }
    const priceWei = seed.price * BigInt(purchasePackQuantity);
    const greenFiFee = (priceWei * BigInt(420)) / BigInt(100000);
    const totalCost = priceWei + greenFiFee;
    const canAfford = balance >= totalCost;
    console.log("Can purchase check:", {
      balance: Number(balance) / 1e18,
      totalCost: Number(totalCost) / 1e18,
      canAfford,
    });
    return canAfford;
  })();

  const handlePurchase = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!address || address === "0x0") {
      alert("Please connect your wallet to purchase.");
      return;
    }
    setShowConfirm(true);
  };

  const confirmPurchase = () => {
    console.log("Confirming purchase:", { seedId: seed.id, purchasePackQuantity });
    writeContract({
      address: GreenFiSeed.address as `0x${string}`,
      abi: GreenFiSeed.abi,
      functionName: "purchaseSeed",
      args: [seed.id, purchasePackQuantity],
      gas: purchaseGasEstimate ? purchaseGasEstimate + BigInt(10000) : BigInt(500000),
      account: address as `0x${string}`,
    });
    setShowConfirm(false);
    setTransactionHash(undefined);
  };

  const handleDelist = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!address || address === "0x0") {
      alert("Please connect your wallet to delist.");
      return;
    }
    console.log("Delisting seed:", seed.id);
    writeContract({
      address: GreenFiSeed.address as `0x${string}`,
      abi: GreenFiSeed.abi,
      functionName: "delistSeed",
      args: [seed.id],
      gas: BigInt(100000),
      account: address as `0x${string}`,
    });
    setTransactionHash(undefined);
  };

  const displayPrice = Number(formatEther(seed.price)).toFixed(4);
  const discountPrice = seed.discount
    ? Number(displayPrice) * (1 - Number(seed.discount) / 100)
    : Number(displayPrice);

  return (
    <div
      className="description-item grid-item"
      onClick={onSelect}
      role="row"
      style={{ cursor: "pointer" }}
      aria-label={`Seed Pack Listing: ${sanitizeHTML(seed.id)}`}
    >
      <p className="disclaimer">Disclaimer: Please verify the authenticity of this seed pack before purchasing.</p>
      <p>Seed ID: {sanitizeHTML(seed.id)}</p>
      <p>Strain: {sanitizeHTML(seed.metadata?.strainType || seed.strain || "N/A")}</p>
      <p>
        Price per Pack: {discountPrice.toFixed(4)} WEEDL
        {seed.discount > 0 && (
          <span> ({Number(seed.discount)}% off from {displayPrice} WEEDL)</span>
        )}
      </p>
      <p>Total Cost: {totalPurchaseCost()} WEEDL (includes 0.420% fee)</p>
      <p>Pack Size: {sanitizeHTML(seed.packSize.toString())} seeds per pack</p>
      <p>Packs Available: {sanitizeHTML(seed.packQuantity.toString())}</p>
      <p>Total Seeds: {sanitizeHTML((seed.packSize * seed.packQuantity).toString())}</p>
      {seed.metadata && (
        <>
          <p>Name: {sanitizeHTML(seed.metadata.name || "N/A")}</p>
          <p>Description: {sanitizeHTML(seed.metadata.description || "N/A")}</p>
          <p>Contact Info: {sanitizeHTML(seed.metadata.contact || seed.contactInfo || "N/A")}</p>
          {seed.metadata.image && (
            <img
              src={sanitizeHTML(seed.metadata.image || "/fallback-seed-image.png")}
              alt={sanitizeHTML(seed.metadata.name || "Seed Pack Image")}
              className="seed-image"
              onError={(e) => (e.currentTarget.src = "/fallback-seed-image.png")}
              loading="lazy"
            />
          )}
        </>
      )}
      {address && seed.seller.toLowerCase() !== address.toLowerCase() && (
        <>
          <div className="input-group">
            <input
              type="number"
              value={purchasePackQuantity}
              onChange={(e) => {
                const value = Number(e.target.value);
                if (value > 0 && value <= seed.packQuantity) setPurchasePackQuantity(value);
              }}
              min="1"
              max={seed.packQuantity}
              className="action-input"
              aria-label="Purchase Pack Quantity"
            />
          </div>
          <button
            onClick={handlePurchase}
            disabled={isPending || seed.packQuantity <= 0 || !canPurchase}
            className="action-button"
            aria-label={`Purchase seed pack ${sanitizeHTML(seed.id)}`}
          >
            {isPending
              ? "Purchasing..."
              : seed.packQuantity <= 0
                ? "Sold Out"
                : !canPurchase
                  ? "Insufficient Balance"
                  : "Purchase Seed Pack"}
          </button>
          {showConfirm && (
            <div className="modal" role="dialog" aria-label="Purchase Confirmation">
              <div className="modal-content">
                <p>
                  Confirm purchase of {purchasePackQuantity} pack(s) ({purchasePackQuantity * seed.packSize} seeds) of{" "}
                  {sanitizeHTML(seed.metadata?.strainType || seed.strain || "N/A")} for {totalPurchaseCost()} WEEDL?
                </p>
                <button onClick={confirmPurchase} className="action-button" aria-label="Confirm Purchase">
                  Confirm
                </button>
                <button
                  onClick={() => setShowConfirm(false)}
                  className="action-button"
                  aria-label="Cancel Purchase"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </>
      )}
      {address && seed.seller.toLowerCase() === address.toLowerCase() && (
        <button
          onClick={handleDelist}
          disabled={isPending}
          className="action-button"
          aria-label={`Delist seed pack ${sanitizeHTML(seed.id)}`}
        >
          {isPending ? "Delisting..." : "Delist Seed Pack"}
        </button>
      )}
      {!address && (
        <p className="connect-wallet-message">Please connect your wallet to purchase or delist.</p>
      )}
    </div>
  );
}

function SeedModal({
  seed,
  address,
  balance,
  onClose,
  setTransactionHash,
}: {
  seed: Seed;
  address: string; // Changed to string to match usage, but ensured safe handling
  balance: bigint | undefined;
  onClose: () => void;
  setTransactionHash: (hash: `0x${string}` | undefined) => void;
}) {
  const [purchasePackQuantity, setPurchasePackQuantity] = useState(1);
  const [showConfirm, setShowConfirm] = useState(false);
  const { writeContract, isPending } = useWriteContract();
  const { data: purchaseGasEstimate } = useEstimateGas({
    account: address as `0x${string}`,
    to: GreenFiSeed.address as `0x${string}`,
    data: encodeFunctionData({
      abi: GreenFiSeed.abi,
      functionName: "purchaseSeed",
      args: [seed.id, purchasePackQuantity],
    }),
    query: { enabled: !!address && address !== "0x0" },
  });

  const totalPurchaseCost = () => {
    const priceWei = seed.price * BigInt(purchasePackQuantity);
    const greenFiFee = (priceWei * BigInt(420)) / BigInt(100000);
    const total = priceWei + greenFiFee;
    return Number(formatEther(total)).toFixed(4);
  };

  const canPurchase = (() => {
    if (!address || address === "0x0") return false; // No wallet connected
    if (balance === undefined || purchasePackQuantity <= 0 || purchasePackQuantity > seed.packQuantity) {
      console.log("Cannot purchase: Invalid balance or quantity", {
        balance,
        purchasePackQuantity,
        packQuantity: seed.packQuantity,
      });
      return false;
    }
    const priceWei = seed.price * BigInt(purchasePackQuantity);
    const greenFiFee = (priceWei * BigInt(420)) / BigInt(100000);
    const totalCost = priceWei + greenFiFee;
    const canAfford = balance >= totalCost;
    console.log("Can purchase check:", {
      balance: Number(balance) / 1e18,
      totalCost: Number(totalCost) / 1e18,
      canAfford,
    });
    return canAfford;
  })();

  const handlePurchase = () => {
    if (!address || address === "0x0") {
      alert("Please connect your wallet to purchase.");
      return;
    }
    setShowConfirm(true);
  };

  const confirmPurchase = () => {
    console.log("Confirming purchase:", { seedId: seed.id, purchasePackQuantity });
    writeContract({
      address: GreenFiSeed.address as `0x${string}`,
      abi: GreenFiSeed.abi,
      functionName: "purchaseSeed",
      args: [seed.id, purchasePackQuantity],
      gas: purchaseGasEstimate ? purchaseGasEstimate + BigInt(10000) : BigInt(500000),
      account: address as `0x${string}`,
    });
    setShowConfirm(false);
    setTransactionHash(undefined);
  };

  const handleDelist = () => {
    if (!address || address === "0x0") {
      alert("Please connect your wallet to delist.");
      return;
    }
    console.log("Delisting seed:", seed.id);
    writeContract({
      address: GreenFiSeed.address as `0x${string}`,
      abi: GreenFiSeed.abi,
      functionName: "delistSeed",
      args: [seed.id],
      gas: BigInt(100000),
      account: address as `0x${string}`,
    });
    setTransactionHash(undefined);
  };

  const displayPrice = Number(formatEther(seed.price)).toFixed(4);
  const discountPrice = seed.discount
    ? Number(displayPrice) * (1 - Number(seed.discount) / 100)
    : Number(displayPrice);

  return (
    <div className="modal" role="dialog" aria-label="Seed Pack Listing Details Modal">
      <div className="modal-content">
        <button className="modal-close" onClick={onClose} aria-label="Close modal">
          ×
        </button>
        <h3>Seed Pack Listing Details</h3>
        <p className="disclaimer">Disclaimer: Please verify the authenticity of this listing before engaging.</p>
        <p>Seed ID: {sanitizeHTML(seed.id)}</p>
        <p>Strain: {sanitizeHTML(seed.metadata?.strainType || seed.strain || "N/A")}</p>
        <p>
          Price per Pack: {discountPrice.toFixed(4)} WEEDL
          {seed.discount > 0 && (
            <span> ({Number(seed.discount)}% off from {displayPrice} WEEDL)</span>
          )}
        </p>
        <p>Total Cost: {totalPurchaseCost()} WEEDL (includes 0.420% fee)</p>
        <p>Pack Size: {sanitizeHTML(seed.packSize.toString())} seeds per pack</p>
        <p>Packs Available: {sanitizeHTML(seed.packQuantity.toString())}</p>
        <p>Total Seeds: {sanitizeHTML((seed.packSize * seed.packQuantity).toString())}</p>
        <p>Seller: {sanitizeHTML(seed.seller)}</p>
        {seed.metadata && (
          <>
            <p>Name: {sanitizeHTML(seed.metadata.name || "N/A")}</p>
            <p>Description: {sanitizeHTML(seed.metadata.description || "N/A")}</p>
            <p>Contact Info: {sanitizeHTML(seed.metadata.contact || seed.contactInfo || "N/A")}</p>
            <p>Disclaimer: {sanitizeHTML(seed.metadata.disclaimer || "Please verify the authenticity of this listing.")}</p>
            {seed.metadata.image && (
              <img
                src={sanitizeHTML(seed.metadata.image || "/fallback-seed-image.png")}
                alt={sanitizeHTML(seed.metadata.name || "Seed Pack Image")}
                className="seed-image"
                onError={(e) => (e.currentTarget.src = "/fallback-seed-image.png")}
                loading="lazy"
              />
            )}
          </>
        )}
        {address && seed.seller.toLowerCase() !== address.toLowerCase() && (
          <>
            <div className="input-group">
              <input
                type="number"
                value={purchasePackQuantity}
                onChange={(e) => {
                  const value = Number(e.target.value);
                  if (value > 0 && value <= seed.packQuantity) setPurchasePackQuantity(value);
                }}
                min="1"
                max={seed.packQuantity}
                className="action-input"
                aria-label="Purchase Pack Quantity"
              />
            </div>
            <button
              onClick={handlePurchase}
              disabled={isPending || seed.packQuantity <= 0 || !canPurchase}
              className="action-button"
              aria-label="Purchase Seed Pack"
            >
              {isPending
                ? "Purchasing..."
                : seed.packQuantity <= 0
                  ? "Sold Out"
                  : !canPurchase
                    ? "Insufficient Balance"
                    : "Purchase Seed Pack"}
            </button>
            {showConfirm && (
              <div className="modal" role="dialog" aria-label="Purchase Confirmation">
                <div className="modal-content">
                  <p>
                    Confirm purchase of {purchasePackQuantity} pack(s) ({purchasePackQuantity * seed.packSize} seeds) of{" "}
                    {sanitizeHTML(seed.metadata?.strainType || seed.strain || "N/A")} for {totalPurchaseCost()} WEEDL?
                  </p>
                  <button onClick={confirmPurchase} className="action-button" aria-label="Confirm Purchase">
                    Confirm
                  </button>
                  <button
                    onClick={() => setShowConfirm(false)}
                    className="action-button"
                    aria-label="Cancel Purchase"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </>
        )}
        {address && seed.seller.toLowerCase() === address.toLowerCase() && (
          <button
            onClick={handleDelist}
            disabled={isPending}
            className="action-button"
            aria-label="Delist Seed Pack"
          >
            {isPending ? "Delisting..." : "Delist Seed Pack"}
          </button>
        )}
        {!address && (
          <p className="connect-wallet-message">Please connect your wallet to purchase or delist.</p>
        )}
      </div>
    </div>
  );
}