# @nestarc/tenancy Roadmap

> v0.3.0 구현 완료 (2026-03-26). 이 문서는 다음 단계를 정리합니다.

---

## Phase 2: 실전 검증 + 차별화 (v0.2.0) ✅ 완료

**목표**: "직접 구현해도 되지 않나?"에 대한 답을 만든다.

### 2-1. 벤치마크 공개 ✅

README에 PostgreSQL 16 + Prisma 6 기반 벤치마크 결과 공개 완료.

### 2-2. 다중 추출 전략 ✅

| 추출기 | 상태 | 사용 사례 |
|--------|------|----------|
| `HeaderTenantExtractor` | ✅ v0.1.0 | API 서버 |
| `SubdomainTenantExtractor` | ✅ v0.2.0 | SaaS (tenant1.app.com) |
| `JwtClaimTenantExtractor` | ✅ v0.2.0 | 인증 토큰 기반 |
| `PathTenantExtractor` | ✅ v0.2.0 | /api/tenants/:id/... |
| `CompositeTenantExtractor` | ✅ v0.2.0 | 여러 전략 폴백 체인 |

### 2-3. Tenant Lifecycle Hooks ✅

- `onTenantResolved(tenantId, req)` — AsyncLocalStorage 컨텍스트 내에서 실행
- `onTenantNotFound(req)` — `void` 반환 시 관찰용, `'skip'` 반환 시 `next()` 차단, throw로 에러 처리

### 2-4. Prisma 확장 고도화 ✅

- **autoInjectTenantId**: `create`, `createMany`, `createManyAndReturn`, `upsert`에 자동 주입
- **sharedModels**: 지정된 모델은 RLS + 주입 모두 건너뜀
- **tenantIdField**: 커스텀 컬럼명 지원

#### 알려진 제약

- Interactive transaction 내에서는 `set_config`가 별도 커넥션에서 실행됨 (JSDoc 문서화 완료)
- `@BypassTenancy()` Prisma 레벨 지원은 v0.3.0으로 이월

---

## Phase 3: 생태계 확장 (v0.3.0) ✅ 완료

### 3-0. v0.2.0에서 이월된 항목 ✅

- **`withoutTenant()` 프로그래밍 방식 bypass**: 백그라운드 작업, 어드민 대시보드, 크로스 테넌트 쿼리용 ✅
- **Subdomain ccTLD 대응**: `psl` 라이브러리로 정확한 서브도메인 추출 (`.co.uk` 등 multi-part TLD) ✅
- **`tenancyTransaction()` helper**: Interactive transaction 내 RLS 올바른 동작 보장 ✅
- **`experimentalTransactionSupport`**: Prisma 내부 API를 통한 투명한 interactive transaction 지원 (opt-in) ✅

### 3-1. CLI 도구 ✅

```bash
npx @nestarc/tenancy init
# → tenancy-setup.sql 생성 (RLS 정책 + 롤 + grants)
# → tenancy.module-setup.ts 생성 (TenancyModule 등록 코드)
```

**도입 비용을 0에 가깝게** 만든다.

### 3-2. 다중 DB 전략

| 전략 | 격리 수준 | 복잡도 | 사용 사례 |
|------|----------|--------|----------|
| RLS (현재) | 행 수준 | 낮음 | 대부분의 SaaS |
| Schema-per-tenant | 스키마 수준 | 중간 | 규제 산업 |
| Database-per-tenant | DB 수준 | 높음 | 엔터프라이즈 |

```typescript
TenancyModule.forRoot({
  strategy: 'rls',        // 기본값
  // strategy: 'schema',  // 스키마 분리
  // strategy: 'database', // DB 분리
})
```

### 3-3. 프레임워크 확장

- **Drizzle ORM 어댑터**: `createDrizzleTenancyExtension()`
- **TypeORM 어댑터**: subscriber 기반 `SET LOCAL`
- **MikroORM 어댑터**: filter 기반

Prisma 전용이라는 한계를 벗어나면 사용자 풀이 넓어진다.

### 3-4. Observability

- **OpenTelemetry span**: tenant_id를 span attribute에 자동 추가
- **로그 컨텍스트**: Pino/Winston에 tenant_id 자동 주입
- **메트릭**: tenant별 쿼리 수, 지연 시간

---

## Phase 4: 프로덕션 신뢰 (v1.0.0)

### 4-1. 보안 강화

- 커넥션 풀 격리 검증 (PgBouncer, Prisma Data Proxy 호환)
- tenant_id 위조 방지 (JWT claim과 헤더 교차 검증)
- 감사 로그 (누가, 어떤 tenant에, 언제 접근했는지)

### 4-2. 운영 도구

- Health check endpoint (`/tenancy/health`)
- Tenant 목록 조회 API (관리자용)
- Migration helper (기존 단일 테넌트 → 멀티 테넌트 전환)

### 4-3. 문서 + 커뮤니티

- 공식 문서 사이트 (예제 중심)
- 프로덕션 사례 1~2개 확보
- NestJS 공식 레시피 기여 시도

---

## 우선순위 요약

```
✅ v0.1.0 (완료)    코어 모듈 + 벤치마크 공개
✅ v0.2.0 (완료)    다중 추출 전략 + Lifecycle Hooks + Prisma 고도화
✅ v0.3.0 (완료)    withoutTenant() + tenancyTransaction() + ccTLD + CLI
→ v1.0.0 (다음)    보안 강화 + 운영 도구 + 문서 사이트 + 다중 DB + ORM 어댑터
```

**핵심 원칙**: 직접 구현하면 30분, 하지만 테스트 + 엣지 케이스 + 문서까지 하면 3일 걸리는 것들을 라이브러리가 해결해준다.
