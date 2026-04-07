# @nestarc/tenancy 타입 설계 권장사항 — 마이그레이션 영향 분석

> 분석일: 2026-04-07 | 버전: v0.9.0 | 관련 문서: `type-design-audit-2026-04-07.md`

## 1. 즉시 적용 가능 — 영향 없음 또는 미미

| 작업 | 대상 파일 | 영향 | 이유 |
|------|----------|------|------|
| `TenantStore` discriminated union | `tenancy-context.ts` | **없음** | 내부 타입 (export 안 됨) |
| 상수 중복 통합 | `tenancy.constants.ts` | **없음** | 내부 구현, export 안 되는 상수 |
| `PathTenantExtractor` 생성자 검증 | `path.extractor.ts` | **긍정적** | 기존에 잘못 설정하면 항상 `null` 반환 (사일런트 버그). 이제 즉시 에러로 알려줌 |
| `TenancyResponse` 최소 메서드 추가 | `tenancy-request.interface.ts` | **없음** | optional 메서드 추가. Express/Fastify Response 모두 이미 보유 |
| `isolationLevel` 리터럴 유니온 | `tenancy-transaction.ts` | **미미** | `string` → 4개 리터럴. 올바른 값 사용 시 호환. 잘못된 값은 원래 런타임 에러였으니 오히려 개선 |
| `EventService.emit` 타입 시그니처 | `tenancy-event.service.ts` | **미미** | 대부분 사용자는 `@OnEvent`로 구독만 함. 직접 `emit` 호출하는 경우는 드묾 |

**결론:** 기존 사용자에게 실질적 영향 없음. 잘못된 설정을 조기 발견해주는 방향이라 사용자 경험 개선.

---

## 2. v1.0에서 적용 — 소규모 영향 (타입 assertion 추가 정도)

| 작업 | 대상 | 영향 | 구체적 변화 |
|------|------|------|------------|
| `TenancyRequest` index `any` → `unknown` | 공개 인터페이스 | **소** | `(req as express.Request).cookies` 같은 코드는 이미 type assertion 사용 중. `req.anyProp`을 직접 쓰던 코드만 assertion 추가 필요 |
| `crossCheck` sub-object 그룹화 | `TenancyModuleOptions` | **소** | `crossCheckExtractor` + `onCrossCheckFailed` → `crossCheck: { extractor, onFailed }`. 사용자 수 적고 (v0.7.0 기능), 마이그레이션 단순 |
| Transaction 플래그 conditional type | `PrismaTenancyExtensionOptions` | **없음** | 양쪽 동시 `true`는 원래 의도되지 않은 사용법. 정상 사용자는 영향 없음 |
| Interceptor discriminated union | `TenantContextInterceptorOptions` | **소** | `transport` 지정 시 불필요한 옵션을 제거하면 됨. 기존 동작은 마지막 variant (`transport?: undefined`)로 호환 |
| `tenancyTransaction` prisma 구조적 타입 | `tenancy-transaction.ts` | **없음** | `any` → 구조적 타입. 실제 PrismaClient는 이 구조를 이미 만족 |

**결론:** 대부분 타입 수준 변경. 런타임 동작 변화 없음. CHANGELOG에 마이그레이션 가이드 포함 필요.

---

## 3. v2.0에서 적용 — 실질적 Breaking Change

| 작업 | 대상 | 영향 | 구체적 변화 |
|------|------|------|------------|
| `TenantId` 브랜디드 타입 | 전체 공개 API | **대** | 모든 `string` → `TenantId` 변경. 커스텀 추출기, 서비스 코드 전부 수정 필요 |
| `tenantExtractor`에서 `string` 제거 | `TenancyModuleOptions` | **중** | `'X-Tenant-Id'` 단축 문법 제거. `new HeaderTenantExtractor('X-Tenant-Id')`로 변경 필요 |
| `TenantPropagator` 이름 변경 | propagator 인터페이스 | **중** | import 경로 변경. 사용 빈도 낮아 영향 범위는 작음 |

**결론:** API 표면 변경이 크므로 Major 버전 업에서만 적용. 충분한 마이그레이션 기간과 가이드 필요.

---

## 4. 요약 매트릭스

```
영향 없음 ─────────────── 소 ────────────── 중 ─────────── 대
  │                        │                 │              │
  ├─ TenantStore (내부)    ├─ Request index  ├─ string 제거  ├─ TenantId 브랜드
  ├─ 상수 통합 (내부)      ├─ crossCheck     ├─ Propagator   │
  ├─ PathExtractor 검증    │  sub-object     │  이름 변경    │
  ├─ Response 메서드       ├─ Interceptor    │               │
  ├─ isolationLevel union  │  union          │               │
  ├─ emit 시그니처         ├─ prisma 타입    │               │
  ├─ Transaction 플래그    │                 │               │
  │                        │                 │               │
  └── 즉시 적용 ───────────┴── v1.0 ────────┴── v2.0 ───────┘
```
