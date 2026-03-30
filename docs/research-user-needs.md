# NestJS 멀티테넌시 사용자 니즈 리서치 보고서

> 조사일: 2026-03-30
> 목적: @nestarc/tenancy v1.0.0 방향 설정을 위한 사용자 수요 및 경쟁 환경 분석

---

## 1. 경쟁 환경 현황

### 1-1. NestJS 멀티테넌시 패키지 비교

| 패키지 | 주간 DL | Stars | DB 지원 | 상태 |
|--------|---------|-------|---------|------|
| `@needle-innovision/nestjs-tenancy` | ~85 | 192 | MongoDB만 | 방치 (2022-10 이후 릴리스 없음) |
| `nestjs-mtenant` | ~29 | 139 | Sequelize | 미약 |
| `prisma-rls` | ~678 | - | Prisma (NestJS 무관) | 활발 |
| `type-rls` | ~1,705 | - | TypeORM RLS | 활발 |
| `@nestarc/tenancy` (우리) | 신규 | - | Prisma + PG RLS | **유일한 NestJS + Prisma + RLS 패키지** |

### 1-2. 인접 생태계

- `nestjs-cls`: 주간 806K DL — 대부분의 개발자가 직접 구현할 때 사용하는 AsyncLocalStorage 기반 인프라
- `prisma-multi-tenant`: 주간 75 DL, 2022년 이후 방치
- `@payloadcms/plugin-multi-tenant`: 주간 29K DL — NestJS 외 생태계지만 멀티테넌시 수요의 규모를 보여줌

### 1-3. 핵심 발견

NestJS 멀티테넌시 생태계는 사실상 **공백 상태**. 가장 인기 있는 전용 패키지가 MongoDB 전용이고 방치 상태. Prisma + PostgreSQL RLS 조합을 NestJS 패키지로 제공하는 라이브러리는 `@nestarc/tenancy`가 사실상 유일. 성숙한 생태계(Laravel stancl/tenancy 3.3k stars, django-tenants 1.5k stars)와 비교하면 NestJS에는 거대한 갭이 존재.

---

## 2. 사용자 니즈 — 카테고리별 분석

### Tier 1: 가장 높은 수요 (채택을 좌우하는 기능)

#### 1-1. 마이크로서비스 테넌트 전파

- **근거**: needle-innovision 이슈 #37, #38 (22개 코멘트, 가장 많이 논의된 주제)
- **문제**: HTTP 요청 → gRPC/Kafka/Bull 큐로 테넌트 컨텍스트가 전달되지 않음
- **사용자 목소리**: "We use microservices and tenant context is lost between services"
- **성숙 프레임워크 참고**: Spring Boot는 ThreadLocal + 인터셉터로 해결, Laravel은 tenant-aware queue 제공

#### 1-2. 테스팅 유틸리티

- **근거**: nestjs/nest#7216 (테스트 어려움 이슈), AWS SaaS Lens 권고, 어떤 NestJS 라이브러리도 제공하지 않음
- **필요한 것**:
  - `TestTenancyModule`: 미들웨어 없이 테넌트 컨텍스트 설정
  - 테넌트 격리 검증 assertion
  - 테스트 픽스처 헬퍼
- **왜 중요**: 멀티테넌트 앱 테스트는 현저히 어려움 — 격리 누수는 보안 사고로 직결

#### 1-3. 다중 격리 전략 (Schema-per-tenant, Database-per-tenant)

- **근거**: 모든 아키텍처 가이드가 3가지 전략 비교, TypeORM #4786, 다수 블로그 포스트
- **사용자 기대**: 전략만 바꾸면 코드 변경 없이 격리 수준 조정

```typescript
TenancyModule.forRoot({
  strategy: 'rls',        // 현재 지원
  // strategy: 'schema',  // 스키마 분리 → 규제 산업
  // strategy: 'database', // DB 분리 → 엔터프라이즈
})
```

#### 1-4. Admin 바이패스 / 크로스 테넌트 쿼리

- **근거**: needle-innovision 이슈 #27, #29, #30 (14개 코멘트, 두 번째로 많이 요청)
- **현 상태**: 우리는 `@BypassTenancy()`와 `withoutTenant()` 이미 제공 — 경쟁 우위
- **추가 필요**: 테넌트 impersonation (관리자가 특정 테넌트로 전환)

