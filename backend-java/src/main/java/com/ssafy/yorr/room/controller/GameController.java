package com.ssafy.yorr.room.controller;

import com.ssafy.yorr.room.dto.RoomSnapshot;
import com.ssafy.yorr.room.service.RoomValidationService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/games")
@RequiredArgsConstructor
@Tag(name = "Game", description = "게임 세션 상태 API")
public class GameController {

    private final RoomValidationService roomService;

    @GetMapping("/{gameId}")
    @Operation(summary = "현재 게임 상태 조회")
    public RoomSnapshot getGame(@PathVariable String gameId) {
        return roomService.getGameSnapshot(gameId);
    }
}
