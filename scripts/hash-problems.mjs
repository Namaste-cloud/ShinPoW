#!/usr/bin/env node
/**
 * ShinPoW Problem Hasher CLI
 * ---------------------------------------------------------------------------
 * data/problems.json 안에 평문 `answer`가 포함된 문제를 자동으로 SHA-256 `answerHash`로
 * 변환하고 평문 `answer` 필드를 제거합니다.
 * 공개 GitHub Pages로 배포할 때 아이들이 소스에서 답을 볼 수 없도록 보호합니다.
 *
 * 사용법:
 *   node scripts/hash-problems.mjs
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { APP_CONFIG } from '../config.js';
import { normalizeProblemEntry } from '../src/modules/math/mathModule.js';

const targetPath = path.resolve(process.argv[2] || 'data/problems.json');

async function main() {
  const raw = await fs.readFile(targetPath, 'utf8');
  const data = JSON.parse(raw);
  const studentIds = Object.keys(APP_CONFIG.students);
  let converted = 0;

  for (const sid of studentIds) {
    if (!Array.isArray(data[sid])) continue;
    const normalizedList = [];
    for (let i = 0; i < data[sid].length; i++) {
      const item = data[sid][i];
      if (item?.basic?.answer !== undefined || item?.adv?.answer !== undefined) {
        converted += 1;
      }
      normalizedList.push(
        await normalizeProblemEntry(sid, item, APP_CONFIG.protocol.answerSalt, i)
      );
    }
    data[sid] = normalizedList;
  }

  data.schemaVersion = data.schemaVersion || 1;
  data.updatedAt = new Date().toISOString();

  await fs.writeFile(targetPath, JSON.stringify(data, null, 2) + '\n', 'utf8');
  console.log(`✓ 완료: ${targetPath} (평문 정답 해시 변환: ${converted}세트)`);
}

main().catch((err) => {
  console.error(`✗ 오류: ${err.message}`);
  process.exit(1);
});