---

### Tier 2: 높은 수요 (차별화 기능)

#### 2-1. 테넌트 라이프사이클 관리

- **근거**: Laravel의 CreateDatabase → MigrateDatabase → SeedDatabase 파이프라인, django-tenants의 management commands
- **필요한 것**:
  - `createTenant()` → 스키마 생성 + 마이그레이션 + 시딩 한 번에
  - `deleteTenant()` → 정리 + 아카이빙
  - 이벤트 시스템: `TenantCreated`, `TenantDeleted`, `TenantMigrated`
- **왜 중요**: 현재 NestJS에서 테넌트 프로비저닝은 100% 수동

#### 2-2. Fail-Closed 모드 (안전 장치)

- **근거**: RLS 프로덕션 최대 위험 — `set_config` 누락 시 모든 행 노출
- **필요한 것**: 테넌트 컨텍스트 없으면 쿼리 자체를 차단하는 옵션
- **현재 우리**: Guard에서 요청은 차단하지만, 백그라운드 작업에서의 DB 접근은 보호 안 됨

#### 2-3. 테넌트 인식 캐싱

- **근거**: Laravel이 자동 제공, AWS SaaS Lens 권고, 캐시 키 충돌은 데이터 누출 벡터
- **필요한 것**: 캐시 키에 자동 테넌트 프리픽스, Redis/인메모리 모두 지원

```typescript
@CacheKey('users') // 실제 키: tenant_abc:users
```

#### 2-4. ORM 확장 (TypeORM, Drizzle, MikroORM)

- **근거**: nestjs/typeorm#58 (15 reactions), `type-rls` 주간 1,705 DL (Prisma보다 높음)
- **현실**: TypeORM 사용자 풀이 Prisma보다 큼 — 지원하면 TAM 대폭 확대
- **접근법**: 플러그인 아키텍처로 ORM 어댑터 패턴

#### 2-5. Observability (OpenTelemetry)

- **근거**: AWS SaaS Lens "day-one requirement", noisy neighbor 탐지 필수
- **필요한 것**:
  - 모든 span에 `tenant_id` attribute 자동 추가
  - Pino/Winston 로그에 테넌트 컨텍스트 자동 주입
  - 테넌트별 쿼리 수/지연 시간 메트릭

---

### Tier 3: 중간 수요 (엔터프라이즈 기능)

| 기능 | 근거 | 설명 |
|------|------|------|
| GraphQL 호환 | needle-innovision #41, #47 | Resolver에서 테넌트 컨텍스트 접근 |
| WebSocket 게이트웨이 지원 | django-tenants도 미해결 | WS handshake에서 테넌트 추출 |
| 테넌트별 Rate Limiting | noisy neighbor 방지 | NestJS Throttler 통합 |
| 병렬 마이그레이션 | stancl/tenancy v4 핵심 기능 | 모든 테넌트 스키마 동시 마이그레이션 |
| RLS 정책 감사 도구 | 프로덕션 RLS 운영 pain point | CLI로 격리 정책 검증 |
| 도메인 → 테넌트 매핑 | stancl/tenancy 제공 | 멀티 도메인 테넌트 관리 |

---

## 3. 경쟁 이슈 패턴 분석

### needle-innovision/nestjs-tenancy 오픈 이슈 13건 분석

| # | 제목 | 패턴 |
|---|------|------|
| #37, #38 | Microservices Support | 마이크로서비스 전파 |
| #44, #54 | Connection pooling / reuse | 성능/커넥션 관리 |
| #27, #29, #30 | Bypass tenant for admin | 바이패스/크로스 테넌트 |
| #41, #47 | GraphQL incompatible | GraphQL 지원 |
| #50 | Cron job + @InjectTenancyModel | 스케줄러 호환 |
| #49 | NestJS version incompatibility | 버전 호환 |
| #46 | EventEmitter tenant resolution bug | 이벤트 통합 |
| #45 | Manual tenant service access | 프로그래밍 방식 접근 |
| #42 | forFeatureAsync support | 비동기 설정 |
| #11 | Change tenant on the fly | 동적 테넌트 전환 |

### NestJS 공식 레포 관련 이슈

