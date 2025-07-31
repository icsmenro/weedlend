// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract WEEDL is ERC20, ERC20Burnable, AccessControl, ReentrancyGuard {
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

    uint256 public immutable TOTAL_SUPPLY = 4_200_000_000 * 10**18;
    uint256 public immutable PRESALE_ALLOCATION = (TOTAL_SUPPLY * 30) / 100;
    uint256 public immutable BURN_ALLOCATION = (TOTAL_SUPPLY * 20) / 100;
    uint256 public immutable STAKING_ALLOCATION = (TOTAL_SUPPLY * 20) / 100;
    uint256 public immutable LOAN_ALLOCATION = (TOTAL_SUPPLY * 20) / 100;
    uint256 public immutable ECOSYSTEM_ALLOCATION = (TOTAL_SUPPLY * 10) / 100;
    uint256 public constant MIN_PROPOSAL_DEADLINE = 1 hours;
    uint256 public constant DEFAULT_PROPOSAL_DEADLINE = 1 days;
    uint256 private constant ARBITRATOR_BLOCK_THRESHOLD = 2;

    address public immutable ecosystemWallet;
    mapping(address => bool) public dexPairs;
    mapping(address => uint256) private lastTransferBlock;
    address public pendingAdmin;
    uint256 public pendingAdminDeadline;
    // New: Explicitly track current admin
    address public currentAdmin;

    event TokensMinted(address indexed to, uint256 amount, string purpose);
    event TokensBurnedAfterSell(address indexed seller, uint256 amount);
    event BurnSkipped(address indexed to, uint256 amount);
    event DexPairAdded(address indexed dexPair, uint256 timestamp);
    event DexPairRemoved(address indexed dexPair, uint256 timestamp);
    event AdminRoleProposed(address indexed oldAdmin, address indexed newAdmin, uint256 deadline);
    event AdminRoleAccepted(address indexed oldAdmin, address indexed newAdmin, uint256 timestamp);
    event AdminProposalCanceled(address indexed oldPendingAdmin, uint256 timestamp);

    constructor(
        address admin,
        address _ecosystemWallet,
        address[] memory initialDexPairs
    ) ERC20("WeedLend Token", "WEEDL") {
        require(admin != address(0), "Zero admin address");
        require(_ecosystemWallet != address(0), "Zero ecosystem wallet address");

        _grantRole(ADMIN_ROLE, admin);
        currentAdmin = admin; // Set initial admin
        ecosystemWallet = _ecosystemWallet;

        for (uint256 i = 0; i < initialDexPairs.length; i++) {
            require(initialDexPairs[i] != address(0), "Zero DEX pair address");
            require(initialDexPairs[i].code.length > 0, "DEX pair not a contract");
            require(!dexPairs[initialDexPairs[i]], "DEX pair already exists");
            dexPairs[initialDexPairs[i]] = true;
            emit DexPairAdded(initialDexPairs[i], block.timestamp);
        }

        _mint(address(this), BURN_ALLOCATION + STAKING_ALLOCATION + LOAN_ALLOCATION);
        emit TokensMinted(address(this), BURN_ALLOCATION + STAKING_ALLOCATION + LOAN_ALLOCATION, "Burn, Staking, Loan");
        _mint(admin, PRESALE_ALLOCATION);
        emit TokensMinted(admin, PRESALE_ALLOCATION, "Presale");
        _mint(_ecosystemWallet, ECOSYSTEM_ALLOCATION);
        emit TokensMinted(_ecosystemWallet, ECOSYSTEM_ALLOCATION, "Ecosystem");
    }

    function addDexPair(address _dexPair) external onlyRole(ADMIN_ROLE) nonReentrant {
        require(_dexPair != address(0), "Zero address");
        require(_dexPair.code.length > 0, "Not a contract");
        require(!dexPairs[_dexPair], "DEX pair already exists");
        dexPairs[_dexPair] = true;
        emit DexPairAdded(_dexPair, block.timestamp);
    }

    function removeDexPair(address _dexPair) external onlyRole(ADMIN_ROLE) nonReentrant {
        require(dexPairs[_dexPair], "DEX pair does not exist");
        dexPairs[_dexPair] = false;
        emit DexPairRemoved(_dexPair, block.timestamp);
    }

    function proposeAdmin(address newAdmin, uint256 deadlineDuration) external onlyRole(ADMIN_ROLE) nonReentrant {
        require(newAdmin != address(0), "Zero address");
        require(newAdmin != msg.sender, "Cannot propose self");
        require(deadlineDuration >= MIN_PROPOSAL_DEADLINE, "Deadline too short");
        pendingAdmin = newAdmin;
        pendingAdminDeadline = block.timestamp + deadlineDuration;
        emit AdminRoleProposed(currentAdmin, newAdmin, pendingAdminDeadline);
    }

    function acceptAdminRole() external nonReentrant {
        require(msg.sender == pendingAdmin, "Not proposed admin");
        require(block.timestamp <= pendingAdminDeadline, "Proposal expired");
        address oldAdmin = currentAdmin;
        _grantRole(ADMIN_ROLE, msg.sender);
        _revokeRole(ADMIN_ROLE, oldAdmin);
        currentAdmin = msg.sender; // Update current admin
        pendingAdmin = address(0);
        pendingAdminDeadline = 0;
        emit AdminRoleAccepted(oldAdmin, msg.sender, block.timestamp);
    }

    function cancelProposal() external onlyRole(ADMIN_ROLE) nonReentrant {
        require(pendingAdmin != address(0), "No pending admin");
        address oldPending = pendingAdmin;
        pendingAdmin = address(0);
        pendingAdminDeadline = 0;
        emit AdminProposalCanceled(oldPending, block.timestamp);
    }

    function isDexPair(address _pair) public view returns (bool) {
        return dexPairs[_pair];
    }

    function isArbitrator(address account) private view returns (bool) {
        uint256 lastBlock = lastTransferBlock[account];
        return lastBlock > 0 && block.number <= lastBlock + ARBITRATOR_BLOCK_THRESHOLD;
    }

    function transfer(address to, uint256 amount) public virtual override returns (bool) {
        address owner = _msgSender();
        require(amount > 0, "Zero amount");
        super._transfer(owner, to, amount);

        lastTransferBlock[owner] = block.number;
        lastTransferBlock[to] = block.number;

        if (dexPairs[to] && !isArbitrator(owner)) {
            if (balanceOf(address(this)) >= amount) {
                super._burn(address(this), amount);
                emit TokensBurnedAfterSell(owner, amount);
            } else {
                emit BurnSkipped(to, amount);
            }
        }
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) public virtual override returns (bool) {
        address spender = _msgSender();
        require(amount > 0, "Zero amount");
        _spendAllowance(from, spender, amount);
        super._transfer(from, to, amount);

        lastTransferBlock[from] = block.number;
        lastTransferBlock[to] = block.number;

        if (dexPairs[to] && !isArbitrator(from)) {
            if (balanceOf(address(this)) >= amount) {
                super._burn(address(this), amount);
                emit TokensBurnedAfterSell(from, amount);
            } else {
                emit BurnSkipped(to, amount);
            }
        }
        return true;
    }

    function burn(uint256 amount) public override nonReentrant {
        require(amount > 0, "Zero amount");
        super.burn(amount);
    }

    receive() external payable {
        revert("ETH not supported");
    }

    function getContractState() external view returns (
        address currentPendingAdmin,
        uint256 currentPendingDeadline,
        address currentAdminAddress
    ) {
        return (pendingAdmin, pendingAdminDeadline, currentAdmin);
    }

    function version() external pure returns (string memory) {
        return "1.0.5";
    }
}