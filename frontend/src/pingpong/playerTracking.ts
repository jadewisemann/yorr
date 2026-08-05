export interface PlayerTracking {
  p1X: number
  p2X: number
}

/** 원본과 같은 프레임별 12% 보간으로, 공을 받을 쪽 캐릭터만 좌우로 따라가게 한다. */
export function trackIncomingBall(tracking: PlayerTracking, direction: number, ballX: number) {
  if (direction > 0) tracking.p1X += (ballX - tracking.p1X) * 0.12
  else tracking.p2X += (ballX - tracking.p2X) * 0.12
}
