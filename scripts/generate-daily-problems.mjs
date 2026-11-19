#!/usr/bin/env node
/**
 * ShinPoW Daily Gemini Math Problem Generator
 * ---------------------------------------------------------------------------
 * .agents/skills/daily-math-coach/SKILL.md 지침을 그대로 시스템 프롬프트로 읽어
 * Gemini API로 오늘의 맞춤형 수학 문제(지훈 초6 · 이현 초3)를 생성하고,
 * 평문 정답을 즉시 SHA-256 answerHash로 변환해 data/problems.json 상단에 추가합니다.
 *
 * 환경변수:
 *   GEMINI_API_KEY       (필수) Google AI Studio API 키
 *   GEMINI_MODEL         (선택) 기본값: gemini-2.5-flash
 *   JIHOON_BASIC_LEVEL   (선택) 기본값: 3
 *   JIHOON_ADV_LEVEL     (선택) 기본값: 4
 *   LEEHYUN_BASIC_LEVEL  (선택) 기본값: 3
 *   LEEHYUN_ADV_LEVEL    (선택) 기본값: 4
 *   TOPIC_HINT           (선택) 특정 단원/테마 요청 (예: "지훈 로보틱스, 이현 천문학")
 *   TARGET_DATE          (선택) YYYY-MM-DD (미지정 시 한국 시간 오늘 날짜)
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { APP_CONFIG } from '../config.js';
import { normalizeProblemEntry } from '../src/modules/math/mathModule.js';

const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) {
  console.error('✗ GEMINI_API_KEY 환경변수가 설정되지 않았습니다.');
  process.exit(1);
}

const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const JIHOON_BASIC_LEVEL = process.env.JIHOON_BASIC_LEVEL || '3';
const JIHOON_ADV_LEVEL = process.env.JIHOON_ADV_LEVEL || '4';
const LEEHYUN_BASIC_LEVEL = process.env.LEEHYUN_BASIC_LEVEL || '3';
const LEEHYUN_ADV_LEVEL = process.env.LEEHYUN_ADV_LEVEL || '4';
const TOPIC_HINT = (process.env.TOPIC_HINT || '').trim();

function getKstDateInfo(overrideDate) {
  const days = ['일', '월', '화', '수', '목', '금', '토'];
  let dateStr;
  let dayName;
  if (overrideDate && /^\d{4}-\d{2}-\d{2}$/.test(overrideDate)) {
    dateStr = overrideDate;
    const d = new Date(`${overrideDate}T12:00:00+09:00`);
    dayName = days[d.getUTCDay()];
  } else {
    const nowKst = new Date(Date.now() + 9 * 60 * 60 * 1000);
    const yyyy = nowKst.getUTCFullYear();
    const mm = String(nowKst.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(nowKst.getUTCDate()).padStart(2, '0');
    dateStr = `${yyyy}-${mm}-${dd}`;
    dayName = days[nowKst.getUTCDay()];
  }
  return { dateStr, label: `${dateStr} (${dayName})` };
}

async function main() {
  const { dateStr, label } = getKstDateInfo(process.env.TARGET_DATE);
  const problemsPath = path.resolve('data/problems.json');
  const skillPath = path.resolve('.agents/skills/daily-math-coach/SKILL.md');

  const [skillPrompt, rawProblems] = await Promise.all([
    fs.readFile(skillPath, 'utf8'),
    fs.readFile(problemsPath, 'utf8')
  ]);

  const db = JSON.parse(rawProblems);
  const jhId = `jh-${dateStr}`;
  const lhId = `lh-${dateStr}`;

  const recentTopics = {
    jihoon: (db.jihoon || []).slice(0, 5).flatMap((d) => [d.basic?.topic, d.adv?.topic]).filter(Boolean),
    leehyun: (db.leehyun || []).slice(0, 5).flatMap((d) => [d.basic?.topic, d.adv?.topic]).filter(Boolean)
  };

  const userPrompt = `
오늘 날짜: ${label}
아래 조건에 맞춰 신지훈(초6)과 신이현(초3)의 오늘의 ShinPoW 수학 문제 세트를 생성하고, 반드시 순수 JSON 객체만 반환하세요.

[난이도 설정]
- 신지훈 기본 문제: Level ${JIHOON_BASIC_LEVEL}
- 신지훈 심화 문제: Level ${JIHOON_ADV_LEVEL}
- 신이현 기본 문제: Level ${LEEHYUN_BASIC_LEVEL}
- 신이현 심화 문제: Level ${LEEHYUN_ADV_LEVEL}
${TOPIC_HINT ? `- 추가 주제 힌트: ${TOPIC_HINT}` : ''}

[최근 출제된 단원 (중복 피하기)]
- 신지훈 최근: ${recentTopics.jihoon.join(', ') || '없음'}
- 신이현 최근: ${recentTopics.leehyun.join(', ') || '없음'}

[중요 규칙]
1. 각 문제는 수학적으로 100% 정확하고 정답이 유일해야 합니다. 출제 전에 스스로 검산하세요.
2. question 끝에는 반드시 "(숫자만 입력)" 또는 "(예: 3/8 형태로 입력)"처럼 입력 형식을 안내하세요.
3. answer는 단위 없이 숫자 또는 기약분수 문자열(예: "42", "10.8", "3/8")만 넣으세요.
4. 아래 정확한 JSON 스키마로만 응답하세요:
{
  "jihoon": {
    "id": "${jhId}",
    "label": "${label}",
    "basic": { "topic": "단원명 · ${JIHOON_BASIC_LEVEL}등급", "question": "...", "answer": "..." },
    "adv": { "topic": "단원명 · ${JIHOON_ADV_LEVEL}등급", "question": "...", "answer": "..." }
  },
  "leehyun": {
    "id": "${lhId}",
    "label": "${label}",
    "basic": { "topic": "단원명 · ${LEEHYUN_BASIC_LEVEL}등급", "question": "...", "answer": "..." },
    "adv": { "topic": "단원명 · ${LEEHYUN_ADV_LEVEL}등급", "question": "...", "answer": "..." }
  }
}
`.trim();

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:generateContent?key=${encodeURIComponent(API_KEY)}`;
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: skillPrompt }] },
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
      generationConfig: {
        temperature: 0.7,
        responseMimeType: 'application/json'
      }
    })
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Gemini API 오류 (${res.status}): ${errBody.slice(0, 300)}`);
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error('Gemini API 응답에서 JSON 텍스트를 찾지 못했습니다.');
  }

  const generated = JSON.parse(text);
  const salt = APP_CONFIG.protocol.answerSalt;

  for (const sid of ['jihoon', 'leehyun']) {
    if (!generated[sid]) throw new Error(`${sid} 문제 객체가 누락되었습니다.`);
    const entry = await normalizeProblemEntry(sid, generated[sid], salt, 0);
    if (!Array.isArray(db[sid])) db[sid] = [];
    const existingIdx = db[sid].findIndex((p) => p.id === entry.id);
    if (existingIdx >= 0) {
      db[sid][existingIdx] = entry;
    } else {
      db[sid].unshift(entry);
    }
  }

  db.schemaVersion = db.schemaVersion || 1;
  db.updatedAt = new Date().toISOString();

  await fs.writeFile(problemsPath, JSON.stringify(db, null, 2) + '\n', 'utf8');
  console.log(`✓ Gemini(${MODEL})로 ${label} 문제 생성 및 SHA-256 해시 반영 완료!`);
}

main().catch((err) => {
  console.error(`✗ 생성 실패: ${err.message}`);
  process.exit(1);
});
