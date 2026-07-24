package com.ssafy.yorr.room.controller;

import com.ssafy.yorr.room.service.RoomCreateService;
import com.ssafy.yorr.user.UserIdentity;
import com.ssafy.yorr.user.service.UserService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/rooms")
@RequiredArgsConstructor
@CrossOrigin("*")
@Tag(name = "Room", description = "방 생성 및 대기실 API")
public class RoomCreateController {

    private final RoomCreateService roomCreateService;
    private final UserService userService;

    @PostMapping
    @Operation(summary = "방 생성", description = "인증된 사용자를 방장으로 저장합니다.")
    public ResponseEntity<?> createRoom(@RequestParam int size, @RequestHeader("X-User-Id") String userId,
                                        @RequestHeader("Authorization") String authorization) {
        UserIdentity user;
        try {
            user = userService.authenticate(userId, authorization);
        } catch (IllegalArgumentException e) {
            return ResponseEntity.status(401).body(e.getMessage());
        }
        try {
            return ResponseEntity.ok(roomCreateService.createRoom(size, user.userId()));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(e.getMessage());
        }
    }
}
