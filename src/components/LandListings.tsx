import { useState, useEffect, Component, ReactNode } from 'react';
import { useReadContract, useWriteContract, useWatchContractEvent } from 'wagmi';
import { parseEther } from 'viem';
import { GreenFiLand } from '../config/contracts';
import { sanitizeHTML } from '../utils/security';
import { getMetadata, Metadata } from '../utils/metadata';
import { toast } from 'react-toastify';

interface LandListing {
  id: string;
  owner: string;
  metadataURI: string;
  collateralValue: bigint;
  isActive: boolean;
  contactInfo: string;
}

interface LandListingsData {
  0: LandListing[];
}

interface EnrichedListing extends LandListing {
  metadata: Metadata;
}

class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return <p className="error" role="alert">Something went wrong while displaying land listings. Please try again.</p>;
    }
    return this.props.children;
  }
}

export default function LandListings({ address }: { address: string }) {
  const [listings, setListings] = useState<EnrichedListing[]>([]);
  const [selectedLand, setSelectedLand] = useState<EnrichedListing | null>(null);
  const [currentPage, setCurrentPage] = useState(0);
  const [pageSize] = useState(10);
  const [totalListings, setTotalListings] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [showUserListingsOnly, setShowUserListingsOnly] = useState(false);

  const { data: totalListingsData, error: totalListingsError, refetch: refetchTotalListings } = useReadContract({
    address: GreenFiLand.address as `0x${string}`,
    abi: GreenFiLand.abi,
    functionName: 'getTotalActiveListings',
  });

  const { data: landData, error: landDataError, refetch: refetchLandData } = useReadContract({
    address: GreenFiLand.address as `0x${string}`,
    abi: GreenFiLand.abi,
    functionName: showUserListingsOnly ? 'getUserListingsPaginated' : 'getAllLandListingsPaginated',
    args: totalListingsData && Number(totalListingsData) > 0 ? [showUserListingsOnly ? address : BigInt(currentPage * pageSize), BigInt(pageSize)] : undefined,
    query: {
      enabled: !!totalListingsData && Number(totalListingsData) > 0,
    },
  }) as { data: LandListingsData | undefined; error: Error | null; refetch: () => void };

  useWatchContractEvent({
    address: GreenFiLand.address as `0x${string}`,
    abi: GreenFiLand.abi,
    eventName: 'LandListed',
    onLogs() {
      refetchLandData();
      refetchTotalListings();
      toast.success('New land listed!');
    },
  });

  useWatchContractEvent({
    address: GreenFiLand.address as `0x${string}`,
    abi: GreenFiLand.abi,
    eventName: 'LandDelisted',
    onLogs() {
      refetchLandData();
      refetchTotalListings();
      toast.success('Land delisted successfully!');
    },
  });

  useWatchContractEvent({
    address: GreenFiLand.address as `0x${string}`,
    abi: GreenFiLand.abi,
    eventName: 'CollateralUpdated',
    onLogs() {
      refetchLandData();
      toast.success('Collateral updated successfully!');
    },
  });

  useEffect(() => {
    if (landDataError) {
      let errorMessage = landDataError.message || 'Failed to fetch listings.';
      if (landDataError.message.includes('InvalidPaginationParameters')) {
        errorMessage = 'No land listings available.';
      } else if (landDataError.message.includes('Pausable: paused')) {
        errorMessage = 'Contract is paused. Please try again later.';
      }
      setError(errorMessage);
      console.error('Land data error:', landDataError);
    } else {
      setError(null);
    }
  }, [landDataError]);

  useEffect(() => {
    if (totalListingsError) {
      setError('Failed to fetch total listings count.');
      console.error('Total listings error:', totalListingsError);
    } else if (totalListingsData) {
      setTotalListings(Number(totalListingsData));
    }
  }, [totalListingsData, totalListingsError]);

  useEffect(() => {
    async function loadListings() {
      setIsLoading(true);
      try {
        if (!landData || !landData[0]) {
          setListings([]);
          return;
        }

        const enrichedListings = await Promise.all(
          landData[0].map(async (listing: LandListing) => {
            if (listing.isActive) {
              const metadata = await getMetadata(listing.metadataURI);
              if (!metadata) {
                console.warn(`Skipping listing ${listing.id} due to missing metadata`);
                return null;
              }
              return { ...listing, metadata };
            }
            return null;
          })
        );
        setListings(enrichedListings.filter((l): l is EnrichedListing => l !== null));
      } catch (err) {
        setError('Failed to load metadata for listings.');
        console.error('Metadata loading error:', err);
      } finally {
        setIsLoading(false);
      }
    }

    loadListings();
  }, [landData]);

  const filteredListings = showUserListingsOnly
    ? listings.filter((listing) => listing.owner.toLowerCase() === address.toLowerCase())
    : listings;

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

  return (
    <ErrorBoundary>
      <div className="grid" role="grid" aria-label="Grid of land listings">
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
        ) : totalListings === 0 || filteredListings.length === 0 ? (
          <p className="no-land-listings" role="alert">
            {showUserListingsOnly ? 'No active listings for your address.' : 'No active land listings.'}
          </p>
        ) : (
          filteredListings.map((listing) => (
            <LandListing
              key={listing.id}
              listing={listing}
              address={address}
              onSelect={() => setSelectedLand(listing)}
            />
          ))
        )}
        {totalListings > pageSize && (
          <div className="pagination-controls" aria-label="Pagination controls">
            <button
              onClick={handlePreviousPage}
              disabled={currentPage === 0 || totalListings === 0}
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
              disabled={currentPage >= totalPages - 1 || totalListings === 0}
              className="action-button"
              aria-label="Next Page"
            >
              Next
            </button>
          </div>
        )}
        {error && <p className="error" role="alert">{error}</p>}
      </div>
      {selectedLand && (
        <LandModal
          listing={selectedLand}
          address={address}
          onClose={() => setSelectedLand(null)}
        />
      )}
    </ErrorBoundary>
  );
}

