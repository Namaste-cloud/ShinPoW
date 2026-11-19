/**
 * ShinPoW Module: Activity & Life Chronicle (멀티 액티비티 확장 모듈)
 * ---------------------------------------------------------------------------
 * 학습 시간(study), 게임/자유시간 사용(game), 활동·추억 일기(memory), 프로젝트(project) 등
 * 다양한 일상 기록을 Mempool(채굴 대기열)에 담고, Protocol v1 블록으로 영구 기록합니다.
 */

export const ACTIVITY_MODULES = ['study', 'game', 'memory', 'project'];

export const ACTIVITY_DEFAULTS = {
  study: {
    module: 'study',
    tier: 'STUDY',
    label: '학습 시간',
    icon: '📚',
    defaultTimeDelta: 1,
    placeholderTitle: '예: 영어 원서 읽기 / 파이썬 기초 공부',
    placeholderMemo: '오늘 배운 점이나 인상 깊었던 내용을 적어보세요.'
  },
  game: {
    module: 'game',
    tier: 'GAME',
    label: '게임·자유시간',
    icon: '🎮',
    defaultTimeDelta: -1,
    placeholderTitle: '예: 마인크래프트 / 닌텐도 스위치',
    placeholderMemo: '채굴한 TIME으로 즐긴 자유시간 기록!'
  },
  memory: {
    module: 'memory',
    tier: 'MEMORY',
    label: '활동·추억',
    icon: '✨',
    defaultTimeDelta: 0,
    placeholderTitle: '예: 가족과 한강 자전거 라이딩',
    placeholderMemo: '오늘 있었던 재미있는 일, 느낀 점, 추억을 남겨보세요.'
  },
  project: {
    module: 'project',
    tier: 'PROJECT',
    label: '프로젝트',
    icon: '💻',
    defaultTimeDelta: 2,
    placeholderTitle: '예: 레고 로봇 라인트레이서 완성',
    placeholderMemo: '만든 결과물, 시행착오, 링크 등을 기록해 두면 멋진 포트폴리오가 됩니다.'
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
 * Mempool에 들어갈 표준 Activity 트랜잭션(TX) 객체 생성
 */
export function createActivityTx({
  category,
  title,
  memo = '',
  durationMinutes = 0,
  timeDelta = 0,
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
    throw new Error('활동 제목을 입력해 주세요.');
  }

  const parsedDuration = Math.max(0, Math.round(Number(durationMinutes) || 0));
  let parsedDelta = Math.round(Number(timeDelta) || 0);
  // 게임/자유시간 사용은 실수로 양수를 넣더라도 음수(사용)로 정규화할 수 있게 옵션 유지, 단 명시적 +/- 허용
  if (category === 'game' && parsedDelta > 0) {
    parsedDelta = -parsedDelta;
  }

  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  return {
    txId: `tx-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    category,
    title: cleanTitle,
    memo: String(memo || '').trim(),
    durationMinutes: parsedDuration,
    timeDelta: parsedDelta,
    mood: String(mood || '😊').trim(),
    tags: parseTags(tags),
    link: String(link || '').trim(),
    dateLabel: String(dateLabel || todayStr).trim(),
    createdAt: now.toISOString()
  };
}

/**
 * Mempool에 쌓인 1개 이상의 Activity TX를 Protocol v1 블록 메타 + 페이로드로 묶기
 */
export function buildActivityBlockSpec(txList) {
  if (!Array.isArray(txList) || txList.length === 0) {
    throw new Error('채굴할 활동 기록이 Mempool에 없습니다.');
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
      : `${txList[0].dateLabel} · 활동 ${txList.length}건 묶음`;

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

