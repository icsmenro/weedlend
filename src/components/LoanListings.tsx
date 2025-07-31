import { useState, useEffect, useCallback, ChangeEvent } from 'react';
import { useReadContract, useWriteContract, useAccount, useBalance, usePublicClient, useWaitForTransactionReceipt } from 'wagmi';
import { parseEther, formatEther, encodeFunctionData } from 'viem';
import { GreenFiLoan, WEEDL } from '../config/contracts';
import { sanitizeHTML } from '../utils/security';
import { toast } from 'react-toastify';

interface CannabisLoan {
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

interface LoanListingsProps {
  address?: `0x${string}`; // Updated to use Ethereum address type
}

export default function LoanListings({ address: propAddress }: LoanListingsProps) {
  const [loans, setLoans] = useState<CannabisLoan[]>([]);
  const [paymentAmount, setPaymentAmount] = useState<{ [key: string]: string }>({});
  const [paymentErrors, setPaymentErrors] = useState<{ [key: string]: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [transactionStep, setTransactionStep] = useState<{ [key: string]: 'none' | 'approving' | 'funding' | 'repaying' | 'claiming' }>({});
  const [transactionHash, setTransactionHash] = useState<{ [key: string]: `0x${string}` | undefined }>({});

  const { address: accountAddress } = useAccount();
  const address = propAddress || accountAddress; // Both are now `0x${string} | undefined`
  const publicClient = usePublicClient();
  const { writeContract, data: writeData, error: writeError, isPending } = useWriteContract();
  const { isLoading: isConfirming, isSuccess: isConfirmed, error: confirmError } = useWaitForTransactionReceipt({
    hash: Object.values(transactionHash).find((hash) => hash !== undefined),
  });

  const { data: balance, refetch: refetchBalance } = useReadContract({
    address: WEEDL.address as `0x${string}`,
    abi: WEEDL.abi,
    functionName: 'balanceOf',
    args: [address ?? '0x0'], // Removed explicit type cast
  }) as { data: bigint | undefined; refetch: () => void };

  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: WEEDL.address as `0x${string}`,
    abi: WEEDL.abi,
    functionName: 'allowance',
    args: [address ?? '0x0', GreenFiLoan.address as `0x${string}`], // Removed explicit type cast
  }) as { data: bigint | undefined; refetch: () => void };

  const { data: isPaused } = useReadContract({
    address: GreenFiLoan.address as `0x${string}`,
    abi: GreenFiLoan.abi,
    functionName: 'paused',
    query: { refetchInterval: 30000 },
  }) as { data: boolean | undefined };

  const { data: loansData } = useReadContract({
    address: GreenFiLoan.address as `0x${string}`,
    abi: GreenFiLoan.abi,
    functionName: 'getAllLoans',
    query: { refetchInterval: 30000 },
  }) as { data: CannabisLoan[] | undefined };

  const { data: ethBalance } = useBalance({ address });

  useEffect(() => {
    if (loansData) {
      const formattedLoans: CannabisLoan[] = loansData
        .map((loan) => ({
          id: loan.id,
          grower: loan.grower,
          amount: BigInt(loan.amount),
          duration: BigInt(loan.duration),
          isActive: loan.isActive,
          contactInfo: loan.contactInfo,
          fee: BigInt(loan.fee),
          createdAt: BigInt(loan.createdAt),
          growPurpose: loan.growPurpose,
          status: loan.status,
          collateralAmount: BigInt(loan.collateralAmount),
          lender: loan.lender,
          repaidAmount: BigInt(loan.repaidAmount),
          interestRate: BigInt(loan.interestRate),
        }))
        .filter((loan) => loan.isActive)
        .sort((a, b) => Number(b.createdAt - a.createdAt));
      setLoans(formattedLoans);
    }
  }, [loansData]);

  const parseBlockchainError = (message: string): string => {
    if (message.includes('User rejected')) return 'Transaction rejected by user.';
    if (message.includes('Insufficient funds')) return 'Insufficient funds for gas fees.';
    if (message.includes('Insufficient WEEDL balance')) return 'Insufficient WEEDL balance.';
    if (message.includes('Pausable: paused')) return 'Contract is paused.';
    if (message.includes('Loan ID already used')) return 'Loan ID has already been used.';
    return message || 'Unknown error occurred.';
  };

