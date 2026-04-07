# @nestarc/tenancy 타입 설계 품질 분석 보고서

> 분석일: 2026-04-07 | 버전: v0.9.0

## 1. 전체 평가

| 차원 | 점수 | 비고 |
|------|------|------|
| **아키텍처** | 8/10 | extractor/propagator/context/service 계층 분리 우수 |
| **캡슐화** | 6/10 | 서비스는 양호, 설정 DTO와 request/response 인터페이스가 약함 |
| **불변성 표현** | 5/10 | `as const`, literal union 잘 사용하지만 `any` 타입이 약화시킴 |
| **유용성** | 8/10 | RLS, fail-closed, cross-check 등 실제 보안 문제 해결 |
| **강제성** | 4/10 | 대부분 런타임에만 검증, 여러 미설정이 사일런트 실패 |

---

## 2. 개별 타입 분석

### 2.1. TenancyRequest (E: 3 / IE: 4 / U: 6 / EN: 2)

**파일:** `src/interfaces/tenancy-request.interface.ts`

```typescript
export interface TenancyRequest {
  headers: Record<string, string | string[] | undefined>;
  hostname?: string;
  path?: string;
  url?: string;
  [key: string]: any;  // <-- 타입 안전성 무효화
}
```

**강점:**
- 프레임워크 중립 설계 (Express, Fastify, raw HTTP 호환)
- `headers` 타이핑이 Node.js HTTP 헤더 시맨틱에 정확

**문제:**
- `[key: string]: any` 인덱스 시그니처가 typed 필드를 무력화. 오타도 `any`로 통과
- `hostname`, `path`, `url`이 optional이라 `PathTenantExtractor` 설정 시 사일런트 실패 가능

**권장:**
1. 인덱스 시그니처를 `[key: string]: unknown`으로 변경하여 소비자 측 type assertion 강제
2. `headers`를 `Readonly<Record<...>>`로 변경 (추출기가 헤더를 변경해서는 안 됨)

---

### 2.2. TenancyResponse (E: 1 / IE: 1 / U: 3 / EN: 1)

**파일:** `src/interfaces/tenancy-request.interface.ts`

```typescript
export interface TenancyResponse {
  [key: string]: any;
}
```

프로젝트에서 **가장 약한 타입**. `Record<string, any>`와 동일. `onTenantNotFound` 콜백에서 `res.status(403).json(...)` 등을 호출하지만 타입이 이를 표현하지 않음.

**권장:**
```typescript
export interface TenancyResponse {
  status?(code: number): this;
  json?(body: unknown): void;
  end?(): void;
  [key: string]: unknown;
}
```

---

### 2.3. TenantExtractor (E: 8 / IE: 7 / U: 8 / EN: 6)

**파일:** `src/interfaces/tenant-extractor.interface.ts`

```typescript
export interface TenantExtractor {
  extract(request: TenancyRequest): string | null | Promise<string | null>;
}
```

**강점:** 깔끔한 단일 메서드 인터페이스. sync/async 모두 지원.

**문제:** 반환 타입 `string`이 비검증 상태. 브랜디드 `TenantId` 타입으로 검증 보장 가능 (v2.0).

---

### 2.4. TenantContextCarrier\<T\> (E: 9 / IE: 9 / U: 9 / EN: 7) -- Best

**파일:** `src/interfaces/tenant-context-carrier.interface.ts`

프로젝트에서 **가장 잘 설계된 타입**. 제네릭 파라미터로 Bull/Kafka/gRPC를 하나의 추상화로 처리. OpenTelemetry inject/extract 패턴 적용.

**주의:** `GrpcTenantPropagator.inject()`는 입력을 mutate하고 반환하지만, `BullTenantPropagator.inject()`는 새 객체를 spread로 반환. 인터페이스 수준에서 immutability 규약이 없어 구현 간 불일치.

---

### 2.5. TenancyModuleOptions (E: 6 / IE: 6 / U: 8 / EN: 4)

**파일:** `src/interfaces/tenancy-module-options.interface.ts`

**강점:**
- `onCrossCheckFailed: 'reject' | 'log'` 리터럴 유니온 우수
- `onTenantNotFound`의 `'skip'` 반환 시맨틱 JSDoc 잘 문서화

