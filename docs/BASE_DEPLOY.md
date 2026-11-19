# Base Sepolia / Base Mainnet 온체인 앵커링 배포 가이드

`contracts/ShinPoWAnchor.sol`은 외부 의존성이 전혀 없는 단일 Solidity 파일(`^0.8.24`)이므로, **Remix IDE**로 2분 만에 배포하거나 **Foundry**로 CLI 배포할 수 있습니다.

---

## 1단계: Base Sepolia 테스트넷 배포 (무료)

### 방법 A — 브라우저 Remix IDE (가장 쉬움, 설치 불필요)
1. 지갑(MetaMask 또는 Coinbase Wallet)에 **Base Sepolia** 네트워크를 추가합니다.
   - RPC: `https://sepolia.base.org`
   - Chain ID: `84532`
   - Explorer: `https://sepolia.basescan.org`
2. Coinbase / Alchemy Base Sepolia Faucet에서 무료 테스트 ETH를 소량(0.01 ETH면 수만 건 테스트 가능) 받습니다.
3. [remix.ethereum.org](https://remix.ethereum.org)에 접속해 `contracts/ShinPoWAnchor.sol` 내용을 붙여넣고 컴파일(Solidity `0.8.24`)합니다.
4. **Deploy & Run Transactions** 탭에서 Environment를 `Injected Provider - MetaMask`로 선택하고 **Deploy**를 누릅니다.
5. 배포된 컨트랙트 주소를 복사해 `config.js`에 입력합니다:

```js
onchain: {
  enabled: true,
  network: 'base-sepolia',
  contractAddress: '0x여기에_배포된_컨트랙트_주소'
}
```

### 방법 B — Foundry CLI (개발자용)
```bash
forge create contracts/ShinPoWAnchor.sol:ShinPoWAnchor \
  --rpc-url https://sepolia.base.org \
  --private-key "$DEPLOYER_PRIVATE_KEY"
```

---

## 2단계: 앱에서 온체인 앵커링 실행하기

1. ShinPoW 앱 우측 상단 **학부모 모드** 잠금 해제 (기본 PIN: `2026`).
2. **Base 앵커링** 버튼 클릭 → 미앵커링 블록 수와 계산된 **머클 루트** 확인.
3. **지갑으로 Base 앵커링 실행** 클릭 → 지갑 서명 1번으로 완료!
4. 완료 후 각 블록 카드와 Mempool 인스펙터에 **`⛓️ BaseScan`** 검증 링크가 자동으로 연결됩니다.

---

## 3단계: 공식 제네시스(Base Mainnet) 전환 시

테스트가 충분히 만족스러워지면:
1. `contracts/ShinPoWAnchor.sol`을 **Base Mainnet** (`Chain ID: 8453`, RPC `https://mainnet.base.org`)에 배포합니다. (배포 가스비 약 50원~200원 미만, 이후 배치 앵커링 1건당 약 1~3원)
2. `config.js`에서:
   - `protocol.networkMode: 'official'`
   - `protocol.genesisTimestamp`: 공식 런칭 시각 확정
   - `onchain.network: 'base-mainnet'`
   - `onchain.contractAddress`: 메인넷 배포 주소
3. `docs/PROTOCOL.md` 하단에 공식 제네시스 해시와 컨트랙트 주소를 영구 기록합니다.
4. 나중에 아이들이 성인이 되었을 때 본인 지갑 주소로 `transferOwnership(아이_지갑_주소)`를 호출해 온체인 컨트랙트 소유권을 그대로 물려줄 수 있습니다.
