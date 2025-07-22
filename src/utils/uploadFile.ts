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
  harvestTimeline?: string;
  latitude?: string;
  longitude?: string;
  size?: string;
  zoning?: string;
  utilities?: string;
  packSize?: number;
  packQuantity?: number;
  discount?: number;
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

    const sanitizedMetadata = {
      name: metadata.name ? await sanitizeHTML(metadata.name) : undefined,
      description: metadata.description ? await sanitizeHTML(metadata.description) : undefined,
      image: metadata.image ? await sanitizeHTML(metadata.image) : undefined,
      contact: metadata.contact ? await sanitizeHTML(metadata.contact) : undefined,
      disclaimer: metadata.disclaimer ? await sanitizeHTML(metadata.disclaimer) : undefined,
      collateralDetails: metadata.collateralDetails ? await sanitizeHTML(metadata.collateralDetails) : undefined,
      strainType: metadata.strainType ? await sanitizeHTML(metadata.strainType) : undefined,
      harvestTimeline: metadata.harvestTimeline ? await sanitizeHTML(metadata.harvestTimeline) : undefined,
      latitude: metadata.latitude ? await sanitizeHTML(metadata.latitude) : undefined,
      longitude: metadata.longitude ? await sanitizeHTML(metadata.longitude) : undefined,
      size: metadata.size ? await sanitizeHTML(metadata.size) : undefined,
      zoning: metadata.zoning ? await sanitizeHTML(metadata.zoning) : undefined,
      utilities: metadata.utilities ? await sanitizeHTML(metadata.utilities) : undefined,
      packSize: metadata.packSize !== undefined ? Number(metadata.packSize) : undefined,
      packQuantity: metadata.packQuantity !== undefined ? Number(metadata.packQuantity) : undefined,
      discount: metadata.discount !== undefined ? Number(metadata.discount) : undefined,
    };

    const fileResult = await pinata.upload.public.file(file, {
      metadata: {
        name: file.name,
        keyvalues: {
          app: "Reown dApp",
          uploadedBy: "user",
          purpose: "Loan or Land Listing",
        },
      },
    });

    const metadataJson = {
      name: file.name,
      description: sanitizedMetadata.description,
      image: `ipfs://${fileResult.cid}`,
      contact: sanitizedMetadata.contact,
      disclaimer: sanitizedMetadata.disclaimer,
      collateralDetails: sanitizedMetadata.collateralDetails,
      strainType: sanitizedMetadata.strainType,
      harvestTimeline: sanitizedMetadata.harvestTimeline,
      latitude: sanitizedMetadata.latitude,
      longitude: sanitizedMetadata.longitude,
      size: sanitizedMetadata.size,
      zoning: sanitizedMetadata.zoning,
      utilities: sanitizedMetadata.utilities,
      packSize: sanitizedMetadata.packSize,
      packQuantity: sanitizedMetadata.packQuantity,
      discount: sanitizedMetadata.discount,
    };

    const metadataBlob = new Blob([JSON.stringify(metadataJson)], {
      type: "application/json",
    });
    const metadataFile = new File([metadataBlob], "metadata.json");

    const metadataResult = await pinata.upload.public.file(metadataFile, {
      metadata: {
        name: "Loan or Land Metadata",
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