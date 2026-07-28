package com.ssafy.yorr.room.controller;

import com.ssafy.yorr.handler.GameWebSocketHandler;
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
            // 시작을 누른 호스트는 이 HTTP 응답으로 게임 화면에 들어가지만, 나머지 참가자는 소켓으로만 알 수 있다.
            // 여기서 방송하지 않으면 참가자는 대기실에 그대로 남는다.
            registry.markPhase(roomCode, RoomPhase.PLAYING);
            gameWebSocketHandler.broadcastStateSync(roomCode);
            return ResponseEntity.ok(result);
        } catch (IllegalStateException e) {
            return ResponseEntity.status(409).body(e.getMessage());
        }
    }
}
