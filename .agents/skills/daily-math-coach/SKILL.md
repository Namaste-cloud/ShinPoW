---
name: daily-math-coach
description: >-
  Generates customized math problems and step-by-step solutions for elementary
  students (6th grader Jihoon and 3rd grader Leehyun) across comprehensive
  curriculum, Olympiad, logic, and coding-linked domains using an adjustable
  5-level difficulty system. Use when the user asks for daily math problems,
  math quizzes for children (지훈, 이현), hints, step-by-step solutions,
  difficulty adjustments, or publishing today's math set into ShinPoW.
---

# Daily Math Coach

A specialized skill for generating engaging daily math problems and clear, educational solutions tailored for elementary school students (6th grader Jihoon and 3rd grader Leehyun), integrated with the **ShinPoW** blockchain ledger.

## When to Use

- When the user asks for daily math problems for Jihoon (초6) and/or Leehyun (초3).
- When the user asks to adjust math difficulty (1 to 5 levels, including decimals like 4.5, 5.5) for specific topics or students.
- When the user requests hints, solutions, answer keys, or teaching tips for previously given problems.
- When the user asks for curriculum-aligned, advance-learning, Olympiad, STEAM/interdisciplinary, or logic-based math exercises for elementary grades.
- When the user asks to register/publish generated problems directly into ShinPoW (`data/problems.json`).

## Target Students and Open-Ended Curriculum Scope

Do NOT restrict problem generation to a fixed set of 6 domains. Draw freely and creatively across pure mathematics, Olympiad/creative thinking, and interdisciplinary STEAM fields (physics, robotics, astronomy, art, finance, coding, etc.) tailored to each child's level and interests:

### 신지훈 (초등학교 6학년 — 초등 전 과정 마스터 + 중등 심화/KMO·영재원·STEAM 융합)

- **수론 및 정수론 심화**: 분수·소수 혼합 연산, 약수와 배수, 소인수분해, 최대공약수·최소공배수 문장제 활용, 유클리드 호제법 기초, 약수의 개수와 총합, 끝자리 수(일의 자리·0의 개수) 추론, 정수와 유리수, 거듭제곱, 진법 및 모듈러(나머지) 연산 기초.
- **대수, 방정식 및 금융 수학**: 비와 비율, 비례식과 비례배분, 다항식 연산 및 곱셈 공식 입문, 일차방정식·연립방정식·일차부등식 활용(속력·농도·일·과부족·실생활 최대/최소 최적화), 비율·할인·원가·정가·이자 계산.
- **함수와 해석**: 정비례와 반비례, 좌표평면과 그래프 해석, 일차함수($y=ax+b$)의 기울기와 절편 이해, 두 직선의 교점과 연립방정식의 관계, 속력-시간-거리 그래프 해석, 수열 및 계차·군수열의 규칙 찾기.
- **평면도형 및 기하 심화**: 원의 넓이, 원주각과 중심각 기초, 다각형의 성질, 평행선과 각, 삼각형·사각형의 합동과 닮음(닮음비를 이용한 길이·넓이 비), 삼각형의 오심(외심·내심·무게중심) 직관적 이해, 피타고라스 정리 입문, 등적변형, 테셀레이션.
- **입체기하, 공간지각 및 위상**: 각기둥/각뿔, 원기둥/원뿔/구, 쌓기나무와 입체 단면 추론, 겨냥도와 전개도, 회전체 및 다각도 투영(정사영 기초), 오일러의 다면체 정리($v - e + f = 2$), 정다면체와 준정다면체 성질, 입체도형의 최단 거리(전개도 활용), 한붓그리기(오일러 경로).
- **창의사고력 및 이산수학·게임이론**: 발상의 전환이 필요한 영재원·KMO 입문형 퍼즐, 비둘기집 원리, 경우의 수(합의 법칙·곱의 법칙), 순열·조합 기초, 확률 및 여사건 활용, 기댓값 기초, 집합 기초, 전략 게임(필승 전략 찾기, 님 게임 등).
- **로보틱스·코딩 알고리즘 수학**: 센서 거리·각도 제어 연산, 모터 회전수·기어비·바퀴 둘레 기반 주행 거리 계산, 좌표계 이동 및 회전 변환 기초, 조건 분기·반복 루프 횟수 계산, 이진 탐색·정렬 원리 및 최적화 경로 탐색.
- **물리학 연계 수학**: 등속 운동·평균 속력·상대 속도, 지레의 원리와 돌림힘(모멘트) 평형, 도르래와 일의 원리, 밀도·부피·질량 관계, 빛의 반사각·입사각과 기하학적 경로, 전기 회로(직렬·병렬 저항 비례) 기초.

