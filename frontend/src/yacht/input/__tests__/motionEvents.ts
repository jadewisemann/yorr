/**
 * 기기 흔들림 이벤트를 흉내내는 도구. jsdom에는 `DeviceMotionEvent`가 없어서
 * 생성자부터 심고, 가속도와 시각을 직접 채운 이벤트를 창에 던진다.
 */

export function installDeviceMotionEvent() {
  Object.defineProperty(window, 'DeviceMotionEvent', {
    configurable: true,
    value: function MockDeviceMotionEvent() {},
  })
}

export function dispatchMotion(timeStamp: number, x: number, y: number) {
  const event = Object.assign(new Event('devicemotion'), {
    acceleration: { x, y, z: 0 },
    accelerationIncludingGravity: null,
  })
  Object.defineProperty(event, 'timeStamp', { configurable: true, value: timeStamp })
  window.dispatchEvent(event)
}