function LandListing({
  listing,
  address,
  onSelect,
}: {
  listing: EnrichedListing;
  address: string;
  onSelect: () => void;
}) {
  const { writeContract, isPending, error: writeError } = useWriteContract();
  const [collateralValue, setCollateralValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  const canDelist = listing.owner.toLowerCase() === address.toLowerCase();

  useEffect(() => {
    if (writeError) {
      let errorMessage = writeError.message || "Transaction failed.";
      if (writeError.message.includes("InvalidCollateralValue")) {
        errorMessage = "Collateral value must be a positive number.";
      } else if (writeError.message.includes("LandNotActive")) {
        errorMessage = "Land is not active.";
      } else if (writeError.message.includes("Unauthorized")) {
        errorMessage = "You are not authorized to perform this action.";
      } else if (writeError.message.includes("Pausable: paused")) {
        errorMessage = "Contract is paused. Please try again later.";
      }
      setError(errorMessage);
      console.error("Write error:", writeError);
    }
  }, [writeError]);

  const handleCollateralChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (value === "" || (/^\d*\.?\d*$/.test(value) && Number(value) > 0)) {
      const sanitized = await sanitizeHTML(value);
      setCollateralValue(sanitized);
      setError(null);
    } else {
      setError("Collateral value must be a positive number.");
    }
  };

  const handleUpdateCollateral = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!collateralValue || isNaN(Number(collateralValue)) || Number(collateralValue) <= 0) {
      setError("Enter a valid collateral value.");
      return;
    }
    writeContract({
      address: GreenFiLand.address as `0x${string}`,
      abi: GreenFiLand.abi,
      functionName: "updateLandCollateral",
      args: [listing.id, parseEther(collateralValue)],
    });
  };

  const handleDelist = (e: React.MouseEvent) => {
    e.stopPropagation();
    writeContract({
      address: GreenFiLand.address as `0x${string}`,
      abi: GreenFiLand.abi,
      functionName: "delistLand",
      args: [listing.id],
    });
  };

  const handleViewOnGoogleMaps = () => {
    const { latitude, longitude } = listing.metadata || {};
    if (latitude && longitude && !isNaN(Number(latitude)) && !isNaN(Number(longitude))) {
      const mapsUrl = `https://www.google.com/maps?q=${encodeURIComponent(latitude)},${encodeURIComponent(longitude)}`;
      window.open(mapsUrl, "_blank", "noopener,noreferrer");
    } else {
      toast.error("Invalid or missing coordinates.");
    }
  };

  const imageUrl = listing.metadata?.image ? sanitizeHTML(listing.metadata.image) : "";
  const description = listing.metadata?.description || "No description available";
  const latitude = listing.metadata?.latitude || "N/A";
  const longitude = listing.metadata?.longitude || "N/A";
  const size = listing.metadata?.size || "Not specified";
  const zoning = listing.metadata?.zoning || "Not specified";
  const utilities = listing.metadata?.utilities || "Not specified";
  const disclaimer = listing.metadata?.disclaimer || "Please verify the authenticity of this listing before engaging.";

  return (
    <div className="description-item" onClick={onSelect} style={{ cursor: "pointer" }}>
      <p className="disclaimer">{sanitizeHTML(disclaimer)}</p>
      <p>Land ID: {sanitizeHTML(listing.id)}</p>
      {imageUrl && <img src={imageUrl} alt="Land Image" className="listing-image" />}
      <p>Description: {sanitizeHTML(description)}</p>
      <p>Collateral Value: {sanitizeHTML((Number(listing.collateralValue) / 1e18).toFixed(4))} WEEDL</p>
      <p>Coordinates: {sanitizeHTML(latitude)}, {sanitizeHTML(longitude)}</p>
      <p>Size: {sanitizeHTML(size)}</p>
      <p>Zoning: {sanitizeHTML(zoning)}</p>
      <p>Utilities: {sanitizeHTML(utilities)}</p>
      {latitude && longitude && (
        <button
          type="button"
          onClick={handleViewOnGoogleMaps}
          className="action-button"
          aria-label="View location on Google Maps"
        >
          View on Google Maps
        </button>
      )}
      {listing.owner.toLowerCase() === address.toLowerCase() && (
        <>
          <div className="tooltip">
            <label htmlFor={`collateral-input-${listing.id}`}>Collateral Value (WEEDL)</label>
            <span className="tooltip-text">Enter new collateral value (must be positive).</span>
            <input
              id={`collateral-input-${listing.id}`}
              type="text"
              value={collateralValue}
              onChange={handleCollateralChange}
              placeholder="New Collateral Value (WEEDL)"
              className="action-input"
              aria-label="New Collateral Value"
            />
          </div>
          <button
            onClick={handleUpdateCollateral}
            disabled={isPending || !!error}
            className="action-button"
            aria-label="Update Collateral"
          >
            {isPending ? "Updating..." : "Update Collateral"}
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
          {isPending ? "Delisting..." : "Delist"}
        </button>
      )}
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  );
}

