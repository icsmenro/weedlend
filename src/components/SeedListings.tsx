import { useState, useEffect } from 'react';
import { useContractRead, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { parseEther } from 'viem';
import { GreenFi, WEEDL } from '../config/contracts';
import { sanitizeHTML } from '../utils/security';
import { getMetadata } from '../utils/metadata';

interface SeedListing {
  id: string; // Changed to string to match assumed ABI
  seller: string;
  metadataURI: string;
  price: bigint;
  isActive: boolean;
  discountPercentage: bigint;
  maxDiscountQuantity: bigint;
  contactInfo: string;
}

export default function SeedListings({ address }: { address: string }) {
  const [listings, setListings] = useState<SeedListing[]>([]);

  const { data: seedData } = useContractRead({
    address: GreenFi.address as `0x${string}`,
    abi: GreenFi.abi,
    functionName: 'getAllSeedListings', // WARNING: getAllSeedListings not in provided ABI
  });

  useEffect(() => {
    if (seedData) {
      setListings((seedData as SeedListing[]).filter((listing) => listing.isActive));
    }
  }, [seedData]);

  return (
    <div className="grid" role="grid" aria-label="Grid of seed listings">
      {listings.length > 0 ? (
        listings.map((listing) => (
          <SeedListing key={listing.id} listing={listing} address={address} />
        ))
      ) : (
        <p>No active seed listings.</p>
      )}
    </div>
  );
}

function SeedListing({ listing, address }: { listing: SeedListing; address: string }) {
  const { writeContract: writeApprove, isPending: isPendingApprove, data: approveData } = useWriteContract();
  const { writeContract: writePurchase, isPending: isPendingPurchase } = useWriteContract();
  const { writeContract: writeDelist, isPending: isPendingDelist } = useWriteContract();
  const [approveTxHash, setApproveTxHash] = useState<`0x${string}` | undefined>();
  const { isLoading: isApproving } = useWaitForTransactionReceipt({ hash: approveTxHash });
  const [metadata, setMetadata] = useState<{ description: string; contact?: string; image?: string } | null>(null);

  useEffect(() => {
    async function loadMetadata() {
      const meta = await getMetadata(listing.metadataURI);
      setMetadata(meta);
    }
    loadMetadata();
  }, [listing.metadataURI]);

  useEffect(() => {
    if (approveData && !isApproving && !isPendingPurchase) {
      writePurchase({
        address: GreenFi.address as `0x${string}`,
        abi: GreenFi.abi,
        functionName: 'purchaseSeed', // WARNING: purchaseSeed not in provided ABI
        args: [listing.id],
      });
    }
  }, [approveData, isApproving, isPendingPurchase, listing.id, writePurchase]);

  const price = Number(listing.price) / 1e18;
  const fee = (price * 0.0042).toFixed(4);
  const discount = listing.discountPercentage > 0 && listing.maxDiscountQuantity > 0
    ? (price * Number(listing.discountPercentage) / 10000).toFixed(4)
    : '0';

  const handlePurchase = () => {
    writeApprove({
      address: WEEDL.address as `0x${string}`,
      abi: WEEDL.abi,
      functionName: 'approve',
      args: [
        GreenFi.address as `0x${string}`,
        parseEther((price * 1.0042).toString()),
      ],
    }, {
      onSuccess: (hash) => setApproveTxHash(hash),
    });
  };

  const handleDelist = () => {
    writeDelist({
      address: GreenFi.address as `0x${string}`,
      abi: GreenFi.abi,
      functionName: 'delistSeed', // WARNING: delistSeed not in provided ABI
      args: [listing.id],
    });
  };

  return (
    <div className="description-item">
      <p className="disclaimer">Disclaimer: Please verify the authenticity of this listing before engaging.</p>
      <p>Seed ID: {sanitizeHTML(listing.id)}</p>
      <p>Price: {sanitizeHTML(price.toFixed(2))} WEEDL</p>
      <p>Fee (0.420%): {sanitizeHTML(fee)} WEEDL</p>
      {discount !== '0' && (
        <p>Discount: {sanitizeHTML(discount)} WEEDL ({sanitizeHTML((Number(listing.discountPercentage) / 100).toString())}%)</p>
      )}
      {listing.maxDiscountQuantity > 0 && (
        <p>Remaining Discount Quantity: {sanitizeHTML(listing.maxDiscountQuantity.toString())}</p>
      )}
      <p>Contact: {sanitizeHTML(listing.contactInfo)}</p>
      {metadata?.image && <img src={sanitizeHTML(metadata.image)} alt="Seed Image" className="listing-image" />}
      <p>Description: {sanitizeHTML(metadata?.description || 'Loading...')}</p>
      {listing.seller.toLowerCase() === address.toLowerCase() ? (
        <button
          onClick={handleDelist}
          disabled={isPendingDelist}
          className="action-button"
          aria-label="Delist Seed"
        >
          {isPendingDelist ? 'Delisting...' : 'Delist'}
        </button>
      ) : (
        <button
          onClick={handlePurchase}
          disabled={isPendingApprove || isApproving || isPendingPurchase}
          className="action-button"
          aria-label="Purchase Seed"
        >
          {isPendingApprove || isApproving ? 'Approving...' : isPendingPurchase ? 'Purchasing...' : 'Purchase'}
        </button>
      )}
    </div>
  );
}