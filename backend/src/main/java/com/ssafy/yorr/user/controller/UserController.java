package com.ssafy.yorr.user.controller;

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
@RequestMapping("/api/v1/users")
@RequiredArgsConstructor
@Tag(name = "User", description = "게스트 사용자 및 로그인 사용자 API")
public class UserController {

    private final UserService userService;

    @PostMapping("/guests")
    @Operation(summary = "게스트 생성", description = "닉네임으로 게스트 식별자와 세션 토큰을 발급합니다.")
    public ResponseEntity<?> createGuest(@RequestBody GuestCreateRequest request) {
        try {
            return ResponseEntity.ok(userService.createGuest(request.nickname()));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(e.getMessage());
        }
    }
}
