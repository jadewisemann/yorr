package com.ssafy.yorr.game.match.application;

import com.ssafy.yorr.game.match.domain.Match;
import com.ssafy.yorr.game.match.domain.MatchParticipant;
import com.ssafy.yorr.game.match.repository.MatchRepository;
import com.ssafy.yorr.room.dto.RoomPlayerSnapshot;
import com.ssafy.yorr.room.dto.RoomSnapshot;
import com.ssafy.yorr.user.domain.User;
import com.ssafy.yorr.user.repository.UserRepository;
import com.ssafy.yorr.ws.dto.GameOverPayload;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import java.util.function.Function;

/**
 * 끝난 판을 DB에 남긴다. 여기까지 오지 않으면 결과는 Redis와 함께 40분 만에 사라진다.
 * <p>
 * <b>회원 판별을 Redis 세션이 아니라 users 테이블로 한다.</b> 세션은 만료·재시작으로 사라질
 * 수 있는데, 판이 끝나는 시점에 세션이 없다는 이유로 회원의 전적을 게스트로 남기면 그 기록은
 * 영영 주인을 잃는다.
 */
@Service
public class MatchArchiveService {

    private static final Logger log = LoggerFactory.getLogger(MatchArchiveService.class);

    private final MatchRepository matches;
    private final UserRepository users;
    private final Clock clock;

    @org.springframework.beans.factory.annotation.Autowired
    public MatchArchiveService(MatchRepository matches, UserRepository users) {
        // finished_at은 UTC 벽시계로 저장한다. systemDefaultZone()이면 JVM 존에 따라 같은 코드가
        // 다른 값을 쓴다 — 배포 컨테이너는 UTC, 개발자 PC는 KST라 9시간 어긋난 행이 섞인다.
        // 기간으로 자르는 집계(주간 랭킹)는 그 어긋남을 복원할 방법이 없다. 이 서비스만 예외였고
        // RoundTimerService·RoundTimeoutResolver는 이미 systemUTC()를 쓴다.
        this(matches, users, Clock.systemUTC());
    }

    MatchArchiveService(MatchRepository matches, UserRepository users, Clock clock) {
        this.matches = matches;
        this.users = users;
        this.clock = clock;
    }

    /**
     * @param room     끝난 게임의 방 스냅샷. 닉네임은 여기서 가져온다 — 순위 payload에는 점수만 있다.
     * @param rankings 서버가 확정한 최종 순위
     * @return 이 호출이 실제로 저장했는지. 이미 저장된 판이면 false.
     */
    @Transactional
    public boolean archive(RoomSnapshot room, List<GameOverPayload.Ranking> rankings) {
        if (room == null || room.gameId() == null || room.gameId().isBlank()) return false;
        if (rankings == null || rankings.isEmpty()) return false;
        if (matches.existsByGameId(room.gameId())) return false;

        Map<String, String> nicknames = room.players().stream().collect(java.util.stream.Collectors.toMap(
                RoomPlayerSnapshot::playerId, RoomPlayerSnapshot::nickname, (first, second) -> first));

        Match match = Match.finished(room.gameId(), room.gameCode(), room.roomCode(),
                LocalDateTime.now(clock));
        for (GameOverPayload.Ranking ranking : rankings) {
            User user = users.findById(ranking.playerId()).orElse(null);
            String nickname = nicknames.getOrDefault(ranking.playerId(),
                    user == null ? ranking.playerId() : user.getNickname());
            match.add(MatchParticipant.of(user, ranking.playerId(), trim(nickname),
                    ranking.total(), ranking.rank()));
        }

        try {
            matches.save(match);
        } catch (DataIntegrityViolationException race) {
            // 종료가 동시에 두 번 처리됐다. UNIQUE가 막았으니 먼저 저장한 쪽을 그대로 둔다.
            log.info("이미 저장된 판입니다: game={}", room.gameId());
            return false;
        }
        log.info("게임 결과를 저장했습니다: game={} room={} players={}",
                room.gameId(), room.roomCode(), match.getPlayerCount());
        return true;
    }

    /** display_nickname은 20자다. 그때 보였던 이름을 남기는 게 목적이라 잘라서라도 남긴다. */
    private static String trim(String nickname) {
        if (nickname == null || nickname.isBlank()) return "플레이어";
        return nickname.length() > 20 ? nickname.substring(0, 20) : nickname;
    }
}