- nestjs/typeorm#58: "Multi tenancy with Nest and TypeOrm and Postgres?" — 15 reactions
- nestjs/nest#7216: "Testing multi tenant application" — 테스트 어려움
- nestjs/bull#415: Job Data Provider — 백그라운드 작업 컨텍스트 손실

---

## 4. 성숙 프레임워크 비교

### Laravel stancl/tenancy (3.3k+ stars) — 골드 스탠다드

우리에게 없는 핵심 기능:
- **다중 전략**: single-DB, multi-DB, schema-per-tenant, RLS 모두 지원
- **tenant-aware 인프라**: 캐시, 큐, 파일시스템, Redis 모두 자동 테넌트 스코핑
- **이벤트 파이프라인**: `TenantCreated` → `DatabaseCreated` → `DatabaseMigrated` → `DatabaseSeeded`
- **병렬 마이그레이션**: v4에서 CPU 코어당 1개 테넌트 동시 마이그레이션
- **리소스 동기화**: 테넌트 간 사용자 레코드 동기화
- **테넌트 impersonation**: 관리자가 특정 테넌트로 전환하여 디버깅

성공 요인: **Zero-Code-Change 철학** — 설치 + 전략 설정만 하면 기존 앱이 멀티테넌트화

### django-tenants (1.5k+ stars)

우리에게 없는 핵심 기능:
- **Schema-per-tenant**: PostgreSQL 스키마 자동 전환
- **shared apps vs tenant apps**: 명시적 모델 분류 (public 스키마 vs 테넌트 스키마)
- **Management commands**: `migrate_schemas`, `create_tenant`, `tenant_command`
- **Tenant-aware Django admin**: 관리 패널 자동 스코핑

### Spring Boot Multi-Tenancy

우리에게 없는 핵심 기능:
- **AbstractRoutingDatasource**: 런타임 데이터소스 라우팅
- **마이크로서비스 전파**: 서비스 간 테넌트 컨텍스트 자동 전달
- **테넌트별 커넥션 풀**: HikariCP 기반 격리
- **Liquibase/Flyway 통합**: 테넌트별 마이그레이션 + 롤백

### 성공한 멀티테넌시 라이브러리의 3가지 공통점

1. **Strategy Pattern** — 격리 전략을 설정 한 줄로 전환. 코드 변경 제로.
2. **이벤트 기반 확장성** — 모든 라이프사이클 순간에 이벤트 발행. 구독으로 커스터마이즈.
3. **Zero-Code-Change 약속** — 기존 앱에 설치만 하면 멀티테넌트화.

---

## 5. Prisma 특화 Pain Points

| 문제 | 영향 | 기회 |
|------|------|------|
| Prisma에 네이티브 멀티테넌시 없음 | Critical | 우리의 핵심 가치 제안 |
| 미들웨어가 relation 필터에서 실패 | High | Extension 접근법이 우월함 (이미 해결) |
| 스키마 동적 전환 미지원 | High | schema-per-tenant 구현 시 우회 필요 |
| 테넌트별 마이그레이션 수동 | High | CLI 도구로 자동화 가능 |
| PrismaClient 인스턴스별 메모리 | Medium | DB-per-tenant 시 커넥션 풀 가이드 필요 |
| `prisma-multi-tenant` 방치 | High | 대체 솔루션으로 포지셔닝 |

---

## 6. PostgreSQL RLS 프로덕션 Pain Points

| 문제 | 영향 | 대응 방안 |
|------|------|----------|
| `set_config` 누락 시 전체 행 노출 | Critical | Fail-closed 모드 (컨텍스트 없으면 쿼리 차단) |
| 과도하게 허용적인 정책 탐지 어려움 | High | RLS 정책 감사/테스트 유틸리티 |
| 복잡한 정책의 성능 오버헤드 | Medium | 쿼리 플랜 분석 가이드 문서화 |
| 직접 DB 접근 시 RLS 우회 | Medium | 헬스체크로 RLS 활성 상태 검증 |
| 컬럼 레벨 보안 불가 | Low | 제약사항 명확히 문서화 |

---

## 7. 우선순위 매트릭스