### 신이현 (초등학교 3학년 — 초3~초5 핵심 + 창의사고력·방정식 기초·STEAM 융합)

- **수와 연산 및 수 퍼즐**: 세 자리~큰 수의 사칙연산과 어림·유효숫자 감각, 자연수의 혼합 계산, 약수와 배수 기초, 단위분수와 진분수·가분수·대분수 변환, 분수·소수의 개념과 덧셈·뺄셈, 복면산·벌레먹은셈, 마방진·스도쿠·카쿠로 등 수 퍼즐.
- **방정식 기초 및 대수·규칙성**: 미지수($\square$, $x$)를 사용한 등식 세우기, 양팔저울의 평형을 이용한 방정식 원리 이해, 거꾸로 풀기, 규칙과 대응(표·식 만들기), 도형·수 배열의 패턴 추론, 피보나치 수열과 파스칼의 삼각형 기초.
- **코딩·로보틱스 논리 수학**: 반복 알고리즘과 조건문(만약 ~라면) 논리 퍼즐, 로봇 이동 명령(전진·회전 각도) 경로 추론, 암호 해독(치환 암호·시저 암호 기초).
- **측정과 비례 감각**: 길이, 시간, 들이, 무게의 단위 환산과 복합 연산, 시계 각도 및 달력 계산, 속력(빠르기)의 직관적 비교, 축척과 지도 거리 계산, 톱니바퀴의 회전수(반비례 기초).
- **평면도형 및 예술·미술 수학**: 선분·반직선·직선, 각도와 삼각형·사각형의 성질, 다각형의 대각선 개수와 내각의 합, 원의 구성 요소, 도형의 이동(밀기·뒤집기·돌리기), 선대칭도형과 점대칭도형, 황금비와 비례 감각, 프랙탈 패턴 기초, 테셀레이션(에셔 스타일 쪽매맞춤), 원근법과 투시 도형, 색채 혼합 비율.
- **입체도형과 공간지각**: 직육면체와 정육면체의 기초, 쌓기나무 개수 세기, 위·앞·옆에서 본 모양 추론, 전개도를 접었을 때 마주 보는 면과 겹치는 꼭짓점 찾기, 거울에 비친 모양 추론, 종이접기 후 구멍 뚫기(대칭 추론).
- **물리학 연계 수학**: 무게중심과 균형 잡기, 경사면과 굴러가는 거리 비교, 용수철 늘어난 길이(비례 기초), 소리의 속도와 메아리 시간 계산, 거울의 반사와 빛의 직진 경로.
- **천문학 연계 수학**: 지구·달·태양의 크기와 거리 비례 감각, 행성 공전 주기와 최소공배수(행성 정렬 주기), 달의 위상 변화 주기(음력과 보름달 계산), 별자리 각도와 방위각, 빛의 속도와 광년 거리 감각, 시간대와 시차 계산.
- **자료, 경우의 수 및 논리 추론**: 표와 그래프(줄기와 잎 그림·꺾은선그래프) 해석, 평균 기초, 수형도를 이용한 경우의 수, 벤다이어그램 기초, 서랍 원리(비둘기집 원리 기초), 조건표(논리 그리드)를 이용한 참·거짓 논리 추론.

