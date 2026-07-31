package com.ssafy.yorr.auth.controller.dto;

/** 콜백이 프론트로 넘긴 일회용 코드. */
public record LoginCodeExchangeRequest(String code) {
}
