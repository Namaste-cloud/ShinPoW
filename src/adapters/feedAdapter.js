/**
 * ShinPoW Problem Feed Adapter (교체 가능 어댑터)
 * ---------------------------------------------------------------------------
 * 정적 ./data/problems.json 또는 Google Apps Script 웹앱 JSON 피드에서
 * 최신 문제 세트를 자동으로 가져와 안전하게 병합합니다.
 */

import { parseProblemsPayload } from '../modules/math/mathModule.js';

export async function fetchProblemFeed({ feedConfig, salt, validStudentIds }) {
  if (!feedConfig || !feedConfig.url) {
    return { ok: false, skipped: true, reason: '피드 URL 미설정' };
  }

  const loc = typeof globalThis !== 'undefined' ? globalThis.location : null;
  if (loc && loc.protocol !== 'http:' && loc.protocol !== 'https:') {
    return { ok: false, skipped: true, reason: '로컬 파일 프로토콜에서는 자동 동기화를 건너뜁니다.' };
  }

  try {
    const res = await fetch(feedConfig.url, { cache: 'no-store' });
    if (!res.ok) {
      return { ok: false, skipped: false, reason: `HTTP ${res.status}` };
    }
    const raw = await res.json();
    const parsedByStudent = await parseProblemsPayload(raw, salt, validStudentIds);
    return {
      ok: true,
      updatedAt: raw.updatedAt || null,
      problemsByStudent: parsedByStudent
    };
  } catch (err) {
    return {
      ok: false,
      skipped: false,
      reason: err?.message || '네트워크 오프라인'
    };
  }
}

/**
 * 피드에서 가져온 문제를 기존 목록과 ID 기준으로 중복 없이 병합
 * 새 문제는 상단(최신)에 추가하고, 기존 ID는 내용을 갱신합니다.
 */
export function mergeProblems(existingByStudent, incomingByStudent, validStudentIds) {
  let addedCount = 0;
  let updatedCount = 0;

  for (const sid of validStudentIds) {
    if (!Array.isArray(existingByStudent[sid])) {
      existingByStudent[sid] = [];
    }
    const list = existingByStudent[sid];
    const incoming = Array.isArray(incomingByStudent[sid]) ? incomingByStudent[sid] : [];

    // 역순으로 unshift하여 피드 배열의 첫 번째 항목(최신)이 맨 위로 오도록 유지
    for (let i = incoming.length - 1; i >= 0; i--) {
      const entry = incoming[i];
      const idx = list.findIndex((p) => p.id === entry.id);
      if (idx >= 0) {
        const prev = list[idx];
        const changed =
          prev.label !== entry.label ||
          prev.basic.topic !== entry.basic.topic ||
          prev.basic.question !== entry.basic.question ||
          prev.basic.answerHash !== entry.basic.answerHash ||
          prev.adv.topic !== entry.adv.topic ||
          prev.adv.question !== entry.adv.question ||
          prev.adv.answerHash !== entry.adv.answerHash;
        if (changed) {
          list[idx] = entry;
          updatedCount += 1;
        }
      } else {
        list.unshift(entry);
        addedCount += 1;
      }
    }
  }

  return { addedCount, updatedCount };
}

