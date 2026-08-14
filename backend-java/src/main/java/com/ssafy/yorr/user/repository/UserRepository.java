package com.ssafy.yorr.user.repository;

import com.ssafy.yorr.user.domain.User;
import org.springframework.data.jpa.repository.JpaRepository;

/**
 * 회원 저장소. 식별자는 애플리케이션이 정하는 UUID 문자열이다(게스트 userId와 같은 형태).
 */
public interface UserRepository extends JpaRepository<User, String> {
}
