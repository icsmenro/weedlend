import { PinataSDK } from 'pinata';
import { sanitizeHTML } from './sanitize';

const pinata = new PinataSDK({
  pinataJwt: import.meta.env.VITE_PINATA_JWT!,
  pinataGateway: import.meta.env.VITE_PINATA_GATEWAY!,
});

interface Metadata {
  description: string;
  contact: string;
  disclaimer: string; // Added for requirement
}

export async function uploadFile(file: File, metadata: Metadata) {
  try {
    const sanitizedMetadata = {
      description: await sanitizeHTML(metadata.description),
      contact: await sanitizeHTML(metadata.contact),
      disclaimer: await sanitizeHTML(metadata.disclaimer),
    };

    const fileResult = await pinata.upload.public.file(file, {
      metadata: {
        name: file.name,
        keyvalues: {
          app: 'Reown dApp',
          uploadedBy: 'user',
          purpose: 'Virtual Land Listing',
        },
      },
    });

    const metadataJson = {
      name: file.name,
      description: sanitizedMetadata.description,
      contact: sanitizedMetadata.contact,
      disclaimer: sanitizedMetadata.disclaimer,
      image: `ipfs://${fileResult.cid}`,
    };

    const metadataBlob = new Blob([JSON.stringify(metadataJson)], {
      type: 'application/json',
    });
    const metadataFile = new File([metadataBlob], 'metadata.json');

    const metadataResult = await pinata.upload.public.file(metadataFile, {
      metadata: {
        name: 'Virtual Land Metadata',
        keyvalues: {
          app: 'Reown dApp',
          uploadedBy: 'user',
          linkedAsset: fileResult.cid,
        },
      },
    });

    return metadataResult;
  } catch (error) {
    console.error('Upload failed:', error);
    throw new Error('Upload failed');
  }
}