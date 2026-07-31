package com.ssafy.yorr.user.service;

import com.ssafy.yorr.user.SessionAuthenticationException;
import com.ssafy.yorr.user.UserIdentity;
import com.ssafy.yorr.user.UserType;
import com.ssafy.yorr.user.dto.GuestCreateResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.stereotype.Service;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Duration;
import java.util.Base64;
import java.util.Map;
import java.util.UUID;

@Service
@RequiredArgsConstructor
public class UserService {

    private static final Duration GUEST_TTL = Duration.ofHours(24);
    /**
     * 회원 세션 수명. 게스트보다 길게 준다 — 게스트는 한 판을 위해 만들어지지만 회원은
     * 다시 찾아오는 사용자이고, 매번 카카오 동의 화면을 거치게 하면 로그인한 이유가 없어진다.
     * 활동할 때마다 갱신되므로(sliding) 실제로는 "30일 동안 접속이 없으면 풀린다"는 뜻이다.
     */
    private static final Duration MEMBER_TTL = Duration.ofDays(30);
    private static final SecureRandom RANDOM = new SecureRandom();
    private final RedisTemplate<String, String> redisTemplate;

    public GuestCreateResponse createGuest(String nickname) {
        String displayName = normalizeNickname(nickname);
        String userId = UUID.randomUUID().toString();
        String sessionToken = newSessionToken();
        String key = key(userId);
        redisTemplate.opsForHash().putAll(key, Map.of(
                "type", UserType.GUEST.name(),
                "nickname", displayName,
                "tokenHash", hash(sessionToken)));
        redisTemplate.expire(key, GUEST_TTL);
        redisTemplate.opsForValue().set(tokenKey(sessionToken), userId, GUEST_TTL);
        return new GuestCreateResponse(userId, displayName, sessionToken, null, null);
    }

    /**
     * 소셜 로그인으로 확인된 회원의 세션을 연다. 게스트와 같은 자리(user:{id})에 같은 형태로
     * 쓰므로, 방·게임 코드는 이 사용자가 회원인지 게스트인지 몰라도 된다 — REST의
     * {@link #authenticate}와 WebSocket의 {@link #authenticateSession}이 그대로 통과시킨다.
     *
     * @param userId 회원 테이블의 식별자(UUID). 게스트처럼 새로 만들지 않는다.
     * @return 클라이언트가 보관할 세션 토큰
     */
    public String openMemberSession(String userId, String nickname) {
        String sessionToken = newSessionToken();
        String key = key(userId);
        redisTemplate.opsForHash().putAll(key, Map.of(
                "type", UserType.MEMBER.name(),
                "nickname", nickname,
                "tokenHash", hash(sessionToken)));
        redisTemplate.expire(key, MEMBER_TTL);
        redisTemplate.opsForValue().set(tokenKey(sessionToken), userId, MEMBER_TTL);
        return sessionToken;
    }

    public void assignRoom(String userId, String roomId, String roomCode, String hostId) {
        redisTemplate.opsForHash().putAll(key(userId), Map.of(
                "roomId", roomId,
                "roomCode", roomCode,
                "host", hostId));
        // 회원 세션을 게스트 수명으로 깎지 않는다 — 방에 들어갔다는 이유로 로그인이 24시간짜리가 되면 안 된다.
        redisTemplate.expire(key(userId), ttlOf(userId));
    }

    public void clearRoom(String userId) {
        redisTemplate.opsForHash().delete(key(userId), "roomId", "roomCode", "host");
    }

    public UserIdentity authenticate(String userId, String authorization) {
        return authenticateCredentials(userId, bearerToken(authorization));
    }

    public UserIdentity authenticateSession(String sessionToken) {
        if (sessionToken == null || sessionToken.isBlank()) throw new SessionAuthenticationException();
        String userId = redisTemplate.opsForValue().get(tokenKey(sessionToken));
        if (userId == null) throw new SessionAuthenticationException();
        return authenticateCredentials(userId, sessionToken);
    }

