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

    public void assignRoom(String userId, String roomId, String roomCode, String hostId) {
        redisTemplate.opsForHash().putAll(key(userId), Map.of(
                "roomId", roomId,
                "roomCode", roomCode,
                "host", hostId));
        redisTemplate.expire(key(userId), GUEST_TTL);
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
        redisTemplate.expire(key(userId), GUEST_TTL);
        redisTemplate.expire(tokenKey(token), GUEST_TTL);
        return new UserIdentity(userId, nickname, userType);
    }

    static String normalizeNickname(String nickname) {
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
