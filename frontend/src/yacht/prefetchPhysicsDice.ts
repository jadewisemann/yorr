/**
 * 야추의 물리 주사위 청크를 미리 받아 두는 공개 입구.
 *
 * 대기실이 게임 시작 전에 부른다 — 무거운 청크(rapier + three, 약 2.2MB)를 게임 화면에
 * 들어간 뒤에 받으면 첫 굴림이 늦는다.
 *
 * `rendering/` 안을 직접 가리키지 않고 이 얇은 모듈을 두는 이유: `rendering/`은 도메인
 * 비공개 세그먼트다(biome.json 의 noRestrictedImports). 밖에서 필요한 것은 「미리 받아라」
 * 하나뿐이므로 그것만 공개한다. 안쪽 동적 import 는 그대로라 청크는 여전히 갈라진다.
 */
export function prefetchPhysicsDice() {
  void import('./rendering/physics-dice/loadWorld').then(({ prefetchPhysicsDiceWorld }) =>
    prefetchPhysicsDiceWorld(),
  )
}
