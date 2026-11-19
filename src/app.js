/**
 * ShinPoW Application Controller (Clean Light · Trustless Edition)
 * ---------------------------------------------------------------------------
 * - 대기열(Mempool) 없이 수학 문제 정답 확인 -> 즉시 PoW 채굴 (+1/+2/+3 TIME, 선택 한 줄 추억 각인)
 * - 무승인 자율 기록: 추억·학습·프로젝트(0 TIME) & 게임·자유시간 사용(-TIME) -> 즉시 PoW 채굴
 * - Toss / Apple Clean Light 톤 + 시각적 블록 타임라인 익스플로러 + 검색 가능한 성장 장부
 */

import { APP_CONFIG } from '../config.js';
import { computeMerkleRoot } from './core/crypto.js';
import {
  createGenesisBlock,
  mineBlock,
  verifyChain,
  summarizeChain
} from './core/chain.js';
import { DEFAULT_MATH_PROBLEMS } from './modules/math/defaultProblems.js';
import {
  MATH_MODULE_ID,
  hashAnswer,
  verifyAnswer,
  getMinedPartsForDay,
  computePendingMathReward,
  buildMathBlockPayload,
  parseProblemsPayload
} from './modules/math/mathModule.js';
import {
  ACTIVITY_DEFAULTS,
  createActivityTx,
  buildActivityBlockSpec
} from './modules/activity/activityModule.js';
import {
  LocalStorageAdapter,
  buildLedgerExportBundle,
  validateAndParseLedgerBundle
} from './adapters/storageAdapter.js';
import { fetchProblemFeed, mergeProblems } from './adapters/feedAdapter.js';
import { anchorBatchOnchain, getExplorerTxUrl } from './adapters/onchainAdapter.js';

const studentIds = Object.keys(APP_CONFIG.students);
const storage = new LocalStorageAdapter(APP_CONFIG.storage.localStorageKey);

const state = {
  activeStudent: studentIds[0],
  activePanel: 'math', // 'math' | 'activity'
  activityCategory: 'memory', // 'memory' | 'study' | 'project' | 'game'
  ledgerFilter: 'all',
  ledgerSearch: '',
  selectedBlockIndex: { jihoon: 0, leehyun: 0 },
  parentUnlocked: false,
  selectedDayIndex: { jihoon: 0, leehyun: 0 },
  solved: { jihoon: {}, leehyun: {} },
  problems: structuredClone(DEFAULT_MATH_PROBLEMS),
  chains: { jihoon: [], leehyun: [] },
  isMining: false,
  pendingRestoreBundle: null,
  deferredInstallPrompt: null,
  currentAnchorMerkle: ''
};

// ---------------------------------------------------------------------------
// Utility Helpers
// ---------------------------------------------------------------------------

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatTimeDelta(amount, unit = APP_CONFIG.rewardUnit) {
  const n = Number(amount || 0);
  if (n > 0) return `+${n} ${unit}`;
  if (n < 0) return `${n} ${unit}`;
  return `0 ${unit}`;
}

function isSafeHttpUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  const colors = {
    success: 'bg-emerald-600 text-white shadow-lg shadow-emerald-600/20',
    error: 'bg-rose-600 text-white shadow-lg shadow-rose-600/20',
    gold: 'bg-amber-500 text-white shadow-lg shadow-amber-500/25',
    info: 'bg-[#191F28] text-white shadow-lg shadow-slate-900/15'
  };
  const el = document.createElement('div');
  el.className = `pointer-events-auto px-4 py-3 rounded-2xl text-xs font-semibold transition-all duration-300 ${colors[type] || colors.info}`;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => {
    el.classList.add('opacity-0', 'translate-y-1');
    setTimeout(() => el.remove(), 300);
  }, 3200);
}

function openModal(id) {
  const el = document.getElementById(id);
  el.classList.remove('hidden');
  el.classList.add('flex');
}

function closeModal(id) {
  const el = document.getElementById(id);
  el.classList.add('hidden');
  el.classList.remove('flex');
}

function saveState() {
  storage.save({
    protocolVersion: APP_CONFIG.protocol.version,
    selectedDayIndex: state.selectedDayIndex,
    solved: state.solved,
    problems: state.problems,
    chains: state.chains
  });
}

async function initFreshChains() {
  for (const sid of studentIds) {
    const stu = APP_CONFIG.students[sid];
    state.chains[sid] = [
      await createGenesisBlock({
        chainId: stu.chainId,
        studentId: stu.id,
        studentName: stu.name,
        rewardUnit: APP_CONFIG.rewardUnit,
        timestamp: APP_CONFIG.protocol.genesisTimestamp,
        note: APP_CONFIG.protocol.genesisNote,
        networkMode: APP_CONFIG.protocol.networkMode
      })
    ];
    state.selectedBlockIndex[sid] = 0;
  }
}

async function loadOrInitState() {
  const loaded = storage.load();
  const hasValidChains =
    loaded &&
    loaded.chains &&
    studentIds.every(
      (sid) =>
        Array.isArray(loaded.chains[sid]) &&
        loaded.chains[sid].length > 0 &&
        loaded.chains[sid][0].version === APP_CONFIG.protocol.version
    );

  if (hasValidChains) {
    state.selectedDayIndex = loaded.selectedDayIndex || { jihoon: 0, leehyun: 0 };
    state.solved = loaded.solved || { jihoon: {}, leehyun: {} };
    state.problems = loaded.problems || structuredClone(DEFAULT_MATH_PROBLEMS);
    state.chains = loaded.chains;
    for (const sid of studentIds) {
      state.selectedBlockIndex[sid] = Math.max(0, state.chains[sid].length - 1);
    }
  } else {
    state.selectedDayIndex = { jihoon: 0, leehyun: 0 };
    state.solved = { jihoon: {}, leehyun: {} };
    state.problems = structuredClone(DEFAULT_MATH_PROBLEMS);
    await initFreshChains();
    saveState();
  }
}

function getPendingMathForActiveDay(sid) {
  const list = state.problems[sid] || [];
  const idx = Math.min(state.selectedDayIndex[sid] || 0, Math.max(0, list.length - 1));
  const day = list[idx];
  if (!day) return { day: null, solvedDay: {}, mined: {}, pending: { canMine: false, rewardAmount: 0, parts: [] } };
  const solvedDay = state.solved[sid][day.id] || { basic: false, adv: false };
  const mined = getMinedPartsForDay(state.chains[sid], day.id);
  const pending = computePendingMathReward({ solvedDay, minedParts: mined, tiers: APP_CONFIG.tiers });
  return { day, solvedDay, mined, pending };
}

