import { useState, useEffect } from 'react';
import { useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { parseEther } from 'viem';
import { GreenFi, WEEDL } from '../config/contracts';
import { sanitizeHTML } from '../utils/security';

interface LandBorrowingProps {
  landId: string; // Changed to string to match GreenFi ABI
  collateralValue: bigint;
  address: string;
}

export default function LandBorrowingForm({ landId, collateralValue, address }: LandBorrowingProps) {
  const [duration, setDuration] = useState('');
  const [contactInfo, setContactInfo] = useState('');
  const [approveTxHash, setApproveTxHash] = useState<`0x${string}` | undefined>();

  const { writeContract: writeApprove, isPending: isPendingApprove, data: approveData } = useWriteContract();
  const { writeContract: writeBorrow, isPending: isPendingBorrow } = useWriteContract();
  const { isLoading: isApproving } = useWaitForTransactionReceipt({ hash: approveTxHash });

  useEffect(() => {
    if (approveData && !isApproving && !isPendingBorrow) {
      writeBorrow({
        address: GreenFi.address as `0x${string}`,
        abi: GreenFi.abi,
        functionName: 'createLoan', // WARNING: borrowLand not in provided ABI, using createLoan as fallback
        args: [
          `borrow_${Date.now()}`, // Generate unique ID
          landId,
          parseEther('0'), // Amount set to 0 for borrowing (adjust if needed)
          BigInt(Number(duration) * 86400),
          contactInfo,
        ],
      });
    }
  }, [approveData, isApproving, isPendingBorrow, duration, contactInfo, landId, writeBorrow]);

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
    if (!duration || isNaN(Number(duration))) return alert('Please enter a valid duration');
    if (!contactInfo) return alert('Provide contact information');
    if (!address) return alert('Wallet address not connected');

    const fee = (Number(collateralValue) / 1e18 * 0.0042).toString();
    const totalWithFee = (Number(parseEther(fee)) * 1.0042).toString();

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
      <p className="disclaimer">Disclaimer: Please verify the authenticity of this borrowing before engaging.</p>
      <h3>Borrow Land #{sanitizeHTML(landId)}</h3>
      <input
        type="number"
        value={duration}
        onChange={handleDurationChange}
        placeholder="Duration (days)"
        required
        min="30"
        max="365"
        className="action-input"
        aria-label="Borrowing Duration in Days"
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
        disabled={isPendingApprove || isApproving || isPendingBorrow}
        className="action-button"
        aria-label="Borrow Land"
      >
        {isPendingApprove || isApproving ? 'Approving...' : isPendingBorrow ? 'Borrowing...' : 'Borrow Land'}
      </button>
    </form>
  );
}