# infra-admin.md — 인프라 / 인증 / 관리자 / 다국어

## 1. 인프라 스택

- **프론트엔드/배포**: Vercel (Next.js 기반 PWA)
- **백엔드/데이터**: Firebase (Firestore, Authentication, Storage, Cloud Functions)
- **AI 산출물 저장**: 전량 Firebase Storage/Firestore에 저장, 로컬/빌드 번들 저장 절대 금지 (`core.md` §2-2)
- **향후 확장**: Capacitor를 이용한 네이티브 쉘 — 문자(SMS) 연동 등 OS 레벨 권한이 필요한 기능이 요구될 때 도입

## 2. 확장성을 위한 구조 원칙

- **모노레포 지향 폴더 구조**: 지금은 웹 단일 앱이지만, 추후 `apps/web`, `apps/native-shell`, `packages/core`(공용 비즈니스 로직) 형태로 분리 가능하도록 처음부터 로직을 UI와 분리
- **입력 소스 추상화**: `ai-voice-input.md`의 `InputSource` 인터페이스로 신규 채널 추가 시 핵심 파싱/저장 로직 변경 없이 어댑터만 추가
- **비즈니스 로직과 UI 분리**: 파싱/AI 처리/Firestore 쓰기 로직은 프레임워크 비종속 서비스 레이어로 작성 → 네이티브 쉘 추가 시 재사용

## 3. 인증

- 구글 로그인 (Firebase Authentication)
- 사용자 프로필은 `users/{uid}` 문서에 저장 (`data-model.md` §8)

## 4. 관리자 모드

- 별도 관리자 권한 플래그(`users/{uid}.role === "admin"`)
- 관리자 대시보드에서 확인 가능한 항목 (Phase 6에서 구체화):
  - 전체 사용자 현황
  - 워크스페이스/프로젝트 통계
  - AI 사용량/비용 모니터링 (이미지 생성, STT/TTS, LLM 호출량)
  - 오류 로그, 신고/피드백 관리

## 5. 다국어 (i18n)

- 초기 지원 언어: 한국어, 영어 (확장 가능한 구조로 설계)
- 번역 리소스는 코드베이스 내 정적 리소스로 관리 (UI 텍스트) — 단, AI가 생성하는 콘텐츠(요약, 회고 등)는 사용자 언어 설정에 따라 동적 생성되며 별도 번역 파일 불필요
- 사용자 언어 설정은 `UserPreferences.language`에 저장

## 6. 다크 / 라이트 모드

- `design-system.md` §5 참조. 전역 토글, 디자인 토큰 기반.

## 7. 보안/권한 원칙 (기본)

- Firestore 보안 규칙: 워크스페이스 단위로 소유자/멤버만 읽기·쓰기 가능
- Storage 보안 규칙: 사용자 본인 및 워크스페이스 멤버만 에셋 접근 가능
- Gmail/카카오 연동 시 OAuth 토큰은 Firebase의 안전한 서버 사이드(Cloud Functions) 영역에서만 취급하고 클라이언트에 노출하지 않음
