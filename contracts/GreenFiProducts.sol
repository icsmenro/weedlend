// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";

contract GreenFiProducts is Initializable, UUPSUpgradeable, OwnableUpgradeable, ReentrancyGuardUpgradeable, PausableUpgradeable {
    using SafeERC20 for IERC20;

    IERC20 public weedlToken;
    uint256 public constant FEE_BASIS_POINTS = 42; // 0.420% fee (42 basis points)
    uint256 public constant MAX_CONTACT_LENGTH = 100;
    uint256 public constant MAX_PRODUCT_ID_LENGTH = 32;
    uint256 public constant MAX_QUANTITY = 1000; // Maximum number of units available
    uint256 public constant MAX_DISCOUNT = 50;
    uint256 public constant MIN_PRICE = 0.0001 ether; // Minimum price per unit in WEEDL (0.0001 tokens)

    // Valid unit quantities: 1, 10, 50, or 100 units
    uint256[] public validUnitQuantities;

    struct Product {
        string id;
        address seller;
        string metadataURI;
        string category;
        uint256 price; // Price per unit
        string contactInfo;
        uint256 unitQuantity; // Number of units per item (e.g., 10ml per bottle)
        uint256 quantityAvailable; // Number of units available
        uint256 discount; // Discount percentage (0-50%)
        bool isActive;
    }

    mapping(string => Product) public products;
    string[] public productIds;
    mapping(address => string[]) public sellerProducts;

    event ProductListed(
        string indexed productId,
        address indexed seller,
        string metadataURI,
        string category,
        uint256 price,
        string contactInfo,
        uint256 unitQuantity,
        uint256 quantityAvailable,
        uint256 discount,
        uint256 fee
    );
    event ProductPurchased(string indexed productId, address indexed buyer, uint256 quantityPurchased, uint256 totalPrice);
    event ProductDelisted(string indexed productId, address indexed seller);
    event FeeCollected(address indexed payer, uint256 feeAmount);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address _weedlToken) external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
        __Pausable_init();
        require(_weedlToken != address(0), "Invalid token address");
        weedlToken = IERC20(_weedlToken);
        validUnitQuantities = [1, 10, 50, 100];
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}

    function isValidUnitQuantity(uint256 _unitQuantity) internal view returns (bool) {
        for (uint256 i = 0; i < validUnitQuantities.length; i++) {
            if (_unitQuantity == validUnitQuantities[i]) {
                return true;
            }
        }
        return false;
    }

    function listProduct(
        string memory _productId,
        string memory _metadataURI,
        uint256 _price,
        string memory _contactInfo,
        string memory _category,
        uint256 _unitQuantity,
        uint256 _quantityAvailable,
        uint256 _discount
    ) external nonReentrant whenNotPaused {
        // Input validations
        require(bytes(_productId).length > 0 && bytes(_productId).length <= MAX_PRODUCT_ID_LENGTH, "Invalid product ID length");
        require(products[_productId].seller == address(0), "ProductIdInUse");
        require(_price >= MIN_PRICE, "InvalidPrice");
        require(_quantityAvailable > 0 && _quantityAvailable <= MAX_QUANTITY, "Invalid quantity available");
        require(isValidUnitQuantity(_unitQuantity), "InvalidUnitQuantity");
        require(_discount <= MAX_DISCOUNT, "Discount exceeds maximum");
        require(bytes(_contactInfo).length <= MAX_CONTACT_LENGTH, "Contact info too long");
        require(bytes(_category).length > 0, "Invalid category");
        require(bytes(_metadataURI).length > 0, "Invalid metadata URI");

        // Calculate listing fee (0.420% of price per unit)
        uint256 fee = (_price * FEE_BASIS_POINTS) / 10000;
        require(fee > 0, "Fee calculation error");

        // Ensure sufficient allowance and balance
        require(weedlToken.allowance(msg.sender, address(this)) >= fee, "Insufficient allowance");
        require(weedlToken.balanceOf(msg.sender) >= fee, "Insufficient WEEDL balance");

        // Transfer listing fee to contract
        weedlToken.safeTransferFrom(msg.sender, address(this), fee);

        // Create and store product listing
        Product memory newProduct = Product({
            id: _productId,
            seller: msg.sender,
            metadataURI: _metadataURI,
            category: _category,
            price: _price,
            contactInfo: _contactInfo,
            unitQuantity: _unitQuantity,
            quantityAvailable: _quantityAvailable,
            discount: _discount,
            isActive: true
        });

        products[_productId] = newProduct;
        productIds.push(_productId);
        sellerProducts[msg.sender].push(_productId);

        emit ProductListed(
            _productId,
            msg.sender,
            _metadataURI,
            _category,
            _price,
            _contactInfo,
            _unitQuantity,
            _quantityAvailable,
            _discount,
            fee
        );
        emit FeeCollected(msg.sender, fee);
    }

    function purchaseProduct(string memory _productId, uint256 _quantityPurchased) external nonReentrant whenNotPaused {
        Product storage product = products[_productId];
        require(product.isActive, "Product not active");
        require(_quantityPurchased > 0, "Invalid quantity purchased");
        require(product.quantityAvailable >= _quantityPurchased, "Insufficient quantity available");
        require(product.seller != msg.sender, "Cannot buy own product");

        // Calculate price with discount
        uint256 price = product.price;
        if (product.discount > 0) {
            price = (price * (100 - product.discount)) / 100;
        }

        uint256 totalPrice = price * _quantityPurchased;
        uint256 fee = (totalPrice * FEE_BASIS_POINTS) / 10000;
        uint256 amountToSeller = totalPrice - fee;

        // Ensure sufficient allowance and balance
        require(weedlToken.allowance(msg.sender, address(this)) >= totalPrice, "Insufficient allowance");
        require(weedlToken.balanceOf(msg.sender) >= totalPrice, "Insufficient WEEDL balance");

        // Transfer tokens
        weedlToken.safeTransferFrom(msg.sender, product.seller, amountToSeller);
        weedlToken.safeTransferFrom(msg.sender, address(this), fee);

        // Update quantity available
        product.quantityAvailable -= _quantityPurchased;
        if (product.quantityAvailable == 0) {
            product.isActive = false;
        }

        emit ProductPurchased(_productId, msg.sender, _quantityPurchased, totalPrice);
        emit FeeCollected(msg.sender, fee);
    }

    function delistProduct(string memory _productId) external nonReentrant whenNotPaused {
        Product storage product = products[_productId];
        require(product.seller == msg.sender, "Not product seller");
        require(product.isActive, "Product not active");

        product.isActive = false;
        emit ProductDelisted(_productId, msg.sender);
    }

    function getAllProducts() external view returns (Product[] memory) {
        uint256 activeCount = 0;
        for (uint256 i = 0; i < productIds.length; i++) {
            if (products[productIds[i]].isActive) {
                activeCount++;
            }
        }

        Product[] memory activeProducts = new Product[](activeCount);
        uint256 index = 0;
        for (uint256 i = 0; i < productIds.length; i++) {
            if (products[productIds[i]].isActive) {
                activeProducts[index] = products[productIds[i]];
                index++;
            }
        }
        return activeProducts;
    }

    function getSellerProducts(address _seller) external view returns (Product[] memory) {
        string[] memory sellerProductIds = sellerProducts[_seller];
        Product[] memory result = new Product[](sellerProductIds.length);
        for (uint256 i = 0; i < sellerProductIds.length; i++) {
            result[i] = products[sellerProductIds[i]];
        }
        return result;
    }

    function withdrawFees() external onlyOwner nonReentrant {
        uint256 balance = weedlToken.balanceOf(address(this));
        require(balance > 0, "No fees to withdraw");
        weedlToken.safeTransfer(owner(), balance);
    }

    function isProductIdAvailable(string memory _productId) external view returns (bool) {
        return products[_productId].seller == address(0);
    }

    function getValidUnitQuantities() external view returns (uint256[] memory) {
        return validUnitQuantities;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }
}