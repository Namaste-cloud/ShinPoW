/**
 * ShinPoW Cloud Sync + Base L2 Auto-Anchoring Relayer (Cloudflare Worker)
 * ---------------------------------------------------------------------------
 * 1. 멀티 기기 실시간 원장 동기화 (Cloudflare KV, Longest Valid Chain 병합)
 * 2. Protocol v1 암호학 검증 통과 블록만 수락 (위변조/어뷰징 차단)
 * 3. 미앵커링 블록을 Base Sepolia / Base Mainnet ShinPoWAnchor.sol에 자동 기록
 */

import { Wallet, JsonRpcProvider, Contract } from 'ethers';

const PROTOCOL_MAGIC = 'SHINPOW';
const PROTOCOL_VERSION = 1;
const GENESIS_PREV_HASH = '0'.repeat(64);
const KV_KEY = 'shinpow_official_ledger_v1';

const ANCHOR_ABI = [
  'function anchorBlock(bytes32 chainIdHash, uint256 blockIndex, bytes32 blockHash, bytes32 payloadHash, int16 rewardDelta) external',
  'function anchoredBlocks(bytes32 chainIdHash, uint256 blockIndex) view returns (bytes32 blockHash, bytes32 payloadHash, int16 rewardDelta, uint64 anchoredAt)'
];

function corsHeaders(request) {
  const origin = request.headers.get('Origin') || '*';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Parent-Pin',
    'Access-Control-Max-Age': '86400'
  };
}

function jsonResponse(data, request, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...corsHeaders(request)
    }
  });
}

async function sha256(text) {
  const buf = new TextEncoder().encode(String(text));
  const hashBuffer = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function canonicalStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map((i) => canonicalStringify(i)).join(',') + ']';
  const keys = Object.keys(value)
    .filter((k) => value[k] !== undefined)
    .sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalStringify(value[k])).join(',') + '}';
}

function buildHeaderPreimage(block) {
  return [
    PROTOCOL_MAGIC,
    `v${block.version}`,
    block.chainId,
    String(block.index),
    block.prevHash,
    block.timestamp,
    block.module,
    block.tier,
    String(block.reward.amount),
    block.reward.unit,
    block.payloadHash,
    block.difficulty,
    String(block.nonce)
  ].join('|');
}

async function verifyChain(chain, expectedChainId) {
  if (!Array.isArray(chain) || chain.length === 0) return false;
  for (let i = 0; i < chain.length; i++) {
    const b = chain[i];
    if (!b || b.version !== PROTOCOL_VERSION || b.index !== i) return false;
    if (expectedChainId && b.chainId !== expectedChainId) return false;
    if (i === 0) {
      if (b.prevHash !== GENESIS_PREV_HASH || b.module !== 'genesis' || b.tier !== 'GENESIS') return false;
    } else {
      if (b.prevHash !== chain[i - 1].hash) return false;
      if (!b.difficulty || !b.hash.startsWith(b.difficulty)) return false;
    }
    const pHash = await sha256(canonicalStringify(b.payload));
    if (pHash !== b.payloadHash) return false;
    const h = await sha256(buildHeaderPreimage(b));
    if (h !== b.hash) return false;
  }
  return true;
}

function mergeSolvedMaps(a = {}, b = {}) {
  const out = { jihoon: {}, leehyun: {} };
  for (const sid of ['jihoon', 'leehyun']) {
    const keys = new Set([...Object.keys(a[sid] || {}), ...Object.keys(b[sid] || {})]);
    for (const dayId of keys) {
      out[sid][dayId] = {
        basic: Boolean(a[sid]?.[dayId]?.basic || b[sid]?.[dayId]?.basic),
        adv: Boolean(a[sid]?.[dayId]?.adv || b[sid]?.[dayId]?.adv)
      };
    }
  }
  return out;
}

