// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";

contract GreenFiStaking is Initializable, UUPSUpgradeable, OwnableUpgradeable, ReentrancyGuardUpgradeable, PausableUpgradeable {
    using SafeERC20 for IERC20;

    IERC20 public weedlToken;
    uint256 public constant REWARD_RATE = 420; // 4.20% APY
    uint256 public constant SECONDS_PER_YEAR = 365 days;

    struct Stake {
        address user;
        uint256 amount;
        uint256 startTime;
        uint256 duration;
        uint256 rewardDebt;
        bool isActive;
        bytes32 uuid; // Unique identifier for the stake
    }

    mapping(address => Stake[]) private userStakes;
    mapping(bytes32 => bool) private uuidExists; // Track used UUIDs
    uint256 private totalStaked;

    event Staked(address indexed user, uint256 amount, uint256 duration, uint256 startTime, bytes32 indexed uuid);
    event Unstaked(address indexed user, uint256 amount, uint256 reward, bytes32 indexed uuid);
    event RewardClaimed(address indexed user, uint256 reward, bytes32 indexed uuid);
    event StakeReset(address indexed user, bytes32 indexed uuid);

    function initialize(address _weedlToken) public initializer {
        require(_weedlToken != address(0), "Invalid token address");
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
        __Pausable_init();
        weedlToken = IERC20(_weedlToken);
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}

    // Generate a UUID based on user, amount, and timestamp
    function generateUUID(address user, uint256 amount, uint256 timestamp) private view returns (bytes32) {
        return keccak256(abi.encodePacked(user, amount, timestamp, block.number));
    }

    function stake(uint256 _amount, uint256 _duration) external nonReentrant whenNotPaused {
        require(_amount > 0, "Amount must be greater than 0");
        require(_duration > 0, "Duration must be greater than 0");

        weedlToken.safeTransferFrom(msg.sender, address(this), _amount);

        bytes32 uuid = generateUUID(msg.sender, _amount, block.timestamp);
        require(!uuidExists[uuid], "UUID collision detected");

        userStakes[msg.sender].push(Stake({
            user: msg.sender,
            amount: _amount,
            startTime: block.timestamp,
            duration: _duration,
            rewardDebt: 0,
            isActive: true,
            uuid: uuid
        }));
        uuidExists[uuid] = true;
        totalStaked += _amount;

        emit Staked(msg.sender, _amount, _duration, block.timestamp, uuid);
    }

    function unstake(uint256 _amount, bytes32 _uuid) external nonReentrant whenNotPaused {
        require(_amount > 0, "Amount must be greater than 0");
        Stake[] storage userStakeArray = userStakes[msg.sender];
        uint256 stakeIndex = findStakeIndexByUUID(msg.sender, _uuid);
        require(stakeIndex < userStakeArray.length, "Invalid stake UUID");
        Stake storage userStake = userStakeArray[stakeIndex];
        require(userStake.isActive && userStake.amount >= _amount, "Insufficient or inactive stake");
        require(block.timestamp >= userStake.startTime + userStake.duration, "Stake is still locked");

        uint256 reward = calculateReward(userStake.amount, userStake.duration, userStake.startTime);
        if (_amount < userStake.amount) {
            userStake.amount -= _amount;
            totalStaked -= _amount;
        } else {
            userStake.isActive = false;
            userStake.amount = 0;
            totalStaked -= _amount;
            delete uuidExists[_uuid];
        }

        weedlToken.safeTransfer(msg.sender, _amount + reward);
        emit Unstaked(msg.sender, _amount, reward, _uuid);
    }

    function claimReward(bytes32 _uuid) external nonReentrant whenNotPaused {
        Stake[] storage userStakeArray = userStakes[msg.sender];
        uint256 stakeIndex = findStakeIndexByUUID(msg.sender, _uuid);
        require(stakeIndex < userStakeArray.length, "Invalid stake UUID");
        Stake storage userStake = userStakeArray[stakeIndex];
        require(userStake.isActive && userStake.amount > 0, "No active stake");
        require(block.timestamp >= userStake.startTime + userStake.duration, "Stake is still locked");

        uint256 reward = calculateReward(userStake.amount, userStake.duration, userStake.startTime);
        require(reward > userStake.rewardDebt, "No rewards available");

        uint256 rewardToTransfer = reward - userStake.rewardDebt;
        userStake.rewardDebt = reward;
        weedlToken.safeTransfer(msg.sender, rewardToTransfer);
        emit RewardClaimed(msg.sender, rewardToTransfer, _uuid);
    }

    function getUserStakes(address _user) external view returns (Stake[] memory) {
        return userStakes[_user];
    }

    function calculateReward(uint256 _amount, uint256 _duration, uint256 _startTime) private view returns (uint256) {
        uint256 timeElapsed = block.timestamp > _startTime + _duration ? _duration : block.timestamp - _startTime;
        return (_amount * timeElapsed * REWARD_RATE) / (10000 * SECONDS_PER_YEAR);
    }

    function getTotalStaked() external view returns (uint256) {
        return totalStaked;
    }

    function stakes(address _user, uint256 _index) external view returns (Stake memory) {
        require(_index < userStakes[_user].length, "Invalid stake index");
        return userStakes[_user][_index];
    }

    function resetStake(address _user, bytes32 _uuid) external onlyOwner {
        require(_user != address(0), "Invalid user address");
        uint256 stakeIndex = findStakeIndexByUUID(_user, _uuid);
        Stake[] storage userStakeArray = userStakes[_user];
        require(stakeIndex < userStakeArray.length, "Invalid stake UUID");
        totalStaked -= userStakeArray[stakeIndex].amount;
        delete uuidExists[_uuid];
        delete userStakeArray[stakeIndex];
        emit StakeReset(_user, _uuid);
    }

    function findStakeIndexByUUID(address _user, bytes32 _uuid) private view returns (uint256) {
        Stake[] storage userStakeArray = userStakes[_user];
        for (uint256 i = 0; i < userStakeArray.length; i++) {
            if (userStakeArray[i].uuid == _uuid) {
                return i;
            }
        }
        revert("Stake UUID not found");
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }
}