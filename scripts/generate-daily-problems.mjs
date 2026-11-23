#!/usr/bin/env node
/**
 * ShinPoW Daily Gemini Pro Math Problem Generator (100% Automated)
 * ---------------------------------------------------------------------------
 * 1. .agents/skills/daily-math-coach/SKILL.md 전체 지침을 시스템 프롬프트로 로드
 * 2. data/difficulty.json에서 지훈·이현의 현재 난이도 & 포커스 메모 자동 로드
 * 3. Gemini 2.5 Pro(우선) -> 2.5 Flash(폴백)로 Spark 수준의 심층 사고력 문제 생성
 * 4. 모델 내부 자체 검산(verificationSteps)을 강제하여 수학적 오류 차단
 * 5. 평문 정답을 즉시 SHA-256 answerHash로 변환 후 data/problems.json에 반영
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

const MODELS = (process.env.GEMINI_MODEL || 'gemini-3.1-pro-preview,gemini-3.8-flash')
  .split(',')
  .map((m) => m.trim())
  .filter(Boolean);

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

async function callGemini(model, systemPrompt, userPrompt) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(API_KEY)}`;
  const retryDelaysMs = [5000, 15000, 30000];
  let lastErr = null;

  for (let attempt = 0; attempt <= retryDelaysMs.length; attempt++) {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
        generationConfig: {
          temperature: 0.75,
          responseMimeType: 'application/json'
        }
      })
    });

    if (res.ok) {
      const data = await res.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) throw new Error(`${model}: 응답 텍스트 없음`);
      return JSON.parse(text);
    }

    const errBody = await res.text();
    lastErr = new Error(`${model} HTTP ${res.status}: ${errBody.slice(0, 260)}`);
    const isTransient = res.status === 429 || res.status === 500 || res.status === 503 || res.status === 504;
    if (!isTransient || attempt === retryDelaysMs.length) {
      throw lastErr;
    }
    const waitMs = retryDelaysMs[attempt];
    console.warn(`! ${model} 일시 혼잡(HTTP ${res.status}), ${waitMs / 1000}초 후 재시도 (${attempt + 1}/${retryDelaysMs.length})...`);
    await new Promise((r) => setTimeout(r, waitMs));
  }

  throw lastErr;
}

async function main() {
  const { dateStr, label } = getKstDateInfo(process.env.TARGET_DATE);
  const problemsPath = path.resolve('data/problems.json');
  const difficultyPath = path.resolve('data/difficulty.json');
  const skillPath = path.resolve('.agents/skills/daily-math-coach/SKILL.md');

  const [skillPrompt, rawProblems, rawDiff] = await Promise.all([
    fs.readFile(skillPath, 'utf8'),
    fs.readFile(problemsPath, 'utf8'),
    fs.readFile(difficultyPath, 'utf8').catch(() => '{}')
  ]);

  const db = JSON.parse(rawProblems);
  const forceRegen = String(process.env.FORCE_REGENERATE || '').toLowerCase() === 'true';
  const jhId = `jh-${dateStr}`;
  const lhId = `lh-${dateStr}`;
  const alreadyHasToday =
    Array.isArray(db.jihoon) &&
    Array.isArray(db.leehyun) &&
    db.jihoon.some((p) => p.id === jhId) &&
    db.leehyun.some((p) => p.id === lhId);

  if (alreadyHasToday && !forceRegen) {
    console.log(`✓ ${label} 문제가 이미 등록되어 있어 건너뜁니다. (중복 출제 방지)`);
    return;
  }

  const diff = JSON.parse(rawDiff || '{}');

  const jBasic = process.env.JIHOON_BASIC_LEVEL || String(diff.jihoon?.basicLevel ?? 3);
  const jAdv = process.env.JIHOON_ADV_LEVEL || String(diff.jihoon?.advLevel ?? 4);
  const lBasic = process.env.LEEHYUN_BASIC_LEVEL || String(diff.leehyun?.basicLevel ?? 3);
  const lAdv = process.env.LEEHYUN_ADV_LEVEL || String(diff.leehyun?.advLevel ?? 4);
  const topicHint = (process.env.TOPIC_HINT || '').trim();
  const jFocus = diff.jihoon?.focusNote || '';
  const lFocus = diff.leehyun?.focusNote || '';

  const recentTopics = {
    jihoon: (db.jihoon || []).slice(0, 6).flatMap((d) => [d.basic?.topic, d.adv?.topic]).filter(Boolean),
    leehyun: (db.leehyun || []).slice(0, 6).flatMap((d) => [d.basic?.topic, d.adv?.topic]).filter(Boolean)
  };

  const userPrompt = `
오늘 날짜: ${label}
신지훈(초6)과 신이현(초3)을 위한 오늘의 ShinPoW 수학 문제 세트를 생성하고, 반드시 순수 JSON 객체만 반환하세요.

[난이도 및 포커스 설정]
- 신지훈 기본: Level ${jBasic} / 심화: Level ${jAdv} ${jFocus ? `(포커스: ${jFocus})` : ''}
- 신이현 기본: Level ${lBasic} / 심화: Level ${lAdv} ${lFocus ? `(포커스: ${lFocus})` : ''}
${topicHint ? `- 오늘의 특별 테마 힌트: ${topicHint}` : ''}

[최근 출제된 단원 (중복 피하기)]
- 신지훈 최근: ${recentTopics.jihoon.join(', ') || '없음'}
- 신이현 최근: ${recentTopics.leehyun.join(', ') || '없음'}

[절대 지켜야 할 문제 퀄리티 기준 (Spark/영재원 수준)]
1. 단순 사칙연산 1단계 대입 문제(예: "24×3×15는?")는 절대 금지합니다.
2. 최소 2~3단계의 논리적 발상·시각화·규칙 발견·STEAM 원리(물리·기하·로보틱스·천문학·대칭/전개도·전략 게임·정수론 통찰 등)가 결합된 몰입감 있는 스토리텔링 문제로 출제하세요. (계산은 깔끔하되 발상이 빛나는 영재원·KMO 입문 수준)
3. 각 문제의 question은 문단 줄바꿈(\\n\\n)을 활용해 읽기 편하게 구성하고, 제목([문제 제목])을 첫 줄에 넣으세요.
4. question 맨 끝에는 반드시 "(숫자만 입력)" 또는 "(예: 3/8 형태로 입력)" 안내를 포함하세요.
5. answer는 단위 없이 유일한 숫자 또는 기약분수 문자열(예: "6", "10.8", "3/8")만 넣고, 반드시 verificationSteps에 직접 검산 과정을 적은 뒤 최종 answer가 100% 일치하는지 확인하세요.

[출력 JSON 스키마]
{
  "jihoon": {
    "id": "jh-${dateStr}",
    "label": "${label}",
    "basic": { "topic": "단원명 · ${jBasic}등급", "question": "...", "verificationSteps": "...", "answer": "..." },
    "adv": { "topic": "단원명 · ${jAdv}등급", "question": "...", "verificationSteps": "...", "answer": "..." }
  },
  "leehyun": {
    "id": "lh-${dateStr}",
    "label": "${label}",
    "basic": { "topic": "단원명 · ${lBasic}등급", "question": "...", "verificationSteps": "...", "answer": "..." },
    "adv": { "topic": "단원명 · ${lAdv}등급", "question": "...", "verificationSteps": "...", "answer": "..." }
  }
}
`.trim();

  let generated = null;
  let usedModel = '';
  let lastErr = null;
  for (const model of MODELS) {
    try {
      generated = await callGemini(model, skillPrompt, userPrompt);
      usedModel = model;
      break;
    } catch (err) {
      lastErr = err;
      console.warn(`! ${model} 실패, 다음 모델로 폴백 시도: ${err.message}`);
    }
  }

  if (!generated) {
    throw new Error(`모든 Gemini 모델 호출 실패: ${lastErr?.message}`);
  }

  const salt = APP_CONFIG.protocol.answerSalt;
  for (const sid of ['jihoon', 'leehyun']) {
    if (!generated[sid]) throw new Error(`${sid} 문제 객체가 누락되었습니다.`);
    // normalizeProblemEntry strips plaintext answer & verificationSteps, keeping only answerHash
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
  console.log(`✓ ${usedModel}로 ${label} Spark급 문제 자동 생성 및 SHA-256 해시 반영 완료!`);
}

main().catch((err) => {
  console.error(`✗ 생성 실패: ${err.message}`);
  process.exit(1);
});
