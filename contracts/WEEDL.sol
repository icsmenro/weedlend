// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol"; // Updated import to ERC20 directly
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract WEEDL is ERC20, ERC20Burnable, AccessControl, ReentrancyGuard {
    bytes32 public constant ADMIN_ROLE = keccak256("0x1Ce468FACec05BEe2556b3CaA91E1264FDD976EE");

    uint256 public constant TOTAL_SUPPLY = 4_200_000_000 * 10**18;
    uint256 public constant PRESALE_ALLOCATION = (TOTAL_SUPPLY * 30) / 100;
    uint256 public constant BURN_ALLOCATION = (TOTAL_SUPPLY * 20) / 100;
    uint256 public constant STAKING_ALLOCATION = (TOTAL_SUPPLY * 20) / 100;
    uint256 public constant LOAN_ALLOCATION = (TOTAL_SUPPLY * 20) / 100;
    uint256 public constant ECOSYSTEM_ALLOCATION = (TOTAL_SUPPLY * 10) / 100;

    uint256 public constant FEE_BASIS_POINTS = 42; // 0.420%
    address public ecosystemWallet;

    event EcosystemWalletUpdated(address indexed oldWallet, address indexed newWallet);
    event TransactionFeeCollected(address indexed from, address indexed to, uint256 fee);
    event TokensBurnedAfterSell(address indexed seller, uint256 amount);

    constructor(address admin, address _ecosystemWallet) ERC20("WeedLend Token", "WEEDL") {
        require(admin != address(0) && _ecosystemWallet != address(0), "Zero address");

        _grantRole(ADMIN_ROLE, admin);
        ecosystemWallet = _ecosystemWallet;

        _mint(address(this), BURN_ALLOCATION + STAKING_ALLOCATION + LOAN_ALLOCATION);
        _mint(admin, PRESALE_ALLOCATION);
        _mint(_ecosystemWallet, ECOSYSTEM_ALLOCATION);
    }

    function updateEcosystemWallet(address newWallet) external onlyRole(ADMIN_ROLE) nonReentrant {
        require(newWallet != address(0), "Zero address");
        address old = ecosystemWallet;
        ecosystemWallet = newWallet;
        emit EcosystemWalletUpdated(old, newWallet);
    }

    // Custom transfer function instead of overriding _transfer
    function _customTransfer(address from, address to, uint256 amount) internal {
        require(amount > 0, "Zero amount");
        uint256 fee = (amount * FEE_BASIS_POINTS) / 10_000;
        uint256 net = amount - fee;
        super._transfer(from, ecosystemWallet, fee); // Call parent _transfer
        super._transfer(from, to, net); // Call parent _transfer
        emit TransactionFeeCollected(from, to, fee);
    }

    // Override transfer to use custom transfer logic
    function transfer(address to, uint256 amount) public virtual override returns (bool) {
        address owner = _msgSender();
        _customTransfer(owner, to, amount);
        return true;
    }

    // Override transferFrom to use custom transfer logic
    function transferFrom(address from, address to, uint256 amount) public virtual override returns (bool) {
        address spender = _msgSender();
        _spendAllowance(from, spender, amount);
        _customTransfer(from, to, amount);
        return true;
    }

    function burn(uint256 amount) public override nonReentrant {
        super.burn(amount);
    }

    function burnAfterSell(uint256 amount) external onlyRole(ADMIN_ROLE) nonReentrant {
        require(amount <= balanceOf(address(this)), "Insufficient contract balance");
        super._burn(address(this), amount);
        emit TokensBurnedAfterSell(msg.sender, amount);
    }

    function withdrawContractTokens(address to, uint256 amount) external onlyRole(ADMIN_ROLE) nonReentrant {
        require(to != address(0) && amount > 0 && amount <= balanceOf(address(this)), "Invalid withdrawal");
        _customTransfer(address(this), to, amount); // Use custom transfer
    }

    receive() external payable {
        revert("ETH not accepted");
    }
}