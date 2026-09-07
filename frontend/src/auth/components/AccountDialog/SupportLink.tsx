import { cn } from '@/shared/cn'
import { IconChat } from '@/shared/components/Icon'
import { activeRow, row } from './rowStyles'

/** 서비스 문의 창구 — 카카오톡 채널 1:1 채팅. 로그인 여부와 무관하게 닿아야 한다. */
export const KAKAO_SUPPORT_URL = 'http://pf.kakao.com/_hxgkxnX/chat'

export function SupportLink() {
  return (
    <a
      className={cn(row, activeRow)}
      href={KAKAO_SUPPORT_URL}
      rel="noopener noreferrer"
      target="_blank"
    >
      <IconChat className="size-5 flex-none text-content-muted" />
      카카오톡으로 문의하기
    </a>
  )
}
