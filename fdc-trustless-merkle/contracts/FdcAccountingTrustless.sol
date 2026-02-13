// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {EthereumUtils} from "@oasisprotocol/sapphire-contracts/contracts/EthereumUtils.sol";
import {EIP155Signer} from "@oasisprotocol/sapphire-contracts/contracts/EIP155Signer.sol";

/**
 * @title FdcAccountingTrustless
 * @notice Verifies FDC Merkle proofs on Sapphire and credits private deposit balances.
 *         Generates an encumbered wallet keypair for deposits and signs withdrawal txs.
 *
 * The relayer syncs Merkle roots from Coston2's Relay contract. Proofs are verified
 * entirely on-chain — the relayer cannot forge deposits, only relay roots.
 */
contract FdcAccountingTrustless {
    // ═══════════════════════════════════════════════════════════════════════
    // Types — match FdcVerification's EVMTransaction structs exactly
    // ═══════════════════════════════════════════════════════════════════════

    struct Event {
        uint32 logIndex;
        address emitterAddress;
        bytes32[] topics;
        bytes data;
        bool removed;
    }

    struct RequestBody {
        bytes32 transactionHash;
        uint16 requiredConfirmations;
        bool provideInput;
        bool listEvents;
        uint32[] logIndices;
    }

    struct ResponseBody {
        uint64 blockNumber;
        uint64 timestamp;
        address sourceAddress;
        bool isDeployment;
        address receivingAddress;
        uint256 value;
        bytes input;
        uint8 status;
        Event[] events;
    }

    struct Response {
        bytes32 attestationType;
        bytes32 sourceId;
        uint64 votingRound;
        uint64 lowestUsedTimestamp;
        RequestBody requestBody;
        ResponseBody responseBody;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // State
    // ═══════════════════════════════════════════════════════════════════════

    address public immutable rootRelayer;
    uint256 public immutable withdrawalChainId;

    /// @notice Encumbered wallet — generated inside the TEE at deploy time
    address public encumberedWalletAddr;
    bytes32 private encumberedWalletKey;
    uint256 public encumberedWalletNonce;

    /// @notice Merkle roots per voting round (write-once)
    mapping(uint64 => bytes32) public roots;

    /// @notice Private balances (Sapphire confidential storage)
    mapping(address => uint256) private balances;

    /// @notice Replay protection — processed tx hashes
    mapping(bytes32 => bool) public processed;

    // ═══════════════════════════════════════════════════════════════════════
    // Events
    // ═══════════════════════════════════════════════════════════════════════

    event RootSynced(uint64 indexed votingRound, bytes32 merkleRoot);
    event DepositCredited(address indexed sourceAddress, uint256 value, bytes32 txHash);
    event WithdrawalSigned(address indexed user, address indexed to, uint256 amount, bytes signedTx);

    // ═══════════════════════════════════════════════════════════════════════
    // Constructor
    // ═══════════════════════════════════════════════════════════════════════

    constructor(address _rootRelayer, uint256 _withdrawalChainId) {
        require(_rootRelayer != address(0), "Zero relayer");
        require(_withdrawalChainId != 0, "Zero chain ID");
        rootRelayer = _rootRelayer;
        withdrawalChainId = _withdrawalChainId;
        (encumberedWalletAddr, encumberedWalletKey) = EthereumUtils.generateKeypair();
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Root sync — authorized write-once
    // ═══════════════════════════════════════════════════════════════════════

    function syncRoot(uint64 votingRound, bytes32 merkleRoot) external {
        require(msg.sender == rootRelayer, "Unauthorized");
        require(roots[votingRound] == bytes32(0), "Root already set");
        require(merkleRoot != bytes32(0), "Zero root");
        roots[votingRound] = merkleRoot;
        emit RootSynced(votingRound, merkleRoot);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Verify and credit
    // ═══════════════════════════════════════════════════════════════════════

    function verifyAndCredit(
        bytes32[] calldata merkleProof,
        Response calldata response
    ) external {
        bytes32 txHash = response.requestBody.transactionHash;

        // Replay protection
        require(!processed[txHash], "Already processed");

        // Deposit validation
        require(response.responseBody.status == 1, "Tx not successful");
        require(response.responseBody.receivingAddress == encumberedWalletAddr, "Wrong receiver");
        require(response.responseBody.value > 0, "Zero value");

        // Merkle verification
        bytes32 root = roots[response.votingRound];
        require(root != bytes32(0), "Root not synced for this round");

        bytes32 leaf = keccak256(abi.encode(response));
        require(_verifyMerkleProof(merkleProof, root, leaf), "Invalid Merkle proof");

        // Credit balance
        processed[txHash] = true;
        balances[response.responseBody.sourceAddress] += response.responseBody.value;

        emit DepositCredited(
            response.responseBody.sourceAddress,
            response.responseBody.value,
            txHash
        );
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Balance query (private — msg.sender only)
    // ═══════════════════════════════════════════════════════════════════════

    function getBalance() external view returns (uint256) {
        return balances[msg.sender];
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Deposit address query
    // ═══════════════════════════════════════════════════════════════════════

    function getDepositAddress() external view returns (address) {
        return encumberedWalletAddr;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Withdrawal — sign an EIP-155 tx from the encumbered wallet
    // ═══════════════════════════════════════════════════════════════════════

    function withdraw(
        address to,
        uint256 amount,
        uint256 gasPrice,
        uint64 gasLimit
    ) external returns (bytes memory) {
        require(amount > 0, "Zero amount");
        require(balances[msg.sender] >= amount, "Insufficient balance");
        require(to != address(0), "Zero recipient");

        balances[msg.sender] -= amount;

        EIP155Signer.EthTx memory ethTx = EIP155Signer.EthTx({
            nonce: uint64(encumberedWalletNonce),
            gasPrice: gasPrice,
            gasLimit: gasLimit,
            to: to,
            value: amount,
            data: "",
            chainId: withdrawalChainId
        });

        bytes memory signedTx = EIP155Signer.sign(
            encumberedWalletAddr,
            encumberedWalletKey,
            ethTx
        );

        encumberedWalletNonce++;

        emit WithdrawalSigned(msg.sender, to, amount, signedTx);

        return signedTx;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Internal — sorted-pair Merkle proof (OpenZeppelin convention)
    // ═══════════════════════════════════════════════════════════════════════

    function _verifyMerkleProof(
        bytes32[] calldata proof,
        bytes32 root,
        bytes32 leaf
    ) internal pure returns (bool) {
        bytes32 computedHash = leaf;
        for (uint256 i = 0; i < proof.length; i++) {
            bytes32 sibling = proof[i];
            if (computedHash <= sibling) {
                computedHash = keccak256(abi.encodePacked(computedHash, sibling));
            } else {
                computedHash = keccak256(abi.encodePacked(sibling, computedHash));
            }
        }
        return computedHash == root;
    }
}
