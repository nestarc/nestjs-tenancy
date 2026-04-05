# @nestarc/pagination — Design Spec

Date: 2026-04-05
Status: Draft

## Goal

NestJS + Prisma + PostgreSQL 환경을 위한 통합 페이지네이션 모듈. 오프셋 기반과 커서 기반 페이지네이션을 단일 API로 지원하고, 다중 컬럼 정렬, 필터링, 전문 검색을 제공한다. `@Paginate()` 파라미터 데코레이터 한 줄로 컨트롤러 통합이 완료되며, `@nestarc/tenancy`와 연동하면 RLS가 자동 적용되어 테넌트 격리된 페이지네이션이 구현된다. `@nestarc/soft-delete`와 연동하면 소프트 삭제된 레코드가 자동 제외된다. Swagger/OpenAPI 자동 문서화를 내장한다.

## Market Gap

npm 현황:
| 패키지 | 문제점 |
|--------|--------|
| `nestjs-paginate` | TypeORM 전용. Prisma 사용 불가 |
| `prisma-extension-pagination` | NestJS 미통합. 모듈/DI 없음. 필터링/정렬/검색 미지원 |
| `prisma-paginate` | 유지보수 중단 우려. NestJS 통합 없음 |
| `nestjs-prisma-pagination` | 기능 제한적 (오프셋만, 필터링 없음) |
| `prisma-offset-pagination` | 오프셋만 지원. 커서 미지원 |

핵심 pain points:
1. Prisma 네이티브로 커서/오프셋 + 필터링 + 정렬 + 검색을 통합하는 NestJS 모듈이 **없음**
2. `nestjs-paginate`의 풍부한 기능(필터 연산자, 다중 정렬, 관계 로딩)을 Prisma에서 사용할 방법 없음
3. 매 프로젝트마다 페이지네이션 DTO, 변환 로직, 응답 형식을 직접 구현
4. 멀티테넌트 환경에서 페이지네이션 결과의 테넌트 격리 미지원
5. Swagger 문서에 페이지네이션 파라미터/응답 스키마 수동 작성 필요

## Design Decisions

| 결정 | 선택 | 이유 |
|------|------|------|
| ORM | Prisma 전용 | tenancy, audit-log, soft-delete와 동일 전략. 생태계 일관성 |
| 페이지네이션 | 오프셋 + 커서 통합 | 사용 사례별 최적 방식 선택. nestjs-paginate와 동일한 유연성 |
| 쿼리 파싱 | `@Paginate()` 파라미터 데코레이터 | nestjs-paginate와 동일 패턴. 학습 비용 최소화 |
| 응답 형식 | JSON:API 스타일 `{ data, meta, links }` | 업계 표준. nestjs-paginate 호환 |
| 필터링 | 연산자 기반 (`$eq`, `$gt`, `$in` 등) | nestjs-paginate와 호환. Prisma where 절로 자연스럽게 변환 |
| 정렬 | 다중 컬럼 `sortBy=field:ASC` | nestjs-paginate와 동일 쿼리 파라미터 형식 |
| Swagger | 자동 문서화 | ApiQuery/ApiResponse 데코레이터 자동 생성 |
| tenancy 연동 | optional peer dep | 미설치 시 정상 동작. graceful degradation |
| soft-delete 연동 | 자동 호환 | Prisma extension 레이어에서 자동 처리. 별도 통합 코드 불필요 |
| NestJS 연동 | DynamicModule | forRoot/forRootAsync 패턴 |

## Module API

### Registration

```typescript
@Module({
  imports: [
    PaginationModule.forRoot({
      // 기본 페이지 크기 (기본값: 20)
      defaultLimit: 20,

      // 최대 페이지 크기 (기본값: 100)
      maxLimit: 100,

      // 기본 페이지네이션 타입 (기본값: 'offset')
      defaultPaginationType: 'offset',

      // 기본 정렬 (선택)
      defaultSortBy: [['createdAt', 'DESC']],

      // 응답에 links 포함 여부 (기본값: true)
      withLinks: true,

      // 응답에 total count 포함 여부 (기본값: true, 커서 모드에서는 기본 false)
      withTotalCount: true,

      // Prisma 모델명 → DB 컬럼명 매핑 전략 (기본값: 'camelCase')
      // Prisma는 camelCase 필드명 사용, DB는 snake_case일 수 있음
      fieldNamingStrategy: 'camelCase',
    }),
  ],
})
export class AppModule {}
```

