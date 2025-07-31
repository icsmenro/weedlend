// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

contract GreenFiLoan is Initializable, UUPSUpgradeable, OwnableUpgradeable, PausableUpgradeable, ReentrancyGuardUpgradeable {
    using SafeERC20 for IERC20;

    IERC20 public weedlToken;
    uint256 public constant FEE_BASIS_POINTS = 42; // 0.420% fee
    uint256 public constant MAX_LOAN_DURATION = 365 days; // 365 days
    uint256 public constant MAX_INTEREST_RATE = 5000; // 50% APR (in basis points)
    uint256 public constant MIN_COLLATERAL_RATIO = 100; // 100% collateral-to-loan value

    struct CannabisLoan {
        string id;
        address grower;
        uint256 amount;
        uint256 duration;
        bool isActive;
        string contactInfo;
        uint256 fee;
        uint256 createdAt;
        string growPurpose;
        string status;
        uint256 collateralAmount;
        address lender;
        uint256 repaidAmount;
        uint256 interestRate;
    }

    mapping(string => CannabisLoan) public loans;
    mapping(string => bool) public usedLoanIds;
    string[] public loanIds; // Array to store all loan IDs

    event LoanCreated(
        string indexed id,
        address indexed grower,
        uint256 amount,
        uint256 duration,
        string contactInfo,
        uint256 fee,
        string growPurpose,
        uint256 collateralAmount,
        uint256 indexed interestRate
    );
    event LoanFunded(string indexed id, address indexed lender, address indexed grower);
    event LoanRepaid(string indexed id, address indexed grower, uint256 amount, uint256 interest);
    event LoanCanceled(string indexed id, address indexed grower);
    event CollateralClaimed(string indexed id, address indexed lender);
    event LoanStatusChanged(string indexed id, string status);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address _weedlToken) public initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __Pausable_init();
        __ReentrancyGuard_init();
        require(_weedlToken != address(0), "Invalid WEEDL token address");
        weedlToken = IERC20(_weedlToken);
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function createLoan(
        string memory _id,
        uint256 _amount,
        uint256 _duration,
        string memory _contactInfo,
        uint256 _fee,
        string memory _growPurpose,
        uint256 _collateralAmount,
        uint256 _interestRate
    ) external whenNotPaused nonReentrant {
        require(_amount > 0, "Amount must be greater than zero");
        require(_duration > 0 && _duration <= MAX_LOAN_DURATION, "Duration must be 1 to 365 days");
        require(bytes(_id).length > 0 && bytes(_id).length <= 32, "Invalid loan ID length");
        require(bytes(_contactInfo).length > 0 && bytes(_contactInfo).length <= 100, "Invalid contact info length");
        require(bytes(_growPurpose).length > 0 && bytes(_growPurpose).length <= 256, "Invalid grow purpose length");
        require(_collateralAmount > 0, "Collateral amount must be greater than zero");
        require(_interestRate > 0 && _interestRate <= MAX_INTEREST_RATE, "Interest rate must be 0 to 50% APR");
        require(!usedLoanIds[_id], "Loan ID already used");
        require(_fee == (_amount * FEE_BASIS_POINTS) / 10000, "Invalid fee");
        require(_collateralAmount >= _amount * MIN_COLLATERAL_RATIO / 100, "Collateral must be at least 100% of loan amount");
        require(weedlToken.balanceOf(msg.sender) >= _amount + _fee + _collateralAmount, "Insufficient WEEDL balance");

        weedlToken.safeTransferFrom(msg.sender, address(this), _amount + _fee + _collateralAmount);

        loans[_id] = CannabisLoan({
            id: _id,
            grower: msg.sender,
            amount: _amount,
            duration: _duration,
            isActive: true,
            contactInfo: _contactInfo,
            fee: _fee,
            createdAt: block.timestamp,
            growPurpose: _growPurpose,
            status: "Open",
            collateralAmount: _collateralAmount,
            lender: address(0),
            repaidAmount: 0,
            interestRate: _interestRate
        });

        usedLoanIds[_id] = true;
        loanIds.push(_id); // Add loan ID to array

        emit LoanCreated(_id, msg.sender, _amount, _duration, _contactInfo, _fee, _growPurpose, _collateralAmount, _interestRate);
        emit LoanStatusChanged(_id, "Open");
    }

    function fundLoan(string memory _id) external whenNotPaused nonReentrant {
        CannabisLoan storage loan = loans[_id];
        require(loan.isActive, "Loan is not active");
        require(keccak256(abi.encodePacked(loan.status)) == keccak256(abi.encodePacked("Open")), "Loan not open");
        require(weedlToken.balanceOf(msg.sender) >= loan.amount, "Insufficient WEEDL balance");

        loan.status = "Funded";
        loan.lender = msg.sender;
        weedlToken.safeTransferFrom(msg.sender, loan.grower, loan.amount);

        emit LoanFunded(_id, msg.sender, loan.grower);
        emit LoanStatusChanged(_id, "Funded");
    }

    function repayLoan(string memory _id, uint256 _paymentAmount) external whenNotPaused nonReentrant {
        CannabisLoan storage loan = loans[_id];
        require(loan.isActive, "Loan is not active");
        require(loan.grower == msg.sender, "Only grower can repay");
        require(keccak256(abi.encodePacked(loan.status)) == keccak256(abi.encodePacked("Funded")), "Loan not funded");
        require(_paymentAmount > 0, "Payment amount must be greater than zero");

        uint256 interest = (loan.amount * loan.interestRate * loan.duration) / (10000 * 365 days);
        uint256 totalRepayment = loan.amount + interest;
        require(_paymentAmount >= totalRepayment, "Insufficient payment amount");
        require(weedlToken.balanceOf(msg.sender) >= _paymentAmount, "Insufficient WEEDL balance");

        weedlToken.safeTransferFrom(msg.sender, loan.lender, _paymentAmount);
        loan.repaidAmount = _paymentAmount;
        loan.status = "Repaid";
        loan.isActive = false;

        weedlToken.safeTransfer(loan.grower, loan.collateralAmount); // Return collateral
        emit LoanRepaid(_id, msg.sender, loan.amount, interest);
        emit LoanStatusChanged(_id, "Repaid");
    }

    function cancelLoan(string memory _id) external whenNotPaused nonReentrant {
        CannabisLoan storage loan = loans[_id];
        require(loan.isActive, "Loan is not active");
        require(loan.grower == msg.sender, "Only grower can cancel");
        require(keccak256(abi.encodePacked(loan.status)) == keccak256(abi.encodePacked("Open")), "Loan not open");

        loan.status = "Canceled";
        loan.isActive = false;
        weedlToken.safeTransfer(msg.sender, loan.amount + loan.fee + loan.collateralAmount);
        usedLoanIds[_id] = false;

        // Remove loan ID from loanIds array
        for (uint256 i = 0; i < loanIds.length; i++) {
            if (keccak256(abi.encodePacked(loanIds[i])) == keccak256(abi.encodePacked(_id))) {
                loanIds[i] = loanIds[loanIds.length - 1];
                loanIds.pop();
                break;
            }
        }

        emit LoanCanceled(_id, msg.sender);
        emit LoanStatusChanged(_id, "Canceled");
    }

    function claimCollateral(string memory _id) external whenNotPaused nonReentrant {
        CannabisLoan storage loan = loans[_id];
        require(loan.isActive, "Loan is not active");
        require(loan.lender == msg.sender, "Only lender can claim collateral");
        require(keccak256(abi.encodePacked(loan.status)) == keccak256(abi.encodePacked("Funded")), "Loan not funded");
        require(block.timestamp > loan.createdAt + loan.duration, "Loan duration not expired");

        loan.status = "Defaulted";
        loan.isActive = false;
        weedlToken.safeTransfer(msg.sender, loan.collateralAmount);

        emit CollateralClaimed(_id, msg.sender);
        emit LoanStatusChanged(_id, "Defaulted");
    }

    function getLoan(string memory _id) external view returns (CannabisLoan memory) {
        return loans[_id];
    }

    function getAllLoanIds() external view returns (string[] memory) {
        return loanIds;
    }

    function getAllLoans() external view returns (CannabisLoan[] memory) {
        CannabisLoan[] memory allLoans = new CannabisLoan[](loanIds.length);
        for (uint256 i = 0; i < loanIds.length; i++) {
            allLoans[i] = loans[loanIds[i]];
        }
        return allLoans;
    }
}