/**
 * ShinPoW Module: Math (확장 가능 플러그인 모듈 #1)
 * ---------------------------------------------------------------------------
 * 수학 문제 정답 해시 검증, 누적 TIME 보상 계산, 문제 JSON 정규화를 담당합니다.
 * 추후 `src/modules/coding/`, `src/modules/reading/` 등을 같은 패턴으로 추가할 수 있습니다.
 */

import { sha256 } from '../../core/crypto.js';

export const MATH_MODULE_ID = 'math';

/**
 * 아이들이 단위나 공백을 함께 입력해도 정답 인정되도록 정규화
 */
export function normalizeAnswer(ans) {
  return String(ans).trim().toLowerCase().replace(/[\s,원개명분m²cm]/g, '');
}

/**
 * 정답 해시 생성 (평문 정답을 절대 저장하지 않기 위함)
 */
export async function hashAnswer(problemId, rawAnswer, salt) {
  const norm = normalizeAnswer(rawAnswer);
  return sha256(`${problemId}:${norm}:${salt}`);
}

/**
 * 사용자 입력 정답 검증
 */
export async function verifyAnswer(problem, rawInput, salt) {
  if (!problem || !problem.answerHash) return false;
  const hashed = await hashAnswer(problem.id, rawInput, salt);
  return hashed === problem.answerHash;
}

/**
 * 특정 날짜(dayId)에 대해 이미 채굴 완료된 파트(basic / adv) 조회
 */
export function getMinedPartsForDay(chain = [], dayId) {
  let basicMined = false;
  let advMined = false;

  for (const block of chain) {
    if (block.module !== MATH_MODULE_ID) continue;
    if (block.payload?.dayId !== dayId) continue;
    const parts = Array.isArray(block.payload?.parts) ? block.payload.parts : [];
    if (parts.includes('basic')) basicMined = true;
    if (parts.includes('adv')) advMined = true;
  }

  return {
    basicMined,
    advMined,
    allMined: basicMined && advMined
  };
}

/**
 * 현재 풀이 상태 + 기존 채굴 이력을 바탕으로 채굴 가능한 TIME 보상과 등급 계산
 * 누적형 규칙:
 *  - 기본 문제 미채굴 & 해결 -> CORE (+1 TIME)
 *  - 심화 문제 미채굴 & 해결 -> BOOST (+2 TIME)
 *  - 기본 + 심화 모두 미채굴 & 해결 -> MASTER (+3 TIME)
 * 중복 채굴을 원천 차단합니다.
 */
export function computePendingMathReward({ solvedDay = {}, minedParts = {}, tiers }) {
  const readyBasic = Boolean(solvedDay.basic) && !minedParts.basicMined;
  const readyAdv = Boolean(solvedDay.adv) && !minedParts.advMined;

  const coreReward = Number(tiers?.CORE?.reward ?? 1);
  const boostReward = Number(tiers?.BOOST?.reward ?? 2);
  const masterReward = Number(tiers?.MASTER?.reward ?? coreReward + boostReward);

  if (readyBasic && readyAdv) {
    return {
      canMine: true,
      tier: 'MASTER',
      rewardAmount: masterReward,
      parts: ['basic', 'adv']
    };
  }
  if (readyAdv) {
    return {
      canMine: true,
      tier: 'BOOST',
      rewardAmount: boostReward,
      parts: ['adv']
    };
  }
  if (readyBasic) {
    return {
      canMine: true,
      tier: 'CORE',
      rewardAmount: coreReward,
      parts: ['basic']
    };
  }
  return {
    canMine: false,
    tier: null,
    rewardAmount: 0,
    parts: []
  };
}

/**
 * Protocol v1 블록에 들어갈 Math 모듈 페이로드 생성
 * (선택) 오늘의 한 줄 추억(note)과 기분(mood)을 OP_RETURN처럼 함께 각인합니다.
 */
