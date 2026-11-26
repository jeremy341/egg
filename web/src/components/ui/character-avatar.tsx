import { characterFor, characterPath } from "@/lib/preferences"
import { cn } from "@/lib/utils"

const RADIUS = {
  16: "rounded-[4px]",
  20: "rounded-[4px]",
  32: "rounded-md",
  40: "rounded-lg",
  48: "rounded-lg",
} as const

/**
 * One of the fixed pixel characters, drawn from an 8x8 grid. Decorative
 * (aria-hidden): the person's name sits next to it. An unknown id draws the first.
 */
export function CharacterAvatar({
  id,
  size = 32,
  className,
}: {
  id: string | null | undefined
  size?: keyof typeof RADIUS
  className?: string
}) {
  const character = characterFor(id)
  return (
    <svg
      aria-hidden="true"
      data-slot="character-avatar"
      viewBox="-1 -1 10 10"
      width={size}
      height={size}
      shapeRendering="crispEdges"
      className={cn(
        "shrink-0 bg-[var(--ds-gray-100)] text-foreground shadow-border-base",
        RADIUS[size],
        className
      )}
    >
      <path d={characterPath(character.rows)} fill="currentColor" />
    </svg>
  )
}
