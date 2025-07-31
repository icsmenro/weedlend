import { useState, useEffect, useCallback, Component, ReactNode } from "react";
import { useReadContract, useAccount, useBalance } from "wagmi";
import { formatEther } from "viem";
import { GreenFiStaking } from "../config/contracts";
import { sanitizeHTML } from "../utils/security";
import { toast } from "react-toastify";

interface StakeData {
  user: string;
  amount: bigint;
  startTime: bigint;
  duration: bigint;
  rewardDebt: bigint;
  isActive: boolean;
  uuid: string;
}

interface StakingListingsProps {
  address?: string;
  onSelectStake: (uuid: string, amount: bigint) => void;
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
          <p>Something went wrong while displaying stakes.</p>
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

export default function StakingListings({ onSelectStake }: StakingListingsProps) {
  const [stakes, setStakes] = useState<StakeData[]>([]);
  const [selectedStake, setSelectedStake] = useState<StakeData | null>(null);
  const [isConfirming, setIsConfirming] = useState(false);

  const { address } = useAccount();

  const { data: balance } = useReadContract({
    address: GreenFiStaking.address as `0x${string}`,
    abi: GreenFiStaking.abi,
    functionName: "balanceOf",
    args: [address || "0x0" as `0x${string}`],
  }) as { data: bigint | undefined };

  const { data: isPaused, refetch: refetchPaused } = useReadContract({
    address: GreenFiStaking.address as `0x${string}`,
    abi: GreenFiStaking.abi,
    functionName: "paused",
    query: { refetchInterval: 30000 },
  }) as { data: boolean | undefined; refetch: () => void };

  const { data: stakesData, error: stakesError, refetch: refetchStakes } = useReadContract({
    address: GreenFiStaking.address as `0x${string}`,
    abi: GreenFiStaking.abi,
    functionName: "getUserStakes",
    args: [address || "0x0" as `0x${string}`],
    query: { refetchInterval: 30000 },
  }) as { data: StakeData[] | undefined; error: Error | null; refetch: () => void };

  const { data: ethBalance } = useBalance({ address });

  useEffect(() => {
    if (stakesError) {
      console.error("Stake data error:", stakesError);
      toast.error(
        stakesError.message.includes("Pausable: paused")
          ? "Contract is paused."
          : "Failed to fetch stake listings: " + stakesError.message
      );
    }
  }, [stakesError]);

  useEffect(() => {
    if (stakesData) {
      const formattedStakes: StakeData[] = stakesData
        .map((stake) => ({
          user: stake.user,
          amount: BigInt(stake.amount),
          startTime: BigInt(stake.startTime),
          duration: BigInt(stake.duration),
          rewardDebt: BigInt(stake.rewardDebt),
          isActive: stake.isActive,
          uuid: stake.uuid,
        }))
        .filter(
          (stake) =>
            stake.isActive && stake.user.toLowerCase() === address?.toLowerCase()
        )
        .sort((a, b) => Number(b.startTime - a.startTime));
      setStakes(formattedStakes);
    }
  }, [stakesData, address]);

  const handleRefreshStakes = () => {
    if (!address) return;
    setIsConfirming(true);
    setTimeout(() => {
      refetchStakes();
      refetchPaused();
      setIsConfirming(false);
      toast.info("Stakes refreshed successfully!");
    }, 1000);
  };

  const handleSelectStake = useCallback(
    (stake: StakeData) => {
      setSelectedStake(stake);
      onSelectStake(stake.uuid, stake.amount);
      toast.info(`Selected stake ${stake.uuid.slice(0, 8)}...`);
    },
    [onSelectStake]
  );

  const isStakeMatured = useCallback(
    (stake: StakeData) =>
      Number(stake.startTime + stake.duration) <= Math.floor(Date.now() / 1000),
    []
  );

  return (
    <ErrorBoundary>
      <div className="grid" role="grid" aria-label="Grid of staking listings">
        <h2>Your Stakes</h2>
        <p>
          Wallet:{" "}
          {sanitizeHTML(
            address ? `${address.slice(0, 6)}...${address.slice(-4)}` : "Not connected"
          )}
        </p>
        {balance !== undefined && (
          <p>Staked WEEDL Balance: {formatEther(balance)} WEEDL</p>
        )}
        {ethBalance && (
          <p>SepoliaETH Balance: {formatEther(ethBalance.value)} SepoliaETH</p>
        )}
        <p>Contract Status: {isPaused ? "Paused" : "Active"}</p>
        {isPaused && (
          <p className="error" role="alert">
            Contract is paused. Actions are disabled.
          </p>
        )}
        {stakesError && (
          <p className="error" role="alert">
            {stakesError.message.includes("Pausable: paused")
              ? "Contract is paused."
              : stakesError.message}
          </p>
        )}
        {stakes.length === 0 ? (
          <p>No active stakes found. Start staking now!</p>
        ) : (
          stakes.map((stake) => (
            <StakingItem
              key={stake.uuid}
              stake={stake}
              onSelect={() => handleSelectStake(stake)}
              isPaused={isPaused}
              isStakeMatured={isStakeMatured}
            />
          ))
        )}
        <button
          type="button"
          onClick={handleRefreshStakes}
          className="action-button"
          disabled={!address || isConfirming || isPaused}
          aria-label="Refresh Stakes"
          title="Refresh your staking data"
        >
          {isConfirming ? "Refreshing..." : "Refresh Stakes"}
        </button>
      </div>
      {selectedStake && (
        <StakingModal
          stake={selectedStake}
          onClose={() => setSelectedStake(null)}
          refetchStakes={refetchStakes}
        />
      )}
    </ErrorBoundary>
  );
}

function StakingItem({
  stake,
  onSelect,
  isPaused,
  isStakeMatured,
}: {
  stake: StakeData;
  onSelect: () => void;
  isPaused?: boolean;
  isStakeMatured: (stake: StakeData) => boolean;
}) {
  const durationDays = Number(stake.duration) / 86400;

  return (
    <div
      className="description-item"
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && onSelect()}
      aria-label={`View stake details for UUID ${stake.uuid}`}
    >
      <p>Staking earns a fixed 4.20% APY reward rate.</p>
      <p>
        <strong>Stake ID:</strong> {stake.uuid.slice(0, 8)}...
      </p>
      <p>
        <strong>Staked Amount:</strong> {formatEther(stake.amount)} WEEDL
      </p>
      <p>
        <strong>Duration:</strong> {durationDays} days
      </p>
      <p>
        <strong>Maturity:</strong>{" "}
        {isStakeMatured(stake)
          ? "Matured"
          : `Matures on ${new Date(
              Number(stake.startTime + stake.duration) * 1000
            ).toLocaleDateString()}`}
      </p>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onSelect();
        }}
        disabled={isPaused}
        className="action-button"
        aria-label={`Select stake ${stake.uuid}`}
      >
        View Details
      </button>
    </div>
  );
}