export function buildMathBlockPayload({ day, parts, note = '', mood = '' }) {
  const proofs = {};
  const topics = {};
  if (parts.includes('basic')) {
    proofs.basic = day.basic.answerHash;
    topics.basic = day.basic.topic;
  }
  if (parts.includes('adv')) {
    proofs.adv = day.adv.answerHash;
    topics.adv = day.adv.topic;
  }

  const payload = {
    dayId: day.id,
    label: day.label,
    parts: [...parts].sort(),
    topics,
    proofs
  };

  const cleanNote = String(note || '').trim();
  if (cleanNote) {
    payload.note = cleanNote;
    if (mood) payload.mood = String(mood).trim();
  }

  return payload;
}

/**
 * 외부 JSON / Gemini Skill 출력 / 학부모 입력을 표준 문제 엔트리로 정규화
 * answer(평문)가 들어오면 즉시 SHA-256 answerHash로 변환하고 평문은 제거합니다.
 */
export async function normalizeProblemEntry(studentId, item, salt, idxOffset = 0) {
  if (!item || !item.basic || !item.adv) {
    throw new Error('각 문제 세트에는 basic과 adv 항목이 모두 필요합니다.');
  }
  if (!item.basic.question || !item.adv.question) {
    throw new Error('basic.question과 adv.question이 비어 있습니다.');
  }

  const dayId = item.id || `imp-${studentId}-${Date.now()}-${idxOffset}`;
  const basicId = item.basic.id || `${dayId}-basic`;
  const advId = item.adv.id || `${dayId}-adv`;

  if (!item.basic.answerHash && (item.basic.answer === undefined || String(item.basic.answer).trim() === '')) {
    throw new Error(`기본 문제(${dayId})의 answer 또는 answerHash가 필요합니다.`);
  }
  if (!item.adv.answerHash && (item.adv.answer === undefined || String(item.adv.answer).trim() === '')) {
    throw new Error(`심화 문제(${dayId})의 answer 또는 answerHash가 필요합니다.`);
  }

  const basicHash = item.basic.answerHash
    ? String(item.basic.answerHash).trim().toLowerCase()
    : await hashAnswer(basicId, item.basic.answer, salt);

  const advHash = item.adv.answerHash
    ? String(item.adv.answerHash).trim().toLowerCase()
    : await hashAnswer(advId, item.adv.answer, salt);

  return {
    id: dayId,
    label: item.label || new Date().toISOString().slice(0, 10),
    basic: {
      id: basicId,
      topic: item.basic.topic || '기본 문제',
      question: String(item.basic.question).trim(),
      answerHash: basicHash
    },
    adv: {
      id: advId,
      topic: item.adv.topic || '심화 문제',
      question: String(item.adv.question).trim(),
      answerHash: advHash
    }
  };
}

/**
 * 다양한 JSON 입력 형태를 { jihoon: [...], leehyun: [...] }로 파싱
 */
export async function parseProblemsPayload(rawJson, salt, validStudentIds = ['jihoon', 'leehyun']) {
  const parsed = typeof rawJson === 'string' ? JSON.parse(rawJson.trim()) : rawJson;
  const result = {};
  for (const sid of validStudentIds) result[sid] = [];

  if (Array.isArray(parsed)) {
    for (let i = 0; i < parsed.length; i++) {
      const row = parsed[i];
      const sid = validStudentIds.includes(row.student) ? row.student : validStudentIds[0];
      result[sid].push(await normalizeProblemEntry(sid, row, salt, i));
    }
  } else if (parsed && validStudentIds.some((sid) => Array.isArray(parsed[sid]))) {
    for (const sid of validStudentIds) {
      const arr = Array.isArray(parsed[sid]) ? parsed[sid] : [];
      for (let i = 0; i < arr.length; i++) {
        result[sid].push(await normalizeProblemEntry(sid, arr[i], salt, i));
      }
    }
  } else if (parsed && parsed.basic && parsed.adv) {
    const sid = validStudentIds.includes(parsed.student) ? parsed.student : validStudentIds[0];
    result[sid].push(await normalizeProblemEntry(sid, parsed, salt, 0));
  } else {
    throw new Error('지원하지 않는 JSON 형식입니다. {"jihoon": [...], "leehyun": [...]} 형태를 사용해 주세요.');
  }

  return result;
}

