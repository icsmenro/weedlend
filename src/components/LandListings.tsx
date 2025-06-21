import { useState, useEffect } from 'react';
import { useContractRead, useWriteContract } from 'wagmi';
import { parseEther } from 'viem';
import { GreenFi } from '../config/contracts';
import { sanitizeHTML } from '../utils/security';
import { getMetadata } from '../utils/metadata';
import LandBorrowingForm from './LandBorrowingForm';
import LoanForm from './LoanForm';

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

interface Loan {
  id: string;
  lender: string; // Added to match GreenFi ABI
  borrower: string;
  landId: string;
  amount: bigint;
  interestRate: bigint; // Added to match GreenFi ABI
  duration: bigint;
  startTime: bigint;
  isActive: boolean;
  isRepaid: boolean; // Added to match GreenFi ABI
  isDiscounted: boolean;
  contactInfo: string;
}

interface EnrichedListing extends LandListing {
  metadata: { description: string; image?: string; contact?: string; disclaimer?: string };
}

export default function LandListings({ address }: { address: string }) {
  const [listings, setListings] = useState<EnrichedListing[]>([]);
  const [loans, setLoans] = useState<Loan[]>([]);

  const { data: landData } = useContractRead({
    address: GreenFi.address as `0x${string}`,
    abi: GreenFi.abi,
    functionName: 'getAllLandListings',
  });

  const { data: loanData } = useContractRead({
    address: GreenFi.address as `0x${string}`,
    abi: GreenFi.abi,
    functionName: 'getAllLoans',
  });

  useEffect(() => {
    async function loadListings() {
      if (!landData) return;

      const enrichedListings = await Promise.all(
        (landData as LandListing[]).map(async (listing: LandListing) => {
          if (listing.isActive) {
            const metadata = await getMetadata(listing.metadataURI);
            return { ...listing, metadata };
          }
          return null;
        })
      );
      setListings(enrichedListings.filter((l) => l !== null) as EnrichedListing[]);
    }

    if (loanData) {
      setLoans((loanData as Loan[]).filter((loan) => loan.isActive));
    }

    loadListings();
  }, [landData, loanData]);

  return (
    <div className="grid" role="grid" aria-label="Grid of land listings">
      {listings.length > 0 ? (
        listings.map((listing) => (
          <LandListing key={listing.id} listing={listing} loans={loans} address={address} />
        ))
      ) : (
        <p>No active land listings.</p>
      )}
    </div>
  );
}

function LandListing({ listing, loans, address }: { listing: EnrichedListing; loans: Loan[]; address: string }) {
  const { writeContract, isPending } = useWriteContract();
  const [collateralValue, setCollateralValue] = useState('');

  const loan = loans.find((l) => l.landId === listing.id);
  const canBorrowOrLoan =
    listing.loanId === '' && listing.borrowId === '' && listing.owner.toLowerCase() !== address.toLowerCase();
  const canDelist =
    listing.owner.toLowerCase() === address.toLowerCase() && listing.loanId === '' && listing.borrowId === '';

  const handleCollateralChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const sanitized = await sanitizeHTML(e.target.value);
    setCollateralValue(sanitized);
  };

  const handleUpdateCollateral = () => {
    if (!collateralValue || isNaN(Number(collateralValue))) return alert('Enter a valid collateral value');
    writeContract({
      address: GreenFi.address as `0x${string}`,
      abi: GreenFi.abi,
      functionName: 'updateLandCollateral', // WARNING: updateLandCollateral not in provided ABI
      args: [listing.id, parseEther(collateralValue)],
    });
  };

  const handleDelist = () => {
    writeContract({
      address: GreenFi.address as `0x${string}`,
      abi: GreenFi.abi,
      functionName: 'delistLand',
      args: [listing.id],
    });
  };

  const imageUrl = listing.metadata.image ? sanitizeHTML(listing.metadata.image) : '';

  return (
    <div className="description-item">
      <p className="disclaimer">Disclaimer: Please verify the authenticity of this listing before engaging.</p>
      <p>Land ID: {sanitizeHTML(listing.id)}</p>
      {imageUrl && <img src={imageUrl} alt="Land Image" className="listing-image" />}
      <p>Description: {sanitizeHTML(listing.metadata.description || 'No description available')}</p>
      <p>Collateral Value: {sanitizeHTML((Number(listing.collateralValue) / 1e18).toFixed(4))} WEEDL</p>
      <p>Contact: {sanitizeHTML(listing.contactInfo)}</p>
      {loan && loan.isDiscounted && <p className="discount-info">Discounted: 0.1% applied</p>}
      {listing.owner.toLowerCase() === address.toLowerCase() && (
        <>
          <input
            type="number"
            value={collateralValue}
            onChange={handleCollateralChange}
            placeholder="New Collateral Value (WEEDL)"
            className="action-input"
            aria-label="Collateral Value"
          />
          <button
            onClick={handleUpdateCollateral}
            disabled={isPending}
            className="action-button"
            aria-label="Update Collateral"
          >
            {isPending ? 'Updating...' : 'Update Collateral'}
          </button>
        </>
      )}
      {canDelist && (
        <button
          onClick={handleDelist}
          disabled={isPending}
          className="action-button"
          aria-label="Delist Land"
        >
          {isPending ? 'Delisting...' : 'Delist'}
        </button>
      )}
      {canBorrowOrLoan && (
        <>
          <LoanForm landId={listing.id} collateralValue={listing.collateralValue} address={address} />
          <LandBorrowingForm
            landId={listing.id}
            collateralValue={listing.collateralValue}
            address={address}
          />
        </>
      )}
    </div>
  );
}