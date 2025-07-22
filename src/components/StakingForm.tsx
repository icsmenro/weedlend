import { Component, ReactNode, useState, useEffect, useCallback } from "react";
import { useWriteContract, useReadContract, useAccount, useBalance, usePublicClient, useWaitForTransactionReceipt, useWatchContractEvent } from "wagmi";
import { parseEther, encodeFunctionData, formatEther } from "viem";
import { GreenFiStaking, WEEDL } from "../config/contracts";
import { sanitizeHTML } from "../utils/security";
import { toast } from "react-toastify";

interface FormData {
  amount: string;
  duration: string;
}

interface FormErrors {
  amount?: string;
  duration?: string;
}

interface StakingFormProps {
  address?: string;
  selectedStakeUUID?: string | null;
  selectedStakeAmount?: bigint | null;
  onStakeCreated?: (uuid: string) => void;
}

class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div role="alert" className="error-boundary">
          <p>Something went wrong. Please try again.</p>
          <button
            onClick={() => this.setState({ hasError: false })}
            className="action-button"
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function StakingForm({
  selectedStakeUUID,
  selectedStakeAmount,
  onStakeCreated,
}: StakingFormProps) {
  const [formData, setFormData] = useState<FormData>({
    amount: selectedStakeAmount ? formatEther(selectedStakeAmount) : "",
    duration: "",
  });
  const [validationErrors, setValidationErrors] = useState<FormErrors>({});
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [popup, setPopup] = useState<{ message: string; visible: boolean }>({
    message: "",
    visible: false,
  });
  const [gasEstimate, setGasEstimate] = useState<string | null>(null);
  const [transactionStep, setTransactionStep] = useState<"none" | "approving" | "staking" | "unstaking">("none");
  const [approvalHash, setApprovalHash] = useState<`0x${string}` | undefined>();
  const [actionHash, setActionHash] = useState<`0x${string}` | undefined>();

  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { writeContract, data: writeData, error: writeError, isPending } = useWriteContract();
  const { isLoading: isApprovalConfirming, isSuccess: isApprovalConfirmed, error: approvalError } = useWaitForTransactionReceipt({ hash: approvalHash });
  const { isLoading: isActionConfirming, isSuccess: isActionConfirmed, error: actionError } = useWaitForTransactionReceipt({ hash: actionHash });

  const { data: balance, refetch: refetchBalance } = useReadContract({
    address: WEEDL.address as `0x${string}`,
    abi: WEEDL.abi,
    functionName: "balanceOf",
    args: [address || "0x0" as `0x${string}`],
  }) as { data: bigint | undefined; refetch: () => void };

  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: WEEDL.address as `0x${string}`,
    abi: WEEDL.abi,
    functionName: "allowance",
    args: [address || "0x0" as `0x${string}`, GreenFiStaking.address as `0x${string}`],
  }) as { data: bigint | undefined; refetch: () => void };

  const { data: isPaused } = useReadContract({
    address: GreenFiStaking.address as `0x${string}`,
    abi: GreenFiStaking.abi,
    functionName: "paused",
    query: { refetchInterval: 30000 },
  }) as { data: boolean | undefined };

  const { data: ethBalance } = useBalance({ address });

  const MIN_STAKE_AMOUNT = parseEther("0.1");
  const MIN_STAKING_DURATION = 30;
  const MAX_STAKING_DURATION = 365;

  useWatchContractEvent({
    address: GreenFiStaking.address as `0x${string}`,
    abi: [
      {
        type: "event",
        name: "Staked",
        inputs: [
          { indexed: true, name: "user", type: "address" },
          { indexed: false, name: "amount", type: "uint256" },
          { indexed: false, name: "duration", type: "uint256" },
          { indexed: false, name: "startTime", type: "uint256" },
          { indexed: true, name: "uuid", type: "bytes32" },
        ],
      },
    ],
    eventName: "Staked",
    onLogs(logs) {
      const log = logs[0] as { args: { user: string; uuid: string } };
      if (log.args.user?.toLowerCase() === address?.toLowerCase()) {
        console.log(`New stake UUID: ${log.args.uuid}`);
        if (onStakeCreated) {
          onStakeCreated(log.args.uuid);
        }
        toast.info(`New stake created with UUID: ${log.args.uuid.slice(0, 8)}...`);
      }
    },
  });

  const showPopup = (message: string) => {
    setPopup({ message, visible: true });
    setTimeout(() => setPopup({ message: "", visible: false }), 3000);
  };

  const validateInput = useCallback(
    (field: string, value: string) => {
      const errors = { ...validationErrors };
      switch (field) {
        case "amount":
          errors.amount =
            value && (isNaN(Number(value)) || Number(value) <= 0)
              ? "Amount must be a positive number."
              : Number(value) < Number(formatEther(MIN_STAKE_AMOUNT))
              ? `Amount must be at least ${formatEther(MIN_STAKE_AMOUNT)} WEEDL.`
              : "";
          break;
        case "duration":
          errors.duration =
            value && (isNaN(Number(value)) || Number(value) <= 0)
              ? "Duration must be a positive number."
              : Number(value) < MIN_STAKING_DURATION
              ? `Duration must be at least ${MIN_STAKING_DURATION} days.`
              : Number(value) > MAX_STAKING_DURATION
              ? `Duration cannot exceed ${MAX_STAKING_DURATION} days.`
              : "";
          break;
      }
      setValidationErrors(errors);
    },
    [validationErrors, MIN_STAKE_AMOUNT, MIN_STAKING_DURATION, MAX_STAKING_DURATION]
  );

  const estimateGas = useCallback(
    async () => {
      if (
        !publicClient ||
        !address ||
        !formData.amount ||
        !formData.duration ||
        Object.values(validationErrors).some((e) => e)
      ) {
        setGasEstimate(null);
        toast.warn("Cannot estimate gas: Invalid input or wallet not connected.");
        return;
      }

      try {
        const amountWei = parseEther(formData.amount);
        const durationSeconds = BigInt(Number(formData.duration) * 86400);

        if (!allowance || allowance < amountWei) {
          const approvalData = encodeFunctionData({
            abi: WEEDL.abi,
            functionName: "approve",
            args: [GreenFiStaking.address, amountWei],
          });

          const approvalGas = await publicClient.estimateGas({
            account: address as `0x${string}`,
            to: WEEDL.address as `0x${string}`,
            data: approvalData,
          });

          const gasPrice = await publicClient.getGasPrice();
          const approvalCost = formatEther(approvalGas * gasPrice);
          setGasEstimate(`Approval: ~${approvalCost} SepoliaETH`);
          toast.info(`Gas estimate for approval: ~${approvalCost} SepoliaETH`);
          return;
        }

        const stakeData = encodeFunctionData({
          abi: GreenFiStaking.abi,
          functionName: "stake",
          args: [amountWei, durationSeconds],
        });

        const stakeGas = await publicClient.estimateGas({
          account: address as `0x${string}`,
          to: GreenFiStaking.address as `0x${string}`,
          data: stakeData,
        });

        const gasPrice = await publicClient.getGasPrice();
        const stakeCost = formatEther(stakeGas * gasPrice);
        setGasEstimate(`Stake: ~${stakeCost} SepoliaETH`);
        toast.info(`Gas estimate for staking: ~${stakeCost} SepoliaETH`);
      } catch (err) {
        setGasEstimate("Unable to estimate gas.");
        toast.error("Failed to estimate gas.");
        console.error("Gas estimation error:", err);
      }
    },
    [publicClient, address, formData.amount, formData.duration, allowance, validationErrors]
  );

  useEffect(() => {
    estimateGas();
  }, [estimateGas]);

  useEffect(() => {
    if (writeData && transactionStep === "approving" && !approvalHash) {
      setApprovalHash(writeData);
      showPopup("Approval transaction submitted!");
      toast.info("Approval transaction submitted!");
    } else if (writeData && transactionStep === "staking" && !actionHash) {
      setActionHash(writeData);
      showPopup("Stake transaction submitted!");
      toast.info("Stake transaction submitted!");
    } else if (writeData && transactionStep === "unstaking" && !actionHash) {
      setActionHash(writeData);
      showPopup("Unstake transaction submitted!");
      toast.info("Unstake transaction submitted!");
    }
  }, [writeData, transactionStep, approvalHash, actionHash]);

  useEffect(() => {
    if (writeError) {
      const errorMsg = parseBlockchainError(writeError.message) || "Transaction failed.";
      setErrorMessage(errorMsg);
      showPopup(errorMsg);
      toast.error(errorMsg);
      setTransactionStep("none");
    }
    if (approvalError) {
      const errorMsg = parseBlockchainError(approvalError.message) || "Approval transaction failed.";
      setErrorMessage(errorMsg);
      showPopup(errorMsg);
      toast.error(errorMsg);
      setTransactionStep("none");
    }
    if (actionError) {
      const errorMsg = parseBlockchainError(actionError.message) || "Action transaction failed.";
      setErrorMessage(errorMsg);
      showPopup(errorMsg);
      toast.error(errorMsg);
      setTransactionStep("none");
    }
    if (isActionConfirmed && actionHash) {
      const successMsg =
        transactionStep === "staking"
          ? `Successfully staked ${formData.amount} WEEDL for ${formData.duration} days`
          : `Successfully unstaked ${formData.amount} WEEDL`;
      showPopup(successMsg);
      toast.success(successMsg);
      setFormData({ amount: "", duration: "" });
      setValidationErrors({});
      setApprovalHash(undefined);
      setActionHash(undefined);
      setTransactionStep("none");
      refetchBalance();
      refetchAllowance();
    }
  }, [
    writeError,
    approvalError,
    actionError,
    isActionConfirmed,
    actionHash,
    transactionStep,
    formData,
    refetchBalance,
    refetchAllowance,
  ]);

  useEffect(() => {
    if (selectedStakeUUID && selectedStakeAmount) {
      setFormData({ amount: formatEther(selectedStakeAmount), duration: "" });
      toast.info(`Selected stake ${selectedStakeUUID.slice(0, 8)}... for management`);
    }
  }, [selectedStakeUUID, selectedStakeAmount]);

  const parseBlockchainError = (message: string): string => {
    if (message.includes("User rejected")) return "Transaction rejected by user.";
    if (message.includes("Insufficient funds")) return "Insufficient funds for gas fees.";
    if (message.includes("Amount must be greater than")) return "Stake amount must be greater than zero.";
    if (message.includes("Duration must be")) return "Duration must be within allowed range.";
    if (message.includes("UUID collision detected")) return "Stake ID already exists.";
    if (message.includes("Insufficient WEEDL balance")) return "Insufficient WEEDL balance.";
    if (message.includes("Pausable: paused")) return "Contract is paused.";
    return message || "Unknown error occurred.";
  };

  const handleInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    const sanitizedValue = await sanitizeHTML(value);
    validateInput(name, sanitizedValue);
    setFormData((prev) => ({ ...prev, [name]: sanitizedValue }));
    setErrorMessage(null);
  };

  const handleStake = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setErrorMessage(null);
      if (isPaused) {
        const errorMsg = "Cannot stake: Contract is paused.";
        setErrorMessage(errorMsg);
        showPopup(errorMsg);
        toast.error(errorMsg);
        return;
      }
      setTransactionStep("approving");

      try {
        if (!formData.amount || isNaN(Number(formData.amount)) || Number(formData.amount) <= 0) {
          throw new Error("Stake amount must be a positive number.");
        }
        if (!formData.duration || isNaN(Number(formData.duration)) || Number(formData.duration) <= 0) {
          throw new Error("Duration must be a positive number.");
        }
        if (Number(formData.duration) < MIN_STAKING_DURATION || Number(formData.duration) > MAX_STAKING_DURATION) {
          throw new Error(`Duration must be between ${MIN_STAKING_DURATION} and ${MAX_STAKING_DURATION} days.`);
        }
        if (!address) throw new Error("Please connect your wallet.");
        if (!ethBalance || ethBalance.value < parseEther("0.001")) {
          throw new Error("Insufficient SepoliaETH for gas fees. Need at least 0.001 SepoliaETH.");
        }

        const amountWei = parseEther(formData.amount);
        if (!balance || balance < amountWei) {
          throw new Error(`Insufficient WEEDL balance. Need ${formData.amount} WEEDL`);
        }

        if (!allowance || allowance < amountWei) {
          writeContract({
            address: WEEDL.address as `0x${string}`,
            abi: WEEDL.abi,
            functionName: "approve",
            args: [GreenFiStaking.address as `0x${string}`, amountWei],
            gas: BigInt(120000),
            account: address as `0x${string}`,
          });
          return;
        }

        setTransactionStep("staking");
        writeContract({
          address: GreenFiStaking.address as `0x${string}`,
          abi: GreenFiStaking.abi,
          functionName: "stake",
          args: [amountWei, BigInt(Number(formData.duration) * 86400)],
          gas: BigInt(300000),
          account: address as `0x${string}`,
        });
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? parseBlockchainError(err.message) : "Failed to stake.";
        setErrorMessage(errorMsg);
        showPopup(errorMsg);
        toast.error(errorMsg);
        setTransactionStep("none");
      }
    },
    [formData, address, ethBalance, balance, allowance, writeContract, isPaused]
  );

  const handleUnstake = useCallback(
    async () => {
      if (!selectedStakeUUID) {
        const errorMsg = "No stake selected for unstaking.";
        setErrorMessage(errorMsg);
        showPopup(errorMsg);
        toast.error(errorMsg);
        return;
      }
      setErrorMessage(null);
      if (isPaused) {
        const errorMsg = "Cannot unstake: Contract is paused.";
        setErrorMessage(errorMsg);
        showPopup(errorMsg);
        toast.error(errorMsg);
        return;
      }
      setTransactionStep("unstaking");

      try {
        if (!address) throw new Error("Please connect your wallet.");
        if (!ethBalance || ethBalance.value < parseEther("0.001")) {
          throw new Error("Insufficient SepoliaETH for gas fees. Need at least 0.001 SepoliaETH.");
        }

        writeContract({
          address: GreenFiStaking.address as `0x${string}`,
          abi: GreenFiStaking.abi,
          functionName: "withdraw",
          args: [selectedStakeUUID],
          gas: BigInt(300000),
          account: address as `0x${string}`,
        });
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? parseBlockchainError(err.message) : "Failed to unstake.";
        setErrorMessage(errorMsg);
        showPopup(errorMsg);
        toast.error(errorMsg);
        setTransactionStep("none");
      }
    },
    [selectedStakeUUID, address, ethBalance, writeContract, isPaused]
  );

  useEffect(() => {
    if (isApprovalConfirmed && approvalHash && transactionStep === "approving") {
      setTransactionStep("staking");
      writeContract({
        address: GreenFiStaking.address as `0x${string}`,
        abi: GreenFiStaking.abi,
        functionName: "stake",
        args: [parseEther(formData.amount), BigInt(Number(formData.duration) * 86400)],
        gas: BigInt(300000),
        account: address,
      });
    }
  }, [
    isApprovalConfirmed,
    approvalHash,
    transactionStep,
    formData.amount,
    formData.duration,
    writeContract,
    address,
  ]);

  return (
    <ErrorBoundary>
      <form
        onSubmit={handleStake}
        className="description-item"
        role="form"
        aria-label="Staking Form"
      >
        <h3>{selectedStakeUUID ? "Manage Stake" : "Stake WEEDL Tokens"}</h3>
        <p>Disclaimer: Staking earns a fixed 4.20% APY reward rate.</p>
        <p>
          <strong>Wallet:</strong>{" "}
          {sanitizeHTML(
            address ? `${address.slice(0, 6)}...${address.slice(-4)}` : "Not connected"
          )}
        </p>
        {balance !== undefined && (
          <p>
            <strong>WEEDL Balance:</strong> {formatEther(balance)} WEEDL
          </p>
        )}
        {ethBalance && (
          <p>
            <strong>SepoliaETH Balance:</strong> {formatEther(ethBalance.value)} SepoliaETH
          </p>
        )}
        {selectedStakeUUID && (
          <p>
            <strong>Selected Stake:</strong> ID {selectedStakeUUID.slice(0, 8)}... (
            {formData.amount} WEEDL)
          </p>
        )}
        {isPaused && (
          <p className="error" role="alert">
            Contract is paused. Staking is disabled.
          </p>
        )}
        {errorMessage && (
          <p className="error" role="alert">
            {errorMessage}
          </p>
        )}
        {gasEstimate && (
          <p className="gas-estimate" aria-label="Estimated gas cost">
            {gasEstimate}
          </p>
        )}
        {!selectedStakeUUID && (
          <>
            <div>
              <label htmlFor="amount">Amount (WEEDL)</label>
              <input
                id="amount"
                name="amount"
                type="number"
                step="0.01"
                value={formData.amount}
                onChange={handleInputChange}
                placeholder="Enter amount in WEEDL"
                required
                className={`action-input ${validationErrors.amount ? "invalid" : ""}`}
                aria-label="Amount in WEEDL"
                aria-describedby="amount-error"
                disabled={!address || isPaused}
                title="Enter the amount of WEEDL tokens to stake"
              />
              {validationErrors.amount && (
                <p className="validation-error">{validationErrors.amount}</p>
              )}
            </div>
            <div>
              <label htmlFor="duration">Duration (Days)</label>
              <input
                id="duration"
                name="duration"
                type="number"
                step="1"
                value={formData.duration}
                onChange={handleInputChange}
                placeholder="Enter staking duration in days"
                required
                className={`action-input ${validationErrors.duration ? "invalid" : ""}`}
                aria-label="Staking duration in days"
                aria-describedby="duration-error"
                disabled={!address || isPaused}
                title="Enter the number of days to stake your tokens"
              />
              {validationErrors.duration && (
                <p className="validation-error">{validationErrors.duration}</p>
              )}
            </div>
          </>
        )}
        <div>
          <button
            type="submit"
            disabled={
              isPending ||
              isApprovalConfirming ||
              isActionConfirming ||
              Object.values(validationErrors).some((e) => e) ||
              isPaused
            }
            className="action-button"
            aria-label="Stake Tokens"
            title="Stake your WEEDL tokens"
          >
            {isApprovalConfirming
              ? "Approving..."
              : isActionConfirming && transactionStep === "staking"
              ? "Staking..."
              : "Stake"}
          </button>
          {selectedStakeUUID && (
            <button
              type="button"
              onClick={handleUnstake}
              disabled={
                isPending ||
                isApprovalConfirming ||
                isActionConfirming ||
                isPaused
              }
              className="action-button"
              aria-label="Unstake Tokens"
              title="Unstake your selected WEEDL tokens"
            >
              {isActionConfirming && transactionStep === "unstaking"
                ? "Unstaking..."
                : "Unstake"}
            </button>
          )}
        </div>
      </form>
      {popup.visible && (
        <div className="popup" role="alert" aria-live="polite">
          {popup.message}
        </div>
      )}
    </ErrorBoundary>
  );
}