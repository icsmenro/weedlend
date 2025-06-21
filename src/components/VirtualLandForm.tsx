import { useState } from 'react';
import { useWriteContract } from 'wagmi';
import { GreenFi } from '../config/contracts';
import { uploadFile } from '../utils/uploadFile';
import { sanitizeHTML } from '../utils/security';
import { getMetadata } from '../utils/metadata';
import { convertCIDToURL } from '../utils/retrieveFile';

export default function VirtualLandForm() {
  const [file, setFile] = useState<File | null>(null);
  const [description, setDescription] = useState('');
  const [contactInfo, setContactInfo] = useState('');
  const [uploading, setUploading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [fetchedMetadata, setFetchedMetadata] = useState<null | {
    description: string;
    contact?: string;
    image?: string;
  }>(null);

  const { writeContract, isPending } = useWriteContract();

  const handleDescriptionChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const sanitized = await sanitizeHTML(e.target.value);
    setDescription(sanitized);
  };

  const handleContactChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const sanitized = await sanitizeHTML(e.target.value);
    setContactInfo(sanitized);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return alert('Please upload a file');
    if (!contactInfo) return alert('Please provide contact information');

    setUploading(true);
    try {
      const result = await uploadFile(file, {
        description,
        contact: contactInfo,
        disclaimer: 'Please verify the authenticity of this listing before engaging.',
      });

      const metadataCID = result.cid;
      const uri = `ipfs://${metadataCID}`;

      writeContract({
        address: GreenFi.address as `0x${string}`,
        abi: GreenFi.abi,
        functionName: 'showcaseVirtualLand', // WARNING: showcaseVirtualLand not in provided ABI
        args: [uri, contactInfo],
      });

      const metadata = await getMetadata(uri);
      setFetchedMetadata(metadata);

      if (metadata.image) {
        const imageCID = metadata.image.replace('ipfs://', '');
        const imageUrl = convertCIDToURL(imageCID, import.meta.env.VITE_PINATA_GATEWAY);
        setPreviewUrl(imageUrl);
      }
    } catch (err) {
      console.error(err);
      alert('Failed to upload or interact with the contract');
    } finally {
      setUploading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="description-item">
      <h3>Showcase Virtual Land</h3>
      <p className="disclaimer">Disclaimer: Please verify the authenticity of all listings before engaging.</p>
      <input
        type="file"
        accept="image/*,.glb,.gltf"
        onChange={(e) => setFile(e.target.files?.[0] || null)}
        required
        className="action-input"
        aria-label="Upload Virtual Land File"
      />
      <input
        type="text"
        value={description}
        onChange={handleDescriptionChange}
        placeholder="Description (e.g., Virtual Farm)"
        required
        className="action-input"
        aria-label="Description"
      />
      <input
        type="text"
        value={contactInfo}
        onChange={handleContactChange}
        placeholder="Contact Info (e.g., website, email, social media)"
        required
        className="action-input"
        aria-label="Contact Information"
      />
      <button
        type="submit"
        disabled={isPending || uploading}
        className="action-button"
        aria-label="Showcase Virtual Land"
      >
        {uploading ? 'Uploading...' : isPending ? 'Showcasing...' : 'Showcase Virtual Land'}
      </button>
      {fetchedMetadata && (
        <div className="preview">
          <h4>Preview:</h4>
          <p><strong>Description:</strong> {sanitizeHTML(fetchedMetadata.description)}</p>
          {fetchedMetadata.contact && <p><strong>Contact:</strong> {sanitizeHTML(fetchedMetadata.contact)}</p>}
          {previewUrl && (
            <img src={previewUrl} alt="Uploaded Virtual Land" style={{ maxWidth: '100%', marginTop: '1rem' }} />
          )}
        </div>
      )}
    </form>
  );
}