import { useState, useEffect, FormEvent, useCallback } from "react";
import { useWriteContract, useWaitForTransactionReceipt, useReadContract, useAccount, useBalance, usePublicClient } from "wagmi";
import { parseEther, formatEther } from "viem";
import { GreenFiProducts, WEEDL } from "../config/contracts";
import { uploadFile } from "../utils/uploadFile";
import { sanitizeHTML } from "../utils/security";
import { convertCIDToURL } from "../utils/retrieveFile";
import { Metadata } from "../utils/metadata";
import { v4 as uuidv4 } from "uuid";
import { toast } from "react-toastify";

export default function ProductsListingForm() {
  const [image, setImage] = useState<File | null>(null);
  const [description, setDescription] = useState("");
  const [contactInfo, setContactInfo] = useState("");
  const [price, setPrice] = useState("");
  const [unitQuantity, setUnitQuantity] = useState("");
  const [quantityAvailable, setQuantityAvailable] = useState("");
  const [discount, setDiscount] = useState("");
  const [category, setCategory] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [approvalHash, setApprovalHash] = useState<`0x${string}` | undefined>();
  const [listingHash, setListingHash] = useState<`0x${string}` | undefined>();
  const [transactionStep, setTransactionStep] = useState<"none" | "approving" | "listing">("none");
  const [lastProductId, setLastProductId] = useState<string | null>(null);
  const [cid, setCid] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [validationErrors, setValidationErrors] = useState<{ [key: string]: string }>({});
  const [popup, setPopup] = useState<{ message: string; visible: boolean }>({ message: "", visible: false });

  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { writeContract, data: writeData, error: writeError, isPending } = useWriteContract();
  const { isLoading: isApprovalConfirming, isSuccess: isApprovalConfirmed, error: approvalError } = useWaitForTransactionReceipt({ hash: approvalHash });
  const { isLoading: isListingConfirming, isSuccess: isListingConfirmed, error: listingError } = useWaitForTransactionReceipt({ hash: listingHash });

  const { data: balance, refetch: refetchBalance } = useReadContract({
    address: WEEDL.address as `0x${string}`,
    abi: WEEDL.abi,
    functionName: "balanceOf",
    args: [address || "0x0" as `0x${string}`],
    query: { enabled: !!address, refetchInterval: 30000 },
  }) as { data: bigint | undefined; refetch: () => void };

  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: WEEDL.address as `0x${string}`,
    abi: WEEDL.abi,
    functionName: "allowance",
    args: [address || "0x0" as `0x${string}`, GreenFiProducts.address as `0x${string}`],
    query: { enabled: !!address, refetchInterval: 30000 },
  }) as { data: bigint | undefined; refetch: () => void };

  const { data: ethBalance } = useBalance({ address });

  const { data: isPaused } = useReadContract({
    address: GreenFiProducts.address as `0x${string}`,
    abi: GreenFiProducts.abi,
    functionName: "paused",
    query: { refetchInterval: 30000 },
  }) as { data: boolean | undefined };

  const totalRequired = useCallback(() => {
    if (!price || isNaN(Number(price))) return BigInt(0);
    const priceWei = parseEther(price);
    const greenFiFee = (priceWei * BigInt(420)) / BigInt(10000);
    return greenFiFee;
  }, [price]);

  const parseBlockchainError = useCallback((message: string): string => {
    if (message.includes("User rejected")) return "Transaction rejected by user.";
    if (message.includes("InvalidPrice")) return "Price is invalid (must be greater than 0.0001 WEEDL).";
    if (message.includes("ProductIdInUse")) return "Product ID is already in use. Retrying with a new ID...";
    if (message.includes("InvalidUnitQuantity")) return "Unit quantity must be 1, 10, 50, or 100.";
    if (message.includes("SafeERC20FailedOperation")) return "Failed to transfer WEEDL tokens. Ensure sufficient balance and approval.";
    if (message.includes("Insufficient allowance")) return `Insufficient allowance. Please approve ${formatEther(totalRequired())} WEEDL for the listing fee.`;
    if (message.includes("nonce too low")) return "Nonce too low. Please try again or check for pending transactions.";
    if (message.includes("replacement transaction underpriced")) return "Transaction failed due to low gas price. Please try again with a higher gas price.";
    if (message.includes("Pausable: paused")) return "Contract is paused. Please try again later.";
    if (message.includes("execution reverted")) return `Transaction reverted. Check token balance (need ${formatEther(totalRequired())} WEEDL for listing fee), allowance (current: ${formatEther(allowance || 0n)} WEEDL), or contract state.`;
    return message || "Unknown error occurred.";
  }, [totalRequired, allowance]);

  const showPopup = (message: string) => {
    setPopup({ message, visible: true });
    setTimeout(() => setPopup({ message: "", visible: false }), 3000);
  };

  useEffect(() => {
    if (writeData && transactionStep === "approving" && !approvalHash) {
      setApprovalHash(writeData);
      showPopup("Approval transaction submitted!");
      toast.info("Approval transaction submitted!");
    } else if (writeData && transactionStep === "listing" && !listingHash) {
      setListingHash(writeData);
      showPopup("Product listing transaction submitted!");
      toast.info("Product listing transaction submitted!");
    }
  }, [writeData, transactionStep, approvalHash, listingHash]);

  useEffect(() => {
    if (writeError) {
      const errorMessage = parseBlockchainError(writeError.message);
      setError(errorMessage);
      showPopup(errorMessage);
      toast.error(errorMessage);
      setUploading(false);
      setTransactionStep("none");
    }
    if (approvalError) {
      const errorMessage = parseBlockchainError(approvalError.message);
      setError(errorMessage);
      showPopup(errorMessage);
      toast.error(errorMessage);
      setUploading(false);
      setTransactionStep("none");
    }
    if (listingError) {
      const errorMessage = parseBlockchainError(listingError.message);
      setError(errorMessage);
      showPopup(errorMessage);
      toast.error(errorMessage);
      setUploading(false);
      setTransactionStep("none");
      if (listingError.message.includes("ProductIdInUse")) {
        setCid(null);
        setLastProductId(null);
        setTransactionStep("approving");
      }
    }
    if (isApprovalConfirmed && approvalHash && cid && lastProductId && transactionStep === "approving") {
      setTransactionStep("listing");
      writeContract({
        address: GreenFiProducts.address as `0x${string}`,
        abi: GreenFiProducts.abi,
        functionName: "listProduct",
        args: [lastProductId, `ipfs://${cid}`, parseEther(price), contactInfo || "", category || "", Number(unitQuantity) || 0, Number(quantityAvailable) || 0, Number(discount || 0)],
        gas: BigInt(600000),
        account: address as `0x${string}`,
      });
    }
    if (isListingConfirmed && listingHash) {
      setSuccess(true);
      showPopup("Product listing created successfully!");
      toast.success("Product listing created successfully!");
      setUploading(false);
      setImage(null);
      setDescription("");
      setContactInfo("");
      setPrice("");
      setUnitQuantity("");
      setQuantityAvailable("");
      setDiscount("");
      setCategory("");
      setCid(null);
      setLastProductId(null);
      setApprovalHash(undefined);
      setListingHash(undefined);
      setTransactionStep("none");
      setValidationErrors({});
      refetchBalance();
      refetchAllowance();
      console.log("Product Listing Success! Transaction Hash:", listingHash);
      console.log("Check Sepolia Etherscan: https://sepolia.etherscan.io/tx/" + listingHash);
    }
  }, [
    writeError,
    approvalError,
    listingError,
    isApprovalConfirmed,
    approvalHash,
    isListingConfirmed,
    listingHash,
    refetchBalance,
    refetchAllowance,
    cid,
    lastProductId,
    writeContract,
    address,
    price,
    contactInfo,
    category,
    unitQuantity,
    quantityAvailable,
    discount,
    transactionStep,
    parseBlockchainError,
  ]);

  const validateInput = (field: string, value: string) => {
    const errors = { ...validationErrors };
    switch (field) {
      case "description":
        errors.description = value.length > 0 ? "" : "Description is required.";
        break;
      case "contactInfo":
        errors.contactInfo = value.length > 100 ? "Contact info must be 100 characters or less." : value.length > 0 ? "" : "Contact info is required.";
        break;
      case "category":
        errors.category = value.length > 0 ? "" : "Category is required.";
        break;
      case "price":
        errors.price = !value || isNaN(Number(value)) || Number(value) < 0.0001 || Number(value) > 100 ? "Price must be a number between 0.0001 and 100 WEEDL." : "";
        break;
      case "unitQuantity":
        errors.unitQuantity = !value || ![1, 10, 50, 100].includes(Number(value)) ? "Unit quantity must be 1, 10, 50, or 100." : "";
        break;
      case "quantityAvailable":
        errors.quantityAvailable = !value || isNaN(Number(value)) || Number(value) <= 0 || Number(value) > 1000 ? "Quantity available must be between 1 and 1000." : "";
        break;
      case "discount":
        errors.discount = value && (isNaN(Number(value)) || Number(value) < 0 || Number(value) > 50) ? "Discount must be a number between 0 and 50%." : "";
        break;
    }
    setValidationErrors(errors);
  };

  const handleDescriptionChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const sanitized = await sanitizeHTML(e.target.value);
    if (sanitized !== undefined) {
      setDescription(sanitized);
      validateInput("description", sanitized);
    } else {
      setDescription("");
      validateInput("description", "");
    }
  };

  const handleContactChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const sanitized = await sanitizeHTML(e.target.value);
    if (sanitized !== undefined) {
      setContactInfo(sanitized);
      validateInput("contactInfo", sanitized);
    } else {
      setContactInfo("");
      validateInput("contactInfo", "");
    }
  };

  const handleCategoryChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const sanitized = await sanitizeHTML(e.target.value);
    if (sanitized !== undefined) {
      setCategory(sanitized);
      validateInput("category", sanitized);
    } else {
      setCategory("");
      validateInput("category", "");
    }
  };

  const handlePriceChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (value === "" || (/^\d*\.?\d*$/.test(value) && Number(value) <= 100)) {
      setPrice(value);
      validateInput("price", value);
    }
  };

  const handleUnitQuantityChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    setUnitQuantity(value);
    validateInput("unitQuantity", value);
  };

  const handleQuantityAvailableChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (value === "" || (/^\d+$/.test(value) && Number(value) > 0 && Number(value) <= 1000)) {
      setQuantityAvailable(value);
      validateInput("quantityAvailable", value);
    }
  };

  const handleDiscountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (value === "" || (/^\d*\.?\d*$/.test(value) && Number(value) >= 0 && Number(value) <= 50)) {
      setDiscount(value);
      validateInput("discount", value);
    }
  };

  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      setError(null);
      setSuccess(false);
      setUploading(true);
      setTransactionStep("approving");

      if (isPaused) {
        const errorMsg = "Cannot list product: Contract is paused.";
        setError(errorMsg);
        showPopup(errorMsg);
        toast.error(errorMsg);
        setUploading(false);
        setTransactionStep("none");
        return;
      }

      try {
        if (!image) throw new Error("Please upload an image.");
        if (!description) throw new Error("Please provide a description.");
        if (!contactInfo) throw new Error("Please provide contact information.");
        if (contactInfo.length > 100) throw new Error("Contact info must be 100 characters or less.");
        if (!price || isNaN(Number(price)) || Number(price) < 0.0001) {
          throw new Error("Price must be at least 0.0001 WEEDL.");
        }
        if (!unitQuantity || ![1, 10, 50, 100].includes(Number(unitQuantity))) {
          throw new Error("Unit quantity must be 1, 10, 50, or 100.");
        }
        if (!quantityAvailable || isNaN(Number(quantityAvailable)) || Number(quantityAvailable) <= 0) {
          throw new Error("Quantity available must be a positive number (max 1000).");
        }
        if (discount && (isNaN(Number(discount)) || Number(discount) < 0 || Number(discount) > 50)) {
          throw new Error("Discount must be between 0 and 50%.");
        }
        if (!category) throw new Error("Please provide a category.");
        if (!address) throw new Error("Please connect your wallet.");
        if (!ethBalance || ethBalance.value < parseEther("0.001")) {
          throw new Error("Insufficient SepoliaETH for gas fees. Need at least 0.001 SepoliaETH.");
        }
        if (!publicClient) {
          throw new Error("Public client not available. Please try again.");
        }

        const requiredWei = totalRequired();
        if (!balance || balance < requiredWei) {
          throw new Error(
            `Insufficient WEEDL balance. Need ${formatEther(requiredWei)} WEEDL for listing fee, have ${
              balance ? formatEther(balance) : 0
            } WEEDL.`
          );
        }

        let productId: string;
        let attempts = 0;
        const maxAttempts = 3;

        do {
          const fullUuid = uuidv4();
          productId = `product_${fullUuid.slice(0, 8)}`;
          if (productId.length > 32) throw new Error("Generated product ID is too long.");
          attempts++;
          try {
            const sanitizedProductId = await sanitizeHTML(productId) || "";
            const sanitizedDescription = await sanitizeHTML(description) || "";
            const sanitizedContactInfo = await sanitizeHTML(contactInfo) || "";
            const sanitizedCategory = await sanitizeHTML(category) || "";

            const result = await uploadFile(image, {
              name: image.name,
              description: sanitizedDescription,
              contact: sanitizedContactInfo,
              disclaimer: "Please verify the authenticity of this listing before engaging.",
              category: sanitizedCategory,
              unitQuantity: Number(unitQuantity),
              quantityAvailable: Number(quantityAvailable),
              discount: Number(discount) || 0,
              image: image.name,
            });

            const uri = `ipfs://${result.cid}`;
            const httpUrl = convertCIDToURL(result.cid, import.meta.env.VITE_PINATA_GATEWAY!);
            setCid(result.cid);
            setLastProductId(sanitizedProductId);

            console.log("Submitting product listing:", {
              productId: sanitizedProductId,
              uri,
              priceWei: parseEther(price).toString(),
              contactInfo: sanitizedContactInfo,
              category: sanitizedCategory,
              unitQuantity: Number(unitQuantity),
              quantityAvailable: Number(quantityAvailable),
              discount: Number(discount || 0),
            });
            console.log("Metadata URL:", httpUrl);

            if (!allowance || allowance < requiredWei) {
              writeContract({
                address: WEEDL.address as `0x${string}`,
                abi: WEEDL.abi,
                functionName: "approve",
                args: [GreenFiProducts.address as `0x${string}`, requiredWei],
                gas: BigInt(120000),
                account: address as `0x${string}`,
              });
              return;
            }

            setTransactionStep("listing");
            writeContract({
              address: GreenFiProducts.address as `0x${string}`,
              abi: GreenFiProducts.abi,
              functionName: "listProduct",
              args: [sanitizedProductId, uri, parseEther(price), sanitizedContactInfo, sanitizedCategory, Number(unitQuantity) || 0, Number(quantityAvailable) || 0, Number(discount || 0)],
              gas: BigInt(600000),
              account: address as `0x${string}`,
            });
            break;
          } catch (err: unknown) {
            if (err instanceof Error && err.message.includes("ProductIdInUse") && attempts < maxAttempts) {
              console.log(`Product ID ${productId} already in use. Retrying (${attempts}/${maxAttempts})...`);
              continue;
            }
            throw err instanceof Error ? err : new Error("Failed to generate a unique product ID. Please try again later or contact support.");
          }
        } while (attempts < maxAttempts);

        if (attempts >= maxAttempts) {
          throw new Error("Failed to generate a unique product ID after multiple attempts. Please try again later or contact support.");
        }
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? parseBlockchainError(err.message) : "Failed to upload metadata or list product.";
        setError(errorMessage);
        showPopup(errorMessage);
        toast.error(errorMessage);
        setUploading(false);
        setTransactionStep("none");
      }
    },
    [
      image,
      description,
      contactInfo,
      price,
      unitQuantity,
      quantityAvailable,
      discount,
      category,
      balance,
      allowance,
      writeContract,
      address,
      ethBalance,
      totalRequired,
      publicClient,
      isPaused,
      parseBlockchainError,
    ]
  );

  const FeeBreakdown = () => {
    const priceWei = parseEther(price || "0");
    const greenFiFee = (priceWei * BigInt(420)) / BigInt(10000);
    return (
      <div className="fee-breakdown">
        <p>Price per Unit: {formatEther(priceWei)} WEEDL</p>
        <p>Listing Fee (0.420%): {formatEther(greenFiFee)} WEEDL</p>
        <p>Total Required for Listing: {formatEther(greenFiFee)} WEEDL</p>
        <p className="disclaimer">Note: The listing fee is non-refunded and covers the cost of listing your products.</p>
      </div>
    );
  };

  const MetadataPreview = () => {
    const metadata: Metadata = {
      description: description || undefined,
      contact: contactInfo || undefined,
      disclaimer: "Please verify the authenticity of this listing before engaging.",
      category: category || undefined,
      unitQuantity: unitQuantity ? Number(unitQuantity) : undefined,
      quantityAvailable: quantityAvailable ? Number(quantityAvailable) : undefined,
      discount: discount ? Number(discount) : undefined,
      image: image ? URL.createObjectURL(image) : undefined,
    };
    return (
      <div className="metadata-preview">
        <h4>Preview</h4>
        {metadata.image && <img src={sanitizeHTML(metadata.image)} alt="Preview" className="preview-image" />}
        <p>Description: {sanitizeHTML(metadata.description || "N/A")}</p>
        <p>Contact: {sanitizeHTML(metadata.contact || "N/A")}</p>
        <p>Category: {sanitizeHTML(metadata.category || "N/A")}</p>
        <p>Unit Quantity: {metadata.unitQuantity !== undefined ? `${metadata.unitQuantity} units` : "N/A"}</p>
        <p>Quantity Available: {metadata.quantityAvailable !== undefined ? metadata.quantityAvailable : "N/A"}</p>
        <p>Total Units: {metadata.unitQuantity && metadata.quantityAvailable ? metadata.unitQuantity * metadata.quantityAvailable : "N/A"}</p>
        <p>Discount: {metadata.discount !== undefined ? `${metadata.discount}%` : "N/A"}</p>
      </div>
    );
  };

  return (
    <form onSubmit={handleSubmit} className="description-item" role="form" aria-label="Product Listing Form">
      <h3>List Product</h3>
      <p className="disclaimer">Disclaimer: Please verify the authenticity of all listings before engaging.</p>
      <p>Wallet: {sanitizeHTML(address ? `${address.slice(0, 6)}...${address.slice(-4)}` : "Not connected")}</p>
      {balance !== undefined && <p>WEEDL Balance: {formatEther(balance)} WEEDL</p>}
      {ethBalance && <p>SepoliaETH Balance: {formatEther(ethBalance.value)} SepoliaETH</p>}
      {isPaused && (
        <p className="error" role="alert">
          Contract is paused. Listing is disabled.
        </p>
      )}
      {error && <p className="error" role="alert">{error}</p>}
      <div className="input-group">
        <input
          type="file"
          accept="image/*"
          onChange={(e) => setImage(e.target.files?.[0] || null)}
          required
          className="action-input"
          aria-label="Upload Product Image"
          disabled={!address || isPaused}
        />
        {!image && <p className="validation-error">Image is required.</p>}
      </div>
      <div className="input-group">
        <input
          type="text"
          value={description}
          onChange={handleDescriptionChange}
          placeholder="Product Description (e.g., CBD Oil, 500mg)"
          required
          className="action-input"
          aria-label="Product Description"
          disabled={!address || isPaused}
        />
        {validationErrors.description && <p className="validation-error">{validationErrors.description}</p>}
      </div>
      <div className="input-group">
        <input
          type="text"
          value={contactInfo}
          onChange={handleContactChange}
          placeholder="Contact Info (e.g., website, email, Telegram)"
          required
          className="action-input"
          aria-label="Contact Information"
          disabled={!address || isPaused}
        />
        {validationErrors.contactInfo && <p className="validation-error">{validationErrors.contactInfo}</p>}
      </div>
      <div className="input-group">
        <input
          type="text"
          value={category}
          onChange={handleCategoryChange}
          placeholder="Product Category (e.g., Oils, Edibles)"
          required
          className="action-input"
          aria-label="Product Category"
          disabled={!address || isPaused}
        />
        {validationErrors.category && <p className="validation-error">{validationErrors.category}</p>}
      </div>
      <div className="input-group">
        <input
          type="text"
          value={price}
          onChange={handlePriceChange}
          placeholder="Price per Unit (WEEDL, 0.0001-100)"
          required
          className="action-input"
          aria-label="Price per Unit in WEEDL"
          disabled={!address || isPaused}
        />
        {validationErrors.price && <p className="validation-error">{validationErrors.price}</p>}
      </div>
      <div className="input-group">
        <select
          value={unitQuantity}
          onChange={handleUnitQuantityChange}
          required
          className="action-input"
          aria-label="Unit Quantity"
          disabled={!address || isPaused}
        >
          <option value="" disabled>
            Select Unit Quantity
          </option>
          {[1, 10, 50, 100].map((size) => (
            <option key={size} value={size}>
              {size} Units
            </option>
          ))}
        </select>
        {validationErrors.unitQuantity && <p className="validation-error">{validationErrors.unitQuantity}</p>}
      </div>
      <div className="input-group">
        <input
          type="text"
          value={quantityAvailable}
          onChange={handleQuantityAvailableChange}
          placeholder="Quantity Available (1-1000)"
          required
          className="action-input"
          aria-label="Quantity Available"
          disabled={!address || isPaused}
        />
        {validationErrors.quantityAvailable && <p className="validation-error">{validationErrors.quantityAvailable}</p>}
      </div>
      <div className="input-group">
        <input
          type="text"
          value={discount}
          onChange={handleDiscountChange}
          placeholder="Discount % (0-50, optional)"
          className="action-input"
          aria-label="Discount Percentage"
          disabled={!address || isPaused}
        />
        {validationErrors.discount && <p className="validation-error">{validationErrors.discount}</p>}
      </div>
      <FeeBreakdown />
      <MetadataPreview />
      {isPending || uploading ? (
        <div className="loading" aria-label="Processing transaction">
          <p>{isApprovalConfirming ? "Approving WEEDL..." : isListingConfirming ? "Listing Product..." : "Uploading metadata..."}</p>
        </div>
      ) : (
        <button
          type="submit"
          disabled={isPending || uploading || isApprovalConfirming || isListingConfirming || Object.values(validationErrors).some((e) => e) || !address || isPaused}
          className="action-button"
          aria-label="List Product"
        >
          {isApprovalConfirming ? "Approving..." : isListingConfirming ? "Listing..." : "List Product"}
        </button>
      )}
      {error && <p className="error" role="alert">{error}</p>}
      {success && <p className="success" role="alert">Product listing created successfully!</p>}
      {popup.visible && (
        <div className="popup" role="alert" aria-live="polite">
          {popup.message}
        </div>
      )}
    </form>
  );
}