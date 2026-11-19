/**
 * ShinPoW Protocol v1 — Immutable Chain Core
 * ---------------------------------------------------------------------------
 * [불변 레이어] 공식 제네시스 블록이 생성된 이후에는 이 파일의 해시 계산 규칙과
 * 블록 헤더 구조를 변경하지 마세요.
 *
 * 새로운 학습 활동(코딩, 영어, 독서 등)은 `module` 이름과 `payload` 객체만
 * 추가하면 동일한 블록체인 허브에 영구 기록할 수 있습니다.
 */

import { sha256, hashCanonical, computeMerkleRoot } from './crypto.js';

export const PROTOCOL_MAGIC = 'SHINPOW';
export const PROTOCOL_VERSION = 1;
export const GENESIS_PREV_HASH = '0'.repeat(64);

/**
 * 로컬 타임존 오프셋 포함 ISO-8601 타임스탬프 생성 (예: 2026-11-19T09:35:00+09:00)
 */
export function formatLocalIsoTimestamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  const tzOffsetMin = -date.getTimezoneOffset();
  const sign = tzOffsetMin >= 0 ? '+' : '-';
  const absMin = Math.abs(tzOffsetMin);
  const tzH = pad(Math.floor(absMin / 60));
  const tzM = pad(absMin % 60);
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `${sign}${tzH}:${tzM}`
  );
}

/**
 * Protocol v1 표준 헤더 프리이미지 (해시 입력 문자열)
 * onchain 메타데이터는 채굴 후 기록되므로 해시 대상에서 제외됩니다.
 */
export function buildHeaderPreimage(block) {
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

export async function computeBlockHash(block) {
  return sha256(buildHeaderPreimage(block));
}

/**
 * 제네시스 블록 생성 (결정론적)
 */
export async function createGenesisBlock({
  chainId,
  studentId,
  studentName,
  rewardUnit = 'TIME',
  timestamp = '2026-11-19T00:00:00+09:00',
  note = 'ShinPoW Hub Genesis Block',
  networkMode = 'preview'
}) {
  const payload = {
    label: '제네시스 블록',
    studentId,
    studentName,
    networkMode,
    note
  };
  const payloadHash = await hashCanonical(payload);
  const block = {
    version: PROTOCOL_VERSION,
    chainId,
    index: 0,
    prevHash: GENESIS_PREV_HASH,
    timestamp,
    module: 'genesis',
    tier: 'GENESIS',
    reward: { amount: 0, unit: rewardUnit },
    payload,
    payloadHash,
    difficulty: 'GENESIS',
    nonce: 0,
    hash: '',
    onchain: null
  };
  block.hash = await computeBlockHash(block);
  return block;
}

/**
 * 실제 PoW Nonce 탐색 채굴
 * @param {object} params
 * @param {object} params.prevBlock - 직전 블록
 * @param {string} params.chainId
 * @param {string} params.module - 모듈명 (예: 'math', 'coding')
 * @param {string} params.tier - 등급 코드 (예: 'CORE', 'BOOST', 'MASTER')
 * @param {{ amount: number, unit: string }} params.reward
 * @param {object} params.payload - 모듈별 상세 페이로드
 * @param {string} [params.difficulty='00']
 * @param {string} [params.timestamp]
 * @param {number} [params.minVisualMs=0] - UI 시각화 최소 시간(ms), 테스트 시 0
 * @param {function} [params.onProgress] - ({ nonce, hash }) => void
 * @param {number} [params.maxNonce=200000]
 */
export async function mineBlock({
  prevBlock,
  chainId,
  module,
  tier,
  reward,
  payload,
  difficulty = '00',
  timestamp = formatLocalIsoTimestamp(),
  minVisualMs = 0,
  onProgress = null,
  maxNonce = 200000
}) {
  if (!prevBlock || !prevBlock.hash) {
    throw new Error('유효한 이전 블록이 필요합니다.');
  }
  const payloadHash = await hashCanonical(payload);
  const startTime = typeof performance !== 'undefined' ? performance.now() : Date.now();

  const candidate = {
    version: PROTOCOL_VERSION,
    chainId,
    index: prevBlock.index + 1,
    prevHash: prevBlock.hash,
    timestamp,
    module,
    tier,
    reward: { amount: Number(reward.amount), unit: String(reward.unit) },
    payload,
    payloadHash,
    difficulty,
    nonce: 0,
    hash: '',
    onchain: null
  };

  for (let nonce = 0; nonce <= maxNonce; nonce++) {
    candidate.nonce = nonce;
    const h = await computeBlockHash(candidate);
    const matchesTarget = h.startsWith(difficulty);
    const elapsed = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - startTime;

    if (onProgress && (nonce % 7 === 0 || matchesTarget)) {
      onProgress({ nonce, hash: h });
      if (minVisualMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, 16));
      }
    }

    if (matchesTarget && elapsed >= minVisualMs) {
      candidate.hash = h;
      if (onProgress) onProgress({ nonce, hash: h });
      return candidate;
    }
  }

  throw new Error(`Nonce 한계(${maxNonce}) 내에서 타깃(${difficulty})을 찾지 못했습니다.`);
}

