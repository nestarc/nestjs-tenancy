# @nestarc 에코시스템 확장 리서치 — 인수인계 문서

> **작성일**: 2026-04-01  
> **목적**: NestJS 생태계에서 기여할 수 있는 신규 라이브러리 기회 분석  
> **현재 운영 중인 패키지**: `nestjs-safe-response`, `@nestarc/tenancy`

---

## 1. 배경 및 전략 방향

@nestarc 스코프 아래 **Prisma + PostgreSQL 기반의 일관된 SaaS 인프라 스택**을 구축하는 것이 핵심 전략이다. 개별 패키지의 경쟁력보다, 패키지 간 시너지(특히 `@nestarc/tenancy`의 RLS 컨텍스트 자동 상속)가 차별점이 된다.

**목표 메시지**: "SaaS 백엔드를 @nestarc로 시작하세요"

---

## 2. 기회 분석 — Tier별 정리

### Tier 1 — 높은 기회 (갭 큼 + 시너지 높음)

#### 2.1 `@nestarc/audit-log` — 데코레이터 기반 감사 로그

**왜 기회인가**:
- 기존 NestJS 감사 로그 라이브러리(`@forlagshuset/nestjs-audit-logging`, `@pavel_martinez/nestjs-auditlog`, `@appstellar/nestjs-audit`, `@solunertech/audit`)가 존재하지만 대부분 유지보수 부실하거나 특정 ORM/인프라에 종속
- Prisma 네이티브 + 데코레이터 한 줄(`@AuditLog()`)로 자동 기록되는 범용 모듈이 npm에 **부재**
- SOC2, GDPR 등 SaaS 규제 요건과 맞물려 수요 확실

**@nestarc/tenancy 시너지**:
- 테넌트별 감사 추적 자동화 (RLS 컨텍스트 상속)
- 테넌트 격리된 감사 로그 조회 API 제공 가능

**핵심 기능 구상**:
- `@AuditLog()` 데코레이터 (컨트롤러/메서드 레벨)
- 자동 actor 추출 (JWT/세션에서)
- Prisma 트랜잭션 내 감사 레코드 원자적 저장
- 커스터마이징 가능한 exporter (DB, stdout, 외부 서비스)
- 테넌트 컨텍스트 자동 주입

**경쟁 분석**:
| 패키지 | 문제점 |
|--------|--------|
| `@forlagshuset/nestjs-audit-logging` | 오래됨, 기능 제한 |
| `@pavel_martinez/nestjs-auditlog` | OpenTelemetry 의존, 복잡 |
| `@appstellar/nestjs-audit` | Mongoose 중심, Prisma 미지원 |
| `@solunertech/audit` | TypeORM 전용 |

**추천 우선순위: ★★★ (1순위)**

---

#### 2.2 `@nestarc/feature-flag` — DB 기반 피처 플래그

**왜 기회인가**:
- 현재 NestJS 피처 플래그 솔루션은 외부 SaaS 의존(LaunchDarkly, Tggl, ConfigCat, Unleash)이거나 OpenFeature SDK 같은 추상 레이어뿐
- 자체 PostgreSQL DB에 저장하는 경량 피처 플래그 NestJS 모듈이 npm에 **존재하지 않음**
- 블로그 포스트/튜토리얼은 많지만 패키지화된 것은 없음

**@nestarc/tenancy 시너지**:
- 테넌트별 피처 플래그 오버라이드 (A사는 beta 기능 ON, B사는 OFF)
- SaaS 가격 티어별 기능 게이팅

**핵심 기능 구상**:
- `@FeatureFlag('MARKETPLACE')` Guard 데코레이터
- `FeatureFlagService.isEnabled(flagName, context?)` 프로그래밍 방식
- PostgreSQL 저장 (Prisma 모델 자동 생성)
- 인메모리 캐시 + TTL 기반 갱신
- 테넌트/사용자/환경별 오버라이드
- A/B 테스트 확장 가능 구조

**추천 우선순위: ★★★ (1순위)**

---

#### 2.3 `@nestarc/soft-delete` — Prisma 소프트 삭제

**왜 기회인가**:
- Prisma에 소프트 삭제 내장 기능이 **없음** — 모든 프로젝트에서 미들웨어를 직접 구현
- `nestjs-paginate`(TypeORM)가 `withDeleted` 옵션 지원하지만 Prisma 전용 솔루션은 부재
- Prisma GitHub에서도 오랜 feature request임

**@nestarc/tenancy 시너지**:
- RLS + 소프트 삭제 조합으로 테넌트별 "휴지통" 기능
- 감사 로그와 연계하여 삭제/복원 이력 추적

**핵심 기능 구상**:
- Prisma 미들웨어/확장 기반 자동 `deletedAt` 필터링
- `@SoftDelete()` 데코레이터 또는 서비스 래퍼
- `restore()`, `forceDelete()` 메서드
- Cascade soft-delete 지원
- 자동 쿼리 필터 (삭제된 레코드 기본 제외)

**추천 우선순위: ★★★ (1순위)**

---

### Tier 2 — 중간 기회 (경쟁 존재하지만 차별화 가능)

#### 2.4 `@nestarc/pagination` — Prisma 커서/오프셋 통합 페이지네이션

