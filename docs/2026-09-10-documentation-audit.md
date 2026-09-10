# README·문서 품질 검토 — 2026-09-10

검토 기준은 로컬 커밋 `91b9fb7`, 패키지 `@nestarc/tenancy@0.16.0`이다. README 전체, 관련 소스·타입·테스트·CI·벤치마크, 공개 npm/GitHub 메타데이터, 공식 문서 사이트를 확인했다. 아래 내용은 해당 시점의 검토 기록이며 제품 사용법의 기준 문서가 아니다. 소스 근거 링크는 검토 당시 커밋에 고정했다. 수정 결과는 [고정 체크리스트](./2026-09-10-documentation-remediation.md)에서 확인한다.

**판정:** 기능과 호환성 설명은 대체로 구현에 맞지만, 인증 미들웨어 순서 안내와 일부 예제에 재현 가능한 오류가 있다. 검색 접근성은 이미 상당 부분 설정되어 있다. 사용자와 AI 에이전트 모두에게 가장 큰 개선점은 정확한 실행 예제와 문서 간 일관성이다.

| 관점 | 판정 | 우선 조치 |
| --- | --- | --- |
| 구현과 문서의 일치 | 부분 충족 | 인증 순서, 예제 오류, RLS 우회 표현 수정 |
| 사용자 이해도 | 숙련자 참고서로 유용, 첫 실행 안내는 보완 필요 | Quick Start 완결, 권한 검증 조건 앞당기기 |
| 검색 발견 가능성 | 기술적 기반 양호, 실제 순위는 미측정 | 과장된 검색 설명 수정, GitHub Topics·직접 문서 링크 보완 |
| AI 에이전트 활용 | 타입·API·CLI·웹 인덱스 기반 존재 | 패키지별 진입점, 검증된 예제, README/JSDoc/사이트 동기화 |

P1은 사용자의 인증·격리 설정을 잘못 유도할 수 있어 먼저 수정할 문서 문제, P2는 실행·이해·유지보수 품질 문제를 뜻한다. 취약점 심각도 등급이 아니다.

**1. 구현과 문서의 일치 여부**