`forRootAsync`도 지원:

```typescript
PaginationModule.forRootAsync({
  imports: [ConfigModule],
  useFactory: (config: ConfigService) => ({
    defaultLimit: config.get('PAGINATION_DEFAULT_LIMIT', 20),
    maxLimit: config.get('PAGINATION_MAX_LIMIT', 100),
  }),
  inject: [ConfigService],
})
```

### Controller Usage

```typescript
@Controller('users')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get()
  @ApiPaginatedResponse(UserDto) // Swagger 자동 문서화
  async findAll(@Paginate() query: PaginateQuery) {
    return this.userService.findAll(query);
  }
}
```

### Service Usage — paginate() 함수

```typescript
import { paginate, PaginateQuery, Paginated, PaginateConfig } from '@nestarc/pagination';

@Injectable()
class UserService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: PaginateQuery): Promise<Paginated<User>> {
    return paginate<User>(query, this.prisma.user, {
      // 정렬 허용 컬럼 (필수)
      sortableColumns: ['id', 'name', 'email', 'createdAt'],

      // 기본 정렬 (선택)
      defaultSortBy: [['createdAt', 'DESC']],

      // 검색 가능 컬럼 — 전문 검색 (선택)
      searchableColumns: ['name', 'email'],

      // 필터링 가능 컬럼과 허용 연산자 (선택)
      filterableColumns: {
        role: ['$eq', '$in'],
        createdAt: ['$gte', '$lte', '$btw'],
        age: ['$gt', '$gte', '$lt', '$lte'],
      },

      // 관계 로딩 (선택)
      relations: {
        profile: true,
        posts: { select: { id: true, title: true } },
      },

      // 컬럼 선택 (선택)
      select: ['id', 'name', 'email', 'role', 'createdAt'],

      // 페이지네이션 타입 오버라이드 (선택)
      paginationType: 'offset',

      // 커서 기반에서 커서 컬럼 (기본값: 'id')
      cursorColumn: 'id',

      // where 기본 조건 (선택)
      where: { isActive: true },

      // withDeleted 허용 여부 (기본값: false, @nestarc/soft-delete 연동)
      allowWithDeleted: false,

      // 최대 limit 오버라이드 (선택)
      maxLimit: 50,
    });
  }
}
```

### Query Parameters

클라이언트에서 보내는 HTTP 쿼리 파라미터 형식. `nestjs-paginate`와 호환:

#### 오프셋 기반 (기본)

```
GET /users?limit=20&page=1&sortBy=createdAt:DESC&search=john&filter.role=$eq:admin
```

| 파라미터 | 설명 | 예시 |
|---------|------|------|
| `limit` | 페이지당 항목 수 | `20` |
| `page` | 페이지 번호 (1-based) | `1` |
| `sortBy` | 정렬 (다중 가능) | `createdAt:DESC`, `name:ASC` |
| `search` | 전문 검색어 | `john` |
| `filter.{column}` | 필터링 | `filter.role=$eq:admin` |
| `select` | 컬럼 선택 | `id,name,email` |

#### 커서 기반

```
GET /users?limit=20&after=eyJpZCI6MTB9&sortBy=createdAt:DESC
```

| 파라미터 | 설명 | 예시 |
|---------|------|------|
| `limit` | 페이지당 항목 수 | `20` |
| `after` | 다음 페이지 커서 (forward) | `eyJpZCI6MTB9` (Base64 encoded) |
| `before` | 이전 페이지 커서 (backward) | `eyJpZCI6NX0=` |
| `sortBy` | 정렬 | `createdAt:DESC` |
| `search` | 전문 검색어 | `john` |
| `filter.{column}` | 필터링 | `filter.role=$eq:admin` |

### Filter Operators

