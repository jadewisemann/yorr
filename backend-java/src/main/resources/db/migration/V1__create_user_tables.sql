-- 회원과 소셜 계정. 소셜 로그인(카카오·구글)의 기반 스키마다.
--
-- 게스트는 여기 들어오지 않는다 — Redis의 user:{id}(24h sliding TTL)에만 존재한다.
-- 영구히 남길 것이 있는 사용자만 회원이 되고, 그 경계가 곧 로그인할 이유가 된다.
--
-- id를 VARCHAR(36) UUID로 두는 이유: 기존 게스트 userId가 UUID 문자열이고
-- X-User-Id 헤더 · Redis 키 · 방 참가자 명단이 전부 그 값을 그대로 쓴다. 회원 식별자를
-- 같은 형태로 맞추면 두 정체성 사이에 변환 계층이 필요 없다.
CREATE TABLE users
(
    id                VARCHAR(36)  NOT NULL,
    nickname          VARCHAR(20)  NOT NULL,
    profile_image_url VARCHAR(500) NULL,
    created_at        DATETIME(6)  NOT NULL,
    updated_at        DATETIME(6)  NOT NULL,
    PRIMARY KEY (id)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4;

-- 한 회원이 카카오와 구글을 함께 연결할 수 있으므로 1:N으로 분리한다.
-- users에 kakao_id 같은 컬럼을 박으면 provider가 늘 때마다 스키마를 갈아엎어야 한다.
--
-- 이메일 컬럼은 두지 않았다: 카카오 이메일 동의항목은 비즈앱 전환과 검수가 필요해서
-- 항상 받을 수 있다고 가정할 수 없다. 필요해지는 시점에 별도 마이그레이션으로 추가한다.
CREATE TABLE social_accounts
(
    id               BIGINT      NOT NULL AUTO_INCREMENT,
    user_id          VARCHAR(36) NOT NULL,
    provider         VARCHAR(20) NOT NULL,
    provider_user_id VARCHAR(64) NOT NULL,
    created_at       DATETIME(6) NOT NULL,
    PRIMARY KEY (id),
    -- 같은 소셜 계정으로 두 번 가입되는 것을 DB가 막는다(로그인 조회 인덱스도 겸한다).
    -- 애플리케이션의 "있으면 로그인, 없으면 가입" 분기는 동시 요청에서 깨질 수 있으므로
    -- 최종 방어선은 여기에 둔다.
    UNIQUE KEY uk_social_accounts_provider_user (provider, provider_user_id),
    KEY idx_social_accounts_user (user_id),
    CONSTRAINT fk_social_accounts_user FOREIGN KEY (user_id) REFERENCES users (id)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4;
