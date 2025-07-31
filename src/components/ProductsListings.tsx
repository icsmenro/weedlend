import { useState, useEffect, ReactNode, Component } from "react";
import { useReadContract, useWriteContract, useWaitForTransactionReceipt, useAccount } from "wagmi";
import { formatEther, parseEther } from "viem";
import { GreenFiProducts, WEEDL } from "../config/contracts";
import { Metadata, getMetadata } from "../utils/metadata";
import { sanitizeHTML } from "../utils/security";
import { toast } from "react-toastify";

// Define the props interface for ProductsListings
interface ProductsListingsProps {
  address?: `0x${string}`; // Optional Ethereum address
}

interface Product {
  id: string;
  seller: string;
  metadataURI: string;
  category: string;
  price: bigint;
  unitQuantity: number;
  quantityAvailable: number;
  discount: bigint;
  isActive: boolean;
  contactInfo: string;
  metadata?: Metadata; // Use Metadata type from ../utils/metadata
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
          Something went wrong while displaying products: {(this.state.error as unknown as Error)?.message || "Unknown error"}. Please try again.
        </p>
      );
    }
    return this.props.children;
  }
}

function parseBlockchainError(message: string): string {
  if (message.includes("User rejected")) return "Transaction rejected by user.";
  if (message.includes("Pausable: paused")) return "Contract is paused.";
  if (message.includes("InsufficientPayment")) return "Payment amount is insufficient.";
  if (message.includes("Insufficient allowance")) return "Insufficient allowance. Please approve the required WEEDL amount.";
  if (message.includes("InvalidProduct")) return "Product is not active or does not exist.";
  if (message.includes("InvalidQuantity")) return "Invalid purchase quantity.";
  return message || "Unknown error occurred.";
}