| 연산자 | 설명 | Prisma 변환 | 예시 |
|--------|------|------------|------|
| `$eq` | 같음 | `{ equals: value }` | `filter.role=$eq:admin` |
| `$ne` | 같지 않음 | `{ not: value }` | `filter.status=$ne:deleted` |
| `$gt` | 초과 | `{ gt: value }` | `filter.age=$gt:18` |
| `$gte` | 이상 | `{ gte: value }` | `filter.age=$gte:18` |
| `$lt` | 미만 | `{ lt: value }` | `filter.price=$lt:100` |
| `$lte` | 이하 | `{ lte: value }` | `filter.price=$lte:100` |
| `$in` | 포함 | `{ in: [values] }` | `filter.role=$in:admin,user` |
| `$nin` | 미포함 | `{ notIn: [values] }` | `filter.role=$nin:banned` |
| `$ilike` | 대소문자 무시 포함 | `{ contains: value, mode: 'insensitive' }` | `filter.name=$ilike:john` |
| `$btw` | 범위 | `{ gte: min, lte: max }` | `filter.price=$btw:10,100` |
| `$null` | null 여부 | `null` 또는 `{ not: null }` | `filter.deletedAt=$null` |
| `$not:null` | not null | `{ not: null }` | `filter.verifiedAt=$not:null` |

### Response Format

#### 오프셋 기반 응답

```typescript
interface Paginated<T> {
  data: T[];
  meta: {
    itemsPerPage: number;
    totalItems: number;
    currentPage: number;
    totalPages: number;
    sortBy: [string, SortOrder][];
    search?: string;
    filter?: Record<string, string>;
  };
  links: {
    first: string;
    previous: string | null;
    current: string;
    next: string | null;
    last: string;
  };
}
```

예시:
```json
{
  "data": [{ "id": "1", "name": "Alice", "email": "alice@example.com" }],
  "meta": {
    "itemsPerPage": 20,
    "totalItems": 500,
    "currentPage": 1,
    "totalPages": 25,
    "sortBy": [["createdAt", "DESC"]],
    "search": "alice",
    "filter": { "role": "$eq:admin" }
  },
  "links": {
    "first": "/users?page=1&limit=20",
    "previous": null,
    "current": "/users?page=1&limit=20",
    "next": "/users?page=2&limit=20",
    "last": "/users?page=25&limit=20"
  }
}
```

#### 커서 기반 응답

```typescript
interface CursorPaginated<T> {
  data: T[];
  meta: {
    itemsPerPage: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
    startCursor: string | null;
    endCursor: string | null;
    sortBy: [string, SortOrder][];
    search?: string;
    filter?: Record<string, string>;
    // totalItems는 기본 미포함 (성능). withTotalCount 옵션으로 활성화 가능
    totalItems?: number;
  };
  links: {
    current: string;
    next: string | null;
    previous: string | null;
  };
}
```

예시:
```json
{
  "data": [{ "id": "10", "name": "Bob", "email": "bob@example.com" }],
  "meta": {
    "itemsPerPage": 20,
    "hasNextPage": true,
    "hasPreviousPage": true,
    "startCursor": "eyJpZCI6IjEwIn0=",
    "endCursor": "eyJpZCI6IjI5In0=",
    "sortBy": [["createdAt", "DESC"]]
  },
  "links": {
    "current": "/users?limit=20&after=eyJpZCI6OX0=",
    "next": "/users?limit=20&after=eyJpZCI6IjI5In0=",
    "previous": "/users?limit=20&before=eyJpZCI6IjEwIn0="
  }
}
```

### Decorators

```typescript
// 페이지네이션 쿼리 파싱 (파라미터 데코레이터)
@Get()
findAll(@Paginate() query: PaginateQuery) { ... }

// Swagger 응답 자동 문서화 (메서드 데코레이터)
@ApiPaginatedResponse(UserDto)
@Get()
findAll(@Paginate() query: PaginateQuery) { ... }

// 커서 기반 Swagger 응답
@ApiCursorPaginatedResponse(UserDto)
@Get('stream')
findAllCursor(@Paginate() query: PaginateQuery) { ... }

// 페이지네이션 기본값 오버라이드 (메서드 데코레이터)
@PaginateDefaults({ defaultLimit: 10, maxLimit: 50 })
@Get()
findAll(@Paginate() query: PaginateQuery) { ... }
```

## PaginateQuery Interface

`@Paginate()` 데코레이터가 파싱하여 서비스에 전달하는 객체:

