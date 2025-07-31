import { PinataSDK } from "pinata";
import { sanitizeHTML } from "./security";

const pinata = new PinataSDK({
  pinataJwt: import.meta.env.VITE_PINATA_JWT!,
  pinataGateway: import.meta.env.VITE_PINATA_GATEWAY!,
});

export interface Metadata {
  name?: string;
  description?: string;
  image?: string;
  contact?: string;
  disclaimer?: string;
  collateralDetails?: string;
  strainType?: string;
  category?: string; // Added for products
  harvestTimeline?: string;
  latitude?: string;
  longitude?: string;
  size?: string;
  zoning?: string;
  utilities?: string;
  packSize?: number;
  packQuantity?: number;
  unitQuantity?: number; // Added for products
  quantityAvailable?: number; // Added for products
  discount?: number;
  listingType?: 'lease' | 'sell';
  status?: 'active' | 'sold' | 'leased' | 'canceled';
}

export async function uploadFile(file: File, metadata: Metadata) {
  try {
    // Validate file size (max 10MB)
    if (file.size > 10 * 1024 * 1024) {
      throw new Error("File size exceeds 10MB limit.");
    }

    // Validate file type
    const validTypes = ["image/jpeg", "image/png", "image/gif"];
    if (!validTypes.includes(file.type)) {
      throw new Error("Invalid file type. Only JPEG, PNG, or GIF are allowed.");
    }

    // Validate listingType and status
    const validListingTypes = ['lease', 'sell'] as const;
    const validStatuses = ['active', 'sold', 'leased', 'canceled'] as const;

    const sanitizedListingType = metadata.listingType
      ? await sanitizeHTML(metadata.listingType)
      : undefined;
    const sanitizedStatus = metadata.status
      ? await sanitizeHTML(metadata.status)
      : 'active';

    // Type guard to ensure sanitized values match expected types
    const validatedListingType: 'lease' | 'sell' | undefined = sanitizedListingType &&
      validListingTypes.includes(sanitizedListingType as typeof validListingTypes[number])
      ? sanitizedListingType as 'lease' | 'sell'
      : undefined;
    const validatedStatus: 'active' | 'sold' | 'leased' | 'canceled' = sanitizedStatus &&
      validStatuses.includes(sanitizedStatus as typeof validStatuses[number])
      ? sanitizedStatus as 'active' | 'sold' | 'leased' | 'canceled'
      : 'active';

    const sanitizedMetadata = {
      name: metadata.name ? await sanitizeHTML(metadata.name) : undefined,
      description: metadata.description ? await sanitizeHTML(metadata.description) : undefined,
      image: metadata.image ? await sanitizeHTML(metadata.image) : undefined,
      contact: metadata.contact ? await sanitizeHTML(metadata.contact) : undefined,
      disclaimer: metadata.disclaimer ? await sanitizeHTML(metadata.disclaimer) : undefined,
      collateralDetails: metadata.collateralDetails
        ? await sanitizeHTML(metadata.collateralDetails)
        : undefined,
      strainType: metadata.strainType ? await sanitizeHTML(metadata.strainType) : undefined,
      category: metadata.category ? await sanitizeHTML(metadata.category) : undefined, // Added
      harvestTimeline: metadata.harvestTimeline
        ? await sanitizeHTML(metadata.harvestTimeline)
        : undefined,
      latitude: metadata.latitude ? await sanitizeHTML(metadata.latitude) : undefined,
      longitude: metadata.longitude ? await sanitizeHTML(metadata.longitude) : undefined,
      size: metadata.size ? await sanitizeHTML(metadata.size) : undefined,
      zoning: metadata.zoning ? await sanitizeHTML(metadata.zoning) : undefined,
      utilities: metadata.utilities ? await sanitizeHTML(metadata.utilities) : undefined,
      packSize: metadata.packSize !== undefined ? Number(metadata.packSize) : undefined,
      packQuantity: metadata.packQuantity !== undefined ? Number(metadata.packQuantity) : undefined,
      unitQuantity: metadata.unitQuantity !== undefined ? Number(metadata.unitQuantity) : undefined, // Added
      quantityAvailable: metadata.quantityAvailable !== undefined ? Number(metadata.quantityAvailable) : undefined, // Added
      discount: metadata.discount !== undefined ? Number(metadata.discount) : undefined,
      listingType: validatedListingType,
      status: validatedStatus,
    };

    const fileResult = await pinata.upload.public.file(file, {
      metadata: {
        name: file.name,
        keyvalues: {
          app: "Reown dApp",
          uploadedBy: "user",
          purpose: "Loan, Land, or Product Listing", // Updated to include Product
        },
      },
    });

    const metadataJson: Metadata = {
      name: file.name,
      description: sanitizedMetadata.description,
      image: `ipfs://${fileResult.cid}`,
      contact: sanitizedMetadata.contact,
      disclaimer: sanitizedMetadata.disclaimer,
      collateralDetails: sanitizedMetadata.collateralDetails,
      strainType: sanitizedMetadata.strainType,
      category: sanitizedMetadata.category, // Added
      harvestTimeline: sanitizedMetadata.harvestTimeline,
      latitude: sanitizedMetadata.latitude,
      longitude: sanitizedMetadata.longitude,
      size: sanitizedMetadata.size,
      zoning: sanitizedMetadata.zoning,
      utilities: sanitizedMetadata.utilities,
      packSize: sanitizedMetadata.packSize,
      packQuantity: sanitizedMetadata.packQuantity,
      unitQuantity: sanitizedMetadata.unitQuantity, // Added
      quantityAvailable: sanitizedMetadata.quantityAvailable, // Added
      discount: sanitizedMetadata.discount,
      listingType: sanitizedMetadata.listingType,
      status: sanitizedMetadata.status,
    };

    // Only include defined fields in the JSON
    const cleanMetadataJson: Partial<Metadata> = {};
    for (const [key, value] of Object.entries(metadataJson)) {
      if (value !== undefined) {
        cleanMetadataJson[key as keyof Metadata] = value;
      }
    }

    const metadataBlob = new Blob([JSON.stringify(cleanMetadataJson)], {
      type: "application/json",
    });
    const metadataFile = new File([metadataBlob], "metadata.json");

    const metadataResult = await pinata.upload.public.file(metadataFile, {
      metadata: {
        name: "Loan, Land, or Product Metadata", // Updated to include Product
        keyvalues: {
          app: "Reown dApp",
          uploadedBy: "user",
          linkedAsset: fileResult.cid,
        },
      },
    });

    return metadataResult;
  } catch (error) {
    console.error("Upload failed:", error);
    throw new Error(error instanceof Error ? error.message : "Upload failed");
  }
}