async function anchorUnanchoredBlocks(chains, env) {
  const newlyAnchored = [];
  if (!env.RELAYER_PRIVATE_KEY || !env.CONTRACT_ADDRESS) {
    return newlyAnchored;
  }

  const rpcUrl = env.BASE_RPC_URL || 'https://base-sepolia-rpc.publicnode.com';
  const chainIdNum = Number(env.BASE_CHAIN_ID || 84532);
  const networkName = env.BASE_NETWORK || 'base-sepolia';
  const explorerBase =
    networkName === 'base-mainnet' ? 'https://basescan.org' : 'https://sepolia.basescan.org';

  const provider = new JsonRpcProvider(rpcUrl, chainIdNum, { staticNetwork: true });
  const wallet = new Wallet(env.RELAYER_PRIVATE_KEY, provider);
  const contract = new Contract(env.CONTRACT_ADDRESS, ANCHOR_ABI, wallet);

  for (const sid of ['jihoon', 'leehyun']) {
    const chain = chains[sid] || [];
    for (const block of chain) {
      if (block.index === 0 || (block.onchain && block.onchain.txHash)) continue;
      try {
        const chainIdHash = '0x' + (await sha256(block.chainId));
        const existing = await contract.anchoredBlocks(chainIdHash, BigInt(block.index));
        if (existing && existing.anchoredAt && Number(existing.anchoredAt) > 0) {
          block.onchain = {
            provider: 'base',
            mode: 'single',
            network: networkName,
            contractAddress: env.CONTRACT_ADDRESS,
            txHash: null,
            alreadyOnchain: true,
            explorerUrl: `${explorerBase}/address/${env.CONTRACT_ADDRESS}`,
            anchoredAt: new Date(Number(existing.anchoredAt) * 1000).toISOString()
          };
          continue;
        }

        const tx = await contract.anchorBlock(
          chainIdHash,
          BigInt(block.index),
          '0x' + block.hash,
          '0x' + block.payloadHash,
          Number(block.reward?.amount || 0)
        );
        // tx.hash is available immediately; wait 1 confirmation quickly (Base block time ~2s)
        await tx.wait(1);
        block.onchain = {
          provider: 'base',
          mode: 'single',
          network: networkName,
          contractAddress: env.CONTRACT_ADDRESS,
          txHash: tx.hash,
          explorerUrl: `${explorerBase}/tx/${tx.hash}`,
          anchoredAt: new Date().toISOString()
        };
        newlyAnchored.push({ studentId: sid, index: block.index, txHash: tx.hash });
      } catch (err) {
        // Non-fatal: keep block safely in KV even if RPC momentarily hiccups
        console.error(`Anchor failed for ${sid}#${block.index}:`, err?.shortMessage || err?.message);
      }
    }
  }
  return newlyAnchored;
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }

    const url = new URL(request.url);

    if (url.pathname === '/api/health' && request.method === 'GET') {
      return jsonResponse(
        {
          ok: true,
          network: env.BASE_NETWORK || 'base-sepolia',
          contractAddress: env.CONTRACT_ADDRESS || '',
          relayerConfigured: Boolean(env.RELAYER_PRIVATE_KEY)
        },
        request
      );
    }

    if (url.pathname === '/api/ledger' && request.method === 'GET') {
      const raw = await env.SHINPOW_KV.get(KV_KEY);
      if (!raw) {
        return jsonResponse({ ok: true, empty: true, chains: null, solved: null }, request);
      }
      return jsonResponse({ ok: true, empty: false, ...JSON.parse(raw) }, request);
    }

    if (url.pathname === '/api/sync' && request.method === 'POST') {
      try {
        const body = await request.json();
        const incomingChains = body.chains || {};
        const incomingSolved = body.solved || {};

        const existingRaw = await env.SHINPOW_KV.get(KV_KEY);
        const existing = existingRaw ? JSON.parse(existingRaw) : { chains: {}, solved: {} };
        const mergedChains = { ...(existing.chains || {}) };

        for (const [sid, expectedChainId] of [
          ['jihoon', 'shinpow:jihoon'],
          ['leehyun', 'shinpow:leehyun']
        ]) {
          const clientChain = incomingChains[sid];
          const serverChain = mergedChains[sid];

          if (Array.isArray(clientChain) && clientChain.length > 0) {
            const valid = await verifyChain(clientChain, expectedChainId);
            if (!valid) {
              return jsonResponse({ ok: false, error: `${sid} 체인 무결성 검증 실패` }, request, 400);
            }
            if (!Array.isArray(serverChain) || clientChain.length > serverChain.length) {
              // Preserve existing onchain metadata from server for shared prefix blocks
              if (Array.isArray(serverChain)) {
                for (let i = 0; i < serverChain.length; i++) {
                  if (serverChain[i].hash === clientChain[i]?.hash && serverChain[i].onchain && !clientChain[i].onchain) {
                    clientChain[i].onchain = serverChain[i].onchain;
                  }
                }
              }
              mergedChains[sid] = clientChain;
            }
          }
        }

        const mergedSolved = mergeSolvedMaps(existing.solved, incomingSolved);
        const newlyAnchored = await anchorUnanchoredBlocks(mergedChains, env);

        const record = {
          chains: mergedChains,
          solved: mergedSolved,
          updatedAt: new Date().toISOString()
        };
        await env.SHINPOW_KV.put(KV_KEY, JSON.stringify(record));

        return jsonResponse({ ok: true, ...record, newlyAnchored }, request);
      } catch (err) {
        return jsonResponse({ ok: false, error: err?.message || '동기화 오류' }, request, 500);
      }
    }

    if (url.pathname === '/api/reset' && request.method === 'POST') {
      const pin = request.headers.get('X-Parent-Pin') || '';
      const expectedPin = env.PARENT_PIN || '2026';
      if (pin !== expectedPin) {
        return jsonResponse({ ok: false, error: 'PIN 불일치' }, request, 403);
      }
      await env.SHINPOW_KV.delete(KV_KEY);
      return jsonResponse({ ok: true, reset: true }, request);
    }

    return jsonResponse({ ok: false, error: 'Not Found' }, request, 404);
  }
};

