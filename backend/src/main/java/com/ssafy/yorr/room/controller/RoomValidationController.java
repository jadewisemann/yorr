package com.ssafy.yorr.room.controller;

import com.ssafy.yorr.handler.GameWebSocketHandler;
import com.ssafy.yorr.game.round.application.RoundSynchronizationService;
import com.ssafy.yorr.game.round.application.RoundTimerService;
import com.ssafy.yorr.game.round.domain.RoundState;
import com.ssafy.yorr.room.dto.GameStartResponse;
import com.ssafy.yorr.room.dto.RoomSnapshot;
import com.ssafy.yorr.room.service.RoomValidationService;
import com.ssafy.yorr.user.UserIdentity;
import com.ssafy.yorr.user.service.UserService;
import com.ssafy.yorr.ws.RoomSessionRegistry;
import com.ssafy.yorr.ws.dto.RoomPhase;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Comparator;

@RestController
@RequestMapping("/api/v1/rooms")
@CrossOrigin("*")
@RequiredArgsConstructor
@Tag(name = "Room", description = "방 참가, 퇴장 및 게임 시작 API")
public class RoomValidationController {

    private final RoomValidationService roomService;
    private final UserService userService;
    private final RoomSessionRegistry registry;
    private final GameWebSocketHandler gameWebSocketHandler;
    private final RoundSynchronizationService roundSynchronizationService;
    private final RoundTimerService roundTimerService;

    @DeleteMapping("/{roomCode}/players/me")
    @Operation(summary = "방 나가기")
    public ResponseEntity<?> leaveRoom(@PathVariable String roomCode, @RequestHeader("X-User-Id") String userId,
                                       @RequestHeader("Authorization") String authorization) {
        UserIdentity user;
        try {
            user = userService.authenticate(userId, authorization);
        } catch (IllegalArgumentException e) {
            return ResponseEntity.status(401).body(e.getMessage());
        }
        if (!roomService.leave(roomCode, user.userId())) return ResponseEntity.notFound().build();
        userService.clearRoom(user.userId());
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/{roomCode}/games")
    @Operation(summary = "게임 시작", description = "현재 방에 입장한 host만 시작할 수 있습니다.")
    public ResponseEntity<?> startGame(@PathVariable String roomCode, @RequestHeader("X-User-Id") String userId,
                                       @RequestHeader("Authorization") String authorization) {
        UserIdentity user;
        try {
            user = userService.authenticate(userId, authorization);
        } catch (IllegalArgumentException e) {
            return ResponseEntity.status(401).body(e.getMessage());
        }
        RoomSnapshot snapshot = roomService.getSnapshot(roomCode);
        if (snapshot.phase() == null) return ResponseEntity.notFound().build();
        if (!user.userId().equals(snapshot.hostId())
                || snapshot.players().stream().noneMatch(player -> user.userId().equals(player.playerId()))) {
            return ResponseEntity.status(403).body("host_only");
        }
        try {
            GameStartResponse result = roomService.startGame(roomCode);
            // START(Lua)가 phase=LOBBY만 통과시키므로 여기 왔다면 진행 중인 게임은 없다.
            // 지난 게임의 라운드 상태가 남아 있으면 initialize가 거부되므로 먼저 버린다(재대결 경로).
            roundSynchronizationService.remove(roomCode);
            RoundState firstTurn = roundSynchronizationService.initialize(
                    roomCode,
                    1,
                    result.snapshot().players().stream()
                            .sorted(Comparator.comparing(
                                    player -> !player.playerId().equals(result.snapshot().hostId())
                            ))
                            .map(player -> player.playerId())
                            .toList()
            );
            // 시작을 누른 호스트는 이 HTTP 응답으로 게임 화면에 들어가지만, 나머지 참가자는 소켓으로만 알 수 있다.
            // 여기서 방송하지 않으면 참가자는 대기실에 그대로 남는다.
            registry.markPhase(roomCode, RoomPhase.PLAYING);
            gameWebSocketHandler.broadcastStateSync(roomCode);
            roundTimerService.start(roomCode, firstTurn);
            return ResponseEntity.ok(result);
        } catch (IllegalStateException e) {
            return ResponseEntity.status(409).body(e.getMessage());
        }
    }

    /**
     * 끝난 게임을 대기실로 되돌린다. 결과 화면에서 호스트가 누르면 방 전원이 대기실로 이동한다.
     * <p>
     * 방 전체가 한 번에 옮겨가는 이유: 화면 전환이 phase(스냅샷) 기준이라 한 명만 대기실로 보낼 수 없다.
     * 되돌린 뒤에는 게임 시작 조건(phase=LOBBY)이 다시 성립해 같은 멤버로 새 게임을 시작할 수 있다.
     */
    @PostMapping("/{roomCode}/lobby")
    @Operation(summary = "대기실로 돌아가기", description = "종료된 게임에서 host만 호출할 수 있습니다.")
    public ResponseEntity<?> returnToLobby(@PathVariable String roomCode, @RequestHeader("X-User-Id") String userId,
                                          @RequestHeader("Authorization") String authorization) {
        UserIdentity user;
        try {
            user = userService.authenticate(userId, authorization);
        } catch (IllegalArgumentException e) {
            return ResponseEntity.status(401).body(e.getMessage());
        }
        RoomSnapshot snapshot = roomService.getSnapshot(roomCode);
        if (snapshot.phase() == null) return ResponseEntity.notFound().build();
        if (!user.userId().equals(snapshot.hostId())
                || snapshot.players().stream().noneMatch(player -> user.userId().equals(player.playerId()))) {
            return ResponseEntity.status(403).body("host_only");
        }

        // 저장소 전이가 권위다. 여기서 막히면(진행 중이거나 이미 대기실) 아무것도 건드리지 않는다.
        if (!roomService.returnToLobby(roomCode)) {
            return ResponseEntity.status(409).body("not_finished");
        }
        roundTimerService.cancelRoom(roomCode);
        roundSynchronizationService.remove(roomCode);
        registry.markPhase(roomCode, RoomPhase.WAITING);
        gameWebSocketHandler.broadcastStateSync(roomCode);
        return ResponseEntity.noContent().build();
    }
}
