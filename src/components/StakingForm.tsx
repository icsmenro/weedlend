import { Component, ReactNode, useState, useEffect } from 'react';
import { useWriteContract, useContractRead, useWaitForTransactionReceipt } from 'wagmi';
import { parseEther } from 'viem';
import { GreenFi, WEEDL } from '../config/contracts';
import { sanitizeHTML } from '../utils/security';

class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return <p>Something went wrong. Please try again.</p>;
    }
    return this.props.children;
  }
}

export default function StakingForm({ address }: { address: string }) {
  const [amount, setAmount] = useState('');
  const [isUnstake, setIsUnstake] = useState(false);
  const [approveTxHash, setApproveTxHash] = useState<`0x${string}` | undefined>();

  const { writeContract: writeApprove, isPending: isPendingApprove, data: approveData } = useWriteContract();
  const { writeContract: writeStake, isPending: isPendingStake } = useWriteContract();
  const { writeContract: writeUnstake, isPending: isPendingUnstake } = useWriteContract();
  const { isLoading: isApproving } = useWaitForTransactionReceipt({ hash: approveTxHash });

  const { data: stakedBalance } = useContractRead({
    address: GreenFi.address as `0x${string}`,
    abi: GreenFi.abi,
    functionName: 'stakes',
    args: [address as `0x${string}`],
  }) as { data: { user: string; amount: bigint; rewardDebt: bigint; isActive: boolean } | undefined };

  useEffect(() => {
    if (approveData && !isApproving && !isPendingStake && !isUnstake) {
      writeStake({
        address: GreenFi.address as `0x${string}`,
        abi: GreenFi.abi,
        functionName: 'stake',
        args: [parseEther(amount)],
        account: address as `0x${string}`,
      });
    }
  }, [approveData, isApproving, isPendingStake, isUnstake, amount, writeStake, address]);

  const handleAmountChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const sanitized = await sanitizeHTML(e.target.value);
    setAmount(sanitized.toString());
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!amount || isNaN(Number(amount))) return alert('Please enter a valid amount');

    const amountWei = parseEther(amount);

    if (isUnstake) {
      writeUnstake({
        address: GreenFi.address as `0x${string}`,
        abi: GreenFi.abi,
        functionName: 'unstake',
        args: [amountWei],
        account: address as `0x${string}`,
      });
    } else {
      writeApprove({
        address: WEEDL.address as `0x${string}`,
        abi: WEEDL.abi,
        functionName: 'approve',
        args: [GreenFi.address as `0x${string}`, parseEther((Number(amount) * 1.0042).toString())],
        account: address as `0x${string}`,
      }, {
        onSuccess: (hash) => setApproveTxHash(hash),
      });
    }
  };

  return (
    <ErrorBoundary>
      <form onSubmit={handleSubmit} className="description-item">
        <h3>{isUnstake ? 'Unstake' : 'Stake'} WEEDL Tokens</h3>
        <p className="disclaimer">Disclaimer: Staking earns a fixed 4.20% reward rate.</p>
        <p>
          Wallet: {sanitizeHTML(`${address.slice(0, 6)}...${address.slice(-4)}`).toString()}
        </p>
        <p>
          Staked Balance: {sanitizeHTML(stakedBalance ? (Number(stakedBalance.amount) / 1e18).toFixed(2) : '0').toString()} WEEDL
        </p>
        <input
          type="number"
          value={amount}
          onChange={handleAmountChange}
          placeholder="Amount (WEEDL)"
          required
          min="0"
          step="0.01"
          className="action-input"
          aria-label="Amount in WEEDL"
        />
        <div className="toggle-container">
          <label>
            <input
              type="checkbox"
              checked={isUnstake}
              onChange={() => setIsUnstake(!isUnstake)}
              aria-label="Toggle Stake/Unstake"
            />
            Unstake
          </label>
        </div>
        <button
          type="submit"
          disabled={isPendingApprove || isApproving || isPendingStake || isPendingUnstake}
          className="action-button"
          aria-label={isUnstake ? 'Unstake Tokens' : 'Stake Tokens'}
        >
          {isPendingApprove || isApproving
            ? 'Approving...'
            : isPendingStake
            ? 'Staking...'
            : isPendingUnstake
            ? 'Unstaking...'
            : isUnstake
            ? 'Unstake'
            : 'Stake'}
        </button>
      </form>
    </ErrorBoundary>
  );
}