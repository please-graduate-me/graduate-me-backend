# graduate-me-backend

NestJS API, PostgreSQL 스키마와 마이그레이션, 영상 분석 작업 관리자를 관리합니다. NestJS worker가 YouTube Data API와 Gemini API를 직접 호출합니다.

## 저장소 배치

```text
codding/
├── graduate-me-frontend/
└── graduate-me-backend/
```

각 저장소는 자신의 소스와 의존성만으로 설치하고 빌드합니다. 상대 저장소의 코드를 직접 import하지 않습니다. API 계약을 변경하면 양쪽의 타입, 검증, 사용처를 함께 확인합니다.

## 원문 학습과 admin 작업 공간

학생 웹은 `/api/materials`, `/api/expressions`, `/api/questions`, `/api/practice/attempts`, `/api/learning/*`를 사용합니다. PDF는 10MB·200페이지 이하로 등록하고, 브라우저에서 추출한 페이지 텍스트를 원본과 함께 저장합니다. OCR·AI 해설·생성 문제는 아직 연결하지 않으며 지원 여부를 응답에 명시합니다. 표현 연습은 자가점검으로 기록하고 당시 표현·뜻·원문 근거를 보존합니다.

별도 관리자 웹은 `/api/admin/workspace/*`를 사용합니다. 운영자는 `ADMIN_EMAILS`로 지정하고, 도우미는 운영 화면에서 기존 Google 로그인 계정에 담당 언어·자료·검토·수정 요청 권한을 부여합니다. 도우미는 현재 권한 범위와 배정 질문이 모두 일치할 때만 접근합니다. 학생에게는 게시한 답변만 반환하고 초안·내부 메모·내부 이력은 반환하지 않습니다. 도우미나 운영자에게도 질문자가 공유하지 않은 개인 PDF 원본·메모를 제공하지 않습니다.

검토 요청에는 구절·설명·문제의 대상과 버전, 처리 사유를 저장합니다. 아직 없는 설명·문제 저장소를 수정한 것처럼 처리하지 않습니다. 사용량 화면은 실제 영상 처리 작업만 표시하고 비용·토큰 미집계 상태를 유지합니다. 수동 분석 재시도 API는 작업을 다시 생성하지 않고 `410`을 반환합니다.

`AUTH_URL`은 학생 웹, `ADMIN_URL`은 별도 관리자 웹의 공개 주소입니다. 상태 변경 요청과 로그인 후 이동은 이 두 출처만 허용합니다. 두 앱이 다른 호스트를 사용할 경우 OAuth 콜백과 쿠키 범위는 배포 도메인에 맞춰 설정해야 합니다. 환경변수 주입과 실행은 Compose가 담당합니다.

## 로컬 개발

백엔드 → 프론트엔드 순서로 실행합니다. 백엔드가 `graduate-me-app` 네트워크를 만들고 프론트엔드가 여기에 연결됩니다. 통합 실행은 `../graduate-me-infra`에서 관리합니다.

```sh
pnpm install --frozen-lockfile
cp .env.example .env
# .env에 인증 설정, GEMINI_API_KEY와 YOUTUBE_API_KEY를 입력합니다.
pnpm dev
```

`pnpm dev`는 Docker Compose로 실행하며 파일 변경을 반영합니다. 환경변수는 Compose에서 주입합니다. 웹은 http://localhost:3000, API는 http://localhost:4000에서 접근합니다. 프론트 컨테이너의 `API_INTERNAL_URL`은 `http://api:4000`입니다.

```sh
pnpm dev:logs
pnpm dev:down
```

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
docker compose restart worker
```

통합 테스트는 이름이 `_test`로 끝나는 별도 DB에서만 실행합니다. 아래 구성은 포트를 공개하지 않는 임시 PostgreSQL을 만들고 마이그레이션과 전체 테스트를 실행합니다. 기존 개발 DB와 볼륨은 사용하지 않습니다.

```sh
docker compose -f compose.test.yaml up --build --abort-on-container-exit --exit-code-from api
docker compose -f compose.test.yaml down
```

`TEST_DATABASE_URL`이 없으면 DB 통합 테스트는 건너뜁니다. 외부 API는 단위 테스트에서 대체합니다. 호스트에서 테스트 DB를 사용할 때는 컨테이너와 같은 `TZ=UTC`로 실행해 시간대 없는 DB 시각 비교를 맞춥니다. 테스트는 `_test`로 끝나는 별도 DB에서만 수행하며 worker 프로세스나 실제 AI 모델을 실행하지 않습니다.

worker에만 `GEMINI_API_KEY`, `YOUTUBE_API_KEY`, `GEMINI_MODEL`을 주입합니다. YouTube Data API v3를 활성화해야 하며 모델 기본값은 `gemini-3.8-flash`입니다. 사용할 수 있는 모델은 키와 프로젝트에 따라 확인하고 환경변수로 변경합니다. 키는 브라우저와 API 컨테이너에 전달하지 않습니다.

worker는 공식 영상 메타데이터로 공개 여부, 임베드 가능 여부와 15분 제한을 확인한 뒤 Gemini에 유튜브 URL과 JSON 전사 요청을 보냅니다. 구절 시간·순서·텍스트를 검증하고 성공 결과만 기존 Segment 테이블에 저장합니다. 외부 API의 429·5xx, 통신 실패와 잘못된 출력은 기존 최대 3회 재시도를 사용합니다. 실행 중 취소와 15분 타임아웃도 전달합니다. 취소 전에 공급자가 처리한 요청은 과금될 수 있습니다.

이번 연결은 기존 영어 받아쓰기 계약을 유지합니다. 번역·문맥 설명·다국어 채점·계정별 분석 한도는 포함하지 않습니다. 단어별 정렬 정보는 생성하지 않으며 `words`는 빈 배열입니다.

실제 전사 정확도와 구절 반복 재생의 시간 정밀도, 처리 시간과 비용은 키를 설정한 뒤 실제 영상으로 확인해야 합니다. JSON 검증만으로 실제 발화와의 일치를 보장하지 않습니다.

공식 문서: [Gemini 유튜브 영상 입력](https://ai.google.dev/gemini-api/docs/video-understanding#youtube), [구조화된 출력](https://ai.google.dev/gemini-api/docs/structured-output), [YouTube 영상 메타데이터](https://developers.google.com/youtube/v3/docs/videos).

API 시작 시 DB 마이그레이션만 적용하며 영상·분석 작업·데모 자료를 자동 등록하지 않습니다. 데모 자료는 별도로 준비해 DB에 넣습니다. API 서버와 worker는 같은 백엔드의 별도 프로세스이며, worker는 등록된 분석 작업만 처리합니다.