## 5-Level Difficulty System

Default difficulty is **Level 3 (3등급)** unless specified otherwise. Decimal increments such as Level 4.5, 5.5, or 6.5 are supported when fine-tuning difficulty.

- **Level 1 (기초/개념)**: 해당 학년 교과 기본 개념 및 연산 확인 문제.
- **Level 2 (표준/응용)**: 해당 학년 교과서 및 익힘책 표준 응용 문제.
- **Level 3 (심화/선행 기초 — 기본값)**: 해당 학년 중상급 심화 문제 또는 1–2학년 위 선행 개념의 중하급 입문 문제.
- **Level 4 (상위 심화)**: 해당 학년 고난도 사고력 문제 또는 1–2학년 위 선행 중급 응용 문제.
- **Level 5 (최고난도/경시)**: 수학 올림피아드 및 경시대회 입문 수준의 창의 사고력 문제.

## Workflow

### 1. Problem Generation

1. **Identify Student and Grade**: Check whether the request is for Jihoon (초6), Leehyun (초3), or both.
2. **Set Difficulty Level**: Use Level 3 by default (for ShinPoW daily sets: Basic = Level 3 / +1 TIME, Adv = Level 4 / +2 TIME unless the user requests different levels).
3. **Select Diverse Topics Freely**: Draw broadly and unpredictably across pure math, creative problem-solving, and interdisciplinary themes (physics, robotics, astronomy, art, logic, etc.) without limiting rotation to a rigid 6-category loop.
4. **Craft Engaging Context**:
   - Incorporate relatable storytelling scenarios (everyday life, science/astronomy, robotics, art/design, games, exploration).
   - Keep calculations clean and focused on logical reasoning rather than tedious arithmetic.
   - Ensure every problem has a clean, unambiguous final answer (integer, decimal, or reduced fraction like `3/8`) and include input guidance like `(숫자만 입력)` or `(예: 3/8 형태로 입력)` when generating for ShinPoW.
5. **Output Format (Normal Mode)**:
   - Present only the problem clearly formatted with student name, grade, domain/topic, and difficulty level.
   - Do **NOT** include the answer or full solution in the initial problem prompt so the student can solve it independently.
   - Add a short encouraging message and mention that hints/solutions can be requested anytime.

### 2. Solution and Teaching Guidance

When the user asks for the answer, solution, or guidance:
- **Answer**: State the final numerical/analytical answer clearly.
- **Step-by-Step Explanation (아이 눈높이 풀이)**: Break down the solving process into sequential, intuitive steps with simple language and visual/logical representations.
- **Core Concepts (핵심 개념 및 공식)**: Summarize the underlying mathematical principles used.
- **Parent Coaching Tips (학부모 지도 가이드)**: Provide targeted questions to ask if the child is stuck, and highlight common mistakes and gentle guidance strategies.

### 3. ShinPoW Direct Publishing Workflow

When the user asks to **add/publish today's problems to ShinPoW** (`data/problems.json`):
1. Double-check every problem's mathematical calculation carefully before hashing!
2. Insert the new day entry at the **top** of `jihoon` and/or `leehyun` arrays in `data/problems.json` using IDs `jh-YYYY-MM-DD` / `lh-YYYY-MM-DD` and label `YYYY-MM-DD (요일)`.
3. Immediately run `node scripts/hash-problems.mjs` so plaintext `answer` fields are converted to SHA-256 `answerHash` and removed from `data/problems.json` (ensuring children cannot read answers from the file).
4. Show the user only the formatted problems (without revealing plaintext answers unless the user specifically asks for the parent answer key).

## Gotchas

- Avoid overly intimidating terminology for lower grades.
- When advancing 1–2 grades or introducing Olympiad/STEAM concepts, connect the new concept to intuitive foundations the child already knows.
- Never output the solution together with the problem unless explicitly requested.

