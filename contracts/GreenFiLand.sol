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
    uint256 public constant MAX_PAGE_SIZE = 50;

    struct LandListing {
        string id;
        address owner;
        string metadataURI;
        uint256 collateralValue;
        bool isActive;
        string contactInfo;
    }

    mapping(string => LandListing) public landListings;
    string[] public landIds;
    mapping(string => uint256) public landIdIndices;
    uint256 public activeListingsCount;

    event LandListed(string indexed id, address indexed owner, string metadataURI, uint256 collateralValue, string contactInfo, uint256 fee);
    event CollateralUpdated(string indexed id, address indexed owner, uint256 newCollateralValue, uint256 fee);
    event LandDelisted(string indexed id, address indexed owner, uint256 refundAmount);

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
        string memory _contactInfo
    ) external nonReentrant whenNotPaused {
        if (bytes(_id).length == 0 || bytes(_id).length > 32) revert InvalidLandId();
        if (bytes(_metadataURI).length == 0 || !startsWith(_metadataURI, "ipfs://")) revert InvalidMetadataURI();
        if (bytes(_contactInfo).length > MAX_CONTACT_LENGTH) revert InvalidContactInfo();
        if (_collateralValue == 0) revert InvalidCollateralValue();
        if (bytes(landListings[_id].id).length != 0) revert LandInUse();

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
            contactInfo: _contactInfo
        });

        landIdIndices[_id] = landIds.length;
        landIds.push(_id);
        activeListingsCount++;

        emit LandListed(_id, msg.sender, _metadataURI, _collateralValue, _contactInfo, fee);
    }

    function updateLandCollateral(string memory _id, uint256 _newCollateralValue) external nonReentrant whenNotPaused {
        LandListing storage listing = landListings[_id];
        if (!listing.isActive) revert LandNotActive();
        if (listing.owner != msg.sender) revert Unauthorized();
        if (_newCollateralValue == 0) revert InvalidCollateralValue();

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

        uint256 collateral = listing.collateralValue;
        uint256 fee = (collateral * FEE_BASIS_POINTS) / 10000;
        uint256 totalRefund = collateral + fee;

        listing.isActive = false;
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
        for (uint256 idx = 0; idx < landIds.length && count < resultSize; idx++) {
            if (landListings[landIds[idx]].isActive && idx >= startIndex) {
                result[count] = landListings[landIds[idx]];
                count++;
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
            if (landListings[landIds[idx]].isActive && landListings[landIds[idx]].owner == user) {
                userListingCount++;
            }
        }

        if (startIndex >= userListingCount) revert InvalidPaginationParameters();

        uint256 resultSize = userListingCount > startIndex ? userListingCount - startIndex : 0;
        if (resultSize > pageSize) resultSize = pageSize;
        LandListing[] memory result = new LandListing[](resultSize);

        uint256 count = 0;
        for (uint256 i = 0; i < landIds.length && count < resultSize; i++) {
            if (landListings[landIds[i]].isActive && landListings[landIds[i]].owner == user && i >= startIndex) {
                result[count] = landListings[landIds[i]];
                count++;
            }
        }

        return (result, userListingCount);
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