function getBlockTheme(block) {
  if (block.module === 'genesis' || block.tier === 'GENESIS') {
    return {
      tileAccent: 'border-t-slate-400 bg-white',
      badgeCls: 'bg-[#F2F4F6] text-[#4E5968]',
      amountCls: 'text-[#4E5968]'
    };
  }
  if (block.module === 'math') {
    if (block.tier === 'MASTER') {
      return {
        tileAccent: 'border-t-amber-500 bg-amber-50/40',
        badgeCls: 'bg-amber-100 text-amber-800',
        amountCls: 'text-amber-700'
      };
    }
    if (block.tier === 'BOOST') {
      return {
        tileAccent: 'border-t-violet-500 bg-violet-50/35',
        badgeCls: 'bg-violet-100 text-violet-800',
        amountCls: 'text-violet-700'
      };
    }
    return {
      tileAccent: 'border-t-[#3182F6] bg-[#F5F9FF]',
      badgeCls: 'bg-[#E8F3FF] text-[#1B64DA]',
      amountCls: 'text-[#1B64DA]'
    };
  }
  if (block.module === 'game') {
    return {
      tileAccent: 'border-t-rose-500 bg-rose-50/40',
      badgeCls: 'bg-rose-100 text-rose-700',
      amountCls: 'text-rose-600'
    };
  }
  if (block.module === 'memory') {
    return {
      tileAccent: 'border-t-emerald-500 bg-emerald-50/40',
      badgeCls: 'bg-emerald-100 text-emerald-800',
      amountCls: 'text-emerald-700'
    };
  }
  if (block.module === 'study') {
    return {
      tileAccent: 'border-t-sky-500 bg-sky-50/40',
      badgeCls: 'bg-sky-100 text-sky-800',
      amountCls: 'text-sky-700'
    };
  }
  return {
    tileAccent: 'border-t-purple-500 bg-purple-50/35',
    badgeCls: 'bg-purple-100 text-purple-800',
    amountCls: 'text-purple-700'
  };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function renderHeaderMeta() {
  const modeBadge = document.getElementById('networkModeBadge');
  if (APP_CONFIG.protocol.networkMode === 'official') {
    modeBadge.textContent = 'OFFICIAL';
    modeBadge.className = 'text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 font-mono-code';
  } else {
    modeBadge.textContent = 'PREVIEW';
    modeBadge.className = 'text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200/80 font-mono-code';
  }

  const parentBar = document.getElementById('parentBar');
  const toggleBtn = document.getElementById('btnParentToggle');
  const toggleLabel = document.getElementById('parentToggleLabel');
  if (state.parentUnlocked) {
    parentBar.classList.remove('hidden');
    toggleLabel.textContent = '학부모 잠금';
    toggleBtn.className = 'inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-[#191F28] hover:bg-[#333D4B] text-white transition cursor-pointer';
  } else {
    parentBar.classList.add('hidden');
    toggleLabel.textContent = '학부모 모드';
    toggleBtn.className = 'inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-[#F2F4F6] hover:bg-[#E5E8EB] text-[#333D4B] transition cursor-pointer';
  }
}

function renderTabsAndStats() {
  const jStats = summarizeChain(state.chains.jihoon);
  const lStats = summarizeChain(state.chains.leehyun);
  const unit = APP_CONFIG.rewardUnit;

  document.getElementById('badgeJihoonTime').textContent = `${jStats.balanceTime} ${unit}`;
  document.getElementById('badgeJihoonBlocks').textContent = `${jStats.count} 블록`;
  document.getElementById('badgeLeehyunTime').textContent = `${lStats.balanceTime} ${unit}`;
  document.getElementById('badgeLeehyunBlocks').textContent = `${lStats.count} 블록`;

  const tabJ = document.getElementById('tabJihoon');
  const tabL = document.getElementById('tabLeehyun');
  if (state.activeStudent === 'jihoon') {
    tabJ.className = 'flex-1 rounded-2xl px-4 py-3.5 text-left transition cursor-pointer flex items-center justify-between bg-[#3182F6] text-white shadow-md shadow-blue-500/20';
    tabL.className = 'flex-1 rounded-2xl px-4 py-3.5 text-left transition cursor-pointer flex items-center justify-between bg-[#F4F6F9] text-[#4E5968] hover:bg-[#E5E8EB]';
  } else {
    tabL.className = 'flex-1 rounded-2xl px-4 py-3.5 text-left transition cursor-pointer flex items-center justify-between bg-[#00A884] text-white shadow-md shadow-emerald-500/20';
    tabJ.className = 'flex-1 rounded-2xl px-4 py-3.5 text-left transition cursor-pointer flex items-center justify-between bg-[#F4F6F9] text-[#4E5968] hover:bg-[#E5E8EB]';
  }

  const sid = state.activeStudent;
  const activeStats = sid === 'jihoon' ? jStats : lStats;
  const lifeCount =
    (activeStats.moduleCounts.memory || 0) +
    (activeStats.moduleCounts.study || 0) +
    (activeStats.moduleCounts.project || 0) +
    (activeStats.moduleCounts.bundle || 0);

  document.getElementById('statTime').textContent = activeStats.balanceTime;
  document.getElementById('statUnit').textContent = unit;
  document.getElementById('statTimeBreakdown').textContent = `+${activeStats.earnedTime} 획득 · -${activeStats.spentTime} 사용`;
  document.getElementById('statHeight').textContent = `#${activeStats.height}`;
  document.getElementById('statBlocksCount').textContent = `총 ${activeStats.count}개`;
  document.getElementById('statMathCount').textContent = activeStats.moduleCounts.math || 0;
  document.getElementById('statLifeCount').textContent = lifeCount;
  document.getElementById('statGameCount').textContent = activeStats.moduleCounts.game || 0;
  document.getElementById('statDifficulty').textContent = `${APP_CONFIG.protocol.difficultyPrefix}...`;
  document.getElementById('statAnchored').textContent = `앵커 ${activeStats.anchoredCount}`;

  const name = APP_CONFIG.students[sid].name;
  document.getElementById('explorerTitle').textContent = `${name}의 블록체인 타임라인`;
  document.getElementById('activeStudentTitle').textContent = `${name}의 오늘의 미션`;
  document.getElementById('chainLedgerTitle').textContent = `${name}의 성장 장부`;
}

function renderBlockExplorer() {
  const sid = state.activeStudent;
  const chain = state.chains[sid] || [];
  const unit = APP_CONFIG.rewardUnit;
  const ribbon = document.getElementById('blockRibbon');
  ribbon.innerHTML = '';

  const maxIdx = Math.max(0, chain.length - 1);
  if (state.selectedBlockIndex[sid] === undefined || state.selectedBlockIndex[sid] > maxIdx) {
    state.selectedBlockIndex[sid] = maxIdx;
  }
  const selectedIdx = state.selectedBlockIndex[sid];

  const reversed = [...chain].reverse();
  reversed.forEach((block, pos) => {
    const modMeta = APP_CONFIG.modules[block.module] || { icon: '🧱', label: block.module };
    const theme = getBlockTheme(block);
    const isSelected = block.index === selectedIdx;
    const amt = Number(block.reward?.amount || 0);
    const labelText = block.payload?.label || modMeta.label;
    const anchored = Boolean(block.onchain && block.onchain.txHash);

    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = `block-tile w-36 shrink-0 rounded-2xl border border-[#E5E8EB] border-t-4 p-3.5 text-left flex flex-col justify-between cursor-pointer ${theme.tileAccent} ${
      isSelected ? 'ring-2 ring-[#3182F6] ring-offset-2 ring-offset-white shadow-md' : ''
    }`;
    tile.innerHTML = `
      <div class="flex items-center justify-between text-xs font-bold text-[#4E5968]">
        <span class="font-mono-code">#${block.index}</span>
        <span>${escapeHtml(modMeta.icon)}${anchored ? ' ⛓️' : ''}</span>
      </div>
      <div class="my-2">
        <div class="text-[13px] font-extrabold font-mono-code ${theme.amountCls}">
          ${block.module === 'genesis' ? 'GENESIS' : amt === 0 ? '기록 저장' : formatTimeDelta(amt, block.reward?.unit || unit)}
        </div>
        <div class="text-xs font-semibold text-[#191F28] truncate mt-0.5">${escapeHtml(labelText)}</div>
      </div>
      <div class="flex items-center justify-between text-[10px] font-mono-code text-[#8B95A1]">
        <span>${escapeHtml(block.hash.slice(0, 7))}…</span>
        <span>${escapeHtml(block.timestamp.slice(5, 10))}</span>
      </div>
    `;
    tile.addEventListener('click', () => {
      state.selectedBlockIndex[sid] = block.index;
      renderBlockExplorer();
      renderChain();
    });
    ribbon.appendChild(tile);

    if (pos < reversed.length - 1) {
      const linkArrow = document.createElement('div');
      linkArrow.className = 'flex items-center text-[#B0B8C1] text-xs font-mono-code shrink-0 select-none';
      linkArrow.textContent = '→';
      linkArrow.title = 'prevHash 암호학적 연결';
      ribbon.appendChild(linkArrow);
    }
  });

  renderBlockInspector(chain[selectedIdx], chain.length);
}

function renderBlockInspector(block, totalCount) {
  const container = document.getElementById('blockInspector');
  if (!block) {
    container.innerHTML = '';
    return;
  }

  const sid = state.activeStudent;
  const modMeta = APP_CONFIG.modules[block.module] || { icon: '🧱', label: block.module };
  const tierMeta = APP_CONFIG.tiers[block.tier] || { badge: block.tier };
  const theme = getBlockTheme(block);
  const txUrl = block.onchain?.txHash
    ? getExplorerTxUrl(APP_CONFIG.onchain, block.onchain.txHash, block.onchain.network)
    : null;

  let contentHtml = '';
  if (block.module === 'genesis') {
    contentHtml = `
      <div class="rounded-xl bg-white border border-[#E5E8EB] p-3.5 text-xs space-y-1">
        <div class="font-bold text-[#191F28]">🌱 ${escapeHtml(block.payload?.note || 'Genesis Block')}</div>
        <div class="text-[#6B7684]">소유자: <span class="font-semibold text-[#333D4B]">${escapeHtml(block.payload?.studentName || sid)}</span> · 모드: <span class="font-mono-code font-semibold text-amber-700">${escapeHtml(block.payload?.networkMode || 'preview')}</span></div>
      </div>
    `;
  } else if (block.module === 'math') {
    const parts = Array.isArray(block.payload?.parts) ? block.payload.parts : [];
    const cards = parts
      .map((part) => {
        const isBasic = part === 'basic';
        const topic = block.payload?.topics?.[part] || (isBasic ? '기본 문제' : '심화 문제');
        const proof = block.payload?.proofs?.[part] || '';
        return `
          <div class="rounded-xl bg-white border border-[#E5E8EB] p-3 flex items-center justify-between gap-2">
            <div class="flex items-center gap-2">
              <span class="px-2 py-0.5 rounded-md text-[11px] font-bold ${isBasic ? 'bg-[#E8F3FF] text-[#1B64DA]' : 'bg-amber-100 text-amber-800'}">${isBasic ? '기본 +1 TIME' : '심화 +2 TIME'}</span>
              <span class="text-xs font-semibold text-[#191F28]">${escapeHtml(topic)}</span>
            </div>
            <span class="text-[10px] font-mono-code text-[#8B95A1] truncate max-w-[130px]" title="${escapeHtml(proof)}">Proof ${escapeHtml(proof.slice(0, 10))}…</span>
          </div>
        `;
      })
      .join('');
    const noteHtml = block.payload?.note
      ? `<div class="rounded-xl bg-amber-50/70 border border-amber-200/70 px-3.5 py-2.5 text-xs text-[#333D4B]">
           <span class="font-bold text-amber-800 mr-1.5">${escapeHtml(block.payload.mood || '✨')} 한 줄 추억:</span>${escapeHtml(block.payload.note)}
         </div>`
      : '';
    contentHtml = `<div class="space-y-2">${cards}${noteHtml}</div>`;
  } else if (Array.isArray(block.payload?.activities)) {
    const actCards = block.payload.activities
      .map((act) => {
        const catMeta = APP_CONFIG.modules[act.category] || { icon: '✨', label: act.category };
        const tagsHtml = (act.tags || [])
          .map((t) => `<span class="px-2 py-0.5 rounded-md bg-[#F2F4F6] text-[11px] font-medium text-[#4E5968]">#${escapeHtml(t)}</span>`)
          .join(' ');
        const linkHtml =
          act.link && isSafeHttpUrl(act.link)
            ? `<a href="${escapeHtml(act.link)}" target="_blank" rel="noopener noreferrer" class="text-xs text-[#3182F6] hover:underline break-all">🔗 ${escapeHtml(act.link)}</a>`
            : '';
        return `
          <div class="rounded-xl bg-white border border-[#E5E8EB] p-3.5 space-y-2">
            <div class="flex items-center justify-between gap-2 flex-wrap">
              <div class="flex items-center gap-2">
                <span class="text-base">${escapeHtml(act.mood || catMeta.icon)}</span>
                <span class="text-sm font-bold text-[#191F28]">${escapeHtml(act.title)}</span>
                <span class="px-2 py-0.5 rounded-md text-[11px] font-semibold bg-[#F2F4F6] text-[#4E5968]">${escapeHtml(catMeta.label)}</span>
              </div>
              <div class="flex items-center gap-2 text-xs font-mono-code">
                ${act.durationMinutes ? `<span class="text-[#6B7684]">${act.durationMinutes}분</span>` : ''}
                <span class="font-bold ${act.timeDelta < 0 ? 'text-rose-600' : 'text-emerald-700'}">${act.timeDelta === 0 ? '자유 기록' : escapeHtml(formatTimeDelta(act.timeDelta))}</span>
              </div>
            </div>
            ${act.memo ? `<p class="text-[13px] text-[#333D4B] leading-relaxed whitespace-pre-line">${escapeHtml(act.memo)}</p>` : ''}
            ${tagsHtml || linkHtml ? `<div class="flex items-center gap-2 flex-wrap pt-0.5">${tagsHtml}${linkHtml}</div>` : ''}
          </div>
        `;
      })
      .join('');
    contentHtml = `<div class="space-y-2">${actCards}</div>`;
  }

  container.innerHTML = `
    <div class="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[#E5E8EB]">
      <div class="flex items-center gap-2 flex-wrap">
        <span class="font-mono-code text-sm font-extrabold text-[#191F28]">Block #${block.index}</span>
        <span class="px-2.5 py-0.5 rounded-lg text-[11px] font-bold ${theme.badgeCls}">${escapeHtml(tierMeta.badge)}</span>
        <span class="text-xs font-medium text-[#6B7684]">${escapeHtml(block.payload?.label || modMeta.label)}</span>
        ${txUrl ? `<a href="${escapeHtml(txUrl)}" target="_blank" rel="noopener noreferrer" class="px-2 py-0.5 rounded-lg text-[11px] font-bold bg-[#E8F3FF] text-[#1B64DA] hover:bg-[#D4E7FF]">⛓️ BaseScan</a>` : ''}
      </div>
      <div class="flex items-center gap-1.5">
        <button id="btnInspPrev" type="button" ${block.index <= 0 ? 'disabled' : ''} class="px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-white border border-[#E5E8EB] text-[#333D4B] hover:bg-[#F2F4F6] disabled:opacity-35 cursor-pointer disabled:cursor-not-allowed">← 이전</button>
        <button id="btnInspNext" type="button" ${block.index >= totalCount - 1 ? 'disabled' : ''} class="px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-white border border-[#E5E8EB] text-[#333D4B] hover:bg-[#F2F4F6] disabled:opacity-35 cursor-pointer disabled:cursor-not-allowed">다음 →</button>
      </div>
    </div>

    <div class="space-y-2">${contentHtml}</div>

    <div class="grid grid-cols-1 md:grid-cols-2 gap-2.5 text-[11px] font-mono-code">
      <div class="rounded-xl bg-white border border-[#E5E8EB] p-3 space-y-1">
        <div class="text-[#8B95A1]">Hash: <span class="text-emerald-700 font-semibold break-all">${escapeHtml(block.hash)}</span></div>
        <div class="text-[#8B95A1]">Prev: ${
          block.index > 0
            ? `<button id="btnJumpPrevHash" type="button" class="text-[#3182F6] hover:underline break-all text-left cursor-pointer">${escapeHtml(block.prevHash)}</button>`
            : `<span class="text-[#6B7684] break-all">${escapeHtml(block.prevHash)}</span>`
        }</div>
      </div>
      <div class="rounded-xl bg-white border border-[#E5E8EB] p-3 grid grid-cols-2 gap-2">
        <div><span class="text-[#8B95A1] block text-[10px]">기록 시각</span><span class="text-[#191F28] font-medium">${escapeHtml(block.timestamp.replace('T', ' ').slice(0, 19))}</span></div>
        <div><span class="text-[#8B95A1] block text-[10px]">PoW Nonce</span><span class="text-emerald-700 font-bold">${block.nonce}</span></div>
        <div><span class="text-[#8B95A1] block text-[10px]">TIME 변동</span><span class="font-bold ${theme.amountCls}">${escapeHtml(formatTimeDelta(block.reward?.amount, block.reward?.unit))}</span></div>
        <div><span class="text-[#8B95A1] block text-[10px]">모듈 / 난이도</span><span class="text-[#191F28]">${escapeHtml(block.module)} (${escapeHtml(block.difficulty)})</span></div>
      </div>
    </div>

    <details class="text-[11px] font-mono-code">
      <summary class="text-[#8B95A1] hover:text-[#333D4B] cursor-pointer select-none">Protocol v1 원시 JSON 보기</summary>
      <pre class="mt-2 p-3 rounded-xl bg-white border border-[#E5E8EB] text-[#4E5968] overflow-x-auto text-[10px]">${escapeHtml(JSON.stringify(block, null, 2))}</pre>
    </details>
  `;

  const btnPrev = document.getElementById('btnInspPrev');
  const btnNext = document.getElementById('btnInspNext');
  const btnJumpPrev = document.getElementById('btnJumpPrevHash');
  if (btnPrev) {
    btnPrev.addEventListener('click', () => {
      if (block.index > 0) {
        state.selectedBlockIndex[sid] = block.index - 1;
        renderBlockExplorer();
        renderChain();
      }
    });
  }
  if (btnNext) {
    btnNext.addEventListener('click', () => {
      if (block.index < totalCount - 1) {
        state.selectedBlockIndex[sid] = block.index + 1;
        renderBlockExplorer();
        renderChain();
      }
    });
  }
  if (btnJumpPrev) {
    btnJumpPrev.addEventListener('click', () => {
      state.selectedBlockIndex[sid] = block.index - 1;
      renderBlockExplorer();
      renderChain();
    });
  }
}

function renderWorkspaceMode() {
  const isMath = state.activePanel === 'math';
  document.getElementById('panelMath').classList.toggle('hidden', !isMath);
  document.getElementById('panelActivity').classList.toggle('hidden', isMath);

  const tabMath = document.getElementById('modeTabMath');
  const tabAct = document.getElementById('modeTabActivity');
  if (isMath) {
    tabMath.className = 'py-2.5 px-3 rounded-xl text-[13px] font-bold transition cursor-pointer flex items-center justify-center gap-1.5 bg-white text-[#191F28] shadow-xs';
    tabAct.className = 'py-2.5 px-3 rounded-xl text-[13px] font-semibold transition cursor-pointer flex items-center justify-center gap-1.5 text-[#6B7684] hover:text-[#191F28]';
  } else {
    tabAct.className = 'py-2.5 px-3 rounded-xl text-[13px] font-bold transition cursor-pointer flex items-center justify-center gap-1.5 bg-white text-[#191F28] shadow-xs';
    tabMath.className = 'py-2.5 px-3 rounded-xl text-[13px] font-semibold transition cursor-pointer flex items-center justify-center gap-1.5 text-[#6B7684] hover:text-[#191F28]';
  }

  renderActivityCategoryUI();
}

function renderActivityCategoryUI() {
  const cat = state.activityCategory;
  document.querySelectorAll('#activityCategoryBtns [data-act-cat]').forEach((btn) => {
    const c = btn.getAttribute('data-act-cat');
    if (c === cat) {
      btn.className = 'rounded-xl px-2.5 py-2.5 text-xs font-bold border transition cursor-pointer text-center bg-[#191F28] border-[#191F28] text-white shadow-xs';
    } else {
      btn.className = 'rounded-xl px-2.5 py-2.5 text-xs font-semibold border transition cursor-pointer text-center bg-white border-[#E5E8EB] text-[#4E5968] hover:bg-[#F2F4F6]';
    }
  });

  const def = ACTIVITY_DEFAULTS[cat];
  const notice = document.getElementById('actRuleNotice');
  const spendWrap = document.getElementById('actSpendWrap');
  const mineLabel = document.getElementById('btnActMineLabel');

  if (def) {
    document.getElementById('actTitle').placeholder = def.placeholderTitle;
    document.getElementById('actMemo').placeholder = def.placeholderMemo;
  }

  if (cat === 'game') {
    const stats = summarizeChain(state.chains[state.activeStudent]);
    spendWrap.classList.remove('hidden');
    notice.className = 'rounded-xl px-3.5 py-2.5 text-xs font-medium bg-rose-50 text-rose-700 border border-rose-200/80';
    notice.textContent = `🎮 게임·자유시간 사용은 보유 잔액(현재 ${stats.balanceTime} TIME)에서 스스로 차감하여 기록합니다.`;
    mineLabel.textContent = 'TIME 사용하고 블록으로 기록하기';
  } else {
    spendWrap.classList.add('hidden');
    notice.className = 'rounded-xl px-3.5 py-2.5 text-xs font-medium bg-emerald-50 text-emerald-800 border border-emerald-200/80';
    notice.textContent = `✨ ${def.label}은 0 TIME 자유 기록입니다. 부모 승인 없이 언제든 내 체인에 영구 보존할 수 있어요.`;
    mineLabel.textContent = '바로 블록으로 영구 기록하기';
  }
}

function renderProblems() {
  const sid = state.activeStudent;
  const list = state.problems[sid] || [];
  const dayIdx = Math.min(state.selectedDayIndex[sid] || 0, Math.max(0, list.length - 1));
  state.selectedDayIndex[sid] = dayIdx;

  const select = document.getElementById('daySelect');
  select.innerHTML = '';
  list.forEach((p, idx) => {
    const opt = document.createElement('option');
    opt.value = String(idx);
    const mined = getMinedPartsForDay(state.chains[sid], p.id);
    let tag = '';
    if (mined.allMined) tag = ' · 완료(3T)';
    else if (mined.advMined) tag = ' · 심화완료(2T)';
    else if (mined.basicMined) tag = ' · 기본완료(1T)';
    opt.textContent = `${p.label}${tag}`;
    if (idx === dayIdx) opt.selected = true;
    select.appendChild(opt);
  });

  const day = list[dayIdx];
  if (!day) return;

  const solvedDay = state.solved[sid][day.id] || { basic: false, adv: false };
  const mined = getMinedPartsForDay(state.chains[sid], day.id);
  const unit = APP_CONFIG.rewardUnit;

  // Basic
  document.getElementById('basicTopic').textContent = day.basic.topic;
  document.getElementById('basicQuestion').textContent = day.basic.question;
  const inputBasic = document.getElementById('inputBasic');
  const btnBasic = document.getElementById('btnCheckBasic');
  const badgeBasic = document.getElementById('basicStatusBadge');
  const cardBasic = document.getElementById('cardBasic');

  if (mined.basicMined) {
    badgeBasic.textContent = `채굴 완료 ✓ (+${APP_CONFIG.tiers.CORE.reward} ${unit})`;
    badgeBasic.className = 'text-xs font-bold text-emerald-600';
    cardBasic.className = 'rounded-2xl border border-emerald-200 bg-emerald-50/40 p-4 space-y-3 transition';
    inputBasic.disabled = true;
    inputBasic.value = '블록 기록 완료';
    btnBasic.disabled = true;
    btnBasic.className = 'px-4 py-2.5 rounded-xl text-xs font-bold bg-emerald-100 text-emerald-700 cursor-not-allowed shrink-0';
  } else if (solvedDay.basic) {
    badgeBasic.textContent = '정답 완료 · 채굴 가능 ✓';
    badgeBasic.className = 'text-xs font-bold text-[#1B64DA]';
    cardBasic.className = 'rounded-2xl border border-blue-200 bg-[#F5F9FF] p-4 space-y-3 transition';
    inputBasic.disabled = true;
    inputBasic.value = '해시 검증 완료';
    btnBasic.disabled = true;
    btnBasic.className = 'px-4 py-2.5 rounded-xl text-xs font-bold bg-[#E8F3FF] text-[#1B64DA] cursor-not-allowed shrink-0';
  } else {
    badgeBasic.textContent = '미해결';
    badgeBasic.className = 'text-xs font-medium text-[#8B95A1]';
    cardBasic.className = 'rounded-2xl border border-[#E5E8EB] bg-[#F9FAFB] p-4 space-y-3 transition';
    inputBasic.disabled = false;
    inputBasic.value = '';
    btnBasic.disabled = false;
    btnBasic.className = 'px-4 py-2.5 rounded-xl text-xs font-bold bg-[#3182F6] hover:bg-[#1B64DA] text-white transition cursor-pointer shrink-0';
  }

  // Advanced
  document.getElementById('advTopic').textContent = day.adv.topic;
  document.getElementById('advQuestion').textContent = day.adv.question;
  const inputAdv = document.getElementById('inputAdv');
  const btnAdv = document.getElementById('btnCheckAdv');
  const badgeAdv = document.getElementById('advStatusBadge');
  const cardAdv = document.getElementById('cardAdv');

  if (mined.advMined) {
    badgeAdv.textContent = `채굴 완료 ✓ (+${APP_CONFIG.tiers.BOOST.reward} ${unit})`;
    badgeAdv.className = 'text-xs font-bold text-emerald-600';
    cardAdv.className = 'rounded-2xl border border-emerald-200 bg-emerald-50/40 p-4 space-y-3 transition';
    inputAdv.disabled = true;
    inputAdv.value = '블록 기록 완료';
    btnAdv.disabled = true;
    btnAdv.className = 'px-4 py-2.5 rounded-xl text-xs font-bold bg-emerald-100 text-emerald-700 cursor-not-allowed shrink-0';
  } else if (solvedDay.adv) {
    badgeAdv.textContent = '정답 완료 · 채굴 가능 ✓';
    badgeAdv.className = 'text-xs font-bold text-amber-700';
    cardAdv.className = 'rounded-2xl border border-amber-200 bg-amber-50/40 p-4 space-y-3 transition';
    inputAdv.disabled = true;
    inputAdv.value = '해시 검증 완료';
    btnAdv.disabled = true;
    btnAdv.className = 'px-4 py-2.5 rounded-xl text-xs font-bold bg-amber-100 text-amber-800 cursor-not-allowed shrink-0';
  } else {
    badgeAdv.textContent = '미해결';
    badgeAdv.className = 'text-xs font-medium text-[#8B95A1]';
    cardAdv.className = 'rounded-2xl border border-[#E5E8EB] bg-[#F9FAFB] p-4 space-y-3 transition';
    inputAdv.disabled = false;
    inputAdv.value = '';
    btnAdv.disabled = false;
    btnAdv.className = 'px-4 py-2.5 rounded-xl text-xs font-bold bg-amber-500 hover:bg-amber-600 text-white transition cursor-pointer shrink-0';
  }

  renderMiningConsole();
}

function renderMiningConsole() {
  const sid = state.activeStudent;
  const unit = APP_CONFIG.rewardUnit;
  const btnMine = document.getElementById('btnMine');
  const btnMineText = document.getElementById('btnMineText');
  const tierLabel = document.getElementById('miningTierLabel');
  const miningBox = document.getElementById('miningBox');
  miningBox.classList.remove('mining-glow');

  const { mined, pending } = getPendingMathForActiveDay(sid);
  if (mined.allMined) {
    btnMine.disabled = true;
    btnMine.className = 'w-full py-3.5 rounded-2xl font-bold text-sm transition flex items-center justify-center gap-2 bg-emerald-50 text-emerald-700 border border-emerald-200 cursor-not-allowed';
    btnMineText.textContent = `오늘 미션 올클리어 완료! (+${APP_CONFIG.tiers.MASTER.reward} ${unit})`;
    tierLabel.textContent = '최고 보상 달성 👑';
    tierLabel.className = 'text-xs font-bold text-emerald-700';
  } else if (pending.canMine) {
    const tierMeta = APP_CONFIG.tiers[pending.tier];
    btnMine.disabled = state.isMining;
    if (pending.tier === 'MASTER') {
      btnMine.className = 'w-full py-3.5 rounded-2xl font-bold text-sm transition flex items-center justify-center gap-2 cursor-pointer bg-amber-500 hover:bg-amber-600 text-white shadow-md shadow-amber-500/20';
      tierLabel.textContent = '기본+심화 모두 정답! 최고 보상';
      tierLabel.className = 'text-xs font-bold text-amber-700';
    } else if (pending.tier === 'BOOST') {
      btnMine.className = 'w-full py-3.5 rounded-2xl font-bold text-sm transition flex items-center justify-center gap-2 cursor-pointer bg-violet-600 hover:bg-violet-700 text-white shadow-md shadow-violet-500/20';
      tierLabel.textContent = mined.basicMined ? '심화까지 해결! 추가 +2 TIME' : '심화 정답! 기본도 풀면 한 번에 +3 TIME';
      tierLabel.className = 'text-xs font-bold text-violet-700';
    } else {
      btnMine.className = 'w-full py-3.5 rounded-2xl font-bold text-sm transition flex items-center justify-center gap-2 cursor-pointer bg-[#3182F6] hover:bg-[#1B64DA] text-white shadow-md shadow-blue-500/20';
      tierLabel.textContent = mined.advMined ? '기본까지 해결! 추가 +1 TIME' : '기본 정답! 심화도 풀면 한 번에 +3 TIME';
      tierLabel.className = 'text-xs font-bold text-[#1B64DA]';
    }
    btnMineText.textContent = `${tierMeta.label} 블록 채굴하기 (+${pending.rewardAmount} ${unit})`;
  } else if (mined.basicMined) {
    btnMine.disabled = true;
    btnMine.className = 'w-full py-3.5 rounded-2xl font-bold text-sm transition flex items-center justify-center gap-2 bg-[#F2F4F6] text-[#6B7684] cursor-not-allowed';
    btnMineText.textContent = `기본 채굴 완료 · 심화 풀면 +${APP_CONFIG.tiers.BOOST.reward} ${unit} 추가`;
    tierLabel.textContent = '심화 문제 도전 대기';
    tierLabel.className = 'text-xs font-medium text-[#6B7684]';
  } else if (mined.advMined) {
    btnMine.disabled = true;
    btnMine.className = 'w-full py-3.5 rounded-2xl font-bold text-sm transition flex items-center justify-center gap-2 bg-[#F2F4F6] text-[#6B7684] cursor-not-allowed';
    btnMineText.textContent = `심화 채굴 완료 · 기본 풀면 +${APP_CONFIG.tiers.CORE.reward} ${unit} 추가`;
    tierLabel.textContent = '기본 문제 도전 대기';
    tierLabel.className = 'text-xs font-medium text-[#6B7684]';
  } else {
    btnMine.disabled = true;
    btnMine.className = 'w-full py-3.5 rounded-2xl font-bold text-sm transition flex items-center justify-center gap-2 bg-[#F2F4F6] text-[#8B95A1] cursor-not-allowed';
    btnMineText.textContent = '문제를 풀면 채굴할 수 있어요';
    tierLabel.textContent = '문제를 풀면 채굴이 열려요';
    tierLabel.className = 'text-xs font-medium text-[#8B95A1]';
  }
}

function blockMatchesFilter(block, filter, query) {
  if (filter !== 'all') {
    const categories = Array.isArray(block.payload?.categories) ? block.payload.categories : [];
    if (block.module !== filter && !categories.includes(filter)) {
      return false;
    }
  }
  if (query) {
    const haystack = JSON.stringify({
      index: block.index,
      module: block.module,
      tier: block.tier,
      timestamp: block.timestamp,
      payload: block.payload
    }).toLowerCase();
    if (!haystack.includes(query)) return false;
  }
  return true;
}

function renderChain() {
  const sid = state.activeStudent;
  const chain = state.chains[sid] || [];
  const container = document.getElementById('chainList');
  container.innerHTML = '';

  document.querySelectorAll('#ledgerFilterBar [data-filter]').forEach((btn) => {
    const f = btn.getAttribute('data-filter');
    if (f === state.ledgerFilter) {
      btn.className = 'px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer bg-[#191F28] text-white';
    } else {
      btn.className = 'px-3 py-1.5 rounded-xl text-xs font-semibold transition cursor-pointer bg-[#F2F4F6] text-[#4E5968] hover:bg-[#E5E8EB]';
    }
  });

  const query = state.ledgerSearch.trim().toLowerCase();
  const filtered = [...chain].reverse().filter((b) => blockMatchesFilter(b, state.ledgerFilter, query));

  if (filtered.length === 0) {
    container.innerHTML = '<div class="text-xs text-[#8B95A1] text-center py-10">조건에 일치하는 블록 기록이 없습니다.</div>';
    return;
  }

  filtered.forEach((block) => {
    const tierMeta = APP_CONFIG.tiers[block.tier] || { badge: block.tier };
    const modMeta = APP_CONFIG.modules[block.module] || { icon: '🧱', label: block.module };
    const theme = getBlockTheme(block);
    const amt = Number(block.reward?.amount || 0);
    const rewardText = block.module === 'genesis' ? '' : amt === 0 ? '' : ` ${formatTimeDelta(amt, block.reward?.unit)}`;
    const isSelected = state.selectedBlockIndex[sid] === block.index;
    const labelText = block.payload?.label || modMeta.label;

    let snippetHtml = '';
    if (Array.isArray(block.payload?.activities) && block.payload.activities.length > 0) {
      const first = block.payload.activities[0];
      snippetHtml = `
        <div class="text-xs text-[#333D4B] bg-[#F9FAFB] rounded-xl px-3 py-2.5 border border-[#E5E8EB]">
          <div class="font-bold text-[#191F28]">${escapeHtml(first.mood || modMeta.icon)} ${escapeHtml(first.title)}</div>
          ${first.memo ? `<div class="text-xs text-[#6B7684] mt-1 leading-relaxed">${escapeHtml(first.memo)}</div>` : ''}
        </div>
      `;
    } else if (block.module === 'math') {
      const topicSummary = block.payload?.topics ? Object.values(block.payload.topics).join(' · ') : '';
      const noteLine = block.payload?.note
        ? `<div class="text-xs text-[#4E5968] mt-1">${escapeHtml(block.payload.mood || '✨')} ${escapeHtml(block.payload.note)}</div>`
        : '';
      snippetHtml = `<div class="text-xs text-[#4E5968] bg-[#F9FAFB] rounded-xl px-3 py-2 border border-[#E5E8EB]">
        <div class="font-medium">📐 ${escapeHtml(topicSummary)}</div>${noteLine}
      </div>`;
    }

    const txUrl = block.onchain?.txHash
      ? getExplorerTxUrl(APP_CONFIG.onchain, block.onchain.txHash, block.onchain.network)
      : null;

    const card = document.createElement('div');
    card.className = `rounded-2xl border p-4 space-y-2.5 transition cursor-pointer bg-white ${
      isSelected ? 'border-[#3182F6] ring-1 ring-[#3182F6]/30 shadow-sm' : 'border-[#E5E8EB] hover:border-[#CBD5E1]'
    }`;
    card.innerHTML = `
      <div class="flex items-center justify-between gap-2 flex-wrap">
        <div class="flex items-center gap-2 flex-wrap">
          <span class="font-mono-code text-sm font-extrabold text-[#191F28]">#${block.index}</span>
          <span class="px-2 py-0.5 rounded-lg text-[11px] font-bold ${theme.badgeCls}">${escapeHtml(tierMeta.badge)}${escapeHtml(rewardText)}</span>
          ${txUrl ? `<a href="${escapeHtml(txUrl)}" target="_blank" rel="noopener noreferrer" class="px-2 py-0.5 rounded-lg text-[10px] font-bold bg-[#E8F3FF] text-[#1B64DA]">⛓️ Base</a>` : ''}
        </div>
        <span class="text-xs font-medium text-[#6B7684]">${escapeHtml(labelText)}</span>
      </div>
      ${snippetHtml}
      <div class="flex items-center justify-between text-[11px] text-[#8B95A1] font-mono-code">
        <span>${escapeHtml(block.timestamp.replace('T', ' ').slice(0, 16))}</span>
        <span>Hash ${escapeHtml(block.hash.slice(0, 12))}… · Nonce ${block.nonce}</span>
      </div>
    `;
    card.addEventListener('click', (e) => {
      if (e.target.closest('a')) return;
      state.selectedBlockIndex[sid] = block.index;
      renderBlockExplorer();
      renderChain();
      document.getElementById('blockInspector').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
    container.appendChild(card);
  });
}

function renderAll() {
  renderHeaderMeta();
  renderTabsAndStats();
  renderBlockExplorer();
  renderWorkspaceMode();
  renderProblems();
  renderChain();
  if (globalThis.lucide) {
    globalThis.lucide.createIcons();
  }
}

// ---------------------------------------------------------------------------
// Core Interactions & Immediate PoW Mining
// ---------------------------------------------------------------------------

async function handleCheckAnswer(kind) {
  const sid = state.activeStudent;
  const list = state.problems[sid] || [];
  const day = list[state.selectedDayIndex[sid]];
  if (!day) return;

  const inputEl = document.getElementById(kind === 'basic' ? 'inputBasic' : 'inputAdv');
  const raw = inputEl.value;
  if (!raw.trim()) {
    showToast('정답을 입력해 주세요!', 'error');
    return;
  }

  const prob = kind === 'basic' ? day.basic : day.adv;
  const ok = await verifyAnswer(prob, raw, APP_CONFIG.protocol.answerSalt);

  if (ok) {
    if (!state.solved[sid][day.id]) {
      state.solved[sid][day.id] = { basic: false, adv: false };
    }
    state.solved[sid][day.id][kind] = true;
    saveState();
    renderAll();

    const rewardVal = kind === 'basic' ? APP_CONFIG.tiers.CORE.reward : APP_CONFIG.tiers.BOOST.reward;
    showToast(
      kind === 'basic'
        ? `정답이에요! 기본 +${rewardVal} ${APP_CONFIG.rewardUnit} 바로 채굴할 수 있어요`
        : `정답이에요! 심화 +${rewardVal} ${APP_CONFIG.rewardUnit} 바로 채굴할 수 있어요`,
      'success'
    );
  } else {
    showToast('아쉽네요! 한 번 더 차근차근 계산해 볼까요?', 'error');
    inputEl.focus();
  }
}

async function runPowMining({ sid, module, tier, rewardAmount, payload, onSuccess }) {
  if (state.isMining) return;
  state.isMining = true;
  renderMiningConsole();

  const miningBox = document.getElementById('miningBox');
  miningBox.classList.add('mining-glow');
  document.getElementById('btnMineText').textContent = 'SHA-256 논스 탐색 중...';

  const chain = state.chains[sid];
  const prevBlock = chain[chain.length - 1];
  const student = APP_CONFIG.students[sid];
  const liveNonceEl = document.getElementById('liveNonce');
  const liveHashEl = document.getElementById('liveHash');

  try {
    const newBlock = await mineBlock({
      prevBlock,
      chainId: student.chainId,
      module,
      tier,
      reward: { amount: rewardAmount, unit: APP_CONFIG.rewardUnit },
      payload,
      difficulty: APP_CONFIG.protocol.difficultyPrefix,
      minVisualMs: 550,
      onProgress: ({ nonce, hash }) => {
        liveNonceEl.textContent = String(nonce);
        liveHashEl.textContent = hash;
      }
    });

    chain.push(newBlock);
    state.selectedBlockIndex[sid] = newBlock.index;
    state.isMining = false;
    if (onSuccess) onSuccess(newBlock);
    saveState();
    renderAll();

    if (globalThis.confetti && rewardAmount >= 0) {
      globalThis.confetti({
        particleCount: tier === 'MASTER' ? 100 : rewardAmount > 0 ? 65 : 35,
        spread: 68,
        origin: { y: 0.65 }
      });
    }

    const tierMeta = APP_CONFIG.tiers[tier] || { label: tier };
    const deltaLabel = rewardAmount === 0 ? '영구 기록 완료' : formatTimeDelta(rewardAmount);
    showToast(`Block #${newBlock.index} ${tierMeta.label} 완료! (${deltaLabel})`, tier === 'MASTER' ? 'gold' : 'success');
  } catch (err) {
    state.isMining = false;
    renderMiningConsole();
    showToast(`채굴 오류: ${err.message}`, 'error');
  }
}

async function handleMathMine() {
  if (state.isMining) return;
  const sid = state.activeStudent;
  const { day, pending } = getPendingMathForActiveDay(sid);
  if (!day || !pending.canMine) return;

  const noteInput = document.getElementById('mathNoteInput');
  const moodSelect = document.getElementById('mathMoodSelect');
  const payload = buildMathBlockPayload({
    day,
    parts: pending.parts,
    note: noteInput.value,
    mood: moodSelect.value
  });

  await runPowMining({
    sid,
    module: MATH_MODULE_ID,
    tier: pending.tier,
    rewardAmount: pending.rewardAmount,
    payload,
    onSuccess: () => {
      noteInput.value = '';
    }
  });
}

async function handleActivityMine(e) {
  e.preventDefault();
  if (state.isMining) return;
  const sid = state.activeStudent;

  try {
    const tx = createActivityTx({
      category: state.activityCategory,
      title: document.getElementById('actTitle').value,
      memo: document.getElementById('actMemo').value,
      durationMinutes: document.getElementById('actDuration').value,
      spendTime: document.getElementById('actSpendTime').value,
      mood: document.getElementById('actMood').value,
      tags: document.getElementById('actTags').value,
      link: document.getElementById('actLink').value
    });

    const spec = buildActivityBlockSpec(tx);
    const btnAct = document.getElementById('btnActMineNow');
    btnAct.disabled = true;

    await runPowMining({
      sid,
      module: spec.module,
      tier: spec.tier,
      rewardAmount: spec.rewardAmount,
      payload: spec.payload,
      onSuccess: () => {
        document.getElementById('actTitle').value = '';
        document.getElementById('actMemo').value = '';
        document.getElementById('actTags').value = '';
        document.getElementById('actLink').value = '';
      }
    });

    btnAct.disabled = false;
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function handleVerifyChain() {
  const sid = state.activeStudent;
  const student = APP_CONFIG.students[sid];
  const result = await verifyChain(state.chains[sid], student.chainId);
  const banner = document.getElementById('verifyBanner');
  banner.classList.remove('hidden');

  if (result.valid) {
    banner.className = 'rounded-2xl px-4 py-3 text-xs font-semibold space-y-1 bg-emerald-50 border border-emerald-200 text-emerald-800';
    banner.innerHTML = `
      <div>✓ 검증 완료: 제네시스(#0)부터 최신 블록(#${result.height})까지 모든 해시와 활동 기록이 변조 없이 무결합니다.</div>
      <div class="font-mono-code text-[10px] text-emerald-700/80 break-all">Merkle Root: ${escapeHtml(result.merkleRoot)}</div>
    `;
  } else {
    banner.className = 'rounded-2xl px-4 py-3 text-xs font-semibold space-y-1 bg-rose-50 border border-rose-200 text-rose-700';
    banner.textContent = `⚠ 무결성 오류: ${result.reason}`;
  }
}

async function syncFeed({ silent = false } = {}) {
  const res = await fetchProblemFeed({
    feedConfig: APP_CONFIG.feed,
    salt: APP_CONFIG.protocol.answerSalt,
    validStudentIds: studentIds
  });

  if (!res.ok) {
    if (!silent) showToast(`피드 동기화 건너뜀: ${res.reason}`, 'info');
    return;
  }

  const { addedCount, updatedCount } = mergeProblems(state.problems, res.problemsByStudent, studentIds);
  if (addedCount > 0 || updatedCount > 0) {
    saveState();
    renderAll();
    showToast(`피드에서 새 문제 ${addedCount}세트(갱신 ${updatedCount})를 불러왔습니다!`, 'success');
  } else if (!silent) {
    showToast('이미 최신 문제 피드 상태입니다.', 'info');
  }
}

async function openAnchorModal() {
  const sid = state.activeStudent;
  const student = APP_CONFIG.students[sid];
  const chain = state.chains[sid] || [];
  const unanchored = chain.filter((b) => b.index > 0 && !(b.onchain && b.onchain.txHash));
  const netInfo = APP_CONFIG.onchain.networks[APP_CONFIG.onchain.network];

  const merkleRoot =
    unanchored.length > 0
      ? await computeMerkleRoot(unanchored.map((b) => b.hash))
      : await computeMerkleRoot(chain.map((b) => b.hash));
  state.currentAnchorMerkle = merkleRoot;

  const box = document.getElementById('anchorSummaryBox');
  box.innerHTML = `
    <div class="flex justify-between"><span class="text-[#6B7684]">대상 체인</span><span class="text-[#191F28] font-bold">${escapeHtml(student.name)} (${escapeHtml(student.chainId)})</span></div>
    <div class="flex justify-between"><span class="text-[#6B7684]">네트워크</span><span class="text-[#1B64DA] font-bold">${escapeHtml(netInfo?.name || APP_CONFIG.onchain.network)}</span></div>
    <div class="flex justify-between"><span class="text-[#6B7684]">컨트랙트</span><span class="text-[#333D4B]">${escapeHtml(APP_CONFIG.onchain.contractAddress || '미설정 (config.js)')}</span></div>
    <div class="flex justify-between"><span class="text-[#6B7684]">미앵커링 블록</span><span class="text-amber-700 font-bold">${unanchored.length}개</span></div>
    <div class="pt-2 border-t border-[#E5E8EB]">
      <div class="text-[#6B7684] mb-1">${unanchored.length > 0 ? '미앵커링 배치 머클 루트' : '전체 체인 머클 루트'}</div>
      <div class="text-emerald-700 font-semibold break-all text-[11px]">${escapeHtml(merkleRoot)}</div>
    </div>
  `;

  const btnExec = document.getElementById('btnExecuteAnchor');
  btnExec.disabled = !APP_CONFIG.onchain.enabled || !APP_CONFIG.onchain.contractAddress || unanchored.length === 0;
  openModal('modalAnchor');
}

// ---------------------------------------------------------------------------
// Event Wiring
// ---------------------------------------------------------------------------

function bindEvents() {
  document.getElementById('tabJihoon').addEventListener('click', () => {
    if (state.isMining) return;
    state.activeStudent = 'jihoon';
    renderAll();
  });

  document.getElementById('tabLeehyun').addEventListener('click', () => {
    if (state.isMining) return;
    state.activeStudent = 'leehyun';
    renderAll();
  });

  document.getElementById('modeTabMath').addEventListener('click', () => {
    if (state.isMining) return;
    state.activePanel = 'math';
    renderWorkspaceMode();
  });

  document.getElementById('modeTabActivity').addEventListener('click', () => {
    if (state.isMining) return;
    state.activePanel = 'activity';
    renderWorkspaceMode();
  });

  document.querySelectorAll('#activityCategoryBtns [data-act-cat]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.activityCategory = btn.getAttribute('data-act-cat');
      renderActivityCategoryUI();
    });
  });

  document.getElementById('formActivity').addEventListener('submit', handleActivityMine);

  document.querySelectorAll('#ledgerFilterBar [data-filter]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.ledgerFilter = btn.getAttribute('data-filter');
      renderChain();
    });
  });

  document.getElementById('ledgerSearch').addEventListener('input', (e) => {
    state.ledgerSearch = e.target.value;
    renderChain();
  });

  document.getElementById('daySelect').addEventListener('change', (e) => {
    state.selectedDayIndex[state.activeStudent] = Number(e.target.value);
    saveState();
    renderProblems();
  });

  document.getElementById('formBasic').addEventListener('submit', (e) => {
    e.preventDefault();
    handleCheckAnswer('basic');
  });

  document.getElementById('formAdv').addEventListener('submit', (e) => {
    e.preventDefault();
    handleCheckAnswer('adv');
  });

  document.getElementById('btnMine').addEventListener('click', handleMathMine);
  document.getElementById('btnVerifyChain').addEventListener('click', handleVerifyChain);

  // Parent Mode PIN Toggle
  document.getElementById('btnParentToggle').addEventListener('click', () => {
    if (state.parentUnlocked) {
      state.parentUnlocked = false;
      renderHeaderMeta();
      showToast('학부모 모드를 잠갔습니다.', 'info');
    } else {
      document.getElementById('inputParentPin').value = '';
      openModal('modalPin');
      setTimeout(() => document.getElementById('inputParentPin').focus(), 60);
    }
  });
  document.getElementById('btnClosePin').addEventListener('click', () => closeModal('modalPin'));
  document.getElementById('btnCancelPin').addEventListener('click', () => closeModal('modalPin'));
  document.getElementById('formParentPin').addEventListener('submit', (e) => {
    e.preventDefault();
    const entered = document.getElementById('inputParentPin').value.trim();
    if (entered === String(APP_CONFIG.parentPin)) {
      state.parentUnlocked = true;
      closeModal('modalPin');
      renderHeaderMeta();
      showToast('학부모 관리 도구가 열렸습니다.', 'success');
    } else {
      showToast('PIN이 일치하지 않습니다.', 'error');
      document.getElementById('inputParentPin').select();
    }
  });

  // Add Problem Modal
  document.getElementById('btnAddProblem').addEventListener('click', () => openModal('modalAdd'));
  document.getElementById('btnCloseAdd').addEventListener('click', () => closeModal('modalAdd'));
  document.getElementById('btnCancelAdd').addEventListener('click', () => closeModal('modalAdd'));
  document.getElementById('formAddProblem').addEventListener('submit', async (e) => {
    e.preventDefault();
    const student = document.getElementById('addStudent').value;
    const label = document.getElementById('addDateLabel').value.trim();
    const basicTopic = document.getElementById('addBasicTopic').value.trim();
    const basicQ = document.getElementById('addBasicQ').value.trim();
    const basicA = document.getElementById('addBasicA').value.trim();
    const advTopic = document.getElementById('addAdvTopic').value.trim();
    const advQ = document.getElementById('addAdvQ').value.trim();
    const advA = document.getElementById('addAdvA').value.trim();

    const uid = `custom-${Date.now()}`;
    const basicId = `${uid}-basic`;
    const advId = `${uid}-adv`;

    const basicHash = await hashAnswer(basicId, basicA, APP_CONFIG.protocol.answerSalt);
    const advHash = await hashAnswer(advId, advA, APP_CONFIG.protocol.answerSalt);

    state.problems[student].unshift({
      id: uid,
      label,
      basic: { id: basicId, topic: basicTopic, question: basicQ, answerHash: basicHash },
      adv: { id: advId, topic: advTopic, question: advQ, answerHash: advHash }
    });
    state.activeStudent = student;
    state.selectedDayIndex[student] = 0;
    saveState();
    renderAll();
    closeModal('modalAdd');
    e.target.reset();
    showToast('새 문제 세트가 SHA-256 해시로 등록되었습니다!', 'success');
  });

  // Import JSON Modal
  const importInput = document.getElementById('importJsonInput');
  document.getElementById('btnImportJson').addEventListener('click', () => openModal('modalImport'));
  document.getElementById('btnCloseImport').addEventListener('click', () => closeModal('modalImport'));
  document.getElementById('btnCancelImport').addEventListener('click', () => closeModal('modalImport'));
  document.getElementById('btnFillSampleJson').addEventListener('click', () => {
    const sample = {
      jihoon: [
        {
          id: 'jh-2026-11-20',
          label: '2026-11-20 (예시)',
          basic: {
            topic: '소수의 나눗셈 · 3등급',
            question: '12.6 ÷ 0.3 의 값은 얼마인가요? (숫자만 입력)',
            answer: '42'
          },
          adv: {
            topic: '비례식 · 4등급',
            question: '3 : 5 = 21 : □ 일 때, □ 안에 알맞은 수는 무엇인가요?',
            answer: '35'
          }
        }
      ],
      leehyun: [
        {
          id: 'lh-2026-11-20',
          label: '2026-11-20 (예시)',
          basic: {
            topic: '세 자리 수 덧셈 · 3등급',
            question: '385 + 247 의 값은 얼마인가요? (숫자만 입력)',
            answer: '632'
          },
          adv: {
            topic: '길이와 거리 · 4등급',
            question: '1km 400m 는 모두 몇 m 인가요? (숫자만 입력)',
            answer: '1400'
          }
        }
      ]
    };
    importInput.value = JSON.stringify(sample, null, 2);
  });

  document.getElementById('formImportJson').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const parsedByStudent = await parseProblemsPayload(
        importInput.value,
        APP_CONFIG.protocol.answerSalt,
        studentIds
      );
      const { addedCount, updatedCount } = mergeProblems(state.problems, parsedByStudent, studentIds);
      if (addedCount + updatedCount === 0) {
        throw new Error('새로 등록하거나 변경할 문제가 없습니다.');
      }
      state.selectedDayIndex.jihoon = 0;
      state.selectedDayIndex.leehyun = 0;
      saveState();
      renderAll();
      closeModal('modalImport');
      importInput.value = '';
      showToast(`문제 ${addedCount}세트 등록(갱신 ${updatedCount}) 완료!`, 'success');
    } catch (err) {
      showToast(`가져오기 실패: ${err.message}`, 'error');
    }
  });

  document.getElementById('btnSyncFeed').addEventListener('click', () => syncFeed({ silent: false }));

  // Export Ledger Backup
  document.getElementById('btnExportJson').addEventListener('click', () => {
    const bundle = buildLedgerExportBundle({ state, config: APP_CONFIG });
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `shinpow-ledger-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast('전체 원장을 안전하게 백업했습니다.', 'info');
  });

  // Restore Ledger Backup
  const restoreFileInput = document.getElementById('restoreFileInput');
  const restorePreview = document.getElementById('restorePreview');
  const btnConfirmRestore = document.getElementById('btnConfirmRestore');
  document.getElementById('btnRestoreOpen').addEventListener('click', () => {
    state.pendingRestoreBundle = null;
    restoreFileInput.value = '';
    restorePreview.classList.add('hidden');
    btnConfirmRestore.disabled = true;
    openModal('modalRestore');
  });
  document.getElementById('btnCloseRestore').addEventListener('click', () => closeModal('modalRestore'));
  document.getElementById('btnCancelRestore').addEventListener('click', () => closeModal('modalRestore'));

  restoreFileInput.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const validated = await validateAndParseLedgerBundle(text, APP_CONFIG.students);
      state.pendingRestoreBundle = validated;
      const lines = studentIds.map((sid) => {
        const stu = APP_CONFIG.students[sid];
        const info = validated.verifiedSummaries[sid];
        return `✓ ${stu.name}: ${info.count}블록 무결성 확인 (tip ${info.tipHash.slice(0, 10)}...)`;
      });
      restorePreview.textContent = lines.join('\n');
      restorePreview.className = 'rounded-2xl bg-emerald-50 border border-emerald-200 p-3 text-xs text-emerald-800 font-mono-code whitespace-pre-line';
      restorePreview.classList.remove('hidden');
      btnConfirmRestore.disabled = false;
    } catch (err) {
      state.pendingRestoreBundle = null;
      restorePreview.textContent = `⚠ 검증 실패: ${err.message}`;
      restorePreview.className = 'rounded-2xl bg-rose-50 border border-rose-200 p-3 text-xs text-rose-700 font-mono-code';
      restorePreview.classList.remove('hidden');
      btnConfirmRestore.disabled = true;
    }
  });

  btnConfirmRestore.addEventListener('click', () => {
    if (!state.pendingRestoreBundle) return;
    const bundle = state.pendingRestoreBundle;
    state.chains = bundle.chains;
    if (bundle.solved) state.solved = bundle.solved;
    if (bundle.problems) state.problems = bundle.problems;
    if (bundle.selectedDayIndex) state.selectedDayIndex = bundle.selectedDayIndex;
    for (const sid of studentIds) {
      state.selectedBlockIndex[sid] = Math.max(0, state.chains[sid].length - 1);
    }
    saveState();
    renderAll();
    closeModal('modalRestore');
    showToast('암호학 검증을 통과한 원장으로 복원했습니다!', 'success');
  });

  // Base Anchor Modal
  document.getElementById('btnAnchorOpen').addEventListener('click', openAnchorModal);
  document.getElementById('btnCloseAnchor').addEventListener('click', () => closeModal('modalAnchor'));
  document.getElementById('btnCopyMerkle').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(state.currentAnchorMerkle);
      showToast('머클 루트를 복사했습니다.', 'info');
    } catch {
      showToast('클립보드 복사를 지원하지 않는 환경입니다.', 'error');
    }
  });
  document.getElementById('btnExecuteAnchor').addEventListener('click', async () => {
    const sid = state.activeStudent;
    const student = APP_CONFIG.students[sid];
    const unanchored = state.chains[sid].filter((b) => b.index > 0 && !(b.onchain && b.onchain.txHash));
    try {
      const receipt = await anchorBatchOnchain({
        chainId: student.chainId,
        blocks: unanchored,
        onchainConfig: APP_CONFIG.onchain
      });
      unanchored.forEach((b) => {
        b.onchain = receipt;
      });
      saveState();
      renderAll();
      closeModal('modalAnchor');
      showToast(`Base 온체인 앵커링 전송 완료! (${receipt.txHash.slice(0, 12)}...)`, 'gold');
    } catch (err) {
      showToast(`온체인 앵커링 실패: ${err.message}`, 'error');
    }
  });

  // Reset Modal
  document.getElementById('btnResetOpen').addEventListener('click', () => openModal('modalReset'));
  document.getElementById('btnCancelReset').addEventListener('click', () => closeModal('modalReset'));
  document.getElementById('btnConfirmReset').addEventListener('click', async () => {
    storage.clear();
    state.selectedDayIndex = { jihoon: 0, leehyun: 0 };
    state.solved = { jihoon: {}, leehyun: {} };
    state.problems = structuredClone(DEFAULT_MATH_PROBLEMS);
    await initFreshChains();
    saveState();
    renderAll();
    closeModal('modalReset');
    showToast('모든 체인이 제네시스 블록으로 초기화되었습니다.', 'info');
  });

  // PWA Install Prompt
  globalThis.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    state.deferredInstallPrompt = e;
    document.getElementById('btnInstallPwa').classList.remove('hidden');
  });

  document.getElementById('btnInstallPwa').addEventListener('click', async () => {
    if (!state.deferredInstallPrompt) return;
    state.deferredInstallPrompt.prompt();
    await state.deferredInstallPrompt.userChoice;
    state.deferredInstallPrompt = null;
    document.getElementById('btnInstallPwa').classList.add('hidden');
  });
}

function registerServiceWorker() {
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

async function bootstrap() {
  bindEvents();
  await loadOrInitState();
  renderAll();
  registerServiceWorker();
  if (APP_CONFIG.feed.autoSyncOnLoad) {
    await syncFeed({ silent: true });
  }
}

bootstrap();
