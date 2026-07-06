import type { Member } from '../types'
import { initials } from '../utils'

export function Avatar({ member, size, title }: { member: Member; size?: 'sm' | 'lg'; title?: string }) {
  return (
    <span
      className={`avatar${size ? ' ' + size : ''}`}
      style={{ background: member.color }}
      title={title ?? member.name}
    >
      {initials(member.name)}
    </span>
  )
}

export function AvatarStack({ members, size }: { members: Member[]; size?: 'sm' | 'lg' }) {
  if (members.length === 0) return null
  return (
    <span className="avatar-stack">
      {members.slice(0, 4).map((m) => (
        <Avatar key={m.id} member={m} size={size} />
      ))}
      {members.length > 4 && <span className={`avatar${size ? ' ' + size : ''}`} style={{ background: 'var(--text-faint)' }}>+{members.length - 4}</span>}
    </span>
  )
}