export default function ProductsListings({ address: propAddress }: ProductsListingsProps) {
  const [products, setProducts] = useState<Product[]>([]);
  const [filteredProducts, setFilteredProducts] = useState<Product[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [transactionHash, setTransactionHash] = useState<`0x${string}` | undefined>(undefined);
  const [currentPage, setCurrentPage] = useState(1);
  const [filters, setFilters] = useState({
    category: "",
    minPrice: "",
    maxPrice: "",
    minQuantityAvailable: "",
    unitQuantity: "",
  });
  const [sortBy, setSortBy] = useState<"priceAsc" | "priceDesc" | "none">("none");
  const productsPerPage = 10;

  const { address: accountAddress } = useAccount();
  const address = propAddress || accountAddress;

  const { data: productData, refetch: refetchProductData } = useReadContract({
    address: GreenFiProducts.address as `0x${string}`,
    abi: GreenFiProducts.abi,
    functionName: "getAllProducts",
    query: { refetchInterval: 30000 },
  }) as { data: Product[] | undefined; refetch: () => void };

  const { data: balance } = useReadContract({
    address: WEEDL.address as `0x${string}`,
    abi: WEEDL.abi,
    functionName: "balanceOf",
    args: [address ?? "0x0"],
    query: { enabled: !!address },
  }) as { data: bigint | undefined };

  const { data: isPaused } = useReadContract({
    address: GreenFiProducts.address as `0x${string}`,
    abi: GreenFiProducts.abi,
    functionName: "paused",
    query: { refetchInterval: 30000 },
  }) as { data: boolean | undefined };

  async function loadMetadata(metadataURI: string): Promise<Metadata | undefined> {
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
        if (productData) {
          const metadataPromises = (productData as Product[]).map(async (product) => ({
            ...product,
            metadata: await loadMetadata(product.metadataURI),
          }));
          const productsWithMetadata = await Promise.all(metadataPromises);
          setProducts(productsWithMetadata.filter((product) => product.isActive && product.metadata?.description));
        } else {
          setProducts([]);
        }
      } catch (error) {
        setError("Failed to fetch product metadata.");
        console.error("Fetch error:", error);
        setProducts([]);
      } finally {
        setLoading(false);
      }
    }
    fetchMetadata();
  }, [productData]);

  useEffect(() => {
    const sortedProducts = [...products].sort((a, b) => {
      if (sortBy === "priceAsc") return Number(a.price - b.price);
      if (sortBy === "priceDesc") return Number(b.price - a.price);
      return 0;
    });
    setFilteredProducts(
      sortedProducts.filter((product) => {
        const price = Number(formatEther(product.price)); // Price in WEEDL (e.g., 0.5)
        const priceInWei = product.price; // Price in Wei (e.g., 0.5 * 10^18)
        const category = product.metadata?.category || product.category || "";
        const minPrice = filters.minPrice ? parseEther(filters.minPrice) : BigInt(0);
        const maxPrice = filters.maxPrice ? parseEther(filters.maxPrice) : BigInt(2n ** 256n - 1n);
        return (
          (!filters.category || category.toLowerCase().includes(filters.category.toLowerCase())) &&
          (!filters.minPrice || priceInWei >= minPrice) &&
          (!filters.maxPrice || priceInWei <= maxPrice) &&
          (!filters.minQuantityAvailable || product.quantityAvailable >= Number(filters.minQuantityAvailable)) &&
          (!filters.unitQuantity || product.unitQuantity === Number(filters.unitQuantity)) &&
          price > 0 // Ensure price is used in filtering (e.g., exclude invalid prices)
        );
      })
    );
  }, [products, filters, sortBy]);

  useEffect(() => {
    if (transactionHash && success) {
      setSuccess(`Transaction successful! Check Sepolia Etherscan: https://sepolia.etherscan.io/tx/${transactionHash}`);
      setTransactionHash(undefined);
      refetchProductData();
    }
  }, [transactionHash, success, refetchProductData]);

  const indexOfLastProduct = currentPage * productsPerPage;
  const indexOfFirstProduct = indexOfLastProduct - productsPerPage;
  const currentProducts = filteredProducts.slice(indexOfFirstProduct, indexOfLastProduct);
  const totalPages = Math.ceil(filteredProducts.length / productsPerPage);

  return (
    <ErrorBoundary>
      <div className="filters">
        <input
          type="text"
          placeholder="Filter by category (e.g., Oils, Edibles)"
          value={filters.category}
          onChange={(e) => setFilters({ ...filters, category: e.target.value })}
          className="action-input"
          aria-label="Filter by category"
        />
        <input
          type="number"
          placeholder="Min Price per Unit (WEEDL)"
          value={filters.minPrice}
          onChange={(e) => setFilters({ ...filters, minPrice: e.target.value })}
          className="action-input"
          aria-label="Minimum Price per Unit"
        />
        <input
          type="number"
          placeholder="Max Price per Unit (WEEDL)"
          value={filters.maxPrice}
          onChange={(e) => setFilters({ ...filters, maxPrice: e.target.value })}
          className="action-input"
          aria-label="Maximum Price per Unit"
        />
        <input
          type="number"
          placeholder="Min Quantity Available"
          value={filters.minQuantityAvailable}
          onChange={(e) => setFilters({ ...filters, minQuantityAvailable: e.target.value })}
          className="action-input"
          aria-label="Minimum Quantity Available"
        />
        <select
          value={filters.unitQuantity}
          onChange={(e) => setFilters({ ...filters, unitQuantity: e.target.value })}
          className="action-input"
          aria-label="Filter by Unit Quantity"
        >
          <option value="">All Unit Quantities</option>
          {[1, 10, 50, 100].map((size) => (
            <option key={size} value={size}>
              {size} Units
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
      <div className="grid" role="grid" aria-label="Grid of Product Listings">
        {error && <p className="error-message" role="alert">{error}</p>}
        {success && <p className="success-message" role="alert">{success}</p>}
        {loading ? (
          <p>Loading product listings...</p>
        ) : currentProducts.length > 0 ? (
          currentProducts.map((product) => (
            <ProductItem
              key={product.id}
              product={product}
              address={address ?? "0x0"}
              balance={balance}
              onSelect={() => setSelectedProduct(product)}
              setTransactionHash={setTransactionHash}
              setError={setError}
              setSuccess={setSuccess}
              isPaused={isPaused}
            />
          ))
        ) : (
          <p>No active products available.</p>
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
        {selectedProduct && (
          <ProductModal
            product={selectedProduct}
            address={address ?? "0x0"}
            balance={balance}
            onClose={() => setSelectedProduct(null)}
            setTransactionHash={setTransactionHash}
            setError={setError}
            setSuccess={setSuccess}
            isPaused={isPaused}
          />
        )}
      </div>
    </ErrorBoundary>
  );
}

function ProductItem({
  product,
  address,
  balance,
  onSelect,
  setTransactionHash,
  setError,
  setSuccess,
  isPaused,
}: {
  product: Product;
  address: string;
  balance: bigint | undefined;
  onSelect: () => void;
  setTransactionHash: (hash: `0x${string}` | undefined) => void;
  setError: (error: string | null) => void;
  setSuccess: (success: string | null) => void;
  isPaused: boolean | undefined;
}) {
  const [purchaseQuantity, setPurchaseQuantity] = useState(1);
  const [transactionStep, setTransactionStep] = useState<"none" | "approving" | "purchasing" | "delisting">("none");
  const [approvalHash, setApprovalHash] = useState<`0x${string}` | undefined>();
  const [actionHash, setActionHash] = useState<`0x${string}` | undefined>();
  const [popup, setPopup] = useState<{ message: string; visible: boolean }>({ message: "", visible: false });

  const { writeContract, isPending, error: writeError, data } = useWriteContract();
  const { isLoading: isApprovalConfirming, isSuccess: isApprovalConfirmed, error: approvalError } = useWaitForTransactionReceipt({ hash: approvalHash });
  const { isLoading: isActionConfirming, isSuccess: isActionConfirmed, error: actionError } = useWaitForTransactionReceipt({ hash: actionHash });

  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: WEEDL.address as `0x${string}`,
    abi: WEEDL.abi,
    functionName: "allowance",
    args: [address || "0x0" as `0x${string}`, GreenFiProducts.address as `0x${string}`],
    query: { refetchInterval: 30000, enabled: !!address && address !== "0x0" },
  }) as { data: bigint | undefined; refetch: () => void };

  const showPopup = (message: string) => {
    setPopup({ message, visible: true });
    setTimeout(() => setPopup({ message: "", visible: false }), 3000);
  };

  useEffect(() => {
    if (writeError) {
      const errorMessage = parseBlockchainError(writeError.message);
      setError(errorMessage);
      showPopup(errorMessage);
      toast.error(errorMessage);
      setTransactionStep("none");
    }
    if (approvalError) {
      const errorMessage = parseBlockchainError(approvalError.message);
      setError(errorMessage);
      showPopup(errorMessage);
      toast.error(errorMessage);
      setTransactionStep("none");
    }
    if (actionError) {
      const errorMessage = parseBlockchainError(actionError.message);
      setError(errorMessage);
      showPopup(errorMessage);
      toast.error(errorMessage);
      setTransactionStep("none");
    }
    if (isActionConfirmed && actionHash) {
      const successMsg =
        transactionStep === "purchasing"
          ? `Successfully purchased ${purchaseQuantity} unit(s) of product ${product.id}`
          : `Successfully delisted product ${product.id}`;
      setSuccess(successMsg);
      showPopup(successMsg);
      toast.success(successMsg);
      setPurchaseQuantity(1);
      setApprovalHash(undefined);
      setActionHash(undefined);
      setTransactionHash(actionHash);
      setTransactionStep("none");
      refetchAllowance();
    }
  }, [writeError, approvalError, actionError, isActionConfirmed, actionHash, transactionStep, purchaseQuantity, product.id, setError, setSuccess, setTransactionHash, refetchAllowance]);

  useEffect(() => {
    if (data && transactionStep === "approving" && !approvalHash) {
      setApprovalHash(data);
      showPopup("Approval transaction submitted!");
      toast.info("Approval transaction submitted!");
    } else if (data && (transactionStep === "purchasing" || transactionStep === "delisting") && !actionHash) {
      setActionHash(data);
      showPopup(transactionStep === "purchasing" ? "Purchase transaction submitted!" : "Delist transaction submitted!");
      toast.info(transactionStep === "purchasing" ? "Purchase transaction submitted!" : "Delist transaction submitted!");
    }
  }, [data, transactionStep, approvalHash, actionHash]);

  const totalPurchaseCostWei = () => {
    const priceWei = product.price * BigInt(purchaseQuantity);
    const greenFiFee = (priceWei * BigInt(420)) / BigInt(100000);
    return priceWei + greenFiFee;
  };

  const totalPurchaseCost = () => {
    return Number(formatEther(totalPurchaseCostWei())).toFixed(4);
  };

  const handlePurchase = () => {
    if (!address || address === "0x0") {
      setError("Please connect your wallet to purchase.");
      showPopup("Please connect your wallet to purchase.");
      toast.error("Please connect your wallet to purchase.");
      return;
    }
    if (isPaused) {
      setError("Cannot purchase: Contract is paused.");
      showPopup("Cannot purchase: Contract is paused.");
      toast.error("Cannot purchase: Contract is paused.");
      return;
    }
    if (purchaseQuantity <= 0 || purchaseQuantity > product.quantityAvailable) {
      setError(`Purchase quantity must be between 1 and ${product.quantityAvailable}.`);
      showPopup(`Purchase quantity must be between 1 and ${product.quantityAvailable}.`);
      toast.error(`Purchase quantity must be between 1 and ${product.quantityAvailable}.`);
      return;
    }
    const totalCost = totalPurchaseCostWei();
    if (balance && balance < totalCost) {
      setError(`Insufficient WEEDL balance. Need ${totalPurchaseCost()} WEEDL.`);
      showPopup(`Insufficient WEEDL balance. Need ${totalPurchaseCost()} WEEDL.`);
      toast.error(`Insufficient WEEDL balance. Need ${totalPurchaseCost()} WEEDL.`);
      return;
    }
    if (!allowance || allowance < totalCost) {
      setTransactionStep("approving");
      writeContract({
        address: WEEDL.address as `0x${string}`,
        abi: WEEDL.abi,
        functionName: "approve",
        args: [GreenFiProducts.address as `0x${string}`, totalCost],
        gas: BigInt(120000),
      });
      return;
    }
    setTransactionStep("purchasing");
    writeContract({
      address: GreenFiProducts.address as `0x${string}`,
      abi: GreenFiProducts.abi,
      functionName: "purchaseProduct",
      args: [product.id, purchaseQuantity],
      gas: BigInt(500000),
    });
  };

  const handleDelist = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!address || address === "0x0") {
      setError("Please connect your wallet to delist.");
      showPopup("Please connect your wallet to delist.");
      toast.error("Please connect your wallet to delist.");
      return;
    }
    if (isPaused) {
      setError("Cannot delist: Contract is paused.");
      showPopup("Cannot delist: Contract is paused.");
      toast.error("Cannot delist: Contract is paused.");
      return;
    }
    setTransactionStep("delisting");
    writeContract({
      address: GreenFiProducts.address as `0x${string}`,
      abi: GreenFiProducts.abi,
      functionName: "delistProduct",
      args: [product.id],
      gas: BigInt(100000),
    });
  };

  useEffect(() => {
    if (isApprovalConfirmed && approvalHash && transactionStep === "approving") {
      setTransactionStep("purchasing");
      writeContract({
        address: GreenFiProducts.address as `0x${string}`,
        abi: GreenFiProducts.abi,
        functionName: "purchaseProduct",
        args: [product.id, purchaseQuantity],
        gas: BigInt(500000),
      });
    }
  }, [isApprovalConfirmed, approvalHash, transactionStep, writeContract, product.id, purchaseQuantity]);

  const displayPrice = Number(formatEther(product.price)).toFixed(4);
  const discountPrice = product.discount
    ? Number(displayPrice) * (1 - Number(product.discount) / 100)
    : Number(displayPrice);

  const canPurchase = balance !== undefined && purchaseQuantity > 0 && purchaseQuantity <= product.quantityAvailable && balance >= totalPurchaseCostWei();

  return (
    <div
      className="description-item grid-item"
      onClick={onSelect}
      role="row"
      style={{ cursor: "pointer" }}
      aria-label={`Product Listing: ${sanitizeHTML(product.id)}`}
    >
      <p className="disclaimer">Disclaimer: Please verify the authenticity of this product before purchasing.</p>
      <p>Product ID: {sanitizeHTML(product.id)}</p>
      <p>Category: {sanitizeHTML(product.metadata?.category || product.category || "N/A")}</p>
      <p>
        Price per Unit: {discountPrice.toFixed(4)} WEEDL
        {product.discount > 0 && (
          <span> ({Number(product.discount)}% off from {displayPrice} WEEDL)</span>
        )}
      </p>
      <p>Total Cost: {totalPurchaseCost()} WEEDL (includes 0.420% fee)</p>
      <p>Unit Quantity: {sanitizeHTML(product.unitQuantity.toString())} units</p>
      <p>Quantity Available: {sanitizeHTML(product.quantityAvailable.toString())}</p>
      <p>Total Units: {sanitizeHTML((product.unitQuantity * product.quantityAvailable).toString())}</p>
      {product.metadata && (
        <>
          <p>Name: {sanitizeHTML(product.metadata.name || "N/A")}</p>
          <p>Description: {sanitizeHTML(product.metadata.description || "N/A")}</p>
          <p>Contact Info: {sanitizeHTML(product.metadata.contact || product.contactInfo || "N/A")}</p>
          {product.metadata.image && (
            <img
              src={sanitizeHTML(product.metadata.image || "/fallback-product-image.png")}
              alt={sanitizeHTML(product.metadata.name || "Product Image")}
              className="product-image"
              onError={(e) => (e.currentTarget.src = "/fallback-product-image.png")}
              loading="lazy"
            />
          )}
        </>
      )}
      {address && product.seller.toLowerCase() !== address.toLowerCase() && (
        <>
          <div className="input-group">
            <input
              type="number"
              value={purchaseQuantity}
              onChange={(e) => {
                const value = Number(e.target.value);
                if (value > 0 && value <= product.quantityAvailable) setPurchaseQuantity(value);
              }}
              min="1"
              max={product.quantityAvailable}
              className="action-input"
              aria-label="Purchase Quantity"
            />
          </div>
          <button
            onClick={handlePurchase}
            disabled={isPending || isApprovalConfirming || isActionConfirming || product.quantityAvailable <= 0 || !canPurchase || isPaused}
            className="action-button"
            aria-label={`Purchase product ${sanitizeHTML(product.id)}`}
          >
            {isPending && transactionStep === "purchasing"
              ? "Purchasing..."
              : isApprovalConfirming && transactionStep === "approving"
              ? "Approving..."
              : product.quantityAvailable <= 0
              ? "Sold Out"
              : !canPurchase
              ? "Insufficient Balance"
              : "Purchase Product"}
          </button>
        </>
      )}
      {address && product.seller.toLowerCase() === address.toLowerCase() && (
        <button
          onClick={handleDelist}
          disabled={isPending || isActionConfirming || isPaused}
          className="action-button"
          aria-label={`Delist product ${sanitizeHTML(product.id)}`}
        >
          {isPending && transactionStep === "delisting" ? "Delisting..." : "Delist Product"}
        </button>
      )}
      {!address && (
        <p className="connect-wallet-message">Please connect your wallet to purchase or delist.</p>
      )}
      {popup.visible && (
        <div className="popup" role="alert" aria-live="polite">
          {popup.message}
        </div>
      )}
    </div>
  );
}

