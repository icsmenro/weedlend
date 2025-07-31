import { PinataSDK } from "pinata";

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

export async function getFileFromCID(cid: string): Promise<Metadata> {
  try {
    const cleanCid = cid.replace("ipfs://", "");
    if (!cleanCid || !/^[a-zA-Z0-9]{46,59}$/.test(cleanCid)) {
      throw new Error("Invalid IPFS CID");
    }
    const metadata = await pinata.gateways.public.get(cleanCid);
    if (!metadata.data) {
      throw new Error("No metadata found for this CID");
    }
    const data = typeof metadata.data === "string" ? JSON.parse(metadata.data) : metadata.data;
    return {
      name: data.name || undefined,
      description: data.description || undefined,
      image: data.image || undefined,
      contact: data.contact || undefined,
      disclaimer: data.disclaimer || undefined,
      collateralDetails: data.collateralDetails || undefined,
      strainType: data.strainType || undefined,
      category: data.category || undefined, // Added
      harvestTimeline: data.harvestTimeline || undefined,
      latitude: data.latitude || undefined,
      longitude: data.longitude || undefined,
      size: data.size || undefined,
      zoning: data.zoning || undefined,
      utilities: data.utilities || undefined,
      packSize: data.packSize ? Number(data.packSize) : undefined,
      packQuantity: data.packQuantity ? Number(data.packQuantity) : undefined,
      unitQuantity: data.unitQuantity ? Number(data.unitQuantity) : undefined, // Added
      quantityAvailable: data.quantityAvailable ? Number(data.quantityAvailable) : undefined, // Added
      discount: data.discount ? Number(data.discount) : undefined,
      listingType: data.listingType || undefined,
      status: data.status || undefined,
    };
  } catch (error) {
    console.error("Failed to retrieve file from CID:", error);
    throw new Error(error instanceof Error ? error.message : "File retrieval failed");
  }
}

export function convertCIDToURL(cid: string, gateway: string): string {
  const cleanCid = cid.replace(/^ipfs:\/\//, "");
  const jwt = import.meta.env.VITE_PINATA_JWT;
  const cleanGateway = gateway.replace(/^https?:\/\//, "").replace(/\/$/, "");
  return jwt
    ? `https://${cleanGateway}/ipfs/${cleanCid}?pinataGatewayToken=${jwt}`
    : `https://${cleanGateway}/ipfs/${cleanCid}`;
}