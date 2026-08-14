import mysql, { type Pool } from 'mysql2/promise'
import type { Env } from '../config/env.js'

// MySQL은 계정·전적·랭킹 등 영속 기록 전용이다 — docs/design/persistence.md.
// 스키마는 backend-java의 Flyway 마이그레이션(V1·V2)을 그대로 이어받는다.
export const createMysqlPool = (env: Env): Pool =>
  mysql.createPool({
    host: env.DB_HOST,
    port: env.DB_PORT,
    database: env.DB_NAME,
    user: env.DB_USERNAME,
    password: env.DB_PASSWORD,
    connectionLimit: 10,
  })
