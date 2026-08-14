package com.ssafy.yorr.ws.dto;

import java.util.List;

public record RoundEndPayload(
        int roundNumber,
        List<String> submitted
) {

    public RoundEndPayload {
        submitted = List.copyOf(submitted);
    }
}
