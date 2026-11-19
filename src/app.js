/**
 * ShinPoW Application Controller
 * ---------------------------------------------------------------------------
 * Mempool.space 스타일 블록 익스플로러, 수학 미션, 멀티 액티비티(학습/게임/추억/프로젝트)
 * 멤풀 채굴, 영원불변 활동 장부 검색/필터, PWA 설치/오프라인 동기화를 통합 관리합니다.
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
  activityCategory: 'study', // 'study' | 'game' | 'memory' | 'project'
  ledgerFilter: 'all', // 'all' | 'math' | 'study' | 'game' | 'memory' | 'project'
  ledgerSearch: '',
  selectedBlockIndex: { jihoon: 0, leehyun: 0 },
  parentUnlocked: false,
  selectedDayIndex: { jihoon: 0, leehyun: 0 },
  solved: { jihoon: {}, leehyun: {} },
  mempool: { jihoon: [], leehyun: [] },
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
    success: 'bg-emerald-950/95 border-emerald-500/50 text-emerald-200',
    error: 'bg-rose-950/95 border-rose-500/50 text-rose-200',
    gold: 'bg-amber-950/95 border-amber-400/60 text-amber-200',
    info: 'bg-slate-900/95 border-slate-700 text-slate-200'
  };
  const el = document.createElement('div');
  el.className = `pointer-events-auto px-4 py-3 rounded-xl border text-xs font-semibold shadow-xl transition-all duration-300 ${colors[type] || colors.info}`;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => {
    el.classList.add('opacity-0', 'translate-y-1');
    setTimeout(() => el.remove(), 300);
  }, 3400);
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
    mempool: state.mempool,
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
    state.mempool = loaded.mempool || { jihoon: [], leehyun: [] };
    state.problems = loaded.problems || structuredClone(DEFAULT_MATH_PROBLEMS);
    state.chains = loaded.chains;
    for (const sid of studentIds) {
      state.selectedBlockIndex[sid] = Math.max(0, state.chains[sid].length - 1);
    }
  } else {
    state.selectedDayIndex = { jihoon: 0, leehyun: 0 };
    state.solved = { jihoon: {}, leehyun: {} };
    state.mempool = { jihoon: [], leehyun: [] };
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
      cubeBg: 'from-indigo-700/80 to-slate-900 border-indigo-400/50',
      badgeCls: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30',
      cardBorder: 'border-slate-800 bg-slate-950/70'
    };
  }
  if (block.module === 'math') {
    if (block.tier === 'MASTER') {
      return {
        cubeBg: 'from-amber-500/85 to-orange-700/85 border-amber-300/70',
        badgeCls: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
        cardBorder: 'border-amber-500/35 bg-amber-950/15'
      };
    }
    if (block.tier === 'BOOST') {
      return {
        cubeBg: 'from-violet-600/85 to-indigo-800/85 border-violet-300/60',
        badgeCls: 'bg-violet-500/20 text-violet-300 border-violet-500/40',
        cardBorder: 'border-violet-500/30 bg-violet-950/15'
      };
    }
    return {
      cubeBg: 'from-sky-600/85 to-blue-800/85 border-sky-300/60',
      badgeCls: 'bg-sky-500/20 text-sky-300 border-sky-500/30',
      cardBorder: 'border-sky-500/30 bg-sky-950/15'
    };
  }
  if (block.module === 'study') {
    return {
      cubeBg: 'from-cyan-600/85 to-sky-900/90 border-cyan-300/60',
      badgeCls: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/35',
      cardBorder: 'border-cyan-500/30 bg-cyan-950/15'
    };
  }
  if (block.module === 'game') {
    return {
      cubeBg: 'from-rose-600/85 to-pink-900/90 border-rose-300/60',
      badgeCls: 'bg-rose-500/20 text-rose-300 border-rose-500/35',
      cardBorder: 'border-rose-500/30 bg-rose-950/15'
    };
  }
  if (block.module === 'memory') {
    return {
      cubeBg: 'from-emerald-600/85 to-teal-900/90 border-emerald-300/60',
      badgeCls: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/35',
      cardBorder: 'border-emerald-500/30 bg-emerald-950/15'
    };
  }
  if (block.module === 'project') {
    return {
      cubeBg: 'from-purple-600/85 to-fuchsia-900/90 border-purple-300/60',
      badgeCls: 'bg-purple-500/20 text-purple-300 border-purple-500/35',
      cardBorder: 'border-purple-500/30 bg-purple-950/15'
    };
  }
  return {
    cubeBg: 'from-teal-600/85 to-cyan-900/90 border-teal-300/60',
    badgeCls: 'bg-teal-500/20 text-teal-300 border-teal-500/35',
    cardBorder: 'border-teal-500/30 bg-teal-950/15'
  };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function renderHeaderMeta() {
  const modeBadge = document.getElementById('networkModeBadge');
  if (APP_CONFIG.protocol.networkMode === 'official') {
    modeBadge.textContent = 'OFFICIAL GENESIS';
    modeBadge.className = 'text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-mono-code';
  } else {
    modeBadge.textContent = 'PREVIEW';
    modeBadge.className = 'text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30 font-mono-code';
  }

  const parentBar = document.getElementById('parentBar');
  const toggleBtn = document.getElementById('btnParentToggle');
  const toggleLabel = document.getElementById('parentToggleLabel');
  if (state.parentUnlocked) {
    parentBar.classList.remove('hidden');
    toggleLabel.textContent = '학부모 잠금';
    toggleBtn.className = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white border border-indigo-500 transition cursor-pointer';
  } else {
    parentBar.classList.add('hidden');
    toggleLabel.textContent = '학부모 모드';
    toggleBtn.className = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition cursor-pointer';
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
    tabJ.className = 'flex-1 rounded-xl px-4 py-3 text-left transition cursor-pointer flex items-center justify-between bg-indigo-600 text-white shadow-lg shadow-indigo-600/25';
    tabL.className = 'flex-1 rounded-xl px-4 py-3 text-left transition cursor-pointer flex items-center justify-between bg-slate-950/60 text-slate-400 hover:text-slate-200';
  } else {
    tabL.className = 'flex-1 rounded-xl px-4 py-3 text-left transition cursor-pointer flex items-center justify-between bg-teal-600 text-white shadow-lg shadow-teal-600/25';
    tabJ.className = 'flex-1 rounded-xl px-4 py-3 text-left transition cursor-pointer flex items-center justify-between bg-slate-950/60 text-slate-400 hover:text-slate-200';
  }

  const sid = state.activeStudent;
  const activeStats = sid === 'jihoon' ? jStats : lStats;
  const mempoolItems = state.mempool[sid] || [];
  const { pending } = getPendingMathForActiveDay(sid);
  const totalPendingCount = mempoolItems.length + (pending.canMine ? 1 : 0);

  document.getElementById('statTime').textContent = activeStats.balanceTime;
  document.getElementById('statUnit').textContent = unit;
  document.getElementById('statTimeBreakdown').textContent = `+${activeStats.earnedTime} 획득 · -${activeStats.spentTime} 사용`;
  document.getElementById('statHeight').textContent = `#${activeStats.height}`;
  document.getElementById('statBlocksCount').textContent = `(총 ${activeStats.count}개)`;
  document.getElementById('statMempoolCount').textContent = `멤풀 대기 ${totalPendingCount}건`;

  document.getElementById('statMathCount').textContent = activeStats.moduleCounts.math || 0;
  document.getElementById('statStudyCount').textContent = (activeStats.moduleCounts.study || 0) + (activeStats.moduleCounts.project || 0);
  document.getElementById('statMemoryCount').textContent = (activeStats.moduleCounts.memory || 0) + (activeStats.moduleCounts.bundle || 0);
  document.getElementById('statGameCount').textContent = activeStats.moduleCounts.game || 0;

  document.getElementById('statDifficulty').textContent = `${APP_CONFIG.protocol.difficultyPrefix}...`;
  document.getElementById('statAnchored').textContent = `앵커 ${activeStats.anchoredCount}`;

  const name = APP_CONFIG.students[sid].name;
  document.getElementById('mempoolExplorerTitle').textContent = `${name} 체인 · Mempool 블록 익스플로러`;
  document.getElementById('activeStudentTitle').textContent = `${name}의 오늘의 채굴 미션`;
  document.getElementById('chainLedgerTitle').textContent = `${name}의 영원불변 활동 장부`;
}

function renderMempoolExplorer() {
  const sid = state.activeStudent;
  const chain = state.chains[sid] || [];
  const mempoolItems = state.mempool[sid] || [];
  const { pending: mathPending } = getPendingMathForActiveDay(sid);
  const unit = APP_CONFIG.rewardUnit;

  const ribbon = document.getElementById('mempoolRibbon');
  ribbon.innerHTML = '';

  // 1. Pending Mempool Cube (Left of dashed divider)
  const pendingCount = mempoolItems.length + (mathPending.canMine ? 1 : 0);
  const pendingDelta =
    mempoolItems.reduce((acc, tx) => acc + Number(tx.timeDelta || 0), 0) +
    (mathPending.canMine ? mathPending.rewardAmount : 0);

  const mempoolCard = document.createElement('button');
  mempoolCard.type = 'button';
  mempoolCard.className = `mempool-cube w-32 sm:w-36 shrink-0 rounded-xl border-2 border-dashed p-3 text-left flex flex-col justify-between cursor-pointer ${
    pendingCount > 0
      ? 'border-cyan-400/70 bg-gradient-to-br from-cyan-950/90 to-slate-900'
      : 'border-slate-700 bg-slate-950/70 opacity-75'
  }`;
  mempoolCard.innerHTML = `
    <div class="flex items-center justify-between text-[11px] font-bold">
      <span class="${pendingCount > 0 ? 'text-cyan-300' : 'text-slate-400'}">MEMPOOL</span>
      <span>⏳</span>
    </div>
    <div class="my-2">
      <div class="text-sm font-extrabold font-mono-code ${pendingCount > 0 ? 'text-white' : 'text-slate-500'}">${pendingCount}건 대기</div>
      <div class="text-[11px] font-mono-code ${pendingDelta > 0 ? 'text-amber-300' : pendingDelta < 0 ? 'text-rose-300' : 'text-slate-400'}">
        ${pendingCount > 0 ? formatTimeDelta(pendingDelta, unit) : '대기 항목 없음'}
      </div>
    </div>
    <div class="text-[10px] text-slate-400 truncate">
      ${pendingCount > 0 ? '클릭해 채굴 콘솔로 이동' : '활동·문제를 추가해 보세요'}
    </div>
  `;
  mempoolCard.addEventListener('click', () => {
    if (mempoolItems.length > 0 && !mathPending.canMine) {
      state.activePanel = 'activity';
      renderWorkspaceMode();
    } else if (mathPending.canMine) {
      state.activePanel = 'math';
      renderWorkspaceMode();
    } else {
      state.activePanel = 'activity';
      renderWorkspaceMode();
    }
    document.getElementById('miningBox').scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
  ribbon.appendChild(mempoolCard);

  // Dashed Vertical Divider (Mempool | Confirmed Chain)
  const divider = document.createElement('div');
  divider.className = 'flex flex-col items-center justify-center shrink-0 px-1 select-none';
  divider.innerHTML = `
    <div class="h-full border-l-2 border-dashed border-amber-500/40 relative flex items-center">
      <span class="bg-slate-900 text-[9px] font-mono-code text-amber-300/90 px-1 py-0.5 rounded border border-amber-500/30 -ml-5 whitespace-nowrap">확정 ▶</span>
    </div>
  `;
  ribbon.appendChild(divider);

  // Clamp selected block index
  const maxIdx = Math.max(0, chain.length - 1);
  if (state.selectedBlockIndex[sid] === undefined || state.selectedBlockIndex[sid] > maxIdx) {
    state.selectedBlockIndex[sid] = maxIdx;
  }
  const selectedIdx = state.selectedBlockIndex[sid];

  // 2. Confirmed Block Cubes (Newest -> Genesis)
  const reversed = [...chain].reverse();
  reversed.forEach((block, pos) => {
    const modMeta = APP_CONFIG.modules[block.module] || { icon: '🧱', label: block.module };
    const theme = getBlockTheme(block);
    const isSelected = block.index === selectedIdx;
    const amt = Number(block.reward?.amount || 0);
    const labelText = block.payload?.label || modMeta.label;
    const anchored = Boolean(block.onchain && block.onchain.txHash);

    const cube = document.createElement('button');
    cube.type = 'button';
    cube.className = `mempool-cube w-32 sm:w-36 shrink-0 rounded-xl border bg-gradient-to-br p-3 text-left flex flex-col justify-between cursor-pointer ${theme.cubeBg} ${
      isSelected ? 'ring-2 ring-white ring-offset-2 ring-offset-slate-900' : ''
    }`;
    cube.innerHTML = `
      <div class="flex items-center justify-between text-xs font-extrabold text-white">
        <span class="font-mono-code">#${block.index}</span>
        <span>${escapeHtml(modMeta.icon)}${anchored ? ' ⛓️' : ''}</span>
      </div>
      <div class="my-1.5">
        <div class="text-sm font-extrabold font-mono-code text-white">
          ${block.module === 'genesis' ? 'GENESIS' : amt === 0 ? '기록 저장' : formatTimeDelta(amt, block.reward?.unit || unit)}
        </div>
        <div class="text-[11px] text-white/85 truncate mt-0.5">${escapeHtml(labelText)}</div>
      </div>
      <div class="flex items-center justify-between text-[10px] font-mono-code text-white/70">
        <span>${escapeHtml(block.hash.slice(0, 8))}…</span>
        <span>${escapeHtml(block.timestamp.slice(5, 10))}</span>
      </div>
    `;
    cube.addEventListener('click', () => {
      state.selectedBlockIndex[sid] = block.index;
      renderMempoolExplorer();
    });
    ribbon.appendChild(cube);

    if (pos < reversed.length - 1) {
      const linkArrow = document.createElement('div');
      linkArrow.className = 'flex items-center text-slate-600 text-xs font-mono-code shrink-0 select-none';
      linkArrow.textContent = '→';
      linkArrow.title = 'prevHash 암호학적 연결';
      ribbon.appendChild(linkArrow);
    }
  });

  // 3. Render Selected Block Deep Inspector
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

  // Build Human-Readable Activity / Transaction View inside the block
  let contentHtml = '';
  if (block.module === 'genesis') {
    contentHtml = `
      <div class="rounded-lg bg-indigo-950/35 border border-indigo-500/30 p-3 text-xs space-y-1">
        <div class="font-bold text-indigo-200">🌱 ${escapeHtml(block.payload?.note || 'Genesis Block')}</div>
        <div class="text-slate-400">소유자: <span class="text-slate-200">${escapeHtml(block.payload?.studentName || sid)}</span> · 모드: <span class="font-mono-code text-amber-300">${escapeHtml(block.payload?.networkMode || 'preview')}</span></div>
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
          <div class="rounded-lg bg-slate-900/90 border border-slate-800 p-2.5 flex items-center justify-between gap-2">
            <div>
              <span class="text-[11px] font-bold ${isBasic ? 'text-sky-300' : 'text-amber-300'}">${isBasic ? '기본 (+1 TIME)' : '심화 (+2 TIME)'}</span>
              <span class="text-xs text-slate-200 ml-2">${escapeHtml(topic)}</span>
            </div>
            <span class="text-[10px] font-mono-code text-slate-500 truncate max-w-[140px]" title="${escapeHtml(proof)}">Proof ${escapeHtml(proof.slice(0, 10))}…</span>
          </div>
        `;
      })
      .join('');
    contentHtml = `<div class="space-y-2">${cards}</div>`;
  } else if (Array.isArray(block.payload?.activities)) {
    const actCards = block.payload.activities
      .map((act) => {
        const catMeta = APP_CONFIG.modules[act.category] || { icon: '✨', label: act.category };
        const tagsHtml = (act.tags || [])
          .map((t) => `<span class="px-1.5 py-0.5 rounded bg-slate-800 text-[10px] text-slate-300">#${escapeHtml(t)}</span>`)
          .join(' ');
        const linkHtml =
          act.link && isSafeHttpUrl(act.link)
            ? `<a href="${escapeHtml(act.link)}" target="_blank" rel="noopener noreferrer" class="text-[11px] text-indigo-300 hover:underline break-all">🔗 ${escapeHtml(act.link)}</a>`
            : '';
        return `
          <div class="rounded-lg bg-slate-900/90 border border-slate-800 p-3 space-y-1.5">
            <div class="flex items-center justify-between gap-2 flex-wrap">
              <div class="flex items-center gap-1.5">
                <span>${escapeHtml(act.mood || catMeta.icon)}</span>
                <span class="text-xs font-bold text-white">${escapeHtml(act.title)}</span>
                <span class="px-1.5 py-0.5 rounded text-[10px] bg-slate-800 text-slate-400">${escapeHtml(catMeta.label)}</span>
              </div>
              <div class="flex items-center gap-2 text-[11px] font-mono-code">
                ${act.durationMinutes ? `<span class="text-slate-400">${act.durationMinutes}분</span>` : ''}
                <span class="${act.timeDelta > 0 ? 'text-amber-300' : act.timeDelta < 0 ? 'text-rose-300' : 'text-emerald-300'} font-bold">${escapeHtml(formatTimeDelta(act.timeDelta))}</span>
              </div>
            </div>
            ${act.memo ? `<p class="text-xs text-slate-300 leading-relaxed whitespace-pre-line">${escapeHtml(act.memo)}</p>` : ''}
            ${tagsHtml || linkHtml ? `<div class="flex items-center gap-2 flex-wrap pt-0.5">${tagsHtml}${linkHtml}</div>` : ''}
          </div>
        `;
      })
      .join('');
    contentHtml = `<div class="space-y-2">${actCards}</div>`;
  }

  container.innerHTML = `
    <div class="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-800/80">
      <div class="flex items-center gap-2 flex-wrap">
        <span class="font-mono-code text-sm font-extrabold text-white">Block #${block.index}</span>
        <span class="px-2 py-0.5 rounded-md text-[11px] font-bold border ${theme.badgeCls}">${escapeHtml(tierMeta.badge)}</span>
        <span class="text-xs text-slate-400">${escapeHtml(modMeta.icon)} ${escapeHtml(block.payload?.label || modMeta.label)}</span>
        ${txUrl ? `<a href="${escapeHtml(txUrl)}" target="_blank" rel="noopener noreferrer" class="px-2 py-0.5 rounded-md text-[10px] font-bold bg-blue-500/20 text-blue-300 border border-blue-500/40 hover:bg-blue-500/30">⛓️ BaseScan</a>` : ''}
      </div>
      <div class="flex items-center gap-1.5">
        <button id="btnInspPrev" type="button" ${block.index <= 0 ? 'disabled' : ''} class="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-slate-900 border border-slate-700 text-slate-200 hover:bg-slate-800 disabled:opacity-35 cursor-pointer disabled:cursor-not-allowed">← 이전 (#${Math.max(0, block.index - 1)})</button>
        <button id="btnInspNext" type="button" ${block.index >= totalCount - 1 ? 'disabled' : ''} class="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-slate-900 border border-slate-700 text-slate-200 hover:bg-slate-800 disabled:opacity-35 cursor-pointer disabled:cursor-not-allowed">다음 (#${Math.min(totalCount - 1, block.index + 1)}) →</button>
      </div>
    </div>

    <div class="grid grid-cols-1 md:grid-cols-2 gap-3 text-[11px] font-mono-code">
      <div class="rounded-lg bg-slate-900/70 border border-slate-800/80 p-2.5 space-y-1">
        <div class="text-slate-500">Block Hash: <span class="text-emerald-400 break-all">${escapeHtml(block.hash)}</span></div>
        <div class="text-slate-500">Prev Hash: ${
          block.index > 0
            ? `<button id="btnJumpPrevHash" type="button" class="text-indigo-300 hover:underline break-all text-left cursor-pointer">${escapeHtml(block.prevHash)}</button>`
            : `<span class="text-slate-400 break-all">${escapeHtml(block.prevHash)}</span>`
        }</div>
        <div class="text-slate-500">Payload Hash: <span class="text-amber-300/90 break-all">${escapeHtml(block.payloadHash)}</span></div>
      </div>
      <div class="rounded-lg bg-slate-900/70 border border-slate-800/80 p-2.5 grid grid-cols-2 gap-2">
        <div><span class="text-slate-500 block">기록 시각</span><span class="text-slate-200">${escapeHtml(block.timestamp.replace('T', ' ').slice(0, 19))}</span></div>
        <div><span class="text-slate-500 block">PoW Nonce</span><span class="text-emerald-400 font-bold">${block.nonce}</span></div>
        <div><span class="text-slate-500 block">TIME 변동</span><span class="text-amber-300 font-bold">${escapeHtml(formatTimeDelta(block.reward?.amount, block.reward?.unit))}</span></div>
        <div><span class="text-slate-500 block">모듈 / 난이도</span><span class="text-slate-200">${escapeHtml(block.module)} (${escapeHtml(block.difficulty)})</span></div>
      </div>
    </div>

    <div class="space-y-1.5">
      <div class="text-xs font-bold text-slate-300">기록된 활동 / 트랜잭션 내역</div>
      ${contentHtml}
    </div>

    <details class="text-[11px] font-mono-code">
      <summary class="text-slate-500 hover:text-slate-300 cursor-pointer select-none">Protocol v1 원시 JSON 보기</summary>
      <pre class="mt-2 p-2.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-400 overflow-x-auto text-[10px]">${escapeHtml(JSON.stringify(block, null, 2))}</pre>
    </details>
  `;

  const btnPrev = document.getElementById('btnInspPrev');
  const btnNext = document.getElementById('btnInspNext');
  const btnJumpPrev = document.getElementById('btnJumpPrevHash');
  if (btnPrev) {
    btnPrev.addEventListener('click', () => {
      if (block.index > 0) {
        state.selectedBlockIndex[sid] = block.index - 1;
        renderMempoolExplorer();
      }
    });
  }
  if (btnNext) {
    btnNext.addEventListener('click', () => {
      if (block.index < totalCount - 1) {
        state.selectedBlockIndex[sid] = block.index + 1;
        renderMempoolExplorer();
      }
    });
  }
  if (btnJumpPrev) {
    btnJumpPrev.addEventListener('click', () => {
      state.selectedBlockIndex[sid] = block.index - 1;
      renderMempoolExplorer();
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
    tabMath.className = 'py-2 px-3 rounded-lg text-xs font-bold transition cursor-pointer flex items-center justify-center gap-1.5 bg-indigo-600 text-white shadow';
    tabAct.className = 'py-2 px-3 rounded-lg text-xs font-bold transition cursor-pointer flex items-center justify-center gap-1.5 text-slate-400 hover:text-slate-200';
  } else {
    tabAct.className = 'py-2 px-3 rounded-lg text-xs font-bold transition cursor-pointer flex items-center justify-center gap-1.5 bg-emerald-600 text-white shadow';
    tabMath.className = 'py-2 px-3 rounded-lg text-xs font-bold transition cursor-pointer flex items-center justify-center gap-1.5 text-slate-400 hover:text-slate-200';
  }

  const mempoolLen = (state.mempool[state.activeStudent] || []).length;
  const badge = document.getElementById('activityMempoolBadge');
  if (mempoolLen > 0) {
    badge.textContent = String(mempoolLen);
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }

  renderActivityCategoryUI();
  renderMempoolQueue();
  renderMiningConsole();
}

function renderActivityCategoryUI() {
  const cat = state.activityCategory;
  document.querySelectorAll('#activityCategoryBtns [data-act-cat]').forEach((btn) => {
    const c = btn.getAttribute('data-act-cat');
    if (c === cat) {
      btn.className = 'rounded-xl px-2.5 py-2 text-xs font-bold border transition cursor-pointer text-center bg-indigo-600/30 border-indigo-400 text-white';
    } else {
      btn.className = 'rounded-xl px-2.5 py-2 text-xs font-bold border transition cursor-pointer text-center bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200';
    }
  });
  const def = ACTIVITY_DEFAULTS[cat];
  if (def) {
    document.getElementById('actTitle').placeholder = def.placeholderTitle;
    document.getElementById('actMemo').placeholder = def.placeholderMemo;
  }
}

function renderMempoolQueue() {
  const sid = state.activeStudent;
  const queue = state.mempool[sid] || [];
  const summary = document.getElementById('mempoolQueueSummary');
  const list = document.getElementById('mempoolQueueList');

  const netDelta = queue.reduce((acc, tx) => acc + Number(tx.timeDelta || 0), 0);
  summary.textContent = `${queue.length}건 대기 (${formatTimeDelta(netDelta)})`;

  if (queue.length === 0) {
    list.innerHTML = '<div class="text-xs text-slate-500 text-center py-3">아직 대기 중인 활동이 없습니다. 위에서 학습·게임시간·추억을 담아 보세요!</div>';
    return;
  }

  list.innerHTML = '';
  queue.forEach((tx, idx) => {
    const catMeta = APP_CONFIG.modules[tx.category] || { icon: '✨', label: tx.category };
    const row = document.createElement('div');
    row.className = 'rounded-lg bg-slate-900 border border-slate-800 px-3 py-2 flex items-center justify-between gap-2';
    row.innerHTML = `
      <div class="min-w-0">
        <div class="text-xs font-bold text-white truncate">${escapeHtml(tx.mood || catMeta.icon)} ${escapeHtml(tx.title)}</div>
        <div class="text-[11px] text-slate-400 truncate">${escapeHtml(catMeta.label)}${tx.durationMinutes ? ` · ${tx.durationMinutes}분` : ''} · <span class="font-mono-code ${tx.timeDelta > 0 ? 'text-amber-300' : tx.timeDelta < 0 ? 'text-rose-300' : 'text-emerald-300'}">${escapeHtml(formatTimeDelta(tx.timeDelta))}</span></div>
      </div>
      <button type="button" data-remove-tx="${idx}" class="text-slate-500 hover:text-rose-400 text-xs px-1.5 py-1 cursor-pointer" title="대기열에서 제거">✕</button>
    `;
    list.appendChild(row);
  });

  list.querySelectorAll('[data-remove-tx]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.getAttribute('data-remove-tx'));
      state.mempool[sid].splice(idx, 1);
      saveState();
      renderAll();
    });
  });
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
    if (mined.allMined) tag = ' 👑 3T';
    else if (mined.advMined) tag = ' ⚡ 2T';
    else if (mined.basicMined) tag = ' ⏱️ 1T';
    opt.textContent = `${p.label}${tag}`;
    if (idx === dayIdx) opt.selected = true;
    select.appendChild(opt);
  });

  const day = list[dayIdx];
  if (!day) return;

  const solvedDay = state.solved[sid][day.id] || { basic: false, adv: false };
  const mined = getMinedPartsForDay(state.chains[sid], day.id);
  const unit = APP_CONFIG.rewardUnit;

  // Basic Problem Card
  document.getElementById('basicTopic').textContent = day.basic.topic;
  document.getElementById('basicQuestion').textContent = day.basic.question;
  const inputBasic = document.getElementById('inputBasic');
  const btnBasic = document.getElementById('btnCheckBasic');
  const badgeBasic = document.getElementById('basicStatusBadge');
  const cardBasic = document.getElementById('cardBasic');

  if (mined.basicMined) {
    badgeBasic.textContent = `채굴 완료 ✓ (+${APP_CONFIG.tiers.CORE.reward} ${unit})`;
    badgeBasic.className = 'text-xs font-bold text-emerald-400';
    cardBasic.className = 'rounded-xl border border-emerald-500/40 bg-emerald-950/20 p-4 space-y-3 transition';
    inputBasic.disabled = true;
    inputBasic.value = '블록 기록 완료';
    btnBasic.disabled = true;
    btnBasic.className = 'px-4 py-2 rounded-lg text-xs font-bold bg-emerald-700/50 text-emerald-200 cursor-not-allowed shrink-0';
  } else if (solvedDay.basic) {
    badgeBasic.textContent = '정답 완료 · 채굴 대기 ✓';
    badgeBasic.className = 'text-xs font-bold text-sky-300';
    cardBasic.className = 'rounded-xl border border-sky-500/40 bg-sky-950/20 p-4 space-y-3 transition';
    inputBasic.disabled = true;
    inputBasic.value = '해시 검증 완료';
    btnBasic.disabled = true;
    btnBasic.className = 'px-4 py-2 rounded-lg text-xs font-bold bg-sky-700/50 text-sky-200 cursor-not-allowed shrink-0';
  } else {
    badgeBasic.textContent = '미해결';
    badgeBasic.className = 'text-xs font-semibold text-slate-400';
    cardBasic.className = 'rounded-xl border border-slate-800 bg-slate-950/60 p-4 space-y-3 transition';
    inputBasic.disabled = false;
    inputBasic.value = '';
    btnBasic.disabled = false;
    btnBasic.className = 'px-4 py-2 rounded-lg text-xs font-bold bg-sky-600 hover:bg-sky-500 text-white transition cursor-pointer shrink-0';
  }

  // Advanced Problem Card
  document.getElementById('advTopic').textContent = day.adv.topic;
  document.getElementById('advQuestion').textContent = day.adv.question;
  const inputAdv = document.getElementById('inputAdv');
  const btnAdv = document.getElementById('btnCheckAdv');
  const badgeAdv = document.getElementById('advStatusBadge');
  const cardAdv = document.getElementById('cardAdv');

  if (mined.advMined) {
    badgeAdv.textContent = `채굴 완료 ✓ (+${APP_CONFIG.tiers.BOOST.reward} ${unit})`;
    badgeAdv.className = 'text-xs font-bold text-amber-300';
    cardAdv.className = 'rounded-xl border border-amber-500/40 bg-amber-950/20 p-4 space-y-3 transition';
    inputAdv.disabled = true;
    inputAdv.value = '블록 기록 완료';
    btnAdv.disabled = true;
    btnAdv.className = 'px-4 py-2 rounded-lg text-xs font-bold bg-amber-700/50 text-amber-200 cursor-not-allowed shrink-0';
  } else if (solvedDay.adv) {
    badgeAdv.textContent = '정답 완료 · 채굴 대기 ✓';
    badgeAdv.className = 'text-xs font-bold text-amber-300';
    cardAdv.className = 'rounded-xl border border-amber-500/40 bg-amber-950/20 p-4 space-y-3 transition';
    inputAdv.disabled = true;
    inputAdv.value = '해시 검증 완료';
    btnAdv.disabled = true;
    btnAdv.className = 'px-4 py-2 rounded-lg text-xs font-bold bg-amber-700/50 text-amber-200 cursor-not-allowed shrink-0';
  } else {
    badgeAdv.textContent = '미해결';
    badgeAdv.className = 'text-xs font-semibold text-slate-400';
    cardAdv.className = 'rounded-xl border border-slate-800 bg-slate-950/60 p-4 space-y-3 transition';
    inputAdv.disabled = false;
    inputAdv.value = '';
    btnAdv.disabled = false;
    btnAdv.className = 'px-4 py-2 rounded-lg text-xs font-bold bg-amber-600 hover:bg-amber-500 text-white transition cursor-pointer shrink-0';
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

  if (state.activePanel === 'activity') {
    const queue = state.mempool[sid] || [];
    if (queue.length > 0) {
      const netDelta = queue.reduce((acc, tx) => acc + Number(tx.timeDelta || 0), 0);
      btnMine.disabled = state.isMining;
      btnMine.className = 'w-full py-3 rounded-xl font-bold text-sm transition flex items-center justify-center gap-2 cursor-pointer bg-gradient-to-r from-cyan-400 to-emerald-400 hover:from-cyan-300 hover:to-emerald-300 text-slate-950 shadow-lg shadow-cyan-500/20';
      btnMineText.textContent = `📦 멤풀 활동 ${queue.length}건 블록 채굴 시작 (${formatTimeDelta(netDelta, unit)})`;
      tierLabel.textContent = '멤풀 대기열을 영구 블록으로 확정합니다';
      tierLabel.className = 'text-xs font-bold text-cyan-300';
    } else {
      btnMine.disabled = true;
      btnMine.className = 'w-full py-3 rounded-xl font-bold text-sm transition flex items-center justify-center gap-2 bg-slate-800 text-slate-400 cursor-not-allowed';
      btnMineText.textContent = '멤풀이 비어 있습니다 (활동을 먼저 담아주세요)';
      tierLabel.textContent = '활동·추억·시간을 멤풀에 담아주세요';
      tierLabel.className = 'text-xs font-semibold text-slate-400';
    }
    return;
  }

  // Math mode mining button
  const { mined, pending } = getPendingMathForActiveDay(sid);
  if (mined.allMined) {
    btnMine.disabled = true;
    btnMine.className = 'w-full py-3 rounded-xl font-bold text-sm transition flex items-center justify-center gap-2 bg-amber-500/20 text-amber-300 border border-amber-500/30 cursor-not-allowed';
    btnMineText.textContent = `이 날짜 올클리어 완료! (+${APP_CONFIG.tiers.MASTER.reward} ${unit} 달성) 👑`;
    tierLabel.textContent = '오늘의 최대 TIME 획득 완료';
    tierLabel.className = 'text-xs font-bold text-amber-300';
  } else if (pending.canMine) {
    const tierMeta = APP_CONFIG.tiers[pending.tier];
    btnMine.disabled = state.isMining;
    if (pending.tier === 'MASTER') {
      btnMine.className = 'w-full py-3 rounded-xl font-bold text-sm transition flex items-center justify-center gap-2 cursor-pointer bg-gradient-to-r from-amber-400 to-orange-500 hover:from-amber-300 hover:to-orange-400 text-slate-950 shadow-lg shadow-amber-500/25';
      tierLabel.textContent = '기본+심화 모두 해결! 최고 보상';
      tierLabel.className = 'text-xs font-bold text-amber-300';
    } else if (pending.tier === 'BOOST') {
      btnMine.className = 'w-full py-3 rounded-xl font-bold text-sm transition flex items-center justify-center gap-2 cursor-pointer bg-gradient-to-r from-violet-400 to-amber-400 hover:from-violet-300 hover:to-amber-300 text-slate-950 shadow-lg shadow-violet-500/20';
      tierLabel.textContent = mined.basicMined ? '심화까지 해결! 추가 +2 TIME 채굴 가능' : '심화 해결! 기본도 풀면 한 번에 +3 TIME';
      tierLabel.className = 'text-xs font-bold text-violet-300';
    } else {
      btnMine.className = 'w-full py-3 rounded-xl font-bold text-sm transition flex items-center justify-center gap-2 cursor-pointer bg-gradient-to-r from-sky-300 to-cyan-400 hover:from-sky-200 hover:to-cyan-300 text-slate-950 shadow-lg';
      tierLabel.textContent = mined.advMined ? '기본까지 해결! 추가 +1 TIME 채굴 가능' : '기본 해결! 심화도 풀면 한 번에 +3 TIME';
      tierLabel.className = 'text-xs font-semibold text-sky-300';
    }
    btnMineText.textContent = `${tierMeta.badge} 블록 채굴 시작 (+${pending.rewardAmount} ${unit})`;
  } else if (mined.basicMined) {
    btnMine.disabled = true;
    btnMine.className = 'w-full py-3 rounded-xl font-bold text-sm transition flex items-center justify-center gap-2 bg-slate-800 text-slate-300 cursor-not-allowed';
    btnMineText.textContent = `기본 채굴 완료 — 심화 풀면 +${APP_CONFIG.tiers.BOOST.reward} ${unit} 추가!`;
    tierLabel.textContent = '심화 문제 도전 대기 중';
    tierLabel.className = 'text-xs font-semibold text-slate-300';
  } else if (mined.advMined) {
    btnMine.disabled = true;
    btnMine.className = 'w-full py-3 rounded-xl font-bold text-sm transition flex items-center justify-center gap-2 bg-slate-800 text-slate-300 cursor-not-allowed';
    btnMineText.textContent = `심화 채굴 완료 — 기본 풀면 +${APP_CONFIG.tiers.CORE.reward} ${unit} 추가!`;
    tierLabel.textContent = '기본 문제 도전 대기 중';
    tierLabel.className = 'text-xs font-semibold text-slate-300';
  } else {
    btnMine.disabled = true;
    btnMine.className = 'w-full py-3 rounded-xl font-bold text-sm transition flex items-center justify-center gap-2 bg-slate-800 text-slate-400 cursor-not-allowed';
    btnMineText.textContent = '채굴 잠금 (기본 또는 심화 문제 풀이 필요)';
    tierLabel.textContent = '문제를 풀면 채굴이 열립니다';
    tierLabel.className = 'text-xs font-semibold text-slate-400';
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

  // Render filter pills active styling
  document.querySelectorAll('#ledgerFilterBar [data-filter]').forEach((btn) => {
    const f = btn.getAttribute('data-filter');
    if (f === state.ledgerFilter) {
      btn.className = 'px-2.5 py-1 rounded-lg text-[11px] font-bold transition cursor-pointer bg-indigo-600 text-white';
    } else {
      btn.className = 'px-2.5 py-1 rounded-lg text-[11px] font-bold transition cursor-pointer bg-slate-950 border border-slate-800 text-slate-400 hover:text-slate-200';
    }
  });

  const query = state.ledgerSearch.trim().toLowerCase();
  const filtered = [...chain].reverse().filter((b) => blockMatchesFilter(b, state.ledgerFilter, query));

  if (filtered.length === 0) {
    container.innerHTML = '<div class="text-xs text-slate-500 text-center py-8">조건에 일치하는 블록 기록이 없습니다.</div>';
    return;
  }

  filtered.forEach((block) => {
    const tierMeta = APP_CONFIG.tiers[block.tier] || { badge: block.tier };
    const modMeta = APP_CONFIG.modules[block.module] || { icon: '🧱', label: block.module };
    const theme = getBlockTheme(block);
    const amt = Number(block.reward?.amount || 0);
    const rewardText = block.module === 'genesis' ? '' : ` ${formatTimeDelta(amt, block.reward?.unit)}`;
    const diffLen = block.tier === 'GENESIS' ? 0 : block.difficulty?.length || 2;
    const highlightedHash =
      block.tier === 'GENESIS'
        ? `<span class="text-indigo-300">${escapeHtml(block.hash)}</span>`
        : `<span class="text-emerald-400 font-bold">${escapeHtml(block.hash.slice(0, diffLen))}</span><span class="text-slate-300">${escapeHtml(block.hash.slice(diffLen))}</span>`;

    const isSelected = state.selectedBlockIndex[sid] === block.index;
    const labelText = block.payload?.label || modMeta.label;

    // Activity snippet preview inside card
    let snippetHtml = '';
    if (Array.isArray(block.payload?.activities) && block.payload.activities.length > 0) {
      const first = block.payload.activities[0];
      const extra = block.payload.activities.length > 1 ? ` 외 ${block.payload.activities.length - 1}건` : '';
      snippetHtml = `
        <div class="text-xs text-slate-300 bg-slate-900/70 rounded-lg px-2.5 py-2 border border-slate-800/70">
          <div class="font-semibold text-white">${escapeHtml(first.mood || modMeta.icon)} ${escapeHtml(first.title)}${escapeHtml(extra)}</div>
          ${first.memo ? `<div class="text-[11px] text-slate-400 line-clamp-2 mt-0.5">${escapeHtml(first.memo)}</div>` : ''}
        </div>
      `;
    } else if (block.module === 'math' && block.payload?.topics) {
      const topicSummary = Object.values(block.payload.topics).join(' · ');
      snippetHtml = `<div class="text-[11px] text-slate-300">📐 ${escapeHtml(topicSummary)}</div>`;
    }

    const txUrl = block.onchain?.txHash
      ? getExplorerTxUrl(APP_CONFIG.onchain, block.onchain.txHash, block.onchain.network)
      : null;

    const card = document.createElement('div');
    card.className = `rounded-xl border p-3.5 space-y-2 transition cursor-pointer ${theme.cardBorder} ${
      isSelected ? 'ring-1 ring-indigo-400/70' : 'hover:border-slate-600'
    }`;
    card.innerHTML = `
      <div class="flex items-center justify-between gap-2 flex-wrap">
        <div class="flex items-center gap-2 flex-wrap">
          <span class="font-mono-code text-sm font-extrabold text-white">Block #${block.index}</span>
          <span class="px-2 py-0.5 rounded-md text-[11px] font-bold border ${theme.badgeCls}">${escapeHtml(tierMeta.badge)}${escapeHtml(rewardText)}</span>
          ${txUrl ? `<a href="${escapeHtml(txUrl)}" target="_blank" rel="noopener noreferrer" class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-500/20 text-blue-300 border border-blue-500/40">⛓️ Base</a>` : ''}
        </div>
        <span class="text-[11px] text-slate-400">${escapeHtml(labelText)}</span>
      </div>
      ${snippetHtml}
      <div class="grid grid-cols-2 gap-2 text-[11px] text-slate-400">
        <div class="truncate">시간: <span class="text-slate-300">${escapeHtml(block.timestamp.replace('T', ' ').slice(0, 19))}</span></div>
        <div class="text-right">Nonce: <span class="font-mono-code text-emerald-400 font-semibold">${block.nonce}</span></div>
      </div>
      <div class="bg-slate-950/90 rounded-lg p-2 border border-slate-800/80 font-mono-code text-[10px] space-y-0.5">
        <div class="truncate text-slate-500">Prev: <span class="text-slate-400">${escapeHtml(block.prevHash)}</span></div>
        <div class="truncate text-slate-500">Hash: ${highlightedHash}</div>
      </div>
    `;
    card.addEventListener('click', (e) => {
      if (e.target.closest('a')) return;
      state.selectedBlockIndex[sid] = block.index;
      renderMempoolExplorer();
      renderChain();
      document.getElementById('blockInspector').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
    container.appendChild(card);
  });
}

function renderAll() {
  renderHeaderMeta();
  renderTabsAndStats();
  renderMempoolExplorer();
  renderWorkspaceMode();
  renderProblems();
  renderChain();
  if (globalThis.lucide) {
    globalThis.lucide.createIcons();
  }
}

// ---------------------------------------------------------------------------
// Core Interactions & PoW Mining
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
        ? `기본 문제 정답! (+${rewardVal} ${APP_CONFIG.rewardUnit} 채굴 가능 ⏱️)`
        : `심화 문제 정답! (+${rewardVal} ${APP_CONFIG.rewardUnit} 채굴 가능 ⚡)`,
      'success'
    );
  } else {
    showToast('아쉽네요! 다시 한 번 계산해 볼까요?', 'error');
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
      minVisualMs: 650,
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

    if (globalThis.confetti) {
      globalThis.confetti({
        particleCount: tier === 'MASTER' ? 110 : rewardAmount > 0 ? 75 : 45,
        spread: 72,
        origin: { y: 0.65 }
      });
    }

    const tierMeta = APP_CONFIG.tiers[tier] || { label: tier };
    showToast(
      `Block #${newBlock.index} ${tierMeta.label} 채굴 완료! (${formatTimeDelta(rewardAmount)})`,
      tier === 'MASTER' ? 'gold' : 'success'
    );
  } catch (err) {
    state.isMining = false;
    renderMiningConsole();
    showToast(`채굴 오류: ${err.message}`, 'error');
  }
}

async function handleMine() {
  if (state.isMining) return;
  const sid = state.activeStudent;

  if (state.activePanel === 'activity') {
    const queue = state.mempool[sid] || [];
    if (queue.length === 0) return;
    const spec = buildActivityBlockSpec(queue);
    await runPowMining({
      sid,
      module: spec.module,
      tier: spec.tier,
      rewardAmount: spec.rewardAmount,
      payload: spec.payload,
      onSuccess: () => {
        state.mempool[sid] = [];
      }
    });
    return;
  }

  // Math mode mining
  const { day, pending } = getPendingMathForActiveDay(sid);
  if (!day || !pending.canMine) return;
  const payload = buildMathBlockPayload({ day, parts: pending.parts });
  await runPowMining({
    sid,
    module: MATH_MODULE_ID,
    tier: pending.tier,
    rewardAmount: pending.rewardAmount,
    payload
  });
}

function readActivityFormTx() {
  return createActivityTx({
    category: state.activityCategory,
    title: document.getElementById('actTitle').value,
    memo: document.getElementById('actMemo').value,
    durationMinutes: document.getElementById('actDuration').value,
    timeDelta: document.getElementById('actTimeDelta').value,
    mood: document.getElementById('actMood').value,
    tags: document.getElementById('actTags').value,
    link: document.getElementById('actLink').value
  });
}

function resetActivityForm() {
  document.getElementById('actTitle').value = '';
  document.getElementById('actMemo').value = '';
  document.getElementById('actTags').value = '';
  document.getElementById('actLink').value = '';
  const def = ACTIVITY_DEFAULTS[state.activityCategory];
  document.getElementById('actTimeDelta').value = String(def?.defaultTimeDelta ?? 0);
}

async function handleVerifyChain() {
  const sid = state.activeStudent;
  const student = APP_CONFIG.students[sid];
  const result = await verifyChain(state.chains[sid], student.chainId);
  const banner = document.getElementById('verifyBanner');
  banner.classList.remove('hidden');

  if (result.valid) {
    banner.className = 'rounded-xl px-3.5 py-2.5 text-xs font-semibold space-y-1 bg-emerald-950/60 border border-emerald-500/40 text-emerald-300';
    banner.innerHTML = `
      <div>✓ 검증 완료: 제네시스(#0)부터 최신 블록(#${result.height})까지 모든 헤더·활동 페이로드 해시가 무결합니다.</div>
      <div class="font-mono-code text-[10px] text-emerald-400/80 break-all">Merkle Root: ${escapeHtml(result.merkleRoot)}</div>
    `;
  } else {
    banner.className = 'rounded-xl px-3.5 py-2.5 text-xs font-semibold space-y-1 bg-rose-950/60 border border-rose-500/40 text-rose-300';
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
    <div class="flex justify-between"><span class="text-slate-400">대상 체인:</span><span class="text-white">${escapeHtml(student.name)} (${escapeHtml(student.chainId)})</span></div>
    <div class="flex justify-between"><span class="text-slate-400">네트워크:</span><span class="text-blue-300">${escapeHtml(netInfo?.name || APP_CONFIG.onchain.network)}</span></div>
    <div class="flex justify-between"><span class="text-slate-400">컨트랙트:</span><span class="text-slate-300">${escapeHtml(APP_CONFIG.onchain.contractAddress || '미설정 (config.js)')}</span></div>
    <div class="flex justify-between"><span class="text-slate-400">미앵커링 블록:</span><span class="text-amber-300">${unanchored.length}개</span></div>
    <div class="pt-1 border-t border-slate-800">
      <div class="text-slate-400 mb-1">${unanchored.length > 0 ? '미앵커링 배치 머클 루트:' : '전체 체인 머클 루트:'}</div>
      <div class="text-emerald-300 break-all text-[11px]">${escapeHtml(merkleRoot)}</div>
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
  // Student Switcher
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

  // Workspace Mode Tabs (Math vs Activity)
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

  // Activity Category Selector
  document.querySelectorAll('#activityCategoryBtns [data-act-cat]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.activityCategory = btn.getAttribute('data-act-cat');
      const def = ACTIVITY_DEFAULTS[state.activityCategory];
      document.getElementById('actTimeDelta').value = String(def?.defaultTimeDelta ?? 0);
      renderActivityCategoryUI();
    });
  });

  // Activity Form -> Queue in Mempool
  document.getElementById('formActivity').addEventListener('submit', (e) => {
    e.preventDefault();
    try {
      const tx = readActivityFormTx();
      const sid = state.activeStudent;
      state.mempool[sid].push(tx);
      saveState();
      resetActivityForm();
      renderAll();
      showToast(`"${tx.title}" 활동이 Mempool 대기열에 담겼습니다!`, 'info');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // Activity Form -> Mine Immediately
  document.getElementById('btnActMineNow').addEventListener('click', async () => {
    if (state.isMining) return;
    try {
      const tx = readActivityFormTx();
      const sid = state.activeStudent;
      state.mempool[sid].push(tx);
      resetActivityForm();
      const spec = buildActivityBlockSpec(state.mempool[sid]);
      await runPowMining({
        sid,
        module: spec.module,
        tier: spec.tier,
        rewardAmount: spec.rewardAmount,
        payload: spec.payload,
        onSuccess: () => {
          state.mempool[sid] = [];
        }
      });
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // Ledger Filters & Search
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

  // Math Problem Events
  document.getElementById('daySelect').addEventListener('change', (e) => {
    state.selectedDayIndex[state.activeStudent] = Number(e.target.value);
    saveState();
    renderProblems();
    renderMempoolExplorer();
  });

  document.getElementById('formBasic').addEventListener('submit', (e) => {
    e.preventDefault();
    handleCheckAnswer('basic');
  });

  document.getElementById('formAdv').addEventListener('submit', (e) => {
    e.preventDefault();
    handleCheckAnswer('adv');
  });

  document.getElementById('btnMine').addEventListener('click', handleMine);
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
    showToast('새 문제 세트가 SHA-256 해시로 안전하게 등록되었습니다!', 'success');
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

  // Sync Feed
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
    showToast('지훈·이현 전체 원장(활동·추억 포함)을 안전하게 백업했습니다.', 'info');
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
      restorePreview.className = 'rounded-xl bg-emerald-950/40 border border-emerald-500/40 p-3 text-xs text-emerald-300 font-mono-code whitespace-pre-line';
      restorePreview.classList.remove('hidden');
      btnConfirmRestore.disabled = false;
    } catch (err) {
      state.pendingRestoreBundle = null;
      restorePreview.textContent = `⚠ 검증 실패: ${err.message}`;
      restorePreview.className = 'rounded-xl bg-rose-950/40 border border-rose-500/40 p-3 text-xs text-rose-300 font-mono-code';
      restorePreview.classList.remove('hidden');
      btnConfirmRestore.disabled = true;
    }
  });

  btnConfirmRestore.addEventListener('click', () => {
    if (!state.pendingRestoreBundle) return;
    const bundle = state.pendingRestoreBundle;
    state.chains = bundle.chains;
    if (bundle.mempool) state.mempool = bundle.mempool;
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
      showToast('머클 루트를 클립보드에 복사했습니다.', 'info');
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
    state.mempool = { jihoon: [], leehyun: [] };
    state.problems = structuredClone(DEFAULT_MATH_PROBLEMS);
    await initFreshChains();
    saveState();
    renderAll();
    closeModal('modalReset');
    showToast('모든 체인이 Protocol v1 제네시스 블록으로 초기화되었습니다.', 'info');
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

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

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
