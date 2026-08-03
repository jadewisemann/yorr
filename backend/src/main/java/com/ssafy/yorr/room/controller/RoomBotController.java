package com.ssafy.yorr.room.controller;

import com.ssafy.yorr.room.dto.BotRequest;
import com.ssafy.yorr.room.dto.RoomSnapshot;
import com.ssafy.yorr.room.service.BotParticipantService;
import com.ssafy.yorr.user.UserIdentity;
import com.ssafy.yorr.user.service.UserService;
import com.ssafy.yorr.ws.RealtimeRoomSnapshotService;
import com.ssafy.yorr.ws.RoomBroadcaster;
import com.ssafy.yorr.ws.dto.StateSyncPayload;
import com.ssafy.yorr.ws.dto.WsEnvelope;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.function.Function;

@RestController
@RequestMapping("/api/v1/rooms/{roomCode}/bots")
@CrossOrigin("*")
@RequiredArgsConstructor
@Tag(name = "Room Bot", description = "대기실 AI 봇 참가자 관리 API")
public class RoomBotController {

    private final BotParticipantService bots;
    private final UserService users;
    private final RealtimeRoomSnapshotService realtimeSnapshots;
    private final RoomBroadcaster broadcaster;

    @PostMapping
    @Operation(summary = "대기실에 봇 추가")
    public ResponseEntity<?> add(
            @PathVariable String roomCode,
            @RequestHeader("X-User-Id") String userId,
            @RequestHeader("Authorization") String authorization,
            @RequestBody BotRequest request
    ) {
        return mutate(roomCode, userId, authorization,
                requester -> bots.add(roomCode, requester.userId(), request == null ? null : request.difficulty()));
    }

    @PatchMapping("/{botId}")
    @Operation(summary = "대기실 봇 난이도 변경")
    public ResponseEntity<?> update(
            @PathVariable String roomCode,
            @PathVariable String botId,
            @RequestHeader("X-User-Id") String userId,
            @RequestHeader("Authorization") String authorization,
            @RequestBody BotRequest request
    ) {
        return mutate(roomCode, userId, authorization,
                requester -> bots.update(
                        roomCode,
                        requester.userId(),
                        botId,
                        request == null ? null : request.difficulty()
                ));
    }

    @DeleteMapping("/{botId}")
    @Operation(summary = "대기실 봇 삭제")
    public ResponseEntity<?> remove(
            @PathVariable String roomCode,
            @PathVariable String botId,
            @RequestHeader("X-User-Id") String userId,
            @RequestHeader("Authorization") String authorization
    ) {
        return mutate(roomCode, userId, authorization,
                requester -> bots.remove(roomCode, requester.userId(), botId));
    }

    private ResponseEntity<?> mutate(
            String roomCode,
            String userId,
            String authorization,
            Function<UserIdentity, RoomSnapshot> operation
    ) {
        UserIdentity requester;
        try {
            requester = users.authenticate(userId, authorization);
        } catch (IllegalArgumentException exception) {
            return ResponseEntity.status(401).body(exception.getMessage());
        }

        try {
            RoomSnapshot snapshot = operation.apply(requester);
            broadcaster.broadcast(roomCode, WsEnvelope.of(
                    "state.sync",
                    new StateSyncPayload(realtimeSnapshots.snapshot(roomCode))
            ).withRoomId(roomCode));
            return ResponseEntity.ok(snapshot);
        } catch (SecurityException exception) {
            return ResponseEntity.status(403).body(exception.getMessage());
        } catch (IllegalArgumentException exception) {
            int status = "room_not_found".equals(exception.getMessage()) ? 404 : 400;
            return ResponseEntity.status(status).body(exception.getMessage());
        } catch (IllegalStateException exception) {
            int status = "bot_not_found".equals(exception.getMessage()) ? 404 : 409;
            return ResponseEntity.status(status).body(exception.getMessage());
        }
    }
}
