import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { APP_CONFIG } from '../config.js';
import { sha256, sha256Pure, canonicalStringify, computeMerkleRoot } from '../src/core/crypto.js';
import {
  createGenesisBlock,
  mineBlock,
  verifyChain,
  summarizeChain
} from '../src/core/chain.js';
import {
  verifyAnswer,
  getMinedPartsForDay,
  computePendingMathReward,
  buildMathBlockPayload,
  parseProblemsPayload
} from '../src/modules/math/mathModule.js';
import {
  createActivityTx,
  buildActivityBlockSpec
} from '../src/modules/activity/activityModule.js';
import { DEFAULT_MATH_PROBLEMS } from '../src/modules/math/defaultProblems.js';
import { validateAndParseLedgerBundle } from '../src/adapters/storageAdapter.js';
import { mergeProblems } from '../src/adapters/feedAdapter.js';
import {
  SELECTOR_ANCHOR_BLOCK,
  SELECTOR_ANCHOR_BATCH,
  encodeAnchorBlockCalldata,
  encodeAnchorBatchCalldata
} from '../src/adapters/onchainAdapter.js';
import {
  OTS_HEADER_MAGIC,
  OTS_VERSION,
  OTS_OP_SHA256,
  buildOtsProofBytes,
  bytesToBase64,
  base64ToBytes
} from '../src/adapters/opentimestampsAdapter.js';

test('SHA-256 pure JS fallback matches Web Crypto API', async () => {
  const vectors = ['', 'abc', 'SHINPOW|v1|test', '한글 수학 문제 테스트 123'];
  for (const input of vectors) {
    const webHash = await sha256(input);
    const pureHash = sha256Pure(input);
    assert.equal(pureHash, webHash, `Mismatch for input: ${input}`);
    assert.match(webHash, /^[0-9a-f]{64}$/);
  }
});

test('canonicalStringify is deterministic regardless of key order', () => {
  const a = { z: 1, a: { d: 4, b: 2 }, arr: [{ y: 1, x: 2 }] };
  const b = { arr: [{ x: 2, y: 1 }], a: { b: 2, d: 4 }, z: 1 };
  assert.equal(canonicalStringify(a), canonicalStringify(b));
});

const SAMPLE_DAY = {
  id: 'jh-sample-1',
  label: '2026-11-21 (토)',
  basic: {
    id: 'jh-sample-1-basic',
    topic: '원의 넓이 · 3등급',
    question: '반지름이 6cm인 원의 넓이는?',
    answerHash: 'f24f336a1882b3c73c67da95fede2497b8416d658091a0eff2c3c60d94cf0cb3'
  },
  adv: {
    id: 'jh-sample-1-adv',
    topic: '비례배분 · 4등급',
    question: '구슬 63개를 5:4로 나누면 차이?',
    answerHash: '155ac54c8346f193705ca6affa6a92f21c2f333f0a8375be14e2c3da3290cb16'
  }
};

test('Math answer hashing & verification handles units, spaces, and fractions accurately', async () => {
  const sample = await parseProblemsPayload(
    {
      jihoon: [
        {
          id: 't1',
          label: 'test',
          basic: { topic: '원의 넓이', question: 'Q1', answer: '111.6' },
          adv: { topic: '분수', question: 'Q2', answer: '3/8' }
        }
      ],
      leehyun: []
    },
    APP_CONFIG.protocol.answerSalt
  );
  assert.equal(await verifyAnswer(sample.jihoon[0].basic, '111.6 cm²', APP_CONFIG.protocol.answerSalt), true);
  assert.equal(await verifyAnswer(sample.jihoon[0].adv, ' 3/8 ', APP_CONFIG.protocol.answerSalt), true);
  assert.equal(await verifyAnswer(sample.jihoon[0].adv, '5/8', APP_CONFIG.protocol.answerSalt), false);
});

