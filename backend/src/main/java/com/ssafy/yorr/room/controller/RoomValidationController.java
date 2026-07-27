package com.ssafy.yorr.room.controller;

import com.ssafy.yorr.room.dto.GameStartResponse;
import com.ssafy.yorr.room.dto.JoinResult;
import com.ssafy.yorr.room.dto.RoomSnapshot;
import com.ssafy.yorr.room.service.RoomValidationService;
import com.ssafy.yorr.user.UserIdentity;
import com.ssafy.yorr.user.service.UserService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/rooms")
@CrossOrigin("*")
@RequiredArgsConstructor
@Tag(name = "Room", description = "방 생성 및 대기실 API")
public class RoomValidationController {

    private final RoomValidationService roomService;
    private final UserService userService;

    @GetMapping("/{roomCode}")
    @Operation(summary = "방 조회")
    public RoomSnapshot getRoom(@PathVariable String roomCode) {
        return roomService.getSnapshot(roomCode);
    }

    @GetMapping("/{roomCode}/lobby")
    @Operation(summary = "대기실 상태 조회")
    public RoomSnapshot getLobby(@PathVariable String roomCode) {
        return roomService.getSnapshot(roomCode);
    }

    @PostMapping("/{roomCode}/players")
    @Operation(summary = "방 참가")
    public ResponseEntity<?> joinRoom(@PathVariable String roomCode, @RequestHeader("X-User-Id") String userId,
                                      @RequestHeader("Authorization") String authorization) {
        UserIdentity user;
        try {
            user = userService.authenticate(userId, authorization);
        } catch (IllegalArgumentException e) {
            return ResponseEntity.status(401).body(e.getMessage());
        }
        try {
            String sessionToken = authorization.substring("Bearer ".length());
            JoinResult result = roomService.join(roomCode, user, sessionToken);
            return ResponseEntity.ok(result);
        } catch (IllegalArgumentException e) {
            return ResponseEntity.notFound().build();
        } catch (IllegalStateException e) {
            return ResponseEntity.status(409).body(e.getMessage());
        }
    }

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
        return roomService.leave(roomCode, user.userId()) ? ResponseEntity.noContent().build() : ResponseEntity.notFound().build();
    }

    @PostMapping("/{roomCode}/games")
    @Operation(summary = "게임 시작")
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
        if (!user.userId().equals(snapshot.hostId())) return ResponseEntity.status(403).body("host_only");
        try {
            GameStartResponse result = roomService.startGame(roomCode);
            return ResponseEntity.ok(result);
        } catch (IllegalStateException e) {
            return ResponseEntity.status(409).body(e.getMessage());
        }
    }
}
