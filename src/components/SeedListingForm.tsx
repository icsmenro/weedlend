import { useState } from 'react';
import { useWriteContract } from 'wagmi';
import { parseEther } from 'viem';
import { GreenFi } from '../config/contracts';
import { uploadFile } from '../utils/uploadFile';
import { sanitizeHTML } from '../utils/security';
import { convertCIDToURL } from '../utils/retrieveFile';

export default function SeedListingForm() {
  const [image, setImage] = useState<File | null>(null);
  const [description, setDescription] = useState('');
  const [contactInfo, setContactInfo] = useState('');
  const [price, setPrice] = useState('');
  const [discountPercentage, setDiscountPercentage] = useState('');
  const [maxDiscountQuantity, setMaxDiscountQuantity] = useState('');
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

  const handlePriceChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const sanitized = await sanitizeHTML(e.target.value);
    setPrice(sanitized);
  };

  const handleDiscountPercentageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const sanitized = await sanitizeHTML(e.target.value);
    setDiscountPercentage(sanitized);
  };

  const handleMaxDiscountQuantityChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const sanitized = await sanitizeHTML(e.target.value);
    setMaxDiscountQuantity(sanitized);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!image) return alert('Please upload an image');
    if (!price || isNaN(Number(price))) return alert('Please enter a valid price');
    if (!contactInfo) return alert('Please provide contact information');
    if (discountPercentage && isNaN(Number(discountPercentage))) return alert('Please enter a valid discount percentage');
    if (maxDiscountQuantity && isNaN(Number(maxDiscountQuantity))) return alert('Please enter a valid discount quantity');

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
        functionName: 'listSeed', // WARNING: listSeed not in provided ABI
        args: [
          uri,
          parseEther(price),
          BigInt(discountPercentage || 0),
          BigInt(maxDiscountQuantity || 0),
          contactInfo,
        ],
      });
    } catch (err) {
      console.error(err);
      alert('Failed to upload metadata or list seed');
    } finally {
      setUploading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="description-item">
      <h3>List Seed</h3>
      <p className="disclaimer">Disclaimer: Please verify the authenticity of all listings before engaging.</p>
      <input
        type="file"
        accept="image/*"
        onChange={(e) => setImage(e.target.files?.[0] || null)}
        required
        className="action-input"
        aria-label="Upload Seed Image"
      />
      <input
        type="text"
        value={description}
        onChange={handleDescriptionChange}
        placeholder="Seed Description"
        required
        className="action-input"
        aria-label="Seed Description"
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
        value={price}
        onChange={handlePriceChange}
        placeholder="Price (WEEDL)"
        required
        min="0"
        step="0.01"
        className="action-input"
        aria-label="Seed Price in WEEDL"
      />
      <input
        type="number"
        value={discountPercentage}
        onChange={handleDiscountPercentageChange}
        placeholder="Discount Percentage (0-50)"
        min="0"
        max="50"
        step="0.1"
        className="action-input"
        aria-label="Discount Percentage"
      />
      <input
        type="number"
        value={maxDiscountQuantity}
        onChange={handleMaxDiscountQuantityChange}
        placeholder="Max Discount Quantity"
        min="0"
        step="1"
        className="action-input"
        aria-label="Max Discount Quantity"
      />
      <button
        type="submit"
        disabled={isPending || uploading}
        className="action-button"
        aria-label="List Seed"
      >
        {uploading ? 'Uploading...' : isPending ? 'Listing...' : 'List Seed'}
      </button>
    </form>
  );
}