| 우선순위 | 발견 | 근거·영향 | 권장 수정 |
| --- | --- | --- | --- |
| P1 | AuthModule을 먼저 import하면 JWT 검증이 먼저 실행된다는 설명이 재현과 다름 | [README:592](https://github.com/nestarc/nestjs-tenancy/blob/91b9fb767a335b15356d4d99069c1619641b8278/README.md#L592). Node 24.11.1/Nest 11.2.1에서 `tenant → hook → auth` 순서로 실행됐다. `TenancyModule`은 [global 모듈](https://github.com/nestarc/nestjs-tenancy/blob/91b9fb767a335b15356d4d99069c1619641b8278/src/tenancy.module.ts#L92)이고 현재 Nest는 global middleware를 먼저 정렬한다. 훅에서 인증된 `req.user`를 기대할 수 없다. | 검증된 인증 등록 방법과 순서 테스트를 제공한다. 같은 환경에서 `app.use(auth)`를 `app.init()` 전에 등록한 경우 `auth → tenant → hook`를 확인했다. 어댑터별로 실행 예제를 구분한다. |
| P1 | admin bypass SQL 예제가 현재 restrictive guard와 조건이 맞지 않음 | [README:523](https://github.com/nestarc/nestjs-tenancy/blob/91b9fb767a335b15356d4d99069c1619641b8278/README.md#L523)는 bypass flag만으로 접근을 허용하는 permissive 정책을 소개한다. 그러나 [Quick Start guard](https://github.com/nestarc/nestjs-tenancy/blob/91b9fb767a335b15356d4d99069c1619641b8278/README.md#L175)는 non-empty tenant setting을 별도로 요구한다. 컨텍스트가 없는 상태에서는 bypass flag만 켜도 이 guard가 계속 차단한다. | 별도 권한이 통제된 admin 연결 예제를 기준으로 정리하거나, 별도의 정책 설계·권한·트랜잭션 전제까지 검증한 전체 예제를 제공한다. |
| P2 | `sharedModels`를 DB RLS 우회라고 설명 | [README:320](https://github.com/nestarc/nestjs-tenancy/blob/91b9fb767a335b15356d4d99069c1619641b8278/README.md#L320), [README:505](https://github.com/nestarc/nestjs-tenancy/blob/91b9fb767a335b15356d4d99069c1619641b8278/README.md#L505). [구현](https://github.com/nestarc/nestjs-tenancy/blob/91b9fb767a335b15356d4d99069c1619641b8278/src/prisma/prisma-tenancy.extension.ts#L144)은 `query(args)`로 통과시켜 extension의 설정·주입·검사를 생략할 뿐, 적용된 DB RLS를 해제하지 않는다. | 클라이언트 확장 처리 생략과 DB 정책을 분리해 설명한다. 공용 테이블이 실제로 허용되는지는 DB 설정에 달려 있다. |
| P2 | Path 예제의 `acme`는 기본 HTTP 검증에 실패 | [README:640](https://github.com/nestarc/nestjs-tenancy/blob/91b9fb767a335b15356d4d99069c1619641b8278/README.md#L640). 추출 자체는 성공하지만 [기본 UUID-like 검증](https://github.com/nestarc/nestjs-tenancy/blob/91b9fb767a335b15356d4d99069c1619641b8278/src/middleware/tenant.middleware.ts#L41)이 400 오류를 발생시킨다. | 예제에 slug용 `validateTenantId`를 추가하거나 UUID 형태의 요청을 사용한다. Composite의 subdomain fallback에도 같은 조건을 설명한다. |
| P2 | 제공한 공용 타입으로 일부 예제가 strict TypeScript 컴파일에 실패 | [README:628](https://github.com/nestarc/nestjs-tenancy/blob/91b9fb767a335b15356d4d99069c1619641b8278/README.md#L628) `req.user?.org_id`: TS2339. [README:676](https://github.com/nestarc/nestjs-tenancy/blob/91b9fb767a335b15356d4d99069c1619641b8278/README.md#L676) `request.cookies?.['tenant_id']`: TS7053. [README:703](https://github.com/nestarc/nestjs-tenancy/blob/91b9fb767a335b15356d4d99069c1619641b8278/README.md#L703) `res.status(401).json(...)`: TS2722 두 건. [공용 인터페이스](https://github.com/nestarc/nestjs-tenancy/blob/91b9fb767a335b15356d4d99069c1619641b8278/src/interfaces/tenancy-request.interface.ts#L9)의 확장 속성은 unknown이고 응답 메서드는 optional이다. | 플랫폼별 예제를 명시하고 타입 좁히기 또는 적절한 타입 단언을 포함한다. 응답을 보냈다고 가정하면서 optional 호출로 아무 동작도 하지 않는 수정은 피한다. |
| P2 | 모든 HTTP 환경을 포괄하는 표현이 실제 필드 의존성을 숨김 | [README:36](https://github.com/nestarc/nestjs-tenancy/blob/91b9fb767a335b15356d4d99069c1619641b8278/README.md#L36)의 Express/Fastify/raw Node 지원 표현과 달리 [PathTenantExtractor](https://github.com/nestarc/nestjs-tenancy/blob/91b9fb767a335b15356d4d99069c1619641b8278/src/extractors/path.extractor.ts#L29)는 `request.path`만 읽는다. `{headers, url}` 형태의 요청은 경로가 있어도 null을 반환했다. | 공용 타입 호환성과 모든 추출기의 어댑터별 동작을 구분한다. path 정규화 전제·Fastify 예제·해당 통합 테스트를 제공한다. 전체 Fastify E2E 실패를 확인한 것은 아니다. |

admin bypass 정책의 판정은 SQL 정적 분석과 PostgreSQL의 정책 결합 규칙에 근거한다. Permissive 정책을 통과해도 모든 restrictive 정책을 통과해야 한다. 이번 검토에서 해당 SQL을 실DB로 재실행하지는 않았다. [PostgreSQL CREATE POLICY](https://www.postgresql.org/docs/current/sql-createpolicy.html)

오류로 단정할 수는 없지만 사용법을 더 명확히 할 두 항목도 있다. [자동 주입 옵션](https://github.com/nestarc/nestjs-tenancy/blob/91b9fb767a335b15356d4d99069c1619641b8278/README.md#L318)은 create에 이미 제공된 tenant 값을 현재 컨텍스트 값으로 덮어쓰며, upsert의 update에서는 tenant 필드를 제거한다. 재귀적인 nested write 주입은 구현되어 있지 않다. 지원 operation 목록은 맞지만 이러한 변경 규칙도 설명하면 좋다. [CacheTTL 예제](https://github.com/nestarc/nestjs-tenancy/blob/91b9fb767a335b15356d4d99069c1619641b8278/README.md#L1129)의 60·300에는 단위가 없다. 현재 Nest 캐시의 TTL 단위는 밀리초이므로 단위를 명시하고 의도한 유효기간과 맞추어야 한다. 문서가 초라고 주장한 것은 아니다. [Nest caching 문서](https://docs.nestjs.com/techniques/caching)

**과장과 증거 부족은 구분해야 한다.**

| 표현 또는 주장 | 판정 | 더 정확한 범위 |
| --- | --- | --- |
| [One line of code](https://github.com/nestarc/nestjs-tenancy/blob/91b9fb767a335b15356d4d99069c1619641b8278/README.md#L11) | 실제 초기 설정을 축약한 과장 | RLS·DB 역할·Nest 모듈·Prisma 확장 설정 후 모델 쿼리에 자동 테넌트 컨텍스트 적용 |
| [Zero-overhead](https://github.com/nestarc/nestjs-tenancy/blob/91b9fb767a335b15356d4d99069c1619641b8278/README.md#L16) | 비용이 0이라는 근거 없음 | Nest REQUEST-scoped provider를 사용하지 않는 AsyncLocalStorage 컨텍스트 |
| [DB 계층 SQL injection 위험 제거](https://github.com/nestarc/nestjs-tenancy/blob/91b9fb767a335b15356d4d99069c1619641b8278/README.md#L1221) | 보장 범위를 과도하게 확대 | 확장이 실행하는 `set_config()` 인자의 파라미터 바인딩; 애플리케이션의 임의 SQL 안전성은 별개 |
| [벤치마크 결과](https://github.com/nestarc/nestjs-tenancy/blob/91b9fb767a335b15356d4d99069c1619641b8278/README.md#L54) | 계산·비교 방법은 일치, 과거 실행의 원시 증거는 확인 불가 | 동일 역할·행 수·RLS 트랜잭션을 비교하며 작은 차이를 측정 노이즈로 설명한 점은 적절. 날짜·커밋·원시 출력 artifact를 추가하면 재검증 가능성이 높아짐 |

벤치마크의 과거 Prisma 7.9.1과 현재 개발 환경 7.10.0의 차이 자체는 오류가 아니다. 측정 환경을 명시한 과거 예시이며, 이를 허위 수치로 판정할 근거는 없다. AsyncLocalStorage 자체의 오버헤드와 DB 트랜잭션 전체 비교는 서로 다른 측정이다.

정확히 일치한 중요한 항목도 있다.

- Node `^22.13.0 || ^24.0.0`, Nest 10/11, Prisma 6/7 범위는 [package.json](https://github.com/nestarc/nestjs-tenancy/blob/91b9fb767a335b15356d4d99069c1619641b8278/package.json#L34)과 맞는다. npm latest 메타데이터도 0.16.0과 같은 Node 범위였다.
- 네 가지 packed consumer 조합과 strict peer 설치, source gates, legacy/modern ecosystem 분리, release의 CI 재사용은 [CI](https://github.com/nestarc/nestjs-tenancy/blob/91b9fb767a335b15356d4d99069c1619641b8278/.github/workflows/ci.yml#L20)·[release](https://github.com/nestarc/nestjs-tenancy/blob/91b9fb767a335b15356d4d99069c1619641b8278/.github/workflows/release.yml#L11)·[compat runner](https://github.com/nestarc/nestjs-tenancy/blob/91b9fb767a335b15356d4d99069c1619641b8278/scripts/test-peer-compat.js#L27)에 존재한다.
- PgBouncer의 PostgreSQL 16.14/PgBouncer 1.25.2 및 Prisma 6/7 검증 구성은 문서와 맞는다. 별도 direct PostgreSQL CI의 16.15를 PgBouncer 환경과 혼동하면 안 된다.
- 기본 failClosed, raw SQL 자동 처리 제외, 명시적 transaction helper, RPC 검증의 0.x opt-in, HTTP/RPC 인증 책임 구분은 관련 구현과 일치한다.

CI 설정을 확인했다는 사실은 최근 원격 CI 전체 성공을 확인했다는 의미가 아니다. 이번 조사에서는 최근 Actions 실행 결과를 인증해 확인하지 않았다.

**2. 사용자가 이해하기 쉬운가**

장점은 옵션·기본값·오류 응답 표, transaction 예제, 지원 범위, CLI 진단·종료 코드, 운영 제약이 구체적이라는 것이다. 숙련된 Nest/Prisma 사용자가 특정 설정을 찾는 참고서로 유용하다.

첫 사용자의 실행 경로에는 다음 개선이 필요하다.

| 문제 | 관찰 | 권장 구성 |
| --- | --- | --- |
| 시작 전에 상세 검증 정보가 많음 | README 1,481줄. 설치는 148행, Quick Start는 156행에 시작한다. 앞부분에 exact dependency graph·CI 증거가 길게 배치된다. | 짧은 지원 버전 표와 설치·최소 예제를 앞에 놓고 검증 상세는 링크로 안내 |
| Quick Start의 단계가 끊김 | 3단계와 4단계 사이에 옵션·deprecated transaction·migration 설명이 약 80행 들어감 | 첫 HTTP 요청까지 한 번에 완결하고 고급 트랜잭션 설명은 뒤로 이동 |
| 완결된 앱 예제가 아님 | User 모델, provider/controller 연결, migration·seed·시작 명령이 모두 들어 있지는 않음 | 기존 앱 통합용 가이드임을 명시하거나 실행 가능한 최소 예제를 제공 |
| 권한 검증 전제가 멀리 있음 | 헤더 기반 Quick Start 이후 자세한 principal↔tenant 권한 설명은 1254행에서 등장 | Quick Start의 헤더 예제 바로 옆에 인증·멤버십 검증 조건과 실행 가능한 예제 링크 추가 |
| 예제가 선택지를 한 코드 블록에 섞음 | `onTenantNotFound` 예제에 throw 이후 response 전송 코드가 계속 등장 | 관찰·예외·직접 응답을 서로 독립된 예제로 표현 |

문서 길이를 줄이는 목적은 정해진 검색 최적화 글자 수를 맞추는 것이 아니라 사용자가 첫 실행까지 필요한 정보와 운영 상세를 구분하도록 돕는 것이다.

중복도 두 종류로 구분한다. `interactiveTransactionSupport`의 deprecation 설명은 322·328·371·373·871행에 반복되어 일정의 기준 위치를 정하고 링크로 연결하는 편이 좋다. 반면 raw SQL, 권한 검증, `withoutTenant()`의 한계는 각 사용 지점에서 짧게 반복할 가치가 있다.

**3. 검색에 유리한가**

검토일에 공식 사이트에 직접 HTTP 요청을 보내 HTML과 공개 메타데이터를 확인했다. 검색 도구가 제공한 일부 저장된 본문은 0.15였지만 직접 가져온 현재 사이트와 npm은 0.16이다. 따라서 현재 배포 사이트 전체가 구버전이라는 결론은 내리지 않는다.

| 항목 | 확인 결과 | 평가 |
| --- | --- | --- |
| HTML 접근 | tenancy 소개·설치·추출기·RPC·API·migration·한국어 소개 모두 HTTP 200. HTML에 본문이 포함됨 | 로그인이나 클라이언트 JS 실행 없이 주요 텍스트 접근 가능 |
| 제목·설명 | 소개 title에 NestJS, multi-tenancy, PostgreSQL RLS, Prisma가 포함됨. 소개/설치 페이지 meta description 존재 | 핵심 검색 의도와 잘 맞음 |
| Canonical | 확인한 소개/설치 페이지에 자기 URL을 가리키는 canonical 존재 | 대표 URL 설정 기반 있음 |
| 검색 차단 | 확인한 소개/설치 응답에 X-Robots-Tag나 meta noindex 없음. robots는 전체 접근 허용 | robots 차단은 발견하지 못함; 모든 크롤러의 실제 접근 보장까지 의미하지 않음 |
| 사이트맵 | HTTP 200, URL 187개, tenancy 개별 문서와 영문/한국어 alternate 정보 포함 | 탐색·언어 연결 기반 있음 |
| 공유 메타데이터 | Open Graph, Twitter card, JSON-LD 존재 | 링크 공유와 기계 판독의 기반; 검색 rich result 자격이나 순위는 별도 검증 대상 |
| npm 키워드 | NestJS, multi-tenancy, RLS, Prisma, PostgreSQL 등 12개 | 관련 키워드가 이미 충분히 기술됨 |
| GitHub Topics | 공개 API의 `topics`는 빈 배열 | 관련 주제로 저장소를 찾는 경로 보완 가능 |
| 홈페이지 링크 | npm/package.json과 GitHub homepage가 사이트 루트를 가리킴 | 패키지 소개 URL로 직접 연결하면 사용자가 더 빨리 도착함 |

직접 확인한 공개 위치: [문서 소개](https://nestarc.dev/packages/tenancy/), [설치](https://nestarc.dev/packages/tenancy/installation), [robots.txt](https://nestarc.dev/robots.txt), [sitemap.xml](https://nestarc.dev/sitemap.xml), [npm 메타데이터](https://registry.npmjs.org/@nestarc%2Ftenancy/latest), [GitHub 메타데이터](https://api.github.com/repos/nestarc/nestjs-tenancy).

가장 먼저 수정할 검색 콘텐츠는 소개 페이지의 meta description과 Open Graph 설명에도 포함된 한 줄 설정 약속이다. 사실에 맞는 제품 설명으로 바꾸어 검색 결과를 보고 들어온 사용자의 기대와 실제 설치 단계를 맞추는 편이 좋다. Google은 페이지 본문이나 meta description을 검색 snippet의 재료로 사용할 수 있다. [Google snippet 안내](https://developers.google.com/search/docs/appearance/snippet)

README H1을 `@nestarc/tenancy — NestJS multi-tenancy with PostgreSQL RLS and Prisma`처럼 설명형으로 바꾸는 것도 선택지다. 현재 README 첫 문장과 사이트 title에는 이미 관련 단어가 있으므로 치명적인 누락은 아니다. GitHub Topics에 적절한 기술 주제를 추가하면 주제 기반 탐색을 도울 수 있다. [Google title 안내](https://developers.google.com/search/docs/appearance/title-link), [GitHub Topics 안내](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/classifying-your-repository-with-topics)

패키지명과 관련 검색에서 문서가 발견되었지만, 검색 순위·노출·클릭률·전환율은 측정하지 않았다. Search Console 데이터, crawl log, 실제 사용자 트래픽 없이 SEO 성과를 수치로 평가할 수 없다. README/GitHub/npm에 같은 소개가 있다는 사실만으로 검색 페널티라고 판단하지 않는다.

**4. AI 에이전트가 사용법을 참고할 수 있는가**

이미 마련된 기반은 다음과 같다.

- 공개 HTML 문서, API reference, 코드 블록·옵션·오류 표가 있고 인증 없이 읽을 수 있다.
- [llms.txt](https://nestarc.dev/llms.txt)는 HTTP 200이며 Getting Started·Packages·Guide·API·FAQ 등으로 연결한다. robots에는 `OAI-SearchBot` 허용도 명시되어 있다.
- [package exports](https://github.com/nestarc/nestjs-tenancy/blob/91b9fb767a335b15356d4d99069c1619641b8278/package.json#L10)는 root·`/cache`·`/testing`을 구분하고 타입 선언을 제공한다. 소스 JSDoc의 기본값·deprecation·transaction 조건도 참고 가능하다.
- `doctor --json`과 종료 코드, packed consumer·타입·실DB fixture는 에이전트가 생성한 설정을 검증하기 좋은 수단이다.
- [handover](https://github.com/nestarc/nestjs-tenancy/blob/91b9fb767a335b15356d4d99069c1619641b8278/docs/handover.md#L3)와 [과거 작업 기록 안내](https://github.com/nestarc/nestjs-tenancy/blob/91b9fb767a335b15356d4d99069c1619641b8278/docs/superpowers/README.md#L3)는 historical/superseded임을 표시한다.

다음 보완이 필요하다.

| 항목 | 상태·영향 | 제안 |
| --- | --- | --- |
| 패키지별 소비자 진입점 | llms.txt는 753바이트의 범용 링크 목록이며 tenancy 전용 링크·버전·필수 조건이 없음 | tenancy 설치·API·migration·안전한 최소 예제로 직접 연결. 소비자가 먼저 자신의 설치 버전을 확인하도록 안내 |
| README·웹·API의 일관성 | 설치 페이지는 sharedModels가 client 동작만 생략한다고 정확히 설명하지만 README·소개·API에는 RLS 생략 표현이 남음. 소개에는 모든 쿼리 전에 set_config를 실행한다는 넓은 표현도 남음 | 수정 대상을 README에 한정하지 말고 웹 원문·JSDoc·생성 API까지 연결 |
| JSDoc 과장 전파 | [extension JSDoc](https://github.com/nestarc/nestjs-tenancy/blob/91b9fb767a335b15356d4d99069c1619641b8278/src/prisma/prisma-tenancy.extension.ts#L80)의 SQL injection 전체 제거와 RLS 생략 표현이 현재 공개 API에도 노출됨 | 원본 JSDoc을 수정한 뒤 선언 파일·API 문서를 재생성 |
| 실행 예제 검증 | 타입/fixture 테스트는 존재하지만 README 예제 자체를 추출·컴파일·실행하는 상시 CI는 발견되지 않음 | 하나의 실제 예제 파일을 문서와 CI가 함께 사용. 인증 순서·tenant A/B·no context 등 의미 있는 흐름 검증 |
| 유지보수 에이전트 안내 | 저장소에 AGENTS.md·CLAUDE.md는 발견되지 않음. npm package의 files는 dist이므로 내부 docs/test는 소비자 배포 대상도 아님 | 필요하면 유지보수용 짧은 안내를 추가하되, 설치 소비자용 usage guide와 역할을 구분 |

`llms-full.txt`는 검토 시 HTTP 404였다. 이 파일이나 `AGENTS.md`가 없다고 AI 사용 불가로 판정하지 않는다. 패키지별 짧은 안내와 검증된 예제가 우선이며, 에이전트가 반드시 해당 파일을 읽는 것도 보장되지 않는다.

`llms.txt`는 일부 클라이언트를 위한 편의 인덱스이지 검색 순위 장치가 아니다. Google의 공식 안내도 Google Search의 AI 기능을 위해 특별한 텍스트 파일이 필요하지 않으며 llms.txt가 검색 순위에 영향을 주지 않는다고 설명한다. [Google AI 검색 안내](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide)

**5. 검증 실행과 범위**

관련 기존 테스트 실행:

```sh
npm test -- --runInBand --no-cache \
  test/tenant.middleware.spec.ts \
  test/prisma-tenancy.extension.spec.ts \
  test/tenancy-request.interface.spec.ts \
  test/path.extractor.spec.ts \
  test/tenancy.guard.spec.ts
```

결과: 5 suites, 101 tests 통과. 기존 구현 테스트의 통과와 README 예제의 정확성은 별개다.

인증 순서 재현은 Node 24.11.1, Nest 11.2.1, 현재 저장소 소스를 사용했다. 초기화된 Express 처리 경로를 호출했으며 외부 서버나 DB 연결을 사용하지 않았다. 인증 스텁이 `req.user`를 채우는 시점만 검증했고 JWT 서명 검증 자체를 시험한 것은 아니다.

```text
imports: [AuthModule, TenancyModule]
  tenant: user=false
  hook: user=false
  auth

app.use(auth) before app.init()
  auth
  tenant: user=true
  hook: user=true
```

임시 재현 파일: [nestarc-readme-auth-order-audit.cjs](/private/tmp/nestarc-readme-auth-order-audit.cjs). 저장소 루트에서 `node /private/tmp/nestarc-readme-auth-order-audit.cjs`로 실행했다. 임시 파일은 영구 테스트가 아니다.

추가로 공용 타입을 사용하는 세 예제를 strict TypeScript로 검사했고, Path 추출·기본 UUID 검증을 재현했다. README의 명시적 로컬 Markdown 링크·앵커 11개는 간단한 경로/앵커 검사에서 해소됐다. 모든 외부 링크와 전체 사이트를 전수 검사한 것은 아니다.

공개 응답과 메타데이터를 보관한 임시 경로는 `/private/tmp/tenancy-doc-audit-20260910/`이다. raw GitHub main README는 로컬 README와 동일했다. 공식 소개·설치·API 문서는 최신 0.16 관련 내용도 포함했지만 일부 설명이 서로 달랐다.

실DB·PgBouncer 전체 E2E, 벤치마크 재실행, 최신 원격 CI 성공 여부, 전체 Fastify 실행, 검색 성과는 이번 검토 범위에 포함하지 않았다. 기존 코드·README·공식 사이트 설정은 변경하지 않았고 이 검토 기록만 추가했다.

**6. 권장 작업 순서**

1. 인증 순서와 bypass 정책 설명을 수정하고, 실행 순서·권한 조건을 검증하는 예제를 만든다.
2. Path·strict TypeScript 예제를 수정한다. `sharedModels`, `withoutTenant`, SQL injection, overhead의 표현 범위를 정확히 한다.
3. 하나의 실행 가능한 최소 예제를 기준으로 Quick Start를 완결하고 CI가 그 예제를 검사하게 한다.
4. README·JSDoc·공식 사이트·생성 API에 같은 수정이 반영되도록 문서 검증·배포 절차를 연결한다.
5. 기존 llms 인덱스에 tenancy 직접 경로를 보완하고, GitHub Topics와 homepage 링크를 정리한다. 검색 성과는 이후 실제 노출·클릭 데이터로 평가한다.