  const getPaymentDue = (loan: CannabisLoan) => {
    const interest = (loan.amount * loan.interestRate * loan.duration) / BigInt(10000 * 365 * 24 * 60 * 60);
    return loan.amount + interest;
  };

  const validatePaymentAmount = useCallback((loan: CannabisLoan, amount: string) => {
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
      return 'Payment amount must be a positive number.';
    }
    const paymentWei = parseEther(amount);
    const paymentDue = getPaymentDue(loan);
    if (paymentWei < paymentDue) {
      return `Payment must be at least ${formatEther(paymentDue)} WEEDL.`;
    }
    return '';
  }, []);

  const getNextNonce = useCallback(async () => {
    if (!address || !publicClient) return undefined;
    try {
      return await publicClient.getTransactionCount({
        address: address as `0x${string}`,
        blockTag: 'pending',
      });
    } catch (err) {
      console.error('Failed to fetch nonce:', err);
      return undefined;
    }
  }, [address, publicClient]);

  const estimateGasFees = useCallback(
    async (to: `0x${string}`, data: `0x${string}`) => {
      if (!address || !publicClient) return { gas: BigInt(0), gasPrice: BigInt(0) };
      try {
        const gasPrice = await publicClient.getGasPrice();
        const gas = await publicClient.estimateGas({
          account: address as `0x${string}`,
          to,
          data,
        });
        return { gas, gasPrice };
      } catch (err) {
        console.error('Failed to estimate gas:', err);
        return { gas: BigInt(0), gasPrice: BigInt(0) };
      }
    },
    [address, publicClient]
  );

  useEffect(() => {
    if (writeData && Object.keys(transactionStep).some((key) => transactionStep[key] !== 'none' && !transactionHash[key])) {
      const key = Object.keys(transactionStep).find((k) => transactionStep[k] !== 'none');
      if (key) {
        setTransactionHash((prev) => ({ ...prev, [key]: writeData }));
        toast.info(`${transactionStep[key]} transaction submitted for loan ${key}!`);
      }
    }
  }, [writeData, transactionStep, transactionHash]);

  useEffect(() => {
    if (writeError) {
      setError(parseBlockchainError(writeError.message) || 'Transaction failed.');
      setTransactionStep({});
    }
    if (confirmError) {
      setError(parseBlockchainError(confirmError.message) || 'Transaction confirmation failed.');
      setTransactionStep({});
    }
    if (isConfirmed) {
      const key = Object.keys(transactionHash).find((k) => transactionHash[k]);
      if (key) {
        if (transactionStep[key] === 'approving') {
          setTransactionStep((prev) => ({
            ...prev,
            [key]: transactionStep[key] === 'approving' ? 'funding' : transactionStep[key],
          }));
        } else {
          setSuccess(`Operation for loan ${key} completed successfully!`);
          setTransactionStep((prev) => ({ ...prev, [key]: 'none' }));
          setTransactionHash((prev) => ({ ...prev, [key]: undefined }));
          refetchBalance();
          refetchAllowance();
          if (transactionStep[key] === 'repaying') {
            setPaymentAmount((prev) => ({ ...prev, [key]: '' }));
            setPaymentErrors((prev) => ({ ...prev, [key]: '' }));
          }
        }
      }
    }
  }, [writeError, confirmError, isConfirmed, transactionStep, transactionHash, refetchBalance, refetchAllowance]);

  const handleFundLoan = useCallback(
    async (loanId: string, amount: bigint) => {
      setError(null);
      setSuccess(null);
      setTransactionStep((prev) => ({ ...prev, [loanId]: 'approving' }));

      try {
        if (!address) throw new Error('Please connect your wallet.');
        if (!ethBalance || ethBalance.value < parseEther('0.001')) {
          throw new Error('Insufficient SepoliaETH for gas fees. Need at least 0.001 SepoliaETH.');
        }
        if (isPaused) throw new Error('Cannot fund loan: Contract is paused.');
        if (!balance || balance < amount) {
          throw new Error(`Insufficient WEEDL balance. Need ${formatEther(amount)} WEEDL`);
        }
        if (allowance === undefined) {
          throw new Error('Failed to fetch allowance. Please try again.');
        }
        if (allowance < amount) {
          const approveData = encodeFunctionData({
            abi: WEEDL.abi,
            functionName: 'approve',
            args: [GreenFiLoan.address as `0x${string}`, amount],
          });
          const { gas, gasPrice } = await estimateGasFees(WEEDL.address as `0x${string}`, approveData);
          if (gas === BigInt(0) || gasPrice === BigInt(0)) {
            throw new Error('Failed to estimate gas for approval.');
          }
          await writeContract({
            address: WEEDL.address as `0x${string}`,
            abi: WEEDL.abi,
            functionName: 'approve',
            args: [GreenFiLoan.address as `0x${string}`, amount],
            gas: gas * BigInt(12) / BigInt(10),
            account: address,
            nonce: await getNextNonce(),
          });
          return;
        }

        setTransactionStep((prev) => ({ ...prev, [loanId]: 'funding' }));
        const fundData = encodeFunctionData({
          abi: GreenFiLoan.abi,
          functionName: 'fundLoan',
          args: [loanId],
        });
        const { gas, gasPrice } = await estimateGasFees(GreenFiLoan.address as `0x${string}`, fundData);
        if (gas === BigInt(0) || gasPrice === BigInt(0)) {
          throw new Error('Failed to estimate gas for funding.');
        }
        await writeContract({
          address: GreenFiLoan.address as `0x${string}`,
          abi: GreenFiLoan.abi,
          functionName: 'fundLoan',
          args: [loanId],
          gas: gas * BigInt(12) / BigInt(10),
          account: address,
          nonce: await getNextNonce(),
        });
      } catch (err: unknown) {
        setError(err instanceof Error ? parseBlockchainError(err.message) : 'Failed to fund loan.');
        setTransactionStep((prev) => ({ ...prev, [loanId]: 'none' }));
      }
    },
    [address, ethBalance, balance, allowance, writeContract, getNextNonce, estimateGasFees, isPaused]
  );

  const handleRepayLoan = useCallback(
    async (loanId: string, amount: string, loan: CannabisLoan) => {
      setError(null);
      setSuccess(null);
      setTransactionStep((prev) => ({ ...prev, [loanId]: 'approving' }));

      try {
        if (!address) throw new Error('Please connect your wallet.');
        if (!ethBalance || ethBalance.value < parseEther('0.001')) {
          throw new Error('Insufficient SepoliaETH for gas fees. Need at least 0.001 SepoliaETH.');
        }
        if (isPaused) throw new Error('Cannot repay loan: Contract is paused.');
        const validationError = validatePaymentAmount(loan, amount);
        if (validationError) {
          setPaymentErrors((prev) => ({ ...prev, [loanId]: validationError }));
          throw new Error(validationError);
        }
        const paymentWei = parseEther(amount);
        if (!balance || balance < paymentWei) {
          throw new Error(`Insufficient WEEDL balance. Need ${amount} WEEDL`);
        }
        if (allowance === undefined) {
          throw new Error('Failed to fetch allowance. Please try again.');
        }
        if (allowance < paymentWei) {
          const approveData = encodeFunctionData({
            abi: WEEDL.abi,
            functionName: 'approve',
            args: [GreenFiLoan.address as `0x${string}`, paymentWei],
          });
          const { gas, gasPrice } = await estimateGasFees(WEEDL.address as `0x${string}`, approveData);
          if (gas === BigInt(0) || gasPrice === BigInt(0)) {
            throw new Error('Failed to estimate gas for approval.');
          }
          await writeContract({
            address: WEEDL.address as `0x${string}`,
            abi: WEEDL.abi,
            functionName: 'approve',
            args: [GreenFiLoan.address as `0x${string}`, paymentWei],
            gas: gas * BigInt(12) / BigInt(10),
            account: address,
            nonce: await getNextNonce(),
          });
          return;
        }

        setTransactionStep((prev) => ({ ...prev, [loanId]: 'repaying' }));
        const repayData = encodeFunctionData({
          abi: GreenFiLoan.abi,
          functionName: 'repayLoan',
          args: [loanId, paymentWei],
        });
        const { gas, gasPrice } = await estimateGasFees(GreenFiLoan.address as `0x${string}`, repayData);
        if (gas === BigInt(0) || gasPrice === BigInt(0)) {
          throw new Error('Failed to estimate gas for repayment.');
        }
        await writeContract({
          address: GreenFiLoan.address as `0x${string}`,
          abi: GreenFiLoan.abi,
          functionName: 'repayLoan',
          args: [loanId, paymentWei],
          gas: gas * BigInt(12) / BigInt(10),
          account: address,
          nonce: await getNextNonce(),
        });
      } catch (err: unknown) {
        setError(err instanceof Error ? parseBlockchainError(err.message) : 'Failed to repay loan.');
        setTransactionStep((prev) => ({ ...prev, [loanId]: 'none' }));
      }
    },
    [address, ethBalance, balance, allowance, writeContract, getNextNonce, estimateGasFees, isPaused, validatePaymentAmount]
  );

  const handleClaimCollateral = useCallback(
    async (loanId: string) => {
      setError(null);
      setSuccess(null);
      setTransactionStep((prev) => ({ ...prev, [loanId]: 'claiming' }));

      try {
        if (!address) throw new Error('Please connect your wallet.');
        if (!ethBalance || ethBalance.value < parseEther('0.001')) {
          throw new Error('Insufficient SepoliaETH for gas fees. Need at least 0.001 SepoliaETH.');
        }
        if (isPaused) throw new Error('Cannot claim collateral: Contract is paused.');

        const claimData = encodeFunctionData({
          abi: GreenFiLoan.abi,
          functionName: 'claimCollateral',
          args: [loanId],
        });
        const { gas, gasPrice } = await estimateGasFees(GreenFiLoan.address as `0x${string}`, claimData);
        if (gas === BigInt(0) || gasPrice === BigInt(0)) {
          throw new Error('Failed to estimate gas for collateral claim.');
        }
        await writeContract({
          address: GreenFiLoan.address as `0x${string}`,
          abi: GreenFiLoan.abi,
          functionName: 'claimCollateral',
          args: [loanId],
          gas: gas * BigInt(12) / BigInt(10),
          account: address,
          nonce: await getNextNonce(),
        });
      } catch (err: unknown) {
        setError(err instanceof Error ? parseBlockchainError(err.message) : 'Failed to claim collateral.');
        setTransactionStep((prev) => ({ ...prev, [loanId]: 'none' }));
      }
    },
    [address, ethBalance, writeContract, getNextNonce, estimateGasFees, isPaused]
  );

  const handlePaymentChange = (loanId: string, loan: CannabisLoan) => (e: ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setPaymentAmount((prev) => ({ ...prev, [loanId]: value }));
    const validationError = validatePaymentAmount(loan, value);
    setPaymentErrors((prev) => ({ ...prev, [loanId]: validationError }));
  };

  const isGrower = (loan: CannabisLoan) => address && loan.grower.toLowerCase() === address.toLowerCase();
  const isLender = (loan: CannabisLoan) => address && loan.lender.toLowerCase() === address.toLowerCase();
  const isPaymentDue = (loan: CannabisLoan) =>
    loan.status === 'Funded' && Number(loan.createdAt + loan.duration) <= Math.floor(Date.now() / 1000);

  return (
    <div className="loan-listings">
      <h2>Loan Listings</h2>
      <p>Wallet: {sanitizeHTML(address ? `${address.slice(0, 6)}...${address.slice(-4)}` : 'Not connected')}</p>
      {balance !== undefined && <p>WEEDL Balance: {formatEther(balance)} WEEDL</p>}
      {ethBalance && <p>SepoliaETH Balance: {formatEther(ethBalance.value)} SepoliaETH</p>}
      <p>Contract Status: {isPaused ? 'Paused' : 'Active'}</p>
      {isPaused && <p className="error" role="alert">Contract is paused. Actions are disabled.</p>}
      {error && <p className="error" role="alert">{error}</p>}
      {success && <p className="success" role="alert">{success}</p>}

      <h3>Available Loans</h3>
      {loans.length === 0 && <p>No available loans found.</p>}
      {loans.map((loan) => (
        <div key={loan.id} className="loan-item" role="article" aria-label={`Loan ${loan.id}`}>
          <h3>Loan ID: {sanitizeHTML(loan.id)}</h3>
          <p>Grower: {sanitizeHTML(loan.grower.slice(0, 6) + '...' + loan.grower.slice(-4))}</p>
          <p>Amount: {formatEther(loan.amount)} WEEDL</p>
          <p>Fee: {formatEther(loan.fee)} WEEDL</p>
          <p>Duration: {Number(loan.duration) / 86400} days</p>
          <p>Interest Rate: {Number(loan.interestRate) / 100}% APR</p>
          <p>Description: {sanitizeHTML(loan.growPurpose)}</p>
          <p>Contact: {sanitizeHTML(loan.contactInfo)}</p>
          <p>Collateral Amount: {formatEther(loan.collateralAmount)} WEEDL</p>
          <p>Status: {sanitizeHTML(loan.status)}</p>
          {loan.status === 'Open' && !isGrower(loan) && (
            <button
              onClick={() => handleFundLoan(loan.id, loan.amount)}
              disabled={isPending || isConfirming || transactionStep[loan.id] !== 'none' || isPaused}
              className="action-button"
              aria-label={`Fund loan ${loan.id}`}
            >
              {transactionStep[loan.id] === 'approving' && isConfirming
                ? 'Approving WEEDL (Confirming...)'
                : transactionStep[loan.id] === 'approving'
                  ? 'Approving WEEDL...'
                  : transactionStep[loan.id] === 'funding' && isConfirming
                    ? 'Funding (Confirming...)'
                    : transactionStep[loan.id] === 'funding'
                      ? 'Funding...'
                      : 'Fund Loan'}
            </button>
          )}
          {loan.status === 'Funded' && isGrower(loan) && (
            <div className="repayment-section">
              <p>Total Repayment Due: {formatEther(getPaymentDue(loan))} WEEDL</p>
              <p>Due Date: {new Date(Number(loan.createdAt + loan.duration) * 1000).toLocaleDateString()}</p>
              <input
                type="text"
                value={paymentAmount[loan.id] || ''}
                onChange={handlePaymentChange(loan.id, loan)}
                placeholder="Payment Amount (WEEDL)"
                className={`action-input ${paymentErrors[loan.id] ? 'invalid' : ''}`}
                aria-label={`Payment amount for loan ${loan.id}`}
              />
              {paymentErrors[loan.id] && <p className="validation-error">{paymentErrors[loan.id]}</p>}
              <button
                onClick={() => handleRepayLoan(loan.id, paymentAmount[loan.id] || '', loan)}
                disabled={isPending || isConfirming || transactionStep[loan.id] !== 'none' || !paymentAmount[loan.id] || !!paymentErrors[loan.id] || isPaused}
                className="action-button"
                aria-label={`Repay loan ${loan.id}`}
              >
                {transactionStep[loan.id] === 'approving' && isConfirming
                  ? 'Approving WEEDL (Confirming...)'
                  : transactionStep[loan.id] === 'approving'
                    ? 'Approving WEEDL...'
                    : transactionStep[loan.id] === 'repaying' && isConfirming
                      ? 'Repaying (Confirming...)'
                      : transactionStep[loan.id] === 'repaying'
                        ? 'Repaying...'
                        : 'Repay Loan'}
              </button>
            </div>
          )}
          {loan.status === 'Funded' && isLender(loan) && isPaymentDue(loan) && (
            <button
              onClick={() => handleClaimCollateral(loan.id)}
              disabled={isPending || isConfirming || transactionStep[loan.id] !== 'none' || isPaused}
              className="action-button"
              aria-label={`Claim collateral for loan ${loan.id}`}
            >
              {transactionStep[loan.id] === 'claiming' && isConfirming
                ? 'Claiming (Confirming...)'
                : transactionStep[loan.id] === 'claiming'
                  ? 'Claiming...'
                  : 'Claim Collateral'}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}