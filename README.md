# Class-SNA 2.0

## Demo
https://class-sna-2.vercel.app/

학급 설문 CSV를 업로드하면 학생 간 관계를 정규화하고, 중심성 지표와 2D/3D 네트워크 그래프로 분석하는 웹 애플리케이션입니다.

## 주요 기능
- CSV 업로드 후 Gemini 기반 이름 정규화(오타/성 생략/표기 흔들림 보정)
- 학생 지표 계산: 인기도(in-degree), 활동성(out-degree), 매개 중심성, 고유벡터 중심성
- 2D/3D 그래프 전환, 확대/축소, 그랩 이동(버튼 + 스페이스바 홀드)
- 학생 상세 팝업: 심화 코칭 문구, 인기도/활동성 막대, 관계 목록
- 엑셀 다운로드: 요약 분석표 + 학생별 상세 시트 + AI 심화 분석 시트
- 샘플 CSV 다운로드 API 제공
- 다크/라이트 모드(시스템 설정 기본 반영)

## 기술 스택
- Next.js 16 (App Router), React 19, TypeScript
- Tailwind CSS + shadcn 스타일 컴포넌트
- graphology + louvain + react-force-graph(2D/3D)
- Gemini API (`@google/generative-ai`)
- xlsx

## 빠른 시작
```bash
# 1) 설치
bun install
# 또는 npm install

# 2) 환경변수 설정 (.env.local)
GEMINI_API_KEY=your_api_key

# 3) 개발 서버
bun run dev
# 또는 npm run dev
```
브라우저에서 `http://localhost:3000` 접속 후 CSV를 업로드하세요.

## 자주 쓰는 명령어
```bash
bun run dev      # 개발 서버
bun run lint     # ESLint
bun run build    # 프로덕션 빌드
bun run start    # 빌드 실행
```

## 프로젝트 구조
```text
src/
  app/
    api/
      analyze/route.ts       # Gemini 정규화 분석
      insights/route.ts      # AI 심화 코멘트 생성
      export-excel/route.ts  # 엑셀 생성/다운로드
      sample-csv/route.ts    # 샘플 CSV 다운로드
  components/
    upload/                  # 랜딩 업로드 화면
    dashboard/               # 분석 대시보드
    network/                 # 2D/3D 그래프
    ui/                      # 공통 UI 컴포넌트
  lib/
    parser.ts                # CSV 파싱 + 분석 진입
    analyzer.ts              # 중심성/커뮤니티 계산
    excel.ts                 # 엑셀 내보내기 클라이언트
public/
  sample.csv
```

## API 개요
- `POST /api/analyze`:
  - 입력: `{ csvData, model? }`
  - 출력: 정규화된 `students`, `relationships`, `metadata`
- `POST /api/insights`:
  - 입력: 노드/엣지 지표
  - 출력: 학급 요약 + 학생별 리스크/코멘트/실행안
- `POST /api/export-excel`:
  - 입력: FormData(`payload`)
  - 출력: `.xlsx` 바이너리
- `GET /api/sample-csv`:
  - 출력: BOM 포함 UTF-8 샘플 CSV

## 개인정보/보안
- API 키는 `.env.local`에만 저장하고 커밋하지 않습니다.
- 업로드 데이터는 요청 단위로 처리하며 영구 저장 로직이 없습니다.
- 그래프 계산은 UUID 기반 ID를 사용해 내부 처리합니다.

## 점검 체크리스트
PR 전에 아래를 확인하세요.
```bash
bun run lint
bun run build
```
- `public/sample.csv`로 업로드/그래프/엑셀 다운로드 수동 검증

## 트러블슈팅
- `GEMINI_API_KEY` 미설정 시 분석 API가 실패합니다.
- CSV 컬럼이 너무 불완전하면 정규화 품질이 낮아질 수 있습니다.
- Turbopack 내부 패닉이 발생하면 캐시 삭제 후 재시도하세요.
