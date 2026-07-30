package com.ssafy.yorr.user.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

public record GuestCreateRequest(
        String nickname,
        @JsonProperty("room_id") String roomId
) {}
