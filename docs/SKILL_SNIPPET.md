# Gemini Skill / Spark 연동용 출력 포맷 스니펫

기존에 사용 중인 **Gemini Skill(또는 Spark)** 지침 맨 아래에 아래 블록만 그대로 붙여 넣으세요.
그러면 평소처럼 대화로 난이도를 조절해 문제를 만들면서도, **ShinPoW에 바로 붙여넣거나 `data/problems.json`에 추가할 수 있는 정확한 JSON**을 자동으로 출력해 줍니다.

---

## 기존 Gemini Skill 끝에 붙여넣을 지침

```text
[ShinPoW JSON 출력 규칙]
문제를 모두 완성한 뒤, 마지막에 반드시 아래 JSON 형식으로 한 번 더 정리해서 코드블록으로 출력해 주세요.
- id 규칙: 지훈은 "jh-YYYY-MM-DD", 이현은 "lh-YYYY-MM-DD"
- label 규칙: "YYYY-MM-DD (요일)" 형식
- basic: 기본 문제 (+1 TIME), adv: 심화 문제 (+2 TIME)
- question 끝에는 아이들이 입력 형식을 헷갈리지 않도록 "(숫자만 입력)" 또는 "(예: 3/8 형태로 입력)" 안내를 붙여주세요.
- answer: 숫자 또는 기약분수(예: "42", "111.6", "3/8")로 단위 없이 간결하게 작성하세요. (앱에 등록할 때 자동으로 SHA-256 해시로 변환됩니다.)

```json
{
  "jihoon": [
    {
      "id": "jh-2026-11-20",
      "label": "2026-11-20 (금)",
      "basic": {
        "topic": "단원명 · 난이도",
        "question": "기본 문제 내용 (숫자만 입력)",
        "answer": "정답"
      },
      "adv": {
        "topic": "단원명 · 난이도",
        "question": "심화 문제 내용 (숫자만 입력)",
        "answer": "정답"
      }
    }
  ],
  "leehyun": [
    {
      "id": "lh-2026-11-20",
      "label": "2026-11-20 (금)",
      "basic": {
        "topic": "단원명 · 난이도",
        "question": "기본 문제 내용 (숫자만 입력)",
        "answer": "정답"
      },
      "adv": {
        "topic": "단원명 · 난이도",
        "question": "심화 문제 내용 (숫자만 입력)",
        "answer": "정답"
      }
    }
  ]
}
```
```

---

## 반영 방법 2가지

1. **가장 빠른 방법 (앱에서 바로 붙여넣기)**
   - 앱 우측 상단 `학부모 모드` 잠금 해제(기본 PIN `2026`) → `JSON 가져오기` → 위 JSON 붙여넣기 → **저장 즉시 SHA-256 해시 변환 완료**.
2. **모든 기기 자동 동기화 (GitHub Pages / 웹 호스팅 사용 시)**
   - `data/problems.json`에 추가하거나, Google Sheets + Apps Script 웹앱 URL을 `config.js`의 `feed.url`에 연결하면 아이들이 앱을 열 때마다 자동으로 오늘 문제가 나타납니다.
   - *(주의: 공개 GitHub 레포지토리에 `data/problems.json`을 올릴 때는 평문 `answer` 대신 `answerHash`로 변환된 값을 올리면 아이들이 소스를 봐도 답을 알 수 없습니다.)*

