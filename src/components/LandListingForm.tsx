import { useState, useEffect, FormEvent, useCallback } from 'react';
import { useWriteContract, useWaitForTransactionReceipt, useReadContract, useAccount, useBalance, usePublicClient, useWatchContractEvent } from 'wagmi';
import { parseEther, encodeFunctionData, formatEther } from 'viem';
import { GreenFiLand, WEEDL } from '../config/contracts';
import { uploadFile } from '../utils/uploadFile';
import { sanitizeHTML } from '../utils/security';
import { convertCIDToURL } from '../utils/retrieveFile';
import { v4 as uuidv4 } from 'uuid';
import { toast } from 'react-toastify';
import type { Log } from 'viem';

// Define the event arguments for LandListed
type LandListedEventArgs = {
  id: string;
  owner: `0x${string}`;
  metadataURI: string;
  collateralValue: bigint;
  contactInfo: string;
  suggestedLeasePrice: bigint;
  fee: bigint;
  listingType: number; // 1: Sell, 2: Lease
};

interface LandFormData {
  id: string;
  collateralValue: string;
  contactInfo: string;
  description: string;
  latitude: string;
  longitude: string;
  size: string;
  zoning: string;
  utilities: string;
  image: File | null;
  suggestedLeasePrice: string;
  listingType: 'lease' | 'sell'; // UI selection for lease or sell
}

