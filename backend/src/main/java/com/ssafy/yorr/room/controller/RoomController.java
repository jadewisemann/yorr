package com.ssafy.yorr.room.controller;

import com.ssafy.yorr.room.dto.JoinResult;
import com.ssafy.yorr.room.service.RoomCreateService;
import com.ssafy.yorr.room.service.RoomValidationService;
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
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/rooms")
@RequiredArgsConstructor
@Tag(name = "Room", description = "게스트 생성, 방 생성 및 참가 API")
public class RoomController {

    private final UserService userService;
    private final RoomCreateService roomCreateService;
    private final RoomValidationService roomService;

    @PostMapping
    @Operation(summary = "방 생성 또는 참가", description = "room_id가 없으면 방을 만들고 host로 입장하며, 있으면 해당 방에 참가합니다.")
    public ResponseEntity<?> enterRoom(@RequestBody GuestCreateRequest request) {
        try {
            var guest = userService.createGuest(request.nickname());
            String roomId = request.roomId();
            if (roomId == null || roomId.isBlank()) {
                roomId = roomCreateService.createRoom(6, guest.userId());
            }
            JoinResult joined = roomService.join(roomId, new UserIdentity(
                    guest.userId(), guest.nickname(), UserType.GUEST), guest.sessionToken());
            userService.assignRoom(guest.userId(), roomId, roomId, joined.snapshot().hostId());
            return ResponseEntity.ok(new GuestCreateResponse(
                    guest.userId(), guest.nickname(), guest.sessionToken(), roomId));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.status("invalid_nickname".equals(e.getMessage()) ? 400 : 404).body(e.getMessage());
        } catch (IllegalStateException e) {
            return ResponseEntity.status(409).body(e.getMessage());
        }
    }
}