```typescript
interface PaginateQuery {
  // 공통
  limit?: number;
  sortBy?: [string, SortOrder][];
  search?: string;
  filter?: Record<string, string | string[]>;
  select?: string[];
  path: string;  // 요청 URL path (links 생성용)

  // 오프셋 기반
  page?: number;

  // 커서 기반
  after?: string;   // forward cursor
  before?: string;  // backward cursor
}

type SortOrder = 'ASC' | 'DESC';
```

## PaginateConfig Interface

`paginate()` 함수에 전달하는 설정 객체:

```typescript
interface PaginateConfig<T> {
  // 필수
  sortableColumns: (keyof T & string)[];

  // 정렬 (선택)
  defaultSortBy?: [keyof T & string, SortOrder][];
  nullSort?: 'first' | 'last';  // NULL 정렬 위치 (기본값: 'last')

  // 검색 (선택)
  searchableColumns?: (keyof T & string)[];

  // 필터링 (선택)
  filterableColumns?: {
    [K in keyof T & string]?: FilterOperator[];
  };

  // 관계 로딩 (선택) — Prisma include 형식
  relations?: Record<string, boolean | object>;

  // 컬럼 선택 (선택) — Prisma select 형식
  select?: (keyof T & string)[];

  // 페이지네이션 설정
  paginationType?: 'offset' | 'cursor';
  cursorColumn?: keyof T & string;  // 커서 기반에서 커서 컬럼 (기본값: 'id')
  defaultLimit?: number;
  maxLimit?: number;
  withTotalCount?: boolean;  // 커서 모드에서 총 개수 포함 여부

  // 추가 Prisma where 조건
  where?: object;

  // soft-delete 연동
  allowWithDeleted?: boolean;
}

type FilterOperator =
  | '$eq' | '$ne'
  | '$gt' | '$gte' | '$lt' | '$lte'
  | '$in' | '$nin'
  | '$ilike'
  | '$btw'
  | '$null' | '$not:null';
```

## Prisma Query Building

### 오프셋 기반 변환

```typescript
// 입력
paginate(query, prisma.user, config)

// query: { page: 2, limit: 20, sortBy: [['createdAt', 'DESC']], filter: { role: '$eq:admin' } }

// Prisma 쿼리로 변환:
const [data, totalItems] = await Promise.all([
  prisma.user.findMany({
    where: {
      ...config.where,
      role: { equals: 'admin' },      // filter 변환
    },
    orderBy: { createdAt: 'desc' },    // sortBy 변환
    skip: 20,                           // (page - 1) * limit
    take: 20,                           // limit
    include: config.relations,          // 관계 로딩
  }),
  prisma.user.count({
    where: {
      ...config.where,
      role: { equals: 'admin' },
    },
  }),
]);
```

### 커서 기반 변환

```typescript
// query: { limit: 20, after: 'eyJpZCI6IjEwIn0=', sortBy: [['createdAt', 'DESC']] }

// 커서 디코딩: { id: '10' }

const data = await prisma.user.findMany({
  where: {
    ...config.where,
  },
  orderBy: { createdAt: 'desc' },
  cursor: { id: '10' },
  skip: 1,                             // 커서 자체 건너뛰기
  take: 21,                            // limit + 1 (hasNextPage 판단용)
});

const hasNextPage = data.length > 20;
if (hasNextPage) data.pop();           // 초과분 제거
```

### Search 변환

```typescript
// query: { search: 'john' }, config.searchableColumns: ['name', 'email']

// Prisma where에 OR 조건 추가:
where: {
  ...baseWhere,
  OR: [
    { name: { contains: 'john', mode: 'insensitive' } },
    { email: { contains: 'john', mode: 'insensitive' } },
  ],
}
```

### 다중 정렬 변환

```typescript
// query: { sortBy: [['role', 'ASC'], ['createdAt', 'DESC']] }

// Prisma orderBy 배열로 변환:
orderBy: [
  { role: 'asc' },
  { createdAt: 'desc' },
]
```

## Cursor Encoding/Decoding

커서는 Base64로 인코딩된 JSON 객체:

