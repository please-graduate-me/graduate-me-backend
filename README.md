# graduate-me-backend

NestJS API, PostgreSQL 스키마와 마이그레이션, 음성 처리 작업 관리자를 관리합니다. Python 음성 처리는 별도 `audio-processor` 저장소에서 실행합니다.

## 저장소 배치

```text
codding/
├── graduate-me-frontend/
├── graduate-me-backend/
└── audio-processor/
```

각 저장소는 자신의 소스와 의존성만으로 설치하고 빌드합니다. 상대 저장소의 코드를 직접 import하지 않습니다. API 계약을 변경하면 양쪽의 타입, 검증, 사용처를 함께 확인합니다.

## 로컬 개발

실행 순서는 `audio-processor` → `graduate-me-backend` → `graduate-me-frontend`입니다. Python 처리기는 자신의 README에 따라 먼저 실행합니다. 백엔드가 `graduate-me-app` 네트워크를 만들고 프론트엔드가 여기에 연결됩니다. 백엔드 작업 관리자는 처리기의 `graduate-me-processing` 네트워크에도 연결됩니다.

```sh
pnpm install --frozen-lockfile
cp .env.example .env
# .env에 인증 설정과 audio-processor와 같은 PROCESSOR_API_TOKEN을 입력합니다.
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
docker compose exec api pnpm db:seed
docker compose restart worker
```

통합 테스트는 이름이 `_test`로 끝나는 별도 DB에서만 실행합니다. 아래 구성은 포트를 공개하지 않는 임시 PostgreSQL을 만들고 마이그레이션과 전체 테스트를 실행합니다. 기존 개발 DB와 볼륨은 사용하지 않습니다.

```sh
docker compose -f compose.test.yaml up --build --abort-on-container-exit --exit-code-from api
docker compose -f compose.test.yaml down
```

`TEST_DATABASE_URL`이 없으면 DB 통합 테스트는 건너뜁니다. Python 테스트는 `../audio-processor`에서 별도로 실행합니다.

`PROCESSOR_URL`의 기본값은 `http://audio-processor:8000`입니다. 양쪽 `.env`의 `PROCESSOR_API_TOKEN`을 맞춰야 합니다. 작업 관리자는 `POST /v1/process`로 처리 요청을 보내고 JSONL 진행 이벤트와 결과를 받아 DB에 저장합니다. Python 서버는 DB에 접근하지 않습니다.