function StakingModal({
  stake,
  onClose,
  refetchStakes,
}: {
  stake: StakeData;
  onClose: () => void;
  refetchStakes: () => void;
}) {
  const durationDays = Number(stake.duration) / 86400;
  const startTime = new Date(Number(stake.startTime) * 1000).toLocaleString();
  const isMatured = Number(stake.startTime + stake.duration) <= Math.floor(Date.now() / 1000);

  return (
    <div className="modal" role="dialog" aria-label={`Stake Details Modal for UUID ${stake.uuid}`}>
      <div className="modal-content">
        <button className="modal-close" onClick={onClose} aria-label="Close modal">
          ×
        </button>
        <h3>Stake Details (ID: {stake.uuid.slice(0, 8)}...)</h3>
        <p>
          <strong>Staked Amount:</strong> {formatEther(stake.amount)} WEEDL
        </p>
        <p>
          <strong>Duration:</strong> {durationDays} days
        </p>
        <p>
          <strong>Start Time:</strong> {sanitizeHTML(startTime)}
        </p>
        <p>
          <strong>Reward Debt:</strong> {formatEther(stake.rewardDebt)} WEEDL
        </p>
        <p>
          <strong>Status:</strong> {stake.isActive ? "Active" : "Inactive"}
        </p>
        <p>
          <strong>Maturity:</strong>{" "}
          {isMatured
            ? "Matured"
            : `Matures on ${new Date(
                Number(stake.startTime + stake.duration) * 1000
              ).toLocaleDateString()}`}
        </p>
        <button
          onClick={() => {
            refetchStakes();
            onClose();
          }}
          className="action-button"
        >
          Refresh Stakes
        </button>
      </div>
    </div>
  );
}