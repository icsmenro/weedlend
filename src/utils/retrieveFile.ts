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
      name: data.name || "",
      description: data.description || "",
      image: data.image || "",
      contact: data.contact || "",
      disclaimer: data.disclaimer || "",
      collateralDetails: data.collateralDetails || "",
      strainType: data.strainType || "",
      harvestTimeline: data.harvestTimeline || "",
      latitude: data.latitude || "",
      longitude: data.longitude || "",
      size: data.size || "",
      zoning: data.zoning || "",
      utilities: data.utilities || "",
      packSize: data.packSize ? Number(data.packSize) : undefined,
      packQuantity: data.packQuantity ? Number(data.packQuantity) : undefined,
      discount: data.discount ? Number(data.discount) : undefined,
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