**현황**:
- `nestjs-paginate` (TypeORM 전용, 인기 높음 — 최근 업데이트 활발)
- Prisma 네이티브로 커서/오프셋 + 필터링 + 정렬을 통합하는 패키지는 부족

**차별점**: Prisma 네이티브, `@nestarc/tenancy` 컨텍스트 자동 적용, Swagger 자동 문서화

**추천 우선순위: ★★☆**

---

#### 2.5 `@nestarc/idempotency` — RFC 호환 멱등성 모듈

**현황**:
- `@node-idempotency/nestjs` 존재 (주간 다운로드 ~500)
- Race condition 처리, Prisma 트랜잭션 통합에서 개선 여지

**차별점**: Prisma 트랜잭션 내 원자적 키 저장, Redis + PostgreSQL 듀얼 스토리지, `@nestarc/tenancy` 통합

**추천 우선순위: ★★☆**

---

#### 2.6 `@nestarc/outbox` — Transactional Outbox 패턴

**현황**:
- `@nestixis/inbox-outbox`, `@fullstackhouse/nestjs-outbox`, `@naviedu/nestjs-outbox-inbox` 등 여러 패키지 존재
- 대부분 TypeORM 또는 MikroORM 기반 — Prisma 네이티브 지원 없음

**차별점**: Prisma 네이티브, PostgreSQL LISTEN/NOTIFY 활용, `@nestarc/tenancy` 통합

**추천 우선순위: ★★☆**

---

### Tier 3 — 니치 / 고급

#### 2.7 `@nestarc/config-vault` — 타입세이프 시크릿 관리

- NestJS `@nestjs/config`의 타입 안전성 부족이 커뮤니티에서 지속적으로 불만
- ConfigService를 `main.ts`에서 사용할 수 없는 문제(GitHub Issue #2343, 2019년부터 미해결)
- Zod/Valibot 기반 스키마 검증 + 타입 추론 통합

**추천 우선순위: ★☆☆**

#### 2.8 `@nestarc/webhook` — 웹훅 발신/수신 관리

- 웹훅 서명 검증, 재시도 로직, 발신 큐잉을 통합하는 NestJS 모듈 부재
- SaaS 연동에 필수적인 인프라

**추천 우선순위: ★☆☆**

#### 2.9 `@nestarc/api-key` — API 키 발급/관리

- API 키 해싱, 스코프 기반 권한, 사용량 추적을 통합하는 NestJS 모듈 부재
- B2B SaaS에서 JWT 외 API 키 인증 수요 큼

**추천 우선순위: ★☆☆**

---

## 3. 시너지 맵

```
@nestarc/tenancy (RLS 컨텍스트)
    │
    ├── @nestarc/audit-log     → 테넌트별 감사 추적
    ├── @nestarc/feature-flag  → 테넌트별 피처 게이팅
    ├── @nestarc/soft-delete   → 테넌트별 휴지통
    ├── @nestarc/pagination    → 테넌트별 자동 필터
    ├── @nestarc/idempotency   → 테넌트별 키 격리
    └── @nestarc/outbox        → 테넌트별 이벤트 격리

nestjs-safe-response (응답 직렬화)
    │
    ├── @nestarc/pagination    → 페이지네이션 응답 표준화
    └── @nestarc/audit-log     → 응답 로깅 통합
```

모든 패키지가 **Prisma + PostgreSQL** 중심으로 일관된 DX를 제공하는 것이 핵심.

---

## 4. 추천 실행 순서

| 순서 | 패키지 | 이유 |
|------|--------|------|
| 1 | `@nestarc/audit-log` | tenancy 시너지 가장 즉각적, 규제 수요 확실, 경쟁 약함 |
| 2 | `@nestarc/feature-flag` | npm에 DB 기반 솔루션 부재, SaaS 필수 기능 |
| 3 | `@nestarc/soft-delete` | Prisma 커뮤니티 오래된 수요, 구현 난이도 상대적 낮음 |
| 4 | `@nestarc/pagination` | nestjs-paginate의 Prisma 버전 포지셔닝 |
| 5+ | idempotency, outbox, webhook, api-key, config-vault | SaaS 스택 완성 |

---

## 5. NestJS 생태계 주요 트렌드 (참고)

- **NestJS v11** 출시 — Express v5 기본 탑재, 라우트 와일드카드 문법 변경
- **ESM 미지원** 이슈가 커뮤니티 최대 불만 중 하나 (GitHub Issue #15919)
- **DI/ConfigService 개선** 요청 지속 (startup 성능, main.ts 접근성)
- **Prisma 어댑터** 2024년 공식 추가 → Prisma 생태계 성장 가속
- 2025 로드맵: Server Components 지원, 2026: WebAssembly, 2027: AI 도구

---

## 7. 다음 단계

1. `@nestarc/audit-log` 패키지 설계 시작 (API 인터페이스, Prisma 스키마, 데코레이터 설계)
2. `@nestarc/tenancy`와의 통합 인터페이스 정의
3. MVP → npm publish → 피드백 수집 → v1.0 안정화
4. 블로그 포스트 (ksyq12.dev) 및 dev.to 홍보

---

*이 문서는 NestJS 생태계 리서치 결과를 기반으로 작성되었으며, 다른 세션에서 이어서 작업할 때 컨텍스트로 활용할 수 있다.*