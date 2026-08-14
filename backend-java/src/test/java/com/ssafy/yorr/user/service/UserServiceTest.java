package com.ssafy.yorr.user.service;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class UserServiceTest {

    @Test
    void nicknameMustBeNonBlankAndAtMostTwentyCharacters() {
        assertEquals("guest", UserService.normalizeNickname(" guest "));
        assertThrows(IllegalArgumentException.class, () -> UserService.normalizeNickname(" "));
        assertThrows(IllegalArgumentException.class, () -> UserService.normalizeNickname("123456789012345678901"));
    }
}
