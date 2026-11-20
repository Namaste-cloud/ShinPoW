/**
 * ShinPoW Open Configuration
 * ---------------------------------------------------------------------------
 * 개방형 설정 파일입니다.
 * 학생 정보, TIME 보상 체계, 확장 활동 모듈, 문제 피드, Base 온체인 설정을 관리합니다.
 *
 * [주의] 실제 공식 제네시스 블록이 확정된 후에는 `protocol`과 `genesisTimestamp`는
 *       변경하지 마세요. (변경 시 기존 제네시스 해시가 달라집니다.)
 */

export const APP_CONFIG = {
  appName: 'ShinPoW',
  subtitle: '지훈 & 이현의 Proof-of-Work 타임 체인 허브',

  /**
   * 프로토콜 코어 설정 (공식 제네시스 선언 후 불변 영역)
   */
  protocol: {
    magic: 'SHINPOW',
    version: 1,
    difficultyPrefix: '00',
    answerSalt: 'pow-math-kids-2026',
    /**
     * preview: 개발/테스트 기간 (자유롭게 초기화 가능)
     * official: 공식 제네시스 확정 후 운영 모드 (UI에 공식 배지 표시)
     */
    networkMode: 'preview',
    genesisTimestamp: '2026-11-19T00:00:00+09:00',
    genesisNote: 'ShinPoW Hub Genesis Block — Proof of Learning, Time & Memories'
  },

  /**
   * 허브 활동 모듈 레지스트리 (자유롭게 새 모듈 추가 가능)
   */
  modules: {
    genesis: { id: 'genesis', label: '제네시스', icon: '🌱', color: 'indigo' },
    math:    { id: 'math',    label: '수학 미션', icon: '📐', color: 'amber' },
    study:   { id: 'study',   label: '학습 시간', icon: '📚', color: 'sky' },
    game:    { id: 'game',    label: '게임·자유시간', icon: '🎮', color: 'rose' },
    memory:  { id: 'memory',  label: '활동·추억', icon: '✨', color: 'emerald' },
    project: { id: 'project', label: '프로젝트', icon: '💻', color: 'violet' },
    bundle:  { id: 'bundle',  label: '복합 활동', icon: '📦', color: 'cyan' }
  },

  /**
   * 보상 단위 및 블록 등급 체계 (새로운 블록부터 적용, 언제든 커스터마이징 가능)
   * 수학 누적형: 기본(+1 TIME) + 심화(+2 TIME) = 하루 최대 3 TIME
   */
  rewardUnit: 'TIME',
  tiers: {
    GENESIS: { code: 'GENESIS', label: 'GENESIS', badge: '🌱 GENESIS', description: '체인 시작 블록', reward: 0 },
    CORE:    { code: 'CORE',    label: '기본 완료', badge: '⏱️ CORE',    description: '수학 기본 문제 해결', reward: 1 },
    BOOST:   { code: 'BOOST',   label: '심화 돌파', badge: '⚡ BOOST',   description: '수학 심화 문제 해결', reward: 2 },
    MASTER:  { code: 'MASTER',  label: '올클리어',  badge: '👑 MASTER',  description: '수학 기본+심화 동시 해결', reward: 3 },
    STUDY:   { code: 'STUDY',   label: '학습 기록', badge: '📚 STUDY',   description: '학습 시간 활동 기록', reward: 1 },
    GAME:    { code: 'GAME',    label: '시간 사용', badge: '🎮 GAME',    description: '게임/자유시간 TIME 사용', reward: -1 },
    MEMORY:  { code: 'MEMORY',  label: '추억 기록', badge: '✨ MEMORY',  description: '소중한 활동과 추억 기록', reward: 0 },
    PROJECT: { code: 'PROJECT', label: '창작 기록', badge: '💻 PROJECT', description: '코딩/만들기 프로젝트 기록', reward: 2 },
    BUNDLE:  { code: 'BUNDLE',  label: '활동 묶음', badge: '📦 BUNDLE',  description: 'Mempool 복합 활동 블록', reward: 0 }
  },

  /**
   * 학생 독립 체인 레지스트리 (추후 학생 추가 가능)
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
   * [B] 로컬/원격 저장소 설정
   */
  storage: {
    localStorageKey: 'shinpow_ledger_v1',
    legacyStorageKey: 'pow_math_kids_v1'
  },

  /**
   * [C] 영구 온체인 앵커링 설정
   * - 기본값: 'base' (Base Sepolia 무료 테스트 -> 공식 런칭 시 Base Mainnet 전환)
   * - 선택 옵션: 'opentimestamps' (비트코인 메인넷 .ots 증명)
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
    enabled: false,
    network: 'base-sepolia', // 'base-sepolia' | 'base-mainnet'
    contractAddress: '',
    networks: {
      'base-sepolia': {
        chainIdHex: '0x14a34', // 84532
        chainIdDecimal: 84532,
        name: 'Base Sepolia Testnet',
        rpcUrl: 'https://sepolia.base.org',
        explorerUrl: 'https://sepolia.basescan.org'
      },
      'base-mainnet': {
        chainIdHex: '0x2105', // 8453
        chainIdDecimal: 8453,
        name: 'Base Mainnet',
        rpcUrl: 'https://mainnet.base.org',
        explorerUrl: 'https://basescan.org'
      }
    }
  },

  /**
   * 학부모 도구 잠금 PIN (아이들 실수 방지용 경량 잠금 — 언제든 변경 가능)
   */
  parentPin: '2026'
};
