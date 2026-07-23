package com.ssafy.yorr.room.controller;

import com.ssafy.yorr.room.service.RoomValidationService;
import com.ssafy.yorr.room.dto.RoomStatusDTO;
import com.ssafy.yorr.room.dto.RoomJoinResponse;
import com.ssafy.yorr.user.UserIdentity;
import com.ssafy.yorr.user.service.UserService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.AllArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.PostMapping;

@RestController
@RequestMapping("/api/v1/rooms")
@CrossOrigin("*")
@AllArgsConstructor
@Tag(name = "Game Room", description = "게임 방 상태와 시작 API")
public class RoomValidationController {

    private final RoomValidationService roomValidationService;
    private final UserService userService;

    @GetMapping("/{roomCode}")
    @Operation(summary = "방 상태 조회")
    public ResponseEntity<RoomStatusDTO> isRoomValid(@PathVariable String roomCode) {
        return ResponseEntity.ok(roomValidationService.getStatus(roomCode));
    }

    @PostMapping("/{roomCode}/players")
    @Operation(summary = "방 입장", description = "응답의 playerId를 저장해 재입장과 퇴장에 사용합니다.")
    public ResponseEntity<?> joinRoom(@PathVariable String roomCode,
                                      @RequestHeader("X-User-Id") String userId,
                                      @RequestHeader("Authorization") String authorization) {
        UserIdentity user;
        try {
            user = userService.authenticate(userId, authorization);
        } catch (IllegalArgumentException e) {
            return ResponseEntity.status(401).body(e.getMessage());
        }

        long result = roomValidationService.joinRoom(roomCode, user.userId());
        if (result == 1 || result == 4) {
            RoomStatusDTO status = roomValidationService.getStatus(roomCode);
            return ResponseEntity.ok(new RoomJoinResponse(user.userId(), status.members(), status.capacity(), result == 4));
        }
        return switch ((int) result) {
            case 2 -> ResponseEntity.status(409).body("game_started");
            case 3 -> ResponseEntity.status(409).body("room_full");
            default -> ResponseEntity.notFound().build();
        };
    }

    @DeleteMapping("/{roomId}/players/me")
    @Operation(summary = "방 퇴장")
    public ResponseEntity<?> leaveRoom(@PathVariable String roomId, @RequestHeader("X-User-Id") String userId,
                                       @RequestHeader("Authorization") String authorization) {
        UserIdentity user;
        try {
            user = userService.authenticate(userId, authorization);
        } catch (IllegalArgumentException e) {
            return ResponseEntity.status(401).body(e.getMessage());
        }
        return roomValidationService.leaveRoom(roomId, user.userId()) >= 0
                ? ResponseEntity.noContent().build()
                : ResponseEntity.notFound().build();
    }

    @GetMapping("/{roomId}/lobby")
    @Operation(summary = "대기실 상태 조회")
    public ResponseEntity<RoomStatusDTO> getLobby(@PathVariable String roomId) {
        return ResponseEntity.ok(roomValidationService.getStatus(roomId));
    }

    @PostMapping("/{roomId}/games")
    @Operation(summary = "게임 시작", description = "방이 가득 찬 경우에만 시작 상태로 변경합니다.")
    public ResponseEntity<Void> startGame(@PathVariable String roomId) {
        if (!roomValidationService.startGame(roomId)) return ResponseEntity.status(409).build();
        return ResponseEntity.ok().build();
    }
}