/**
 * 전체 체인 암호학적 무결성 검증
 */
export async function verifyChain(chain, expectedChainId = null) {
  if (!Array.isArray(chain) || chain.length === 0) {
    return { valid: false, failIndex: 0, reason: '체인이 비어 있습니다.' };
  }

  for (let i = 0; i < chain.length; i++) {
    const block = chain[i];
    if (!block || typeof block !== 'object') {
      return { valid: false, failIndex: i, reason: `Block #${i} 형식이 올바르지 않습니다.` };
    }
    if (block.version !== PROTOCOL_VERSION) {
      return { valid: false, failIndex: i, reason: `Block #${i} 프로토콜 버전 불일치 (v${block.version})` };
    }
    if (block.index !== i) {
      return { valid: false, failIndex: i, reason: `Block #${i} 인덱스 불일치 (${block.index})` };
    }
    if (expectedChainId && block.chainId !== expectedChainId) {
      return { valid: false, failIndex: i, reason: `Block #${i} 체인 ID 불일치 (${block.chainId})` };
    }

    if (i === 0) {
      if (block.prevHash !== GENESIS_PREV_HASH || block.module !== 'genesis' || block.tier !== 'GENESIS') {
        return { valid: false, failIndex: 0, reason: '제네시스 블록(#0) 헤더 규칙 위반' };
      }
    } else {
      if (block.prevHash !== chain[i - 1].hash) {
        return { valid: false, failIndex: i, reason: `Block #${i}의 prevHash가 이전 블록(#${i - 1}) 해시와 연결되지 않습니다.` };
      }
      if (!block.difficulty || !block.hash.startsWith(block.difficulty)) {
        return { valid: false, failIndex: i, reason: `Block #${i}가 PoW 난이도(${block.difficulty})를 충족하지 못합니다.` };
      }
    }

    const recomputedPayloadHash = await hashCanonical(block.payload);
    if (recomputedPayloadHash !== block.payloadHash) {
      return { valid: false, failIndex: i, reason: `Block #${i}의 페이로드 해시 변조가 감지되었습니다.` };
    }

    const recomputedHash = await computeBlockHash(block);
    if (recomputedHash !== block.hash) {
      return { valid: false, failIndex: i, reason: `Block #${i}의 블록 해시 불일치가 감지되었습니다.` };
    }
  }

  const merkleRoot = await computeMerkleRoot(chain.map((b) => b.hash));
  return {
    valid: true,
    height: chain.length - 1,
    count: chain.length,
    tipHash: chain[chain.length - 1].hash,
    merkleRoot
  };
}

/**
 * 체인 통계 집계 (수학 + 학습 + 게임사용 + 추억 + 프로젝트 전체 집계)
 */
export function summarizeChain(chain = []) {
  let totalReward = 0;
  let earnedTime = 0;
  let spentTime = 0;
  let coreCount = 0;
  let boostCount = 0;
  let masterCount = 0;
  let anchoredCount = 0;
  const moduleCounts = {
    math: 0,
    study: 0,
    game: 0,
    memory: 0,
    project: 0,
    bundle: 0
  };

  for (const b of chain) {
    const amt = Number(b.reward?.amount || 0);
    totalReward += amt;
    if (amt > 0) earnedTime += amt;
    if (amt < 0) spentTime += Math.abs(amt);

    if (b.tier === 'CORE') coreCount += 1;
    if (b.tier === 'BOOST') boostCount += 1;
    if (b.tier === 'MASTER') masterCount += 1;
    if (b.onchain && (b.onchain.txHash || b.onchain.otsBase64)) anchoredCount += 1;
    if (b.module && b.module !== 'genesis') {
      moduleCounts[b.module] = (moduleCounts[b.module] || 0) + 1;
    }
  }

  return {
    totalReward,
    balanceTime: totalReward,
    earnedTime,
    spentTime,
    coreCount,
    boostCount,
    masterCount,
    moduleCounts,
    anchoredCount,
    unanchoredCount: Math.max(0, chain.length - 1 - anchoredCount),
    height: Math.max(0, chain.length - 1),
    count: chain.length
  };
}