function ProductModal({
  product,
  address,
  balance,
  onClose,
  setTransactionHash,
  setError,
  setSuccess,
  isPaused,
}: {
  product: Product;
  address: string;
  balance: bigint | undefined;
  onClose: () => void;
  setTransactionHash: (hash: `0x${string}` | undefined) => void;
  setError: (error: string | null) => void;
  setSuccess: (success: string | null) => void;
  isPaused: boolean | undefined;
}) {
  const [purchaseQuantity, setPurchaseQuantity] = useState(1);
  const [transactionStep, setTransactionStep] = useState<"none" | "approving" | "purchasing" | "delisting">("none");
  const [approvalHash, setApprovalHash] = useState<`0x${string}` | undefined>();
  const [actionHash, setActionHash] = useState<`0x${string}` | undefined>();
  const [popup, setPopup] = useState<{ message: string; visible: boolean }>({ message: "", visible: false });

  const { writeContract, isPending, error: writeError, data } = useWriteContract();
  const { isLoading: isApprovalConfirming, isSuccess: isApprovalConfirmed, error: approvalError } = useWaitForTransactionReceipt({ hash: approvalHash });
  const { isLoading: isActionConfirming, isSuccess: isActionConfirmed, error: actionError } = useWaitForTransactionReceipt({ hash: actionHash });

  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: WEEDL.address as `0x${string}`,
    abi: WEEDL.abi,
    functionName: "allowance",
    args: [address || "0x0" as `0x${string}`, GreenFiProducts.address as `0x${string}`],
    query: { refetchInterval: 30000, enabled: !!address && address !== "0x0" },
  }) as { data: bigint | undefined; refetch: () => void };

  const showPopup = (message: string) => {
    setPopup({ message, visible: true });
    setTimeout(() => setPopup({ message: "", visible: false }), 3000);
  };

  useEffect(() => {
    if (writeError) {
      const errorMessage = parseBlockchainError(writeError.message);
      setError(errorMessage);
      showPopup(errorMessage);
      toast.error(errorMessage);
      setTransactionStep("none");
    }
    if (approvalError) {
      const errorMessage = parseBlockchainError(approvalError.message);
      setError(errorMessage);
      showPopup(errorMessage);
      toast.error(errorMessage);
      setTransactionStep("none");
    }
    if (actionError) {
      const errorMessage = parseBlockchainError(actionError.message);
      setError(errorMessage);
      showPopup(errorMessage);
      toast.error(errorMessage);
      setTransactionStep("none");
    }
    if (isActionConfirmed && actionHash) {
      const successMsg =
        transactionStep === "purchasing"
          ? `Successfully purchased ${purchaseQuantity} unit(s) of product ${product.id}`
          : `Successfully delisted product ${product.id}`;
      setSuccess(successMsg);
      showPopup(successMsg);
      toast.success(successMsg);
      setPurchaseQuantity(1);
      setApprovalHash(undefined);
      setActionHash(undefined);
      setTransactionHash(actionHash);
      setTransactionStep("none");
      refetchAllowance();
      if (transactionStep === "purchasing") {
        onClose();
      }
    }
  }, [writeError, approvalError, actionError, isActionConfirmed, actionHash, transactionStep, purchaseQuantity, product.id, setError, setSuccess, setTransactionHash, refetchAllowance, onClose]);

  useEffect(() => {
    if (data && transactionStep === "approving" && !approvalHash) {
      setApprovalHash(data);
      showPopup("Approval transaction submitted!");
      toast.info("Approval transaction submitted!");
    } else if (data && (transactionStep === "purchasing" || transactionStep === "delisting") && !actionHash) {
      setActionHash(data);
      showPopup(transactionStep === "purchasing" ? "Purchase transaction submitted!" : "Delist transaction submitted!");
      toast.info(transactionStep === "purchasing" ? "Purchase transaction submitted!" : "Delist transaction submitted!");
    }
  }, [data, transactionStep, approvalHash, actionHash]);

  const totalPurchaseCostWei = () => {
    const priceWei = product.price * BigInt(purchaseQuantity);
    const greenFiFee = (priceWei * BigInt(420)) / BigInt(100000);
    return priceWei + greenFiFee;
  };

  const totalPurchaseCost = () => {
    return Number(formatEther(totalPurchaseCostWei())).toFixed(4);
  };

  const handlePurchase = () => {
    if (!address || address === "0x0") {
      setError("Please connect your wallet to purchase.");
      showPopup("Please connect your wallet to purchase.");
      toast.error("Please connect your wallet to purchase.");
      return;
    }
    if (isPaused) {
      setError("Cannot purchase: Contract is paused.");
      showPopup("Cannot purchase: Contract is paused.");
      toast.error("Cannot purchase: Contract is paused.");
      return;
    }
    if (purchaseQuantity <= 0 || purchaseQuantity > product.quantityAvailable) {
      setError(`Purchase quantity must be between 1 and ${product.quantityAvailable}.`);
      showPopup(`Purchase quantity must be between 1 and ${product.quantityAvailable}.`);
      toast.error(`Purchase quantity must be between 1 and ${product.quantityAvailable}.`);
      return;
    }
    const totalCost = totalPurchaseCostWei();
    if (balance && balance < totalCost) {
      setError(`Insufficient WEEDL balance. Need ${totalPurchaseCost()} WEEDL.`);
      showPopup(`Insufficient WEEDL balance. Need ${totalPurchaseCost()} WEEDL.`);
      toast.error(`Insufficient WEEDL balance. Need ${totalPurchaseCost()} WEEDL.`);
      return;
    }
    if (!allowance || allowance < totalCost) {
      setTransactionStep("approving");
      writeContract({
        address: WEEDL.address as `0x${string}`,
        abi: WEEDL.abi,
        functionName: "approve",
        args: [GreenFiProducts.address as `0x${string}`, totalCost],
        gas: BigInt(120000),
      });
      return;
    }
    setTransactionStep("purchasing");
    writeContract({
      address: GreenFiProducts.address as `0x${string}`,
      abi: GreenFiProducts.abi,
      functionName: "purchaseProduct",
      args: [product.id, purchaseQuantity],
      gas: BigInt(500000),
    });
  };

  const handleDelist = () => {
    if (!address || address === "0x0") {
      setError("Please connect your wallet to delist.");
      showPopup("Please connect your wallet to delist.");
      toast.error("Please connect your wallet to delist.");
      return;
    }
    if (isPaused) {
      setError("Cannot delist: Contract is paused.");
      showPopup("Cannot delist: Contract is paused.");
      toast.error("Cannot delist: Contract is paused.");
      return;
    }
    setTransactionStep("delisting");
    writeContract({
      address: GreenFiProducts.address as `0x${string}`,
      abi: GreenFiProducts.abi,
      functionName: "delistProduct",
      args: [product.id],
      gas: BigInt(100000),
    });
  };

  useEffect(() => {
    if (isApprovalConfirmed && approvalHash && transactionStep === "approving") {
      setTransactionStep("purchasing");
      writeContract({
        address: GreenFiProducts.address as `0x${string}`,
        abi: GreenFiProducts.abi,
        functionName: "purchaseProduct",
        args: [product.id, purchaseQuantity],
        gas: BigInt(500000),
      });
    }
  }, [isApprovalConfirmed, approvalHash, transactionStep, writeContract, product.id, purchaseQuantity]);

  const displayPrice = Number(formatEther(product.price)).toFixed(4);
  const discountPrice = product.discount
    ? Number(displayPrice) * (1 - Number(product.discount) / 100)
    : Number(displayPrice);

  const canPurchase = balance !== undefined && purchaseQuantity > 0 && purchaseQuantity <= product.quantityAvailable && balance >= totalPurchaseCostWei();

  return (
    <div className="modal" role="dialog" aria-label="Product Listing Details Modal">
      <div className="modal-content">
        <button className="modal-close" onClick={onClose} aria-label="Close modal">
          ×
        </button>
        <h3>Product Listing Details</h3>
        <p className="disclaimer">Disclaimer: Please verify the authenticity of this listing before engaging.</p>
        <p>Product ID: {sanitizeHTML(product.id)}</p>
        <p>Category: {sanitizeHTML(product.metadata?.category || product.category || "N/A")}</p>
        <p>
          Price per Unit: {discountPrice.toFixed(4)} WEEDL
          {product.discount > 0 && (
            <span> ({Number(product.discount)}% off from {displayPrice} WEEDL)</span>
          )}
        </p>
        <p>Total Cost: {totalPurchaseCost()} WEEDL (includes 0.420% fee)</p>
        <p>Unit Quantity: {sanitizeHTML(product.unitQuantity.toString())} units</p>
        <p>Quantity Available: {sanitizeHTML(product.quantityAvailable.toString())}</p>
        <p>Total Units: {sanitizeHTML((product.unitQuantity * product.quantityAvailable).toString())}</p>
        <p>Seller: {sanitizeHTML(product.seller)}</p>
        {product.metadata && (
          <>
            <p>Name: {sanitizeHTML(product.metadata.name || "N/A")}</p>
            <p>Description: {sanitizeHTML(product.metadata.description || "N/A")}</p>
            <p>Contact Info: {sanitizeHTML(product.metadata.contact || product.contactInfo || "N/A")}</p>
            <p>Disclaimer: {sanitizeHTML(product.metadata.disclaimer || "Please verify the authenticity of this listing.")}</p>
            {product.metadata.image && (
              <img
                src={sanitizeHTML(product.metadata.image || "/fallback-product-image.png")}
                alt={sanitizeHTML(product.metadata.name || "Product Image")}
                className="product-image"
                onError={(e) => (e.currentTarget.src = "/fallback-product-image.png")}
                loading="lazy"
              />
            )}
          </>
        )}
        {address && product.seller.toLowerCase() !== address.toLowerCase() && (
          <>
            <div className="input-group">
              <input
                type="number"
                value={purchaseQuantity}
                onChange={(e) => {
                  const value = Number(e.target.value);
                  if (value > 0 && value <= product.quantityAvailable) setPurchaseQuantity(value);
                }}
                min="1"
                max={product.quantityAvailable}
                className="action-input"
                aria-label="Purchase Quantity"
              />
            </div>
            <button
              onClick={handlePurchase}
              disabled={isPending || isApprovalConfirming || isActionConfirming || product.quantityAvailable <= 0 || !canPurchase || isPaused}
              className="action-button"
              aria-label="Purchase Product"
            >
              {isPending && transactionStep === "purchasing"
                ? "Purchasing..."
                : isApprovalConfirming && transactionStep === "approving"
                ? "Approving..."
                : product.quantityAvailable <= 0
                ? "Sold Out"
                : !canPurchase
                ? "Insufficient Balance"
                : "Purchase Product"}
            </button>
          </>
        )}
        {address && product.seller.toLowerCase() === address.toLowerCase() && (
          <button
            onClick={handleDelist}
            disabled={isPending || isActionConfirming || isPaused}
            className="action-button"
            aria-label="Delist Product"
          >
            {isPending && transactionStep === "delisting" ? "Delisting..." : "Delist Product"}
          </button>
        )}
        {!address && (
          <p className="connect-wallet-message">Please connect your wallet to purchase or delist.</p>
        )}
        {popup.visible && (
          <div className="popup" role="alert" aria-live="polite">
            {popup.message}
          </div>
        )}
      </div>
    </div>
  );
}