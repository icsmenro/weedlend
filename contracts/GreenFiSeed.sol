// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";

contract GreenFiSeed is Initializable, UUPSUpgradeable, OwnableUpgradeable, ReentrancyGuardUpgradeable, PausableUpgradeable {
    using SafeERC20 for IERC20;

    IERC20 public weedlToken;
    uint256 public constant FEE_BASIS_POINTS = 42; // 0.420% fee (42 basis points)
    uint256 public constant MAX_CONTACT_LENGTH = 100;
    uint256 public constant MAX_SEED_ID_LENGTH = 32;
    uint256 public constant MAX_QUANTITY = 1000; // Maximum number of packs
    uint256 public constant MAX_DISCOUNT = 50;
    uint256 public constant MIN_PRICE = 0.0001 ether; // Minimum price per pack in WEEDL (0.0001 tokens)

    // Valid pack sizes: 3, 5, or 10 seeds per pack
    uint256[] public validPackSizes;

    struct Seed {
        string id;
        address seller;
        string metadataURI;
        string strain;
        uint256 price; // Price per pack
        string contactInfo;
        uint256 packSize; // Number of seeds per pack (3, 5, or 10)
        uint256 packQuantity; // Number of packs available
        uint256 discount; // Discount percentage (0-50%)
        bool isActive;
    }

    mapping(string => Seed) public seeds;
    string[] public seedIds;
    mapping(address => string[]) public sellerSeeds;

    event SeedListed(
        string indexed seedId,
        address indexed seller,
        string metadataURI,
        string strain,
        uint256 price,
        string contactInfo,
        uint256 packSize,
        uint256 packQuantity,
        uint256 discount,
        uint256 fee
    );
    event SeedPurchased(string indexed seedId, address indexed buyer, uint256 packQuantity, uint256 totalPrice);
    event SeedDelisted(string indexed seedId, address indexed seller);
    event FeeCollected(address indexed payer, uint256 feeAmount);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address _weedlToken) external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
        __Pausable_init(); // Initialize PausableUpgradeable
        require(_weedlToken != address(0), "Invalid token address");
        weedlToken = IERC20(_weedlToken);
        // Initialize validPackSizes in the initializer
        validPackSizes = [3, 5, 10];
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}

    function isValidPackSize(uint256 _packSize) internal view returns (bool) {
        for (uint256 i = 0; i < validPackSizes.length; i++) {
            if (_packSize == validPackSizes[i]) {
                return true;
            }
        }
        return false;
    }

    function listSeed(
        string memory _seedId,
        string memory _metadataURI,
        uint256 _price,
        string memory _contactInfo,
        string memory _strain,
        uint256 _packSize,
        uint256 _packQuantity,
        uint256 _discount
    ) external nonReentrant whenNotPaused {
        // Input validations
        require(bytes(_seedId).length > 0 && bytes(_seedId).length <= MAX_SEED_ID_LENGTH, "Invalid seed ID length");
        require(seeds[_seedId].seller == address(0), "Seed ID already in use");
        require(_price >= MIN_PRICE, "Price below minimum");
        require(_packQuantity > 0 && _packQuantity <= MAX_QUANTITY, "Invalid pack quantity");
        require(isValidPackSize(_packSize), "Invalid pack size");
        require(_discount <= MAX_DISCOUNT, "Discount exceeds maximum");
        require(bytes(_contactInfo).length <= MAX_CONTACT_LENGTH, "Contact info too long");
        require(bytes(_strain).length > 0, "Invalid strain");
        require(bytes(_metadataURI).length > 0, "Invalid metadata URI");

        // Calculate listing fee (0.420% of price per pack)
        uint256 fee = (_price * FEE_BASIS_POINTS) / 10000;
        require(fee > 0, "Fee calculation error");

        // Ensure sufficient allowance and balance
        require(weedlToken.allowance(msg.sender, address(this)) >= fee, "Insufficient allowance");
        require(weedlToken.balanceOf(msg.sender) >= fee, "Insufficient WEEDL balance");

        // Transfer listing fee to contract
        weedlToken.safeTransferFrom(msg.sender, address(this), fee);

        // Create and store seed listing
        Seed memory newSeed = Seed({
            id: _seedId,
            seller: msg.sender,
            metadataURI: _metadataURI,
            strain: _strain,
            price: _price,
            contactInfo: _contactInfo,
            packSize: _packSize,
            packQuantity: _packQuantity,
            discount: _discount,
            isActive: true
        });

        seeds[_seedId] = newSeed;
        seedIds.push(_seedId);
        sellerSeeds[msg.sender].push(_seedId);

        emit SeedListed(
            _seedId,
            msg.sender,
            _metadataURI,
            _strain,
            _price,
            _contactInfo,
            _packSize,
            _packQuantity,
            _discount,
            fee
        );
        emit FeeCollected(msg.sender, fee);
    }

    function purchaseSeed(string memory _seedId, uint256 _packQuantity) external nonReentrant whenNotPaused {
        Seed storage seed = seeds[_seedId];
        require(seed.isActive, "Seed not active");
        require(_packQuantity > 0, "Invalid pack quantity");
        require(seed.packQuantity >= _packQuantity, "Insufficient pack quantity");
        require(seed.seller != msg.sender, "Cannot buy own seed");

        // Calculate price with discount
        uint256 price = seed.price;
        if (seed.discount > 0) {
            price = (price * (100 - seed.discount)) / 100;
        }

        uint256 totalPrice = price * _packQuantity;
        uint256 fee = (totalPrice * FEE_BASIS_POINTS) / 10000;
        uint256 amountToSeller = totalPrice - fee;

        // Ensure sufficient allowance and balance
        require(weedlToken.allowance(msg.sender, address(this)) >= totalPrice, "Insufficient allowance");
        require(weedlToken.balanceOf(msg.sender) >= totalPrice, "Insufficient WEEDL balance");

        // Transfer tokens
        weedlToken.safeTransferFrom(msg.sender, seed.seller, amountToSeller);
        weedlToken.safeTransferFrom(msg.sender, address(this), fee);

        // Update pack quantity
        seed.packQuantity -= _packQuantity;
        if (seed.packQuantity == 0) {
            seed.isActive = false;
        }

        emit SeedPurchased(_seedId, msg.sender, _packQuantity, totalPrice);
        emit FeeCollected(msg.sender, fee);
    }

    function delistSeed(string memory _seedId) external nonReentrant whenNotPaused {
        Seed storage seed = seeds[_seedId];
        require(seed.seller == msg.sender, "Not seed seller");
        require(seed.isActive, "Seed not active");

        seed.isActive = false;
        emit SeedDelisted(_seedId, msg.sender);
    }

    function getAllSeeds() external view returns (Seed[] memory) {
        uint256 activeCount = 0;
        for (uint256 i = 0; i < seedIds.length; i++) {
            if (seeds[seedIds[i]].isActive) {
                activeCount++;
            }
        }

        Seed[] memory activeSeeds = new Seed[](activeCount);
        uint256 index = 0;
        for (uint256 i = 0; i < seedIds.length; i++) {
            if (seeds[seedIds[i]].isActive) {
                activeSeeds[index] = seeds[seedIds[i]];
                index++;
            }
        }
        return activeSeeds;
    }

    function getSellerSeeds(address _seller) external view returns (Seed[] memory) {
        string[] memory sellerSeedIds = sellerSeeds[_seller];
        Seed[] memory result = new Seed[](sellerSeedIds.length);
        for (uint256 i = 0; i < sellerSeedIds.length; i++) {
            result[i] = seeds[sellerSeedIds[i]];
        }
        return result;
    }

    function withdrawFees() external onlyOwner nonReentrant {
        uint256 balance = weedlToken.balanceOf(address(this));
        require(balance > 0, "No fees to withdraw");
        weedlToken.safeTransfer(owner(), balance);
    }

    function isSeedIdAvailable(string memory _seedId) external view returns (bool) {
        return seeds[_seedId].seller == address(0);
    }

    // Helper function to get valid pack sizes
    function getValidPackSizes() external view returns (uint256[] memory) {
        return validPackSizes;
    }

    // Pause and unpause functions
    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }
}