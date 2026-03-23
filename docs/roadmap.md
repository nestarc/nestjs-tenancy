# @nestarc/tenancy Roadmap

> v0.1.0 배포 완료 (2026-03-23). 이 문서는 다음 단계를 정리합니다.

---

## Phase 2: 실전 검증 + 차별화 (v0.2.0)

**목표**: "직접 구현해도 되지 않나?"에 대한 답을 만든다.

### 2-1. 벤치마크 공개

| 항목 | 내용 |
|------|------|
| 측정 대상 | batch transaction 오버헤드 (확장 ON vs OFF) |
| 환경 | PostgreSQL 16, Prisma 6, 1000 concurrent requests |
| 예상 결과 | SELECT 기준 <1ms 추가 지연 |
| 산출물 | `benchmarks/` 디렉토리 + README에 결과 표 |

사용자가 가장 먼저 의심하는 것은 성능이다. 수치로 증명한다.

### 2-2. 다중 추출 전략

| 추출기 | 구현 | 사용 사례 |
|--------|------|----------|
| `HeaderTenantExtractor` | ✅ v0.1.0 | API 서버 |
| `SubdomainTenantExtractor` | 신규 | SaaS (tenant1.app.com) |
| `JwtClaimTenantExtractor` | 신규 | 인증 토큰 기반 |
| `PathTenantExtractor` | 신규 | /api/tenants/:id/... |
| `CompositeTenantExtractor` | 신규 | 여러 전략 폴백 체인 |

직접 구현하면 각각 20~30줄이지만, 테스트 + 엣지 케이스 처리까지 하면 번거롭다. 라이브러리의 가치가 여기서 나온다.

### 2-3. Tenant Lifecycle Hooks

```typescript
TenancyModule.forRoot({
  tenantExtractor: 'X-Tenant-Id',
  onTenantResolved: (tenantId, req) => {
    // 로깅, 감사, 사용량 추적
  },
  onTenantNotFound: (req) => {
    // 커스텀 에러, 리다이렉트
  },
})
```

미들웨어를 직접 확장하지 않아도 tenant 이벤트에 반응할 수 있다.

### 2-4. Prisma 확장 고도화

- **Tenant-aware `create`/`update`**: `tenant_id` 자동 주입 옵션
- **Read-only bypass**: 특정 모델은 RLS 없이 조회 (공유 테이블)
- **`@BypassTenancy()` Prisma 레벨 지원**: 가드뿐 아니라 Prisma 쿼리에서도 bypass

---

## Phase 3: 생태계 확장 (v0.3.0)

### 3-1. CLI 도구

```bash
npx @nestarc/tenancy init
# → setup.sql 생성 (RLS 정책 + app_user 롤)
# → schema.prisma에 tenant_id 컬럼 추가 가이드
# → TenancyModule 등록 코드 scaffold
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
즉시 (v0.1.x)     벤치마크 공개
1개월 (v0.2.0)     다중 추출 전략 + Lifecycle Hooks + Prisma 고도화
3개월 (v0.3.0)     CLI + 다중 DB + ORM 어댑터
6개월 (v1.0.0)     보안 강화 + 운영 도구 + 문서 사이트
```

**핵심 원칙**: 직접 구현하면 30분, 하지만 테스트 + 엣지 케이스 + 문서까지 하면 3일 걸리는 것들을 라이브러리가 해결해준다.