test('data/problems.json is valid JSON with SHA-256 hashed answers only (no plaintext answers)', async () => {
  const raw = await fs.readFile(path.resolve('data/problems.json'), 'utf8');
  const parsed = JSON.parse(raw);
  assert.ok(Array.isArray(parsed.jihoon));
  assert.ok(Array.isArray(parsed.leehyun));
  for (const sid of ['jihoon', 'leehyun']) {
    for (const day of parsed[sid]) {
      for (const part of ['basic', 'adv']) {
        assert.equal('answer' in day[part], false, `Plaintext answer leaked in ${day.id}.${part}`);
        assert.match(day[part].answerHash, /^[0-9a-f]{64}$/, `Invalid answerHash in ${day.id}.${part}`);
      }
    }
  }
});

test('Cumulative TIME rewards: +1 CORE, +2 BOOST, +3 MASTER, and zero double-claiming', async () => {
  const tiers = APP_CONFIG.tiers;

  // 1) Basic only -> CORE (+1 TIME)
  let r = computePendingMathReward({
    solvedDay: { basic: true, adv: false },
    minedParts: { basicMined: false, advMined: false },
    tiers
  });
  assert.deepEqual(r, { canMine: true, tier: 'CORE', rewardAmount: 1, parts: ['basic'] });

  // 2) Basic already mined, Adv now solved -> BOOST (+2 TIME)
  r = computePendingMathReward({
    solvedDay: { basic: true, adv: true },
    minedParts: { basicMined: true, advMined: false },
    tiers
  });
  assert.deepEqual(r, { canMine: true, tier: 'BOOST', rewardAmount: 2, parts: ['adv'] });

  // 3) Both solved before mining -> MASTER (+3 TIME)
  r = computePendingMathReward({
    solvedDay: { basic: true, adv: true },
    minedParts: { basicMined: false, advMined: false },
    tiers
  });
  assert.deepEqual(r, { canMine: true, tier: 'MASTER', rewardAmount: 3, parts: ['basic', 'adv'] });

  // 4) Both mined -> blocked
  r = computePendingMathReward({
    solvedDay: { basic: true, adv: true },
    minedParts: { basicMined: true, advMined: true },
    tiers
  });
  assert.equal(r.canMine, false);
  assert.equal(r.rewardAmount, 0);
});

test('Protocol v1 Genesis -> Mine -> Verify -> Detect tampering', async () => {
  const stu = APP_CONFIG.students.jihoon;
  const genesis = await createGenesisBlock({
    chainId: stu.chainId,
    studentId: stu.id,
    studentName: stu.name,
    rewardUnit: APP_CONFIG.rewardUnit,
    timestamp: APP_CONFIG.protocol.genesisTimestamp,
    note: APP_CONFIG.protocol.genesisNote
  });

  const day = SAMPLE_DAY;
  const block1 = await mineBlock({
    prevBlock: genesis,
    chainId: stu.chainId,
    module: 'math',
    tier: 'CORE',
    reward: { amount: 1, unit: 'TIME' },
    payload: buildMathBlockPayload({ day, parts: ['basic'] }),
    difficulty: '00'
  });

  assert.equal(block1.index, 1);
  assert.equal(block1.prevHash, genesis.hash);
  assert.ok(block1.hash.startsWith('00'));

  const block2 = await mineBlock({
    prevBlock: block1,
    chainId: stu.chainId,
    module: 'math',
    tier: 'BOOST',
    reward: { amount: 2, unit: 'TIME' },
    payload: buildMathBlockPayload({ day, parts: ['adv'] }),
    difficulty: '00'
  });

  const chain = [genesis, block1, block2];
  const mined = getMinedPartsForDay(chain, day.id);
  assert.deepEqual(mined, { basicMined: true, advMined: true, allMined: true });

  const stats = summarizeChain(chain);
  assert.equal(stats.totalReward, 3);
  assert.equal(stats.coreCount, 1);
  assert.equal(stats.boostCount, 1);
  assert.equal(stats.height, 2);

  // Full verification passes
  const check = await verifyChain(chain, stu.chainId);
  assert.equal(check.valid, true);
  assert.equal(check.height, 2);
  assert.match(check.merkleRoot, /^[0-9a-f]{64}$/);

  // Adding onchain metadata AFTER mining does NOT invalidate the block hash
  block2.onchain = { txHash: '0x' + 'ab'.repeat(32), network: 'base-sepolia' };
  const checkAfterAnchor = await verifyChain(chain, stu.chainId);
  assert.equal(checkAfterAnchor.valid, true);

  // Tamper reward -> detected!
  const tamperedReward = structuredClone(chain);
  tamperedReward[1].reward.amount = 999;
  const resReward = await verifyChain(tamperedReward, stu.chainId);
  assert.equal(resReward.valid, false);
  assert.equal(resReward.failIndex, 1);

  // Tamper payload -> detected!
  const tamperedPayload = structuredClone(chain);
  tamperedPayload[2].payload.label = 'HACKED';
  const resPayload = await verifyChain(tamperedPayload, stu.chainId);
  assert.equal(resPayload.valid, false);
  assert.equal(resPayload.failIndex, 2);
});

