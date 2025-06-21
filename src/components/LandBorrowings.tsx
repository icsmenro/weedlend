import { useState, useEffect } from 'react';
import { useContractRead, useWriteContract } from 'wagmi';
import { GreenFi } from '../config/contracts';
import { sanitizeHTML } from '../utils/security';
import { getMetadata } from '../utils/metadata';

interface LandBorrowing {
  id: string;
  borrower: string;
  landId: string;
  duration: bigint;
  startTime: bigint;
  amount: bigint;
  isActive: boolean;
  isDiscounted: boolean;
  contactInfo: string;
}

interface LandListing {
  id: string;
  owner: string;
  metadataURI: string;
  collateralValue: bigint;
  isActive: boolean;
  loanId: string;
  borrowId: string;
  contactInfo: string;
}

export default function LandBorrowings({ address }: { address: string }) {
  const [borrowings, setBorrowings] = useState<LandBorrowing[]>([]);
  const [landListings, setLandListings] = useState<LandListing[]>([]);

  const { data: loanData } = useContractRead({
    address: GreenFi.address as `0x${string}`,
    abi: GreenFi.abi,
    functionName: 'getAllLoans',
  });

  const { data: landData } = useContractRead({
    address: GreenFi.address as `0x${string}`,
    abi: GreenFi.abi,
    functionName: 'getAllLandListings',
  });

  useEffect(() => {
    if (loanData) {
      setBorrowings(
        (loanData as LandBorrowing[])
          .filter((borrowing) => borrowing.isActive && borrowing.borrower.toLowerCase() === address.toLowerCase())
      );
    }
    if (landData) {
      setLandListings(landData as LandListing[]);
    }
  }, [loanData, landData, address]);

  return (
    <div className="grid" role="grid" aria-label="Grid of land borrowings">
      {borrowings.length > 0 ? (
        borrowings.map((borrowing) => (
          <LandBorrowingItem key={borrowing.id} borrowing={borrowing} landListings={landListings} address={address} />
        ))
      ) : (
        <p>No active land borrowings.</p>
      )}
    </div>
  );
}

function LandBorrowingItem({ borrowing, landListings, address }: { borrowing: LandBorrowing; landListings: LandListing[]; address: string }) {
  const { writeContract, isPending } = useWriteContract();
  const [metadata, setMetadata] = useState<{ description: string; contact?: string; image?: string; disclaimer?: string } | null>(null);

  const land = landListings.find((l) => l.id === borrowing.landId);

  useEffect(() => {
    async function loadMetadata() {
      if (land) {
        const meta = await getMetadata(land.metadataURI);
        setMetadata(meta);
      }
    }
    loadMetadata();
  }, [land]); // Added 'land' to dependency array to fix ESLint warning

  const handleReturn = () => {
    writeContract({
      address: GreenFi.address as `0x${string}`,
      abi: GreenFi.abi,
      functionName: 'repayLoan',
      args: [borrowing.id],
    });
  };

  const amount = Number(borrowing.amount) / 1e18;
  const durationDays = Number(borrowing.duration) / 86400;

  return (
    <div className="description-item">
      <p className="disclaimer">Disclaimer: Please verify the authenticity of this borrowing before engaging.</p>
      <p>Borrowing ID: {sanitizeHTML(borrowing.id)}</p>
      <p>Land ID: {sanitizeHTML(borrowing.landId)}</p>
      <p>Amount: {sanitizeHTML(amount.toFixed(4))} WEEDL</p>
      <p>Duration: {sanitizeHTML(durationDays.toString())} days</p>
      <p>Contact: {sanitizeHTML(borrowing.contactInfo)}</p>
      {borrowing.isDiscounted && <p className="discount-info">Discounted: 0.1% applied</p>}
      {metadata?.image && <img src={sanitizeHTML(metadata.image)} alt="Land Image" className="listing-image" />}
      <p>Description: {sanitizeHTML(metadata?.description || 'Loading...')}</p>
      {borrowing.borrower.toLowerCase() === address.toLowerCase() && (
        <button
          onClick={handleReturn}
          disabled={isPending}
          className="action-button"
          aria-label="Repay Loan"
        >
          {isPending ? 'Repaying...' : 'Repay Loan'}
        </button>
      )}
    </div>
  );
}