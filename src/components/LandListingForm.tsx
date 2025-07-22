import { useState, useEffect, FormEvent, useCallback } from 'react';
import { useWriteContract, useWaitForTransactionReceipt, useReadContract, useAccount, useBalance, useEstimateGas, usePublicClient, useWatchContractEvent, useGasPrice } from 'wagmi';
import { parseEther, encodeFunctionData, formatEther, Log } from 'viem';
import { GreenFiLand, WEEDL } from '../config/contracts';
import { uploadFile } from '../utils/uploadFile';
import { sanitizeHTML } from '../utils/security';
import { convertCIDToURL } from '../utils/retrieveFile';
import { v4 as uuidv4 } from 'uuid';
import { toast } from 'react-toastify';

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
}

interface LandListedEvent {
  id: string;
  owner: string;
  metadataURI: string;
  collateralValue: bigint;
  contactInfo: string;
  fee: bigint;
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

  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { data: gasPrice } = useGasPrice();
  const { writeContract, data: writeData, error: writeError, isPending } = useWriteContract();
  const { isLoading: isApprovalConfirming, isSuccess: isApprovalConfirmed, error: approvalError } = useWaitForTransactionReceipt({ hash: approvalHash });
  const { isLoading: isListingConfirming, isSuccess: isListingConfirmed, error: listingError } = useWaitForTransactionReceipt({ hash: listingHash });

