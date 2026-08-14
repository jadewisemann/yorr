package com.ssafy.yorr.game.controller;

import com.ssafy.yorr.game.dto.GameQueryErrorResponse;
import com.ssafy.yorr.game.dto.GameResultsResponse;
import com.ssafy.yorr.game.dto.ScoreBoardResponse;
import com.ssafy.yorr.game.exception.GameScoreQueryException;
import com.ssafy.yorr.game.service.GameScoreQueryService;
import com.ssafy.yorr.user.UserIdentity;
import com.ssafy.yorr.user.service.UserService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.LinkedHashMap;
import java.util.Map;

@RestController
@RequestMapping("/api/v1/rooms/{roomId}")
@Tag(name = "Game Score Query", description = "게임 점수판 및 최종 결과 조회 API")
public class GameScoreQueryController {

    private final GameScoreQueryService gameScoreQueryService;
    private final UserService userService;

    public GameScoreQueryController(
            GameScoreQueryService gameScoreQueryService,
            UserService userService
    ) {
        this.gameScoreQueryService = gameScoreQueryService;
        this.userService = userService;
    }

    @GetMapping("/scores")
    @Operation(summary = "참가자별 점수판 조회")
    public ResponseEntity<?> getScoreboards(
            @PathVariable String roomId,
            @RequestHeader(value = "X-User-Id", required = false) String userId,
            @RequestHeader(value = "Authorization", required = false) String authorization
    ) {
        UserIdentity requester;
        try {
            requester = userService.authenticate(userId, authorization);
        } catch (IllegalArgumentException exception) {
            return authenticationFailure();
        }

        try {
            Map<String, ScoreBoardResponse> response = new LinkedHashMap<>();
            gameScoreQueryService.getScoreboards(roomId, requester.userId())
                    .forEach((playerId, scoreBoard) ->
                            response.put(playerId, ScoreBoardResponse.from(scoreBoard)));
            return ResponseEntity.ok(response);
        } catch (GameScoreQueryException exception) {
            return queryFailure(exception);
        }
    }

    @GetMapping("/results")
    @Operation(summary = "게임 최종 결과 조회")
    public ResponseEntity<?> getResults(
            @PathVariable String roomId,
            @RequestHeader(value = "X-User-Id", required = false) String userId,
            @RequestHeader(value = "Authorization", required = false) String authorization
    ) {
        UserIdentity requester;
        try {
            requester = userService.authenticate(userId, authorization);
        } catch (IllegalArgumentException exception) {
            return authenticationFailure();
        }

        try {
            return ResponseEntity.ok(
                    GameResultsResponse.from(
                            gameScoreQueryService.getResults(roomId, requester.userId())
                    )
            );
        } catch (GameScoreQueryException exception) {
            return queryFailure(exception);
        }
    }

    private static ResponseEntity<GameQueryErrorResponse> authenticationFailure() {
        return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                .body(new GameQueryErrorResponse("AUTH_FAILED", "유효하지 않은 사용자 세션입니다."));
    }

    private static ResponseEntity<GameQueryErrorResponse> queryFailure(
            GameScoreQueryException exception
    ) {
        return switch (exception.reason()) {
            case ROOM_NOT_FOUND -> error(HttpStatus.NOT_FOUND, "ROOM_NOT_FOUND", exception);
            case PLAYER_NOT_IN_ROOM -> error(HttpStatus.FORBIDDEN, "NOT_IN_ROOM", exception);
            case GAME_NOT_STARTED -> error(HttpStatus.CONFLICT, "GAME_NOT_STARTED", exception);
            case GAME_NOT_FINISHED -> error(HttpStatus.CONFLICT, "GAME_NOT_FINISHED", exception);
            case STORE_FAILURE -> error(HttpStatus.INTERNAL_SERVER_ERROR, "INTERNAL", exception);
        };
    }

    private static ResponseEntity<GameQueryErrorResponse> error(
            HttpStatus status,
            String code,
            GameScoreQueryException exception
    ) {
        return ResponseEntity.status(status)
                .body(new GameQueryErrorResponse(code, exception.getMessage()));
    }
}
