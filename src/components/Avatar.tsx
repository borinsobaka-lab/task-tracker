import type { Member, Project } from '../types'
import { initials } from '../utils'

/** Аватарка проекта — логотип (или буква-заглушка) скруглённым квадратом,
 *  чтобы визуально отличаться от круглых аватарок участников. */
export function ProjectAvatar({ project, size }: { project: Project; size?: 'xs' | 'sm' | 'lg' }) {
  return (
    <span className={`project-avatar${size ? ' ' + size : ''}`} title={project.name}>
      {project.icon ? (
        <img className="project-avatar-img" src={project.icon} alt="" draggable={false} />
      ) : (
        (project.name || 'П').trim().charAt(0).toUpperCase()
      )}
    </span>
  )
}

export function Avatar({ member, size, title }: { member: Member; size?: 'xs' | 'sm' | 'lg'; title?: string }) {
  return (
    <span
      className={`avatar${size ? ' ' + size : ''}`}
      style={{ background: member.color }}
      title={title ?? member.name}
    >
      {member.avatar ? <img className="avatar-img" src={member.avatar} alt="" draggable={false} /> : initials(member.name)}
    </span>
  )
}

export function AvatarStack({ members, size }: { members: Member[]; size?: 'xs' | 'sm' | 'lg' }) {
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
