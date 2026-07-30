package com.ssafy.yorr.ws.dto;

/** sys.pong의 payload. 계약: serverTs 하나만. */
public record SysPongPayload(long serverTs) {}