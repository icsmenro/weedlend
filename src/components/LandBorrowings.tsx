import { useState, useEffect, useCallback } from "react";
import { useReadContract, useWriteContract, useWaitForTransactionReceipt, usePublicClient, useWatchContractEvent } from "wagmi";
import { parseEther, encodeFunctionData, formatEther } from "viem";
import { GreenFiBorrow, WEEDL } from "../config/contracts";
import { sanitizeHTML } from "../utils/security";
import { toast } from "react-toastify";

interface Borrowing {
  id: string;
  borrower: string;
  landId: string;
  amount: bigint;
  fee: bigint;
  duration: bigint;
  startTime: bigint;
  isActive: boolean;
  contactInfo: string;
  purpose: string;
  collateralInfo: string;
  latitude: string;
  longitude: string;
  totalLent: bigint;
  totalRepaid: bigint;
}

export default function LandBorrowings({ address }: { address: string }) {
  const [borrowings, setBorrowings] = useState<Borrowing[]>([]);
  const [filteredBorrowings, setFilteredBorrowings] = useState<Borrowing[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "myBorrowings">("all");
  const [sortBy, setSortBy] = useState<"amount" | "duration" | "startTime" | "totalLent" | "totalRepaid">("startTime");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(5);
  const [amountFilter, setAmountFilter] = useState("");
  const [locationFilter, setLocationFilter] = useState("");

  const { data: borrowData, error: borrowError, refetch } = useReadContract({
    address: GreenFiBorrow.address as `0x${string}`,
    abi: GreenFiBorrow.abi,
    functionName: filter === "all" ? "getAllBorrowings" : "getUserBorrowings",
    args: filter === "myBorrowings" ? [address] : [],
  });

  useWatchContractEvent({
    address: GreenFiBorrow.address as `0x${string}`,
    abi: GreenFiBorrow.abi,
    eventName: "BorrowingCreated",
    onLogs: () => {
      toast.info("New borrowing created!");
      refetch();
    },
  });

  useWatchContractEvent({
    address: GreenFiBorrow.address as `0x${string}`,
    abi: GreenFiBorrow.abi,
    eventName: "BorrowingEnded",
    onLogs: () => {
      toast.info("A borrowing has ended!");
      refetch();
    },
  });

  useWatchContractEvent({
    address: GreenFiBorrow.address as `0x${string}`,
    abi: GreenFiBorrow.abi,
    eventName: "LentToBorrowing",
    onLogs: () => {
      toast.info("New lending contribution made!");
      refetch();
    },
  });

  useWatchContractEvent({
    address: GreenFiBorrow.address as `0x${string}`,
    abi: GreenFiBorrow.abi,
    eventName: "RepaidBorrowing",
    onLogs: () => {
      toast.info("Borrowing repayment made!");
      refetch();
    },
  });

  useEffect(() => {
    if (borrowError) {
      toast.error("Failed to fetch borrowings: " + (borrowError.message || "Unknown error"));
      setIsLoading(false);
      return;
    }
    if (borrowData) {
      const activeBorrowings = (borrowData as Borrowing[]).filter((borrowing) => borrowing.isActive);
      setBorrowings(activeBorrowings);
      setIsLoading(false);
    }
  }, [borrowData, borrowError]);

  useEffect(() => {
    let filtered = [...borrowings];
    if (amountFilter) {
      const amountWei = parseEther(amountFilter || "0");
      filtered = filtered.filter((borrowing) => borrowing.amount >= amountWei);
    }
    if (locationFilter) {
      filtered = filtered.filter(
        (borrowing) =>
          borrowing.latitude.includes(locationFilter) || borrowing.longitude.includes(locationFilter)
      );
    }
    const sorted = filtered.sort((a, b) => {
      const multiplier = sortOrder === "asc" ? 1 : -1;
      if (sortBy === "amount") return Number(a.amount - b.amount) * multiplier;
      if (sortBy === "duration") return Number(a.duration - b.duration) * multiplier;
      if (sortBy === "totalLent") return Number(a.totalLent - b.totalLent) * multiplier;
      if (sortBy === "totalRepaid") return Number(a.totalRepaid - b.totalRepaid) * multiplier;
      return Number(a.startTime - b.startTime) * multiplier;
    });
    setFilteredBorrowings(sorted);
  }, [borrowings, sortBy, sortOrder, amountFilter, locationFilter]);

  const handleFilterChange = (newFilter: "all" | "myBorrowings") => {
    setFilter(newFilter);
    setCurrentPage(1);
    refetch();
  };

  const handleSortChange = (newSortBy: "amount" | "duration" | "startTime" | "totalLent" | "totalRepaid") => {
    setSortBy(newSortBy);
    setSortOrder(sortBy === newSortBy && sortOrder === "asc" ? "desc" : "asc");
  };

  const handleExport = () => {
    const dataStr = JSON.stringify(filteredBorrowings, null, 2);
    const blob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `borrowings_${filter}_${Date.now()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const indexOfLastItem = currentPage * itemsPerPage;
  const indexOfFirstItem = indexOfLastItem - itemsPerPage;
  const currentItems = filteredBorrowings.slice(indexOfFirstItem, indexOfLastItem);
  const totalPages = Math.ceil(filteredBorrowings.length / itemsPerPage);

  return (
    <section className="land-borrowings" role="region" aria-label="Land Borrowings Management">
      <h3 id="land-borrowings-title">Active Land Borrowings</h3>
      <div className="controls">
        <div className="filter-group">
          <label htmlFor="filter">Filter:</label>
          <select
            id="filter"
            value={filter}
            onChange={(e) => handleFilterChange(e.target.value as "all" | "myBorrowings")}
            className="action-input"
            aria-label="Filter Borrowings"
          >
            <option value="all">All Borrowings</option>
            <option value="myBorrowings">My Borrowings</option>
          </select>
        </div>
        <div className="filter-group">
          <label htmlFor="amount-filter">Min Amount (WEEDL):</label>
          <input
            id="amount-filter"
            type="text"
            value={amountFilter}
            onChange={(e) => setAmountFilter(e.target.value)}
            placeholder="e.g., 10.00"
            className="action-input"
            aria-label="Filter by Minimum Amount"
            title="Filter by minimum loan amount in WEEDL"
          />
        </div>
        <div className="filter-group">
          <label htmlFor="location-filter">Location (Lat/Lon):</label>
          <input
            id="location-filter"
            type="text"
            value={locationFilter}
            onChange={(e) => setLocationFilter(e.target.value)}
            placeholder="e.g., 40.7128"
            className="action-input"
            aria-label="Filter by Location"
            title="Filter by latitude or longitude"
          />
        </div>
        <div className="sort-group">
          <label htmlFor="sort">Sort By:</label>
          <select
            id="sort"
            value={sortBy}
            onChange={(e) => handleSortChange(e.target.value as "amount" | "duration" | "startTime" | "totalLent" | "totalRepaid")}
            className="action-input"
            aria-label="Sort Borrowings"
          >
            <option value="amount">Amount</option>
            <option value="duration">Duration</option>
            <option value="startTime">Start Time</option>
            <option value="totalLent">Total Lent</option>
            <option value="totalRepaid">Total Repaid</option>
          </select>
          <button
            onClick={() => setSortOrder(sortOrder === "asc" ? "desc" : "asc")}
            className="action-button"
            aria-label={`Sort ${sortOrder === "asc" ? "Descending" : "Ascending"}`}
          >
            {sortOrder === "asc" ? "↑" : "↓"}
          </button>
        </div>
        <button onClick={handleExport} className="action-button" aria-label="Export Borrowings as JSON">
          Export as JSON
        </button>
      </div>
      {isLoading ? (
        <p>Loading borrowings...</p>
      ) : filteredBorrowings.length > 0 ? (
        <>
          <div className="grid" role="grid" aria-label="Grid of land borrowings">
            {currentItems.map((borrowing) => (
              <BorrowingItem key={borrowing.id} borrowing={borrowing} address={address} onEndSuccess={refetch} />
            ))}
          </div>
          <div className="pagination">
            <button
              onClick={() => setCurrentPage((prev) => Math.max(prev - 1, 1))}
              disabled={currentPage === 1}
              className="action-button"
              aria-label="Previous Page"
            >
              Previous
            </button>
            <span aria-label={`Page ${currentPage} of ${totalPages}`}>
              Page {currentPage} of {totalPages}
            </span>
            <button
              onClick={() => setCurrentPage((prev) => Math.min(prev + 1, totalPages))}
              disabled={currentPage === totalPages}
              className="action-button"
              aria-label="Next Page"
            >
              Next
            </button>
          </div>
        </>
      ) : (
        <p>No active land borrowings.</p>
      )}
    </section>
  );
}

function BorrowingItem({ borrowing, address, onEndSuccess }: { borrowing: Borrowing; address: string; onEndSuccess: () => void }) {
  const { writeContract, isPending, error: writeError, data: writeData } = useWriteContract();
  const { isLoading: isConfirming } = useWaitForTransactionReceipt({ hash: writeData });
  const [showConfirm, setShowConfirm] = useState<"end" | "lend" | "repay" | null>(null);
  const [lendAmount, setLendAmount] = useState("");
  const [repayAmount, setRepayAmount] = useState("");
  const [lendGasEstimate, setLendGasEstimate] = useState<string | null>(null);
  const [repayGasEstimate, setRepayGasEstimate] = useState<string | null>(null);
  const [collateralVerified, setCollateralVerified] = useState(false);
  const publicClient = usePublicClient();

  const { data: collateralOwner } = useReadContract({
    address: borrowing.collateralInfo.includes("|") ? (borrowing.collateralInfo.split("|")[0] as `0x${string}`) : undefined,
    abi: [
      {
        name: "ownerOf",
        type: "function",
        inputs: [{ name: "tokenId", type: "uint256" }],
        outputs: [{ name: "", type: "address" }],
      },
    ],
    functionName: "ownerOf",
    args: borrowing.collateralInfo.includes("|") ? [BigInt(borrowing.collateralInfo.split("|")[1])] : undefined,
  }) as { data: `0x${string}` | undefined };

  const { data: lenderContribution } = useReadContract({
    address: GreenFiBorrow.address as `0x${string}`,
    abi: GreenFiBorrow.abi,
    functionName: "getLenderContribution",
    args: [borrowing.id, address],
  }) as { data: bigint | undefined };

  const { data: balance } = useReadContract({
    address: WEEDL.address as `0x${string}`,
    abi: WEEDL.abi,
    functionName: "balanceOf",
    args: [address],
  }) as { data: bigint | undefined };

  useEffect(() => {
    if (borrowing.collateralInfo.includes("|") && collateralOwner) {
      setCollateralVerified(collateralOwner.toLowerCase() === borrowing.borrower.toLowerCase());
    } else {
      setCollateralVerified(false);
    }
  }, [collateralOwner, borrowing.collateralInfo, borrowing.borrower]);

  const estimateLendGas = useCallback(async () => {
    if (!publicClient || !lendAmount || isNaN(Number(lendAmount)) || Number(lendAmount) <= 0) {
      setLendGasEstimate(null);
      return;
    }

    try {
      const amountWei = parseEther(lendAmount);
      const lendData = encodeFunctionData({
        abi: GreenFiBorrow.abi,
        functionName: "lendToBorrowing",
        args: [borrowing.id, amountWei],
      });

      const lendGas = await publicClient.estimateGas({
        account: address as `0x${string}`,
        to: GreenFiBorrow.address as `0x${string}`,
        data: lendData,
      });

      const gasPrice = await publicClient.getGasPrice();
      const lendCost = formatEther(lendGas * gasPrice);
      setLendGasEstimate(`Lend: ~${lendCost} SepoliaETH`);
    } catch (err) {
      setLendGasEstimate("Unable to estimate gas.");
      console.error("Lend gas estimation error:", err);
    }
  }, [lendAmount, address, borrowing.id, publicClient]);

  const estimateRepayGas = useCallback(async () => {
    if (!publicClient || !repayAmount || isNaN(Number(repayAmount)) || Number(repayAmount) <= 0) {
      setRepayGasEstimate(null);
      return;
    }

    try {
      const amountWei = parseEther(repayAmount);
      const repayData = encodeFunctionData({
        abi: GreenFiBorrow.abi,
        functionName: "repayBorrowing",
        args: [borrowing.id, amountWei],
      });

      const repayGas = await publicClient.estimateGas({
        account: address as `0x${string}`,
        to: GreenFiBorrow.address as `0x${string}`,
        data: repayData,
      });

      const gasPrice = await publicClient.getGasPrice();
      const repayCost = formatEther(repayGas * gasPrice);
      setRepayGasEstimate(`Repay: ~${repayCost} SepoliaETH`);
    } catch (err) {
      setRepayGasEstimate("Unable to estimate gas.");
      console.error("Repay gas estimation error:", err);
    }
  }, [repayAmount, address, borrowing.id, publicClient]);

  useEffect(() => {
    if (lendAmount) estimateLendGas();
  }, [lendAmount, estimateLendGas]);

  useEffect(() => {
    if (repayAmount) estimateRepayGas();
  }, [repayAmount, estimateRepayGas]);

  const handleEndBorrowing = () => {
    setShowConfirm("end");
  };

  const confirmEndBorrowing = () => {
    writeContract(
      {
        address: GreenFiBorrow.address as `0x${string}`,
        abi: GreenFiBorrow.abi,
        functionName: "endBorrowing",
        args: [borrowing.id],
        gas: BigInt(200000),
      },
      {
        onSuccess: () => {
          toast.success("Borrowing ended successfully!");
          setShowConfirm(null);
          onEndSuccess();
        },
        onError: (error) => toast.error(parseBlockchainError(error.message) || "Failed to end borrowing."),
      }
    );
  };

  const handleLend = () => {
    if (!lendAmount || isNaN(Number(lendAmount)) || Number(lendAmount) <= 0) {
      toast.error("Please enter a valid lending amount.");
      return;
    }
    if (balance && parseEther(lendAmount) > balance) {
      toast.error("Insufficient WEEDL balance for lending.");
      return;
    }
    if (Number(lendAmount) > Number(borrowing.amount - borrowing.totalLent) / 1e18) {
      toast.error("Lending amount exceeds remaining borrowing amount.");
      return;
    }
    setShowConfirm("lend");
  };

  const confirmLend = () => {
    writeContract(
      {
        address: GreenFiBorrow.address as `0x${string}`,
        abi: GreenFiBorrow.abi,
        functionName: "lendToBorrowing",
        args: [borrowing.id, parseEther(lendAmount)],
        gas: BigInt(300000),
      },
      {
        onSuccess: () => {
          toast.success(`Successfully lent ${lendAmount} WEEDL!`);
          setShowConfirm(null);
          setLendAmount("");
          onEndSuccess();
        },
        onError: (error) => toast.error(parseBlockchainError(error.message) || "Failed to lend."),
      }
    );
  };

  const handleRepay = () => {
    if (!repayAmount || isNaN(Number(repayAmount)) || Number(repayAmount) <= 0) {
      toast.error("Please enter a valid repayment amount.");
      return;
    }
    if (balance && parseEther(repayAmount) > balance) {
      toast.error("Insufficient WEEDL balance for repayment.");
      return;
    }
    if (Number(repayAmount) > Number(borrowing.totalLent - borrowing.totalRepaid) / 1e18) {
      toast.error("Repayment amount exceeds lent amount.");
      return;
    }
    setShowConfirm("repay");
  };

  const confirmRepay = () => {
    writeContract(
      {
        address: GreenFiBorrow.address as `0x${string}`,
        abi: GreenFiBorrow.abi,
        functionName: "repayBorrowing",
        args: [borrowing.id, parseEther(repayAmount)],
        gas: BigInt(400000),
      },
      {
        onSuccess: () => {
          toast.success(`Successfully repaid ${repayAmount} WEEDL!`);
          setShowConfirm(null);
          setRepayAmount("");
          onEndSuccess();
        },
        onError: (error) => toast.error(parseBlockchainError(error.message) || "Failed to repay."),
      }
    );
  };

  const handleViewOnGoogleMaps = () => {
    const lat = parseFloat(borrowing.latitude);
    const lon = parseFloat(borrowing.longitude);
    if (!isNaN(lat) && !isNaN(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
      const mapsUrl = `https://www.google.com/maps?q=${encodeURIComponent(borrowing.latitude)},${encodeURIComponent(borrowing.longitude)}`;
      window.open(mapsUrl, "_blank", "noopener,noreferrer");
    } else {
      toast.error("Invalid latitude or longitude values.");
    }
  };

  const parseBlockchainError = (message: string): string => {
    if (message.includes("User rejected")) return "Transaction rejected by user.";
    if (message.includes("Insufficient funds")) return "Insufficient funds for gas fees.";
    if (message.includes("Borrowing is not active")) return "This borrowing is no longer active.";
    if (message.includes("Only borrower can")) return "Only the borrower can perform this action.";
    if (message.includes("Lend amount must be greater than 0")) return "Lend amount must be greater than 0.";
    if (message.includes("Repay amount must be greater than 0")) return "Repay amount must be greater than 0.";
    if (message.includes("Lending exceeds requested amount")) return "Lending amount exceeds the remaining borrowing amount.";
    if (message.includes("Repayment exceeds lent amount")) return "Repayment amount exceeds the total lent amount.";
    if (message.includes("Borrowing duration has expired")) return "Borrowing duration has expired.";
    return message || "Unknown error occurred.";
  };

  const isValidCoordinates =
    !isNaN(parseFloat(borrowing.latitude)) &&
    !isNaN(parseFloat(borrowing.longitude)) &&
    parseFloat(borrowing.latitude) >= -90 &&
    parseFloat(borrowing.latitude) <= 90 &&
    parseFloat(borrowing.longitude) >= -180 &&
    parseFloat(borrowing.longitude) <= 180;

  const remainingTime = Number(borrowing.startTime) + Number(borrowing.duration) - Math.floor(Date.now() / 1000);
  const remainingDays = Math.max(0, Math.floor(remainingTime / 86400));
  const remainingHours = Math.max(0, Math.floor((remainingTime % 86400) / 3600));

  return (
    <section className="description-item" role="row" aria-labelledby={`borrowing-${borrowing.id}`}>
      <h4 id={`borrowing-${borrowing.id}`}>Borrowing {sanitizeHTML(borrowing.id)}</h4>
      <p className="disclaimer" role="alert">
        Disclaimer: Please verify the authenticity of this borrowing before engaging.
      </p>
      <p>Land ID: {sanitizeHTML(borrowing.landId)}</p>
      <p>Loan Amount: {(Number(borrowing.amount) / 1e18).toFixed(4)} WEEDL</p>
      <p>Total Lent: {(Number(borrowing.totalLent) / 1e18).toFixed(4)} WEEDL</p>
      <p>Total Repaid: {(Number(borrowing.totalRepaid) / 1e18).toFixed(4)} WEEDL</p>
      <p>Fee: {(Number(borrowing.fee) / 1e18).toFixed(4)} WEEDL (0.420%)</p>
      <p>Duration: {(Number(borrowing.duration) / 86400).toFixed(0)} days</p>
      <p>Remaining Time: {remainingDays} days, {remainingHours} hours</p>
      <p>Contact Info: {sanitizeHTML(borrowing.contactInfo)}</p>
      <p>Borrowing Purpose: {sanitizeHTML(borrowing.purpose)}</p>
      <p>Collateral: {sanitizeHTML(borrowing.collateralInfo)} {collateralVerified ? "(Verified)" : "(Unverified)"}</p>
      <p>Latitude: {sanitizeHTML(borrowing.latitude)}</p>
      <p>Longitude: {sanitizeHTML(borrowing.longitude)}</p>
      {lenderContribution !== undefined && (
        <p>Your Contribution: {(Number(lenderContribution) / 1e18).toFixed(4)} WEEDL</p>
      )}
      <button
        onClick={handleViewOnGoogleMaps}
        disabled={!isValidCoordinates}
        className="action-button"
        aria-label={`View location for Borrowing ${borrowing.id} on Google Maps`}
      >
        View on Google Maps
      </button>
      {borrowing.borrower.toLowerCase() === address.toLowerCase() ? (
        <form>
          <div className="input-group">
            <label htmlFor={`repay-input-${borrowing.id}`}>Repay Amount (WEEDL)</label>
            <input
              id={`repay-input-${borrowing.id}`}
              type="text"
              value={repayAmount}
              onChange={(e) => setRepayAmount(e.target.value)}
              placeholder={`Max ${(Number(borrowing.totalLent - borrowing.totalRepaid) / 1e18).toFixed(4)} WEEDL`}
              className="action-input"
              aria-label="Repayment Amount"
              title="Enter repayment amount in WEEDL"
            />
          </div>
          {repayGasEstimate && (
            <p className="gas-estimate" aria-label="Estimated repayment gas cost">
              {repayGasEstimate}
            </p>
          )}
          <div className="button-group">
            <button
              type="button"
              onClick={handleRepay}
              disabled={isPending || isConfirming || !repayAmount || Number(repayAmount) <= 0 || Number(repayAmount) > Number(borrowing.totalLent - borrowing.totalRepaid) / 1e18}
              className="action-button"
              aria-label={`Repay Borrowing ${borrowing.id}`}
            >
              {isPending || isConfirming ? "Repaying..." : "Repay"}
            </button>
            <button
              type="button"
              onClick={handleEndBorrowing}
              disabled={isPending || isConfirming}
              className="action-button"
              aria-label={`End Borrowing ${borrowing.id}`}
            >
              {isPending || isConfirming ? "Ending..." : "End Borrowing"}
            </button>
          </div>
          {showConfirm === "repay" && (
            <div className="confirm-dialog">
              <p>Are you sure you want to repay {repayAmount} WEEDL for this borrowing?</p>
              <div className="button-group">
                <button type="button" onClick={confirmRepay} disabled={isPending || isConfirming} aria-label="Confirm Repayment">
                  Confirm
                </button>
                <button type="button" onClick={() => setShowConfirm(null)} aria-label="Cancel Repayment">
                  Cancel
                </button>
              </div>
            </div>
          )}
          {showConfirm === "end" && (
            <div className="confirm-dialog">
              <p>Are you sure you want to end this borrowing? Remaining un-lent amount will be refunded.</p>
              <div className="button-group">
                <button type="button" onClick={confirmEndBorrowing} disabled={isPending || isConfirming} aria-label="Confirm End Borrowing">
                  Confirm
                </button>
                <button type="button" onClick={() => setShowConfirm(null)} aria-label="Cancel End Borrowing">
                  Cancel
                </button>
              </div>
            </div>
          )}
        </form>
      ) : (
        <form>
          <div className="input-group">
            <label htmlFor={`lend-input-${borrowing.id}`}>Lend Amount (WEEDL)</label>
            <input
              id={`lend-input-${borrowing.id}`}
              type="text"
              value={lendAmount}
              onChange={(e) => setLendAmount(e.target.value)}
              placeholder={`Max ${(Number(borrowing.amount - borrowing.totalLent) / 1e18).toFixed(4)} WEEDL`}
              className="action-input"
              aria-label="Lending Amount"
              title="Enter lending amount in WEEDL"
            />
          </div>
          {lendGasEstimate && (
            <p className="gas-estimate" aria-label="Estimated lending gas cost">
              {lendGasEstimate}
            </p>
          )}
          <div className="button-group">
            <button
              type="button"
              onClick={handleLend}
              disabled={isPending || isConfirming || !lendAmount || Number(lendAmount) <= 0 || Number(lendAmount) > Number(borrowing.amount - borrowing.totalLent) / 1e18}
              className="action-button"
              aria-label={`Lend to Borrowing ${borrowing.id}`}
            >
              {isPending || isConfirming ? "Lending..." : "Lend"}
            </button>
          </div>
          {showConfirm === "lend" && (
            <div className="confirm-dialog">
              <p>Are you sure you want to lend {lendAmount} WEEDL to this borrowing?</p>
              <div className="button-group">
                <button type="button" onClick={confirmLend} disabled={isPending || isConfirming} aria-label="Confirm Lending">
                  Confirm
                </button>
                <button type="button" onClick={() => setShowConfirm(null)} aria-label="Cancel Lending">
                  Cancel
                </button>
              </div>
            </div>
          )}
        </form>
      )}
      {writeError && (
        <p id={`error-${borrowing.id}`} className="error" role="alert" aria-live="assertive">
          Error: {parseBlockchainError(writeError.message) || "Failed to process transaction."}
        </p>
      )}
    </section>
  );
}