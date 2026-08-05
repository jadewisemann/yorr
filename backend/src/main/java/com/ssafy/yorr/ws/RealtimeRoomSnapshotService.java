package com.ssafy.yorr.ws;

import com.ssafy.yorr.room.dto.ParticipantKind;
import com.ssafy.yorr.room.service.RoomService;
import com.ssafy.yorr.ws.dto.Player;
import com.ssafy.yorr.ws.dto.PlayerStatus;
import com.ssafy.yorr.ws.dto.RoomPhase;
import com.ssafy.yorr.ws.dto.RoomSnapshot;
import org.springframework.stereotype.Service;

import java.util.Comparator;
import java.util.List;

/**
 * Redis의 전체 참가자 명단과 WebSocket의 인간 접속 상태를 합쳐 클라이언트용 스냅샷을 만든다.
 * 봇은 서버 제어 참가자이므로 WebSocket 세션 레지스트리에 등록하지 않는다.
 */
@Service
public class RealtimeRoomSnapshotService {

    private final RoomService rooms;
    private final RoomSessionRegistry sessions;

    public RealtimeRoomSnapshotService(RoomService rooms, RoomSessionRegistry sessions) {
        this.rooms = rooms;
        this.sessions = sessions;
    }

    public RoomSnapshot snapshot(String roomId) {
        com.ssafy.yorr.room.dto.RoomSnapshot persistent = rooms.getSnapshot(roomId);
        if (persistent == null || persistent.phase() == null) {
            return sessions.snapshot(roomId);
        }

        List<Player> players = persistent.players().stream()
                .map(player -> {
                    RoomSessionRegistry.Member member = sessions.find(roomId, player.playerId());
                    PlayerStatus status = player.kind() == ParticipantKind.BOT
                            ? PlayerStatus.ONLINE
                            : member == null ? PlayerStatus.OFFLINE : member.status();
                    return new Player(
                            player.playerId(),
                            player.nickname(),
                            status,
                            player.playerId().equals(persistent.hostId()),
                            player.kind()
                    );
                })
                .sorted(Comparator.comparing(Player::playerId))
                .toList();

        return new RoomSnapshot(
                roomId,
                persistent.gameCode(),
                toRealtimePhase(persistent.phase()),
                persistent.hostId(),
                players,
                null,
                persistent.capacity()
        );
    }

    private static RoomPhase toRealtimePhase(com.ssafy.yorr.room.dto.RoomPhase phase) {
        return switch (phase) {
            case LOBBY -> RoomPhase.WAITING;
            case PLAYING -> RoomPhase.PLAYING;
            case FINISHED -> RoomPhase.FINISHED;
        };
    }
}
