// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";

contract GreenFiLand is Initializable, UUPSUpgradeable, OwnableUpgradeable, ReentrancyGuardUpgradeable, PausableUpgradeable {
    using SafeERC20 for IERC20;

    IERC20 public weedlToken;
    uint256 public constant FEE_BASIS_POINTS = 42; // 0.420%
    uint256 public constant MAX_CONTACT_LENGTH = 100;
    uint256 public constant MAX_MESSAGE_LENGTH = 500;
    uint256 public constant MAX_PAGE_SIZE = 50;
    uint256 public constant MIN_LEASE_DURATION = 1 days;
    uint256 public constant MAX_LEASE_DURATION = 365 days;

    enum ListingType { None, Sell, Lease } // New enum for listing type
    enum ListingStatus { Active, Sold, Bought } // New enum for listing status

    struct LandListing {
        string id;
        address owner;
        string metadataURI;
        uint256 collateralValue;
        bool isActive;
        string contactInfo;
        uint256 suggestedLeasePrice;
        ListingType listingType;
        ListingStatus status; // New field to track status
    }

    struct Lease {
        address lessee;
        uint256 startTime;
        uint256 duration;
        uint256 price;
        bool isActive;
    }

    struct Purchase {
        string id;
        address buyer;
        address seller;
        uint256 amount;
        uint256 timestamp;
    }

    mapping(string => LandListing) public landListings;
    mapping(string => Lease) public leases;
    mapping(string => Purchase) public purchases; // New mapping for purchase records
    string[] public landIds;
    mapping(string => uint256) public landIdIndices;
    uint256 public activeListingsCount;

    // Mapping to track user purchases (both as buyer and seller)
    mapping(address => string[]) public userPurchases; // Maps user to array of purchased land IDs

    event LandListed(string indexed id, address indexed owner, string metadataURI, uint256 collateralValue, string contactInfo, uint256 suggestedLeasePrice, uint256 fee, ListingType listingType);
    event CollateralUpdated(string indexed id, address indexed owner, uint256 newCollateralValue, uint256 fee);
    event LandDelisted(string indexed id, address indexed owner, uint256 refundAmount);
    event LandPurchased(string indexed id, address indexed buyer, address indexed seller, uint256 amount);
    event LandLeased(string indexed id, address indexed lessee, address indexed owner, uint256 price, uint256 duration);
    event LeaseEnded(string indexed id, address indexed lessee, address indexed owner);
    event MessageSent(string indexed id, address indexed sender, string message);

    error InvalidCollateralValue();
    error LandInUse();
    error Unauthorized();
    error LandNotActive();
    error InvalidContactInfo();
    error InvalidTokenAddress();
    error InvalidLandId();
    error InsufficientBalance();
    error InvalidPaginationParameters();
    error InvalidMetadataURI();
    error InvalidMessageLength();
    error InsufficientPayment();
    error InvalidLeaseDuration();
    error InvalidLeasePrice();
    error LandAlreadyLeased();
    error LeaseNotActive();
    error LeaseNotExpired();
    error InvalidListingType();

    function initialize(address _weedlToken) public initializer {
        if (_weedlToken == address(0) || _weedlToken.code.length == 0) revert InvalidTokenAddress();
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
        __Pausable_init();
        weedlToken = IERC20(_weedlToken);
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function listLand(
        string memory _id,
        string memory _metadataURI,
        uint256 _collateralValue,
        string memory _contactInfo,
        uint256 _suggestedLeasePrice,
        ListingType _listingType
    ) external nonReentrant whenNotPaused {
        if (bytes(_id).length == 0 || bytes(_id).length > 32) revert InvalidLandId();
        if (bytes(_metadataURI).length == 0 || !startsWith(_metadataURI, "ipfs://")) revert InvalidMetadataURI();
        if (bytes(_contactInfo).length > MAX_CONTACT_LENGTH) revert InvalidContactInfo();
        if (_collateralValue == 0) revert InvalidCollateralValue();
        if (bytes(landListings[_id].id).length != 0) revert LandInUse();
        if (_listingType == ListingType.None) revert InvalidListingType();
        if (_listingType == ListingType.Lease && _suggestedLeasePrice == 0) revert InvalidLeasePrice();

        uint256 fee = (_collateralValue * FEE_BASIS_POINTS) / 10000;
        uint256 totalRequired = _collateralValue + fee;

        if (weedlToken.balanceOf(msg.sender) < totalRequired) revert InsufficientBalance();

        weedlToken.safeTransferFrom(msg.sender, address(this), totalRequired);

        landListings[_id] = LandListing({
            id: _id,
            owner: msg.sender,
            metadataURI: _metadataURI,
            collateralValue: _collateralValue,
            isActive: true,
            contactInfo: _contactInfo,
            suggestedLeasePrice: _suggestedLeasePrice,
            listingType: _listingType,
            status: ListingStatus.Active // Initialize as Active
        });

        landIdIndices[_id] = landIds.length;
        landIds.push(_id);
        activeListingsCount++;

        emit LandListed(_id, msg.sender, _metadataURI, _collateralValue, _contactInfo, _suggestedLeasePrice, fee, _listingType);
    }

    function updateLandCollateral(string memory _id, uint256 _newCollateralValue) external nonReentrant whenNotPaused {
        LandListing storage listing = landListings[_id];
        if (!listing.isActive) revert LandNotActive();
        if (listing.owner != msg.sender) revert Unauthorized();
        if (_newCollateralValue == 0) revert InvalidCollateralValue();
        if (listing.status != ListingStatus.Active) revert InvalidListingType();

        uint256 oldCollateral = listing.collateralValue;
        uint256 oldFee = (oldCollateral * FEE_BASIS_POINTS) / 10000;
        uint256 oldTotal = oldCollateral + oldFee;

        uint256 newFee = (_newCollateralValue * FEE_BASIS_POINTS) / 10000;
        uint256 newTotal = _newCollateralValue + newFee;

        if (newTotal > oldTotal) {
            weedlToken.safeTransferFrom(msg.sender, address(this), newTotal - oldTotal);
        } else if (newTotal < oldTotal) {
            weedlToken.safeTransfer(msg.sender, oldTotal - newTotal);
        }

        listing.collateralValue = _newCollateralValue;
        emit CollateralUpdated(_id, msg.sender, _newCollateralValue, newFee);
    }

    function delistLand(string memory _id) external nonReentrant whenNotPaused {
        LandListing storage listing = landListings[_id];
        if (!listing.isActive) revert LandNotActive();
        if (listing.owner != msg.sender) revert Unauthorized();
        if (leases[_id].isActive) revert LandAlreadyLeased();
        if (listing.status != ListingStatus.Active) revert InvalidListingType();

        uint256 collateral = listing.collateralValue;
        uint256 fee = (collateral * FEE_BASIS_POINTS) / 10000;
        uint256 totalRefund = collateral + fee;

        listing.isActive = false;
        listing.status = ListingStatus.Active; // Reset status
        activeListingsCount--;

        uint256 index = landIdIndices[_id];
        if (index < landIds.length) {
            landIds[index] = landIds[landIds.length - 1];
            landIdIndices[landIds[index]] = index;
            landIds.pop();
            delete landIdIndices[_id];
        }

        weedlToken.safeTransfer(msg.sender, totalRefund);
        emit LandDelisted(_id, msg.sender, totalRefund);
    }

    function purchaseLand(string memory _id, uint256 _paymentAmount) external nonReentrant whenNotPaused {
        LandListing storage listing = landListings[_id];
        if (!listing.isActive) revert LandNotActive();
        if (listing.listingType != ListingType.Sell) revert InvalidListingType();
        if (_paymentAmount < listing.collateralValue) revert InsufficientPayment();
        if (leases[_id].isActive) revert LandAlreadyLeased();

        address seller = listing.owner;
        uint256 collateral = listing.collateralValue;
        uint256 fee = (collateral * FEE_BASIS_POINTS) / 10000;
        uint256 totalRefund = collateral + fee;

        weedlToken.safeTransferFrom(msg.sender, seller, _paymentAmount);
        weedlToken.safeTransfer(seller, totalRefund);

        // Record the purchase
        purchases[_id] = Purchase({
            id: _id,
            buyer: msg.sender,
            seller: seller,
            amount: _paymentAmount,
            timestamp: block.timestamp
        });

        // Update listing status
        listing.owner = msg.sender;
        listing.status = ListingStatus.Sold; // Mark as sold
        listing.isActive = false; // Keep inactive to hide from public listings
        activeListingsCount--;

        // Add to userPurchases for both buyer and seller
        userPurchases[msg.sender].push(_id);
        userPurchases[seller].push(_id);

        uint256 index = landIdIndices[_id];
        if (index < landIds.length) {
            landIds[index] = landIds[landIds.length - 1];
            landIdIndices[landIds[index]] = index;
            landIds.pop();
            delete landIdIndices[_id];
        }

        emit LandPurchased(_id, msg.sender, seller, _paymentAmount);
    }

    function leaseLand(string memory _id, uint256 _price, uint256 _duration) external nonReentrant whenNotPaused {
        LandListing storage listing = landListings[_id];
        if (!listing.isActive) revert LandNotActive();
        if (listing.listingType != ListingType.Lease) revert InvalidListingType();
        if (leases[_id].isActive) revert LandAlreadyLeased();
        if (_price == 0) revert InvalidLeasePrice();
        if (_duration < MIN_LEASE_DURATION || _duration > MAX_LEASE_DURATION) revert InvalidLeaseDuration();

        weedlToken.safeTransferFrom(msg.sender, listing.owner, _price);

        leases[_id] = Lease({
            lessee: msg.sender,
            startTime: block.timestamp,
            duration: _duration,
            price: _price,
            isActive: true
        });

        emit LandLeased(_id, msg.sender, listing.owner, _price, _duration);
    }

    function endLease(string memory _id) external nonReentrant whenNotPaused {
        LandListing storage listing = landListings[_id];
        Lease storage lease = leases[_id];
        if (!listing.isActive) revert LandNotActive();
        if (!lease.isActive) revert LeaseNotActive();
        if (block.timestamp < lease.startTime + lease.duration) revert LeaseNotExpired();
        if (msg.sender != listing.owner && msg.sender != lease.lessee) revert Unauthorized();

        lease.isActive = false;
        emit LeaseEnded(_id, lease.lessee, listing.owner);
    }

    function getLeaseDetails(string memory _id) external view returns (Lease memory) {
        return leases[_id];
    }

    function sendMessage(string memory _id, string memory _message) external whenNotPaused {
        if (!landListings[_id].isActive) revert LandNotActive();
        if (bytes(_message).length == 0 || bytes(_message).length > MAX_MESSAGE_LENGTH) revert InvalidMessageLength();

        emit MessageSent(_id, msg.sender, _message);
    }

    function getAllLandListingsPaginated(uint256 startIndex, uint256 pageSize)
        external
        view
        returns (LandListing[] memory, uint256 totalActive)
    {
        if (pageSize == 0 || pageSize > MAX_PAGE_SIZE || startIndex >= activeListingsCount) 
            revert InvalidPaginationParameters();

        uint256 resultSize = activeListingsCount > startIndex ? activeListingsCount - startIndex : 0;
        if (resultSize > pageSize) resultSize = pageSize;
        LandListing[] memory result = new LandListing[](resultSize);

        uint256 count = 0;
        uint256 activeCount = 0;
        for (uint256 idx = 0; idx < landIds.length && count < resultSize; idx++) {
            if (landListings[landIds[idx]].isActive && landListings[landIds[idx]].status == ListingStatus.Active) {
                if (activeCount >= startIndex) {
                    result[count] = landListings[landIds[idx]];
                    count++;
                }
                activeCount++;
            }
        }

        return (result, activeListingsCount);
    }

    function getUserListingsPaginated(address user, uint256 startIndex, uint256 pageSize)
        external
        view
        returns (LandListing[] memory, uint256 totalUserActive)
    {
        if (pageSize == 0 || pageSize > MAX_PAGE_SIZE) revert InvalidPaginationParameters();

        uint256 userListingCount = 0;
        for (uint256 idx = 0; idx < landIds.length; idx++) {
            if (landListings[landIds[idx]].isActive && landListings[landIds[idx]].owner == user && landListings[landIds[idx]].status == ListingStatus.Active) {
                userListingCount++;
            }
        }

        if (startIndex >= userListingCount) revert InvalidPaginationParameters();

        uint256 resultSize = userListingCount > startIndex ? userListingCount - startIndex : 0;
        if (resultSize > pageSize) resultSize = pageSize;
        LandListing[] memory result = new LandListing[](resultSize);

        uint256 count = 0;
        for (uint256 i = 0; i < landIds.length && count < resultSize; i++) {
            if (landListings[landIds[i]].isActive && landListings[landIds[i]].owner == user && landListings[landIds[i]].status == ListingStatus.Active && i >= startIndex) {
                result[count] = landListings[landIds[i]];
                count++;
            }
        }

        return (result, userListingCount);
    }

    function getUserPurchases(address user) external view returns (Purchase[] memory) {
        string[] memory purchaseIds = userPurchases[user];
        Purchase[] memory result = new Purchase[](purchaseIds.length);

        for (uint256 i = 0; i < purchaseIds.length; i++) {
            result[i] = purchases[purchaseIds[i]];
        }

        return result;
    }

    function getLandListing(string memory _id) external view returns (LandListing memory) {
        return landListings[_id];
    }

    function getTotalActiveListings() external view returns (uint256) {
        return activeListingsCount;
    }

    function startsWith(string memory str, string memory prefix) private pure returns (bool) {
        if (bytes(str).length < bytes(prefix).length) return false;
        for (uint256 i = 0; i < bytes(prefix).length; i++) {
            if (bytes(str)[i] != bytes(prefix)[i]) return false;
        }
        return true;
    }
}