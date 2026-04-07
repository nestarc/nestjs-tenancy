# @nestarc/tenancy 테스트 커버리지 분석 보고서

> 분석일: 2026-04-07 | 버전: v0.9.0 | 33개 테스트 스위트, 315개 테스트 통과

## 1. 현재 커버리지 현황

Jest 커버리지 임계값: branches 90%, functions 90%, lines 90%, statements 90%

### 100% 미만 파일

| 파일 | Stmts | Branch | Funcs | Lines | 미커버 라인 |
|------|-------|--------|-------|-------|------------|
| `telemetry/tenancy-telemetry.service.ts` | 76.47% | 100% | 66.66% | 80.95% | 31-34 |
| `propagation/tenant-context.interceptor.ts` | 91.52% | 84.09% | 100% | 90.76% | 153, 161-165 |
| `extractors/subdomain.extractor.ts` | 92.59% | 85.71% | 100% | 90.32% | 17, 46 |
| `extractors/path.extractor.ts` | 100% | 80% | 100% | 94.44% | 22 |
| `prisma/tenancy-transaction.ts` | 100% | 83.33% | 100% | 100% | 38 |

나머지 모든 파일: **100%** (4개 차원 모두)

---

## 2. 발견된 갭

### P0 — 보안 치명적 (Criticality 9)

#### 2.1. Prisma Extension `$transaction` 에러 전파 + 동시성 단위 테스트

**파일:** `src/prisma/prisma-tenancy.extension.ts`

100% 라인 커버리지이지만, 아래 동작 시나리오가 미검증:

1. **`$transaction` 실패 전파**: `baseClient.$transaction(...)` 거부 시(DB 연결 에러, 데드락) 에러가 호출자에게 정상 전파되는지 미검증
2. **`set_config` 실패**: `$executeRaw`(set_config 호출)가 트랜잭션 내에서 실패할 때 동작 미검증. PostgreSQL 변수 네임스페이스 미설정 시 발생 가능
3. **동시 호출 단위 테스트**: 동시 호출에서 각각 올바른 `tenantId`를 `set_config`에 전달하는지 단위 테스트 부재 (E2E에서만 커버)

**권장 테스트:**
- `$transaction`이 DB 에러로 reject → 에러가 변경 없이 전파되는지 확인
- `$executeRaw`가 throw → 트랜잭션이 조용히 성공하지 않는지 확인
- `Promise.all` + `context.run`으로 서로 다른 tenantId 동시 호출 → 각각 올바른 tenantId 확인

**방지하는 회귀:** 동시 부하 시 크로스 테넌트 데이터 노출; DB 설정 에러의 사일런트 실패

---

### P1 — 중요 (Criticality 8)

#### 2.2. TenancyTelemetryService `onModuleInit` 성공 경로

**파일:** `src/telemetry/tenancy-telemetry.service.ts`, lines 31-34

`await import('@opentelemetry/api')` 성공 시 `this.traceApi` / `this.tracer` 할당 경로가 미테스트. 현재 테스트는 `(service as any).traceApi = ...`로 내부 필드를 직접 할당하여 우회.

**권장 테스트:**
- `@opentelemetry/api`를 virtual module로 mock → `onModuleInit()` 호출 → `setTenantAttribute`와 `startSpan`이 mock에 정상 위임되는지 확인

**방지하는 회귀:** OTel import 경로나 `trace.getTracer()` 호출 방식 변경 시 미감지

#### 2.3. TenancyModule `forRootAsync` `useExisting` 분기

**파일:** `src/tenancy.module.ts`, lines 93-102

`createAsyncProviders()`의 3개 분기 중 `useExisting`과 빈 옵션 폴백(빈 배열 반환)이 미테스트.

**권장 테스트:**
- `forRootAsync({ useExisting: ExistingOptionsFactory })` — 사전 등록된 팩토리 클래스로 테스트
- `forRootAsync({})` — 옵션 미지정 시 정상 처리 확인

**방지하는 회귀:** `useExisting` 패턴 사용자의 런타임 실패

#### 2.4. TenantContextInterceptor gRPC/Kafka Buffer 분기

**파일:** `src/propagation/tenant-context.interceptor.ts`, lines 153, 161-165

인터셉터 자체의 `extractFromGrpcMetadata()`, `extractFromKafkaContext()` 내 Buffer 처리 분기가 미커버. standalone propagator 테스트와 별개 코드 경로.

**권장 테스트:**
1. gRPC metadata에 `Buffer.from('tenant-grpc-buf')` → 정상 추출 확인
2. gRPC metadata에 `Buffer.from('')` → null 반환 확인
3. Kafka 메시지에 빈 Buffer 헤더 → 패스스루 확인

**방지하는 회귀:** 프로덕션에서 Buffer로 도착하는 gRPC/Kafka 메타데이터의 사일런트 추출 실패

---

### P2 — 개선 권장 (Criticality 6-7)

#### 2.5. 미들웨어 — extractor가 throw할 때 (Criticality 7)

**파일:** `src/middleware/tenant.middleware.ts`

`tenantExtractor.extract()`가 에러를 throw하는 시나리오(null이나 값 반환이 아닌) 미검증.

**권장 테스트:**
- `extract()`가 에러를 throw하는 커스텀 추출기 → 에러가 조용히 삼켜지지 않는지 확인

#### 2.6. SubdomainTenantExtractor — psl 에러 경로 (Criticality 6)

**파일:** `src/extractors/subdomain.extractor.ts`, lines 17, 46

