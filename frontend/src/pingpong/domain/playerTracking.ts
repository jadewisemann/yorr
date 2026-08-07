export interface PlayerTracking {
  p1X: number
  p2X: number
}

export function trackIncomingBall(tracking: PlayerTracking, direction: number, ballX: number) {
  if (direction > 0) tracking.p1X += (ballX - tracking.p1X) * 0.12
  else tracking.p2X += (ballX - tracking.p2X) * 0.12
}
