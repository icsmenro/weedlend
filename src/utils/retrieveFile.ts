import { PinataSDK } from 'pinata';

const pinata = new PinataSDK({
  pinataJwt: import.meta.env.VITE_PINATA_JWT!,
  pinataGateway: import.meta.env.VITE_PINATA_GATEWAY!,
});

export interface Metadata {
  name?: string;
  description?: string;
  image?: string;
  contact?: string;
}

/**
 * Retrieves metadata JSON from IPFS using a CID.
 * @param cid IPFS CID string
 */
export async function getFileFromCID(cid: string): Promise<Metadata> {
  try {
    const metadata = await pinata.gateways.public.get(cid);
    return metadata as Metadata;
  } catch (error) {
    console.error('Failed to retrieve file from CID:', error);
    throw new Error('File retrieval failed');
  }
}

/**
 * Converts a CID to a usable HTTP URL through a gateway.
 */
export function convertCIDToURL(cid: string, gateway: string): string {
  return `https://${gateway}/ipfs/${cid}`;
}