  const { data: balance, refetch: refetchBalance } = useReadContract({
    address: WEEDL.address as `0x${string}`,
    abi: WEEDL.abi,
    functionName: 'balanceOf',
    args: [address ?? '0x0'],
  }) as { data: bigint | undefined; refetch: () => void };

  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: WEEDL.address as `0x${string}`,
    abi: WEEDL.abi,
    functionName: 'allowance',
    args: [address ?? '0x0', GreenFiLand.address as `0x${string}`],
  }) as { data: bigint | undefined; refetch: () => void };

  const { data: ethBalance } = useBalance({ address });

  const { data: approvalGasEstimate } = useEstimateGas({
    account: address,
    to: WEEDL.address as `0x${string}`,
    data: encodeFunctionData({
      abi: WEEDL.abi,
      functionName: 'approve',
      args: [GreenFiLand.address as `0x${string}`, BigInt(0)],
    }),
  });

  const { data: listingGasEstimate } = useEstimateGas({
    account: address,
    to: GreenFiLand.address as `0x${string}`,
    data: encodeFunctionData({
      abi: GreenFiLand.abi,
      functionName: 'listLand',
      args: ['', 'ipfs://placeholder', parseEther(formData.collateralValue || '0'), ''],
    }),
  });

  useWatchContractEvent({
    address: GreenFiLand.address as `0x${string}`,
    abi: GreenFiLand.abi,
    eventName: 'LandListed',
    onLogs(logs) {
      const log = logs[0] as Log<bigint, number, false, undefined, false, typeof GreenFiLand.abi, 'LandListed'>;
      const args = log.args as LandListedEvent;
      if (args.owner?.toLowerCase() === address?.toLowerCase()) {
        setSuccess(true);
        toast.success('Land listing created successfully!');
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

  const totalRequired = useCallback(() => {
    if (!formData.collateralValue || isNaN(Number(formData.collateralValue))) return BigInt(0);
    const collateralWei = parseEther(formData.collateralValue);
    const greenFiFee = (collateralWei * BigInt(42)) / BigInt(10000);
    return collateralWei + greenFiFee;
  }, [formData.collateralValue]);

  const getNextNonce = useCallback(async () => {
    if (!address || !publicClient) return undefined;
    try {
      const nonce = await publicClient.getTransactionCount({
        address: address as `0x${string}`,
        blockTag: 'pending',
      });
      return nonce;
    } catch (error) {
      console.error('Failed to fetch nonce:', error);
      return undefined;
    }
  }, [address, publicClient]);

  const checkPendingTransactions = useCallback(async () => {
    if (!address || !publicClient) return false;
    try {
      let attempts = 0;
      const maxAttempts = 10;
      let pendingTxCount = await publicClient.getTransactionCount({
        address: address as `0x${string}`,
        blockTag: 'pending',
      });
      const confirmedTxCount = await publicClient.getTransactionCount({
        address: address as `0x${string}`,
        blockTag: 'latest',
      });
      while (pendingTxCount > confirmedTxCount && attempts < maxAttempts) {
        console.log(`Pending transactions detected (${pendingTxCount - confirmedTxCount}). Waiting...`);
        await new Promise((resolve) => setTimeout(resolve, 2000));
        pendingTxCount = await publicClient.getTransactionCount({
          address: address as `0x${string}`,
          blockTag: 'pending',
        });
        attempts++;
      }
      if (pendingTxCount > confirmedTxCount) {
        console.warn('Pending transactions still exist after waiting.');
        return true;
      }
      return false;
    } catch (error) {
      console.error('Failed to check pending transactions:', error);
      return false;
    }
  }, [address, publicClient]);

  const parseBlockchainError = useCallback((message: string): string => {
    if (message.includes('User rejected')) return 'Transaction rejected by user.';
    if (message.includes('InvalidLandId')) return 'Land ID is invalid or too long.';
    if (message.includes('InvalidCollateralValue')) return 'Collateral value must be a positive number.';
    if (message.includes('LandInUse')) return 'Land ID is already in use. Retrying with a new ID...';
    if (message.includes('InvalidContactInfo')) return 'Contact info is invalid or too long (max 100 characters).';
    if (message.includes('InvalidMetadataURI')) return 'Metadata URI must start with ipfs://.';
    if (message.includes('InsufficientBalance')) return `Insufficient WEEDL balance. Need ${(Number(totalRequired()) / 1e18).toFixed(4)} WEEDL.`;
    if (message.includes('Insufficient allowance')) return `Insufficient allowance. Please approve ${(Number(totalRequired()) / 1e18).toFixed(4)} WEEDL.`;
    if (message.includes('nonce too low')) return 'Nonce too low. Please try again or check for pending transactions.';
    if (message.includes('replacement transaction underpriced')) return 'Transaction failed due to low gas price. Please try again with a higher gas price.';
    if (message.includes('Pausable: paused')) return 'Contract is paused. Please try again later.';
    if (message.includes('execution reverted')) return `Transaction reverted. Check WEEDL balance (need ${(Number(totalRequired()) / 1e18).toFixed(4)} WEEDL), allowance (current: ${(Number(allowance || 0n) / 1e18).toFixed(4)} WEEDL), or contract state.`;
    return message || 'Unknown error occurred.';
  }, [totalRequired, allowance]);

  const estimateGas = useCallback(async () => {
    if (!publicClient || !address || !formData.collateralValue || !formData.contactInfo || !formData.description || !formData.image) {
      setGasEstimate(null);
      return;
    }
    try {
      const requiredWei = totalRequired();
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
        const approvalCost = gasPrice ? formatEther(approvalGas * gasPrice) : '0';
        setGasEstimate(`Approval: ~${approvalCost} SepoliaETH`);
        return;
      }
      const listingData = encodeFunctionData({
        abi: GreenFiLand.abi,
        functionName: 'listLand',
        args: ['', 'ipfs://placeholder', parseEther(formData.collateralValue), formData.contactInfo],
      });
      const listingGas = await publicClient.estimateGas({
        account: address as `0x${string}`,
        to: GreenFiLand.address as `0x${string}`,
        data: listingData,
      });
      const listingCost = gasPrice ? formatEther(listingGas * gasPrice) : '0';
      setGasEstimate(`Listing: ~${listingCost} SepoliaETH`);
    } catch (err) {
      setGasEstimate('Unable to estimate gas.');
      console.error('Gas estimation error:', err);
    }
  }, [publicClient, address, formData.collateralValue, formData.contactInfo, formData.description, formData.image, allowance, totalRequired, gasPrice]);

  useEffect(() => {
    estimateGas();
  }, [estimateGas]);

  const FeeBreakdown = () => {
    const collateralWei = parseEther(formData.collateralValue || '0');
    const greenFiFee = (collateralWei * BigInt(42)) / BigInt(10000);
    const total = collateralWei + greenFiFee;
    return (
      <div className="fee-breakdown">
        <p>Collateral Value: {(Number(collateralWei) / 1e18).toFixed(4)} WEEDL</p>
        <p>Listing Fee (0.420%): {(Number(greenFiFee) / 1e18).toFixed(4)} WEEDL</p>
        <p>Total Required: {(Number(total) / 1e18).toFixed(4)} WEEDL</p>
        {gasEstimate && <p>Estimated Network Fee: {gasEstimate}</p>}
        <p className="disclaimer">Note: The listing fee is non-refunded and covers the cost of listing your land.</p>
      </div>
    );
  };

  const MetadataPreview = () => {
    return (
      <div className="metadata-preview">
        <h4>Preview</h4>
        {formData.image && <img src={URL.createObjectURL(formData.image)} alt="Preview" className="preview-image" />}
        <p>Description: {sanitizeHTML(formData.description || 'N/A')}</p>
        <p>Contact: {sanitizeHTML(formData.contactInfo || 'N/A')}</p>
        <p>Coordinates: {sanitizeHTML(formData.latitude || 'N/A')}, {sanitizeHTML(formData.longitude || 'N/A')}</p>
        <p>Size: {sanitizeHTML(formData.size || 'Not specified')}</p>
        <p>Zoning: {sanitizeHTML(formData.zoning || 'Not specified')}</p>
        <p>Utilities: {sanitizeHTML(formData.utilities || 'Not specified')}</p>
      </div>
    );
  };

  useEffect(() => {
    if (writeData && transactionStep === 'approving' && !approvalHash) {
      setApprovalHash(writeData);
      toast.info('Approval transaction submitted!');
    } else if (writeData && transactionStep === 'listing' && !listingHash) {
      setListingHash(writeData);
      toast.info('Land listing transaction submitted!');
    }
  }, [writeData, transactionStep, approvalHash, listingHash]);

  useEffect(() => {
    if (writeError) {
      setError(parseBlockchainError(writeError.message));
      setUploading(false);
      setTransactionStep('none');
    }
    if (approvalError) {
      setError(parseBlockchainError(approvalError.message));
      setUploading(false);
      setTransactionStep('none');
    }
    if (listingError) {
      if (listingError.message.includes('LandInUse')) {
        setError('Land ID is already in use. Retrying with a new ID...');
        setCid(null);
        setLastLandId(null);
        setTransactionStep('approving');
      } else {
        setError(parseBlockchainError(listingError.message));
        setUploading(false);
        setTransactionStep('none');
      }
    }
    if (isApprovalConfirmed && approvalHash && cid && lastLandId && transactionStep === 'approving') {
      (async () => {
        try {
          await new Promise((resolve) => setTimeout(resolve, 5000));
          await refetchAllowance();
          if (!publicClient) {
            setError('Public client not available. Please try again.');
            setUploading(false);
            setTransactionStep('none');
            return;
          }
          const currentAllowance = (await publicClient.readContract({
            address: WEEDL.address as `0x${string}`,
            abi: WEEDL.abi,
            functionName: 'allowance',
            args: [address as `0x${string}`, GreenFiLand.address as `0x${string}`],
          })) as bigint;
          console.log(`Allowance after approval: ${(Number(currentAllowance) / 1e18).toFixed(4)} WEEDL`);

          const requiredWei = totalRequired();
          if (currentAllowance < requiredWei) {
            setError(`Insufficient allowance. Expected ${(Number(requiredWei) / 1e18).toFixed(4)} WEEDL, got ${(Number(currentAllowance) / 1e18).toFixed(4)} WEEDL. Please approve again.`);
            setTransactionStep('approving');
            return;
          }

          const nonce = await getNextNonce();
          setTransactionStep('listing');
          writeContract({
            address: GreenFiLand.address as `0x${string}`,
            abi: GreenFiLand.abi,
            functionName: 'listLand',
            args: [lastLandId, `ipfs://${cid}`, parseEther(formData.collateralValue), formData.contactInfo],
            gas: listingGasEstimate ? listingGasEstimate + BigInt(100000) : BigInt(600000),
            account: address as `0x${string}`,
            nonce: nonce ?? undefined,
            maxFeePerGas: gasPrice ? gasPrice * BigInt(15) / BigInt(10) : undefined,
            maxPriorityFeePerGas: gasPrice ? gasPrice / BigInt(2) : undefined,
          });
        } catch (err) {
          setError('Failed to submit listing transaction after approval. Please try again.');
          console.error('Listing submission error:', err);
          setUploading(false);
          setTransactionStep('none');
        }
      })();
    }
  }, [
    writeError,
    approvalError,
    listingError,
    isApprovalConfirmed,
    approvalHash,
    isListingConfirmed,
    listingHash,
    refetchBalance,
    refetchAllowance,
    totalRequired,
    cid,
    lastLandId,
    writeContract,
    address,
    formData.collateralValue,
    formData.contactInfo,
    listingGasEstimate,
    getNextNonce,
    gasPrice,
    transactionStep,
    publicClient,
    allowance,
    parseBlockchainError,
  ]);

  const handleManualApprove = useCallback(async () => {
    if (!publicClient || !address) {
      setError('Public client or wallet not available. Please try again.');
      return;
    }
    try {
      const requiredWei = totalRequired();
      const nonce = await getNextNonce();
      await writeContract({
        address: WEEDL.address as `0x${string}`,
        abi: WEEDL.abi,
        functionName: 'approve',
        args: [GreenFiLand.address as `0x${string}`, requiredWei],
        gas: approvalGasEstimate ? approvalGasEstimate + BigInt(20000) : BigInt(120000),
        account: address as `0x${string}`,
        nonce: nonce ?? undefined,
        maxFeePerGas: gasPrice ? gasPrice * BigInt(15) / BigInt(10) : undefined,
        maxPriorityFeePerGas: gasPrice ? gasPrice / BigInt(2) : undefined,
      });
      setError(null);
      toast.info(`Manual approval submitted for ${(Number(requiredWei) / 1e18).toFixed(4)} WEEDL`);
    } catch (err) {
      setError(parseBlockchainError('Failed to submit manual approval. Please try again.'));
      console.error('Manual approval error:', err);
    }
  }, [publicClient, address, writeContract, approvalGasEstimate, gasPrice, getNextNonce, totalRequired, parseBlockchainError]);

  const validateInput = (field: string, value: string) => {
    const errors = { ...validationErrors };
    switch (field) {
      case 'collateralValue':
        errors.collateralValue = value && (isNaN(Number(value)) || Number(value) <= 0) ? 'Collateral value must be a positive number.' : '';
        break;
      case 'contactInfo':
        errors.contactInfo = value.length > 100 ? 'Contact info must be 100 characters or less.' : value.length > 0 ? '' : 'Contact info is required.';
        break;
      case 'description':
        errors.description = value.length > 0 ? '' : 'Description is required.';
        break;
      case 'latitude':
        errors.latitude = value
          ? !/^-?\d*\.?\d*$/.test(value) || Number(value) < -90 || Number(value) > 90
            ? 'Latitude must be a number between -90 and 90.'
            : ''
          : '';
        break;
      case 'longitude':
        errors.longitude = value
          ? !/^-?\d*\.?\d*$/.test(value) || Number(value) < -180 || Number(value) > 180
            ? 'Longitude must be a number between -180 and 180.'
            : ''
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
    validateInput(name, sanitizedValue);
    setFormData((prev) => ({ ...prev, [name]: sanitizedValue }));
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    setFormData((prev) => ({ ...prev, image: file }));
    setValidationErrors((prev) => ({ ...prev, image: file ? '' : 'Image is required.' }));
  };

  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      setError(null);
      setSuccess(false);
      setUploading(true);
      setTransactionStep('approving');

      try {
        if (!formData.image) throw new Error('Please upload an image.');
        if (!formData.description) throw new Error('Please provide a description.');
        if (!formData.contactInfo) throw new Error('Please provide contact information.');
        if (formData.contactInfo.length > 100) throw new Error('Contact info must be 100 characters or less.');
        if (!formData.collateralValue || isNaN(Number(formData.collateralValue)) || Number(formData.collateralValue) <= 0) {
          throw new Error('Collateral value must be a positive number.');
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

        const hasPendingTx = await checkPendingTransactions();
        if (hasPendingTx) {
          throw new Error('Pending transactions detected. Please wait for them to confirm or replace them with a higher gas price.');
        }

        const requiredWei = totalRequired();
        if (!balance || balance < requiredWei) {
          throw new Error(
            `Insufficient WEEDL balance. Need ${(Number(requiredWei) / 1e18).toFixed(4)} WEEDL, have ${
              balance ? (Number(balance) / 1e18).toFixed(4) : 0
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

            const metadata = {
              description: sanitizedDescription,
              contact: sanitizedContactInfo,
              disclaimer: 'Please verify the authenticity of this listing before engaging.',
              latitude: formData.latitude,
              longitude: formData.longitude,
              size: formData.size,
              zoning: formData.zoning,
              utilities: formData.utilities,
            };

            const result = await uploadFile(formData.image, metadata);
            const uri = `ipfs://${result.cid}`;
            const httpUrl = convertCIDToURL(result.cid, import.meta.env.VITE_PINATA_GATEWAY!);
            setCid(result.cid);
            setLastLandId(sanitizedLandId);

            console.log('Submitting land listing:', {
              landId: sanitizedLandId,
              uri,
              collateralValue: parseEther(formData.collateralValue).toString(),
              contactInfo: sanitizedContactInfo,
            });
            console.log('Metadata URL:', httpUrl);

            await new Promise((resolve) => setTimeout(resolve, 1000));
            await refetchAllowance();
            const currentAllowance = (await publicClient.readContract({
              address: WEEDL.address as `0x${string}`,
              abi: WEEDL.abi,
              functionName: 'allowance',
              args: [address as `0x${string}`, GreenFiLand.address as `0x${string}`],
            })) as bigint;
            console.log(`Allowance after refresh: ${(Number(currentAllowance) / 1e18).toFixed(4)} WEEDL`);

            let nonce = await getNextNonce();
            if (currentAllowance < requiredWei) {
              if (currentAllowance > 0n) {
                console.log('Resetting allowance to 0 before new approval');
                await writeContract({
                  address: WEEDL.address as `0x${string}`,
                  abi: WEEDL.abi,
                  functionName: 'approve',
                  args: [GreenFiLand.address as `0x${string}`, BigInt(0)],
                  gas: approvalGasEstimate ? approvalGasEstimate + BigInt(20000) : BigInt(120000),
                  account: address as `0x${string}`,
                  nonce: nonce ?? undefined,
                  maxFeePerGas: gasPrice ? gasPrice * BigInt(15) / BigInt(10) : undefined,
                  maxPriorityFeePerGas: gasPrice ? gasPrice / BigInt(2) : undefined,
                });
                await new Promise((resolve) => setTimeout(resolve, 2000));
                nonce = await getNextNonce();
              }

              console.log(`Approving ${(Number(requiredWei) / 1e18).toFixed(4)} WEEDL for GreenFiLand contract`);
              writeContract({
                address: WEEDL.address as `0x${string}`,
                abi: WEEDL.abi,
                functionName: 'approve',
                args: [GreenFiLand.address as `0x${string}`, requiredWei],
                gas: approvalGasEstimate ? approvalGasEstimate + BigInt(20000) : BigInt(120000),
                account: address as `0x${string}`,
                nonce: nonce ?? undefined,
                maxFeePerGas: gasPrice ? gasPrice * BigInt(15) / BigInt(10) : undefined,
                maxPriorityFeePerGas: gasPrice ? gasPrice / BigInt(2) : undefined,
              });
              return;
            }

            setTransactionStep('listing');
            writeContract({
              address: GreenFiLand.address as `0x${string}`,
              abi: GreenFiLand.abi,
              functionName: 'listLand',
              args: [sanitizedLandId, uri, parseEther(formData.collateralValue), sanitizedContactInfo],
              gas: listingGasEstimate ? listingGasEstimate + BigInt(100000) : BigInt(600000),
              account: address as `0x${string}`,
              nonce: nonce ?? undefined,
              maxFeePerGas: gasPrice ? gasPrice * BigInt(15) / BigInt(10) : undefined,
              maxPriorityFeePerGas: gasPrice ? gasPrice / BigInt(2) : undefined,
            });
            break;
          } catch (err: unknown) {
            if (err instanceof Error && err.message.includes('LandInUse') && attempts < maxAttempts) {
              console.log(`Land ID ${landId} already in use. Retrying (${attempts}/${maxAttempts})...`);
              continue;
            }
            throw err instanceof Error ? err : new Error('Failed to generate a unique land ID. Please try again later or contact support.');
          }
        } while (attempts < maxAttempts);

        if (attempts >= maxAttempts) {
          throw new Error('Failed to generate a unique land ID after multiple attempts. Please try again later or contact support.');
        }
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? parseBlockchainError(err.message) : 'Failed to upload metadata or list land.';
        setError(errorMessage);
        console.error('Submission error:', err);
        setUploading(false);
        setTransactionStep('none');
      }
    },
    [
      formData.image,
      formData.description,
      formData.contactInfo,
      formData.collateralValue,
      formData.latitude,
      formData.longitude,
      formData.size,
      formData.utilities,
      formData.zoning,
      balance,
      writeContract,
      address,
      ethBalance,
      totalRequired,
      refetchAllowance,
      approvalGasEstimate,
      listingGasEstimate,
      getNextNonce,
      gasPrice,
      publicClient,
      checkPendingTransactions,
      parseBlockchainError,
    ]
  );

  return (
    <form onSubmit={handleSubmit} className="description-item" role="form" aria-label="Land Listing Form">
      <h3>List New Land</h3>
      <p className="disclaimer">Disclaimer: Please verify the authenticity of all listings before engaging.</p>
      <p>Wallet: {sanitizeHTML(address ? `${address.slice(0, 6)}...${address.slice(-4)}` : 'Not connected')}</p>
      {balance !== undefined && <p>WEEDL Balance: {(Number(balance) / 1e18).toFixed(4)} WEEDL</p>}
      {ethBalance && <p>SepoliaETH Balance: {(Number(ethBalance.value) / 1e18).toFixed(4)} SepoliaETH</p>}
      <div className="input-group">
        <input
          type="file"
          accept="image/*"
          onChange={handleFileChange}
          required
          className="action-input"
          aria-label="Upload Land Image"
        />
        {validationErrors.image && <p className="validation-error">{validationErrors.image}</p>}
      </div>
      <div className="input-group">
        <input
          type="text"
          name="description"
          value={formData.description}
          onChange={handleInputChange}
          placeholder="Land Description (e.g., Fertile farmland)"
          required
          className="action-input"
          aria-label="Land Description"
        />
        {validationErrors.description && <p className="validation-error">{validationErrors.description}</p>}
      </div>
      <div className="input-group">
        <input
          type="text"
          name="contactInfo"
          value={formData.contactInfo}
          onChange={handleInputChange}
          placeholder="Contact Info (e.g., website, email, Telegram)"
          required
          className="action-input"
          aria-label="Contact Information"
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
          />
        </div>
        {validationErrors.collateralValue && <p className="validation-error">{validationErrors.collateralValue}</p>}
      </div>
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
        />
        {validationErrors.utilities && <p className="validation-error">{validationErrors.utilities}</p>}
      </div>
      <FeeBreakdown />
      <MetadataPreview />
      <button
        type="button"
        onClick={handleManualApprove}
        disabled={isPending || isApprovalConfirming || isListingConfirming}
        className="action-button"
        aria-label="Manually Approve WEEDL"
      >
        Approve WEEDL
      </button>
      {isPending || uploading ? (
        <div className="loading" aria-label="Processing transaction">
          <p>{isApprovalConfirming ? 'Approving WEEDL...' : isListingConfirming ? 'Listing Land...' : 'Uploading metadata...'}</p>
        </div>
      ) : (
        <button
          type="submit"
          disabled={isPending || uploading || isApprovalConfirming || isListingConfirming || Object.values(validationErrors).some((e) => e)}
          className="action-button"
          aria-label="List Land"
        >
          List Land
        </button>
      )}
      {error && <p className="error" role="alert">{error}</p>}
      {success && <p className="success" role="alert">Land listing created successfully!</p>}
    </form>
  );
}