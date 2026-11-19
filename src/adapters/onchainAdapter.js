/**
 * ShinPoW On-Chain Adapter (Base Sepolia / Base Mainnet)
 * ---------------------------------------------------------------------------
 * 외부 무거운 SDK 없이 순수 EIP-1193(window.ethereum) + 표준 ABI 인코딩으로
 * ShinPoWAnchor.sol 컨트랙트에 블록 해시 또는 머클 루트를 영구 기록합니다.
 */

import { sha256, computeMerkleRoot } from '../core/crypto.js';

// Keccak-256 4-byte selectors verified for contracts/ShinPoWAnchor.sol
export const SELECTOR_ANCHOR_BLOCK = '0x7a7c0266'; // anchorBlock(bytes32,uint256,bytes32,bytes32,int16)
export const SELECTOR_ANCHOR_BATCH = '0x37a45902'; // anchorBatchRoot(bytes32,uint256,uint256,bytes32)

function padUint256(value) {
  const n = BigInt(value);
  if (n < 0n) throw new Error('음수는 ABI uint256으로 인코딩할 수 없습니다.');
  return n.toString(16).padStart(64, '0');
}

function padInt256(value) {
  const n = BigInt(value);
  const twos = n >= 0n ? n : (1n << 256n) + n;
  return twos.toString(16).padStart(64, '0');
}

function normalizeBytes32(hex) {
  const clean = String(hex || '').replace(/^0x/i, '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(clean)) {
    throw new Error(`올바른 32바이트 hex 값이 아닙니다: ${hex}`);
  }
  return clean;
}

export async function encodeAnchorBlockCalldata(block) {
  const chainIdHash = await sha256(block.chainId);
  return (
    SELECTOR_ANCHOR_BLOCK +
    normalizeBytes32(chainIdHash) +
    padUint256(block.index) +
    normalizeBytes32(block.hash) +
    normalizeBytes32(block.payloadHash) +
    padInt256(block.reward?.amount ?? 0)
  );
}

export async function encodeAnchorBatchCalldata({ chainId, fromIndex, toIndex, merkleRoot }) {
  const chainIdHash = await sha256(chainId);
  return (
    SELECTOR_ANCHOR_BATCH +
    normalizeBytes32(chainIdHash) +
    padUint256(fromIndex) +
    padUint256(toIndex) +
    normalizeBytes32(merkleRoot)
  );
}

export function getExplorerTxUrl(onchainConfig, txHash, networkOverride = null) {
  const netKey = networkOverride || onchainConfig.network;
  const net = onchainConfig.networks?.[netKey];
  if (!net || !txHash) return null;
  return `${net.explorerUrl}/tx/${txHash}`;
}

async function ensureWalletOnBaseNetwork(ethereum, netInfo) {
  const currentChainId = await ethereum.request({ method: 'eth_chainId' });
  if (String(currentChainId).toLowerCase() === netInfo.chainIdHex.toLowerCase()) {
    return;
  }
  try {
    await ethereum.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: netInfo.chainIdHex }]
    });
  } catch (err) {
    if (err && err.code === 4902) {
      await ethereum.request({
        method: 'wallet_addEthereumChain',
        params: [
          {
            chainId: netInfo.chainIdHex,
            chainName: netInfo.name,
            nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
            rpcUrls: [netInfo.rpcUrl],
            blockExplorerUrls: [netInfo.explorerUrl]
          }
        ]
      });
    } else {
      throw err;
    }
  }
}

/**
 * 개별 블록을 Base Sepolia / Base Mainnet에 앵커링
 */
export async function anchorSingleBlockOnchain({ block, onchainConfig }) {
  if (!onchainConfig.enabled || !onchainConfig.contractAddress) {
    throw new Error('config.js에서 onchain.enabled=true 및 contractAddress를 먼저 설정해 주세요.');
  }
  const ethereum = globalThis.window?.ethereum;
  if (!ethereum) {
    throw new Error('브라우저 지갑(MetaMask / Coinbase Wallet 등)이 감지되지 않았습니다.');
  }

  const netInfo = onchainConfig.networks[onchainConfig.network];
  if (!netInfo) {
    throw new Error(`알 수 없는 네트워크 설정: ${onchainConfig.network}`);
  }

  const [from] = await ethereum.request({ method: 'eth_requestAccounts' });
  await ensureWalletOnBaseNetwork(ethereum, netInfo);

  const data = await encodeAnchorBlockCalldata(block);
  const txHash = await ethereum.request({
    method: 'eth_sendTransaction',
    params: [
      {
        from,
        to: onchainConfig.contractAddress,
        data
      }
    ]
  });

  return {
    mode: 'single',
    network: onchainConfig.network,
    contractAddress: onchainConfig.contractAddress,
    txHash,
    explorerUrl: getExplorerTxUrl(onchainConfig, txHash),
    anchoredAt: new Date().toISOString()
  };
}

/**
 * 미앵커링 블록들을 머클 루트 1건으로 묶어 Base에 초저비용 배치 앵커링
 */
export async function anchorBatchOnchain({ chainId, blocks, onchainConfig }) {
  if (!Array.isArray(blocks) || blocks.length === 0) {
    throw new Error('앵커링할 블록이 없습니다.');
  }
  if (!onchainConfig.enabled || !onchainConfig.contractAddress) {
    throw new Error('config.js에서 onchain.enabled=true 및 contractAddress를 먼저 설정해 주세요.');
  }
  const ethereum = globalThis.window?.ethereum;
  if (!ethereum) {
    throw new Error('브라우저 지갑(MetaMask / Coinbase Wallet 등)이 감지되지 않았습니다.');
  }

  const netInfo = onchainConfig.networks[onchainConfig.network];
  const [from] = await ethereum.request({ method: 'eth_requestAccounts' });
  await ensureWalletOnBaseNetwork(ethereum, netInfo);

  const sorted = [...blocks].sort((a, b) => a.index - b.index);
  const fromIndex = sorted[0].index;
  const toIndex = sorted[sorted.length - 1].index;
  const merkleRoot = await computeMerkleRoot(sorted.map((b) => b.hash));

  const data = await encodeAnchorBatchCalldata({ chainId, fromIndex, toIndex, merkleRoot });
  const txHash = await ethereum.request({
    method: 'eth_sendTransaction',
    params: [
      {
        from,
        to: onchainConfig.contractAddress,
        data
      }
    ]
  });

  return {
    mode: 'batch',
    network: onchainConfig.network,
    contractAddress: onchainConfig.contractAddress,
    fromIndex,
    toIndex,
    merkleRoot,
    txHash,
    explorerUrl: getExplorerTxUrl(onchainConfig, txHash),
    anchoredAt: new Date().toISOString()
  };
}

