package com.ssafy.yorr.game.teamyacht;

import com.ssafy.yorr.game.module.GameModule;
import com.ssafy.yorr.room.dto.GameStartResponse;
import com.ssafy.yorr.ws.RoomSessionRegistry;
import com.ssafy.yorr.ws.dto.ErrorPayload;
import com.ssafy.yorr.ws.dto.InboundEnvelope;
import com.ssafy.yorr.ws.dto.RoomSnapshot;
import com.ssafy.yorr.ws.dto.WsEnvelope;
import com.ssafy.yorr.ws.dto.WsErrorCode;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import tools.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.util.Set;

/**
 * 조별과제 야트(S15P11A406-209). 3인 1팀이 점수판 하나를 공유하는 야추 변형이다.
 * <p>
 * <b>기존 {@code YACHT_DICE} 모듈을 확장하지 않고 별도 게임 코드로 등록한다.</b> 순차 킵 ·
 * 숨긴 주사위 · 다수결 투표를 일반 야추의 라운드 상태에 끼워 넣으면 일반 온라인 야추가 깨진다.
 * 여기가 별개 모듈로 남아 있는 동안 그 회귀는 구조적으로 불가능하다. 점수 계산만 공유한다
 * ({@code YachtScoreCalculator}).
 * <p>
 * 정원이 정확히 3명이고 봇을 받지 않는다 — 규칙 자체가 세 사람의 순서에 기대고 있다.
 */
@Component
public class TeamYachtGameModule implements GameModule {

    public static final String CODE = "TEAM_YACHT";

    private final TeamYachtGameService games;
    private final RoomSessionRegistry sessions;
    private final ObjectMapper objectMapper;

    public TeamYachtGameModule(
            TeamYachtGameService games,
            RoomSessionRegistry sessions,
            ObjectMapper objectMapper
    ) {
        this.games = games;
        this.sessions = sessions;
        this.objectMapper = objectMapper;
    }

    @Override
    public String code() {
        return CODE;
    }

    @Override
    public String name() {
        return "Team Project Yacht";
    }

    @Override
    public int minPlayers() {
        return TeamYachtRules.SEATS;
    }

    @Override
    public int maxPlayers() {
        return TeamYachtRules.SEATS;
    }

    @Override
    public boolean supportsBots() {
        return false;
    }

    @Override
    public void start(String roomCode, GameStartResponse game) {
        games.start(roomCode, game);
    }

    @Override
    public void reset(String roomCode) {
        games.reset(roomCode);
    }

    @Override
    public RoomSnapshot reconnect(String roomCode, String playerId) {
        return games.reconnect(roomCode, playerId);
    }

    @Override
    public void resume(String roomCode) {
        // 마감 타이머가 없다 — 팀이 상의해 정하는 판이라 서버가 재촉할 시계를 두지 않았다.
    }

    @Override
    public void pause(String roomCode) {
        // resume과 같은 이유로 멈출 시계가 없다.
    }

    @Override
    public void removePlayer(String roomCode, String playerId) {
        games.removePlayer(roomCode, playerId);
    }

    @Override
    public void close(String roomCode) {
        games.close(roomCode);
    }

    @Override
    public boolean hasState(String roomCode) {
        return games.hasState(roomCode);
    }

    @Override
    public boolean handles(String messageType) {
        return Set.of("roll", "keep", "vote").contains(messageType);
    }

    @Override
    public void handle(WebSocketSession session, InboundEnvelope message) throws IOException {
        RoomSessionRegistry.Member member = sessions.of(session);
        if (member == null || message.roomId() == null || !message.roomId().equals(member.roomId())) {
            sendError(session, WsErrorCode.NOT_IN_ROOM, "current room membership is required", message.msgId());
            return;
        }
        try {
            switch (message.type()) {
                case "roll" -> games.roll(message.roomId(), member.playerId());
                case "keep" -> games.keep(message.roomId(), member.playerId(),
                        objectMapper.treeToValue(message.payload(), TeamYachtPayloads.Keep.class));
                case "vote" -> games.vote(message.roomId(), member.playerId(),
                        objectMapper.treeToValue(message.payload(), TeamYachtPayloads.Vote.class));
                default -> throw new IllegalArgumentException("unsupported_game_message");
            }
        } catch (IllegalArgumentException exception) {
            sendError(session, errorCode(exception.getMessage()), exception.getMessage(), message.msgId());
        } catch (IllegalStateException exception) {
            sendError(session, WsErrorCode.INTERNAL, exception.getMessage(), message.msgId());
        } catch (RuntimeException exception) {
            // 깨진 payload(역직렬화 실패)가 소켓 핸들러까지 올라가지 않게 여기서 막는다.
            sendError(session, WsErrorCode.INVALID_MESSAGE, "invalid team yacht payload", message.msgId());
        }
    }

    /** 순서를 어긴 조작은 화면이 되돌리기만 하면 되는 일이라 따로 구분해 준다. */
    private static WsErrorCode errorCode(String message) {
        return "not_your_turn".equals(message) || "not_in_team".equals(message)
                ? WsErrorCode.NOT_YOUR_TURN
                : WsErrorCode.INVALID_MESSAGE;
    }

    private void sendError(WebSocketSession session, WsErrorCode code, String message, String refMsgId)
            throws IOException {
        String json = objectMapper.writeValueAsString(WsEnvelope.of(
                "error", new ErrorPayload(code, message, refMsgId, null)
        ));
        synchronized (session) {
            session.sendMessage(new TextMessage(json));
        }
    }
}
