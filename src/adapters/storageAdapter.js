/**
 * ShinPoW Storage Adapter (교체 가능 어댑터)
 * ---------------------------------------------------------------------------
 * 현재는 브라우저 localStorage에 저장하며, 원장 백업/복원(암호학적 검증 포함)을 제공합니다.
 * 추후 Supabase / Firebase / GitHub API 동기화로 확장할 때 이 파일만 교체·확장하면 됩니다.
 */

import { verifyChain } from '../core/chain.js';

export const LEDGER_EXPORT_FORMAT = 'shinpow-ledger-v1';

export class LocalStorageAdapter {
  constructor(storageKey) {
    this.storageKey = storageKey;
  }

  load() {
    try {
      const raw = globalThis.localStorage?.getItem(this.storageKey);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  save(snapshot) {
    try {
      globalThis.localStorage?.setItem(this.storageKey, JSON.stringify(snapshot));
      return true;
    } catch {
      return false;
    }
  }

  clear() {
    try {
      globalThis.localStorage?.removeItem(this.storageKey);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * 전체 원장 백업 JSON 번들 생성
 */
export function buildLedgerExportBundle({ state, config }) {
  return {
    format: LEDGER_EXPORT_FORMAT,
    protocolVersion: config.protocol.version,
    networkMode: config.protocol.networkMode,
    exportedAt: new Date().toISOString(),
    students: config.students,
    chains: state.chains,
    mempool: state.mempool || { jihoon: [], leehyun: [] },
    solved: state.solved,
    problems: state.problems,
    selectedDayIndex: state.selectedDayIndex
  };
}

/**
 * 백업 JSON 파일 검증 및 복원 파싱
 * 모든 학생의 체인이 Protocol v1 무결성 검증을 통과해야만 복원을 허용합니다.
 */
export async function validateAndParseLedgerBundle(rawJson, studentsConfig) {
  const parsed = typeof rawJson === 'string' ? JSON.parse(rawJson.trim()) : rawJson;
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('올바른 JSON 백업 파일이 아닙니다.');
  }

  const chains = parsed.chains || (parsed.jihoon && parsed.leehyun ? parsed : null);
  if (!chains || typeof chains !== 'object') {
    throw new Error('백업 파일에 chains 원장 데이터가 없습니다.');
  }

  const studentIds = Object.keys(studentsConfig);
  const verifiedSummaries = {};

  for (const sid of studentIds) {
    const chain = chains[sid];
    if (!Array.isArray(chain) || chain.length === 0) {
      throw new Error(`${studentsConfig[sid].name}(${sid}) 체인이 비어 있습니다.`);
    }
    const check = await verifyChain(chain, studentsConfig[sid].chainId);
    if (!check.valid) {
      throw new Error(`${studentsConfig[sid].name} 체인 검증 실패: ${check.reason}`);
    }
    verifiedSummaries[sid] = check;
  }

  return {
    chains,
    mempool: parsed.mempool || null,
    solved: parsed.solved || null,
    problems: parsed.problems || null,
    selectedDayIndex: parsed.selectedDayIndex || null,
    verifiedSummaries
  };
}