```typescript
// 인코딩
function encodeCursor(record: any, cursorColumn: string): string {
  const value = record[cursorColumn];
  return Buffer.from(JSON.stringify({ [cursorColumn]: value })).toString('base64url');
}

// 디코딩
function decodeCursor(cursor: string): Record<string, any> {
  return JSON.parse(Buffer.from(cursor, 'base64url').toString('utf-8'));
}

// 예시
encodeCursor({ id: '10', name: 'Alice' }, 'id')  // → 'eyJpZCI6IjEwIn0'
decodeCursor('eyJpZCI6IjEwIn0')                   // → { id: '10' }
```

Base64url 인코딩 사용 (URL-safe, padding 없음).

## Architecture

### File Structure

```
src/
├── pagination.module.ts                # DynamicModule (forRoot/forRootAsync)
├── pagination.constants.ts             # 인젝션 토큰, 기본값 상수
├── interfaces/
│   ├── pagination-options.interface.ts  # PaginationModuleOptions
│   ├── paginate-config.interface.ts     # PaginateConfig<T>
│   ├── paginate-query.interface.ts      # PaginateQuery
│   ├── paginated.interface.ts           # Paginated<T>, CursorPaginated<T>
│   └── filter-operator.type.ts          # FilterOperator, SortOrder
├── paginate.ts                          # 핵심 paginate() 함수
├── cursor/
│   ├── cursor.encoder.ts               # 커서 인코딩/디코딩
│   └── cursor-paginate.ts              # 커서 기반 페이지네이션 로직
├── filter/
│   ├── filter-parser.ts                # 쿼리 파라미터 → Prisma where 변환
│   ├── search-builder.ts               # 전문 검색 OR 조건 빌더
│   └── sort-builder.ts                 # sortBy → Prisma orderBy 변환
├── decorators/
│   ├── paginate.decorator.ts           # @Paginate() 파라미터 데코레이터
│   ├── paginate-defaults.decorator.ts  # @PaginateDefaults() 메서드 데코레이터
│   └── api-paginated-response.decorator.ts # @ApiPaginatedResponse() Swagger
├── pipes/
│   └── paginate-query.pipe.ts          # PaginateQuery 유효성 검증 파이프
├── helpers/
│   ├── link-builder.ts                 # 페이지네이션 links 생성
│   └── type-coercion.ts               # 필터 값 타입 변환 (string → number/date)
├── errors/
│   ├── invalid-sort-column.error.ts    # 정렬 불가 컬럼 접근
│   ├── invalid-filter-column.error.ts  # 필터 불가 컬럼 접근
│   └── invalid-cursor.error.ts         # 잘못된 커서 형식
├── testing/
│   ├── test-pagination.module.ts       # 테스트용 경량 모듈
│   └── create-paginate-query.ts        # 테스트용 PaginateQuery 팩토리
└── index.ts                            # 배럴 export
```

### Data Flow — Offset Pagination

```
HTTP Request: GET /users?page=2&limit=20&sortBy=createdAt:DESC&filter.role=$eq:admin&search=john
  → @Paginate() 데코레이터 (PaginateQueryPipe)
    → 쿼리 파라미터 파싱 → PaginateQuery 객체 생성
    → limit 범위 검증 (1 ≤ limit ≤ maxLimit)
    → page 범위 검증 (≥ 1)
    → sortBy 파싱 (['createdAt', 'DESC'])
    → filter 파싱 ({ role: '$eq:admin' })
  → Controller → Service → paginate(query, prisma.model, config)
    → sortableColumns 검증 (미허용 컬럼 → InvalidSortColumnError)
    → filterableColumns 검증 (미허용 컬럼/연산자 → InvalidFilterColumnError)
    → Prisma where 조건 빌드:
      ├── config.where (기본 조건)
      ├── filter → Prisma where 변환
      └── search → OR 조건 추가
    → Promise.all([findMany, count]) 병렬 실행
    → Paginated<T> 응답 조립 (data, meta, links)
```

### Data Flow — Cursor Pagination