export default function LandListingForm() {
  const [formData, setFormData] = useState<LandFormData>({
    id: '',
    collateralValue: '',
    contactInfo: '',
    description: '',
    latitude: '',
    longitude: '',
    size: '',
    zoning: '',
    utilities: '',
    image: null,
    suggestedLeasePrice: '',
    listingType: 'sell', // Default to 'sell'
  });
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [approvalHash, setApprovalHash] = useState<`0x${string}` | undefined>();
  const [listingHash, setListingHash] = useState<`0x${string}` | undefined>();
  const [transactionStep, setTransactionStep] = useState<'none' | 'approving' | 'listing'>('none');
  const [lastLandId, setLastLandId] = useState<string | null>(null);
  const [cid, setCid] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<{ [key: string]: string }>({});
  const [gasEstimate, setGasEstimate] = useState<string | null>(null);
  const [popup, setPopup] = useState<{ message: string; visible: boolean }>({ message: '', visible: false });
  const [showContactConfirm, setShowContactConfirm] = useState(false);

  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { writeContract, data: writeData, error: writeError, isPending } = useWriteContract();
  const { isLoading: isApprovalConfirming, isSuccess: isApprovalConfirmed, error: approvalError } = useWaitForTransactionReceipt({ hash: approvalHash });
  const { isLoading: isListingConfirming, isSuccess: isListingConfirmed, error: listingError } = useWaitForTransactionReceipt({ hash: listingHash });

  const { data: balance, refetch: refetchBalance } = useReadContract({
    address: WEEDL.address as `0x${string}`,
    abi: WEEDL.abi,
    functionName: 'balanceOf',
    args: [address ?? '0x0' as `0x${string}`],
    query: { refetchInterval: 30000 },
  }) as { data: bigint | undefined; refetch: () => void };

  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: WEEDL.address as `0x${string}`,
    abi: WEEDL.abi,
    functionName: 'allowance',
    args: [address ?? '0x0' as `0x${string}`, GreenFiLand.address as `0x${string}`],
    query: { refetchInterval: 30000 },
  }) as { data: bigint | undefined; refetch: () => void };

  const { data: ethBalance } = useBalance({ address });

  const { data: isPaused } = useReadContract({
    address: GreenFiLand.address as `0x${string}`,
    abi: GreenFiLand.abi,
    functionName: 'paused',
    query: { refetchInterval: 30000 },
  }) as { data: boolean | undefined };

  useWatchContractEvent({
    address: GreenFiLand.address as `0x${string}`,
    abi: GreenFiLand.abi,
    eventName: 'LandListed',
    onLogs(logs: Log[]) {
      const log = logs[0] as Log<bigint, number, false, undefined, true, typeof GreenFiLand.abi, 'LandListed'>;
      const args = log.args as LandListedEventArgs;
      if (args.owner?.toLowerCase() === address?.toLowerCase()) {
        setSuccess(true);
        setPopup({ message: `Land listing for ${formData.listingType} created successfully!`, visible: true });
        toast.success(`Land listing for ${formData.listingType} created successfully!`);
        setUploading(false);
        setFormData({
          id: '',
          collateralValue: '',
          contactInfo: '',
          description: '',
          latitude: '',
          longitude: '',
          size: '',
          zoning: '',
          utilities: '',
          image: null,
          suggestedLeasePrice: '',
          listingType: 'sell',
        });
        setCid(null);
        setLastLandId(null);
        setApprovalHash(undefined);
        setListingHash(undefined);
        setTransactionStep('none');
        setValidationErrors({});
        refetchBalance();
        refetchAllowance();
        console.log('Land Listing Success! Transaction Hash:', log.transactionHash);
        console.log('Check Sepolia Etherscan: https://sepolia.etherscan.io/tx/' + log.transactionHash);
      }
    },
  });

  const showPopup = (message: string) => {
    setPopup({ message, visible: true });
    setTimeout(() => setPopup({ message: '', visible: false }), 3000);
  };

  const totalRequired = useCallback(() => {
    if (!formData.collateralValue || isNaN(Number(formData.collateralValue))) return BigInt(0);
    const collateralWei = parseEther(formData.collateralValue);
    const greenFiFee = (collateralWei * BigInt(42)) / BigInt(10000); // 0.420% fee
    return collateralWei + greenFiFee;
  }, [formData.collateralValue]);

  const parseBlockchainError = useCallback((message: string): string => {
    if (message.includes('User rejected')) return 'Transaction rejected by user.';
    if (message.includes('InvalidLandId')) return 'Land ID is invalid or too long.';
    if (message.includes('InvalidCollateralValue')) return 'Collateral value must be a positive number.';
    if (message.includes('LandInUse')) return 'Land ID is already in use. Retrying with a new ID...';
    if (message.includes('InvalidContactInfo')) return 'Contact info is invalid or too long (max 100 characters).';
    if (message.includes('InvalidMetadataURI')) return 'Metadata URI must start with ipfs://.';
    if (message.includes('InsufficientBalance')) return `Insufficient WEEDL balance. Need ${formatEther(totalRequired())} WEEDL.`;
    if (message.includes('Insufficient allowance')) return `Insufficient allowance. Please approve ${formatEther(totalRequired())} WEEDL.`;
    if (message.includes('nonce too low')) return 'Nonce too low. Please try again.';
    if (message.includes('replacement transaction underpriced')) return 'Transaction failed due to low gas price. Please try again.';
    if (message.includes('Pausable: paused')) return 'Contract is paused.';
    if (message.includes('InvalidListingType')) return 'Invalid listing type selected.';
    if (message.includes('InvalidLeasePrice')) return 'Suggested lease price must be positive for lease listings.';
    if (message.includes('execution reverted')) return `Transaction reverted. Check WEEDL balance (need ${formatEther(totalRequired())} WEEDL), allowance (current: ${formatEther(allowance || 0n)} WEEDL), or contract state.`;
    return message || 'Unknown error occurred.';
  }, [totalRequired, allowance]);

  const estimateGas = useCallback(async () => {
    if (!publicClient || !address || !formData.collateralValue || !formData.contactInfo || !formData.description || !formData.image) {
      setGasEstimate(null);
      return;
    }
    try {
      const requiredWei = totalRequired();
      const sanitizedLandId = `land_${uuidv4().slice(0, 8)}`;
      const sanitizedContactInfo = await sanitizeHTML(formData.contactInfo);
      const suggestedLeasePrice = formData.listingType === 'lease' && formData.suggestedLeasePrice ? formData.suggestedLeasePrice : '0';

      if (!allowance || allowance < requiredWei) {
        const approvalData = encodeFunctionData({
          abi: WEEDL.abi,
          functionName: 'approve',
          args: [GreenFiLand.address as `0x${string}`, requiredWei],
        });
        const approvalGas = await publicClient.estimateGas({
          account: address as `0x${string}`,
          to: WEEDL.address as `0x${string}`,
          data: approvalData,
        });
        const gasPrice = await publicClient.getGasPrice();
        const approvalCost = formatEther(approvalGas * gasPrice);
        setGasEstimate(`Approval: ~${approvalCost} SepoliaETH`);
        toast.info(`Gas estimate for approval: ~${approvalCost} SepoliaETH`);
        return;
      }

      const listingData = encodeFunctionData({
        abi: GreenFiLand.abi,
        functionName: 'listLand',
        args: [
          sanitizedLandId,
          'ipfs://placeholder',
          parseEther(formData.collateralValue),
          sanitizedContactInfo,
          parseEther(suggestedLeasePrice),
          formData.listingType === 'sell' ? 1 : 2,
        ],
      });
      const listingGas = await publicClient.estimateGas({
        account: address as `0x${string}`,
        to: GreenFiLand.address as `0x${string}`,
        data: listingData,
      });
      const gasPrice = await publicClient.getGasPrice();
      const listingCost = formatEther(listingGas * gasPrice);
      setGasEstimate(`Listing: ~${listingCost} SepoliaETH`);
      toast.info(`Gas estimate for listing: ~${listingCost} SepoliaETH`);
    } catch (err) {
      setGasEstimate('Unable to estimate gas.');
      toast.error('Failed to estimate gas.');
      console.error('Gas estimation error:', err);
    }
  }, [publicClient, address, formData.collateralValue, formData.contactInfo, formData.description, formData.image, allowance, totalRequired, formData.suggestedLeasePrice, formData.listingType]);

  useEffect(() => {
    estimateGas();
  }, [estimateGas]);

  const FeeBreakdown = () => {
    const collateralWei = parseEther(formData.collateralValue || '0');
    const greenFiFee = (collateralWei * BigInt(42)) / BigInt(10000); // 0.420% fee
    const total = collateralWei + greenFiFee;
    return (
      <div className="fee-breakdown">
        <p>Collateral Value: {formatEther(collateralWei)} WEEDL</p>
        <p>Listing Fee (0.420%): {formatEther(greenFiFee)} WEEDL</p>
        <p>Total Required: {formatEther(total)} WEEDL</p>
        {gasEstimate && <p>Estimated Network Fee: {gasEstimate}</p>}
        <p className="disclaimer">Note: The listing fee is non-refunded and covers the cost of listing your land.</p>
      </div>
    );
  };

  const MetadataPreview = () => {
    const handleContactClick = () => {
      if (!formData.contactInfo) return;
      const urlRegex = /^(https?:\/\/|mailto:|tel:|tg:\/\/)/i;
      if (urlRegex.test(formData.contactInfo)) {
        setShowContactConfirm(true);
      } else {
        showPopup(`Contact Info: ${sanitizeHTML(formData.contactInfo)}`);
      }
    };

    return (
      <div className="metadata-preview">
        <h4>Preview</h4>
        {formData.image && <img src={URL.createObjectURL(formData.image)} alt="Preview" className="preview-image" />}
        <p><strong>Description:</strong> {sanitizeHTML(formData.description || 'N/A')}</p>
        <p>
          <strong>Contact:</strong>{' '}
          {formData.contactInfo ? (
            <button
              type="button"
              onClick={handleContactClick}
              className="action-button"
              aria-label="Preview contact information"
            >
              View Contact
            </button>
          ) : (
            'N/A'
          )}
        </p>
        <p><strong>Coordinates:</strong> {sanitizeHTML(formData.latitude || 'N/A')}, {sanitizeHTML(formData.longitude || 'N/A')}</p>
        <p><strong>Size:</strong> {sanitizeHTML(formData.size || 'Not specified')}</p>
        <p><strong>Zoning:</strong> {sanitizeHTML(formData.zoning || 'Not specified')}</p>
        <p><strong>Utilities:</strong> {sanitizeHTML(formData.utilities || 'Not specified')}</p>
        {formData.listingType === 'lease' && (
          <p><strong>Suggested Lease Price:</strong> {formData.suggestedLeasePrice ? `${formData.suggestedLeasePrice} WEEDL/day` : 'Not specified'}</p>
        )}
        <p><strong>Listing Type:</strong> {formData.listingType === 'lease' ? 'Lease' : 'Sell'}</p>
        {showContactConfirm && (
          <div className="modal" role="dialog" aria-label="Confirm external link">
            <div className="modal-content">
              <p>Opening external link: {sanitizeHTML(formData.contactInfo)}</p>
              <p>Ensure you trust the destination before proceeding.</p>
              <button
                onClick={() => {
                  window.open(formData.contactInfo, '_blank', 'noopener,noreferrer');
                  setShowContactConfirm(false);
                }}
                className="action-button"
                aria-label="Confirm and open link"
              >
                Proceed
              </button>
              <button
                onClick={() => setShowContactConfirm(false)}
                className="action-button"
                aria-label="Cancel"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    );
  };

  useEffect(() => {
    if (writeError) {
      const errorMessage = parseBlockchainError(writeError.message);
      setError(errorMessage);
      showPopup(errorMessage);
      toast.error(errorMessage);
      setUploading(false);
      setTransactionStep('none');
    }
    if (approvalError) {
      const errorMessage = parseBlockchainError(approvalError.message);
      setError(errorMessage);
      showPopup(errorMessage);
      toast.error(errorMessage);
      setUploading(false);
      setTransactionStep('none');
    }
    if (listingError) {
      const errorMessage = parseBlockchainError(listingError.message);
      setError(errorMessage);
      showPopup(errorMessage);
      toast.error(errorMessage);
      setUploading(false);
      setTransactionStep('none');
      if (listingError.message.includes('LandInUse')) {
        setCid(null);
        setLastLandId(null);
        setTransactionStep('approving');
      }
    }
    if (isListingConfirmed && listingHash) {
      showPopup(`Land listing for ${formData.listingType} created successfully!`);
      toast.success(`Land listing for ${formData.listingType} created successfully!`);
      setSuccess(true);
      setUploading(false);
      setFormData({
        id: '',
        collateralValue: '',
        contactInfo: '',
        description: '',
        latitude: '',
        longitude: '',
        size: '',
        zoning: '',
        utilities: '',
        image: null,
        suggestedLeasePrice: '',
        listingType: 'sell',
      });
      setCid(null);
      setLastLandId(null);
      setApprovalHash(undefined);
      setListingHash(undefined);
      setTransactionStep('none');
      setValidationErrors({});
      refetchBalance();
      refetchAllowance();
    }
  }, [writeError, approvalError, listingError, isListingConfirmed, listingHash, refetchBalance, refetchAllowance, parseBlockchainError, formData.listingType]);

  useEffect(() => {
    if (writeData && transactionStep === 'approving' && !approvalHash) {
      setApprovalHash(writeData);
      showPopup('Approval transaction submitted!');
      toast.info('Approval transaction submitted!');
    } else if (writeData && transactionStep === 'listing' && !listingHash) {
      setListingHash(writeData);
      showPopup('Land listing transaction submitted!');
      toast.info('Land listing transaction submitted!');
    }
  }, [writeData, transactionStep, approvalHash, listingHash]);

  const validateInput = async (field: string, value: string) => {
    const errors = { ...validationErrors };
    switch (field) {
      case 'collateralValue':
        errors.collateralValue = value && (isNaN(Number(value)) || Number(value) <= 0) ? 'Collateral value must be a positive number.' : '';
        break;
      case 'contactInfo':
        if (!value) {
          errors.contactInfo = 'Contact info is required.';
        } else if (value.length > 100) {
          errors.contactInfo = 'Contact info must be 100 characters or less.';
        } else {
          const urlRegex = /^(https?:\/\/|mailto:|tel:|tg:\/\/)/i;
          const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
          const telegramRegex = /^@[\w\d_]{5,}$/;
          if (!urlRegex.test(value) && !emailRegex.test(value) && !telegramRegex.test(value)) {
            errors.contactInfo = 'Contact info must be a valid URL, email, or Telegram handle (e.g., @username).';
          } else {
            errors.contactInfo = '';
          }
        }
        break;
      case 'description':
        errors.description = value ? '' : 'Description is required.';
        break;
      case 'latitude':
        errors.latitude = value && (!/^-?\d*\.?\d*$/.test(value) || Number(value) < -90 || Number(value) > 90)
          ? 'Latitude must be a number between -90 and 90.'
          : '';
        break;
      case 'longitude':
        errors.longitude = value && (!/^-?\d*\.?\d*$/.test(value) || Number(value) < -180 || Number(value) > 180)
          ? 'Longitude must be a number between -180 and 180.'
          : '';
        break;
      case 'suggestedLeasePrice':
        errors.suggestedLeasePrice = formData.listingType === 'lease' && value && (isNaN(Number(value)) || Number(value) <= 0)
          ? 'Suggested lease price must be a positive number for lease listings.'
          : '';
        break;
      case 'size':
      case 'zoning':
      case 'utilities':
        errors[field] = '';
        break;
    }
    setValidationErrors(errors);
  };

  const handleInputChange = async (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    const sanitizedValue = await sanitizeHTML(value);
    await validateInput(name, sanitizedValue);
    setFormData((prev) => ({ ...prev, [name]: sanitizedValue }));
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    setFormData((prev) => ({ ...prev, image: file }));
    setValidationErrors((prev) => ({ ...prev, image: file ? '' : 'Image is required.' }));
  };

  const handleListingTypeChange = (listingType: 'lease' | 'sell') => {
    setFormData((prev) => ({
      ...prev,
      listingType,
      suggestedLeasePrice: listingType === 'sell' ? '' : prev.suggestedLeasePrice,
    }));
    if (listingType === 'sell') {
      setValidationErrors((prev) => ({ ...prev, suggestedLeasePrice: '' }));
    } else {
      validateInput('suggestedLeasePrice', formData.suggestedLeasePrice);
    }
  };

  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      setError(null);
      setSuccess(false);
      setUploading(true);
      setTransactionStep('approving');

      if (isPaused) {
        const errorMsg = 'Cannot list land: Contract is paused.';
        setError(errorMsg);
        showPopup(errorMsg);
        toast.error(errorMsg);
        setUploading(false);
        setTransactionStep('none');
        return;
      }

      try {
        if (!formData.image) throw new Error('Please upload an image.');
        if (!formData.description) throw new Error('Please provide a description.');
        if (!formData.contactInfo) throw new Error('Please provide contact information.');
        if (formData.contactInfo.length > 100) throw new Error('Contact info must be 100 characters or less.');
        const urlRegex = /^(https?:\/\/|mailto:|tel:|tg:\/\/)/i;
        const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
        const telegramRegex = /^@[\w\d_]{5,}$/;
        if (!urlRegex.test(formData.contactInfo) && !emailRegex.test(formData.contactInfo) && !telegramRegex.test(formData.contactInfo)) {
          throw new Error('Contact info must be a valid URL, email, or Telegram handle.');
        }
        if (!formData.collateralValue || isNaN(Number(formData.collateralValue)) || Number(formData.collateralValue) <= 0) {
          throw new Error('Collateral value must be a positive number.');
        }
        if (formData.listingType === 'lease' && (!formData.suggestedLeasePrice || isNaN(Number(formData.suggestedLeasePrice)) || Number(formData.suggestedLeasePrice) <= 0)) {
          throw new Error('Suggested lease price must be a positive number for lease listings.');
        }
        if (formData.latitude && (Number(formData.latitude) < -90 || Number(formData.latitude) > 90)) {
          throw new Error('Latitude must be between -90 and 90.');
        }
        if (formData.longitude && (Number(formData.longitude) < -180 || Number(formData.longitude) > 180)) {
          throw new Error('Longitude must be between -180 and 180.');
        }
        if (!address) throw new Error('Please connect your wallet.');
        if (!ethBalance || ethBalance.value < parseEther('0.001')) {
          throw new Error('Insufficient SepoliaETH for gas fees. Need at least 0.001 SepoliaETH.');
        }
        if (!publicClient) {
          throw new Error('Public client not available. Please try again.');
        }

        const requiredWei = totalRequired();
        if (!balance || balance < requiredWei) {
          throw new Error(
            `Insufficient WEEDL balance. Need ${formatEther(requiredWei)} WEEDL, have ${
              balance ? formatEther(balance) : 0
            } WEEDL.`
          );
        }

        let landId: string;
        let attempts = 0;
        const maxAttempts = 3;

        do {
          const fullUuid = uuidv4();
          landId = `land_${fullUuid.slice(0, 8)}`;
          if (landId.length > 32) throw new Error('Generated land ID is too long.');
          attempts++;
          try {
            const sanitizedLandId = await sanitizeHTML(landId);
            const sanitizedContactInfo = await sanitizeHTML(formData.contactInfo);
            const sanitizedDescription = await sanitizeHTML(formData.description);
            const sanitizedLatitude = await sanitizeHTML(formData.latitude);
            const sanitizedLongitude = await sanitizeHTML(formData.longitude);
            const sanitizedSize = await sanitizeHTML(formData.size);
            const sanitizedZoning = await sanitizeHTML(formData.zoning);
            const sanitizedUtilities = await sanitizeHTML(formData.utilities);
            const suggestedLeasePrice = formData.listingType === 'lease' && formData.suggestedLeasePrice ? formData.suggestedLeasePrice : '0';

            const metadata = {
              image: '', // Will be updated after file upload
              description: sanitizedDescription,
              contact: sanitizedContactInfo,
              disclaimer: 'Please verify the authenticity of this listing before engaging.',
              latitude: sanitizedLatitude,
              longitude: sanitizedLongitude,
              size: sanitizedSize,
              zoning: sanitizedZoning,
              utilities: sanitizedUtilities,
              suggestedLeasePrice,
              listingType: formData.listingType,
            };

            const result = await uploadFile(formData.image, metadata);
            const uri = `ipfs://${result.cid}`;
            const httpUrl = convertCIDToURL(result.cid, import.meta.env.VITE_PINATA_GATEWAY!);
            setCid(result.cid);
            setLastLandId(sanitizedLandId);

            // Update metadata with the correct image URL
            metadata.image = httpUrl;

            console.log('Submitting land listing:', {
              landId: sanitizedLandId,
              uri,
              collateralValue: parseEther(formData.collateralValue).toString(),
              contactInfo: sanitizedContactInfo,
              suggestedLeasePrice: parseEther(suggestedLeasePrice).toString(),
              listingType: formData.listingType === 'sell' ? 1 : 2,
            });
            console.log('Metadata URL:', httpUrl);

            if (!allowance || allowance < requiredWei) {
              writeContract({
                address: WEEDL.address as `0x${string}`,
                abi: WEEDL.abi,
                functionName: 'approve',
                args: [GreenFiLand.address as `0x${string}`, requiredWei],
                gas: BigInt(120000),
                account: address as `0x${string}`,
              });
              return;
            }

            setTransactionStep('listing');
            writeContract({
              address: GreenFiLand.address as `0x${string}`,
              abi: GreenFiLand.abi,
              functionName: 'listLand',
              args: [
                sanitizedLandId,
                uri,
                parseEther(formData.collateralValue),
                sanitizedContactInfo,
                parseEther(suggestedLeasePrice),
                formData.listingType === 'sell' ? 1 : 2,
              ],
              gas: BigInt(600000),
              account: address as `0x${string}`,
            });
            break;
          } catch (err: unknown) {
            if (err instanceof Error && err.message.includes('LandInUse') && attempts < maxAttempts) {
              console.log(`Land ID ${landId} already in use. Retrying (${attempts}/${maxAttempts})...`);
              continue;
            }
            throw err instanceof Error ? err : new Error('Failed to generate a unique land ID.');
          }
        } while (attempts < maxAttempts);

        if (attempts >= maxAttempts) {
          throw new Error('Failed to generate a unique land ID after multiple attempts.');
        }
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? parseBlockchainError(err.message) : 'Failed to upload metadata or list land.';
        setError(errorMessage);
        showPopup(errorMessage);
        toast.error(errorMessage);
        setUploading(false);
        setTransactionStep('none');
      }
    },
    [
      formData.image,
      formData.description,
      formData.contactInfo,
      formData.collateralValue,
      formData.suggestedLeasePrice,
      formData.latitude,
      formData.longitude,
      formData.size,
      formData.zoning,
      formData.utilities,
      formData.listingType,
      balance,
      allowance,
      writeContract,
      address,
      ethBalance,
      totalRequired,
      publicClient,
      parseBlockchainError,
      isPaused,
    ]
  );

  useEffect(() => {
    if (isApprovalConfirmed && approvalHash && transactionStep === 'approving' && cid && lastLandId) {
      setTransactionStep('listing');
      const suggestedLeasePrice = formData.listingType === 'lease' && formData.suggestedLeasePrice ? formData.suggestedLeasePrice : '0';
      writeContract({
        address: GreenFiLand.address as `0x${string}`,
        abi: GreenFiLand.abi,
        functionName: 'listLand',
        args: [
          lastLandId,
          `ipfs://${cid}`,
          parseEther(formData.collateralValue),
          formData.contactInfo,
          parseEther(suggestedLeasePrice),
          formData.listingType === 'sell' ? 1 : 2,
        ],
        gas: BigInt(600000),
        account: address as `0x${string}`,
      });
    }
  }, [isApprovalConfirmed, approvalHash, transactionStep, cid, lastLandId, writeContract, address, formData.collateralValue, formData.contactInfo, formData.suggestedLeasePrice, formData.listingType]);

  return (
    <form onSubmit={handleSubmit} className="description-item" role="form" aria-label="Land Listing Form">
      <h3>List New Land</h3>
      <p className="disclaimer">Disclaimer: Please verify the authenticity of all listings before engaging.</p>
      <p>Wallet: {sanitizeHTML(address ? `${address.slice(0, 6)}...${address.slice(-4)}` : 'Not connected')}</p>
      {balance !== undefined && <p>WEEDL Balance: {formatEther(balance)} WEEDL</p>}
      {ethBalance && <p>SepoliaETH Balance: {formatEther(ethBalance.value)} SepoliaETH</p>}
      {isPaused && (
        <p className="error" role="alert">
          Contract is paused. Listing is disabled.
        </p>
      )}
      {error && <p className="error" role="alert">{error}</p>}
      {gasEstimate && (
        <p className="gas-estimate" aria-label="Estimated gas cost">
          {gasEstimate}
        </p>
      )}
      <div className="input-group">
        <label>Listing Type:</label>
        <div className="radio-group">
          <label>
            <input
              type="radio"
              name="listingType"
              value="sell"
              checked={formData.listingType === 'sell'}
              onChange={() => handleListingTypeChange('sell')}
              disabled={!address || isPaused}
              aria-label="List for Sale"
            />
            Sell
          </label>
          <label>
            <input
              type="radio"
              name="listingType"
              value="lease"
              checked={formData.listingType === 'lease'}
              onChange={() => handleListingTypeChange('lease')}
              disabled={!address || isPaused}
              aria-label="List for Lease"
            />
            Lease
          </label>
        </div>
      </div>
      <div className="input-group">
        <input
          type="file"
          accept="image/*"
          onChange={handleFileChange}
          required
          className="action-input"
          aria-label="Upload Land Image"
          disabled={!address || isPaused}
        />
        {validationErrors.image && <p className="validation-error">{validationErrors.image}</p>}
      </div>
      <div className="input-group">
        <textarea
          name="description"
          value={formData.description}
          onChange={handleInputChange}
          placeholder="Land Description (e.g., Fertile farmland)"
          required
          className="action-input"
          aria-label="Land Description"
          disabled={!address || isPaused}
        />
        {validationErrors.description && <p className="validation-error">{validationErrors.description}</p>}
      </div>
      <div className="input-group">
        <input
          type="text"
          name="contactInfo"
          value={formData.contactInfo}
          onChange={handleInputChange}
          placeholder="Contact Info (e.g., https://example.com, user@example.com, @username)"
          required
          className="action-input"
          aria-label="Contact Information"
          disabled={!address || isPaused}
        />
        {validationErrors.contactInfo && <p className="validation-error">{validationErrors.contactInfo}</p>}
      </div>
      <div className="input-group">
        <div className="tooltip">
          <label htmlFor="collateralValue">Collateral Value (WEEDL)</label>
          <span className="tooltip-text">Enter collateral value (must be positive). 0.420% fee applies.</span>
          <input
            id="collateralValue"
            name="collateralValue"
            type="text"
            value={formData.collateralValue}
            onChange={handleInputChange}
            placeholder="Collateral Value (WEEDL)"
            required
            className="action-input"
            aria-label="Collateral Value in WEEDL"
            disabled={!address || isPaused}
          />
        </div>
        {validationErrors.collateralValue && <p className="validation-error">{validationErrors.collateralValue}</p>}
      </div>
      {formData.listingType === 'lease' && (
        <div className="input-group">
          <div className="tooltip">
            <label htmlFor="suggestedLeasePrice">Suggested Lease Price (WEEDL/day)</label>
            <span className="tooltip-text">Required for lease listings: Suggest a lease price per day.</span>
            <input
              id="suggestedLeasePrice"
              name="suggestedLeasePrice"
              type="text"
              value={formData.suggestedLeasePrice}
              onChange={handleInputChange}
              placeholder="Suggested Lease Price (WEEDL/day)"
              required
              className="action-input"
              aria-label="Suggested Lease Price in WEEDL per day"
              disabled={!address || isPaused}
            />
          </div>
          {validationErrors.suggestedLeasePrice && <p className="validation-error">{validationErrors.suggestedLeasePrice}</p>}
        </div>
      )}
      <div className="coordinates-group">
        <div className="input-group">
          <input
            name="latitude"
            type="text"
            value={formData.latitude}
            onChange={handleInputChange}
            placeholder="Latitude (e.g., 40.7128)"
            className="action-input"
            aria-label="Latitude"
            disabled={!address || isPaused}
          />
          {validationErrors.latitude && <p className="validation-error">{validationErrors.latitude}</p>}
        </div>
        <div className="input-group">
          <input
            name="longitude"
            type="text"
            value={formData.longitude}
            onChange={handleInputChange}
            placeholder="Longitude (e.g., -74.0060)"
            className="action-input"
            aria-label="Longitude"
            disabled={!address || isPaused}
          />
          {validationErrors.longitude && <p className="validation-error">{validationErrors.longitude}</p>}
        </div>
      </div>
      <div className="input-group">
        <input
          name="size"
          type="text"
          value={formData.size}
          onChange={handleInputChange}
          placeholder="Size (e.g., 1000 sq ft)"
          className="action-input"
          aria-label="Land Size"
          disabled={!address || isPaused}
        />
        {validationErrors.size && <p className="validation-error">{validationErrors.size}</p>}
      </div>
      <div className="input-group">
        <input
          name="zoning"
          type="text"
          value={formData.zoning}
          onChange={handleInputChange}
          placeholder="Zoning (e.g., Residential)"
          className="action-input"
          aria-label="Zoning"
          disabled={!address || isPaused}
        />
        {validationErrors.zoning && <p className="validation-error">{validationErrors.zoning}</p>}
      </div>
      <div className="input-group">
        <input
          name="utilities"
          type="text"
          value={formData.utilities}
          onChange={handleInputChange}
          placeholder="Utilities (e.g., Water, Electricity)"
          className="action-input"
          aria-label="Utilities"
          disabled={!address || isPaused}
        />
        {validationErrors.utilities && <p className="validation-error">{validationErrors.utilities}</p>}
      </div>
      <FeeBreakdown />
      <MetadataPreview />
      {isPending || uploading ? (
        <div className="loading" aria-label="Processing transaction">
          <p>{isApprovalConfirming ? 'Approving WEEDL...' : isListingConfirming ? 'Listing Land...' : 'Uploading metadata...'}</p>
        </div>
      ) : (
        <button
          type="submit"
          disabled={isPending || uploading || isApprovalConfirming || isListingConfirming || Object.values(validationErrors).some((e) => e) || !address || isPaused}
          className="action-button"
          aria-label={`List Land for ${formData.listingType}`}
        >
          {isApprovalConfirming ? 'Approving...' : isListingConfirming ? 'Listing...' : `List Land for ${formData.listingType.charAt(0).toUpperCase() + formData.listingType.slice(1)}`}
        </button>
      )}
      {error && <p className="error" role="alert">{error}</p>}
      {success && <p className="success" role="alert">Land listing created successfully!</p>}
      {popup.visible && (
        <div className="popup" role="alert" aria-live="polite">
          {popup.message}
        </div>
      )}
    </form>
  );
}