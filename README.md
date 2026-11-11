# graduate-me-backend

NestJS API, PostgreSQL 스키마와 마이그레이션, 영상 분석 작업 관리자를 관리합니다.

## 저장소 배치

```text
codding/
├── graduate-me-frontend/
└── graduate-me-backend/
```

각 저장소는 자신의 소스와 의존성만으로 설치하고 빌드합니다. 상대 저장소의 코드를 직접 import하지 않습니다. API 계약을 변경하면 양쪽의 타입, 검증, 사용처를 함께 확인합니다.

## 프로젝트 문서

기획·구현 현황·검증 결과·미완료 항목은 [노션 구현 현황](https://app.notion.com/p/4133b4cce74081479866c86e64b5e7d1)에서 관리합니다.

## 인증과 조교 자격

일반 사용자와 조교는 사용자 웹에서 Google 로그인합니다. 조교는 일반 계정에 추가되는 프로필 타이틀이며, 커뮤니티 글과 댓글에 배지가 표시됩니다. 게시글 작성 시 활성 조교를 태그하면 해당 조교의 `나를 태그한 글` 메뉴에 표시합니다. 태그는 글의 기존 공개 범위를 넓히지 않으며, 지정 계정 글은 태그할 조교도 공개 대상에 포함해야 합니다. 자격을 회수하면 배지와 태그 모아보기 권한도 회수합니다.

운영 콘솔은 `ADMIN_LOGIN_ID`와 `ADMIN_PASSWORD_HASH`로 인증하며 Google 로그인이나 `ADMIN_EMAILS`를 사용하지 않습니다. 기본 계정과 기본 비밀번호는 없습니다. 백엔드 저장소에서 다음 명령으로 비밀번호를 표시하지 않고 scrypt 해시를 만듭니다.

```sh
pnpm admin:password
```

비밀번호는 10자 이상 256자 이하입니다. 생성한 해시와 아이디는 백엔드 단독 실행 시 `.env`, 통합 로컬 실행 시 `../graduate-me-infra/.env`, 홈서버 실행 시 해당 환경의 비밀 파일에 설정합니다. `$`가 포함된 해시는 Compose의 변수 확장을 피하도록 작은따옴표로 감쌉니다.

```dotenv
ADMIN_LOGIN_ID=운영자아이디
ADMIN_PASSWORD_HASH='생성한 scrypt 해시'
```

실제 비밀번호와 해시는 Git에 저장하지 않습니다. 비밀번호 해시나 아이디를 바꾸면 기존 운영 세션이 무효화됩니다. 운영 세션은 토큰 해시만 DB에 저장하고 8시간 후 만료합니다. 로그인은 전체 콘솔 기준 15분 동안 최대 10회이며 성공한 요청도 횟수에 포함합니다. 로그아웃은 서버의 토큰을 폐기합니다. API 초기화 시 배포 환경에 지정한 아이디와 비밀번호 해시를 DB에 시딩합니다. 재시작해도 같은 계정을 재사용하며 배포 설정의 해시 변경만 반영합니다. 로그인은 이미 시딩된 계정만 확인하고 계정을 생성하지 않습니다. 회원가입·계정 생성 API는 제공하지 않습니다. 감사 이력의 기존 외래 키를 위해 Google 계정과 연결되지 않는 내부 운영 행위자를 사용합니다.

`AUTH_URL`은 사용자 웹, `ADMIN_URL`은 운영 콘솔의 공개 출처입니다. 사용자 웹은 Google 세션, 콘솔은 `/api/admin` 전용 HttpOnly·SameSite=Strict 쿠키를 사용합니다. HTTPS에서는 Secure를 적용합니다. 운영 변경 요청은 `ADMIN_URL` 출처만 허용합니다. 일반 사용자·조교 Google 쿠키로 운영 API를 호출할 수 없고, 운영 쿠키로 사용자 API에 접근할 수도 없습니다.

조교 자격은 운영 콘솔의 조교 메뉴에서 이미 가입한 계정에 부여합니다. 수업 개설자·수업 조교·수강생은 수업 내부 역할이며 프로필 조교 자격과 별도입니다. 수업 개설·구성원·과제 관리는 사용자 웹의 수업 화면에서 수행합니다.

기존 개인 질문·답변과 내부 검토 이력은 보존하며 공개 커뮤니티로 자동 이전하지 않습니다. 개인 질문 신규 생성과 추가 질문은 중단하고, 자료 오류 신고는 계속 운영자에게 전달합니다. 새 학습 질문은 `/api/community/posts`의 `taggedHelperIds`로 작성합니다. 조교 목록은 `GET /api/community/helpers`, 태그 목록은 `GET /api/community/posts?tagged=true`, 본인 자격은 `GET /api/me/profile`의 `isHelper`로 조회합니다.

## 로컬 개발

백엔드 → 프론트엔드 순서로 실행합니다. 백엔드가 `graduate-me-app` 네트워크를 만들고 프론트엔드가 여기에 연결됩니다. 통합 실행은 `../graduate-me-infra`에서 관리합니다.

```sh
pnpm install --frozen-lockfile
cp .env.example .env
# .env에 인증 설정과 사용할 공급자 키를 입력합니다.
pnpm dev
```

`pnpm dev`는 Docker Compose로 실행하며 파일 변경을 반영합니다. 환경변수는 Compose에서 주입합니다. 웹은 http://localhost:3000, API는 http://localhost:4000에서 접근합니다. 프론트 컨테이너의 `API_INTERNAL_URL`은 `http://api:4000`입니다.

```sh
pnpm dev:logs
pnpm dev:down
```

## 자료 정책 설정

개발 Compose는 `MATERIAL_POLICY_PROFILE=mvp`를 사용합니다. 파일·영상·AI 요청 한도를 같은 정책에서 계산하고 `/api/learning/policy`로 화면에 전달합니다. `standard`는 일반 실행용 한도를 사용합니다. MVP에서는 기존 AI 한도 환경값이 커도 테스트 상한을 넘기지 않습니다. 실제 비밀값은 기존 환경 파일에서만 관리합니다. 상세 기준과 검증 결과는 Notion에서 관리합니다.

## AI 공급자 설정

통합 개발 환경의 실제 키는 `../graduate-me-infra/.env`에 `ANTHROPIC_API_KEY`로 설정합니다. 백엔드 단독 Compose는 이 저장소의 `.env`를 사용합니다. 키는 서버에만 전달하고 Git에 저장하지 않습니다.

일반 AI는 `AI_PROVIDER=anthropic|naver`, OCR은 `OCR_PROVIDER=anthropic|clova`로 선택합니다. 로컬 기본값은 Claude이며 `ANTHROPIC_MODEL` 기본값은 `claude-sonnet-5-5`입니다. 공급자 교체 시 해당 키·모델도 함께 설정합니다. 다른 공급자로 자동 전환하지 않습니다. 추정 비용은 공급자별 `AI_*_USD_PER_MILLION` 단가를 설정했을 때만 집계합니다.

`VIDEO_TRANSCRIPTION_PROVIDER=disabled`가 로컬 기본값입니다. 준비된 영상은 재사용하며 신규 분석은 접수하지 않습니다. 영상 전사를 활성화하려면 `gemini`와 worker 전용 Gemini·YouTube 설정이 필요합니다. 키 설정은 실제 API 호출이나 worker 실행 허가가 아닙니다.

## 검사

```sh
pnpm check
pnpm test
pnpm build
```

`pnpm check`는 포맷 적용, ESLint, 타입 검사를 순서대로 실행합니다. `pnpm build`는 이 저장소만 빌드합니다.

## Git 이력과 기존 환경 전환

기존 `graduate-me/backend`의 변경 이력을 `git subtree split`으로 추출했습니다. 파일 경로가 저장소 루트로 바뀌어 커밋 해시는 재작성되지만 해당 폴더의 변경 내용, 작성자, 커밋 메시지는 이어집니다. 기존 `graduate-me`는 원본 보관용이며, 이후 개발은 분리된 저장소에서 진행합니다. 원격 저장소는 별도로 연결해야 합니다.

기존 환경과 포트가 겹치므로 처음 전환할 때 기존 프로젝트에서 아래 명령으로 컨테이너를 내립니다. DB 볼륨은 유지됩니다.

```sh
docker compose -f compose.yaml -f compose.dev.yaml down
```

그다음 새 저장소를 위 순서대로 실행합니다. 백엔드는 기존 `graduate-me_postgres_data` 볼륨을 사용합니다. 새 DB로 시작하려면 백엔드 `.env`에 `POSTGRES_VOLUME_NAME`을 다른 이름으로 설정합니다. 같은 DB 볼륨으로 두 PostgreSQL 컨테이너를 동시에 실행하지 않습니다.

코드 배치 규칙은 [Architecture.md](Architecture.md), 작업 지침은 [AGENTS.md](AGENTS.md)를 따릅니다.

## DB와 작업 관리자

DB 작업도 실행 중인 API 컨테이너에서 수행합니다.

```sh
docker compose exec api pnpm db:migrate
# 실제 대기 작업을 처리할 때만 worker를 시작하거나 재시작합니다.
```

통합 테스트는 이름이 `_test`로 끝나는 별도 DB에서만 실행합니다. 아래 구성은 포트를 공개하지 않는 임시 PostgreSQL을 만들고 마이그레이션과 전체 테스트를 실행합니다. 기존 개발 DB와 볼륨은 사용하지 않습니다.

```sh
docker compose -f compose.test.yaml up --build --abort-on-container-exit --exit-code-from api
docker compose -f compose.test.yaml down
```

`TEST_DATABASE_URL`이 없으면 DB 통합 테스트는 건너뜁니다. 외부 API는 단위 테스트에서 대체합니다. 호스트에서 테스트 DB를 사용할 때는 컨테이너와 같은 `TZ=UTC`로 실행해 시간대 없는 DB 시각 비교를 맞춥니다. 테스트는 `_test`로 끝나는 별도 DB에서만 수행하며 worker 프로세스나 실제 AI 모델을 실행하지 않습니다.

`CLOVA_STUDIO_API_KEY`는 API와 worker에만 전달합니다. 기본 텍스트 모델은 `HCX-007`, 페이지 이미지 모델은 `HCX-005`이며 `CLOVA_TEXT_MODEL`, `CLOVA_IMAGE_MODEL`, `CLOVA_STUDIO_BASE_URL`로 설정합니다. 공식 HTTPS 주소와 지원 모델만 허용합니다. `GEMINI_API_KEY`, `YOUTUBE_API_KEY`, `GEMINI_MODEL`은 전사를 담당하는 worker에만 전달하고 YouTube Data API v3를 활성화합니다. 공급자 키를 학생 웹이나 관리자 웹에 전달하지 않습니다.

`CLOVA_OCR_INVOKE_URL`과 `CLOVA_OCR_SECRET_KEY`는 API 서버에만 전달합니다. CLOVA OCR의 General 도메인과 API Gateway를 활성화하고 콘솔의 HTTPS `/general` 호출 주소를 설정합니다. 영어 스캔 PDF를 한 페이지씩 명시적으로 인식하며 태국어 OCR은 지원하지 않습니다. 원본과 인식 결과는 버전별로 분리합니다. `OCR_ESTIMATED_USD_PER_PAGE`에 USD 페이지 단가를 설정하면 추정 비용을 기록하고, 비우면 미집계로 표시합니다. 실제 OCR을 호출하지 않는 검증은 모의 응답을 사용합니다.

`AI_DAILY_REQUEST_LIMIT`, `AI_DAILY_TOKEN_LIMIT`, `AI_CONCURRENT_REQUEST_LIMIT`는 계정별 UTC 일일 요청·토큰·동시 실행 한도입니다. `AI_PREPARATION_PAGE_LIMIT`는 한 번에 준비할 PDF 페이지 수를 제한합니다. 공급자의 토큰 집계가 누락되거나 처리가 중단되면 예약 토큰을 보존해 한도 우회를 막습니다. `AI_DAILY_BUDGET_USD`가 0보다 크면 공급자별 `AI_NAVER_*_USD_PER_MILLION`, `AI_GEMINI_*_USD_PER_MILLION` 입력·출력 단가 설정을 함께 사용하며, 단가가 없으면 생성을 차단합니다. 단가가 비어 있으면 비용 표시는 미집계이고 실청구 조회값을 추측하지 않습니다.

worker는 공식 영상 메타데이터로 공개·임베드 가능 여부와 30분 제한을 확인하고 영어·태국어 전사를 요청합니다. 검증된 전사가 준비되면 먼저 학습에 제공하고 번역과 빈칸 후보를 독립적으로 준비합니다. 같은 영상·언어·분석 버전의 결과를 재사용하며 공급자 오류와 잘못된 출력은 자동 재시도하지 않습니다. 기존 답안은 당시 구절·규칙·빈칸 비율·도움 사용 스냅샷으로 보존합니다.

AI 생성은 사용자의 명시적 생성 요청, PDF 업로드 후 자동 정리 또는 등록한 영상의 최초 준비에서 수행합니다. 조회·기존 문제 재풀이·객관식 및 단답형 채점은 AI를 호출하지 않습니다. PDF 최초 준비의 실패 페이지도 자동 재생성하지 않습니다. 실제 전사·설명 품질과 시간·비용은 실제 모델을 호출해야 확인할 수 있으며, 자동 검증은 모의 응답을 사용합니다. worker 시작은 기존 대기 작업을 실제 처리할 수 있으므로 별도 권한 없이 검증 목적으로 실행하지 않습니다.

공식 문서: [Gemini 유튜브 영상 입력](https://ai.google.dev/gemini-api/docs/video-understanding#youtube), [구조화된 출력](https://ai.google.dev/gemini-api/docs/structured-output), [YouTube 영상 메타데이터](https://developers.google.com/youtube/v3/docs/videos).

API 시작 시 DB 마이그레이션을 적용하며 영상·데모 자료를 자동 등록하지 않습니다. 데모 자료는 별도로 준비해 DB에 넣습니다. API 서버와 worker는 같은 백엔드의 별도 프로세스이며, worker는 등록된 분석 작업만 처리합니다.

## PDF 전체 자동 정리

PDF를 새로 등록하거나 새 원본 버전을 올리면 같은 트랜잭션에서 `MaterialAnalysis` 작업을 접수합니다. 최대 30페이지 전체를 페이지 이미지와 추출 텍스트로 분석해 자료 종류·소개, 페이지별 전체 번역, 핵심 단어·표현 최대 50개, 핵심 요약과 근거 페이지를 저장합니다. 해설 언어는 업로드 당시 소유자의 설정을 보존하며, 원본 교체는 새 분석을 만들고 과거 버전 결과는 유지합니다. 30페이지를 넘는 원본은 일부만 잘라 분석하지 않고 자동 정리를 생략합니다.

API 프로세스의 백그라운드 실행기가 DB 작업을 하나씩 처리하므로 영상 worker를 켤 필요가 없습니다. 원본 읽기는 분석 완료를 기다리지 않으며, PDF 화면의 전체 정리 탭에서 진행률과 완료된 페이지를 조회합니다. `GET /api/materials/:id/analysis?version=1`은 저장 결과만 반환합니다. 기존 자료의 최초 정리와 실패 후 재요청은 소유자가 `POST /api/materials/:id/analysis/retry`에 `version`, `requestId`를 전달해 시작합니다. 같은 재요청 식별자는 중복 실행하지 않으며 완료된 페이지는 보존합니다.

공급자 선택은 기존 `AI_PROVIDER` 설정을 따릅니다. 스캔본도 페이지 이미지로 처리하며 별도 CLOVA OCR 실행을 요구하지 않습니다. 전체 정리는 `AI_PREPARATION_PAGE_LIMIT`의 수동 구절 준비 제한과 별개지만 계정별 요청·토큰·동시 실행·비용 한도는 그대로 적용합니다. 한도가 부족하거나 인식·응답 검증에 실패하면 부분 결과를 보존하고 중단하며 자동 재시도하지 않습니다. 지원 페이지 수가 남은 사용량 안에서의 처리 완료를 보장하지는 않습니다. 실제 모델 품질·완전성과 비용은 모의 검증으로 보장하지 않으며 원본 대조가 필요합니다. 검증을 위해 실제 API 서버를 실행하면 대기 중 PDF 작업이 외부 AI를 호출할 수 있으므로 모의 공급자 또는 별도 테스트 DB를 사용합니다.
