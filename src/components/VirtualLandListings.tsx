import { useState, useEffect } from 'react';
import { useContractRead, useWriteContract } from 'wagmi';
import { GreenFi } from '../config/contracts';
import { getMetadata } from '../utils/metadata';
import { sanitizeHTML } from '../utils/security';

interface VirtualLand {
  id: string; // Changed to string
  owner: string;
  metadataURI: string;
  isShowcased: boolean;
  contactInfo: string;
}

interface EnrichedListing {
  id: string;
  owner: string;
  metadataURI: string;
  isShowcased: boolean;
  contactInfo: string;
  metadata: { description: string; image?: string; contact?: string; disclaimer?: string };
}

export default function VirtualLandListings({ address }: { address: string }) {
  const [listings, setListings] = useState<EnrichedListing[]>([]);

  const { data: virtualLandData } = useContractRead({
    address: GreenFi.address as `0x${string}`,
    abi: GreenFi.abi,
    functionName: 'getAllVirtualLands', // WARNING: getAllVirtualLands not in provided ABI
  });

  useEffect(() => {
    async function loadListings() {
      if (!virtualLandData) return;

      const enrichedListings = await Promise.all(
        (virtualLandData as VirtualLand[]).map(async (listing: VirtualLand, index) => {
          if (listing.isShowcased) {
            const metadata = await getMetadata(listing.metadataURI);
            return { ...listing, metadata, id: listing.id || `virtual_${index + 1}` };
          }
          return null;
        })
      );
      setListings(enrichedListings.filter((l) => l !== null) as EnrichedListing[]);
    }
    loadListings();
  }, [virtualLandData]);

  return (
    <div className="grid" role="grid" aria-label="Grid of virtual land listings">
      {listings.length > 0 ? (
        listings.map((listing) => (
          <VirtualLandListing key={listing.id} listing={listing} address={address} />
        ))
      ) : (
        <p>No active virtual land listings.</p>
      )}
    </div>
  );
}

function VirtualLandListing({ listing, address }: { listing: EnrichedListing; address: string }) {
  const { writeContract, isPending } = useWriteContract();

  const imageUrl = listing.metadata.image ? sanitizeHTML(listing.metadata.image) : '';

  const handleDelist = () => {
    writeContract({
      address: GreenFi.address as `0x${string}`,
      abi: GreenFi.abi,
      functionName: 'delistVirtualLand', // WARNING: delistVirtualLand not in provided ABI
      args: [listing.id],
    });
  };

  return (
    <div className="description-item">
      <p className="disclaimer">Disclaimer: Please verify the authenticity of this listing before engaging.</p>
      <p>Virtual Land ID: {sanitizeHTML(listing.id)}</p>
      {imageUrl && <img src={imageUrl} alt="Virtual Land" className="listing-image" />}
      <p>Description: {sanitizeHTML(listing.metadata.description || 'No description available')}</p>
      <p>Contact: {sanitizeHTML(listing.contactInfo)}</p>
      {listing.owner.toLowerCase() === address.toLowerCase() && (
        <button
          onClick={handleDelist}
          disabled={isPending}
          className="action-button"
          aria-label="Delist Virtual Land"
        >
          {isPending ? 'Delisting...' : 'Delist'}
        </button>
      )}
    </div>
  );
}