- Line 17: `require('psl')` 실패 시 catch 블록 (psl 미설치 에러 메시지)
- Line 46: `psl.parse()`가 에러 결과 반환 시 분기

**권장 테스트:**
1. `require('psl')`을 throw하도록 mock → 에러 메시지에 설치 안내 포함 확인
2. `psl.parse()` 에러 반환하는 hostname 제공 → null 반환 확인

#### 2.7. TenantContextInterceptor `transport: 'bull'` + 비객체 데이터 (Criticality 6)

**파일:** `src/propagation/tenant-context.interceptor.ts`, lines 120-122

명시적 `transport: 'bull'`이지만 `getData()`가 null/string/number를 반환할 때 미검증.

**권장 테스트:**
- `transport: 'bull'` + `getData()` → `null` → 테넌트 미추출, 핸들러 패스스루 확인

---

### P3 — 완전성 (Criticality 5)

#### 2.8. PathTenantExtractor — undefined path (Criticality 5)

**파일:** `src/extractors/path.extractor.ts`, line 22

`request.path`가 `undefined`일 때 분기 미테스트.

**권장 테스트:**
- `path` 프로퍼티 없는 request 객체 → null 반환 확인

#### 2.9. tenancyTransaction — `isolationLevel` 옵션 (Criticality 5)

**파일:** `src/prisma/tenancy-transaction.ts`, line 38

`isolationLevel` spread 분기 미테스트 (timeout만 테스트됨).

**권장 테스트:**
- `{ isolationLevel: 'Serializable' }` 옵션 전달 → `$transaction`에 전달 확인

#### 2.10. CLI `index.ts` — 인자 파싱 로직 (Criticality 5)

**파일:** `src/cli/index.ts`

CLI 엔트리포인트의 인자 라우팅 로직(파싱, `--db-setting-key=` 분리, help 출력, `process.exit`)이 직접 테스트 없음. `jest.config.ts`에서 index.ts 제외로 커버리지에서도 빠짐.

**권장 테스트:**
- 자식 프로세스로 CLI 스폰 → 다양한 인자 조합으로 exit code/stdout 검증

---

## 3. 긍정적 평가

1. **보안 핵심 경로 잘 테스트됨** — `set_config()`, `failClosed`, `crossCheck`, `autoInjectTenantId` 모두 양성/음성 케이스 커버
2. **AsyncLocalStorage 동시성 격리 검증** — `tenancy-context.spec.ts`에 `Promise.all` + `setTimeout` 딜레이 동시성 테스트 포함
3. **E2E에서 실제 RLS 격리 검증** — `app_user` (비슈퍼유저) 연결로 PostgreSQL RLS 실제 동작 확인
4. **이벤트 시스템 실제 통합 테스트** — `tenancy-event-integration.spec.ts`에서 real `EventEmitterModule.forRoot()` 사용
5. **JWT 추출기 엣지 케이스** — 악성 토큰, 누락 클레임, 배열 헤더, 비문자열 클레임, 커스텀 헤더명 커버
6. **서브도메인 추출기 ccTLD** — `.co.uk`, `.co.jp`, `.com.au`, IP 주소, `.local` 내부 도메인 커버
7. **CLI 테스트 실제 파일시스템 사용** — 임시 디렉토리 + 실제 파일 생성/검증
8. **테스팅 유틸리티 자체 테스트** — `withTenant`, `expectTenantIsolation`, `TestTenancyModule` 모두 자체 테스트 스위트 보유

---

## 4. 테스트 품질 개선 사항

### 4.1. Prisma Extension 테스트의 verbose 패턴

`prisma-tenancy.extension.spec.ts`에서 수동 Promise 래핑 패턴 사용:
```typescript
await new Promise<void>((resolve, reject) => {
  context.run('tenant-id', async () => {
    try { ... resolve(); } catch (e) { reject(e); }
  });
});
```

프로젝트에 이미 `withTenant()` 헬퍼가 있으므로 리팩토링하면 가독성 향상 + 사일런트 테스트 실패 위험 감소.

### 4.2. Telemetry 테스트의 `(service as any)` 직접 할당

내부 필드 직접 할당은 구현 세부사항에 커플링됨. 필드 이름 변경 시 잘못된 이유로 테스트 실패. `import('@opentelemetry/api')` mock + `onModuleInit()` 호출 방식이 더 견고.

---

## 5. 우선순위 요약

| 우선순위 | 갭 | Criticality | 대상 파일 |
|----------|-----|-------------|----------|
| P0 | Prisma `$transaction` 에러 전파 + 동시성 단위 테스트 | 9 | `prisma-tenancy.extension.ts` |
| P1 | TelemetryService `onModuleInit` 성공 경로 | 8 | `tenancy-telemetry.service.ts` |
| P1 | TenancyModule `forRootAsync` `useExisting` 분기 | 8 | `tenancy.module.ts` |
| P1 | Interceptor gRPC/Kafka Buffer 분기 | 8 | `tenant-context.interceptor.ts` |
| P2 | 미들웨어 extractor throw 전파 | 7 | `tenant.middleware.ts` |
| P2 | SubdomainExtractor psl 에러 + parse 에러 | 6 | `subdomain.extractor.ts` |
| P2 | Interceptor `bull` + 비객체 데이터 | 6 | `tenant-context.interceptor.ts` |
| P3 | PathExtractor undefined path | 5 | `path.extractor.ts` |
| P3 | tenancyTransaction `isolationLevel` 옵션 | 5 | `tenancy-transaction.ts` |
| P3 | CLI `index.ts` 인자 라우팅 | 5 | `cli/index.ts` |
