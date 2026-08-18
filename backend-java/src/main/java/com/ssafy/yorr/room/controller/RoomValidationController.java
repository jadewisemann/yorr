package com.ssafy.yorr.room.controller;

import com.ssafy.yorr.game.module.GameLifecycleService;
import com.ssafy.yorr.room.dto.GameStartResponse;
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
    private final GameLifecycleService games;

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
        RoomSnapshot snapshot = roomService.getSnapshot(roomCode);
        if (!roomService.leave(roomCode, user.userId())) return roomNotFound();
        userService.clearRoom(user.userId());
        // 게임 중 명시적 퇴장: 뒤따르는 소켓 close는 markOffline으로 빠지므로(끊김과 구분 불가)
        // 여기서 WS 명단·턴 순서까지 정리해야 "나가도 오프라인으로 방에 남는" 문제가 없다.
        if (snapshot.phase() == com.ssafy.yorr.room.dto.RoomPhase.PLAYING) {
            games.removePlayer(roomCode, snapshot.gameCode(), user.userId());
        }
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
        if (snapshot.phase() == null) return roomNotFound();
        if (!isHost(snapshot, user)) {
            return ResponseEntity.status(403).body("host_only");
        }
        try {
            GameStartResponse result = games.start(roomCode);
            // START(Lua)가 phase=LOBBY만 통과시키므로 여기 왔다면 진행 중인 게임은 없다.
            // 지난 게임의 라운드 상태가 남아 있으면 initialize가 거부되므로 먼저 버린다(재대결 경로).
            // 시작을 누른 호스트는 이 HTTP 응답으로 게임 화면에 들어가지만, 나머지 참가자는 소켓으로만 알 수 있다.
            // 여기서 방송하지 않으면 참가자는 대기실에 그대로 남는다.
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
        if (snapshot.phase() == null) return roomNotFound();
        if (!isHost(snapshot, user)) {
            return ResponseEntity.status(403).body("host_only");
        }

        // 저장소 전이가 권위다. 여기서 막히면(진행 중이거나 이미 대기실) 아무것도 건드리지 않는다.
        if (!games.returnToLobby(roomCode, snapshot)) {
            return ResponseEntity.status(409).body("not_finished");
        }
        return ResponseEntity.noContent().build();
    }

    /**
     * 이 사람이 방을 조작할 수 있는 호스트인가.
     * <p>
     * hostId 일치 + <b>플레이어 명단에도 있을 것</b>을 함께 본다 — 방을 떠난 옛 호스트가 토큰만
     * 들고 남의 게임을 시작하는 것을 막는 조건이다. 파티 방도 같다: 대시보드는 방을 열기만 하고
     * 방장은 처음 들어온 컨트롤러가 되므로(RoomValidationService의 JOIN·LEAVE 규약), hostId는
     * 항상 명단 안의 사람을 가리킨다.
     */
    private boolean isHost(RoomSnapshot snapshot, UserIdentity user) {
        if (!user.userId().equals(snapshot.hostId())) return false;
        return snapshot.players().stream().anyMatch(player -> user.userId().equals(player.playerId()));
    }

    /**
     * 방이 없을 때의 404. 본문에 도메인 코드를 실어야 클라이언트가 "방이 종료됐다"로 안내한다.
     * <p>
     * 빈 본문({@code notFound().build()})으로 두면 프론트의 코드 매핑이 걸리지 않아 사용자에게
     * "API request failed with status 404"라는 날것의 문장이 노출된다.
     */
    private static ResponseEntity<?> roomNotFound() {
        return ResponseEntity.status(404).body("room_not_found");
    }
}
