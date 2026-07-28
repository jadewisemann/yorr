package com.ssafy.yorr.ws;

import com.ssafy.yorr.ws.dto.Player;
import com.ssafy.yorr.ws.dto.PlayerStatus;
import com.ssafy.yorr.ws.dto.RoomPhase;
import com.ssafy.yorr.ws.dto.RoomSnapshot;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.WebSocketSession;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 방 멤버십(누가 · 어느 방에 · 어떤 정체성/상태로 있는지)의 인메모리 저장소.
 * <p>
 * 역할 분담: "봉투를 방 전원에게 쏘는 팬아웃"은 {@link InMemoryRoomBroadcaster}가,
 * "그 방에 지금 누가 있는지(명단·스냅샷)"는 여기가 담당한다. 둘 다 인메모리라
 * 단일 인스턴스 전제 — 분산/영속이 필요해지면 Redis 세션(티켓 42)으로 이 레지스트리만 갈아끼운다.
 */
@Component
public class RoomSessionRegistry {

    /** 방에 들어와 있는 한 명. ready는 room.ready 토글로 바뀜(다음 슬라이스). */
    public record Member(
            String playerId,
            String roomId,
            String nickname,
            boolean host,
            WebSocketSession session
    ) {
        /** 계약(ws-events.ts)의 Player로 변환. 대기방이라 status는 online 고정. */
        public Player toPlayer() {
            return new Player(playerId, nickname, PlayerStatus.ONLINE, host);
        }
    }

    // roomId -> (playerId -> Member) : 방별 명단.
    private final Map<String, Map<String, Member>> rooms = new ConcurrentHashMap<>();
    // sessionId -> Member : 소켓이 끊길 때 "세션만으로" 누구였는지 역추적.
    private final Map<String, Member> bySession = new ConcurrentHashMap<>();
    // roomId -> 진행 단계(없으면 WAITING). 게임 시작은 REST 가 처리하므로 그쪽에서 markPhase 로 알려준다.
    private final Map<String, RoomPhase> phases = new ConcurrentHashMap<>();

    /**
     * 방 입장. 그 방의 첫 입장자가 host가 된다.
     *
     * @return 방금 확정된 내 Member(발급 playerId·host 여부 포함).
     */
    public Member join(String roomId, WebSocketSession session, String playerId, String nickname) {
        Map<String, Member> members = rooms.computeIfAbsent(roomId, k -> new ConcurrentHashMap<>());
        // 첫 입장자 = 방장. 최초 입장 동시성 경합은 단일 인스턴스 전제에선 무시(원자화는 42에서).
        boolean host = members.isEmpty();
        Member member = new Member(playerId, roomId, nickname, host, session);
        members.put(playerId, member);
        bySession.put(session.getId(), member);
        return member;
    }

    /**
     * 세션 종료 / room.leave 시 명단에서 제거.
     *
     * @return 빠진 Member(원래 방에 없었으면 null). room.player_left 브로드캐스트에 쓴다.
     */
    public Member remove(WebSocketSession session) {
        Member member = bySession.remove(session.getId());
        if (member == null) return null;
        Map<String, Member> members = rooms.get(member.roomId());
        if (members != null) {
            members.remove(member.playerId());
            if (members.isEmpty()) {
                rooms.remove(member.roomId());
                phases.remove(member.roomId()); // 방 코드가 재사용돼도 이전 단계가 남지 않도록 같이 버린다.
            }
        }
        return member;
    }

    /**
     * 방 진행 단계를 갱신한다. 게임 시작처럼 <b>REST 가 상태를 바꾸는</b> 경로에서 호출해야,
     * 뒤이은 state.sync 브로드캐스트가 바뀐 phase 를 실어 나간다.
     */
    public void markPhase(String roomId, RoomPhase phase) {
        phases.put(roomId, phase);
    }

    /** 이 세션의 현재 멤버(없으면 null). */
    public Member of(WebSocketSession session) {
        return bySession.get(session.getId());
    }

    /**
     * 방 스냅샷. 세부 게임 진행상태(RoomSnapshot.game)는 게임 도메인 소관이라 여기선 채우지 않고,
     * phase 만 {@link #markPhase} 로 갱신된 값을 싣는다(기본 WAITING).
     * ⚠️ players 순서는 ConcurrentHashMap 특성상 입장 순서를 보장하지 않는다(대기방 명단엔 무해).
     */
    public RoomSnapshot snapshot(String roomId) {
        Map<String, Member> members = rooms.get(roomId);
        List<Player> players = new ArrayList<>();
        String hostId = null;
        if (members != null) {
            for (Member m : members.values()) {
                players.add(m.toPlayer());
                if (m.host()) hostId = m.playerId();
            }
        }
        return new RoomSnapshot(roomId, phases.getOrDefault(roomId, RoomPhase.WAITING), hostId, players);
    }
}
