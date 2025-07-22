// SPDX-License-Identifier: MIT
pragma solidity 0.8.22;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

contract GreenFiBorrow is Initializable, UUPSUpgradeable, OwnableUpgradeable, ReentrancyGuardUpgradeable {
    using SafeERC20 for IERC20;

    IERC20 public weedlToken;
    uint256 public constant FEE_BASIS_POINTS = 42;

    struct Borrowing {
        string id;
        address borrower;
        string landId;
        uint256 amount;
        uint256 fee;
        uint256 duration;
        uint256 startTime;
        bool isActive;
        string contactInfo;
        string purpose;
        string collateralInfo;
        string latitude;
        string longitude;
        uint256 totalLent;
        uint256 totalRepaid;
        address[] lenders;
        mapping(address => uint256) lenderContributions;
    }

    mapping(string => Borrowing) public borrowings;
    string[] public borrowingIds;
    mapping(address => string[]) public userBorrowings;

    event BorrowingCreated(
        string id,
        address indexed borrower,
        string landId,
        uint256 amount,
        uint256 fee,
        uint256 duration,
        string contactInfo,
        string purpose,
        string collateralInfo,
        string latitude,
        string longitude
    );
    event BorrowingEnded(string id, address indexed borrower);
    event LentToBorrowing(string id, address indexed lender, uint256 amount);
    event RepaidBorrowing(string id, address indexed borrower, uint256 amount);

    function initialize(address _weedlToken) public initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
        require(_weedlToken != address(0), "Invalid token address");
        weedlToken = IERC20(_weedlToken);
    }

    function calculateFee(uint256 _amount) public pure returns (uint256) {
        return (_amount * FEE_BASIS_POINTS) / 10000;
    }

    function createBorrowing(
        string memory _id,
        string memory _landId,
        uint256 _amount,
        uint256 _duration,
        string memory _contactInfo,
        string memory _purpose,
        string memory _collateralInfo,
        string memory _latitude,
        string memory _longitude
    ) external nonReentrant {
        require(_amount > 0, "Amount must be greater than 0");
        require(_duration > 0 && _duration <= 365 days, "Duration must be between 1 and 365 days");
        require(bytes(_id).length > 0, "Borrowing ID cannot be empty");
        require(borrowings[_id].borrower == address(0), "Borrowing ID already exists");
        require(bytes(_contactInfo).length > 0, "Contact info cannot be empty");
        require(bytes(_purpose).length > 0, "Purpose cannot be empty");
        require(bytes(_collateralInfo).length > 0, "Collateral info cannot be empty");
        require(bytes(_latitude).length > 0, "Latitude cannot be empty");
        require(bytes(_longitude).length > 0, "Longitude cannot be empty");

        uint256 fee = calculateFee(_amount);
        weedlToken.safeTransferFrom(msg.sender, address(this), _amount + fee);

        _storeBorrowing(_id, _landId, _amount, _duration, _contactInfo, fee, _purpose, _collateralInfo, _latitude, _longitude);

        emit BorrowingCreated(
            _id,
            msg.sender,
            _landId,
            _amount,
            fee,
            _duration,
            _contactInfo,
            _purpose,
            _collateralInfo,
            _latitude,
            _longitude
        );
    }

    function _storeBorrowing(
        string memory _id,
        string memory _landId,
        uint256 _amount,
        uint256 _duration,
        string memory _contactInfo,
        uint256 _fee,
        string memory _purpose,
        string memory _collateralInfo,
        string memory _latitude,
        string memory _longitude
    ) private {
        Borrowing storage borrowing = borrowings[_id];
        borrowing.id = _id;
        borrowing.borrower = msg.sender;
        borrowing.landId = _landId;
        borrowing.amount = _amount;
        borrowing.fee = _fee;
        borrowing.duration = _duration;
        borrowing.startTime = block.timestamp;
        borrowing.isActive = true;
        borrowing.contactInfo = _contactInfo;
        borrowing.purpose = _purpose;
        borrowing.collateralInfo = _collateralInfo;
        borrowing.latitude = _latitude;
        borrowing.longitude = _longitude;
        borrowing.totalLent = 0;
        borrowing.totalRepaid = 0;

        borrowingIds.push(_id);
        userBorrowings[msg.sender].push(_id);
    }

    function lendToBorrowing(string memory _id, uint256 _amount) external nonReentrant {
        Borrowing storage borrowing = borrowings[_id];
        require(borrowing.isActive, "Borrowing is not active");
        require(_amount > 0, "Lend amount must be greater than 0");
        require(block.timestamp <= borrowing.startTime + borrowing.duration, "Borrowing duration has expired");
        require(borrowing.totalLent + _amount <= borrowing.amount, "Lending exceeds requested amount");

        weedlToken.safeTransferFrom(msg.sender, address(this), _amount);
        if (borrowing.lenderContributions[msg.sender] == 0) {
            borrowing.lenders.push(msg.sender);
        }
        borrowing.lenderContributions[msg.sender] += _amount;
        borrowing.totalLent += _amount;

        weedlToken.safeTransfer(borrowing.borrower, _amount);

        emit LentToBorrowing(_id, msg.sender, _amount);
    }

    function repayBorrowing(string memory _id, uint256 _amount) external nonReentrant {
        Borrowing storage borrowing = borrowings[_id];
        require(borrowing.borrower == msg.sender, "Only borrower can repay");
        require(borrowing.isActive, "Borrowing is not active");
        require(_amount > 0, "Repay amount must be greater than 0");
        require(borrowing.totalRepaid + _amount <= borrowing.totalLent, "Repayment exceeds lent amount");

        weedlToken.safeTransferFrom(msg.sender, address(this), _amount);
        borrowing.totalRepaid += _amount;

        for (uint256 i = 0; i < borrowing.lenders.length; i++) {
            address lender = borrowing.lenders[i];
            if (lender != address(0) && borrowing.lenderContributions[lender] > 0) {
                uint256 lenderShare = (borrowing.lenderContributions[lender] * _amount) / borrowing.totalLent;
                if (lenderShare > 0) {
                    weedlToken.safeTransfer(lender, lenderShare);
                    borrowing.lenderContributions[lender] -= lenderShare;
                }
            }
        }

        emit RepaidBorrowing(_id, msg.sender, _amount);

        if (borrowing.totalRepaid >= borrowing.totalLent) {
            borrowing.isActive = false;
            emit BorrowingEnded(_id, msg.sender);
        }
    }

    function endBorrowing(string memory _id) external nonReentrant {
        Borrowing storage borrowing = borrowings[_id];
        require(borrowing.borrower == msg.sender, "Only borrower can end borrowing");
        require(borrowing.isActive, "Borrowing is not active");

        borrowing.isActive = false;

        if (borrowing.amount > borrowing.totalLent) {
            uint256 refundAmount = borrowing.amount - borrowing.totalLent;
            weedlToken.safeTransfer(msg.sender, refundAmount);
        }

        emit BorrowingEnded(_id, msg.sender);
    }

    struct BorrowingInfo {
        string id;
        address borrower;
        string landId;
        uint256 amount;
        uint256 fee;
        uint256 duration;
        uint256 startTime;
        bool isActive;
        string contactInfo;
        string purpose;
        string collateralInfo;
        string latitude;
        string longitude;
        uint256 totalLent;
        uint256 totalRepaid;
    }

    function getAllBorrowings() external view returns (BorrowingInfo[] memory) {
        uint256 activeCount = 0;
        for (uint256 i = 0; i < borrowingIds.length; i++) {
            if (borrowings[borrowingIds[i]].isActive) {
                activeCount++;
            }
        }

        BorrowingInfo[] memory result = new BorrowingInfo[](activeCount);
        uint256 index = 0;
        for (uint256 i = 0; i < borrowingIds.length; i++) {
            if (borrowings[borrowingIds[i]].isActive) {
                Borrowing storage borrowing = borrowings[borrowingIds[i]];
                result[index] = BorrowingInfo({
                    id: borrowing.id,
                    borrower: borrowing.borrower,
                    landId: borrowing.landId,
                    amount: borrowing.amount,
                    fee: borrowing.fee,
                    duration: borrowing.duration,
                    startTime: borrowing.startTime,
                    isActive: borrowing.isActive,
                    contactInfo: borrowing.contactInfo,
                    purpose: borrowing.purpose,
                    collateralInfo: borrowing.collateralInfo,
                    latitude: borrowing.latitude,
                    longitude: borrowing.longitude,
                    totalLent: borrowing.totalLent,
                    totalRepaid: borrowing.totalRepaid
                });
                index++;
            }
        }
        return result;
    }

    function getUserBorrowings(address _user) external view returns (BorrowingInfo[] memory) {
        string[] memory userIds = userBorrowings[_user];
        uint256 activeCount = 0;
        for (uint256 i = 0; i < userIds.length; i++) {
            if (borrowings[userIds[i]].isActive) {
                activeCount++;
            }
        }

        BorrowingInfo[] memory result = new BorrowingInfo[](activeCount);
        uint256 index = 0;
        for (uint256 i = 0; i < userIds.length; i++) {
            if (borrowings[userIds[i]].isActive) {
                Borrowing storage borrowing = borrowings[userIds[i]];
                result[index] = BorrowingInfo({
                    id: borrowing.id,
                    borrower: borrowing.borrower,
                    landId: borrowing.landId,
                    amount: borrowing.amount,
                    fee: borrowing.fee,
                    duration: borrowing.duration,
                    startTime: borrowing.startTime,
                    isActive: borrowing.isActive,
                    contactInfo: borrowing.contactInfo,
                    purpose: borrowing.purpose,
                    collateralInfo: borrowing.collateralInfo,
                    latitude: borrowing.latitude,
                    longitude: borrowing.longitude,
                    totalLent: borrowing.totalLent,
                    totalRepaid: borrowing.totalRepaid
                });
                index++;
            }
        }
        return result;
    }

    function getLenderContribution(string memory _id, address _lender) external view returns (uint256) {
        return borrowings[_id].lenderContributions[_lender];
    }

    function getLenders(string memory _id) external view returns (address[] memory) {
        return borrowings[_id].lenders;
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
}