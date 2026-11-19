# ShinPoW Protocol v1 Specification

> **지훈 & 이현의 독립 Proof-of-Work 타임 체인 허브 프로토콜 명세서**

이 문서는 **ShinPoW** 체인의 불변 규칙을 정의합니다.
UI, 학습 모듈(수학 → 코딩/영어/독서/프로젝트), 문제 출제 방식, 저장소는 언제든 자유롭게 개선할 수 있지만, **공식 제네시스 블록 선언 이후 이 문서에 정의된 `Protocol v1` 블록 헤더 및 해시 계산 규칙은 변경하지 않습니다.**

---

## 1. 설계 철학 (Immutable Core, Open Ecosystem)

1. **독립 체인**: 각 학생은 고유한 `chainId`(`shinpow:jihoon`, `shinpow:leehyun`)를 가진 독립 블록체인을 운영합니다.
2. **도메인 중립 허브**: 블록 헤더는 `module` 필드와 `payloadHash`만 고정합니다. 오늘의 수학 문제(`math`)뿐 아니라, 추후 코딩 과제(`coding`), 영어(`english`), 독서(`reading`), 개인 프로젝트(`project`)까지 동일한 체인에 끊김 없이 이어집니다.
3. **Proof of Time (`TIME`)**: 문제를 스스로 해결하고 실제 SHA-256 Nonce 탐색(PoW)을 완료했을 때 `TIME` 보상이 블록에 영구 기록됩니다.
   - 기본 문제 해결: `CORE` (`+1 TIME`)
   - 심화 문제 해결: `BOOST` (`+2 TIME`)
   - 기본 + 심화 동시 해결: `MASTER` (`+3 TIME`)
4. **오프체인 + 온체인 하이브리드 영구 보존**:
   - 일상 채굴은 0원(즉시 실행, PWA 오프라인 지원).
   - 주기적으로 블록 해시 또는 머클 루트를 **Base Mainnet (Ethereum L2)** `ShinPoWAnchor.sol` 컨트랙트에 앵커링하여 10년 뒤에도 누구나 검증 가능한 포트폴리오 기록으로 남깁니다.

---

## 2. Protocol v1 블록 구조

```json
{
  "version": 1,
  "chainId": "shinpow:jihoon",
  "index": 1,
  "prevHash": "<64-char lowercase hex>",
  "timestamp": "2026-11-19T09:30:00+09:00",
  "module": "math",
  "tier": "MASTER",
  "reward": {
    "amount": 3,
    "unit": "TIME"
  },
  "payload": {
    "dayId": "jh-d1",
    "label": "2026-11-19 (오늘)",
    "parts": ["adv", "basic"],
    "topics": { "basic": "...", "adv": "..." },
    "proofs": { "basic": "<sha256>", "adv": "<sha256>" }
  },
  "payloadHash": "<sha256(canonicalJson(payload))>",
  "difficulty": "00",
  "nonce": 412,
  "hash": "00...",
  "onchain": null
}
```

> **`onchain` 필드**: 블록 채굴 완료 *이후* Base L2에 앵커링할 때 기록되는 메타데이터이므로, **블록 헤더 해시 계산 대상에서 제외**됩니다.

---

## 3. 해시 및 검증 규칙 (Deterministic Verification)

### 3.1 `payloadHash` 계산
1. `payload` 객체를 키 사전순으로 정렬한 결정론적 JSON 문자열(`canonicalStringify`)로 직렬화합니다.
2. UTF-8 바이트에 SHA-256을 적용한 64자리 소문자 16진수 문자열이 `payloadHash`입니다.

### 3.2 블록 헤더 프리이미지(Preimage)
아래 13개 필드를 파이프(`|`)로 연결하여 UTF-8 SHA-256 해시를 계산합니다:

```text
SHINPOW|v{version}|{chainId}|{index}|{prevHash}|{timestamp}|{module}|{tier}|{reward.amount}|{reward.unit}|{payloadHash}|{difficulty}|{nonce}
```

### 3.3 체인 무결성 검증 조건
모든 블록 `i = 0 .. N-1`에 대해 아래 조건을 모두 만족해야 합니다:
1. `block.version === 1` 및 `block.index === i`
2. `i === 0`: `prevHash === "000...000"`(64자), `module === "genesis"`, `tier === "GENESIS"`
3. `i > 0`: `prevHash === chain[i - 1].hash` 및 `hash.startsWith(difficulty)`
4. `sha256(canonicalStringify(block.payload)) === block.payloadHash`
5. `sha256(buildHeaderPreimage(block)) === block.hash`

---

## 4. 공식 제네시스 선언 체크리스트 (Preview → Official 전환)

개발·테스트(`networkMode: 'preview'`)가 끝나고 실제 장기 기록을 시작할 때:
1. `config.js`에서 `protocol.networkMode`를 `'official'`로 변경합니다.
2. `protocol.genesisTimestamp`와 `protocol.genesisNote`를 공식 시작일로 확정합니다.
3. `contracts/ShinPoWAnchor.sol`을 **Base Mainnet**에 배포하고 `config.js`의 `onchain.contractAddress`에 기록합니다.
4. 공식 제네시스 해시(`Block #0`)를 이 문서 하단에 영구 기록합니다.

### Official Genesis Record
- **Status**: `PREVIEW` (공식 런칭 전 테스트 기간)
- **Base Mainnet Anchor Contract**: *(배포 후 기록)*
- **Jihoon Genesis Hash (`shinpow:jihoon`)**: *(공식 런칭 후 고정)*
- **Leehyun Genesis Hash (`shinpow:leehyun`)**: *(공식 런칭 후 고정)*

