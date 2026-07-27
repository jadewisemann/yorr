package com.ssafy.yorr.user.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

public record GuestCreateResponse(
        @JsonProperty("id") String userId,
        String nickname,
        @JsonProperty("token") String sessionToken,
        @JsonProperty("room_id") String roomId
) {}