test('Ledger restore validates both student chains cryptographically', async () => {
  const jGen = await createGenesisBlock({
    chainId: APP_CONFIG.students.jihoon.chainId,
    studentId: 'jihoon',
    studentName: '신지훈'
  });
  const lGen = await createGenesisBlock({
    chainId: APP_CONFIG.students.leehyun.chainId,
    studentId: 'leehyun',
    studentName: '신이현'
  });

  const validBundle = JSON.stringify({
    format: 'shinpow-ledger-v1',
    chains: { jihoon: [jGen], leehyun: [lGen] }
  });

  const restored = await validateAndParseLedgerBundle(validBundle, APP_CONFIG.students);
  assert.equal(restored.verifiedSummaries.jihoon.valid, true);
  assert.equal(restored.verifiedSummaries.leehyun.valid, true);

  const badChain = structuredClone(jGen);
  badChain.hash = 'ff'.repeat(32);
  await assert.rejects(
    validateAndParseLedgerBundle(JSON.stringify({ chains: { jihoon: [badChain], leehyun: [lGen] } }), APP_CONFIG.students),
    /검증 실패/
  );
});

test('Problem JSON import hashes plaintext answers & mergeProblems avoids duplicates', async () => {
  const incomingJson = {
    jihoon: [
      {
        id: 'jh-2026-11-20',
        label: '2026-11-20',
        basic: { topic: '소수 나눗셈', question: '12.6 / 0.3 = ?', answer: '42' },
        adv: { topic: '비례식', question: '3:5 = 21:x', answer: '35' }
      }
    ],
    leehyun: []
  };

  const parsed = await parseProblemsPayload(incomingJson, APP_CONFIG.protocol.answerSalt);
  assert.equal(parsed.jihoon.length, 1);
  assert.equal('answer' in parsed.jihoon[0].basic, false);
  assert.match(parsed.jihoon[0].basic.answerHash, /^[0-9a-f]{64}$/);
  assert.equal(await verifyAnswer(parsed.jihoon[0].basic, '42', APP_CONFIG.protocol.answerSalt), true);

  const existing = structuredClone(DEFAULT_MATH_PROBLEMS);
  const firstMerge = mergeProblems(existing, parsed, ['jihoon', 'leehyun']);
  assert.equal(firstMerge.addedCount, 1);
  assert.equal(existing.jihoon[0].id, 'jh-2026-11-20');

  // Re-merging identical problem yields 0 changes
  const secondMerge = mergeProblems(existing, parsed, ['jihoon', 'leehyun']);
  assert.equal(secondMerge.addedCount, 0);
  assert.equal(secondMerge.updatedCount, 0);
});

