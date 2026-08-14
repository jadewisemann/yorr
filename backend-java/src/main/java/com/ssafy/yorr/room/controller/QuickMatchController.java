package com.ssafy.yorr.room.controller;

import com.ssafy.yorr.game.module.GameModuleRegistry;
import com.ssafy.yorr.room.dto.QuickMatchResponse;
import com.ssafy.yorr.room.service.QuickMatchService;
import com.ssafy.yorr.user.SessionAuthenticationException;
import com.ssafy.yorr.user.UserIdentity;
import com.ssafy.yorr.user.service.UserService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/quick-matches")
@RequiredArgsConstructor
public class QuickMatchController {

    private final QuickMatchService quickMatches;
    private final UserService users;
    private final GameModuleRegistry games;

    @PostMapping
    public ResponseEntity<?> enter(
            @RequestHeader("X-User-Id") String userId,
            @RequestHeader("Authorization") String authorization,
            @RequestParam(name = "game_code", defaultValue = "YACHT_DICE") String requestedGameCode
    ) {
        try {
            UserIdentity user = users.authenticate(userId, authorization);
            return ResponseEntity.ok(quickMatches.enter(user, games.canonicalCode(requestedGameCode)));
        } catch (SessionAuthenticationException exception) {
            return ResponseEntity.status(401).body("unauthorized");
        } catch (IllegalArgumentException exception) {
            return ResponseEntity.badRequest().body(exception.getMessage());
        } catch (IllegalStateException exception) {
            return ResponseEntity.status(409).body(exception.getMessage());
        }
    }

    @GetMapping
    public ResponseEntity<?> status(
            @RequestHeader("X-User-Id") String userId,
            @RequestHeader("Authorization") String authorization
    ) {
        try {
            users.authenticate(userId, authorization);
            return ResponseEntity.ok(quickMatches.status(userId));
        } catch (SessionAuthenticationException exception) {
            return ResponseEntity.status(401).body("unauthorized");
        }
    }

    @DeleteMapping
    public ResponseEntity<?> cancel(
            @RequestHeader("X-User-Id") String userId,
            @RequestHeader("Authorization") String authorization
    ) {
        try {
            users.authenticate(userId, authorization);
            return ResponseEntity.ok(quickMatches.cancel(userId));
        } catch (SessionAuthenticationException exception) {
            return ResponseEntity.status(401).body("unauthorized");
        }
    }
}
