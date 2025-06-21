import { useState, useEffect } from 'react';
import { useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { parseEther } from 'viem';
import { GreenFi, WEEDL } from '../config/contracts';
import { sanitizeHTML } from '../utils/security';

interface LoanFormProps {
  landId: string; // Changed to string to match GreenFi ABI
  collateralValue: bigint;
  address: string;
}

export default function LoanForm({ landId, collateralValue, address }: LoanFormProps) {
  const [amount, setAmount] = useState('');
  const [interestRate, setInterestRate] = useState('');
  const [duration, setDuration] = useState('');
  const [contactInfo, setContactInfo] = useState('');
  const [approveTxHash, setApproveTxHash] = useState<`0x${string}` | undefined>();

  const { writeContract: writeApprove, isPending: isPendingApprove, data: approveData } = useWriteContract();
  const { writeContract: writeLoan, isPending: isPendingLoan } = useWriteContract();
  const { isLoading: isApproving } = useWaitForTransactionReceipt({ hash: approveTxHash });

  useEffect(() => {
    if (approveData && !isApproving && !isPendingLoan) {
      writeLoan({
        address: GreenFi.address as `0x${string}`,
        abi: GreenFi.abi,
        functionName: 'createLoan',
        args: [
          `loan_${Date.now()}`, // Generate unique ID
          landId,
          parseEther(amount),
          BigInt(Number(duration) * 86400),
          contactInfo,
        ],
      });
    }
  }, [approveData, isApproving, isPendingLoan, amount, duration, contactInfo, landId, writeLoan]);

  const handleAmountChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const sanitized = await sanitizeHTML(e.target.value);
    setAmount(sanitized);
  };

  const handleInterestRateChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const sanitized = await sanitizeHTML(e.target.value);
    setInterestRate(sanitized);
  };

  const handleDurationChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const sanitized = await sanitizeHTML(e.target.value);
    setDuration(sanitized);
  };

  const handleContactChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const sanitized = await sanitizeHTML(e.target.value);
    setContactInfo(sanitized);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!amount || !interestRate || !duration || !contactInfo) return alert('Please fill all fields');
    if (isNaN(Number(amount)) || isNaN(Number(interestRate)) || isNaN(Number(duration))) return alert('Invalid input');
    if (Number(interestRate) > 50) return alert('Interest rate cannot exceed 50%');
    if (Number(amount) > Number(collateralValue) / 1e18) return alert('Loan amount cannot exceed collateral value');
    if (!address) return alert('Wallet address not connected');

    const amountWei = parseEther(amount);
    const fee = (Number(amountWei) * 0.0042).toString();
    const totalWithFee = (Number(amountWei) + Number(parseEther(fee))).toString();

    writeApprove({
      address: WEEDL.address as `0x${string}`,
      abi: WEEDL.abi,
      functionName: 'approve',
      args: [GreenFi.address as `0x${string}`, parseEther(totalWithFee)],
    }, {
      onSuccess: (hash) => setApproveTxHash(hash),
    });
  };

  return (
    <form onSubmit={handleSubmit} className="description-item">
      <p className="disclaimer">Disclaimer: Please verify the authenticity of this loan before engaging.</p>
      <h3>Create Loan for Land #{sanitizeHTML(landId)}</h3>
      <input
        type="number"
        value={amount}
        onChange={handleAmountChange}
        placeholder="Loan Amount (WEEDL)"
        required
        min="0"
        step="0.01"
        className="action-input"
        aria-label="Loan Amount in WEEDL"
      />
      <input
        type="number"
        value={interestRate}
        onChange={handleInterestRateChange}
        placeholder="Interest Rate (%)"
        required
        min="0"
        max="50"
        step="0.1"
        className="action-input"
        aria-label="Interest Rate Percentage"
      />
      <input
        type="number"
        value={duration}
        onChange={handleDurationChange}
        placeholder="Duration (days)"
        required
        min="30"
        max="365"
        className="action-input"
        aria-label="Loan Duration in Days"
      />
      <input
        type="text"
        value={contactInfo}
        onChange={handleContactChange}
        placeholder="Contact Info (e.g., website, email, social media)"
        required
        className="action-input"
        aria-label="Contact Information"
      />
      <button
        type="submit"
        disabled={isPendingApprove || isApproving || isPendingLoan}
        className="action-button"
        aria-label="Create Loan"
      >
        {isPendingApprove || isApproving ? 'Approving...' : isPendingLoan ? 'Creating...' : 'Create Loan'}
      </button>
    </form>
  );
}