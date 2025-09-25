# myproject
# 습관형성 RPG PWA

바닐라 JS 기반 프론트엔드와 Node.js + Express + SQLite 백엔드로 구성된 습관 형성 RPG 애플리케이션입니다. 오프라인에서도 퀘스트를 추가/수정/완료할 수 있으며, 연결이 복구되면 자동으로 서버와 동기화됩니다.

## 주요 기능
- 6개 도메인(체력/지력/감성/의지/영성/말씀)에 대한 레벨 & XP 관리
- 오늘/내일/다가올 퀘스트 탭 UI 및 반복/미루기/삭제/편집 기능
- 퀘스트 완료 시 의지 XP 자동 증가 및 레벨업 보상 안내(텍스트/사운드)
- 로컬 큐 기반 오프라인 변경 사항 저장 & 온라인 전환 시 자동 동기화
- PWA 지원(서비스 워커, 웹 매니페스트, 홈 화면 추가)
- Render/Railway 배포를 고려한 Express API와 CORS 화이트리스트

## 디렉터리 구조
```
frontend/    # PWA 클라이언트 (index.html, app.js, styles.css, manifest.json, sw.js, assets)
backend/     # Express API 서버 (app.js, server.js, routes/, db.js, schema.sql)
TASKS.md     # 완료된 개발 태스크 체크리스트
```

## 로컬 개발 환경 세팅

### 1. 백엔드(Node.js + Express)
1. [Node.js 18 LTS](https://nodejs.org/) 이상 설치
2. `.env` 파일 생성
   ```bash
   cp backend/.env.example backend/.env
   ```
3. 필요한 환경 변수 수정 (예: `CORS_WHITELIST`, `DATABASE_FILE`, `PORT`).
4. 의존성 설치 & 서버 실행
   ```bash
   cd backend
   npm install
   npm start
   ```
5. 테스트 실행 (Node 18 이상, `node --test` 사용)
   ```bash
   npm test
   ```
   > 주의: 네트워크 제한 환경에서는 `npm install`이 실패할 수 있습니다. 이 경우 오프라인 패키지 캐시를 사용하거나 프록시를 설정해야 합니다.

### 2. 프론트엔드(PWA)
1. `frontend/` 디렉터리를 정적 서버(예: `npx serve frontend`)나 VSCode Live Server로 호스팅합니다.
2. 브라우저에서 접속 후 최초 로딩 시 `X-Device-ID` 헤더가 자동으로 생성되어 백엔드와 통신합니다.
3. 설정 다이얼로그에서 API 베이스 URL(`http://localhost:4000` 등)을 필요에 맞게 수정할 수 있습니다.

## SQLite 초기화
`backend/db.js`가 서버 기동 시 `schema.sql`을 실행하여 필요한 테이블(users, domains, quests, app_config 등)을 생성하고, 도메인/레벨/보상 기본 데이터를 시드합니다.

## API 엔드포인트 개요
| Method | Endpoint | 설명 |
| --- | --- | --- |
| POST | `/api/bootstrap` | 최초 실행 시 사용자/도메인/설정 시드 및 스냅샷 반환 |
| GET | `/api/snapshot` | 도메인/설정/퀘스트 스냅샷(오늘/내일/다가올 그룹 포함) |
| POST | `/api/quests` | 퀘스트 생성 (`title`, `domain_name`, `xp`, `date`, `is_daily`) |
| PATCH | `/api/quests/:id` | 퀘스트 속성 수정/미루기/반복 옵션 변경 |
| DELETE | `/api/quests/:id` | 특정 퀘스트 삭제 |
| POST | `/api/quests/:id/complete` | 완료 처리 + 도메인 XP/보상 계산 |
| GET/PATCH | `/api/domains` | 도메인 조회 / 레벨 임계값·보상 목록 개별 수정 |
| GET/PATCH | `/api/config` | 기본 레벨 임계값/보상/의지 XP 설정 조회 및 수정 |
| POST | `/api/reset` | 유저 진행 데이터 초기화 |

모든 API 요청에는 `X-Device-ID` 헤더가 필요하며, 레이트리밋이 적용됩니다.

## 오프라인 처리 & 동기화
- 퀘스트 생성/수정/삭제/완료/설정 변경은 오프라인 시 로컬 큐에 저장됩니다.
- 네트워크 복구 시 큐가 순차적으로 서버와 동기화되고, 실패한 항목은 재시도 횟수 제한 후 사용자에게 상태가 표시됩니다.
- 서비스 워커는 정적 자산을 캐시하여 오프라인에서도 UI를 제공하고, API 요청 실패 시 503 JSON 응답을 반환합니다.

## 배포 가이드 요약
- **프론트엔드:** GitHub Pages에 `frontend/` 폴더를 정적 호스팅. 배포 후 설정 화면에서 API URL을 실제 백엔드 도메인으로 변경.
- **백엔드:** Render/Railway에서 Node 서비스로 배포. `PORT`, `CORS_WHITELIST`, `DATABASE_FILE` 등을 환경 변수로 등록. `DATABASE_FILE`은 영구 볼륨에 위치시켜 데이터 보존.
- **CORS:** 백엔드 `.env`의 `CORS_WHITELIST`에 프론트엔드 배포 도메인을 추가.

## iOS (Safari) 홈 화면 추가 안내
1. Safari에서 PWA에 접속 후 공유 버튼을 누릅니다.
2. `홈 화면에 추가`를 선택하고 아이콘/이름을 확인합니다.
3. 홈 화면에서 실행하면 독립 실행형 모드로 동작하며, 오프라인 시에도 최근 상태를 확인할 수 있습니다.

## 테스트 및 품질
- `backend/tests/api.test.js`: Node 내장 테스트 러너(`node:test`)와 `supertest`로 기본 API 흐름을 검증합니다.
- ESLint/Prettier 설정은 포함되어 있지 않지만, 프로젝트 구조상 쉽게 추가할 수 있도록 구성했습니다.

## 라이선스
해당 프로젝트는 사내/개인 프로젝트에 자유롭게 참고할 수 있도록 공개되었습니다.