    /**
     * 세션을 서버에서 닫는다. 클라이언트가 토큰을 지우는 것만으로는 서버 쪽 세션이 남아,
     * 그 값을 아는 누군가가 남은 수명 동안 계속 쓸 수 있다.
     * <p>
     * 역인덱스와 함께 {@code tokenHash}까지 지운다 — 인덱스만 지우면 WebSocket 경로는
     * 막히지만 {@code userId + Bearer}를 직접 쓰는 REST 경로는 그대로 통과한다.
     * 같은 계정의 다른 기기도 함께 로그아웃되는데, "로그아웃했는데 다른 데선 살아 있다"보다
     * 놀라움이 적은 쪽을 고른다.
     * <p>
     * 이미 없는 세션을 닫아도 조용히 성공한다 — 클라이언트는 어차피 로컬을 지울 것이고,
     * 여기서 실패를 알리면 "로그아웃이 안 됐다"는 잘못된 인상만 준다.
     */
    public void closeSession(String sessionToken) {
        if (sessionToken == null || sessionToken.isBlank()) return;
        String userId = redisTemplate.opsForValue().get(tokenKey(sessionToken));
        redisTemplate.delete(tokenKey(sessionToken));
        if (userId != null) {
            redisTemplate.opsForHash().delete(key(userId), "tokenHash");
        }
    }

    private UserIdentity authenticateCredentials(String userId, String token) {
        var user = redisTemplate.<Object, Object>opsForHash().entries(key(userId));
        Object storedHash = user.get("tokenHash");
        Object storedType = user.get("type");
        Object storedNickname = user.get("nickname");
        if (userId == null || userId.isBlank() || user.isEmpty() || !(storedHash instanceof String tokenHash)
                || !(storedType instanceof String type) || !(storedNickname instanceof String nickname)
                || !MessageDigest.isEqual(hash(token).getBytes(StandardCharsets.UTF_8),
                tokenHash.getBytes(StandardCharsets.UTF_8))) {
            throw new SessionAuthenticationException();
        }
        UserType userType;
        try {
            userType = UserType.valueOf(type);
        } catch (IllegalArgumentException e) {
            throw new SessionAuthenticationException();
        }
        Duration ttl = ttlOf(userType);
        redisTemplate.expire(key(userId), ttl);
        redisTemplate.expire(tokenKey(token), ttl);
        return new UserIdentity(userId, nickname, userType);
    }

    /** 저장된 타입으로 수명을 고른다. 타입을 읽을 수 없으면 짧은 쪽(게스트)으로 본다. */
    private Duration ttlOf(String userId) {
        Object type = redisTemplate.<Object, Object>opsForHash().get(key(userId), "type");
        if (!(type instanceof String value)) return GUEST_TTL;
        try {
            return ttlOf(UserType.valueOf(value));
        } catch (IllegalArgumentException e) {
            return GUEST_TTL;
        }
    }

    private static Duration ttlOf(UserType type) {
        return type == UserType.MEMBER ? MEMBER_TTL : GUEST_TTL;
    }

    /** 방 입장처럼 게스트를 만들지 않는 경로도 같은 규칙으로 이름을 다듬어야 한다. */
    public static String normalizeNickname(String nickname) {
        String value = nickname == null ? "" : nickname.trim();
        if (value.isEmpty() || value.length() > 20) throw new IllegalArgumentException("invalid_nickname");
        return value;
    }

    private static String bearerToken(String authorization) {
        if (authorization == null || !authorization.startsWith("Bearer ") || authorization.length() == 7) {
            throw new SessionAuthenticationException();
        }
        return authorization.substring(7);
    }

    private static String newSessionToken() {
        byte[] bytes = new byte[32];
        RANDOM.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    private static String hash(String value) {
        try {
            return Base64.getEncoder().encodeToString(MessageDigest.getInstance("SHA-256")
                    .digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    private static String key(String userId) {
        return "user:" + userId;
    }

    private static String tokenKey(String token) {
        return "user:token:" + hash(token);
    }
}