test('Base on-chain ABI calldata encoding matches ShinPoWAnchor.sol fixed-word layout', async () => {
  const stu = APP_CONFIG.students.jihoon;
  const genesis = await createGenesisBlock({
    chainId: stu.chainId,
    studentId: stu.id,
    studentName: stu.name
  });
  const block1 = await mineBlock({
    prevBlock: genesis,
    chainId: stu.chainId,
    module: 'math',
    tier: 'MASTER',
    reward: { amount: 3, unit: 'TIME' },
    payload: { dayId: 'test', label: 'test', parts: ['adv', 'basic'] },
    difficulty: '00'
  });

  const singleData = await encodeAnchorBlockCalldata(block1);
  // 0x + 8 hex selector + 5 * 64 hex words = 2 + 8 + 320 = 330 chars
  assert.ok(singleData.startsWith(SELECTOR_ANCHOR_BLOCK));
  assert.equal(singleData.length, 330);

  // Verify negative rewardDelta (-2 TIME game usage) encodes as two's complement int256
  const gameBlock = await mineBlock({
    prevBlock: block1,
    chainId: stu.chainId,
    module: 'game',
    tier: 'GAME',
    reward: { amount: -2, unit: 'TIME' },
    payload: { label: '마인크래프트 20분', activities: [] },
    difficulty: '00'
  });
  const negData = await encodeAnchorBlockCalldata(gameBlock);
  assert.ok(negData.startsWith(SELECTOR_ANCHOR_BLOCK));
  assert.equal(negData.length, 330);
  assert.ok(negData.endsWith('f'.repeat(63) + 'e'), 'Expected -2 two-complement word');

  const root = await computeMerkleRoot([block1.hash, gameBlock.hash]);
  const batchData = await encodeAnchorBatchCalldata({
    chainId: stu.chainId,
    fromIndex: 1,
    toIndex: 2,
    merkleRoot: root
  });
  // 0x + 8 hex selector + 4 * 64 hex words = 2 + 8 + 256 = 266 chars
  assert.ok(batchData.startsWith(SELECTOR_ANCHOR_BATCH));
  assert.equal(batchData.length, 266);
});

test('Adapter ABI selectors match solc-compiled ShinPoWAnchor artifact', async () => {
  const artifact = JSON.parse(await fs.readFile(path.resolve('contracts/artifacts/ShinPoWAnchor.json'), 'utf8'));
  const ids = artifact.methodIdentifiers;
  assert.equal(SELECTOR_ANCHOR_BLOCK, '0x' + ids['anchorBlock(bytes32,uint256,bytes32,bytes32,int16)']);
  assert.equal(SELECTOR_ANCHOR_BATCH, '0x' + ids['anchorBatchRoot(bytes32,uint256,uint256,bytes32)']);
});