**문제:**
1. `tenantExtractor: string | TenantExtractor` — `string`이 헤더 이름임을 타입만으로 알 수 없음
2. `crossCheckExtractor`와 `onCrossCheckFailed`가 독립적으로 설정 가능 — 후자만 있으면 의미 없음

**권장:**
```typescript
// crossCheck를 sub-object로 그룹화
crossCheck?: {
  extractor: TenantExtractor;
  onFailed: 'reject' | 'log';
}
```

---

### 2.6. TenancyModuleAsyncOptions (E: 5 / IE: 3 / U: 6 / EN: 2)

**문제:**
- `useFactory`, `useClass`, `useExisting`의 상호 배타성이 타입에서 강제되지 않음
- `inject?: any[]` — DI 의존성 타입 체크 완전 무효화

NestJS 생태계 관례의 제약이 있으나, 런타임에서라도 0개 또는 복수 전략 설정 시 throw 추가 권장.

---

### 2.7. PrismaTenancyExtensionOptions (E: 5 / IE: 4 / U: 8 / EN: 3)

**파일:** `src/prisma/prisma-tenancy.extension.ts`

**문제:**
1. `interactiveTransactionSupport`와 `experimentalTransactionSupport` 동시 `true` 허용
2. `sharedModels: string[]` — 오타 시 사일런트 실패
3. `tenantIdField: string` — DB 컬럼명 불일치 시 런타임 에러

**권장:**
```typescript
// 동시 설정 방지
type TransactionConfig =
  | { interactiveTransactionSupport?: boolean; experimentalTransactionSupport?: never }
  | { interactiveTransactionSupport?: never; experimentalTransactionSupport?: boolean };

// sharedModels에 Prisma.ModelName 사용 고려
sharedModels?: Array<Prisma.ModelName>;
```

---

### 2.8. TenancyTransactionOptions (E: 5 / IE: 3 / U: 6 / EN: 2)

**파일:** `src/prisma/tenancy-transaction.ts`

**문제:**
- `isolationLevel: string` — PostgreSQL은 4개 값만 허용
- `tenancyTransaction(prisma: any, ...)` — Prisma 클라이언트 타입 검증 없음

**권장:**
```typescript
isolationLevel?: 'ReadUncommitted' | 'ReadCommitted' | 'RepeatableRead' | 'Serializable';

// prisma 파라미터에 구조적 최소 타입
prisma: { $transaction: (fn: (tx: any) => Promise<any>, options?: any) => Promise<any> }
```

---

### 2.9. TenantContextInterceptorOptions (E: 6 / IE: 5 / U: 7 / EN: 4)

**파일:** `src/propagation/tenant-context.interceptor.ts`

**문제:** `transport: 'kafka'` 설정 시 `bullDataKey`도 허용됨 (무시됨).

**권장:**
```typescript
type TenantContextInterceptorOptions =
  | { transport: 'kafka'; kafkaHeaderName?: string }
  | { transport: 'bull'; bullDataKey?: string }
  | { transport: 'grpc'; grpcMetadataKey?: string }
  | { transport?: undefined; kafkaHeaderName?: string; bullDataKey?: string; grpcMetadataKey?: string };
```

---

### 2.10. Extractor Options (E: 8 / IE: 7 / U: 8 / EN: 5)

**강점:** `JwtClaimExtractorOptions.claimKey` required, `PathExtractorOptions` 양쪽 required.

**문제:** `PathTenantExtractor`에서 `paramName`이 `pattern`에 없으면 영원히 `null` 반환 (사일런트).

**권장:** 생성자에서 즉시 throw:
```typescript
if (this.paramIndex === -1) {
  throw new Error(`paramName ":${options.paramName}" not found in pattern "${options.pattern}"`);
}
```

---

### 2.11. Error Classes (E: 7 / IE: 7 / U: 8 / EN: 5)

**강점:** `instanceof TenantContextMissingError`로 양쪽 에러 포착 가능한 계층 설계.

**문제:** `TenantContextMissingError.name`이 `public override name = ...`으로 mutable. `readonly` 추가 권장.

---

### 2.12. Event Types (E: 8 / IE: 8 / U: 8 / EN: 5)

**강점:** `as const`, `TenantContextBypassedEvent.reason: 'decorator' | 'withoutTenant'` 리터럴 유니온.

