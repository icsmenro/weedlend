// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

contract GreenFi is Initializable, UUPSUpgradeable, OwnableUpgradeable, ReentrancyGuardUpgradeable {
    IERC20 public weedlToken;
    address public ecosystemWallet;

    uint256 public constant FEE_BASIS_POINTS = 42; // 0.420%
    uint256 public constant REWARD_APY_BASIS = 420; // 4.20% APY
    uint256 public constant PROMO_PERIOD = 30 days;
    uint256 public constant DISCOUNT_BASIS_POINTS = 10; // 0.1%

    struct StakeInfo {
        address user;
        uint256 amount;
        uint256 rewardDebt;
        bool isActive;
    }

    mapping(address => StakeInfo) public stakes;
    uint256 public totalStaked;
    uint256 public accRewardPerShare;
    uint256 public lastRewardUpdate;

    struct LandListing {
        string id;
        address owner;
        string metadataURI;
        uint256 collateralValue;
        bool isActive;
        string loanId;
        string borrowId;
        string contactInfo;
    }

    struct Loan {
        string id;
        address lender;
        address borrower;
        string landId;
        uint256 amount;
        uint256 interestRate;
        uint256 duration;
        uint256 startTime;
        bool isActive;
        bool isRepaid;
        bool isDiscounted;
        string contactInfo;
    }

    mapping(string => LandListing) public landListings;
    mapping(string => Loan) public loans;
    string[] public landListingIds;
    string[] public loanIds;

    event Staked(address indexed staker, uint256 amount);
    event Unstaked(address indexed staker, uint256 amount, uint256 reward);
    event LandListed(string indexed id, address indexed owner, uint256 collateralValue, string metadataURI, string contactInfo);
    event LandDelisted(string indexed id, address indexed owner);
    event LoanCreated(string indexed id, address indexed lender, address indexed borrower, uint256 amount, string contactInfo);
    event LoanRepaid(string indexed id, address indexed borrower);
    event TransactionFeeCollected(address indexed from, uint256 fee);
    event EcosystemWalletUpdated(address indexed oldWallet, address indexed newWallet);

    error InvalidInput();
    error NotOwner();
    error AlreadyActive();
    error NotActive();
    error InsufficientBalance();
    error InvalidId();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address _weedlToken, address _owner, address _ecosystemWallet) public initializer {
        if (_weedlToken == address(0) || _owner == address(0) || _ecosystemWallet == address(0)) revert InvalidInput();
        __Ownable_init(_owner);
        __ReentrancyGuard_init();
        __UUPSUpgradeable_init();

        weedlToken = IERC20(_weedlToken);
        ecosystemWallet = _ecosystemWallet;
        lastRewardUpdate = block.timestamp;
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}

    function updateEcosystemWallet(address newWallet) external onlyOwner nonReentrant {
        if (newWallet == address(0)) revert InvalidInput();
        address oldWallet = ecosystemWallet;
        ecosystemWallet = newWallet;
        emit EcosystemWalletUpdated(oldWallet, newWallet);
    }

    function _applyFee(uint256 amount) internal returns (uint256) {
        uint256 fee = (amount * FEE_BASIS_POINTS) / 10_000;
        weedlToken.transferFrom(msg.sender, ecosystemWallet, fee);
        emit TransactionFeeCollected(msg.sender, fee);
        return amount - fee;
    }

    // ===== STAKING =====
    function updateRewards() internal {
        if (block.timestamp <= lastRewardUpdate || totalStaked == 0) {
            lastRewardUpdate = block.timestamp;
            return;
        }
        uint256 delta = block.timestamp - lastRewardUpdate;
        uint256 reward = (delta * totalStaked * REWARD_APY_BASIS) / (365 days * 10_000);
        accRewardPerShare += (reward * 1e12) / totalStaked;
        lastRewardUpdate = block.timestamp;
    }

    function stake(uint256 amount) external nonReentrant {
        if (amount == 0) revert InvalidInput();
        StakeInfo storage user = stakes[msg.sender];
        updateRewards();

        if (user.amount > 0) {
            uint256 pending = (user.amount * accRewardPerShare) / 1e12 - user.rewardDebt;
            if (pending > 0) {
                weedlToken.transfer(msg.sender, pending);
            }
        }

        uint256 net = _applyFee(amount);
        weedlToken.transferFrom(msg.sender, address(this), net);

        user.user = msg.sender;
        user.amount += net;
        user.isActive = true;
        totalStaked += net;
        user.rewardDebt = (user.amount * accRewardPerShare) / 1e12;

        emit Staked(msg.sender, net);
    }

    function unstake(uint256 amount) external nonReentrant {
        StakeInfo storage user = stakes[msg.sender];
        if (amount == 0 || user.amount < amount) revert InvalidInput();
        updateRewards();

        uint256 pending = (user.amount * accRewardPerShare) / 1e12 - user.rewardDebt;
        user.amount -= amount;
        totalStaked -= amount;
        user.rewardDebt = (user.amount * accRewardPerShare) / 1e12;
        user.isActive = user.amount > 0;

        if (pending > 0) {
            weedlToken.transfer(msg.sender, pending);
        }
        weedlToken.transfer(msg.sender, amount);

        emit Unstaked(msg.sender, amount, pending);
    }

    function getUserStakes(address user) external view returns (StakeInfo[] memory) {
        StakeInfo[] memory result = new StakeInfo[](1);
        result[0] = stakes[user];
        return result;
    }

    // ===== LAND =====
    function listLand(string memory id, string memory metadataURI, uint256 collateralValue, string memory contactInfo) external nonReentrant {
        if (bytes(id).length == 0 || bytes(metadataURI).length == 0 || bytes(contactInfo).length == 0 || collateralValue == 0) revert InvalidInput();
        if (landListings[id].owner != address(0)) revert AlreadyActive();

        weedlToken.transferFrom(msg.sender, address(this), collateralValue);

        landListings[id] = LandListing(id, msg.sender, metadataURI, collateralValue, true, "", "", contactInfo);
        landListingIds.push(id);
        emit LandListed(id, msg.sender, collateralValue, metadataURI, contactInfo);
    }

    function delistLand(string memory id) external nonReentrant {
        LandListing storage land = landListings[id];
        if (land.owner == address(0)) revert InvalidId();
        if (land.owner != msg.sender) revert NotOwner();
        if (!land.isActive) revert NotActive();
        if (bytes(land.loanId).length > 0 || bytes(land.borrowId).length > 0) revert AlreadyActive();

        land.isActive = false;
        weedlToken.transfer(msg.sender, land.collateralValue);

        for (uint256 i = 0; i < landListingIds.length; i++) {
            if (keccak256(bytes(landListingIds[i])) == keccak256(bytes(id))) {
                landListingIds[i] = landListingIds[landListingIds.length - 1];
                landListingIds.pop();
                break;
            }
        }

        emit LandDelisted(id, msg.sender);
    }

    function getAllLandListings() external view returns (LandListing[] memory) {
        LandListing[] memory result = new LandListing[](landListingIds.length);
        for (uint256 i = 0; i < landListingIds.length; i++) {
            result[i] = landListings[landListingIds[i]];
        }
        return result;
    }

    // ===== LOAN =====
    function createLoan(string memory id, string memory landId, uint256 amount, uint256 duration, string memory contactInfo) external nonReentrant {
        LandListing storage land = landListings[landId];
        if (!land.isActive || bytes(land.loanId).length > 0 || bytes(land.borrowId).length > 0) revert NotActive();
        if (bytes(id).length == 0 || bytes(contactInfo).length == 0 || amount == 0 || amount > land.collateralValue || duration < 30 days || duration > 365 days) revert InvalidInput();

        uint256 net = _applyFee(amount);
        weedlToken.transferFrom(msg.sender, address(this), net);

        loans[id] = Loan(id, msg.sender, land.owner, landId, net, REWARD_APY_BASIS, duration, block.timestamp, true, false, block.timestamp <= PROMO_PERIOD, contactInfo);
        land.loanId = id;
        loanIds.push(id);
        weedlToken.transfer(land.owner, net);

        emit LoanCreated(id, msg.sender, land.owner, net, contactInfo);
    }

    function repayLoan(string memory id) external nonReentrant {
        Loan storage loan = loans[id];
        if (!loan.isActive || loan.isRepaid || loan.borrower != msg.sender) revert NotActive();

        uint256 interest = (loan.amount * loan.interestRate * loan.duration) / (365 days * 10_000);
        uint256 total = loan.amount + interest;
        uint256 fee = (total * FEE_BASIS_POINTS) / 10_000;
        uint256 net = total - fee;

        weedlToken.transferFrom(msg.sender, ecosystemWallet, fee);
        weedlToken.transferFrom(msg.sender, loan.lender, net);

        loan.isActive = false;
        loan.isRepaid = true;
        landListings[loan.landId].loanId = "";

        for (uint256 i = 0; i < loanIds.length; i++) {
            if (keccak256(bytes(loanIds[i])) == keccak256(bytes(id))) {
                loanIds[i] = loanIds[loanIds.length - 1];
                loanIds.pop();
                break;
            }
        }

        emit LoanRepaid(id, msg.sender);
    }

    function getAllLoans() external view returns (Loan[] memory) {
        Loan[] memory result = new Loan[](loanIds.length);
        for (uint256 i = 0; i < loanIds.length; i++) {
            result[i] = loans[loanIds[i]];
        }
        return result;
    }

    receive() external payable {
        revert("No ETH");
    }
}