```
우선순위    기능                           수요근거          난이도   추천 버전
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
★★★★★   테스팅 유틸리티                  경쟁자 전무       중      v1.0.0
★★★★★   Fail-Closed 모드               RLS 최대 위험     하      v1.0.0
★★★★☆   이벤트 시스템                   stancl 핵심      중      v1.0.0
★★★★☆   테넌트 인식 캐싱                Laravel 기본제공  중      v1.0.0
★★★★☆   마이크로서비스 전파              최다 요청        상      v1.1.0
★★★☆☆   Schema-per-tenant              격리 수요        상      v1.1.0
★★★☆☆   ORM 어댑터 (TypeORM)           TAM 확대         상      v1.2.0
★★★☆☆   Observability (OTel)           AWS 권고         중      v1.1.0
★★☆☆☆   테넌트 라이프사이클 CLI          운영 편의        중      v1.2.0
★★☆☆☆   GraphQL/WebSocket              틈새 수요        중      v1.2.0
★☆☆☆☆   Database-per-tenant            엔터프라이즈      상      v2.0.0
★☆☆☆☆   Rate Limiting                  noisy neighbor   중      v2.0.0
```

### v1.0.0 추천 스코프

테스팅 유틸리티 + Fail-Closed + 이벤트 시스템 + 테넌트 인식 캐싱

이 4가지만으로도 "NestJS 멀티테넌시 분야에서 가장 완성도 높은 라이브러리"라는 포지셔닝 확보 가능.

---

## 8. 출처

### 경쟁 라이브러리

- [needle-innovision/nestjs-tenancy](https://github.com/needle-innovision/nestjs-tenancy) — GitHub Issues
- [AlexanderC/nestjs-mtenant](https://github.com/AlexanderC/nestjs-mtenant)
- [juicycleff/ultimate-backend](https://github.com/juicycleff/ultimate-backend) — 2.9k stars SaaS starter
- [moofoo/nestjs-prisma-postgres-tenancy](https://github.com/moofoo/nestjs-prisma-postgres-tenancy) — 39 stars

### NestJS 공식

- [nestjs/typeorm#58](https://github.com/nestjs/typeorm/issues/58) — Multi tenancy with TypeORM
- [nestjs/nest#7216](https://github.com/nestjs/nest/issues/7216) — Testing multi tenant application

### 성숙 프레임워크

- [Tenancy for Laravel (stancl/tenancy)](https://tenancyforlaravel.com/) — 3.3k stars
- [django-tenants](https://github.com/django-tenants/django-tenants) — 1.5k stars
- [Spring Boot Multi-tenancy (Baeldung)](https://www.baeldung.com/multitenancy-with-spring-data-jpa)

### 아키텍처 가이드

- [AWS SaaS Lens — Fairness in multi-tenant systems](https://aws.amazon.com/builders-library/fairness-in-multi-tenant-systems/)
- [AWS Tenant Onboarding Best Practices](https://aws.amazon.com/blogs/apn/tenant-onboarding-best-practices-in-saas-with-the-aws-well-architected-saas-lens/)
- [Multi-Tenant SaaS Architecture Guide (Epikta)](https://epikta.com/blog-multi-tenant-saas-architecture)

### RLS 관련

- [Nile — Multi-tenant RLS](https://www.thenile.dev/blog/multi-tenant-rls)
- [AWS — Multi-tenant data isolation with PostgreSQL RLS](https://aws.amazon.com/blogs/database/multi-tenant-data-isolation-with-postgresql-row-level-security/)
- [Crunchy Data — Row Level Security for Tenants](https://www.crunchydata.com/blog/row-level-security-for-tenants-in-postgres)

### 커뮤니티 가이드

- [NestJS + Prisma RLS multi-tenancy (dev.to)](https://dev.to/moofoo/nestjspostgresprisma-multi-tenancy-using-nestjs-prisma-nestjs-cls-and-prisma-client-extensions-ok7)
- [Schema-based multitenancy with NestJS and TypeORM](https://www.scalzotto.nl/posts/nestjs-typeorm-schema-multitenancy/)
- [The Real-World Guide to Multi-Tenancy in NestJS](https://mariusmargowski.com/article/the-real-world-guide-to-multi-tenancy-in-nestjs)
- [ZenStack multi-tenancy approaches](https://zenstack.dev/blog/multi-tenant)
