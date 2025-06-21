import { useState } from 'react';
import { useWriteContract } from 'wagmi';
import { parseEther } from 'viem';
import { GreenFi } from '../config/contracts';
import { uploadFile } from '../utils/uploadFile';
import { sanitizeHTML } from '../utils/security';
import { convertCIDToURL } from '../utils/retrieveFile';

export default function LandListingForm() {
  const [image, setImage] = useState<File | null>(null);
  const [description, setDescription] = useState('');
  const [contactInfo, setContactInfo] = useState('');
  const [collateralValue, setCollateralValue] = useState('');
  const [uploading, setUploading] = useState(false);

  const { writeContract, isPending } = useWriteContract();

  const handleDescriptionChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const sanitized = await sanitizeHTML(e.target.value);
    setDescription(sanitized);
  };

  const handleContactChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const sanitized = await sanitizeHTML(e.target.value);
    setContactInfo(sanitized);
  };

  const handleCollateralValueChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const sanitized = await sanitizeHTML(e.target.value);
    setCollateralValue(sanitized);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!image) return alert('Please upload an image');
    if (!collateralValue || isNaN(Number(collateralValue))) return alert('Enter a valid collateral value');
    if (!contactInfo) return alert('Please provide contact information');

    setUploading(true);
    try {
      const result = await uploadFile(image, {
        description,
        contact: contactInfo,
        disclaimer: 'Please verify the authenticity of this listing before engaging.',
      });

      const uri = `ipfs://${result.cid}`;
      const httpUrl = convertCIDToURL(result.cid, import.meta.env.VITE_PINATA_GATEWAY!);

      console.log('Metadata URL:', httpUrl);

      writeContract({
        address: GreenFi.address as `0x${string}`,
        abi: GreenFi.abi,
        functionName: 'listLand',
        args: [`land_${Date.now()}`, uri, parseEther(collateralValue), contactInfo],
      });
    } catch (err) {
      console.error(err);
      alert('Failed to upload metadata or list land');
    } finally {
      setUploading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="description-item">
      <h3>List Land</h3>
      <p className="disclaimer">Disclaimer: Please verify the authenticity of all listings before engaging.</p>
      <input
        type="file"
        accept="image/*"
        onChange={(e) => setImage(e.target.files?.[0] || null)}
        required
        className="action-input"
        aria-label="Upload Land Image"
      />
      <input
        type="text"
        value={description}
        onChange={handleDescriptionChange}
        placeholder="Land Description"
        required
        className="action-input"
        aria-label="Land Description"
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
      <input
        type="number"
        value={collateralValue}
        onChange={handleCollateralValueChange}
        placeholder="Collateral Value (WEEDL)"
        required
        min="0"
        step="0.01"
        className="action-input"
        aria-label="Collateral Value in WEEDL"
      />
      <button
        type="submit"
        disabled={isPending || uploading}
        className="action-button"
        aria-label="List Land"
      >
        {uploading ? 'Uploading...' : isPending ? 'Listing...' : 'List Land'}
      </button>
    </form>
  );
}