```
HTTP Request: GET /users?limit=20&after=eyJpZCI6IjEwIn0=&sortBy=createdAt:DESC
  → @Paginate() 데코레이터
    → after 커서 디코딩 (Base64url → JSON)
    → PaginateQuery 객체 생성
  → Controller → Service → paginate(query, prisma.model, config)
    → config.paginationType === 'cursor' 또는 after/before 존재 시 커서 모드
    → Prisma 쿼리 빌드:
      ├── cursor: { id: '10' }
      ├── skip: 1 (커서 자체 건너뛰기)
      ├── take: limit + 1 (hasNextPage 판단)
      ├── where: (필터 + 검색 조건)
      └── orderBy: (정렬 조건)
    → findMany 실행
    → hasNextPage = results.length > limit
    → 초과분 제거 (pop)
    → startCursor, endCursor 인코딩
    → CursorPaginated<T> 응답 조립
```

## @nestarc/tenancy Integration

tenancy와의 통합은 **별도 코드 없이 자동으로 동작**한다.

```
@nestarc/tenancy Prisma Extension (RLS set_config)
  → @nestarc/pagination paginate() → prisma.model.findMany()
    → Prisma가 Extension 체인을 통해 실행
    → tenancy extension이 set_config 주입
    → RLS 정책이 현재 테넌트의 레코드만 반환
    → pagination은 이미 필터링된 결과를 받음
```

작동 원리:
- `paginate()`는 Prisma Client의 `findMany()`, `count()`를 호출할 뿐
- Prisma extension 체인에 tenancy extension이 있으면 자동으로 RLS 적용
- `count()`도 RLS가 적용되어 totalItems가 현재 테넌트 기준
- **별도 설정 불필요** — Prisma extension 체인이 모든 것을 처리

## @nestarc/soft-delete Integration

soft-delete와의 통합도 **별도 코드 없이 자동으로 동작**한다.

```
@nestarc/soft-delete Prisma Extension (자동 deletedAt 필터)
  → @nestarc/pagination paginate() → prisma.model.findMany()
    → soft-delete extension이 where에 { deletedAt: null } 자동 추가
    → 소프트 삭제된 레코드 자동 제외
```

`config.allowWithDeleted: true`로 설정하면 클라이언트가 `?withDeleted=true` 쿼리 파라미터로 삭제된 레코드를 포함할 수 있다. 이 경우 `SoftDeleteContext`의 `withDeleted` 모드를 활성화한 후 쿼리를 실행한다:

```typescript
// paginate.ts 내부 (allowWithDeleted 처리)
if (config.allowWithDeleted && query.withDeleted) {
  try {
    const { SoftDeleteService } = require('@nestarc/soft-delete');
    // ModuleRef로 SoftDeleteService 인스턴스 획득
    return softDeleteService.withDeleted(() => executeQuery());
  } catch {
    // @nestarc/soft-delete 미설치 — 무시
    return executeQuery();
  }
}
```

## nestjs-safe-response Integration

`nestjs-safe-response`와 연동하여 페이지네이션 응답을 직렬화할 수 있다:

```typescript
@Get()
@ApiPaginatedResponse(UserResponseDto)
@SafeResponse(UserResponseDto)  // nestjs-safe-response 데코레이터
async findAll(@Paginate() query: PaginateQuery): Promise<Paginated<User>> {
  return paginate(query, this.prisma.user, config);
}
```

`@SafeResponse()`가 `data` 배열의 각 항목을 DTO로 직렬화. `meta`와 `links`는 pass-through.

## Swagger Auto-Documentation

### @ApiPaginatedResponse

```typescript
// 내부 구현 개요
function ApiPaginatedResponse(dataDto: Type) {
  return applyDecorators(
    ApiOkResponse({
      schema: {
        allOf: [
          {
            properties: {
              data: { type: 'array', items: { $ref: getSchemaPath(dataDto) } },
              meta: {
                properties: {
                  itemsPerPage: { type: 'number', example: 20 },
                  totalItems: { type: 'number', example: 500 },
                  currentPage: { type: 'number', example: 1 },
                  totalPages: { type: 'number', example: 25 },
                  sortBy: { type: 'array', example: [['createdAt', 'DESC']] },
                },
              },
              links: {
                properties: {
                  first: { type: 'string' },
                  previous: { type: 'string', nullable: true },
                  current: { type: 'string' },
                  next: { type: 'string', nullable: true },
                  last: { type: 'string' },
                },
              },
            },
          },
        ],
      },
    }),
    // 쿼리 파라미터 문서화
    ApiQuery({ name: 'page', required: false, type: Number }),
    ApiQuery({ name: 'limit', required: false, type: Number }),
    ApiQuery({ name: 'sortBy', required: false, type: String, isArray: true }),
    ApiQuery({ name: 'search', required: false, type: String }),
    ApiQuery({ name: 'filter', required: false, type: String }),
  );
}
```

