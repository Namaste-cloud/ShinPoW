// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title ShinPoWAnchor
 * @notice Base Sepolia / Base Mainnet용 초경량 학습·활동 블록 해시 앵커링 컨트랙트.
 *
 * 설계 원칙:
 * 1. 가스 최소화: 모든 인자를 고정 32바이트 워드(bytes32/uint256/int16)로 설계하여
 *    Base Mainnet에서 1회 앵커링 비용을 약 1~3원 수준으로 유지합니다.
 * 2. 음수 TIME 지원(int16): 학습 채굴(+TIME)뿐 아니라 게임·자유시간 사용(-TIME) 및
 *    활동/추억(0 TIME) 블록까지 모두 온체인 기록 가능합니다.
 * 3. 장기 소유권 이전: transferOwnership()으로 아이들이 성장한 뒤 본인 지갑으로
 *    컨트랙트 소유권을 그대로 인계받을 수 있습니다.
 */
contract ShinPoWAnchor {
    address public owner;
    address public relayer;

    struct AnchorRecord {
        bytes32 blockHash;
        bytes32 payloadHash;
        int16 rewardDelta;
        uint64 anchoredAt;
    }

    // chainIdHash => blockIndex => AnchorRecord
    mapping(bytes32 => mapping(uint256 => AnchorRecord)) public anchoredBlocks;
    // chainIdHash => latest anchored block index
    mapping(bytes32 => uint256) public latestAnchoredIndex;
    // chainIdHash => batch count => merkleRoot
    mapping(bytes32 => mapping(uint256 => bytes32)) public batchRoots;
    mapping(bytes32 => uint256) public batchCount;

    event BlockAnchored(
        bytes32 indexed chainIdHash,
        uint256 indexed blockIndex,
        bytes32 blockHash,
        bytes32 payloadHash,
        int16 rewardDelta,
        uint64 anchoredAt
    );

    event BatchAnchored(
        bytes32 indexed chainIdHash,
        uint256 indexed batchId,
        uint256 fromIndex,
        uint256 toIndex,
        bytes32 merkleRoot,
        uint64 anchoredAt
    );

    event RelayerUpdated(address indexed previousRelayer, address indexed newRelayer);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    error Unauthorized();
    error InvalidAddress();
    error AlreadyAnchored();
    error InvalidRange();

    modifier onlyAuthorized() {
        if (msg.sender != owner && msg.sender != relayer) revert Unauthorized();
        _;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    constructor() {
        owner = msg.sender;
        relayer = msg.sender;
    }

    /**
     * @notice 개별 ShinPoW 블록 해시를 온체인에 영구 기록합니다.
     * @dev Selector: 0xda968797
     */
    function anchorBlock(
        bytes32 chainIdHash,
        uint256 blockIndex,
        bytes32 blockHash,
        bytes32 payloadHash,
        int16 rewardDelta
    ) external onlyAuthorized {
        if (anchoredBlocks[chainIdHash][blockIndex].anchoredAt != 0) {
            revert AlreadyAnchored();
        }

        uint64 ts = uint64(block.timestamp);
        anchoredBlocks[chainIdHash][blockIndex] = AnchorRecord({
            blockHash: blockHash,
            payloadHash: payloadHash,
            rewardDelta: rewardDelta,
            anchoredAt: ts
        });

        if (blockIndex > latestAnchoredIndex[chainIdHash]) {
            latestAnchoredIndex[chainIdHash] = blockIndex;
        }

        emit BlockAnchored(chainIdHash, blockIndex, blockHash, payloadHash, rewardDelta, ts);
    }

    /**
     * @notice 여러 블록의 머클 루트를 한 번의 트랜잭션으로 영구 기록합니다.
     * @dev Selector: 0x37a45902
     */
    function anchorBatchRoot(
        bytes32 chainIdHash,
        uint256 fromIndex,
        uint256 toIndex,
        bytes32 merkleRoot
    ) external onlyAuthorized {
        if (toIndex < fromIndex) revert InvalidRange();

        uint256 id = batchCount[chainIdHash] + 1;
        batchCount[chainIdHash] = id;
        batchRoots[chainIdHash][id] = merkleRoot;

        if (toIndex > latestAnchoredIndex[chainIdHash]) {
            latestAnchoredIndex[chainIdHash] = toIndex;
        }

        emit BatchAnchored(chainIdHash, id, fromIndex, toIndex, merkleRoot, uint64(block.timestamp));
    }

    function setRelayer(address newRelayer) external onlyOwner {
        if (newRelayer == address(0)) revert InvalidAddress();
        emit RelayerUpdated(relayer, newRelayer);
        relayer = newRelayer;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert InvalidAddress();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }
}
