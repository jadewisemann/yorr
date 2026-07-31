-- 끝난 게임의 결과. 지금까지 결과는 Redis에만 있었고 방과 함께 40분 만에 사라졌다 —
-- 랭킹(150)도 전적(151)도 남길 데이터 자체가 없었다.
--
-- game_id에 UNIQUE를 거는 게 핵심이다. 게임 종료 방송이 두 번 일어나거나 적재가 재시도돼도
-- 같은 판이 두 번 쌓이지 않는다. 애플리케이션의 "이미 저장했나" 검사는 동시 호출에서 깨지므로
-- 최종 방어선은 DB에 둔다.
CREATE TABLE matches
(
    id           BIGINT      NOT NULL AUTO_INCREMENT,
    game_id      VARCHAR(64) NOT NULL,
    game_code    VARCHAR(32) NOT NULL,
    room_code    VARCHAR(12) NOT NULL,
    player_count INT         NOT NULL,
    finished_at  DATETIME(6) NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uk_matches_game (game_id),
    -- 랭킹 집계가 기간으로 자르므로(시즌은 나중에 얹는다) 시각에 인덱스를 둔다.
    KEY idx_matches_finished_at (finished_at)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4;

-- 참가자별 결과.
--
-- user_id가 nullable인 이유: 같은 판에 게스트가 섞여 있고, 그들에게는 계정이 없다. 그래도
-- 판 자체는 온전히 남아야 하므로(몇 명이서 몇 점에 이겼는지) 행은 만들고 주인만 비운다.
-- 랭킹 집계는 user_id IS NOT NULL만 세면 된다 — 그 경계가 곧 로그인할 이유가 된다.
--
-- display_nickname을 따로 저장하는 이유: 그때 그 화면에 보였던 이름이어야 한다. 회원이
-- 나중에 프로필 닉네임을 바꾸거나 탈퇴해도 지난 판의 기록이 흔들리면 안 된다.
CREATE TABLE match_participants
(
    id               BIGINT      NOT NULL AUTO_INCREMENT,
    match_id         BIGINT      NOT NULL,
    user_id          VARCHAR(36) NULL,
    player_id        VARCHAR(64) NOT NULL,
    display_nickname VARCHAR(20) NOT NULL,
    total_score      INT         NOT NULL,
    ranking          INT         NOT NULL,
    PRIMARY KEY (id),
    KEY idx_match_participants_match (match_id),
    KEY idx_match_participants_user (user_id),
    CONSTRAINT fk_match_participants_match FOREIGN KEY (match_id) REFERENCES matches (id),
    CONSTRAINT fk_match_participants_user FOREIGN KEY (user_id) REFERENCES users (id)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4;
