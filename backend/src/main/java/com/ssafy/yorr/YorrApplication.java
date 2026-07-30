package com.ssafy.yorr;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

/** {@code @EnableScheduling}은 고아 라운드 상태 스윕({@code OrphanedRoundStateSweeper})을 위해 켠다. */
@SpringBootApplication
@EnableScheduling
public class YorrApplication {

	public static void main(String[] args) {
		SpringApplication.run(YorrApplication.class, args);
	}

}
