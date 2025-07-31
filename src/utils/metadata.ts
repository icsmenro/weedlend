import { sanitizeHTML } from "./security";
import { getFileFromCID, convertCIDToURL } from "./retrieveFile";

export interface Metadata {
  name?: string;
  description?: string;
  image?: string;
  contact?: string;
  disclaimer?: string;
  collateralDetails?: string;
  strainType?: string; // Kept for seeds compatibility
  category?: string; // Added for products (replacing strainType in product context)
  harvestTimeline?: string;
  latitude?: string;
  longitude?: string;
  size?: string;
  zoning?: string;
  utilities?: string;
  packSize?: number; // Kept for seeds compatibility
  packQuantity?: number; // Kept for seeds compatibility
  unitQuantity?: number; // Added for products (replacing packSize)
  quantityAvailable?: number; // Added for products (replacing packQuantity)
  discount?: number;
  listingType?: 'lease' | 'sell';
  status?: 'active' | 'sold' | 'leased' | 'canceled';
}

export async function getMetadata(uri: string): Promise<Metadata | undefined> {
  try {
    console.log("Processing URI:", uri);

    if (!uri || !uri.startsWith("ipfs://")) {
      console.warn("Invalid IPFS URI: Must start with 'ipfs://'", uri);
      return undefined;
    }

    const cleanUri = uri.replace(/^ipfs:\/\//, "");
    if (!/^[a-zA-Z0-9]{46,59}$/.test(cleanUri)) {
      console.warn("Invalid IPFS CID: Must be a valid base32 or base58 string", cleanUri);
      return undefined;
    }

    const metadata = await getFileFromCID(cleanUri);
    if (!metadata) {
      console.warn("No metadata returned for CID:", cleanUri);
      return undefined;
    }

    let imageUrl = metadata.image ? String(metadata.image) : undefined;
    if (imageUrl && imageUrl.startsWith("ipfs://")) {
      const imageCid = imageUrl.replace(/^ipfs:\/\//, "");
      imageUrl = convertCIDToURL(imageCid, import.meta.env.VITE_PINATA_GATEWAY!);
    }

    return {
      name: metadata.name ? await sanitizeHTML(String(metadata.name)) : undefined,
      description: metadata.description ? await sanitizeHTML(String(metadata.description)) : undefined,
      image: imageUrl ? await sanitizeHTML(imageUrl) : undefined,
      contact: metadata.contact ? await sanitizeHTML(String(metadata.contact)) : undefined,
      disclaimer: metadata.disclaimer ? await sanitizeHTML(String(metadata.disclaimer)) : undefined,
      collateralDetails: metadata.collateralDetails ? await sanitizeHTML(String(metadata.collateralDetails)) : undefined,
      strainType: metadata.strainType ? await sanitizeHTML(String(metadata.strainType)) : undefined,
      category: metadata.category ? await sanitizeHTML(String(metadata.category)) : undefined, // Added
      harvestTimeline: metadata.harvestTimeline ? await sanitizeHTML(String(metadata.harvestTimeline)) : undefined,
      latitude: metadata.latitude ? await sanitizeHTML(String(metadata.latitude)) : undefined,
      longitude: metadata.longitude ? await sanitizeHTML(String(metadata.longitude)) : undefined,
      size: metadata.size ? await sanitizeHTML(String(metadata.size)) : undefined,
      zoning: metadata.zoning ? await sanitizeHTML(String(metadata.zoning)) : undefined,
      utilities: metadata.utilities ? await sanitizeHTML(String(metadata.utilities)) : undefined,
      packSize: metadata.packSize ? Number(metadata.packSize) : undefined,
      packQuantity: metadata.packQuantity ? Number(metadata.packQuantity) : undefined,
      unitQuantity: metadata.unitQuantity ? Number(metadata.unitQuantity) : undefined, // Added
      quantityAvailable: metadata.quantityAvailable ? Number(metadata.quantityAvailable) : undefined, // Added
      discount: metadata.discount ? Number(metadata.discount) : undefined,
      listingType: metadata.listingType ? await sanitizeHTML(String(metadata.listingType)) as 'lease' | 'sell' : undefined,
      status: metadata.status ? await sanitizeHTML(String(metadata.status)) as 'active' | 'sold' | 'leased' | 'canceled' : undefined,
    };
  } catch (err) {
    console.error("Error fetching metadata:", err);
    return undefined;
  }
}