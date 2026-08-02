package com.ssafy.yorr.room.controller;

import com.ssafy.yorr.game.module.GameModuleRegistry;
import com.ssafy.yorr.room.dto.JoinResult;
import com.ssafy.yorr.room.service.RoomCreateService;
import com.ssafy.yorr.room.service.RoomValidationService;
import com.ssafy.yorr.user.SessionAuthenticationException;
import com.ssafy.yorr.user.UserIdentity;
import com.ssafy.yorr.user.UserType;
import com.ssafy.yorr.user.dto.GuestCreateRequest;
import com.ssafy.yorr.user.dto.GuestCreateResponse;
import com.ssafy.yorr.user.service.UserService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/rooms")
@RequiredArgsConstructor
@Tag(name = "Room", description = "게스트 생성, 방 생성 및 참가 API")
public class RoomController {

    private static final org.slf4j.Logger log = org.slf4j.LoggerFactory.getLogger(RoomController.class);

    private final UserService userService;
    private final RoomCreateService roomCreateService;
    private final RoomValidationService roomService;
    private final GameModuleRegistry gameModules;

    @PostMapping
    @Operation(summary = "방 생성 또는 참가", description = "room_id가 없으면 game_code 게임의 방을 만들고, 있으면 해당 방에 참가합니다.")
    public ResponseEntity<?> enterRoom(
            @RequestBody GuestCreateRequest request,
            @RequestParam(name = "game_code", defaultValue = "YACHT_DICE") String requestedGameCode
    ) {
        try {
            String roomId = request.roomId();
            String gameCode = null;
            if (roomId == null || roomId.isBlank()) {
                gameCode = gameModules.canonicalCode(requestedGameCode);
            }
            var entrant = resolveEntrant(request);
            if (roomId == null || roomId.isBlank()) {
                roomId = roomCreateService.createRoom(6, entrant.userId(), gameCode);
            }
            JoinResult joined = roomService.join(roomId, entrant.identity(), entrant.sessionToken());
            userService.assignRoom(entrant.userId(), roomId, roomId, joined.snapshot().hostId());
            return ResponseEntity.ok(new GuestCreateResponse(
                    entrant.userId(), entrant.nickname(), entrant.sessionToken(), roomId,
                    joined.snapshot().gameCode()));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.status(
                    "invalid_nickname".equals(e.getMessage()) || "invalid_game_code".equals(e.getMessage()) ? 400 : 404
            ).body(e.getMessage());
        } catch (IllegalStateException e) {
            return ResponseEntity.status(409).body(e.getMessage());
        }
    }

    /**
     * 방에 들어갈 정체성을 정한다. 로그인 세션이 살아 있으면 그 회원으로, 아니면 새 게스트로.
     * <p>
     * 회원으로 들어가야 게임 결과가 계정에 남는다. 다만 토큰이 만료됐다고 입장 자체를 막지는
     * 않는다 — 방에 들어오려던 사람을 로그인 화면으로 돌려보내는 것보다 게스트로라도 놀게
     * 하는 편이 낫다. 이때 표시 이름은 요청에 담긴 닉네임을 그대로 쓴다.
     */
    private Entrant resolveEntrant(GuestCreateRequest request) {
        String token = request.sessionToken();
        if (token != null && !token.isBlank()) {
            try {
                UserIdentity member = userService.authenticateSession(token);
                // 방에서 쓸 이름은 이번 입장에 적어 낸 값이 우선이다(프로필 닉네임은 그대로 둔다).
                String nickname = request.nickname() == null || request.nickname().isBlank()
                        ? member.nickname()
                        : UserService.normalizeNickname(request.nickname());
                return new Entrant(new UserIdentity(member.userId(), nickname, member.type()), token);
            } catch (SessionAuthenticationException expired) {
                log.info("만료된 세션으로 입장 시도 — 게스트로 진행합니다");
            }
        }
        GuestCreateResponse guest = userService.createGuest(request.nickname());
        return new Entrant(
                new UserIdentity(guest.userId(), guest.nickname(), UserType.GUEST), guest.sessionToken());
    }

    private record Entrant(UserIdentity identity, String sessionToken) {
        String userId() {
            return identity.userId();
        }

        String nickname() {
            return identity.nickname();
        }
    }
}