test('Trustless activities enforce 0 TIME for memory/reading/study/project and OP_RETURN note in math blocks', async () => {
  const stu = APP_CONFIG.students.leehyun;
  const genesis = await createGenesisBlock({
    chainId: stu.chainId,
    studentId: stu.id,
    studentName: stu.name
  });

  // 1) Math block with optional OP_RETURN 1-line memory note
  const mathPayload = buildMathBlockPayload({
    day: SAMPLE_DAY,
    parts: ['basic', 'adv'],
    note: '곱셈과 나눗셈 둘 다 혼자 힘으로 풀었다!',
    mood: '😎'
  });
  assert.equal(mathPayload.note, '곱셈과 나눗셈 둘 다 혼자 힘으로 풀었다!');
  const block1 = await mineBlock({
    prevBlock: genesis,
    chainId: stu.chainId,
    module: 'math',
    tier: 'MASTER',
    reward: { amount: 3, unit: 'TIME' },
    payload: mathPayload,
    difficulty: '00'
  });

  // 2) Self-attested memory/reading/study/project MUST always be 0 TIME
  const txMemory = createActivityTx({
    category: 'memory',
    title: '가족과 한강 자전거',
    memo: '노을이 정말 예뻤다!',
    mood: '🤩',
    tags: '#가족 #추억'
  });
  const txReading = createActivityTx({
    category: 'reading',
    title: '해리포터와 마법사의 돌',
    durationMinutes: 40,
    memo: '호그와트 입학 장면이 재미있었다.',
    tags: '#독서 #판타지'
  });
  assert.equal(txMemory.timeDelta, 0);
  assert.equal(txReading.timeDelta, 0);
  assert.deepEqual(txReading.tags, ['독서', '판타지']);

  const memSpec = buildActivityBlockSpec(txMemory);
  assert.equal(memSpec.module, 'memory');
  assert.equal(memSpec.rewardAmount, 0);

  const block2 = await mineBlock({
    prevBlock: block1,
    chainId: stu.chainId,
    module: memSpec.module,
    tier: memSpec.tier,
    reward: { amount: memSpec.rewardAmount, unit: 'TIME' },
    payload: memSpec.payload,
    difficulty: '00'
  });

  const readSpec = buildActivityBlockSpec(txReading);
  assert.equal(readSpec.module, 'reading');
  assert.equal(readSpec.tier, 'READING');
  assert.equal(readSpec.rewardAmount, 0);

  const block3 = await mineBlock({
    prevBlock: block2,
    chainId: stu.chainId,
    module: readSpec.module,
    tier: readSpec.tier,
    reward: { amount: readSpec.rewardAmount, unit: 'TIME' },
    payload: readSpec.payload,
    difficulty: '00'
  });

  const chain = [genesis, block1, block2, block3];
  const verifyRes = await verifyChain(chain, stu.chainId);
  assert.equal(verifyRes.valid, true);

  // Tampering with the OP_RETURN note inside block1 must break payloadHash verification!
  const tamperedNote = structuredClone(chain);
  tamperedNote[1].payload.note = '변조된 추억';
  const tamperedRes = await verifyChain(tamperedNote, stu.chainId);
  assert.equal(tamperedRes.valid, false);
  assert.equal(tamperedRes.failIndex, 1);

  const stats = summarizeChain(chain);
  assert.equal(stats.earnedTime, 3);
  assert.equal(stats.spentTime, 0);
  assert.equal(stats.balanceTime, 3);
  assert.equal(stats.moduleCounts.math, 1);
  assert.equal(stats.moduleCounts.memory, 1);
  assert.equal(stats.moduleCounts.reading, 1);
});

test('OpenTimestamps (.ots) binary proof framing & Base64 round-trip', () => {
  const sampleDigest = 'ab'.repeat(32);
  const fakeCalendar = new Uint8Array([0xf0, 0x08, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08]);
  const proof = buildOtsProofBytes(sampleDigest, fakeCalendar);

  assert.equal(proof.length, OTS_HEADER_MAGIC.length + 2 + 32 + fakeCalendar.length);
  assert.deepEqual(proof.slice(0, OTS_HEADER_MAGIC.length), OTS_HEADER_MAGIC);
  assert.equal(proof[OTS_HEADER_MAGIC.length], OTS_VERSION);
  assert.equal(proof[OTS_HEADER_MAGIC.length + 1], OTS_OP_SHA256);

  const b64 = bytesToBase64(proof);
  const restored = base64ToBytes(b64);
  assert.deepEqual(restored, proof);

  const chainWithOts = [
    { index: 0, reward: { amount: 0 }, onchain: null },
    { index: 1, reward: { amount: 1 }, onchain: { provider: 'opentimestamps', otsBase64: b64 } }
  ];
  const stats = summarizeChain(chainWithOts);
  assert.equal(stats.anchoredCount, 1);
  assert.equal(stats.unanchoredCount, 0);
});

