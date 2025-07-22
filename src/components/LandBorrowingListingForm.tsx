import { useState, useEffect, FormEvent, useCallback } from "react";
import { useWriteContract, useWaitForTransactionReceipt, useReadContract, useAccount, useBalance, usePublicClient } from "wagmi";
import { parseEther, encodeFunctionData, formatEther } from "viem";
import { GreenFiBorrow, WEEDL } from "../config/contracts";
import { sanitizeHTML } from "../utils/security";
import { toast } from "react-toastify";

export default function LandBorrowingListingForm({ landId }: { landId?: string }) {
  const [amount, setAmount] = useState("");
  const [duration, setDuration] = useState("");
  const [contactInfo, setContactInfo] = useState("");
  const [purpose, setPurpose] = useState("");
  const [collateralInfo, setCollateralInfo] = useState("");
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [approvalHash, setApprovalHash] = useState<`0x${string}` | undefined>();
  const [listingHash, setListingHash] = useState<`0x${string}` | undefined>();
  const [transactionStep, setTransactionStep] = useState<"none" | "approving" | "listing">("none");
  const [isValidContact, setIsValidContact] = useState(true);
  const [isValidAmount, setIsValidAmount] = useState(true);
  const [isValidLatitude, setIsValidLatitude] = useState(true);
  const [isValidLongitude, setIsValidLongitude] = useState(true);
  const [gasEstimate, setGasEstimate] = useState<string | null>(null);

  const { address } = useAccount();
  const { writeContract, data: writeData, error: writeError, isPending } = useWriteContract();
  const { isLoading: isApprovalConfirming, isSuccess: isApprovalConfirmed, error: approvalError } = useWaitForTransactionReceipt({ hash: approvalHash });
  const { isLoading: isListingConfirming, isSuccess: isListingConfirmed, error: listingError } = useWaitForTransactionReceipt({ hash: listingHash });
  const publicClient = usePublicClient();

  const { data: balance, refetch: refetchBalance } = useReadContract({
    address: WEEDL.address as `0x${string}`,
    abi: WEEDL.abi,
    functionName: "balanceOf",
    args: [address || "0x0"],
  }) as { data: bigint | undefined; refetch: () => void };

  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: WEEDL.address as `0x${string}`,
    abi: WEEDL.abi,
    functionName: "allowance",
    args: [address || "0x0", GreenFiBorrow.address],
  }) as { data: bigint | undefined; refetch: () => void };

  const { data: ethBalance } = useBalance({ address });

  const calculateFee = (amount: string) => {
    const amountWei = parseEther(amount || "0");
    const feeWei = (amountWei * BigInt(42)) / BigInt(10000);
    return feeWei;
  };

  const estimateGas = useCallback(async () => {
    if (!publicClient || !address || !amount || !duration || !contactInfo || !purpose || !collateralInfo || !latitude || !longitude) {
      setGasEstimate(null);
      return;
    }

    try {
      const amountWei = parseEther(amount);
      const feeWei = calculateFee(amount);
      const totalRequired = amountWei + feeWei;
      const durationSeconds = BigInt(Number(duration) * 86400);
      const borrowId = `borrow_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      if (!allowance || allowance < totalRequired) {
        const approvalData = encodeFunctionData({
          abi: WEEDL.abi,
          functionName: "approve",
          args: [GreenFiBorrow.address, totalRequired],
        });

        const approvalGas = await publicClient.estimateGas({
          account: address as `0x${string}`,
          to: WEEDL.address as `0x${string}`,
          data: approvalData,
        });

        const gasPrice = await publicClient.getGasPrice();
        const approvalCost = formatEther(approvalGas * gasPrice);
        setGasEstimate(`Approval: ~${approvalCost} SepoliaETH`);
        return;
      }

      const borrowingData = encodeFunctionData({
        abi: GreenFiBorrow.abi,
        functionName: "createBorrowing",
        args: [
          borrowId,
          landId || "",
          amountWei,
          durationSeconds,
          contactInfo,
          purpose,
          collateralInfo,
          latitude,
          longitude,
        ],
      });

      const borrowingGas = await publicClient.estimateGas({
        account: address as `0x${string}`,
        to: GreenFiBorrow.address as `0x${string}`,
        data: borrowingData,
      });

      const gasPrice = await publicClient.getGasPrice();
      const borrowingCost = formatEther(borrowingGas * gasPrice);
      setGasEstimate(`Create Borrowing: ~${borrowingCost} SepoliaETH`);
    } catch (err) {
      setGasEstimate("Unable to estimate gas.");
      console.error("Gas estimation error:", err);
    }
  }, [amount, duration, contactInfo, purpose, collateralInfo, latitude, longitude, allowance, address, publicClient, landId]);

  useEffect(() => {
    estimateGas();
  }, [estimateGas]);

  useEffect(() => {
    if (writeData && transactionStep === "approving" && !approvalHash) {
      setApprovalHash(writeData);
      toast.info("Approval transaction submitted!");
    } else if (writeData && transactionStep === "listing" && !listingHash) {
      setListingHash(writeData);
      toast.info("Borrowing creation transaction submitted!");
    }
  }, [writeData, transactionStep, approvalHash, listingHash]);

  useEffect(() => {
    if (writeError) {
      setError(parseBlockchainError(writeError.message) || "Transaction failed.");
      setTransactionStep("none");
    }
    if (approvalError) {
      setError(parseBlockchainError(approvalError.message) || "Approval transaction failed.");
      setTransactionStep("none");
    }
    if (listingError) {
      setError(parseBlockchainError(listingError.message) || "Listing transaction failed.");
      setTransactionStep("none");
    }
    if (isListingConfirmed && listingHash) {
      setSuccess(true);
      toast.success("Borrowing created successfully!");
      setAmount("");
      setDuration("");
      setContactInfo("");
      setPurpose("");
      setCollateralInfo("");
      setLatitude("");
      setLongitude("");
      setApprovalHash(undefined);
      setListingHash(undefined);
      setTransactionStep("none");
      refetchBalance();
      refetchAllowance();
    }
  }, [writeError, approvalError, listingError, isListingConfirmed, listingHash, refetchBalance, refetchAllowance]);

  const parseBlockchainError = (message: string): string => {
    if (message.includes("User rejected")) return "Transaction rejected by user.";
    if (message.includes("Insufficient funds")) return "Insufficient funds for gas fees.";
    if (message.includes("Amount must be greater than 0")) return "Loan amount must be greater than 0.";
    if (message.includes("Duration must be between 1 and 365 days")) return "Duration must be between 1 and 365 days.";
    if (message.includes("Borrowing ID already exists")) return "Borrowing ID already exists.";
    return message || "Unknown error occurred.";
  };

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (value === "" || (/^\d*\.?\d*$/.test(value) && Number(value) <= 100 && Number(value) > 0)) {
      setAmount(value);
      setIsValidAmount(true);
      setError(null);
    } else {
      setIsValidAmount(false);
      setError("Amount must be a positive number up to 100 WEEDL.");
    }
  };

  const handleDurationChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (value === "" || (/^\d+$/.test(value) && Number(value) <= 365 && Number(value) > 0)) {
      setDuration(value);
      setError(null);
    } else {
      setError("Duration must be a positive integer between 1 and 365 days.");
    }
  };

  const handleContactChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    const sanitized = await sanitizeHTML(value);
    const isValid = value === "" || /^[\w-.]+@([\w-]+\.)+[\w-]{2,4}$|^https?:\/\/.+$/.test(value);
    setIsValidContact(isValid);
    setContactInfo(sanitized);
    if (!isValid && value !== "") {
      setError("Please enter a valid email or website URL.");
    } else {
      setError(null);
    }
  };

  const handlePurposeChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    const sanitized = await sanitizeHTML(value.slice(0, 200));
    setPurpose(sanitized);
    if (value.length > 200) {
      setError("Purpose cannot exceed 200 characters.");
    } else {
      setError(null);
    }
  };

  const handleCollateralChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    const sanitized = await sanitizeHTML(value.slice(0, 200));
    setCollateralInfo(sanitized);
    if (value.length > 200) {
      setError("Collateral details cannot exceed 200 characters.");
    } else {
      setError(null);
    }
  };

  const handleLatitudeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (value === "" || (/^-?\d*\.?\d*$/.test(value) && Number(value) >= -90 && Number(value) <= 90)) {
      setLatitude(value);
      setIsValidLatitude(true);
      setError(null);
    } else {
      setIsValidLatitude(false);
      setError("Latitude must be between -90 and 90 degrees.");
    }
  };

  const handleLongitudeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (value === "" || (/^-?\d*\.?\d*$/.test(value) && Number(value) >= -180 && Number(value) <= 180)) {
      setLongitude(value);
      setIsValidLongitude(true);
      setError(null);
    } else {
      setIsValidLongitude(false);
      setError("Longitude must be between -180 and 180 degrees.");
    }
  };

  const handleViewOnGoogleMaps = () => {
    const lat = parseFloat(latitude);
    const lon = parseFloat(longitude);
    if (!isNaN(lat) && !isNaN(lon) && isValidLatitude && isValidLongitude) {
      const mapsUrl = `https://www.google.com/maps?q=${encodeURIComponent(latitude)},${encodeURIComponent(longitude)}`;
      window.open(mapsUrl, "_blank", "noopener,noreferrer");
    } else {
      toast.error("Please enter valid latitude and longitude values.");
    }
  };

  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      setError(null);
      setSuccess(false);
      setTransactionStep("approving");

      try {
        if (!amount || isNaN(Number(amount)) || Number(amount) <= 0 || Number(amount) > 100) {
          throw new Error("Amount must be a positive number up to 100 WEEDL.");
        }
        if (!duration || isNaN(Number(duration)) || Number(duration) <= 0 || Number(duration) > 365) {
          throw new Error("Duration must be a positive integer (max 365 days).");
        }
        if (!contactInfo || !isValidContact) {
          throw new Error("Please provide a valid email or website URL.");
        }
        if (!purpose) {
          throw new Error("Please provide a borrowing purpose.");
        }
        if (!collateralInfo) {
          throw new Error("Please provide collateral details.");
        }
        if (!latitude || !isValidLatitude) {
          throw new Error("Please provide a valid latitude (-90 to 90).");
        }
        if (!longitude || !isValidLongitude) {
          throw new Error("Please provide a valid longitude (-180 to 180).");
        }
        if (!address) {
          throw new Error("Please connect your wallet.");
        }
        if (!ethBalance || ethBalance.value < parseEther("0.001")) {
          throw new Error("Insufficient SepoliaETH for gas fees. Need at least 0.001 SepoliaETH.");
        }

        const amountWei = parseEther(amount);
        const feeWei = calculateFee(amount);
        const totalRequired = amountWei + feeWei;
        const durationSeconds = BigInt(Number(duration) * 86400);

        if (!balance || balance < totalRequired) {
          throw new Error(
            `Insufficient WEEDL balance. Need ${(Number(totalRequired) / 1e18).toFixed(4)} WEEDL, have ${
              balance ? (Number(balance) / 1e18).toFixed(4) : 0
            } WEEDL.`
          );
        }

        const sanitizedContactInfo = await sanitizeHTML(contactInfo);
        const sanitizedPurpose = await sanitizeHTML(purpose);
        const sanitizedCollateralInfo = await sanitizeHTML(collateralInfo);
        const borrowId = `borrow_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

        if (!allowance || allowance < totalRequired) {
          writeContract({
            address: WEEDL.address as `0x${string}`,
            abi: WEEDL.abi,
            functionName: "approve",
            args: [GreenFiBorrow.address, totalRequired],
            gas: BigInt(100000),
            account: address,
          });
          return;
        }

        setTransactionStep("listing");
        writeContract({
          address: GreenFiBorrow.address as `0x${string}`,
          abi: GreenFiBorrow.abi,
          functionName: "createBorrowing",
          args: [
            borrowId,
            landId || "",
            amountWei,
            durationSeconds,
            sanitizedContactInfo,
            sanitizedPurpose,
            sanitizedCollateralInfo,
            latitude,
            longitude,
          ],
          gas: BigInt(500000),
          account: address,
        });
      } catch (err: unknown) {
        setError(err instanceof Error ? parseBlockchainError(err.message) : "Failed to list borrowing.");
        setTransactionStep("none");
      }
    },
    [
      amount,
      duration,
      contactInfo,
      purpose,
      collateralInfo,
      latitude,
      longitude,
      balance,
      allowance,
      writeContract,
      address,
      ethBalance,
      landId,
      isValidContact,
      isValidLatitude,
      isValidLongitude,
    ]
  );

  useEffect(() => {
    if (isApprovalConfirmed && approvalHash && transactionStep === "approving") {
      setTransactionStep("listing");
      const borrowId = `borrow_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const durationSeconds = BigInt(Number(duration) * 86400);
      writeContract({
        address: GreenFiBorrow.address as `0x${string}`,
        abi: GreenFiBorrow.abi,
        functionName: "createBorrowing",
        args: [
          borrowId,
          landId || "",
          parseEther(amount),
          durationSeconds,
          contactInfo,
          purpose,
          collateralInfo,
          latitude,
          longitude,
        ],
        gas: BigInt(500000),
        account: address,
      });
    }
  }, [
    isApprovalConfirmed,
    approvalHash,
    amount,
    duration,
    contactInfo,
    purpose,
    collateralInfo,
    latitude,
    longitude,
    writeContract,
    address,
    transactionStep,
    landId,
  ]);

  return (
    <section className="description-item" role="form" aria-labelledby="create-borrowing-title">
      <h3 id="create-borrowing-title">Create Land Borrowing</h3>
      <p className="disclaimer" role="alert">
        Disclaimer: Please verify the authenticity of all listings before engaging.
      </p>
      <p>Wallet: {sanitizeHTML(address ? `${address.slice(0, 6)}...${address.slice(-4)}` : "Not connected")}</p>
      {balance !== undefined && <p>WEEDL Balance: {(Number(balance) / 1e18).toFixed(4)} WEEDL</p>}
      {ethBalance && <p>SepoliaETH Balance: {(Number(ethBalance.value) / 1e18).toFixed(4)} SepoliaETH</p>}
      {amount && isValidAmount && (
        <p>Fee: {(Number(calculateFee(amount)) / 1e18).toFixed(4)} WEEDL (0.420%)</p>
      )}
      {gasEstimate && (
        <p className="gas-estimate" aria-label="Estimated gas cost">
          {gasEstimate}
        </p>
      )}
      <form onSubmit={handleSubmit}>
        <div className="input-group">
          <label htmlFor="amount-input">Loan Amount (WEEDL, max 100)</label>
          <input
            id="amount-input"
            type="text"
            value={amount}
            onChange={handleAmountChange}
            placeholder="e.g., 50.00"
            required
            className={`action-input ${!isValidAmount ? "invalid" : ""}`}
            aria-label="Loan Amount"
            aria-describedby="amount-error"
            title="Enter the loan amount in WEEDL (up to 100)"
          />
        </div>
        <div className="input-group">
          <label htmlFor="duration-input">Borrowing Duration (days, max 365)</label>
          <input
            id="duration-input"
            type="text"
            value={duration}
            onChange={handleDurationChange}
            placeholder="e.g., 30"
            required
            className="action-input"
            aria-label="Borrowing Duration"
            aria-describedby="duration-error"
            title="Enter the borrowing duration in days (1 to 365)"
          />
        </div>
        <div className="input-group">
          <label htmlFor="contact-input">Contact Info (email or website)</label>
          <input
            id="contact-input"
            type="text"
            value={contactInfo}
            onChange={handleContactChange}
            placeholder="e.g., user@example.com"
            required
            className={`action-input ${!isValidContact ? "invalid" : ""}`}
            aria-label="Contact Information"
            aria-describedby="contact-error"
            title="Enter a valid email or website URL"
          />
        </div>
        <div className="input-group">
          <label htmlFor="purpose-input">Borrowing Purpose</label>
          <input
            id="purpose-input"
            type="text"
            value={purpose}
            onChange={handlePurposeChange}
            placeholder="e.g., Farming equipment"
            required
            className="action-input"
            aria-label="Borrowing Purpose"
            aria-describedby="purpose-error"
            title="Describe the purpose of the borrowing (max 200 characters)"
          />
        </div>
        <div className="input-group">
          <label htmlFor="collateral-input">Collateral Details</label>
          <input
            id="collateral-input"
            type="text"
            value={collateralInfo}
            onChange={handleCollateralChange}
            placeholder="e.g., 5 acres land or NFT:0x123...|tokenId"
            required
            className="action-input"
            aria-label="Collateral Details"
            aria-describedby="collateral-error"
            title="Provide collateral details (max 200 characters)"
          />
        </div>
        <div className="input-group coordinates-group">
          <label htmlFor="latitude-input">Latitude</label>
          <input
            id="latitude-input"
            type="text"
            value={latitude}
            onChange={handleLatitudeChange}
            placeholder="e.g., 40.7128"
            required
            className={`action-input ${!isValidLatitude ? "invalid" : ""}`}
            aria-label="Latitude"
            aria-describedby="latitude-error"
            title="Enter latitude between -90 and 90 degrees"
          />
        </div>
        <div className="input-group coordinates-group">
          <label htmlFor="longitude-input">Longitude</label>
          <input
            id="longitude-input"
            type="text"
            value={longitude}
            onChange={handleLongitudeChange}
            placeholder="e.g., -74.0060"
            required
            className={`action-input ${!isValidLongitude ? "invalid" : ""}`}
            aria-label="Longitude"
            aria-describedby="longitude-error"
            title="Enter longitude between -180 and 180 degrees"
          />
        </div>
        <div className="button-group">
          <button
            type="button"
            onClick={handleViewOnGoogleMaps}
            disabled={!isValidLatitude || !isValidLongitude || !latitude || !longitude}
            className="action-button"
            aria-label="Preview location on Google Maps"
          >
            View on Google Maps
          </button>
          <button
            type="submit"
            disabled={isPending || isApprovalConfirming || isListingConfirming || !isValidContact || !isValidAmount || !isValidLatitude || !isValidLongitude}
            className="action-button"
            aria-label="Create Borrowing"
          >
            {isApprovalConfirming
              ? "Approving WEEDL..."
              : isListingConfirming
              ? "Creating Borrowing..."
              : isPending
              ? "Submitting..."
              : "Create Borrowing"}
          </button>
        </div>
      </form>
      {error && (
        <p id="form-error" className="error" role="alert" aria-live="assertive">
          {error}
        </p>
      )}
      {success && (
        <p className="success" role="alert" aria-live="assertive">
          Borrowing created successfully! Lenders can now contribute.
        </p>
      )}
    </section>
  );
}