package com.ssafy.yorr.config;

import org.springframework.cache.CacheManager;
import org.springframework.cache.annotation.EnableCaching;
import org.springframework.cache.concurrent.ConcurrentMapCacheManager;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * 집계 결과 캐시.
 * <p>
 * <b>Redis가 아니라 인프로세스다.</b> 캐시를 공유해야 하는 상황은 인스턴스가 둘 이상일
 * 때인데, 이 앱은 이미 그럴 수 없다 — {@code RoundState}가 인메모리라 진행 중인 게임이
 * 한 프로세스에 묶여 있다. 없는 제약을 위해 직렬화 계층을 들이지 않는다.
 * <p>
 * 그 대가로 얻는 것: 캐시에 담기는 값이 그냥 객체 참조라 직렬화 실패·배포 시점의 클래스
 * 모양 변화 같은 실패 경로가 아예 없다. 재시작하면 통째로 비워지는데, 이 캐시는 언제
 * 버려도 MySQL에서 다시 만들 수 있으므로 손실이 아니다.
 * <p>
 * 인스턴스를 늘리게 되면({@code RoundStateStore}에 Redis 어댑터를 붙이는 시점) 이 캐시도
 * 함께 Redis로 옮겨야 한다 — 그때까지는 여기가 맞다.
 */
@Configuration
@EnableCaching
public class CacheConfig {

    /** 주간 최고점 랭킹 집계. 판이 끝날 때 비워진다. */
    public static final String WEEKLY_RANKING = "weeklyRanking";

    @Bean
    public CacheManager cacheManager() {
        return new ConcurrentMapCacheManager(WEEKLY_RANKING);
    }
}