### @Paginate() 데코레이터

```typescript
// Swagger ApiQuery 파라미터를 자동 추가하는 파라미터 데코레이터
export const Paginate = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): PaginateQuery => {
    const request = ctx.switchToHttp().getRequest<Request>();
    return parsePaginateQuery(request);
  },
);
```

## Validation & Error Handling

### 입력 검증

| 검증 대상 | 규칙 | 에러 |
|----------|------|------|
| `limit` | `1 ≤ limit ≤ maxLimit` | 범위 초과 시 maxLimit으로 clamp (에러 아님) |
| `page` | `≥ 1` | 0 이하 시 1로 clamp |
| `sortBy` 컬럼 | `sortableColumns`에 포함 | `InvalidSortColumnError` (400) |
| `filter` 컬럼 | `filterableColumns`에 포함 | `InvalidFilterColumnError` (400) |
| `filter` 연산자 | 해당 컬럼의 허용 연산자에 포함 | `InvalidFilterColumnError` (400) |
| `after`/`before` 커서 | 유효한 Base64url JSON | `InvalidCursorError` (400) |
| `select` 컬럼 | 배열 형식 | 잘못된 형식 무시 (에러 아님) |

### 에러 응답 형식

```json
{
  "statusCode": 400,
  "message": "Column 'password' is not sortable. Sortable columns: id, name, email, createdAt",
  "error": "InvalidSortColumn"
}
```

### 허용하지 않는 컬럼/연산자 접근 시 기본 동작

보안상 허용되지 않은 컬럼이나 연산자 접근은 **무시가 아닌 에러**를 반환한다. 클라이언트가 의도하지 않은 필터링/정렬이 무시되면 잘못된 결과를 신뢰하게 되는 위험이 있다.

## Performance Considerations

- 오프셋: `findMany` + `count` 병렬 실행으로 총 2 쿼리
- 커서: `findMany`만 실행으로 총 1 쿼리 (count 기본 미실행)
- 커서 모드에서 `take: limit + 1`로 hasNextPage 판단 — 추가 count 쿼리 불필요
- `sortableColumns`, `filterableColumns` 화이트리스트로 임의 컬럼 접근 차단 → SQL injection 방지 및 인덱스 활용 보장
- 대규모 데이터셋 (100K+ rows): 커서 기반 권장. 오프셋은 `skip` 값이 클수록 성능 저하
- `totalItems` 카운트가 비싼 경우: 커서 모드 + `withTotalCount: false` 조합 사용
- Prisma `include`(relations)는 N+1 문제 없음 — Prisma가 자동 배치

## Security

- **컬럼 화이트리스트**: `sortableColumns`, `filterableColumns`로 접근 가능 컬럼 명시적 제한
- **연산자 화이트리스트**: 컬럼별 허용 연산자 지정 → 의도하지 않은 필터링 차단
- **SQL injection 방지**: Prisma 파라미터 바인딩 사용. 쿼리 파라미터를 Prisma where 객체로 변환하므로 직접 SQL 생성 없음
- **커서 조작 방지**: Base64url 디코딩 시 형식 검증. 잘못된 커서는 `InvalidCursorError`
- **maxLimit 강제**: 클라이언트가 과도한 limit을 요청해도 maxLimit으로 제한
- **테넌트 격리**: tenancy RLS 적용 시 다른 테넌트 데이터 접근 불가 (pagination 레이어에서 별도 처리 불필요)

## Testing Utilities

### TestPaginationModule

```typescript
const module = await Test.createTestingModule({
  imports: [TestPaginationModule.register({ defaultLimit: 10 })],
  providers: [UserService],
}).compile();
```

### createPaginateQuery Helper

```typescript
import { createPaginateQuery } from '@nestarc/pagination/testing';

// 테스트용 PaginateQuery 팩토리
const query = createPaginateQuery({
  page: 1,
  limit: 10,
  sortBy: [['createdAt', 'DESC']],
  filter: { role: '$eq:admin' },
  search: 'john',
  path: '/users',
});

const result = await userService.findAll(query);
expect(result.data).toHaveLength(10);
expect(result.meta.totalItems).toBe(42);
```

