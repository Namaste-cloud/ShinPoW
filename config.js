/**
 * ShinPoW Open Configuration (Official Genesis v1)
 * ---------------------------------------------------------------------------
 * [주의] 공식 제네시스(2026-11-21) 선언 이후 `protocol`과 `genesisTimestamp`는
 *       절대 변경하지 마세요. (변경 시 Block #0 제네시스 해시가 달라집니다.)
 */

export const APP_CONFIG = {
  appName: 'ShinPoW',
  subtitle: '지훈 & 이현의 Proof-of-Work 타임 체인',

  /**
   * 프로토콜 코어 설정 (공식 제네시스 불변 영역)
   */
  protocol: {
    magic: 'SHINPOW',
    version: 1,
    difficultyPrefix: '00',
    answerSalt: 'pow-math-kids-2026',
    networkMode: 'official',
    genesisTimestamp: '2026-11-21T00:00:00+09:00',
    genesisNote: 'ShinPoW Official Genesis — 2026-11-21 지훈 & 이현의 성장 기록 시작'
  },

  /**
   * 허브 활동 모듈 레지스트리 (추후 독서 상세 모듈 등 자유롭게 확장 가능)
   */
  modules: {
    genesis: { id: 'genesis', label: '제네시스', icon: '🌱', color: 'indigo' },
    math:    { id: 'math',    label: '수학 미션', icon: '📐', color: 'amber' },
    reading: { id: 'reading', label: '독서 기록', icon: '📖', color: 'orange' },
    study:   { id: 'study',   label: '자율 학습', icon: '📚', color: 'sky' },
    memory:  { id: 'memory',  label: '오늘의 추억', icon: '✨', color: 'emerald' },
    project: { id: 'project', label: '프로젝트', icon: '💻', color: 'violet' },
    bundle:  { id: 'bundle',  label: '복합 활동', icon: '📦', color: 'cyan' }
  },

  /**
   * 보상 단위 및 블록 등급 체계
   * 수학 누적형: 기본(+1 TIME) + 심화(+2 TIME) = 하루 최대 3 TIME
   */
  rewardUnit: 'TIME',
  tiers: {
    GENESIS: { code: 'GENESIS', label: 'GENESIS',   badge: '🌱 GENESIS', description: '체인 시작 블록', reward: 0 },
    CORE:    { code: 'CORE',    label: '기본 완료', badge: '⏱️ CORE',    description: '수학 기본 문제 해결', reward: 1 },
    BOOST:   { code: 'BOOST',   label: '심화 돌파', badge: '⚡ BOOST',   description: '수학 심화 문제 해결', reward: 2 },
    MASTER:  { code: 'MASTER',  label: '올클리어',  badge: '👑 MASTER',  description: '수학 기본+심화 동시 해결', reward: 3 },
    READING: { code: 'READING', label: '독서 기록', badge: '📖 READING', description: '독서 활동 기록', reward: 0 },
    STUDY:   { code: 'STUDY',   label: '학습 기록', badge: '📚 STUDY',   description: '자율 학습 활동 기록', reward: 0 },
    MEMORY:  { code: 'MEMORY',  label: '추억 기록', badge: '✨ MEMORY',  description: '소중한 활동과 추억 기록', reward: 0 },
    PROJECT: { code: 'PROJECT', label: '창작 기록', badge: '💻 PROJECT', description: '코딩/만들기 프로젝트 기록', reward: 0 },
    BUNDLE:  { code: 'BUNDLE',  label: '활동 묶음', badge: '📦 BUNDLE',  description: '복합 활동 블록', reward: 0 }
  },

  /**
   * 학생 독립 체인 레지스트리
   */
  students: {
    jihoon: {
      id: 'jihoon',
      chainId: 'shinpow:jihoon',
      name: '신지훈',
      grade: '초등 6학년',
      chainLabel: 'Chain A',
      accent: 'indigo'
    },
    leehyun: {
      id: 'leehyun',
      chainId: 'shinpow:leehyun',
      name: '신이현',
      grade: '초등 3학년',
      chainLabel: 'Chain B',
      accent: 'teal'
    }
  },

  /**
   * [A] 문제 피드 어댑터 설정
   */
  feed: {
    autoSyncOnLoad: true,
    type: 'json',
    url: './data/problems.json'
  },

  /**
   * [B] 로컬 + 클라우드 실시간 동기화 & 자동 Base Relayer 설정
   */
  storage: {
    localStorageKey: 'shinpow_ledger_official_v1',
    legacyStorageKey: 'shinpow_ledger_v1'
  },

  cloud: {
    enabled: true,
    apiUrl: 'https://shinpow-api.shinpow-worker.workers.dev',
    autoSyncOnLoad: true,
    autoAnchorOnMine: true
  },

  /**
   * [C] 영구 온체인 앵커링 설정 (Base Sepolia 배포 완료)
   */
  onchain: {
    provider: 'base', // 'base' | 'opentimestamps'
    opentimestamps: {
      calendars: [
        'https://a.pool.opentimestamps.org/digest',
        'https://b.pool.opentimestamps.org/digest',
        'https://alice.btc.calendar.opentimestamps.org/digest'
      ]
    },
    enabled: true,
    network: 'base-sepolia',
    contractAddress: '0x53D2A84Bf2B6D23347E21BaE50A7942eA10Ba4E4',
    networks: {
      'base-sepolia': {
        chainIdHex: '0x14a34',
        chainIdDecimal: 84532,
        name: 'Base Sepolia Testnet',
        rpcUrl: 'https://sepolia.base.org',
        explorerUrl: 'https://sepolia.basescan.org'
      },
      'base-mainnet': {
        chainIdHex: '0x2105',
        chainIdDecimal: 8453,
        name: 'Base Mainnet',
        rpcUrl: 'https://mainnet.base.org',
        explorerUrl: 'https://basescan.org'
      }
    }
  },

  /**
   * 학부모 도구 잠금 PIN
   */
  parentPin: '2026'
};
