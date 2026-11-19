/**
 * ShinPoW Module: Trustless Activity & Life Chronicle (무승인 자율 기록 모듈)
 * ---------------------------------------------------------------------------
 * 부모 승인 없이 아이가 스스로 영원불변 장부를 쓸 수 있는 탈중앙 설계:
 *  - 추억·일기(memory), 프로젝트(project), 자율 학습(study) -> 0 TIME (화폐 발행 불가, 자유 기록)
 *  - 게임·자유시간 사용(game) -> -TIME (보유 TIME을 스스로 차감하여 기록)
 *  (+TIME 발행은 오직 암호학적으로 검증된 수학 정답 해시 통과 시에만 발생합니다.)
 */

export const ACTIVITY_MODULES = ['memory', 'study', 'project', 'game'];

export const ACTIVITY_DEFAULTS = {
  memory: {
    module: 'memory',
    tier: 'MEMORY',
    label: '오늘의 추억',
    icon: '✨',
    trustlessMode: 'zero', // 항상 0 TIME (무제한 자유 기록)
    defaultTimeDelta: 0,
    placeholderTitle: '예: 가족과 한강 자전거 라이딩',
    placeholderMemo: '오늘 있었던 재미있는 일, 느낀 점, 기억하고 싶은 순간을 남겨보세요.'
  },
  study: {
    module: 'study',
    tier: 'STUDY',
    label: '자율 학습 기록',
    icon: '📚',
    trustlessMode: 'zero',
    defaultTimeDelta: 0,
    placeholderTitle: '예: 영어 원서 30분 읽기 / 과학 실험',
    placeholderMemo: '오늘 스스로 공부하거나 새롭게 알게 된 내용을 기록해 두세요.'
  },
  project: {
    module: 'project',
    tier: 'PROJECT',
    label: '프로젝트·창작',
    icon: '💻',
    trustlessMode: 'zero',
    defaultTimeDelta: 0,
    placeholderTitle: '예: 레고 로봇 라인트레이서 완성',
    placeholderMemo: '만든 작품, 코드, 시행착오를 남겨두면 멋진 미래 포트폴리오가 됩니다.'
  },
  game: {
    module: 'game',
    tier: 'GAME',
    label: '게임·자유시간 사용',
    icon: '🎮',
    trustlessMode: 'burn', // 항상 음수(-1 이상) 차감
    defaultTimeDelta: -1,
    placeholderTitle: '예: 마인크래프트 / 닌텐도 스위치',
    placeholderMemo: '내가 채굴한 TIME을 정직하게 사용하고 기록해요.'
  }
};

export function parseTags(rawTags) {
  if (Array.isArray(rawTags)) {
    return rawTags.map((t) => String(t).trim().replace(/^#/, '')).filter(Boolean).slice(0, 8);
  }
  return String(rawTags || '')
    .split(/[,\s#]+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 8);
}

/**
 * 무승인(Trustless) 규칙을 강제한 Activity 레코드 생성
 */
export function createActivityTx({
  category,
  title,
  memo = '',
  durationMinutes = 0,
  spendTime = 1,
  mood = '😊',
  tags = '',
  link = '',
  dateLabel = ''
}) {
  if (!ACTIVITY_MODULES.includes(category)) {
    throw new Error(`지원하지 않는 활동 카테고리입니다: ${category}`);
  }
  const cleanTitle = String(title || '').trim();
  if (!cleanTitle) {
    throw new Error('기록 제목을 입력해 주세요.');
  }

  const def = ACTIVITY_DEFAULTS[category];
  const parsedDuration = Math.max(0, Math.round(Number(durationMinutes) || 0));

  let timeDelta = 0;
  if (def.trustlessMode === 'burn') {
    const burnAmount = Math.max(1, Math.min(50, Math.round(Math.abs(Number(spendTime) || 1))));
    timeDelta = -burnAmount;
  }

  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  return {
    txId: `act-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    category,
    title: cleanTitle,
    memo: String(memo || '').trim(),
    durationMinutes: parsedDuration,
    timeDelta,
    mood: String(mood || '😊').trim(),
    tags: parseTags(tags),
    link: String(link || '').trim(),
    dateLabel: String(dateLabel || todayStr).trim(),
    createdAt: now.toISOString()
  };
}

/**
 * Activity 레코드를 Protocol v1 블록 메타 + 페이로드로 변환
 */
export function buildActivityBlockSpec(txOrList) {
  const txList = Array.isArray(txOrList) ? txOrList : [txOrList];
  if (txList.length === 0) {
    throw new Error('채굴할 활동 기록이 없습니다.');
  }

  const categories = [...new Set(txList.map((tx) => tx.category))];
  const isSingleCategory = categories.length === 1;
  const moduleName = isSingleCategory ? categories[0] : 'bundle';
  const tier = isSingleCategory ? ACTIVITY_DEFAULTS[categories[0]].tier : 'BUNDLE';
  const totalTimeDelta = txList.reduce((acc, tx) => acc + Number(tx.timeDelta || 0), 0);
  const totalMinutes = txList.reduce((acc, tx) => acc + Number(tx.durationMinutes || 0), 0);

  const label =
    txList.length === 1
      ? txList[0].title
      : `${txList[0].dateLabel} · 활동 ${txList.length}건`;

  const payload = {
    label,
    dateLabel: txList[0].dateLabel,
    txCount: txList.length,
    totalMinutes,
    categories: categories.sort(),
    activities: txList.map((tx) => ({
      txId: tx.txId,
      category: tx.category,
      title: tx.title,
      memo: tx.memo,
      durationMinutes: tx.durationMinutes,
      timeDelta: tx.timeDelta,
      mood: tx.mood,
      tags: tx.tags,
      link: tx.link || ''
    }))
  };

  return {
    module: moduleName,
    tier,
    rewardAmount: totalTimeDelta,
    payload
  };
}
