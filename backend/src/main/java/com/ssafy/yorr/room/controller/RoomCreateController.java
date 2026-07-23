package com.ssafy.yorr.room.controller;

import com.ssafy.yorr.room.service.RoomCreateService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.Set;

@RestController
@RequestMapping("/api/v1/rooms")
@RequiredArgsConstructor
@CrossOrigin("*")
@Tag(name = "Room", description = "방 생성 관련 controller")

public class RoomCreateController {

    private final RoomCreateService roomCreateService;

    @PostMapping
    @Operation(summary = "랜덤 방 비밀번호 생성", description = "공유용 비밀번호 6자리 생성한다.")
    public ResponseEntity<String> createRandomId(@RequestParam int size) {
        if (size < 1) return ResponseEntity.badRequest().build();
        return ResponseEntity.ok(roomCreateService.createRoom(size));
    }

    @GetMapping("/redisTest")
    @Operation(summary = "방 목록 조회")
    public ResponseEntity<Set<String>> getAllRoomNumbers(){
        return ResponseEntity.ok(roomCreateService.getAllRoomNumbers());
    }
}
