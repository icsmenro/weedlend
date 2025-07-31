import { useState, FormEvent, useCallback, ChangeEvent, useEffect } from 'react';
import { useWriteContract, useReadContract, useAccount, useBalance, usePublicClient, useWaitForTransactionReceipt } from 'wagmi';
import { parseEther, encodeFunctionData, formatEther } from 'viem';
import { v4 as uuidv4 } from 'uuid';
import { GreenFiLoan, WEEDL } from '../config/contracts';
import { sanitizeHTML } from '../utils/security';
import { toast } from 'react-toastify';

interface FormData {
  id: string;
  amount: string;
  duration: string;
  contactInfo: string;
  growPurpose: string;
  collateralAmount: string;
  interestRate: string;
}

interface FormErrors {
  id?: string;
  amount?: string;
  duration?: string;
  contactInfo?: string;
  growPurpose?: string;
  collateralAmount?: string;
  interestRate?: string;
}

interface LoanListingFormProps {
  address?: `0x${string}`; // Updated to use Ethereum address type
}

export default function LoanListingForm({ address: propAddress }: LoanListingFormProps) {
  const [formData, setFormData] = useState<FormData>({
    id: `loan_${uuidv4().slice(0, 8)}`,
    amount: '',
    duration: '',
    contactInfo: '',
    growPurpose: '',
    collateralAmount: '',
    interestRate: '',
  });
  const [validationErrors, setValidationErrors] = useState<FormErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [gasEstimate, setGasEstimate] = useState<string | null>(null);
  const [transactionStep, setTransactionStep] = useState<'none' | 'approving' | 'listing'>('none');
  const [approvalHash, setApprovalHash] = useState<`0x${string}` | undefined>();
  const [listingHash, setListingHash] = useState<`0x${string}` | undefined>();

  const { address: accountAddress } = useAccount();
  const address = propAddress || accountAddress; // Both are now `0x${string} | undefined`
  const publicClient = usePublicClient();
  const { writeContract, data: writeData, error: writeError, isPending } = useWriteContract();
  const { isLoading: isApprovalConfirming, isSuccess: isApprovalConfirmed, error: approvalError } = useWaitForTransactionReceipt({ hash: approvalHash });
  const { isLoading: isListingConfirming, isSuccess: isListingConfirmed, error: listingError } = useWaitForTransactionReceipt({ hash: listingHash });

  const { data: balance, refetch: refetchBalance } = useReadContract({
    address: WEEDL.address as `0x${string}`,
    abi: WEEDL.abi,
    functionName: 'balanceOf',
    args: [address ?? '0x0'], // Removed explicit type cast as address is already `0x${string} | undefined`
  }) as { data: bigint | undefined; refetch: () => void };

  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: WEEDL.address as `0x${string}`,
    abi: WEEDL.abi,
    functionName: 'allowance',
    args: [address ?? '0x0', GreenFiLoan.address as `0x${string}`], // Removed explicit type cast
  }) as { data: bigint | undefined; refetch: () => void };

  const { data: isPaused } = useReadContract({
    address: GreenFiLoan.address as `0x${string}`,
    abi: GreenFiLoan.abi,
    functionName: 'paused',
    query: { refetchInterval: 30000 },
  }) as { data: boolean | undefined };

  const { data: ethBalance } = useBalance({ address });

  const FEE_BASIS_POINTS = 42; // 0.420% fee
  const MAX_LOAN_DURATION = 365; // 365 days
  const MAX_INTEREST_RATE = 5000; // 50% APR
  const MIN_COLLATERAL_RATIO = 100; // 100% of loan amount

  const totalRequired = useCallback(() => {
    if (!formData.amount || isNaN(Number(formData.amount))) return BigInt(0);
    const amountWei = parseEther(formData.amount);
    const greenFiFee = (amountWei * BigInt(FEE_BASIS_POINTS)) / BigInt(10000);
    const collateralAmountWei = parseEther(formData.collateralAmount || '0');
    return amountWei + greenFiFee + collateralAmountWei;
  }, [formData.amount, formData.collateralAmount]);

  const getMinimumCollateral = useCallback(() => {
    if (!formData.amount || isNaN(Number(formData.amount))) return '0';
    const amount = Number(formData.amount);
    return (amount * MIN_COLLATERAL_RATIO / 100).toFixed(4);
  }, [formData.amount]);

  const getNextNonce = useCallback(async () => {
    if (!address || !publicClient) return undefined;
    try {
      return await publicClient.getTransactionCount({
        address: address as `0x${string}`,
        blockTag: 'pending',
      });
    } catch (err) {
      console.error('Failed to fetch nonce:', err);
      return undefined;
    }
  }, [address, publicClient]);

  const validateInput = useCallback((field: string, value: string) => {
    const errors = { ...validationErrors };
    switch (field) {
      case 'id':
        errors.id = value && value.length > 32 ? 'Loan ID must be 32 characters or less.' : value ? '' : 'Loan ID is required.';
        break;
      case 'amount':
        errors.amount = value && (isNaN(Number(value)) || Number(value) <= 0) ? 'Amount must be a positive number.' : '';
        break;
      case 'duration':
        errors.duration =
          value && (isNaN(Number(value)) || Number(value) <= 0)
            ? 'Duration must be a positive number.'
            : Number(value) > MAX_LOAN_DURATION
              ? `Duration cannot exceed ${MAX_LOAN_DURATION} days`
              : '';
        break;
      case 'contactInfo':
        errors.contactInfo =
          value && !/^[\w-.]+@([\w-]+\.)+[\w-]{2,4}$|^https?:\/\/.+$/.test(value)
            ? 'Please enter a valid email or website URL.'
            : value.length > 100
              ? 'Contact info must be 100 characters or less.'
              : value
                ? ''
                : 'Contact info is required.';
        break;
      case 'growPurpose':
        errors.growPurpose = value ? (value.length > 200 ? 'Description cannot exceed 200 characters.' : '') : 'Description is required.';
        break;
      case 'collateralAmount':
        errors.collateralAmount = value
          ? isNaN(Number(value)) || Number(value) <= 0
            ? 'Collateral amount must be a positive number.'
            : Number(value) < Number(getMinimumCollateral())
              ? `Collateral must be at least ${getMinimumCollateral()} WEEDL (100% of loan amount).`
              : ''
          : 'Collateral amount is required.';
        break;
      case 'interestRate':
        errors.interestRate =
          value && (isNaN(Number(value)) || Number(value) <= 0 || Number(value) > MAX_INTEREST_RATE / 100)
            ? `Interest rate must be between 0 and ${MAX_INTEREST_RATE / 100}% APR`
            : '';
        break;
    }
    setValidationErrors(errors);
  }, [validationErrors, getMinimumCollateral]);

  const checkCollateralValue = useCallback(() => {
    const amountWei = parseEther(formData.amount || '0');
    const collateralAmountWei = parseEther(formData.collateralAmount || '0');
    return collateralAmountWei >= amountWei * BigInt(MIN_COLLATERAL_RATIO) / BigInt(100);
  }, [formData.amount, formData.collateralAmount]);

  const estimateGas = useCallback(async () => {
    if (
      !publicClient ||
      !address ||
      !formData.amount ||
      !formData.duration ||
      !formData.contactInfo ||
      !formData.growPurpose ||
      !formData.collateralAmount ||
      !formData.interestRate
    ) {
      setGasEstimate(null);
      return;
    }

    try {
      const amountWei = parseEther(formData.amount);
      const greenFiFee = (amountWei * BigInt(FEE_BASIS_POINTS)) / BigInt(10000);
      const collateralAmountWei = parseEther(formData.collateralAmount);
      const totalRequiredWei = amountWei + greenFiFee + collateralAmountWei;
      const durationSeconds = BigInt(Number(formData.duration) * 86400);

      if (!allowance || allowance < totalRequiredWei) {
        const approvalData = encodeFunctionData({
          abi: WEEDL.abi,
          functionName: 'approve',
          args: [GreenFiLoan.address, totalRequiredWei],
        });

        const approvalGas = await publicClient.estimateGas({
          account: address as `0x${string}`,
          to: WEEDL.address as `0x${string}`,
          data: approvalData,
        });

        const gasPrice = await publicClient.getGasPrice();
        const approvalCost = formatEther(approvalGas * gasPrice);
        setGasEstimate(`Approval: ~${approvalCost} SepoliaETH`);
        return;
      }

      const loanData = encodeFunctionData({
        abi: GreenFiLoan.abi,
        functionName: 'createLoan',
        args: [
          formData.id,
          amountWei,
          durationSeconds,
          formData.contactInfo,
          greenFiFee,
          formData.growPurpose,
          collateralAmountWei,
          BigInt(Number(formData.interestRate) * 100),
        ],
      });

      const loanGas = await publicClient.estimateGas({
        account: address as `0x${string}`,
        to: GreenFiLoan.address as `0x${string}`,
        data: loanData,
      });

      const gasPrice = await publicClient.getGasPrice();
      const loanCost = formatEther(loanGas * gasPrice);
      setGasEstimate(`Create Loan: ~${loanCost} SepoliaETH`);
    } catch (err) {
      setGasEstimate('Unable to estimate gas.');
      console.error('Gas estimation error:', err);
    }
  }, [
    publicClient,
    address,
    formData.id,
    formData.amount,
    formData.duration,
    formData.contactInfo,
    formData.growPurpose,
    formData.collateralAmount,
    formData.interestRate,
    allowance,
  ]);

  useEffect(() => {
    estimateGas();
  }, [estimateGas]);

  useEffect(() => {
    if (formData.amount && !formData.collateralAmount) {
      const minCollateral = getMinimumCollateral();
      setFormData((prev) => ({ ...prev, collateralAmount: minCollateral }));
      validateInput('collateralAmount', minCollateral);
    }
  }, [formData.amount, formData.collateralAmount, getMinimumCollateral, validateInput]);

  useEffect(() => {
    if (writeData && transactionStep === 'approving' && !approvalHash) {
      setApprovalHash(writeData);
      toast.info('Approval transaction submitted!');
    } else if (writeData && transactionStep === 'listing' && !listingHash) {
      setListingHash(writeData);
      toast.info('Loan creation transaction submitted!');
    }
  }, [writeData, transactionStep, approvalHash, listingHash]);

  useEffect(() => {
    if (writeError) {
      setError(parseBlockchainError(writeError.message) || 'Transaction failed.');
      setTransactionStep('none');
    }
    if (approvalError) {
      setError(parseBlockchainError(approvalError.message) || 'Approval transaction failed.');
      setTransactionStep('none');
    }
    if (listingError) {
      setError(parseBlockchainError(listingError.message) || 'Listing transaction failed.');
      setTransactionStep('none');
    }
    if (isListingConfirmed && listingHash) {
      setSuccess(true);
      toast.success('Loan created successfully!');
      setFormData({
        id: `loan_${uuidv4().slice(0, 8)}`,
        amount: '',
        duration: '',
        contactInfo: '',
        growPurpose: '',
        collateralAmount: '',
        interestRate: '',
      });
      setValidationErrors({});
      setApprovalHash(undefined);
      setListingHash(undefined);
      setTransactionStep('none');
      refetchBalance();
      refetchAllowance();
    }
  }, [writeError, approvalError, listingError, isListingConfirmed, listingHash, refetchBalance, refetchAllowance]);

  const parseBlockchainError = (message: string): string => {
    if (message.includes('User rejected')) return 'Transaction rejected by user.';
    if (message.includes('Insufficient funds')) return 'Insufficient funds for gas fees.';
    if (message.includes('Amount must be greater than zero')) return 'Loan amount must be greater than zero.';
    if (message.includes('Duration must be 1 to 365 days')) return 'Duration must be between 1 and 365 days.';
    if (message.includes('Loan ID already used')) return 'Loan ID already exists.';
    if (message.includes('Collateral must be at least 100%')) return 'Collateral must be at least 100% of loan amount.';
    if (message.includes('Invalid fee')) return 'Invalid fee amount.';
    if (message.includes('Insufficient WEEDL balance')) return 'Insufficient WEEDL balance.';
    if (message.includes('Pausable: paused')) return 'Contract is paused.';
    return message || 'Unknown error occurred.';
  };

  const handleInputChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    const sanitizedValue = await sanitizeHTML(value);
    validateInput(name, sanitizedValue);
    setFormData((prev) => ({ ...prev, [name]: sanitizedValue }));
  };

  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      setError(null);
      setSuccess(false);
      if (isPaused) {
        setError('Cannot create loan: Contract is paused.');
        return;
      }
      setTransactionStep('approving');

      try {
        if (!formData.id) throw new Error('Loan ID is required.');
        if (!formData.amount || isNaN(Number(formData.amount)) || Number(formData.amount) <= 0) {
          throw new Error('Loan amount must be a positive number.');
        }
        if (!formData.duration || isNaN(Number(formData.duration)) || Number(formData.duration) <= 0) {
          throw new Error('Duration must be a positive number.');
        }
        if (Number(formData.duration) > MAX_LOAN_DURATION) {
          throw new Error(`Duration cannot exceed ${MAX_LOAN_DURATION} days`);
        }
        if (!formData.contactInfo) throw new Error('Please provide contact information.');
        if (!/^[\w-.]+@([\w-]+\.)+[\w-]{2,4}$|^https?:\/\/.+$/.test(formData.contactInfo)) {
          throw new Error('Please provide a valid email or website URL.');
        }
        if (!formData.growPurpose) throw new Error('Please provide a description.');
        if (!formData.collateralAmount || isNaN(Number(formData.collateralAmount)) || Number(formData.collateralAmount) <= 0) {
          throw new Error('Collateral amount must be a positive number.');
        }
        if (!checkCollateralValue()) {
          throw new Error('Collateral amount must be at least 100% of loan amount.');
        }
        if (!formData.interestRate || isNaN(Number(formData.interestRate))) {
          throw new Error('Valid interest rate is required.');
        }
        if (!address) throw new Error('Please connect your wallet.');
        if (!ethBalance || ethBalance.value < parseEther('0.001')) {
          throw new Error('Insufficient SepoliaETH for gas fees. Need at least 0.001 SepoliaETH.');
        }

        const requiredWei = totalRequired();
        if (!balance || balance < requiredWei) {
          throw new Error(
            `Insufficient WEEDL balance. Need ${(Number(requiredWei) / 1e18).toFixed(4)} WEEDL`
          );
        }

        if (!allowance || allowance < requiredWei) {
          writeContract({
            address: WEEDL.address as `0x${string}`,
            abi: WEEDL.abi,
            functionName: 'approve',
            args: [GreenFiLoan.address as `0x${string}`, requiredWei],
            gas: BigInt(120000),
            account: address,
            nonce: await getNextNonce(),
          });
          return;
        }

        setTransactionStep('listing');
        writeContract({
          address: GreenFiLoan.address as `0x${string}`,
          abi: GreenFiLoan.abi,
          functionName: 'createLoan',
          args: [
            formData.id,
            parseEther(formData.amount),
            BigInt(Number(formData.duration) * 86400),
            formData.contactInfo,
            (parseEther(formData.amount) * BigInt(FEE_BASIS_POINTS)) / BigInt(10000),
            formData.growPurpose,
            parseEther(formData.collateralAmount),
            BigInt(Number(formData.interestRate) * 100),
          ],
          gas: BigInt(600000),
          account: address,
          nonce: await getNextNonce(),
        });
      } catch (err: unknown) {
        setError(err instanceof Error ? parseBlockchainError(err.message) : 'Failed to list loan.');
        setTransactionStep('none');
      }
    },
    [formData, address, ethBalance, balance, allowance, totalRequired, checkCollateralValue, writeContract, getNextNonce, isPaused]
  );

  useEffect(() => {
    if (isApprovalConfirmed && approvalHash && transactionStep === 'approving') {
      setTransactionStep('listing');
      writeContract({
        address: GreenFiLoan.address as `0x${string}`,
        abi: GreenFiLoan.abi,
        functionName: 'createLoan',
        args: [
          formData.id,
          parseEther(formData.amount),
          BigInt(Number(formData.duration) * 86400),
          formData.contactInfo,
          (parseEther(formData.amount) * BigInt(FEE_BASIS_POINTS)) / BigInt(10000),
          formData.growPurpose,
          parseEther(formData.collateralAmount),
          BigInt(Number(formData.interestRate) * 100),
        ],
        gas: BigInt(600000),
        account: address,
      });
    }
  }, [
    isApprovalConfirmed,
    approvalHash,
    transactionStep,
    formData.id,
    formData.amount,
    formData.duration,
    formData.contactInfo,
    formData.growPurpose,
    formData.collateralAmount,
    formData.interestRate,
    writeContract,
    address,
  ]);

  const FeeBreakdown = () => {
    const amountWei = parseEther(formData.amount || '0');
    const greenFiFee = (amountWei * BigInt(FEE_BASIS_POINTS)) / BigInt(10000);
    const collateralAmountWei = parseEther(formData.collateralAmount || '0');
    return (
      <div className="fee-breakdown">
        <p>Loan Amount: {(Number(amountWei) / 1e18).toFixed(4)} WEEDL</p>
        <p>Listing Fee (0.420%): {(Number(greenFiFee) / 1e18).toFixed(4)} WEEDL</p>
        <p>Collateral Amount: {(Number(collateralAmountWei) / 1e18).toFixed(4)} WEEDL</p>
        <p>Total Required: {(Number(amountWei + greenFiFee + collateralAmountWei) / 1e18).toFixed(4)} WEEDL</p>
      </div>
    );
  };

  const MetadataPreview = () => {
    return (
      <div className="metadata-preview">
        <h4>Preview</h4>
        <p>Loan ID: {sanitizeHTML(formData.id || 'N/A')}</p>
        <p>Description: {sanitizeHTML(formData.growPurpose || 'N/A')}</p>
        <p>Contact: {sanitizeHTML(formData.contactInfo || 'N/A')}</p>
        <p>Collateral Amount: {formData.collateralAmount ? `${Number(formData.collateralAmount).toFixed(4)} WEEDL` : 'N/A'}</p>
        <p>Interest Rate: {formData.interestRate ? `${formData.interestRate}% APR` : 'N/A'}</p>
      </div>
    );
  };

  return (
    <form onSubmit={handleSubmit} className="description-item" role="form" aria-label="Loan Listing Form">
      <h3>Create Loan Listing</h3>
      <p>Wallet: {sanitizeHTML(address ? `${address.slice(0, 6)}...${address.slice(-4)}` : 'Not connected')}</p>
      {balance !== undefined && <p>WEEDL Balance: {(Number(balance) / 1e18).toFixed(4)} WEEDL</p>}
      {ethBalance && <p>SepoliaETH Balance: {(Number(ethBalance.value) / 1e18).toFixed(4)} SepoliaETH</p>}
      {isPaused && <p className="error" role="alert">Contract is paused. Loan creation is disabled.</p>}
      {gasEstimate && (
        <p className="gas-estimate" aria-label="Estimated gas cost">
          {gasEstimate}
        </p>
      )}
      <div className="input-group">
        <label htmlFor="id">Loan ID</label>
        <input
          id="id"
          name="id"
          type="text"
          value={formData.id}
          onChange={handleInputChange}
          placeholder="Loan ID"
          required
          className={`action-input ${validationErrors.id ? 'invalid' : ''}`}
          aria-label="Loan ID"
          aria-describedby="id-error"
        />
        {validationErrors.id && <p className="validation-error">{validationErrors.id}</p>}
      </div>
      <div className="input-group">
        <label htmlFor="amount">Amount (WEEDL)</label>
        <input
          id="amount"
          name="amount"
          type="number"
          step="0.0001"
          value={formData.amount}
          onChange={handleInputChange}
          placeholder="Loan Amount (WEEDL)"
          required
          className={`action-input ${validationErrors.amount ? 'invalid' : ''}`}
          aria-label="Loan Amount"
          aria-describedby="amount-error"
        />
        {validationErrors.amount && <p className="validation-error">{validationErrors.amount}</p>}
      </div>
      <div className="input-group">
        <label htmlFor="duration">Duration (Days)</label>
        <input
          id="duration"
          name="duration"
          type="number"
          step="1"
          value={formData.duration}
          onChange={handleInputChange}
          placeholder="Loan Duration"
          required
          className={`action-input ${validationErrors.duration ? 'invalid' : ''}`}
          aria-label="Loan Duration"
          aria-describedby="duration-error"
        />
        {validationErrors.duration && <p className="validation-error">{validationErrors.duration}</p>}
      </div>
      <div className="input-group">
        <label htmlFor="contactInfo">Contact Info</label>
        <input
          id="contactInfo"
          name="contactInfo"
          type="text"
          value={formData.contactInfo}
          onChange={handleInputChange}
          placeholder="Contact Info (e.g., website, email)"
          required
          className={`action-input ${validationErrors.contactInfo ? 'invalid' : ''}`}
          aria-label="Contact Information"
          aria-describedby="contact-error"
        />
        {validationErrors.contactInfo && <p className="validation-error">{validationErrors.contactInfo}</p>}
      </div>
      <div className="input-group">
        <label htmlFor="growPurpose">Description</label>
        <input
          id="growPurpose"
          name="growPurpose"
          type="text"
          value={formData.growPurpose}
          onChange={handleInputChange}
          placeholder="Description of the Loan"
          required
          className={`action-input ${validationErrors.growPurpose ? 'invalid' : ''}`}
          aria-label="Loan Description"
          aria-describedby="growPurpose-error"
        />
        {validationErrors.growPurpose && <p className="validation-error">{validationErrors.growPurpose}</p>}
      </div>
      <div className="input-group">
        <label htmlFor="collateralAmount">Collateral Amount (WEEDL, min {getMinimumCollateral()} WEEDL)</label>
        <input
          id="collateralAmount"
          name="collateralAmount"
          type="number"
          step="0.0001"
          value={formData.collateralAmount}
          onChange={handleInputChange}
          placeholder={`Minimum ${getMinimumCollateral()} WEEDL`}
          required
          className={`action-input ${validationErrors.collateralAmount ? 'invalid' : ''}`}
          aria-label="Collateral Amount"
          aria-describedby="collateralAmount-error"
        />
        {validationErrors.collateralAmount && <p className="validation-error">{validationErrors.collateralAmount}</p>}
      </div>
      <div className="input-group">
        <label htmlFor="interestRate">Interest Rate (% APR)</label>
        <input
          id="interestRate"
          name="interestRate"
          type="number"
          step="0.1"
          value={formData.interestRate}
          onChange={handleInputChange}
          placeholder="Interest Rate"
          required
          className={`action-input ${validationErrors.interestRate ? 'invalid' : ''}`}
          aria-label="Interest Rate"
          aria-describedby="interestRate-error"
        />
        {validationErrors.interestRate && <p className="validation-error">{validationErrors.interestRate}</p>}
      </div>
      <FeeBreakdown />
      <MetadataPreview />
      <button
        type="submit"
        disabled={isPending || isApprovalConfirming || isListingConfirming || Object.values(validationErrors).some((e) => e) || isPaused}
        className="action-button"
        aria-label="Create Loan"
      >
        {isApprovalConfirming
          ? 'Approving WEEDL...'
          : isListingConfirming
            ? 'Creating Loan...'
            : isPending
              ? 'Submitting...'
              : 'Create Loan'}
      </button>
      {error && <p className="error" role="alert">{error}</p>}
      {success && <p className="success" role="alert">Loan listing created successfully!</p>}
    </form>
  );
}