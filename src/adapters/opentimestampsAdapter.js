/**
 * ShinPoW OpenTimestamps Adapter (Bitcoin Mainnet · 100% Free · Zero Wallet)
 * ---------------------------------------------------------------------------
 * 지갑, ETH, 가스비 없이 ShinPoW 블록 머클 루트를 실제 비트코인 메인넷에
 * 영구 각인하는 공식 OpenTimestamps(.ots) 클라이언트입니다.
 *
 * 생성된 .ots 증명 파일은 https://opentimestamps.org 또는 ots CLI로
 * 10년 뒤에도 독립적으로 비트코인 메인넷 포함 여부를 검증할 수 있습니다.
 */

import { computeMerkleRoot } from '../core/crypto.js';

// Official OpenTimestamps Proof v1 header magic (31 bytes)
export const OTS_HEADER_MAGIC = new Uint8Array([
  0x00, 0x4f, 0x70, 0x65, 0x6e, 0x54, 0x69, 0x6d,
  0x65, 0x73, 0x74, 0x61, 0x6d, 0x70, 0x73, 0x00,
  0x00, 0x50, 0x72, 0x6f, 0x6f, 0x66, 0x00, 0xbf,
  0x89, 0xe2, 0xe8, 0x84, 0xe8, 0x92, 0x94
]);

export const OTS_VERSION = 0x01;
export const OTS_OP_SHA256 = 0x08;

export const DEFAULT_OTS_CALENDARS = [
  'https://a.pool.opentimestamps.org/digest',
  'https://b.pool.opentimestamps.org/digest',
  'https://alice.btc.calendar.opentimestamps.org/digest'
];

export function hexToBytes(hex) {
  const clean = String(hex || '').replace(/^0x/i, '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(clean)) {
    throw new Error(`올바른 32바이트 SHA-256 hex가 아닙니다: ${hex}`);
  }
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function bytesToBase64(bytes) {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  let bin = '';
  for (let i = 0; i < bytes.length; i++) {
    bin += String.fromCharCode(bytes[i]);
  }
  return btoa(bin);
}

export function base64ToBytes(b64) {
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(b64, 'base64'));
  }
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
}

/**
 * 표준 OpenTimestamps (.ots) 바이너리 증명 파일 조립
 * Layout: [31B Magic] + [1B Version=0x01] + [1B OpSHA256=0x08] + [32B Digest] + [Calendar Proof Bytes]
 */
export function buildOtsProofBytes(digestHex, calendarResponseBytes) {
  const digestBytes = hexToBytes(digestHex);
  const calBytes =
    calendarResponseBytes instanceof Uint8Array
      ? calendarResponseBytes
      : new Uint8Array(calendarResponseBytes);

  if (calBytes.length < 8) {
    throw new Error('OpenTimestamps 캘린더 응답이 올바르지 않습니다.');
  }

  const totalLen = OTS_HEADER_MAGIC.length + 2 + digestBytes.length + calBytes.length;
  const proof = new Uint8Array(totalLen);
  let offset = 0;
  proof.set(OTS_HEADER_MAGIC, offset);
  offset += OTS_HEADER_MAGIC.length;
  proof[offset++] = OTS_VERSION;
  proof[offset++] = OTS_OP_SHA256;
  proof.set(digestBytes, offset);
  offset += digestBytes.length;
  proof.set(calBytes, offset);
  return proof;
}

/**
 * 미앵커링 블록들의 머클 루트를 비트코인 메인넷 OpenTimestamps 캘린더에 무료 제출
 */
export async function anchorBatchOpenTimestamps({
  chainId,
  blocks,
  calendars = DEFAULT_OTS_CALENDARS
}) {
  if (!Array.isArray(blocks) || blocks.length === 0) {
    throw new Error('비트코인에 앵커링할 블록이 없습니다.');
  }

  const sorted = [...blocks].sort((a, b) => a.index - b.index);
  const fromIndex = sorted[0].index;
  const toIndex = sorted[sorted.length - 1].index;
  const merkleRoot = await computeMerkleRoot(sorted.map((b) => b.hash));
  const digestBytes = hexToBytes(merkleRoot);

  let lastError = null;
  for (const url of calendars) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/vnd.opentimestamps.v1'
        },
        body: digestBytes
      });
      if (!res.ok) {
        lastError = new Error(`${url} HTTP ${res.status}`);
        continue;
      }
      const calBytes = new Uint8Array(await res.arrayBuffer());
      const proofBytes = buildOtsProofBytes(merkleRoot, calBytes);
      const otsBase64 = bytesToBase64(proofBytes);

      return {
        provider: 'opentimestamps',
        mode: 'batch',
        network: 'bitcoin-mainnet',
        chainId,
        calendarUrl: url,
        fromIndex,
        toIndex,
        merkleRoot,
        otsBase64,
        proofBytesLength: proofBytes.length,
        verifyUrl: 'https://opentimestamps.org',
        anchoredAt: new Date().toISOString()
      };
    } catch (err) {
      lastError = err;
    }
  }

  throw new Error(`OpenTimestamps 캘린더 연결 실패: ${lastError?.message || '오프라인 상태'}`);
}