## Standalone Usage (without NestJS)

NestJS 모듈 없이 `paginate()` 함수만 독립 사용 가능:

```typescript
import { paginate, PaginateQuery, PaginateConfig } from '@nestarc/pagination';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const query: PaginateQuery = {
  page: 1,
  limit: 20,
  sortBy: [['createdAt', 'DESC']],
  path: '/users',
};

const config: PaginateConfig<any> = {
  sortableColumns: ['id', 'name', 'createdAt'],
};

const result = await paginate(query, prisma.user, config);
```

## Out of Scope (v0.1.0)

- GraphQL relay-style pagination (`Connection`, `Edge`, `PageInfo`) → v0.2.0
- Full-text search with PostgreSQL `tsvector`/`tsquery` (현재는 `ILIKE` 기반) → v0.2.0
- 자동 인덱스 추천 (쿼리 패턴 기반) → v0.3.0
- 캐시 레이어 (동일 쿼리 결과 캐싱) → v0.3.0
- Aggregation/groupBy 페이지네이션 → out of scope
- MongoDB/MySQL 지원 → out of scope (PostgreSQL 전용)
- 관리자 UI → out of scope

## Package Metadata

```json
{
  "name": "@nestarc/pagination",
  "version": "0.1.0",
  "description": "Prisma cursor/offset pagination for NestJS with filtering, sorting, search, and Swagger auto-documentation",
  "peerDependencies": {
    "@nestjs/common": "^10.0.0 || ^11.0.0",
    "@nestjs/core": "^10.0.0 || ^11.0.0",
    "@prisma/client": "^5.0.0 || ^6.0.0",
    "reflect-metadata": "^0.1.13 || ^0.2.0",
    "rxjs": "^7.0.0"
  },
  "peerDependenciesMeta": {
    "@nestarc/tenancy": { "optional": true },
    "@nestarc/soft-delete": { "optional": true },
    "@nestjs/swagger": { "optional": true }
  },
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    },
    "./testing": {
      "types": "./dist/testing/index.d.ts",
      "default": "./dist/testing/index.js"
    }
  }
}
```

## Exported API (index.ts)

```typescript
// Core Module
export { PaginationModule } from './pagination.module';
export { PaginationModuleOptions, PaginationModuleAsyncOptions } from './interfaces/pagination-options.interface';

// Core Function
export { paginate } from './paginate';

// Interfaces
export { PaginateQuery } from './interfaces/paginate-query.interface';
export { PaginateConfig } from './interfaces/paginate-config.interface';
export { Paginated, CursorPaginated } from './interfaces/paginated.interface';
export { FilterOperator, SortOrder } from './interfaces/filter-operator.type';

// Decorators
export { Paginate } from './decorators/paginate.decorator';
export { PaginateDefaults } from './decorators/paginate-defaults.decorator';
export { ApiPaginatedResponse } from './decorators/api-paginated-response.decorator';
export { ApiCursorPaginatedResponse } from './decorators/api-paginated-response.decorator';

// Errors
export { InvalidSortColumnError } from './errors/invalid-sort-column.error';
export { InvalidFilterColumnError } from './errors/invalid-filter-column.error';
export { InvalidCursorError } from './errors/invalid-cursor.error';

// Constants
export { PAGINATION_MODULE_OPTIONS } from './pagination.constants';
```

## Success Criteria

- `npm run build` 통과
- 유닛 테스트: 90%+ 커버리지
- E2E 테스트: 실제 PostgreSQL에서 오프셋/커서 페이지네이션, 필터링, 정렬, 검색 검증
- `@nestarc/tenancy` 미설치 상태에서도 정상 동작
- `@nestarc/soft-delete` 미설치 상태에서도 정상 동작
- `@nestjs/swagger` 미설치 시 Swagger 데코레이터 무시 (런타임 에러 없음)
- `paginate()` 함수 NestJS 없이 독립 사용 가능
- README: Quick Start 5분 이내 완료 가능
- `nestjs-paginate`에서 마이그레이션 시 쿼리 파라미터 형식 호환
