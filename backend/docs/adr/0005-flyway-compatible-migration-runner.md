# ADR-0005: 마이그레이션은 Flyway 이력 테이블 위에서 자체 러너로 돌린다

- 상태: accepted
- 날짜: 2026-08-14

## 맥락

운영 MySQL의 스키마는 Flyway로 만들어졌고(`V1__create_user_tables.sql`,
`V2__create_match_tables.sql`), 적용 이력이 `flyway_schema_history` 테이블에
그 형식으로 남아 있다. baseline은 **0**이다(1이면 V1이 "이미 적용됨"으로
오인돼 조용히 유실된다).

제약은 이렇다:

- **기존 이력을 버릴 수 없다.** 이미 적용된 V1·V2의 체크섬이 그 테이블에 적혀
  있으므로, 도구를 바꾸든 말든 **그 형식 위에서 돌아야** 한다. 다시 적용하려
  들면 운영 스키마가 깨진다.
- 서버는 **자기가 붙은 DB가 기대한 스키마인지 알아야** 한다. 마이그레이션 안 된
  DB를 가리킨 채 뜨면 첫 로그인·첫 전적 보관에서야 터진다.
- 로컬 개발자와 통합 테스트는 **빈 DB에서 스키마를 세울 수** 있어야 한다
  (계정·전적·랭킹 테스트가 진짜 테이블 위에서 돈다).

## 결정

**`flyway_schema_history`를 그대로 읽고 쓰는 자체 러너를 만든다**
(`src/infra/migrations/`). 새 npm 의존성은 없다.

- **SQL은 `backend/db/migration/`에 둔다.** 이미 적용된 V1·V2는 **한 글자도
  고치지 않는다** — 체크섬이 내용에서 나오고 그 값이 운영 이력에 이미 적혀 있다.
  값을 고정한 테스트가 있다.
- **체크섬은 Flyway의 계산을 그대로 재현한다**(`checksum.ts`): 줄 종결자를 뺀 각
  줄의 UTF-8 바이트에 대한 CRC32를 signed int로 자른 값. 줄 종결자 종류·파일 끝
  개행·BOM에 영향받지 않는다는 성질까지 테스트로 고정했다.
- **판정은 순수 함수 하나에 모았다**(`planMigrations`). 파일 목록 + 이력 행 →
  `applied` / `pending` / `belowBaseline` / `missingLocally` /
  `checksumMismatches` / `failed`. 버전 비교는 Flyway와 같이 숫자 단위이고
  `1`과 `1.0`은 같은 버전이다. **MySQL 없이 도는 테스트가 여기를 덮는다.**
- **두 개의 진입점으로 적용과 기동을 가른다.**
  - `verifyMigrations(pool)` — **읽기 전용**. 이력 테이블조차 만들지 않는다.
    적용되지 않은 마이그레이션이나 실패한 이력 행이 있으면 던진다. 서버 기동이
    쓰는 것은 이쪽이다.
  - `runMigrations(pool)` — 밀린 것을 실제로 적용한다. 배포의 `migrate` 잡과
    빈 개발 DB·통합 테스트가 쓴다. 이 구분이 "기동은 스키마를 바꾸지 않는다"를
    관례가 아니라 코드로 만든다.
- **체크섬 불일치는 기본적으로 보고만 한다**(`validateChecksums: true`로 승격).
  계산이 어긋났다는 이유로 **운영 부팅이 막히면** 안 된다. 파이프라인·테스트에서는
  켜서 드리프트를 잡는다.
- **문장 분리는 우리가 한다**(`statements.ts`). mysql2의 `multipleStatements`는
  커넥션 전체의 성질이라, 마이그레이션 한 곳을 위해 애플리케이션 풀 전체에
  인젝션 피해 범위를 넓히게 된다. `DELIMITER`는 지원하지 않고 던진다.
- **통합 테스트는 "있으면 돌고 없으면 skip"**(`__tests__/mysqlHarness.ts`).
  `MYSQL_TEST_URL`이 있으면 그 서버에 테스트마다 `yorr_test_<random>` 스키마를
  만들고 끝나면 DROP한다(URL의 데이터베이스 부분은 **쓰지 않는다** — 실수로
  개발 스키마를 지우지 않기 위해서다). 없으면 건너뛰되 `MYSQL_TEST_REQUIRED=1`
  이면 실패한다 — ADR-0004의 `REDIS_TEST_REQUIRED`와 같은 스위치다.