**문제:** `TenancyEventService.emit(event: string, payload: any)` — 이벤트/페이로드 매핑 무효화.

**권장:**
```typescript
interface TenancyEventMap {
  [TenancyEvents.RESOLVED]: TenantResolvedEvent;
  [TenancyEvents.NOT_FOUND]: TenantNotFoundEvent;
  [TenancyEvents.VALIDATION_FAILED]: TenantValidationFailedEvent;
  [TenancyEvents.CONTEXT_BYPASSED]: TenantContextBypassedEvent;
  [TenancyEvents.CROSS_CHECK_FAILED]: TenantCrossCheckFailedEvent;
}

emit<K extends keyof TenancyEventMap>(event: K, payload: TenancyEventMap[K]): void;
```

---

### 2.13. TenancyContext 내부 TenantStore (E: 7 / IE: 7 / U: 9 / EN: 6)

**문제:** `tenantId: 'abc'` + `bypassed: true` 모순 상태 표현 가능.

**권장:**
```typescript
type TenantStore =
  | { tenantId: string; bypassed: false }
  | { tenantId: null; bypassed: true };
```

---

### 2.14. Constants (E: 8 / IE: 7 / U: 8 / EN: 6)

**문제:** `DEFAULT_BULL_DATA_KEY`와 `DEFAULT_GRPC_METADATA_KEY`가 propagator와 interceptor에 각각 중복 정의.

**권장:** `tenancy.constants.ts`로 통합.

---

### 2.15. Testing Types (E: 7 / IE: 6 / U: 8 / EN: 6)

**문제:** `expectTenantIsolation`이 양쪽 tenant 모두 빈 배열 반환 시 vacuously 통과.

**권장:** 양쪽 모두 0 rows면 경고 또는 실패하는 옵션 추가.

---

## 3. 5대 구조적 문제 요약

| 순위 | 문제 | 영향도 | 권장 |
|------|------|--------|------|
| **1** | `any` 확산 (6곳) | 전체 타입 안전성 약화 | `unknown` 및 구조적 최소 타입으로 교체 |
| **2** | 테넌트 ID 브랜디드 타입 부재 | 검증 전/후 구분 불가 | v2.0에서 `TenantId` 브랜드 타입 도입 |
| **3** | 유효하지 않은 상태 표현 가능 (4곳) | 런타임에서만 감지 | Discriminated union으로 컴파일 타임 차단 |
| **4** | 사일런트 미설정 실패 (3곳) | 프로덕션 디버깅 어려움 | 생성자 시점 throw 검증 추가 |
| **5** | 상수 중복 (2개) | 값 불일치 리스크 | `tenancy.constants.ts` 통합 |

---

## 4. 우선순위별 권장 작업

### 즉시 적용 가능 (비파괴적)

| 작업 | 대상 파일 |
|------|----------|
| `TenantStore` discriminated union으로 변경 (내부 타입) | `tenancy-context.ts` |
| `PathTenantExtractor` 생성자 검증 추가 | `path.extractor.ts` |
| 상수 중복 통합 | `tenancy.constants.ts` |
| `TenancyResponse`에 최소 메서드 시그니처 추가 | `tenancy-request.interface.ts` |
| `TenancyTransactionOptions.isolationLevel` 리터럴 유니온 | `tenancy-transaction.ts` |
| `TenancyEventService.emit` 타입 안전 시그니처 | `tenancy-event.service.ts` |

### v1.0에서 적용 (Minor Breaking)

| 작업 | 대상 |
|------|------|
| `TenancyRequest` 인덱스 시그니처 `any` → `unknown` | 공개 인터페이스 |
| `crossCheck` sub-object 그룹화 | `TenancyModuleOptions` |
| Transaction 플래그 conditional type | `PrismaTenancyExtensionOptions` |
| `TenantContextInterceptorOptions` discriminated union | Interceptor 옵션 |
| `tenancyTransaction` prisma 파라미터 구조적 타이핑 | `tenancy-transaction.ts` |

### v2.0에서 적용 (Major Breaking)

| 작업 | 대상 |
|------|------|
| `TenantId` 브랜디드 타입 도입 | 전체 공개 API |
| `tenantExtractor` union에서 `string` 제거 | `TenancyModuleOptions` |
| `TenantPropagator` → `HttpTenantPropagator`로 이름 변경 | propagator 인터페이스 |
