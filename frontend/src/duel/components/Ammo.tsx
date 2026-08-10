import { MAX_HP, slots } from '@/duel/domain/duel'
import type { Outfit } from '@/duel/domain/fighter'

export function Ammo({ hp, name, outfit }: { hp: number; name: string; outfit: Outfit }) {
  return (
    <div className="grid justify-items-center gap-1.5">
      <span className="max-w-28 truncate text-xs font-black" style={{ color: outfit.scarf }}>
        {name}
      </span>
      <div className="flex gap-1">
        {slots('ammo', MAX_HP, hp).map((slot) => (
          <span
            className="block"
            key={slot.id}
            style={{
              background: slot.filled
                ? 'linear-gradient(#ffe9a8 0%, #d9a53c 34%, #8a5f18 100%)'
                : 'rgb(255 255 255 / 8%)',
              border: slot.filled ? '1px solid #6d4a11' : '1px solid rgb(255 255 255 / 16%)',
              borderRadius: '2px 2px 3px 3px',
              height: 17,
              width: 9,
            }}
          />
        ))}
      </div>
    </div>
  )
}
