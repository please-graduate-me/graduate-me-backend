# 기획서 구현 대조 기록

기준일: 2026-11-09. [기능 세부 정리](https://app.notion.com/p/4123b4cce740807b8552f576666fe163)의 18개 하위 문서와 [AI 활용 계획](https://app.notion.com/p/4123b4cce74080e38465d9ed00fd6df1)을 대조했다. [Figma](https://www.figma.com/design/wZzxITMkpVzxFU8PvkhJv5/please-graduate-me?node-id=0-1)의 학생 학습 화면과 별도 관리자 화면을 데스크톱 기준으로 구현했다.

학생 웹은 `graduate-me-frontend`의 `lib/styles/theme.css.ts`, 관리자 웹은 별도 저장소 `graduate-me-admin`의 `src/app/theme.ts`에서 디자인 시스템을 관리한다. 도우미도 관리자 앱으로 진입한다. 앱 간 타입과 업무 로직을 직접 import하지 않는다.

## 범위 정정

2026-11-09 사용자 정정: 쉐도잉은 요청 기능으로 취급하지 않는다. OCR은 구현 요구에 포함한다. 초안의 후속·제외 가능 표기를 근거로 OCR 제외를 확정했던 이전 판단을 철회했다. 아래 기록은 현재 사용자 지시를 우선한다.

## 기능별 구현

아래의 구현 완료는 코드와 모의 응답·DB 검증 기준이다. 실제 AI의 언어 품질이나 브라우저에서의 시각적 품질 검증을 완료했다는 뜻은 아니다.

| 문서 | 구현한 사용자 흐름 | 주요 구현 위치 |
| --- | --- | --- |
| 01 로그인과 학습 설정 | Google 인증, 비로그인 홈·준비된 데모, 단계별 안내, 목표·설명 언어·수준·관심 저장, 언어별 목록, 재인증 시 입력 보존, 로그아웃·탈퇴 | `src/auth/`, `src/users/profile.service.ts`, 학생 `app/_components/DemoGuide.tsx`, `SessionRecovery.tsx`, `app/(authenticated)/settings/` |
| 02 영상 등록과 자동 분석 | 영어·태국어, 공식 메타데이터로 최대 30분 확인, ID·언어·분석 버전별 재사용, 신규 명시적 분석만 접수, 실패 재시도 없음, 전사·번역·빈칸 독립 상태 | `src/videos/videos.service.ts`, `youtube.ts`, `src/worker/processor.service.ts`, `video-preparation.service.ts` |
| 03 구절 재생·반복 | 공식 플레이어의 구절 이동·반복·속도·연속 스크립트 재생, 보조 키 기반 단축키, IME 입력 보호, 플레이어 실패 안내 | 학생 `app/_components/Study.tsx`, `useYouTubePlayer.ts` |
| 04 빈칸·전체 받아쓰기 | 빈칸 20·40·60%, 전체·스크립트 모드, 저장 후보·태국어 분절, 모드별 초안, 힌트·정답 열람 기록, 버전이 바뀐 제출 거부 | `src/videos/actions.ts`, `grading.ts`, `videos.service.ts`, 학생 `app/_components/Study.tsx` |
| 05 채점·피드백 | 앞뒤 공백 정리 후 전체 일치로 서버 채점, 입력 차이 표시, 요청 중복 방지, 당시 원문·정답·도움·버전 보존 | `src/videos/grading.ts`, `videos.service.ts`, `src/database/entities/Attempt.entity.ts` |
| 06 뜻·번역·설명 | 명시적 PDF 페이지 준비, 저장 번역 재사용, 선택 원문의 뜻·번역·구조·개념·예문·불확실성·인용 구분, 실제 문맥 범위 표시, 선택적 페이지 이미지 입력 | `src/ai/learning-ai.service.ts`, `provider.service.ts`, 학생 `app/_components/AiExplanation.tsx` |
| 07 원문 AI 질문 | 출처·자료 버전별 개인 대화, 후속 질문, 별도 관련성 판별, 무관 질문 본문 생성 차단, 저장 대화 조회 시 호출 없음, 실제 제공 문맥 기록 | `src/ai/conversation.service.ts`, 학생 `app/_components/AiConversation.tsx` |
| 08 개인 표현집 | 단어·숙어·문장·개념, 언어·유형·검색·복습 포함 필터, 메모 수정, 같은 표현·출처 중복 제어, 저장 당시 설명 연결, 원문 위치 복귀 | `src/learning/expressions.service.ts`, 학생 `app/(authenticated)/expressions/` |
| 09 맞춤 적용 연습 | 원문·저장 표현·실제 오답 기반 생성, 수준·설명 언어 참고, 객관식·짧은 정답·자유 답변, 생성 검증, 정답 숨김, 서버 채점, 자유 답변은 정오 없이 피드백, 힌트·열람·제외·재풀이·과거 답안 | `src/ai/practice.service.ts`, `artifact.service.ts`, 학생 `app/(authenticated)/practice/` |
| 10 진도·학습 기록 | 모드 중 하나에서 통과한 고유 구절만 완료 집계, 미완료는 최대 99%, 시청·열람만으로 진도 증가 안 함, PDF 읽기 위치, 실제 자료·질문·자가점검·연습·영상·주석·설명·대화 8종 이력, 언어별 필터 | `src/videos/videos.service.ts`, `src/learning/learning.service.ts`, 학생 `app/(authenticated)/history/` |
| 11 받아쓰기 약점 분석 | 원문의 후속 확장 범위. 현재 실제 오답·시도·도움 이력을 보존하고 재풀이 근거로 제공 | `src/database/entities/Attempt.entity.ts`, `ExerciseAttempt.entity.ts` |
| 12 관심·수준별 추천 | 원문의 후속 확장 범위. 현재 설정 저장과 접근 가능한 자료 선택·직접 등록 제공 | `src/users/profile.service.ts`, `src/videos/catalog.service.ts` |
| 13 자료·발췌 공유 | 영상·구절 공유, PDF 선택 발췌 명시적 공유, 공개·허용 계정·철회, 로그인 후 공유 위치 복귀, 수신자 개인 진도 분리, 원본 권한 별도 검사 | `src/shares/`, `src/learning/records.service.ts`, 학생 `app/(authenticated)/shared/` |
| 14 도우미 질문·검토 | 학생이 선택한 발췌·AI 설명·선택 답변·문항만 공유, 해결과 답변 상태 분리, 공유 철회, 담당 언어·자료별 권한, 답변·내부 메모, 실제 수정·검토·영향·버전 이력 | `src/learning/questions.service.ts`, `src/admin/workspace-questions.service.ts`, `content.service.ts`, 관리자 `src/app/routes/_dashboard/questions/` |
| 15 쉐도잉·말하기 | 사용자 정정에 따라 요청 기능에서 제외. 초안의 표현을 사용자가 확정한 요구로 취급하지 않음 | 신규 구현하지 않음 |
| 16 운영 관리 | 공용 PDF·영상 등록, 원본 공개·계정 ACL, 도우미 권한·배정, 오류 신고·처리, 전사·번역·설명·문항 수정, 버전별 검토, 문제 노출 중단, 과거 답안 보존, AI 요청·한도·추정 비용 조회 | `src/admin/`, 관리자 `src/app/routes/_dashboard/` |
| 17 수업·과제·학생 관리 | 원문의 학교 도입 후속 확장 범위. 현재 수업 미가입 학생도 개인 학습 가능 | 수업 생성·과제 배정·학사 연동은 미구현 후속 범위 |
| 18 PDF 읽기·선택·OCR | PDF.js 원본 표시·선택·정규화 영역·위치 복귀, 하이라이트·메모, 원본·과거 버전·권한 보존. 저장 원본의 한 페이지 CLOVA OCR, 별도 인식층·신뢰도·영역 선택, OCR 출처를 AI·표현·질문·공유에 연결 | `src/learning/materials.service.ts`, `source.service.ts`, `records.service.ts`, `src/ocr/`, 학생 `app/(authenticated)/materials/` |

## 저장·권한·AI 실행 기준

- PDF는 기본 비공개이다. 공용 원본도 읽기 위치·메모·AI 대화·표현·답안은 계정별로 분리한다. 읽지 않은 공개 PDF를 개인 읽기 이력에 넣지 않는다.
- 원본 열람과 선택 발췌·질문의 공유는 별도 권한이다. 도우미에게 질문해도 PDF 원본이나 개인 대화 전체가 공개되지 않는다. 현재 영상 ACL은 재등록·원문 조회·구절 동작에도 적용한다.
- PDF 원본·영상 전사·설명·문항은 버전을 보존한다. 수정 전 답안의 당시 정답·해설·근거를 바꾸지 않는다. 구버전 검토가 현재 버전을 검토 완료로 만들지 않는다. 현재 버전과 다른 화면의 영상 제출은 충돌로 거부한다.
- PDF 최초 준비는 요청 페이지 범위만 처리하고 실패한 페이지를 설명 언어 변경으로 재분석하지 않는다. 새 상세 질문·연습 요청과 최초 준비를 구분한다. 조회·재생·규칙 채점·데모·서버 시작은 AI를 호출하지 않는다.
- 네이버 텍스트는 HCX-007, 페이지 이미지는 HCX-005 연결 코드를 사용한다. Gemini는 영상 전사·구절 시간에 한정한다. 모델 키는 Compose의 서버 환경으로만 주입한다.
- 초기 기본 한도는 AI 1일 100회·200000토큰·동시 2개, PDF 준비 1회 10페이지다. PDF 파일은 10MB·200페이지 이하이다. 환경설정에서 조정할 수 있다. 한도 도달 후에도 저장 결과를 조회할 수 있다.
- 공급자가 토큰 사용량을 반환하지 않으면 예약 토큰을 한도 계산에 유지한다. 실제 청구액은 연동하지 않았으므로 미집계로 표시한다. 설정 단가로 계산한 USD 추정 비용과 구분한다.
- 탈퇴 시 개인 데이터는 삭제하고 타인 질문의 공개 답변·운영 이력은 작성자 정보의 외래 키만 해제해 당시 표시 이름과 본문을 보존한다.

## 검증 근거

각 저장소의 `pnpm check`와 빌드를 수행했다. OCR 추가 후 백엔드 26개 파일의 모의·DB 테스트 133개, 학생 웹 38개, 관리자 웹 6개가 통과했다. local API·학생 웹·관리자 웹의 Docker 이미지 빌드와 정상 기동, 마이그레이션 반영, 비로그인 보호 경로의 401 응답을 확인했다. worker 이미지는 빌드했으며 프로세스는 중지 상태로 유지했다. 초기 구현 검증은 실제 AI 호출을 막은 모의 공급자와 이름이 `_test`로 끝나는 별도 PostgreSQL DB를 사용했다.

| 대상 | 확인 범위 |
| --- | --- |
| `src/ai/learning-flow.integration.test.ts` | 최초 준비·캐시·실패 재분석 차단, 개인 대화·범위 제어, 제출 전 정답 비공개·규칙 채점·중복 제출, 수정 전후 답안 보존·검토·철회, 여러 출처 문제·자유 답변, 실제 개인 이력 |
| `src/ai/limits.integration.test.ts` | 미확인 토큰·예약량, 호출 전 한도, 중단된 요청·늦은 응답·동일 식별자 보호 |
| `src/learning/records-materials.integration.test.ts` | 원본 ACL·개인 읽기, PDF 과거 파일·출처 불변, 주석 소유권·공유 철회, 프로필·탈퇴, 공용 PDF·태국어 도우미 후보 |
| `src/videos/learning.integration.test.ts` | 영상 중복 등록·답안 저장, 모드·비율·버전 진도, 199/200 완료 경계, 운영자 원문 수정과 제출 경합 |
| `src/videos/library.integration.test.ts` | 비공개·계정 ACL·권한 철회·과거 답안 보존 |
| `src/ai/provider.service.test.ts`, `src/worker/*.test.ts` | 공급자 요청 형식·출력 검증·실패 처리·독립 준비 단계, 실제 네트워크 없이 확인 |
| 학생·관리자 Vitest | 계약·라우트·공유·인증 복귀 등 모의 단위 검증 |
| 인프라 `scripts/check.mjs` | local·development·production Compose 구성, 서버 AI 설정 전달·브라우저 키 배제·환경 격리 |

Playwright, 브라우저 실행 테스트, 실제 OCR API·AI 모델 호출은 사용자 지시에 따라 수행하지 않았다. 실제 언어별 설명·전사 품질, 구절 시간과 실제 음성의 일치, 실제 브라우저 선택 위치·플레이어 동작과 시각적 결과는 이 검증 결과에 포함하지 않는다.

## 현재 구현하지 않은 확장 항목

FLEX 심화, 심층 약점 분석·학년별 로드맵, 관심 기반 추천, 생성 문제의 일반 공유, 자유게시판·팔로우, 수업·과제·학사 연동, 자유 펜 필기·복잡한 레이아웃 인식은 초안에서 후속 확장으로 구분했다. 위 확장 항목은 완료 기능으로 표시하지 않는다. OCR은 사용자 정정에 따라 이 목록에서 제외하고 아래 범위로 구현했다. 쉐도잉은 사용자가 의도한 기능으로 취급하지 않는다. 학교 도우미 선발·장학금·활동 인정은 협의가 필요한 운영 제안이다. 패드·모바일 확장은 사용자의 데스크톱 한정 지시에 따라 이번 구현에서 제외했다.

## OCR 구현과 지원 범위

- 저장된 원본 PDF에서 지정 버전의 한 페이지를 서버가 추출해 CLOVA OCR General V2에 전달한다. 클라이언트가 임의로 보낸 이미지를 원본 인식으로 취급하지 않는다. CropBox와 90도 단위 회전을 고정하고, 결과 페이지·요청 식별자·비율·인식 좌표·신뢰도를 검사한다.
- `GET /api/materials/:id/ocr?version=N&page=N`은 기존 원본 읽기 권한으로 저장 결과만 조회한다. `POST /api/materials/:id/ocr`의 `{requestId,version,page}`는 소유자가 현재 원본의 한 페이지만 명시적으로 인식한다. 과거 버전과 공유 자료의 독자는 저장 결과만 조회한다.
- 완료된 결과는 재사용하고 덮어쓰지 않는다. 처리 중 중복·동시 요청을 제어하며 자동 재시도하지 않는다. 실패한 페이지는 새 명시적 요청으로 다시 인식할 수 있다. 원본 교체 후에도 이전 인식 결과와 출처는 당시 버전으로 유지한다.
- OCR 글자와 정규화 좌표·신뢰도를 별도 저장한다. 학생 화면은 원본 위에 선택 가능한 인식층을 표시하고 신뢰도 0.8 미만 영역을 점선으로 구분한다. 인식 신뢰도는 실제 정확도를 보증하는 수치가 아니다. 원본과 대조할 수 있게 안내한다.
- PDF 출처의 `ocrId`를 표현·주석·AI 대화·설명·문제·질문·공유·이력과 원문 복귀 링크에 유지한다. 인식 글자와 PDF 자체 텍스트의 대화·결과는 구분한다. 기본 설명 준비는 저장된 인식 글자를 재사용한다.
- [공식 도메인 지원 언어](https://guide.ncloud-docs.com/docs/clovaocr-domain)에는 영어가 기본 포함되며 태국어는 없다. 이번 CLOVA OCR 경로는 영어 PDF를 지원한다. 태국어 스캔 OCR은 호출 전에 미지원으로 안내하며, 태국어 텍스트가 내장된 PDF 선택은 계속 제공한다. [General V2 API](https://api.ncloud-docs.com/docs/ai-application-service-ocr-ocr)의 응답 형식과 좌표를 기준으로 구현했다.
- `CLOVA_OCR_INVOKE_URL`, `CLOVA_OCR_SECRET_KEY`, 선택적인 `OCR_ESTIMATED_USD_PER_PAGE`는 Compose의 API 서버에만 주입한다. worker·학생 웹·관리자 웹에 비밀키를 전달하지 않는다. OCR은 페이지 단가를 사용하며 LLM 토큰 단가를 적용하지 않는다. 실제 청구액은 미집계로 유지한다.
- `src/ocr/ocr-provider.service.test.ts`와 `src/ocr/ocr.integration.test.ts`에서 요청 형식·단일 페이지 추출·좌표, 권한·중복·재사용, OCR 원문·AI 연결, 실패 복구·버전 보존·한도를 모의 응답과 별도 테스트 DB로 확인한다. 실제 OCR API나 AI 모델은 호출하지 않는다.
