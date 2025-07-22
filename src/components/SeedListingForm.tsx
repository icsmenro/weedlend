import { useState, useEffect, FormEvent, useCallback } from "react";
import { useWriteContract, useWaitForTransactionReceipt, useReadContract, useAccount, useBalance, useEstimateGas, usePublicClient, useGasPrice } from "wagmi";
import { parseEther, encodeFunctionData, formatEther } from "viem";
import { GreenFiSeed, WEEDL } from "../config/contracts";
import { uploadFile } from "../utils/uploadFile";
import { sanitizeHTML } from "../utils/security";
import { convertCIDToURL } from "../utils/retrieveFile";
import { Metadata } from "../utils/metadata";
import { v4 as uuidv4 } from "uuid";
import { toast } from "react-toastify";

export default function SeedListingForm() {
  const [image, setImage] = useState<File | null>(null);
  const [description, setDescription] = useState("");
  const [contactInfo, setContactInfo] = useState("");
  const [price, setPrice] = useState("");
  const [packSize, setPackSize] = useState("");
  const [packQuantity, setPackQuantity] = useState("");
  const [discount, setDiscount] = useState("");
  const [strain, setStrain] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [approvalHash, setApprovalHash] = useState<`0x${string}` | undefined>();
  const [listingHash, setListingHash] = useState<`0x${string}` | undefined>();
  const [transactionStep, setTransactionStep] = useState<"none" | "approving" | "listing">("none");
  const [lastSeedId, setLastSeedId] = useState<string | null>(null);
  const [cid, setCid] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [validationErrors, setValidationErrors] = useState<{ [key: string]: string }>({});
  const [gasEstimate, setGasEstimate] = useState<string | null>(null);

  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { data: gasPrice } = useGasPrice();
  const { writeContract, data: writeData, error: writeError, isPending } = useWriteContract();
  const { isLoading: isApprovalConfirming, isSuccess: isApprovalConfirmed, error: approvalError } = useWaitForTransactionReceipt({ hash: approvalHash });
  const { isLoading: isListingConfirming, isSuccess: isListingConfirmed, error: listingError } = useWaitForTransactionReceipt({ hash: listingHash });

  const { data: balance, refetch: refetchBalance } = useReadContract({
    address: WEEDL.address as `0x${string}`,
    abi: WEEDL.abi,
    functionName: "balanceOf",
    args: [address || "0x0" as `0x${string}`],
    query: { enabled: !!address },
  }) as { data: bigint | undefined; refetch: () => void };

  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: WEEDL.address as `0x${string}`,
    abi: WEEDL.abi,
    functionName: "allowance",
    args: [address || "0x0" as `0x${string}`, GreenFiSeed.address as `0x${string}`],
    query: { enabled: !!address },
  }) as { data: bigint | undefined; refetch: () => void };

  const { data: ethBalance } = useBalance({ address });

  const { data: approvalGasEstimate } = useEstimateGas({
    account: address as `0x${string}`,
    to: WEEDL.address as `0x${string}`,
    data: encodeFunctionData({
      abi: WEEDL.abi,
      functionName: "approve",
      args: [GreenFiSeed.address as `0x${string}`, BigInt(0)],
    }),
  });

  const { data: listingGasEstimate } = useEstimateGas({
    account: address as `0x${string}`,
    to: GreenFiSeed.address as `0x${string}`,
    data: encodeFunctionData({
      abi: GreenFiSeed.abi,
      functionName: "listSeed",
      args: ["", "", parseEther(price || "0"), "", "", 3, 0, 0],
    }),
  });

  const totalRequired = useCallback(() => {
    if (!price || isNaN(Number(price))) return BigInt(0);
    const priceWei = parseEther(price);
    const greenFiFee = (priceWei * BigInt(420)) / BigInt(10000);
    return greenFiFee;
  }, [price]);

  const getNextNonce = useCallback(async () => {
    if (!address || !publicClient) return undefined;
    try {
      const nonce = await publicClient.getTransactionCount({
        address: address as `0x${string}`,
        blockTag: "pending",
      });
      return nonce;
    } catch (error) {
      console.error("Failed to fetch nonce:", error);
      return undefined;
    }
  }, [address, publicClient]);

  const checkPendingTransactions = useCallback(async () => {
    if (!address || !publicClient) return false;
    try {
      let attempts = 0;
      const maxAttempts = 10;
      let pendingTxCount = await publicClient.getTransactionCount({
        address: address as `0x${string}`,
        blockTag: "pending",
      });
      const confirmedTxCount = await publicClient.getTransactionCount({
        address: address as `0x${string}`,
        blockTag: "latest",
      });
      while (pendingTxCount > confirmedTxCount && attempts < maxAttempts) {
        console.log(`Pending transactions detected (${pendingTxCount - confirmedTxCount}). Waiting...`);
        await new Promise((resolve) => setTimeout(resolve, 2000));
        pendingTxCount = await publicClient.getTransactionCount({
          address: address as `0x${string}`,
          blockTag: "pending",
        });
        attempts++;
      }
      if (pendingTxCount > confirmedTxCount) {
        console.warn("Pending transactions still exist after waiting.");
        return true;
      }
      return false;
    } catch (error) {
      console.error("Failed to check pending transactions:", error);
      return false;
    }
  }, [address, publicClient]);

  const parseBlockchainError = useCallback((message: string): string => {
    if (message.includes("User rejected")) return "Transaction rejected by user.";
    if (message.includes("InvalidPrice")) return "Price is invalid (must be greater than 0.0001 WEEDL).";
    if (message.includes("SeedIdInUse")) return "Seed ID is already in use. Retrying with a new ID...";
    if (message.includes("InvalidPackSize")) return "Pack size must be 3, 5, or 10 seeds.";
    if (message.includes("SafeERC20FailedOperation")) return "Failed to transfer WEEDL tokens. Ensure sufficient balance and approval.";
    if (message.includes("Insufficient allowance")) return `Insufficient allowance. Please approve ${(Number(totalRequired()) / 1e18).toFixed(4)} WEEDL for the listing fee.`;
    if (message.includes("nonce too low")) return "Nonce too low. Please try again or check for pending transactions.";
    if (message.includes("replacement transaction underpriced")) return "Transaction failed due to low gas price. Please try again with a higher gas price.";
    if (message.includes("Pausable: paused")) return "Contract is paused. Please try again later.";
    if (message.includes("execution reverted")) return `Transaction reverted. Check token balance (need ${(Number(totalRequired()) / 1e18).toFixed(4)} WEEDL for listing fee), allowance (current: ${(Number(allowance || 0n) / 1e18).toFixed(4)} WEEDL), or contract state.`;
    return message || "Unknown error occurred.";
  }, [totalRequired, allowance]);

  const estimateGas = useCallback(async () => {
    if (!publicClient || !address || !price || !contactInfo || !description || !strain || !packSize || !packQuantity || !image) {
      setGasEstimate(null);
      return;
    }
    try {
      const requiredWei = totalRequired();
      if (!allowance || allowance < requiredWei) {
        const approvalData = encodeFunctionData({
          abi: WEEDL.abi,
          functionName: "approve",
          args: [GreenFiSeed.address as `0x${string}`, requiredWei],
        });
        const approvalGas = await publicClient.estimateGas({
          account: address as `0x${string}`,
          to: WEEDL.address as `0x${string}`,
          data: approvalData,
        });
        const approvalCost = gasPrice ? formatEther(approvalGas * gasPrice) : "0";
        setGasEstimate(`Approval: ~${approvalCost} SepoliaETH`);
        return;
      }
      const listingData = encodeFunctionData({
        abi: GreenFiSeed.abi,
        functionName: "listSeed",
        args: ["", "ipfs://placeholder", parseEther(price), contactInfo, strain, Number(packSize) || 0, Number(packQuantity) || 0, Number(discount || 0)],
      });
      const listingGas = await publicClient.estimateGas({
        account: address as `0x${string}`,
        to: GreenFiSeed.address as `0x${string}`,
        data: listingData,
      });
      const listingCost = gasPrice ? formatEther(listingGas * gasPrice) : "0";
      setGasEstimate(`Listing: ~${listingCost} SepoliaETH`);
    } catch (err) {
      setGasEstimate("Unable to estimate gas.");
      console.error("Gas estimation error:", err);
    }
  }, [publicClient, address, price, contactInfo, description, strain, packSize, packQuantity, image, totalRequired, allowance, discount, gasPrice]);

  useEffect(() => {
    estimateGas();
  }, [estimateGas]);

  const FeeBreakdown = () => {
    const priceWei = parseEther(price || "0");
    const greenFiFee = (priceWei * BigInt(420)) / BigInt(10000);
    return (
      <div className="fee-breakdown">
        <p>Price per Pack: {(Number(priceWei) / 1e18).toFixed(4)} WEEDL</p>
        <p>Listing Fee (0.420%): {(Number(greenFiFee) / 1e18).toFixed(4)} WEEDL</p>
        <p>Total Required for Listing: {(Number(greenFiFee) / 1e18).toFixed(4)} WEEDL</p>
        {gasEstimate && <p>Estimated Network Fee: {gasEstimate}</p>}
        <p className="disclaimer">Note: The listing fee is non-refunded and covers the cost of listing your seed packs.</p>
      </div>
    );
  };

  const MetadataPreview = () => {
    const metadata: Metadata = {
      description: description || undefined,
      contact: contactInfo || undefined,
      disclaimer: "Please verify the authenticity of this listing before engaging.",
      strainType: strain || undefined,
      packSize: packSize ? Number(packSize) : undefined,
      packQuantity: packQuantity ? Number(packQuantity) : undefined,
      discount: discount ? Number(discount) : undefined,
      image: image ? URL.createObjectURL(image) : undefined,
    };
    return (
      <div className="metadata-preview">
        <h4>Preview</h4>
        {metadata.image && <img src={sanitizeHTML(metadata.image)} alt="Preview" className="preview-image" />}
        <p>Description: {sanitizeHTML(metadata.description || "N/A")}</p>
        <p>Contact: {sanitizeHTML(metadata.contact || "N/A")}</p>
        <p>Strain: {sanitizeHTML(metadata.strainType || "N/A")}</p>
        <p>Pack Size: {metadata.packSize !== undefined ? `${metadata.packSize} seeds per pack` : "N/A"}</p>
        <p>Number of Packs: {metadata.packQuantity !== undefined ? metadata.packQuantity : "N/A"}</p>
        <p>Total Seeds: {metadata.packSize && metadata.packQuantity ? metadata.packSize * metadata.packQuantity : "N/A"}</p>
        <p>Discount: {metadata.discount !== undefined ? `${metadata.discount}%` : "N/A"}</p>
      </div>
    );
  };

  useEffect(() => {
    if (writeData && transactionStep === "approving" && !approvalHash) {
      setApprovalHash(writeData);
      toast.info("Approval transaction submitted!");
    } else if (writeData && transactionStep === "listing" && !listingHash) {
      setListingHash(writeData);
      toast.info("Seed listing transaction submitted!");
    }
  }, [writeData, transactionStep, approvalHash, listingHash]);

  useEffect(() => {
    if (writeError) {
      setError(parseBlockchainError(writeError.message));
      setUploading(false);
      setTransactionStep("none");
    }
    if (approvalError) {
      setError(parseBlockchainError(approvalError.message));
      setUploading(false);
      setTransactionStep("none");
    }
    if (listingError) {
      if (listingError.message.includes("SeedIdInUse")) {
        setError("Seed ID is already in use. Retrying with a new ID...");
        setCid(null);
        setLastSeedId(null);
        setTransactionStep("approving");
      } else {
        setError(parseBlockchainError(listingError.message));
        setUploading(false);
        setTransactionStep("none");
      }
    }
    if (isApprovalConfirmed && approvalHash && cid && lastSeedId && transactionStep === "approving") {
      (async () => {
        try {
          await new Promise((resolve) => setTimeout(resolve, 5000));
          await refetchAllowance();
          if (!publicClient) {
            setError("Public client not available. Please try again.");
            setUploading(false);
            setTransactionStep("none");
            return;
          }
          const currentAllowance = (await publicClient.readContract({
            address: WEEDL.address as `0x${string}`,
            abi: WEEDL.abi,
            functionName: "allowance",
            args: [address as `0x${string}`, GreenFiSeed.address as `0x${string}`],
          })) as bigint;
          console.log(`Allowance after approval confirmation: ${(Number(currentAllowance) / 1e18).toFixed(4)} WEEDL`);

          const requiredWei = totalRequired();
          if (currentAllowance < requiredWei) {
            setError(`Insufficient allowance after approval. Expected ${(Number(requiredWei) / 1e18).toFixed(4)} WEEDL, got ${(Number(currentAllowance) / 1e18).toFixed(4)} WEEDL. Please approve again.`);
            setTransactionStep("approving");
            return;
          }

          const nonce = await getNextNonce();
          setTransactionStep("listing");
          writeContract({
            address: GreenFiSeed.address as `0x${string}`,
            abi: GreenFiSeed.abi,
            functionName: "listSeed",
            args: [lastSeedId, `ipfs://${cid}`, parseEther(price), contactInfo || "", strain || "", Number(packSize) || 0, Number(packQuantity) || 0, Number(discount || 0)],
            gas: listingGasEstimate ? listingGasEstimate + BigInt(100000) : BigInt(600000),
            account: address as `0x${string}`,
            nonce: nonce ?? undefined,
            maxFeePerGas: gasPrice ? gasPrice * BigInt(15) / BigInt(10) : undefined,
            maxPriorityFeePerGas: gasPrice ? gasPrice / BigInt(2) : undefined,
          });
        } catch (err) {
          setError("Failed to submit listing transaction after approval. Please try again.");
          console.error("Listing submission error:", err);
          setUploading(false);
          setTransactionStep("none");
        }
      })();
    }
    if (isListingConfirmed && listingHash) {
      setSuccess(true);
      toast.success("Seed pack listing created successfully!");
      setUploading(false);
      setImage(null);
      setDescription("");
      setContactInfo("");
      setPrice("");
      setPackSize("");
      setPackQuantity("");
      setDiscount("");
      setStrain("");
      setCid(null);
      setLastSeedId(null);
      setApprovalHash(undefined);
      setListingHash(undefined);
      setTransactionStep("none");
      setValidationErrors({});
      refetchBalance();
      refetchAllowance();
      console.log("Seed Listing Success! Transaction Hash:", listingHash);
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
    totalRequired,
    cid,
    lastSeedId,
    writeContract,
    address,
    price,
    contactInfo,
    strain,
    packSize,
    packQuantity,
    discount,
    listingGasEstimate,
    getNextNonce,
    gasPrice,
    transactionStep,
    publicClient,
    allowance,
    parseBlockchainError,
  ]);

  const handleManualApprove = useCallback(async () => {
    if (!publicClient || !address) {
      setError("Public client or wallet not available. Please try again.");
      return;
    }
    try {
      const requiredWei = totalRequired();
      const nonce = await getNextNonce();
      await writeContract({
        address: WEEDL.address as `0x${string}`,
        abi: WEEDL.abi,
        functionName: "approve",
        args: [GreenFiSeed.address as `0x${string}`, requiredWei],
        gas: approvalGasEstimate ? approvalGasEstimate + BigInt(20000) : BigInt(120000),
        account: address as `0x${string}`,
        nonce: nonce ?? undefined,
        maxFeePerGas: gasPrice ? gasPrice * BigInt(15) / BigInt(10) : undefined,
        maxPriorityFeePerGas: gasPrice ? gasPrice / BigInt(2) : undefined,
      });
      setError(null);
      toast.info(`Manual approval submitted for ${(Number(requiredWei) / 1e18).toFixed(4)} WEEDL`);
    } catch (err) {
      setError(parseBlockchainError("Failed to submit manual approval. Please try again."));
      console.error("Manual approval error:", err);
    }
  }, [publicClient, address, writeContract, approvalGasEstimate, gasPrice, getNextNonce, totalRequired, parseBlockchainError]);

  const validateInput = (field: string, value: string) => {
    const errors = { ...validationErrors };
    switch (field) {
      case "description":
        errors.description = value.length > 0 ? "" : "Description is required.";
        break;
      case "contactInfo":
        errors.contactInfo = value.length > 100 ? "Contact info must be 100 characters or less." : value.length > 0 ? "" : "Contact info is required.";
        break;
      case "strain":
        errors.strain = value.length > 0 ? "" : "Strain is required.";
        break;
      case "price":
        errors.price = !value || isNaN(Number(value)) || Number(value) < 0.0001 || Number(value) > 100 ? "Price must be a number between 0.0001 and 100 WEEDL." : "";
        break;
      case "packSize":
        errors.packSize = !value || ![3, 5, 10].includes(Number(value)) ? "Pack size must be 3, 5, or 10 seeds." : "";
        break;
      case "packQuantity":
        errors.packQuantity = !value || isNaN(Number(value)) || Number(value) <= 0 || Number(value) > 1000 ? "Number of packs must be between 1 and 1000." : "";
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

  const handleStrainChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const sanitized = await sanitizeHTML(e.target.value);
    if (sanitized !== undefined) {
      setStrain(sanitized);
      validateInput("strain", sanitized);
    } else {
      setStrain("");
      validateInput("strain", "");
    }
  };

  const handlePriceChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (value === "" || (/^\d*\.?\d*$/.test(value) && Number(value) <= 100)) {
      setPrice(value);
      validateInput("price", value);
    }
  };

  const handlePackSizeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    setPackSize(value);
    validateInput("packSize", value);
  };

  const handlePackQuantityChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (value === "" || (/^\d+$/.test(value) && Number(value) > 0 && Number(value) <= 1000)) {
      setPackQuantity(value);
      validateInput("packQuantity", value);
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

      try {
        if (!image) throw new Error("Please upload an image.");
        if (!description) throw new Error("Please provide a description.");
        if (!contactInfo) throw new Error("Please provide contact information.");
        if (contactInfo.length > 100) throw new Error("Contact info must be 100 characters or less.");
        if (!price || isNaN(Number(price)) || Number(price) < 0.0001) {
          throw new Error("Price must be at least 0.0001 WEEDL.");
        }
        if (!packSize || ![3, 5, 10].includes(Number(packSize))) {
          throw new Error("Pack size must be 3, 5, or 10 seeds.");
        }
        if (!packQuantity || isNaN(Number(packQuantity)) || Number(packQuantity) <= 0) {
          throw new Error("Number of packs must be a positive number (max 1000).");
        }
        if (discount && (isNaN(Number(discount)) || Number(discount) < 0 || Number(discount) > 50)) {
          throw new Error("Discount must be between 0 and 50%.");
        }
        if (!strain) throw new Error("Please provide a strain.");
        if (!address) throw new Error("Please connect your wallet.");
        if (!ethBalance || ethBalance.value < parseEther("0.001")) {
          throw new Error("Insufficient SepoliaETH for gas fees. Need at least 0.001 SepoliaETH.");
        }
        if (!publicClient) {
          throw new Error("Public client not available. Please try again.");
        }

        const hasPendingTx = await checkPendingTransactions();
        if (hasPendingTx) {
          throw new Error("Pending transactions detected. Please wait for them to confirm or replace them with a higher gas price.");
        }

        const requiredWei = totalRequired();
        console.log(`Required WEEDL for listing fee: ${(Number(requiredWei) / 1e18).toFixed(4)}`);

        if (!balance || balance < requiredWei) {
          throw new Error(
            `Insufficient WEEDL balance. Need ${(Number(requiredWei) / 1e18).toFixed(4)} WEEDL for listing fee, have ${
              balance ? (Number(balance) / 1e18).toFixed(4) : 0
            } WEEDL.`
          );
        }

        let seedId: string;
        let attempts = 0;
        const maxAttempts = 3;

        do {
          const fullUuid = uuidv4();
          seedId = `seed_${fullUuid.slice(0, 8)}`;
          if (seedId.length > 32) throw new Error("Generated seed ID is too long.");
          attempts++;
          try {
            const sanitizedSeedId = await sanitizeHTML(seedId) || "";
            const sanitizedDescription = await sanitizeHTML(description) || "";
            const sanitizedContactInfo = await sanitizeHTML(contactInfo) || "";
            const sanitizedStrain = await sanitizeHTML(strain) || "";

            const result = await uploadFile(image, {
              name: image.name,
              description: sanitizedDescription,
              contact: sanitizedContactInfo,
              disclaimer: "Please verify the authenticity of this listing before engaging.",
              strainType: sanitizedStrain,
              packSize: Number(packSize),
              packQuantity: Number(packQuantity),
              discount: Number(discount) || 0,
              image: image.name,
            });

            const uri = `ipfs://${result.cid}`;
            const httpUrl = convertCIDToURL(result.cid, import.meta.env.VITE_PINATA_GATEWAY!);
            setCid(result.cid);
            setLastSeedId(sanitizedSeedId);

            console.log("Submitting seed listing:", {
              seedId: sanitizedSeedId,
              uri,
              priceWei: parseEther(price).toString(),
              contactInfo: sanitizedContactInfo,
              strain: sanitizedStrain,
              packSize: Number(packSize),
              packQuantity: Number(packQuantity),
              discount: Number(discount || 0),
            });
            console.log("Metadata URL:", httpUrl);

            await new Promise((resolve) => setTimeout(resolve, 1000));
            await refetchAllowance();
            const currentAllowance = (await publicClient.readContract({
              address: WEEDL.address as `0x${string}`,
              abi: WEEDL.abi,
              functionName: "allowance",
              args: [address as `0x${string}`, GreenFiSeed.address as `0x${string}`],
            })) as bigint;
            console.log(`Allowance after refresh: ${(Number(currentAllowance) / 1e18).toFixed(4)} WEEDL`);

            let nonce = await getNextNonce();
            if (currentAllowance < requiredWei) {
              if (currentAllowance > 0n) {
                console.log("Resetting allowance to 0 before new approval");
                await writeContract({
                  address: WEEDL.address as `0x${string}`,
                  abi: WEEDL.abi,
                  functionName: "approve",
                  args: [GreenFiSeed.address as `0x${string}`, BigInt(0)],
                  gas: approvalGasEstimate ? approvalGasEstimate + BigInt(20000) : BigInt(120000),
                  account: address as `0x${string}`,
                  nonce: nonce ?? undefined,
                  maxFeePerGas: gasPrice ? gasPrice * BigInt(15) / BigInt(10) : undefined,
                  maxPriorityFeePerGas: gasPrice ? gasPrice / BigInt(2) : undefined,
                });
                await new Promise((resolve) => setTimeout(resolve, 2000));
                nonce = await getNextNonce();
              }

              console.log(`Approving ${(Number(requiredWei) / 1e18).toFixed(4)} WEEDL for GreenFiSeed contract`);
              writeContract({
                address: WEEDL.address as `0x${string}`,
                abi: WEEDL.abi,
                functionName: "approve",
                args: [GreenFiSeed.address as `0x${string}`, requiredWei],
                gas: approvalGasEstimate ? approvalGasEstimate + BigInt(20000) : BigInt(120000),
                account: address as `0x${string}`,
                nonce: nonce ?? undefined,
                maxFeePerGas: gasPrice ? gasPrice * BigInt(15) / BigInt(10) : undefined,
                maxPriorityFeePerGas: gasPrice ? gasPrice / BigInt(2) : undefined,
              });
              return;
            }

            setTransactionStep("listing");
            writeContract({
              address: GreenFiSeed.address as `0x${string}`,
              abi: GreenFiSeed.abi,
              functionName: "listSeed",
              args: [sanitizedSeedId, uri, parseEther(price), sanitizedContactInfo, sanitizedStrain, Number(packSize) || 0, Number(packQuantity) || 0, Number(discount || 0)],
              gas: listingGasEstimate ? listingGasEstimate + BigInt(100000) : BigInt(600000),
              account: address as `0x${string}`,
              nonce: nonce ?? undefined,
              maxFeePerGas: gasPrice ? gasPrice * BigInt(15) / BigInt(10) : undefined,
              maxPriorityFeePerGas: gasPrice ? gasPrice / BigInt(2) : undefined,
            });
            break;
          } catch (err: unknown) {
            if (err instanceof Error && err.message.includes("SeedIdInUse") && attempts < maxAttempts) {
              console.log(`Seed ID ${seedId} already in use. Retrying (${attempts}/${maxAttempts})...`);
              continue;
            }
            throw err instanceof Error ? err : new Error("Failed to generate a unique seed ID. Please try again later or contact support.");
          }
        } while (attempts < maxAttempts);

        if (attempts >= maxAttempts) {
          throw new Error("Failed to generate a unique seed ID after multiple attempts. Please try again later or contact support.");
        }
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? parseBlockchainError(err.message) : "Failed to upload metadata or list seed.";
        setError(errorMessage);
        console.error("Submission error:", err);
        setUploading(false);
        setTransactionStep("none");
      }
    },
    [
      image,
      description,
      contactInfo,
      price,
      packSize,
      packQuantity,
      discount,
      strain,
      balance,
      writeContract,
      address,
      ethBalance,
      totalRequired,
      refetchAllowance,
      approvalGasEstimate,
      listingGasEstimate,
      getNextNonce,
      gasPrice,
      publicClient,
      checkPendingTransactions,
      parseBlockchainError,
    ]
  );

  return (
    <form onSubmit={handleSubmit} className="description-item" role="form" aria-label="Seed Listing Form">
      <h3>List Seed Pack</h3>
      <p className="disclaimer">Disclaimer: Please verify the authenticity of all listings before engaging.</p>
      <p>Wallet: {sanitizeHTML(address ? `${address.slice(0, 6)}...${address.slice(-4)}` : "Not connected")}</p>
      {balance !== undefined && <p>WEEDL Balance: {(Number(balance) / 1e18).toFixed(4)} WEEDL</p>}
      {ethBalance && <p>SepoliaETH Balance: {(Number(ethBalance.value) / 1e18).toFixed(4)} SepoliaETH</p>}
      <div className="input-group">
        <input
          type="file"
          accept="image/*"
          onChange={(e) => setImage(e.target.files?.[0] || null)}
          required
          className="action-input"
          aria-label="Upload Seed Image"
        />
        {!image && <p className="validation-error">Image is required.</p>}
      </div>
      <div className="input-group">
        <input
          type="text"
          value={description}
          onChange={handleDescriptionChange}
          placeholder="Seed Description (e.g., Blue Dream, Indica)"
          required
          className="action-input"
          aria-label="Seed Description"
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
        />
        {validationErrors.contactInfo && <p className="validation-error">{validationErrors.contactInfo}</p>}
      </div>
      <div className="input-group">
        <input
          type="text"
          value={strain}
          onChange={handleStrainChange}
          placeholder="Seed Strain (e.g., OG Kush)"
          required
          className="action-input"
          aria-label="Seed Strain"
        />
        {validationErrors.strain && <p className="validation-error">{validationErrors.strain}</p>}
      </div>
      <div className="input-group">
        <input
          type="text"
          value={price}
          onChange={handlePriceChange}
          placeholder="Price per Pack (WEEDL, 0.0001-100)"
          required
          className="action-input"
          aria-label="Price per Pack in WEEDL"
        />
        {validationErrors.price && <p className="validation-error">{validationErrors.price}</p>}
      </div>
      <div className="input-group">
        <select
          value={packSize}
          onChange={handlePackSizeChange}
          required
          className="action-input"
          aria-label="Pack Size"
        >
          <option value="" disabled>
            Select Pack Size
          </option>
          {[3, 5, 10].map((size) => (
            <option key={size} value={size}>
              {size} Seeds per Pack
            </option>
          ))}
        </select>
        {validationErrors.packSize && <p className="validation-error">{validationErrors.packSize}</p>}
      </div>
      <div className="input-group">
        <input
          type="text"
          value={packQuantity}
          onChange={handlePackQuantityChange}
          placeholder="Number of Packs (1-1000)"
          required
          className="action-input"
          aria-label="Number of Packs"
        />
        {validationErrors.packQuantity && <p className="validation-error">{validationErrors.packQuantity}</p>}
      </div>
      <div className="input-group">
        <input
          type="text"
          value={discount}
          onChange={handleDiscountChange}
          placeholder="Discount % (0-50, optional)"
          className="action-input"
          aria-label="Discount Percentage"
        />
        {validationErrors.discount && <p className="validation-error">{validationErrors.discount}</p>}
      </div>
      <FeeBreakdown />
      <MetadataPreview />
      <button
        type="button"
        onClick={handleManualApprove}
        disabled={isPending || isApprovalConfirming || isListingConfirming}
        className="action-button"
        aria-label="Manually Approve WEEDL"
      >
        Approve WEEDL
      </button>
      <button
        type="submit"
        disabled={isPending || uploading || isApprovalConfirming || isListingConfirming || Object.values(validationErrors).some((e) => e)}
        className="action-button"
        aria-label="List Seed Pack"
      >
        {isApprovalConfirming
          ? "Approving WEEDL..."
          : isListingConfirming
            ? "Listing Seed Pack..."
            : isPending
              ? "Submitting..."
              : "List Seed Pack"}
      </button>
      {error && <p className="error" role="alert">{error}</p>}
      {success && <p className="success" role="alert">Seed pack listing created successfully!</p>}
    </form>
  );
}