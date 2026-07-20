# KNU_AI_Boost_team3

공유 메일 내용을 정리하여 대학 부서 담당자의 홈페이지 공지 작성을 간편하게 돕는 1-Day PRD 기반 프로토타입입니다.

외부 공고 메일을 입력하면 유형, 대상, 기간, 주요 혜택, 신청 방법, 문의처를 규칙 기반으로 정리하고, 확인이 필요한 항목은 `담당자 확인 필요`로 표시합니다. 결과는 학교 홈페이지 게시글 형태로 복사할 수 있으며, 실제 AI 연동이 아닌 예시 결과임을 화면에 안내합니다.

## 실행 방법

```bash
npm install
npm run dev
```

빌드와 점검:

```bash
npm run build
npm run lint
npm run check:prototype
```

## 환경 변수

`.env.example`을 참고해 필요한 경우 `.env`를 만듭니다.

```env
VITE_APP_ENV=development
```

현재 프로토타입은 별도 API 키나 비밀 값을 필요로 하지 않습니다.
