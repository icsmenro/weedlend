import { useState, useEffect, Component, ReactNode } from 'react';
import { useReadContract, useWriteContract, useWatchContractEvent, useWaitForTransactionReceipt, usePublicClient } from 'wagmi';
import { parseEther, formatEther } from 'viem';
import { GreenFiLand, WEEDL } from '../config/contracts';
import { sanitizeHTML } from '../utils/security';
import { getMetadata, Metadata } from '../utils/metadata';
import { toast } from 'react-toastify';
import type { Log } from 'viem';

interface LandListing {
  id: string;
  owner: string;
  metadataURI: string;
  collateralValue: bigint;
  isActive: boolean;
  contactInfo: string;
  suggestedLeasePrice: bigint;
  listingType: number; // 0: None, 1: Sell, 2: Lease
  status: number; // 0: Active, 1: Sold, 2: Bought
}

interface Lease {
  lessee: string;
  startTime: bigint;
  duration: bigint;
  price: bigint;
  isActive: boolean;
}

interface Purchase {
  id: string;
  buyer: string;
  seller: string;
  amount: bigint;
  timestamp: bigint;
}

interface LandListingsData {
  0: LandListing[];
}

interface EnrichedListing extends LandListing {
  metadata: Metadata;
  leaseDetails: Lease;
}

interface PurchaseWithMetadata extends Purchase {
  metadata: Metadata;
}

