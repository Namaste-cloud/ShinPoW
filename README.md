# ShinPoW — 지훈 & 이현의 Proof-of-Work 타임·활동·추억 블록체인 허브

수학 미션, 학습시간, 게임·자유시간 사용, 오늘의 활동과 추억, 프로젝트까지 **실제 SHA-256 Proof-of-Work 채굴**을 통해 영원불변한 장부로 기록하는 독립 블록체인 웹/앱(PWA)입니다.

- **Mempool.space 스타일 블록 익스플로러**: 대기 중인 Mempool 큐와 확정된 블록 큐브(`#N ← #N-1 ← ... ← #0 Genesis`)를 시각적으로 탐색하고, 블록을 클릭해 내부 활동 내역과 해시 연결을 추적
- **멀티 액티비티 허브 (Protocol v1)**:
  - `📐 수학 미션`: 기본 `+1 TIME (CORE)` + 심화 `+2 TIME (BOOST)` = 하루 최대 `+3 TIME (MASTER)`
  - `📚 학습 시간`: 독서·영어·코딩 등 학습 기록 (`+TIME`)
  - `🎮 게임·자유시간`: 채굴한 `TIME` 사용 기록 (`-TIME`)
  - `✨ 활동·추억`: 그날의 일기·추억·기분·태그 영구 기록 (`0 TIME`)
  - `💻 프로젝트`: 로봇·코딩·작품 결과물 및 링크 기록
- **로컬 `daily-math-coach` 스킬 내장**: `.agents/skills/daily-math-coach/SKILL.md`로 Antigravity에서 바로 맞춤형 수학 문제 출제·난이도 조절·해시 자동 변환 가능
- **Base L2 온체인 앵커링**: `contracts/ShinPoWAnchor.sol`로 Base Sepolia(무료) 테스트 후 Base Mainnet(연간 수백 원)에 영구 기록 ([배포 가이드](docs/BASE_DEPLOY.md))
- **빌드 없는 순수 ES Modules + Tailwind + PWA**: 의존성 부식 없이 10년 뒤에도 아이들 포트폴리오로 그대로 실행·이전 가능

---

## 빠른 실행 (로컬 서버)

```bash
python3 -m http.server 8080
```

브라우저에서 `http://localhost:8080` 접속!
- 학부모 관리 도구 기본 PIN은 **`2026`**이며, `config.js`의 `parentPin`에서 변경할 수 있습니다.

---

## 자동 테스트 & 문제 해시 CLI

```bash
# Protocol v1, 수학 12문제 해시, 멀티 액티비티, 원장 복원, Base ABI 인코딩 검증
node --test tests/protocol.test.mjs

# data/problems.json 안의 평문 answer를 SHA-256 answerHash로 일괄 변환
node scripts/hash-problems.mjs
```

---

## GitHub Pages 자동 배포 (무료 웹/앱)

이미 `.github/workflows/pages.yml`과 `.github/workflows/test.yml`이 구성되어 있습니다.

1. GitHub에서 새 레포지토리(예: `ShinPoW`) 생성
2. 로컬에서 원격 연결 후 push:
   ```bash
   git remote add origin https://github.com/<아이디>/ShinPoW.git
   git push -u origin main
   ```
3. GitHub 레포지토리 **Settings → Pages → Source: `GitHub Actions`** 선택
4. 자동 배포된 HTTPS 주소로 아이들 태블릿/폰에서 접속 후 **"홈 화면에 추가"**하면 앱으로 설치됩니다.