function LandModal({
  listing,
  address,
  onClose,
}: {
  listing: EnrichedListing;
  address: string;
  onClose: () => void;
}) {
  const { writeContract, isPending, error: writeError } = useWriteContract();
  const [collateralValue, setCollateralValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  const canDelist = listing.owner.toLowerCase() === address.toLowerCase();

  useEffect(() => {
    if (writeError) {
      let errorMessage = writeError.message || "Transaction failed.";
      if (writeError.message.includes("InvalidCollateralValue")) {
        errorMessage = "Collateral value must be a positive number.";
      } else if (writeError.message.includes("LandNotActive")) {
        errorMessage = "Land is not active.";
      } else if (writeError.message.includes("Unauthorized")) {
        errorMessage = "You are not authorized to perform this action.";
      } else if (writeError.message.includes("Pausable: paused")) {
        errorMessage = "Contract is paused. Please try again later.";
      }
      setError(errorMessage);
      console.error("Write error:", writeError);
    }
  }, [writeError]);

  const handleCollateralChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (value === "" || (/^\d*\.?\d*$/.test(value) && Number(value) > 0)) {
      const sanitized = await sanitizeHTML(value);
      setCollateralValue(sanitized);
      setError(null);
    } else {
      setError("Collateral value must be a positive number.");
    }
  };

  const handleUpdateCollateral = () => {
    if (!collateralValue || isNaN(Number(collateralValue)) || Number(collateralValue) <= 0) {
      setError("Enter a valid collateral value.");
      return;
    }
    writeContract({
      address: GreenFiLand.address as `0x${string}`,
      abi: GreenFiLand.abi,
      functionName: "updateLandCollateral",
      args: [listing.id, parseEther(collateralValue)],
    });
  };

  const handleDelist = () => {
    writeContract({
      address: GreenFiLand.address as `0x${string}`,
      abi: GreenFiLand.abi,
      functionName: "delistLand",
      args: [listing.id],
    });
  };

  const handleViewOnGoogleMaps = () => {
    const { latitude, longitude } = listing.metadata || {};
    if (latitude && longitude && !isNaN(Number(latitude)) && !isNaN(Number(longitude))) {
      const mapsUrl = `https://www.google.com/maps?q=${encodeURIComponent(latitude)},${encodeURIComponent(longitude)}`;
      window.open(mapsUrl, "_blank", "noopener,noreferrer");
    } else {
      toast.error("Invalid or missing coordinates.");
    }
  };

  const imageUrl = listing.metadata?.image ? sanitizeHTML(listing.metadata.image) : "";
  const description = listing.metadata?.description || "No description available";
  const latitude = listing.metadata?.latitude || "N/A";
  const longitude = listing.metadata?.longitude || "N/A";
  const size = listing.metadata?.size || "Not specified";
  const zoning = listing.metadata?.zoning || "Not specified";
  const utilities = listing.metadata?.utilities || "Not specified";
  const disclaimer = listing.metadata?.disclaimer || "Please verify the authenticity of this listing before engaging.";

  return (
    <div className="modal" role="dialog" aria-label="Land Listing Details Modal">
      <div className="modal-content">
        <button className="modal-close" onClick={onClose} aria-label="Close modal">
          ×
        </button>
        <h3>Land Listing Details</h3>
        <p className="disclaimer">{sanitizeHTML(disclaimer)}</p>
        <p>Land ID: {sanitizeHTML(listing.id)}</p>
        {imageUrl && <img src={imageUrl} alt="Land Image" className="listing-image" />}
        <p>Description: {sanitizeHTML(description)}</p>
        <p>Collateral Value: {sanitizeHTML((Number(listing.collateralValue) / 1e18).toFixed(4))} WEEDL</p>
        <p>Contact Info: {sanitizeHTML(listing.contactInfo)}</p>
        <p>Coordinates: {sanitizeHTML(latitude)}, {sanitizeHTML(longitude)}</p>
        <p>Size: {sanitizeHTML(size)}</p>
        <p>Zoning: {sanitizeHTML(zoning)}</p>
        <p>Utilities: {sanitizeHTML(utilities)}</p>
        {latitude && longitude && (
          <button
            type="button"
            onClick={handleViewOnGoogleMaps}
            className="action-button"
            aria-label="View location on Google Maps"
          >
            View on Google Maps
          </button>
        )}
        {listing.owner.toLowerCase() === address.toLowerCase() && (
          <>
            <div className="tooltip">
              <label htmlFor={`modal-collateral-input-${listing.id}`}>Collateral Value (WEEDL)</label>
              <span className="tooltip-text">Enter new collateral value (must be positive).</span>
              <input
                id={`modal-collateral-input-${listing.id}`}
                type="text"
                value={collateralValue}
                onChange={handleCollateralChange}
                placeholder="New Collateral Value (WEEDL)"
                className="action-input"
                aria-label="New Collateral Value"
              />
            </div>
            <button
              onClick={handleUpdateCollateral}
              disabled={isPending || !!error}
              className="action-button"
              aria-label="Update Collateral"
            >
              {isPending ? "Updating..." : "Update Collateral"}
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
            {isPending ? "Delisting..." : "Delist"}
          </button>
        )}
        {error && <p className="error" role="alert">{error}</p>}
      </div>
    </div>
  );
}