interface Message {
  id: string;
  sender: string;
  message: string;
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
          <p>Something went wrong while displaying land listings.</p>
          <button
            onClick={() => this.setState({ hasError: false })}
            className="action-button"
            aria-label="Retry displaying listings"
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

interface LandModalProps {
  listing?: EnrichedListing;
  purchase?: PurchaseWithMetadata;
  address: string;
  onClose: () => void;
  refetchListings: () => void;
  refetchPurchases: () => void;
  messages: Message[];
}

function parseBlockchainError(message: string): string {
  if (message.includes('User rejected')) return 'Transaction rejected by user.';
  if (message.includes('InvalidCollateralValue')) return 'Collateral value must be a positive number.';
  if (message.includes('LandNotActive')) return 'Land is not active.';
  if (message.includes('Unauthorized')) return 'You are not authorized to perform this action.';
  if (message.includes('Pausable: paused')) return 'Contract is paused.';
  if (message.includes('InsufficientPayment')) return 'Payment amount is less than collateral value.';
  if (message.includes('InvalidMessageLength')) return 'Message must be between 1 and 500 characters.';
  if (message.includes('InvalidLeaseDuration')) return 'Lease duration must be between 1 and 365 days.';
  if (message.includes('InvalidLeasePrice')) return 'Lease price must be positive.';
  if (message.includes('LandAlreadyLeased')) return 'Land is currently leased.';
  if (message.includes('LeaseNotActive')) return 'No active lease exists.';
  if (message.includes('LeaseNotExpired')) return 'Lease has not yet expired.';
  if (message.includes('Insufficient allowance')) return 'Insufficient allowance. Please approve the required WEEDL amount.';
  if (message.includes('InvalidListingType')) return 'This listing is not available for this action.';
  if (message.includes('InvalidPaginationParameters')) return 'No active listings available or invalid pagination parameters.';
  return message || 'Unknown error occurred.';
}

function LandModal({
  listing,
  purchase,
  address,
  onClose,
  refetchListings,
  refetchPurchases,
  messages,
}: LandModalProps) {
  const { writeContract, isPending, error: writeError, data: writeData } = useWriteContract();
  const [collateralValue, setCollateralValue] = useState('');
  const [paymentAmount, setPaymentAmount] = useState('');
  const [leasePrice, setLeasePrice] = useState('');
  const [leaseDuration, setLeaseDuration] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [transactionStep, setTransactionStep] = useState<'none' | 'approving' | 'updating' | 'delisting' | 'purchasing' | 'leasing' | 'endingLease' | 'messaging'>('none');
  const [approvalHash, setApprovalHash] = useState<`0x${string}` | undefined>();
  const [actionHash, setActionHash] = useState<`0x${string}` | undefined>();
  const [popup, setPopup] = useState<{ message: string; visible: boolean }>({ message: '', visible: false });
  const [showContactConfirm, setShowContactConfirm] = useState(false);
  const [showContactModal, setShowContactModal] = useState(false);
  const [showMessageModal, setShowMessageModal] = useState(false);

  const { isLoading: isApprovalConfirming, isSuccess: isApprovalConfirmed, error: approvalError } = useWaitForTransactionReceipt({ hash: approvalHash });
  const { isLoading: isActionConfirming, isSuccess: isActionConfirmed, error: actionError } = useWaitForTransactionReceipt({ hash: actionHash });

  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: WEEDL.address as `0x${string}`,
    abi: WEEDL.abi,
    functionName: 'allowance',
    args: [address || '0x0' as `0x${string}`, GreenFiLand.address as `0x${string}`],
    query: { refetchInterval: 30000 },
  }) as { data: bigint | undefined; refetch: () => void };

  const { data: balance } = useReadContract({
    address: WEEDL.address as `0x${string}`,
    abi: WEEDL.abi,
    functionName: 'balanceOf',
    args: [address || '0x0' as `0x${string}`],
    query: { refetchInterval: 30000 },
  }) as { data: bigint | undefined };

  const { data: isPaused } = useReadContract({
    address: GreenFiLand.address as `0x${string}`,
    abi: GreenFiLand.abi,
    functionName: 'paused',
    query: { refetchInterval: 30000 },
  }) as { data: boolean | undefined };

  const showPopup = (message: string) => {
    setPopup({ message, visible: true });
    setTimeout(() => setPopup({ message: '', visible: false }), 3000);
  };

  useEffect(() => {
    if (writeError) {
      const errorMessage = parseBlockchainError(writeError.message);
      setError(errorMessage);
      showPopup(errorMessage);
      toast.error(errorMessage);
      setTransactionStep('none');
    }
    if (approvalError) {
      const errorMessage = parseBlockchainError(approvalError.message);
      setError(errorMessage);
      showPopup(errorMessage);
      toast.error(errorMessage);
      setTransactionStep('none');
    }
    if (actionError) {
      const errorMessage = parseBlockchainError(actionError.message);
      setError(errorMessage);
      showPopup(errorMessage);
      toast.error(errorMessage);
      setTransactionStep('none');
    }
    if (isActionConfirmed && actionHash) {
      const successMsg =
        transactionStep === 'updating'
          ? `Successfully updated collateral to ${collateralValue} WEEDL`
          : transactionStep === 'delisting'
          ? `Successfully delisted land ${(listing?.id || purchase?.id || 'N/A')}`
          : transactionStep === 'purchasing'
          ? `Successfully purchased land ${(listing?.id || purchase?.id || 'N/A')}`
          : transactionStep === 'leasing'
          ? `Successfully leased land ${(listing?.id || purchase?.id || 'N/A')}`
          : transactionStep === 'endingLease'
          ? `Successfully ended lease for land ${(listing?.id || purchase?.id || 'N/A')}`
          : `Message sent for land ${(listing?.id || purchase?.id || 'N/A')}`;
      showPopup(successMsg);
      toast.success(successMsg);
      setCollateralValue('');
      setPaymentAmount('');
      setLeasePrice('');
      setLeaseDuration('');
      setMessage('');
      setApprovalHash(undefined);
      setActionHash(undefined);
      setTransactionStep('none');
      refetchAllowance();
      refetchListings();
      refetchPurchases();
      if (transactionStep !== 'messaging') {
        onClose();
      }
    }
  }, [writeError, approvalError, actionError, isActionConfirmed, actionHash, transactionStep, collateralValue, listing?.id, purchase?.id, refetchAllowance, refetchListings, refetchPurchases, onClose]);

  useEffect(() => {
    if (writeData && transactionStep === 'approving' && !approvalHash) {
      setApprovalHash(writeData);
      showPopup('Approval transaction submitted!');
      toast.info('Approval transaction submitted!');
    } else if (writeData && (transactionStep === 'updating' || transactionStep === 'delisting' || transactionStep === 'purchasing' || transactionStep === 'leasing' || transactionStep === 'endingLease' || transactionStep === 'messaging') && !actionHash) {
      setActionHash(writeData);
      showPopup(
        transactionStep === 'updating'
          ? 'Collateral update transaction submitted!'
          : transactionStep === 'delisting'
          ? 'Delist transaction submitted!'
          : transactionStep === 'purchasing'
          ? 'Purchase transaction submitted!'
          : transactionStep === 'leasing'
          ? 'Lease transaction submitted!'
          : transactionStep === 'endingLease'
          ? 'End lease transaction submitted!'
          : 'Message transaction submitted!'
      );
      toast.info(
        transactionStep === 'updating'
          ? 'Collateral update transaction submitted!'
          : transactionStep === 'delisting'
          ? 'Delist transaction submitted!'
          : transactionStep === 'purchasing'
          ? 'Purchase transaction submitted!'
          : transactionStep === 'leasing'
          ? 'Lease transaction submitted!'
          : transactionStep === 'endingLease'
          ? 'End lease transaction submitted!'
          : 'Message transaction submitted!'
      );
    }
  }, [writeData, transactionStep, approvalHash, actionHash]);

  const handleCollateralChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (value === '' || (/^\d*\.?\d*$/.test(value) && Number(value) > 0)) {
      const sanitized = await sanitizeHTML(value);
      setCollateralValue(sanitized);
      setError(null);
    } else {
      setError('Collateral value must be a positive number.');
    }
  };

  const handlePaymentChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (value === '' || /^\d*\.?\d*$/.test(value)) {
      const sanitized = await sanitizeHTML(value);
      setPaymentAmount(sanitized);
      if (value && Number(value) < Number(formatEther(listing?.collateralValue || 0n))) {
        setError(`Payment must be at least ${formatEther(listing?.collateralValue || 0n)} WEEDL.`);
      } else {
        setError(null);
      }
    } else {
      setError('Payment amount must be a valid number.');
    }
  };

  const handleLeasePriceChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (value === '' || (/^\d*\.?\d*$/.test(value) && Number(value) > 0)) {
      const sanitized = await sanitizeHTML(value);
      setLeasePrice(sanitized);
      setError(null);
    } else {
      setError('Lease price must be a positive number.');
    }
  };

  const handleLeaseDurationChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (value === '' || (/^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= 365)) {
      const sanitized = await sanitizeHTML(value);
      setLeaseDuration(sanitized);
      setError(null);
    } else {
      setError('Lease duration must be between 1 and 365 days.');
    }
  };

  const handleMessageChange = async (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    if (value.length <= 500) {
      const sanitized = await sanitizeHTML(value);
      setMessage(sanitized);
      setError(null);
    } else {
      setError('Message must be 500 characters or less.');
    }
  };

  const handleUpdateCollateral = async () => {
    if (!collateralValue || isNaN(Number(collateralValue)) || Number(collateralValue) <= 0) {
      setError('Enter a valid collateral value.');
      showPopup('Enter a valid collateral value.');
      toast.error('Enter a valid collateral value.');
      return;
    }
    if (isPaused) {
      setError('Cannot update collateral: Contract is paused.');
      showPopup('Cannot update collateral: Contract is paused.');
      toast.error('Cannot update collateral: Contract is paused.');
      return;
    }
    const collateralWei = parseEther(collateralValue);
    const oldCollateral = listing?.collateralValue || 0n;
    const oldFee = (oldCollateral * BigInt(42)) / BigInt(10000);
    const oldTotal = oldCollateral + oldFee;
    const newFee = (collateralWei * BigInt(42)) / BigInt(10000);
    const newTotal = collateralWei + newFee;
    const requiredWei = newTotal > oldTotal ? newTotal - oldTotal : BigInt(0);

    if (balance && balance < requiredWei) {
      setError(`Insufficient WEEDL balance. Need ${formatEther(requiredWei)} WEEDL.`);
      showPopup(`Insufficient WEEDL balance. Need ${formatEther(requiredWei)} WEEDL.`);
      toast.error(`Insufficient WEEDL balance. Need ${formatEther(requiredWei)} WEEDL.`);
      return;
    }

    if (!allowance || allowance < requiredWei) {
      setTransactionStep('approving');
      writeContract({
        address: WEEDL.address as `0x${string}`,
        abi: WEEDL.abi,
        functionName: 'approve',
        args: [GreenFiLand.address as `0x${string}`, requiredWei],
        gas: BigInt(120000),
      });
      return;
    }

    setTransactionStep('updating');
    writeContract({
      address: GreenFiLand.address as `0x${string}`,
      abi: GreenFiLand.abi,
      functionName: 'updateLandCollateral',
      args: [(listing?.id || purchase?.id || 'N/A') as string, collateralWei],
      gas: BigInt(300000),
    });
  };

  const handleDelist = async () => {
    if (isPaused) {
      setError('Cannot delist land: Contract is paused.');
      showPopup('Cannot delist land: Contract is paused.');
      toast.error('Cannot delist land: Contract is paused.');
      return;
    }
    setTransactionStep('delisting');
    writeContract({
      address: GreenFiLand.address as `0x${string}`,
      abi: GreenFiLand.abi,
      functionName: 'delistLand',
      args: [(listing?.id || purchase?.id || 'N/A') as string],
      gas: BigInt(300000),
    });
  };

  const handlePurchase = async () => {
    if (!paymentAmount || isNaN(Number(paymentAmount)) || Number(paymentAmount) < Number(formatEther(listing?.collateralValue || 0n))) {
      setError(`Payment must be at least ${formatEther(listing?.collateralValue || 0n)} WEEDL.`);
      showPopup(`Payment must be at least ${formatEther(listing?.collateralValue || 0n)} WEEDL.`);
      toast.error(`Payment must be at least ${formatEther(listing?.collateralValue || 0n)} WEEDL.`);
      return;
    }
    if (isPaused) {
      setError('Cannot purchase land: Contract is paused.');
      showPopup('Cannot purchase land: Contract is paused.');
      toast.error('Cannot purchase land: Contract is paused.');
      return;
    }
    if (listing?.leaseDetails.isActive) {
      setError('Cannot purchase land: Land is currently leased.');
      showPopup('Cannot purchase land: Land is currently leased.');
      toast.error('Cannot purchase land: Land is currently leased.');
      return;
    }
    const paymentWei = parseEther(paymentAmount);
    if (balance && balance < paymentWei) {
      setError(`Insufficient WEEDL balance. Need ${paymentAmount} WEEDL.`);
      showPopup(`Insufficient WEEDL balance. Need ${paymentAmount} WEEDL.`);
      toast.error(`Insufficient WEEDL balance. Need ${paymentAmount} WEEDL.`);
      return;
    }
    if (!allowance || allowance < paymentWei) {
      setTransactionStep('approving');
      writeContract({
        address: WEEDL.address as `0x${string}`,
        abi: WEEDL.abi,
        functionName: 'approve',
        args: [GreenFiLand.address as `0x${string}`, paymentWei],
        gas: BigInt(120000),
      });
      return;
    }
    setTransactionStep('purchasing');
    writeContract({
      address: GreenFiLand.address as `0x${string}`,
      abi: GreenFiLand.abi,
      functionName: 'purchaseLand',
      args: [(listing?.id || purchase?.id || 'N/A') as string, paymentWei],
      gas: BigInt(400000),
    });
  };

  const handleLease = async () => {
    if (!leasePrice || isNaN(Number(leasePrice)) || Number(leasePrice) <= 0) {
      setError('Lease price must be a positive number.');
      showPopup('Lease price must be a positive number.');
      toast.error('Lease price must be a positive number.');
      return;
    }
    if (!leaseDuration || isNaN(Number(leaseDuration)) || Number(leaseDuration) < 1 || Number(leaseDuration) > 365) {
      setError('Lease duration must be between 1 and 365 days.');
      showPopup('Lease duration must be between 1 and 365 days.');
      toast.error('Lease duration must be between 1 and 365 days.');
      return;
    }
    if (isPaused) {
      setError('Cannot lease land: Contract is paused.');
      showPopup('Cannot lease land: Contract is paused.');
      toast.error('Cannot lease land: Contract is paused.');
      return;
    }
    const leasePriceWei = parseEther(leasePrice);
    if (balance && balance < leasePriceWei) {
      setError(`Insufficient WEEDL balance. Need ${leasePrice} WEEDL.`);
      showPopup(`Insufficient WEEDL balance. Need ${leasePrice} WEEDL.`);
      toast.error(`Insufficient WEEDL balance. Need ${leasePrice} WEEDL.`);
      return;
    }
    if (!allowance || allowance < leasePriceWei) {
      setTransactionStep('approving');
      writeContract({
        address: WEEDL.address as `0x${string}`,
        abi: WEEDL.abi,
        functionName: 'approve',
        args: [GreenFiLand.address as `0x${string}`, leasePriceWei],
        gas: BigInt(120000),
      });
      return;
    }
    setTransactionStep('leasing');
    writeContract({
      address: GreenFiLand.address as `0x${string}`,
      abi: GreenFiLand.abi,
      functionName: 'leaseLand',
      args: [(listing?.id || purchase?.id || 'N/A') as string, parseEther(leasePrice), BigInt(leaseDuration) * BigInt(86400)],
      gas: BigInt(400000),
    });
  };

  const handleEndLease = async () => {
    if (isPaused) {
      setError('Cannot end lease: Contract is paused.');
      showPopup('Cannot end lease: Contract is paused.');
      toast.error('Cannot end lease: Contract is paused.');
      return;
    }
    const leaseEndTime = Number(listing?.leaseDetails.startTime || 0n) + Number(listing?.leaseDetails.duration || 0n);
    const currentTime = Math.floor(Date.now() / 1000);
    if (currentTime < leaseEndTime) {
      setError('Lease has not yet expired.');
      showPopup('Lease has not yet expired.');
      toast.error('Lease has not yet expired.');
      return;
    }
    setTransactionStep('endingLease');
    writeContract({
      address: GreenFiLand.address as `0x${string}`,
      abi: GreenFiLand.abi,
      functionName: 'endLease',
      args: [(listing?.id || purchase?.id || 'N/A') as string],
      gas: BigInt(300000),
    });
  };

  const handleSendMessage = async () => {
    if (!message || message.length > 500) {
      setError('Message must be between 1 and 500 characters.');
      showPopup('Message must be between 1 and 500 characters.');
      toast.error('Message must be between 1 and 500 characters.');
      return;
    }
    if (isPaused) {
      setError('Cannot send message: Contract is paused.');
      showPopup('Cannot send message: Contract is paused.');
      toast.error('Cannot send message: Contract is paused.');
      return;
    }
    setTransactionStep('messaging');
    writeContract({
      address: GreenFiLand.address as `0x${string}`,
      abi: GreenFiLand.abi,
      functionName: 'sendMessage',
      args: [(listing?.id || purchase?.id || 'N/A') as string, message],
      gas: BigInt(200000),
    });
  };

  useEffect(() => {
    if (isApprovalConfirmed && approvalHash) {
      if (transactionStep === 'approving' && collateralValue) {
        setTransactionStep('updating');
        writeContract({
          address: GreenFiLand.address as `0x${string}`,
          abi: GreenFiLand.abi,
          functionName: 'updateLandCollateral',
          args: [(listing?.id || purchase?.id || 'N/A') as string, parseEther(collateralValue)],
          gas: BigInt(300000),
        });
      } else if (transactionStep === 'approving' && paymentAmount) {
        setTransactionStep('purchasing');
        writeContract({
          address: GreenFiLand.address as `0x${string}`,
          abi: GreenFiLand.abi,
          functionName: 'purchaseLand',
          args: [(listing?.id || purchase?.id || 'N/A') as string, parseEther(paymentAmount)],
          gas: BigInt(400000),
        });
      } else if (transactionStep === 'approving' && leasePrice && leaseDuration) {
        setTransactionStep('leasing');
        writeContract({
          address: GreenFiLand.address as `0x${string}`,
          abi: GreenFiLand.abi,
          functionName: 'leaseLand',
          args: [(listing?.id || purchase?.id || 'N/A') as string, parseEther(leasePrice), BigInt(leaseDuration) * BigInt(86400)],
          gas: BigInt(400000),
        });
      }
    }
  }, [isApprovalConfirmed, approvalHash, transactionStep, collateralValue, paymentAmount, leasePrice, leaseDuration, writeContract, listing?.id, purchase?.id]);

  const isOwner = listing ? listing.owner.toLowerCase() === address.toLowerCase() : purchase?.seller.toLowerCase() === address.toLowerCase();
  const isBuyer = purchase?.buyer.toLowerCase() === address.toLowerCase();
  const isLessee = listing?.leaseDetails.lessee.toLowerCase() === address.toLowerCase();
  const isLeaseActive = listing?.leaseDetails.isActive;
  const leaseEndTime = Number(listing?.leaseDetails.startTime || 0n) + Number(listing?.leaseDetails.duration || 0n);
  const currentTime = Math.floor(Date.now() / 1000);
  const isLeaseExpired = isLeaseActive && currentTime >= leaseEndTime;
  const isSellListing = listing ? (listing.metadata.listingType === 'sell' || listing.listingType === 1) : false;
  const isLeaseListing = listing ? (listing.metadata.listingType === 'lease' || listing.listingType === 2) : false;
  const isSold = listing?.status === 1 || !!purchase;

  return (
    <div className="modal" role="dialog" aria-label={`Details for land ${(listing?.id || purchase?.id || 'N/A')}`}>
      <div className="modal-content">
        <button
          onClick={onClose}
          className="close-button"
          aria-label="Close modal"
        >
          &times;
        </button>
        <h3>Land Details: {sanitizeHTML((listing?.id || purchase?.id || 'N/A') as string)}</h3>
        {(listing?.metadata.image || purchase?.metadata.image) && <img src={listing?.metadata.image || purchase?.metadata.image} alt={`Land ${(listing?.id || purchase?.id || 'N/A')}`} className="land-image" />}
        <p><strong>Description:</strong> {sanitizeHTML(listing?.metadata.description || purchase?.metadata.description || 'N/A')}</p>
        <p><strong>Collateral Value:</strong> {formatEther(listing?.collateralValue || purchase?.amount || 0n)} WEEDL</p>
        {isLeaseListing && (
          <p><strong>Suggested Lease Price:</strong> {formatEther(listing?.suggestedLeasePrice || 0n)} WEEDL/day</p>
        )}
        <p><strong>Listing Type:</strong> {isSellListing ? 'Sell' : isLeaseListing ? 'Lease' : 'Not specified'}</p>
        <p><strong>Status:</strong> {isSold ? (isOwner ? 'Land Sold' : isBuyer ? 'Land Bought' : 'Sold') : 'Active'}</p>
        <p><strong>Contact:</strong>
          <button
            onClick={() => {
              const contactInfo = listing?.contactInfo || purchase?.metadata.contact;
              if (!contactInfo) return;
              const urlRegex = /^(https?:\/\/|mailto:|tel:|tg:\/\/)/i;
              if (urlRegex.test(contactInfo)) {
                setShowContactConfirm(true);
              } else {
                setShowContactModal(true);
              }
            }}
            className="action-button"
            aria-label="View contact information"
            disabled={!listing && !purchase}
          >
            View Contact
          </button>
        </p>
        <p><strong>Coordinates:</strong> {sanitizeHTML(listing?.metadata.latitude || purchase?.metadata.latitude || 'N/A')}, {sanitizeHTML(listing?.metadata.longitude || purchase?.metadata.longitude || 'N/A')}</p>
        <p><strong>Size:</strong> {sanitizeHTML(listing?.metadata.size || purchase?.metadata.size || 'Not specified')}</p>
        <p><strong>Zoning:</strong> {sanitizeHTML(listing?.metadata.zoning || purchase?.metadata.zoning || 'Not specified')}</p>
        <p><strong>Utilities:</strong> {sanitizeHTML(listing?.metadata.utilities || purchase?.metadata.utilities || 'Not specified')}</p>
        {listing && (
          <p><strong>Lease Status:</strong> {isLeaseActive ? `Active (Lessee: ${listing.leaseDetails.lessee.slice(0, 6)}...${listing.leaseDetails.lessee.slice(-4)})` : 'Not leased'}</p>
        )}
        {isLeaseActive && (
          <>
            <p><strong>Lease Price:</strong> {formatEther(listing?.leaseDetails.price || 0n)} WEEDL</p>
            <p><strong>Lease End Time:</strong> {new Date(leaseEndTime * 1000).toLocaleString()}</p>
          </>
        )}
        {isOwner && listing && (
          <>
            <div className="input-group">
              <label htmlFor={`update-collateral-${listing.id}`}>Update Collateral (WEEDL):</label>
              <input
                id={`update-collateral-${listing.id}`}
                type="text"
                value={collateralValue}
                onChange={handleCollateralChange}
                placeholder="New Collateral Value"
                disabled={isPending || isActionConfirming || isPaused || isSold}
                className="action-input"
                aria-label="Update collateral value"
              />
              <button
                onClick={handleUpdateCollateral}
                disabled={isPending || isActionConfirming || !collateralValue || isPaused || isSold}
                className="action-button"
                aria-label="Update collateral"
              >
                {isPending && transactionStep === 'updating' ? 'Updating...' : isApprovalConfirming && transactionStep === 'approving' ? 'Approving...' : 'Update Collateral'}
              </button>
            </div>
            <button
              onClick={handleDelist}
              disabled={isPending || isActionConfirming || isLeaseActive || isPaused || isSold}
              className="action-button"
              aria-label="Delist land"
            >
              {isPending && transactionStep === 'delisting' ? 'Delisting...' : 'Delist Land'}
            </button>
          </>
        )}
        {!isOwner && listing && (
          <>
            {isSellListing && !isSold && (
              <div className="input-group">
                <label htmlFor={`purchase-amount-${listing.id}`}>Purchase Amount (WEEDL):</label>
                <input
                  id={`purchase-amount-${listing.id}`}
                  type="text"
                  value={paymentAmount}
                  onChange={handlePaymentChange}
                  placeholder={`Min ${formatEther(listing.collateralValue)} WEEDL`}
                  disabled={isPending || isActionConfirming || isPaused}
                  className="action-input"
                  aria-label="Purchase amount"
                />
                <button
                  onClick={handlePurchase}
                  disabled={isPending || isActionConfirming || !paymentAmount || isLeaseActive || isPaused}
                  className="action-button"
                  aria-label="Purchase land"
                >
                  {isPending && transactionStep === 'purchasing' ? 'Purchasing...' : isApprovalConfirming && transactionStep === 'approving' ? 'Approving...' : 'Purchase Land'}
                </button>
              </div>
            )}
            {isLeaseListing && (
              <div className="input-group">
                <label htmlFor={`lease-price-${listing.id}`}>Lease Price (WEEDL):</label>
                <input
                  id={`lease-price-${listing.id}`}
                  type="text"
                  value={leasePrice}
                  onChange={handleLeasePriceChange}
                  placeholder={`Suggested ${formatEther(listing.suggestedLeasePrice)} WEEDL/day`}
                  disabled={isPending || isActionConfirming || isLeaseActive || isPaused}
                  className="action-input"
                  aria-label="Lease price"
                />
                <label htmlFor={`lease-duration-${listing.id}`}>Lease Duration (days):</label>
                <input
                  id={`lease-duration-${listing.id}`}
                  type="text"
                  value={leaseDuration}
                  onChange={handleLeaseDurationChange}
                  placeholder="1-365"
                  disabled={isPending || isActionConfirming || isLeaseActive || isPaused}
                  className="action-input"
                  aria-label="Lease duration"
                />
                <button
                  onClick={handleLease}
                  disabled={isPending || isActionConfirming || !leasePrice || !leaseDuration || isLeaseActive || isPaused}
                  className="action-button"
                  aria-label="Lease land"
                >
                  {isPending && transactionStep === 'leasing' ? 'Leasing...' : isApprovalConfirming && transactionStep === 'approving' ? 'Approving...' : 'Lease Land'}
                </button>
              </div>
            )}
            <button
              onClick={() => setShowMessageModal(true)}
              disabled={isPaused}
              className="action-button"
              aria-label="Contact owner"
            >
              Contact Owner
            </button>
          </>
        )}
        {(isOwner || isLessee) && isLeaseActive && isLeaseExpired && isLeaseListing && (
          <button
            onClick={handleEndLease}
            disabled={isPending || isActionConfirming || isPaused}
            className="action-button"
            aria-label="End lease"
          >
            {isPending && transactionStep === 'endingLease' ? 'Ending Lease...' : 'End Lease'}
          </button>
        )}
        {(isOwner || isBuyer) && messages.length > 0 && (
          <div className="messages">
            <h4>Messages:</h4>
            {messages.map((msg, index) => (
              <p key={index}>
                <strong>From {msg.sender.slice(0, 6)}...{msg.sender.slice(-4)}:</strong> {sanitizeHTML(msg.message)}
              </p>
            ))}
          </div>
        )}
        {error && <p className="error" role="alert">{error}</p>}
        {popup.visible && (
          <div className="popup" role="alert" aria-live="polite">
            {popup.message}
          </div>
        )}
        {showContactConfirm && (
          <div className="modal" role="dialog" aria-label="Confirm external link">
            <div className="modal-content">
              <p>Opening external link: {sanitizeHTML(listing?.contactInfo || purchase?.metadata.contact || '')}</p>
              <p>Ensure you trust the destination before proceeding.</p>
              <button
                onClick={() => {
                  window.open(listing?.contactInfo || purchase?.metadata.contact, '_blank', 'noopener,noreferrer');
                  setShowContactConfirm(false);
                }}
                className="action-button"
                aria-label="Confirm and open link"
              >
                Proceed
              </button>
              <button
                onClick={() => setShowContactConfirm(false)}
                className="action-button"
                aria-label="Cancel"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
        {showContactModal && (
          <div className="modal" role="dialog" aria-label="Contact information">
            <div className="modal-content">
              <p>Contact Info: {sanitizeHTML(listing?.contactInfo || purchase?.metadata.contact || '')}</p>
              <button
                onClick={() => setShowContactModal(false)}
                className="action-button"
                aria-label="Close contact modal"
              >
                Close
              </button>
            </div>
          </div>
        )}
        {showMessageModal && (
          <div className="modal" role="dialog" aria-label="Send message">
            <div className="modal-content">
              <h4>Send Message to Owner</h4>
              <textarea
                value={message}
                onChange={handleMessageChange}
                placeholder="Enter your message (max 500 characters)"
                className="action-input"
                aria-label="Message to owner"
              />
              <button
                onClick={handleSendMessage}
                disabled={isPending || isActionConfirming || !message || isPaused}
                className="action-button"
                aria-label="Send message"
              >
                {isPending && transactionStep === 'messaging' ? 'Sending...' : 'Send Message'}
              </button>
              <button
                onClick={() => setShowMessageModal(false)}
                className="action-button"
                aria-label="Cancel"
              >
                Cancel
              </button>
              {error && <p className="error" role="alert">{error}</p>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function LandListing({
  listing,
  purchase,
  address,
  onSelect,
  messages,
}: {
  listing?: EnrichedListing;
  purchase?: PurchaseWithMetadata;
  address: string;
  onSelect: () => void;
  messages: Message[];
}) {
  const isOwner = listing ? listing.owner.toLowerCase() === address.toLowerCase() : purchase?.seller.toLowerCase() === address.toLowerCase();
  const isBuyer = purchase?.buyer.toLowerCase() === address.toLowerCase();
  const isLeaseActive = listing?.leaseDetails.isActive;
  const leaseEndTime = Number(listing?.leaseDetails.startTime || 0n) + Number(listing?.leaseDetails.duration || 0n);
  const currentTime = Math.floor(Date.now() / 1000);
  const isLeaseExpired = isLeaseActive && currentTime >= leaseEndTime;
  const isSellListing = listing ? (listing.metadata.listingType === 'sell' || listing.listingType === 1) : false;
  const isLeaseListing = listing ? (listing.metadata.listingType === 'lease' || listing.listingType === 2) : false;
  const isSold = listing?.status === 1 || !!purchase;

  return (
    <div
      className="land-listing"
      onClick={onSelect}
      role="button"
      tabIndex={0}
      aria-label={`View details for land ${(listing?.id || purchase?.id || 'N/A')}`}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          onSelect();
        }
      }}
    >
      <h3>{sanitizeHTML((listing?.id || purchase?.id || 'N/A') as string)}</h3>
      {(listing?.metadata.image || purchase?.metadata.image) && <img src={listing?.metadata.image || purchase?.metadata.image} alt={`Land ${(listing?.id || purchase?.id || 'N/A')}`} className="land-image" />}
      <p><strong>Owner:</strong> {(listing || purchase) ? sanitizeHTML((listing?.owner || purchase?.buyer || 'N/A').slice(0, 6) + '...' + (listing?.owner || purchase?.buyer || 'N/A').slice(-4)) : 'N/A'}</p>
      <p><strong>Collateral Value:</strong> {formatEther(listing?.collateralValue || purchase?.amount || 0n)} WEEDL</p>
      {isLeaseListing && (
        <p><strong>Suggested Lease Price:</strong> {formatEther(listing?.suggestedLeasePrice || 0n)} WEEDL/day</p>
      )}
      <p><strong>Listing Type:</strong> {isSellListing ? 'Sell' : isLeaseListing ? 'Lease' : 'Not specified'}</p>
      <p><strong>Status:</strong> {isSold ? (isOwner ? 'Land Sold' : isBuyer ? 'Land Bought' : 'Sold') : 'Active'}</p>
      {listing && (
        <p><strong>Lease Status:</strong> {isLeaseActive ? `Active (Ends: ${new Date(leaseEndTime * 1000).toLocaleString()})` : 'Not leased'}</p>
      )}
      <p><strong>Description:</strong> {sanitizeHTML(listing?.metadata.description || purchase?.metadata.description || 'N/A')}</p>
      {(isOwner || isBuyer) && messages.length > 0 && (
        <p><strong>New Messages:</strong> {messages.length}</p>
      )}
      {isOwner && isLeaseActive && isLeaseExpired && isLeaseListing && (
        <p className="warning" role="alert">Lease has expired. You can end the lease in details.</p>
      )}
    </div>
  );
}

export default function LandListings({ address }: { address: string }) {
  const publicClient = usePublicClient();
  const [listings, setListings] = useState<EnrichedListing[]>([]);
  const [purchases, setPurchases] = useState<PurchaseWithMetadata[]>([]);
  const [selectedLand, setSelectedLand] = useState<EnrichedListing | undefined>(undefined);
  const [selectedPurchase, setSelectedPurchase] = useState<PurchaseWithMetadata | undefined>(undefined);
  const [currentPage, setCurrentPage] = useState(0);
  const [pageSize] = useState(10);
  const [totalListings, setTotalListings] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [showUserListingsOnly, setShowUserListingsOnly] = useState(false);

  const { data: totalListingsData, error: totalListingsError, refetch: refetchTotalListings } = useReadContract({
    address: GreenFiLand.address as `0x${string}`,
    abi: GreenFiLand.abi,
    functionName: 'getTotalActiveListings',
    query: { refetchInterval: 30000 },
  });

  const { data: landData, error: landDataError, refetch: refetchLandData } = useReadContract({
    address: GreenFiLand.address as `0x${string}`,
    abi: GreenFiLand.abi,
    functionName: showUserListingsOnly ? 'getUserListingsPaginated' : 'getAllLandListingsPaginated',
    args: address && totalListingsData && Number(totalListingsData) > 0
      ? [showUserListingsOnly ? address : BigInt(currentPage * pageSize), BigInt(pageSize)]
      : [BigInt(0), BigInt(pageSize)], // Fallback to valid args
    query: {
      enabled: !!address && !!totalListingsData, // Only enable if address and totalListingsData are defined
      refetchInterval: 30000,
    },
  }) as { data: LandListingsData | undefined; error: Error | null; refetch: () => void };

  const { data: purchaseData, error: purchaseDataError, refetch: refetchPurchaseData } = useReadContract({
    address: GreenFiLand.address as `0x${string}`,
    abi: GreenFiLand.abi,
    functionName: 'getUserPurchases',
    args: [address || '0x0'],
    query: { refetchInterval: 30000, enabled: !!address },
  }) as { data: Purchase[] | undefined; error: Error | null; refetch: () => void };

  const { data: isPaused } = useReadContract({
    address: GreenFiLand.address as `0x${string}`,
    abi: GreenFiLand.abi,
    functionName: 'paused',
    query: { refetchInterval: 30000 },
  }) as { data: boolean | undefined };

  useWatchContractEvent({
    address: GreenFiLand.address as `0x${string}`,
    abi: GreenFiLand.abi,
    eventName: 'LandListed',
    onLogs() {
      refetchLandData();
      refetchTotalListings();
      toast.info('New land listed!');
    },
  });

  useWatchContractEvent({
    address: GreenFiLand.address as `0x${string}`,
    abi: GreenFiLand.abi,
    eventName: 'LandDelisted',
    onLogs() {
      refetchLandData();
      refetchTotalListings();
      toast.info('Land delisted successfully!');
    },
  });

  useWatchContractEvent({
    address: GreenFiLand.address as `0x${string}`,
    abi: GreenFiLand.abi,
    eventName: 'CollateralUpdated',
    onLogs() {
      refetchLandData();
      toast.info('Collateral updated successfully!');
    },
  });

  useWatchContractEvent({
    address: GreenFiLand.address as `0x${string}`,
    abi: GreenFiLand.abi,
    eventName: 'LandPurchased',
    onLogs() {
      console.log('LandPurchased event received');
      refetchLandData();
      refetchTotalListings();
      refetchPurchaseData();
      toast.info('Land purchased successfully!');
    },
  });

  useWatchContractEvent({
    address: GreenFiLand.address as `0x${string}`,
    abi: GreenFiLand.abi,
    eventName: 'LandLeased',
    onLogs() {
      refetchLandData();
      toast.info('Land leased successfully!');
    },
  });

  useWatchContractEvent({
    address: GreenFiLand.address as `0x${string}`,
    abi: GreenFiLand.abi,
    eventName: 'LeaseEnded',
    onLogs() {
      refetchLandData();
      toast.info('Lease ended successfully!');
    },
  });

  useWatchContractEvent({
    address: GreenFiLand.address as `0x${string}`,
    abi: GreenFiLand.abi,
    eventName: 'MessageSent',
    onLogs(logs) {
      const log = logs[0] as Log<bigint, number, false, undefined, true, typeof GreenFiLand.abi, 'MessageSent'>;
      const { id, sender, message } = log.args;
      if (id && sender && message) {
        setMessages((prev) => [...prev, { id, sender, message }]);
        toast.info('New message received!');
      }
    },
  });

  useEffect(() => {
    if (landDataError) {
      let errorMessage = parseBlockchainError(landDataError.message);
      if (landDataError.message.includes('InvalidPaginationParameters')) {
        errorMessage = 'No active land listings available.';
        setListings([]);
      }
      setError(errorMessage);
      toast.error(errorMessage);
      console.error('Land data error:', landDataError);
    } else if (purchaseDataError) {
      setError('Failed to fetch purchase data.');
      toast.error('Failed to fetch purchase data.');
      console.error('Purchase data error:', purchaseDataError);
    } else {
      setError(null);
    }
  }, [landDataError, purchaseDataError]);

  useEffect(() => {
    if (totalListingsError) {
      setError('Failed to fetch total listings count.');
      toast.error('Failed to fetch total listings count.');
      console.error('Total listings error:', totalListingsError);
    } else {
      setTotalListings(totalListingsData ? Number(totalListingsData) : 0);
    }
    if (totalListingsData === 0n) {
      setListings([]);
      setCurrentPage(0);
      setError('No active land listings available.');
      toast.info('No active land listings available.');
    }
  }, [totalListingsData, totalListingsError]);

  useEffect(() => {
    async function loadListings() {
      setIsLoading(true);
      try {
        if (!landData || !landData[0] || !publicClient) {
          setListings([]);
          console.log('No land data or public client available');
          return;
        }

        const enrichedListings = await Promise.all(
          landData[0].map(async (listing: LandListing) => {
            if (listing.isActive) {
              const metadata = await getMetadata(listing.metadataURI);
              const leaseDetails = await publicClient.readContract({
                address: GreenFiLand.address as `0x${string}`,
                abi: GreenFiLand.abi,
                functionName: 'getLeaseDetails',
                args: [listing.id],
              }) as Lease;
              if (!metadata) {
                console.warn(`Skipping listing ${listing.id} due to missing metadata`);
                return null;
              }
              return { ...listing, metadata, leaseDetails };
            }
            return null;
          })
        );
        setListings(enrichedListings.filter((l): l is EnrichedListing => l !== null));
      } catch (err) {
        setError('Failed to load metadata for listings.');
        toast.error('Failed to load metadata for listings.');
        console.error('Metadata loading error:', err);
      } finally {
        setIsLoading(false);
      }
    }

    async function loadPurchases() {
      setIsLoading(true);
      try {
        if (!purchaseData || !publicClient) {
          setPurchases([]);
          console.log('No purchase data or public client available');
          return;
        }

        const enrichedPurchases = await Promise.all(
          purchaseData.map(async (purchase: Purchase) => {
            const listing = await publicClient.readContract({
              address: GreenFiLand.address as `0x${string}`,
              abi: GreenFiLand.abi,
              functionName: 'getLandListing',
              args: [purchase.id],
            }) as LandListing;
            const metadata = await getMetadata(listing.metadataURI);
            if (!metadata) {
              console.error(`Failed to load metadata for purchase ${purchase.id}`);
              return { ...purchase, metadata: { description: 'N/A', image: '', contact: '', latitude: '', longitude: '', size: '', zoning: '', utilities: '', listingType: 'sell', suggestedLeasePrice: '0' } };
            }
            return { ...purchase, metadata };
          })
        );
        setPurchases(enrichedPurchases.filter((p): p is PurchaseWithMetadata => p !== null));
        console.log('Loaded purchases:', enrichedPurchases);
      } catch (err) {
        setError('Failed to load metadata for purchases.');
        toast.error('Failed to load metadata for purchases.');
        console.error('Purchase metadata loading error:', err);
      } finally {
        setIsLoading(false);
      }
    }

    loadListings();
    loadPurchases();
  }, [landData, purchaseData, publicClient]);

  const filteredListings = showUserListingsOnly
    ? listings.filter((listing) => listing.owner.toLowerCase() === address.toLowerCase())
    : listings;

  const filteredPurchases = purchases; // Show all purchases regardless of showUserListingsOnly

  const totalPages = Math.ceil(totalListings / pageSize);

  const handleNextPage = () => {
    if (currentPage < totalPages - 1) {
      setCurrentPage(currentPage + 1);
    }
  };

  const handlePreviousPage = () => {
    if (currentPage > 0) {
      setCurrentPage(currentPage - 1);
    }
  };

  const handleRefreshListings = () => {
    if (!address) return;
    setIsConfirming(true);
    setTimeout(() => {
      refetchLandData();
      refetchTotalListings();
      refetchPurchaseData();
      setIsConfirming(false);
      toast.info('Listings refreshed successfully!');
    }, 1000);
  };

  return (
    <ErrorBoundary>
      <div className="grid" role="grid" aria-label="Grid of land listings">
        <h2>Land Listings</h2>
        <p>Wallet: {sanitizeHTML(address ? `${address.slice(0, 6)}...${address.slice(-4)}` : 'Not connected')}</p>
        <p>Contract Status: {isPaused ? 'Paused' : 'Active'}</p>
        {isPaused && (
          <p className="error" role="alert">
            Contract is paused. Actions are disabled.
          </p>
        )}
        <div className="filter-controls">
          <label>
            <input
              type="checkbox"
              checked={showUserListingsOnly}
              onChange={() => setShowUserListingsOnly(!showUserListingsOnly)}
              aria-label="Show only my listings"
            />
            Show only my listings
          </label>
        </div>
        {isLoading ? (
          <p className="loading" aria-label="Loading listings">Loading listings...</p>
        ) : totalListings === 0 && filteredPurchases.length === 0 ? (
          <p className="no-land-listings" role="alert">
            {showUserListingsOnly ? 'No active listings or purchases for your address.' : 'No active land listings or purchases.'}
          </p>
        ) : (
          <>
            {filteredListings.map((listing) => (
              <LandListing
                key={listing.id}
                listing={listing}
                address={address}
                onSelect={() => {
                  setSelectedLand(listing);
                  setSelectedPurchase(undefined);
                }}
                messages={messages.filter((msg) => msg.id === listing.id && listing.owner.toLowerCase() === address.toLowerCase())}
              />
            ))}
            {filteredPurchases.map((purchase) => (
              <LandListing
                key={purchase.id}
                purchase={purchase}
                address={address}
                onSelect={() => {
                  setSelectedPurchase(purchase);
                  setSelectedLand(undefined);
                }}
                messages={messages.filter((msg) => msg.id === purchase.id && (purchase.seller.toLowerCase() === address.toLowerCase() || purchase.buyer.toLowerCase() === address.toLowerCase()))}
              />
            ))}
          </>
        )}
        {totalListings > pageSize && (
          <div className="pagination-controls" aria-label="Pagination controls">
            <button
              onClick={handlePreviousPage}
              disabled={currentPage === 0 || totalListings === 0 || isConfirming || isPaused}
              className="action-button"
              aria-label="Previous Page"
            >
              Previous
            </button>
            <span>
              Page {totalListings === 0 ? 0 : currentPage + 1} of {totalListings === 0 ? 0 : totalPages}
            </span>
            <button
              onClick={handleNextPage}
              disabled={currentPage >= totalPages - 1 || totalListings === 0 || isConfirming || isPaused}
              className="action-button"
              aria-label="Next Page"
            >
              Next
            </button>
          </div>
        )}
        <button
          type="button"
          onClick={handleRefreshListings}
          className="action-button"
          disabled={!address || isConfirming || isPaused}
          aria-label="Refresh Listings"
          title="Refresh land listings data"
        >
          {isConfirming ? 'Refreshing...' : 'Refresh Listings'}
        </button>
        {error && <p className="error" role="alert">{error}</p>}
      </div>
      {(selectedLand || selectedPurchase) && (
        <LandModal
          listing={selectedLand}
          purchase={selectedPurchase}
          address={address}
          onClose={() => {
            setSelectedLand(undefined);
            setSelectedPurchase(undefined);
          }}
          refetchListings={refetchLandData}
          refetchPurchases={refetchPurchaseData}
          messages={messages.filter((msg) => msg.id === (selectedLand?.id || selectedPurchase?.id || '') && (selectedLand?.owner.toLowerCase() === address.toLowerCase() || selectedPurchase?.seller.toLowerCase() === address.toLowerCase() || selectedPurchase?.buyer.toLowerCase() === address.toLowerCase()))}
        />
      )}
    </ErrorBoundary>
  );
}