## 검토한 대안

- **Flyway CLI/`node-flyway`를 그대로 쓴다.** 이력 호환은 정의상 완벽하다. 하지만
  JRE와 Flyway 배포본이 런타임 이미지에 들어와야 한다 — "JVM을 걷어낸다"는
  Node 이미지에 JVM을 다시 들이게 된다.
  마이그레이션 도구 하나 때문에 치를 값이 아니다.
- **Prisma Migrate / Drizzle Kit.** 둘 다 자기 이력 테이블(`_prisma_migrations`
  등)을 쓴다. 기존 `flyway_schema_history`를 인식하지 못하므로 V1·V2를 "적용되지
  않음"으로 보고 다시 적용하려 든다. 이력을 손으로 이식하는 우회로가 있지만, 그
  순간부터 **두 이력이 따로 굴러간다**. 게다가 둘 다
  ORM/스키마 DSL을 함께 들여오는데 ADR-0003은 ORM을 기각했다.
- **`db-migrate` · `umzug` · `node-pg-migrate` 류 범용 러너.** 가볍고 raw SQL을
  쓸 수 있지만 이력 테이블 스키마가 각자 다르다(대개 `migrations(name, run_on)`).
  `flyway_schema_history` 모양으로 맞추려면 결국 커스텀 스토리지를 써야 하고,
  그러면 우리가 만들 코드의 대부분을 그대로 쓰면서 의존성만 하나 늘어난다.
  Flyway 버전 비교·baseline 규칙·체크섬은 어차피 우리가 구현해야 한다.
- **마이그레이션을 저장소 밖(운영 절차)에 둔다.** 스키마를 세울 방법이 저장소에
  없어지고, 빈 DB로 도는 통합 테스트를 만들 수 없다.
- **테스트가 `mysqld`를 직접 띄운다**(ADR-0004의 Redis 방식). Redis는
  `redis-server` 한 줄이면 뜨지만 MySQL은 데이터 디렉터리 초기화(`--initialize`)가
  선행돼야 하고 mysql/mariadb 배포판마다 다르다. 게다가 여기서 검증하는 것은
  Lua 같은 미묘한 시맨틱이 아니라 "SQL이 돌고 이력 행이 남는가"라 실행 비용에
  비해 얻는 것이 작다. `MYSQL_TEST_URL`(compose의 mysql 컨테이너)로 충분하다.

## 결과

- **스키마의 주인은 이 저장소다.** 새 마이그레이션은 V3부터 `backend/db/migration/`
  에 추가한다. 이미 적용된 V1·V2만 손대지 않으면 된다.
- **적용과 기동은 갈라 둔다.** 마이그레이션을 추가한 배포는 `migrate` 잡을 먼저
  돌려야 한다 — 그러지 않으면 새 이미지가 `verifyMigrations`에서 죽는다. 기동이
  스키마를 바꾸면 "부팅했더니 스키마가 바뀌어 있었다"가 되고, 롤백한 이미지가
  앞서 나간 스키마를 만나게 된다.
- `plan.missingLocally`(이력에는 있는데 파일이 없음)는 던지지 않는다. DB가
  우리보다 앞서 나간 상태이고 남는 테이블이 질의를 깨뜨리지는 않는다 — 호출부가
  경고 로그를 남긴다.
- MySQL의 DDL은 암묵 커밋이라 마이그레이션을 트랜잭션으로 되돌릴 수 없다.
  Flyway와 같이 **실패한 마이그레이션도 `success = 0`으로 이력에 남기고** 던진다
  (반쯤 적용된 스키마가 이력에서 안 보이는 것이 가장 나쁜 상태다). 복구는 사람이
  스키마를 확인하고 그 행을 지우는 것이다.
- 테스트 전용 환경변수 `MYSQL_TEST_URL` · `MYSQL_TEST_REQUIRED`가 생겼다
  (operations.md의 테스트 변수 표에 `REDIS_TEST_*`와 나란히 기재해야 한다).
  파이프라인에 `npm test`를 넣을 때(Phase 5) mysql 서비스와 함께 켠다.
