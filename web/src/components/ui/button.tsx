import * as React from "react"
import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { PixelLoader } from "@/components/ui/pixel-loader"
import { IconTip } from "@/components/ui/tooltip"

/**
 * Button shape, one rule for the whole app:
 * - a single action that stands alone on a marketing, docs or settings page is a
 *   capsule: shape="capsule";
 * - buttons in a vertical stack are rounded rectangles: the default (rounded-md);
 * - buttons in a horizontal row share one shape, so a row of capsules is all
 *   capsules (set shape="capsule" on each) and a row of rectangles is all default;
 * - dense data controls (filters, table and row actions, toolbars) keep the
 *   default rectangle at their own size.
 * The hit area is separate: touch-target grows it to 44 by 44 CSS pixels on a
 * coarse pointer without changing what is drawn.
 */
const buttonVariants = cva(
  "group/button touch-target inline-flex shrink-0 items-center justify-center rounded-md border border-transparent bg-clip-padding text-sm font-medium tracking-[-0.02em] whitespace-nowrap transition-[background-color,color,box-shadow,opacity,scale] duration-(--dur-fast) ease-snappy select-none active:not-disabled:not-aria-disabled:scale-[0.97] active:not-disabled:not-aria-disabled:duration-(--dur-press) disabled:pointer-events-none disabled:not-aria-busy:text-muted-foreground disabled:not-aria-busy:shadow-none aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/85 disabled:not-aria-busy:border-border disabled:not-aria-busy:bg-muted",
        brand:
          "bg-brand text-brand-foreground hover:brightness-110 active:brightness-95 disabled:not-aria-busy:border-border disabled:not-aria-busy:bg-muted",
        outline:
          "shadow-border-base border-transparent bg-background disabled:not-aria-busy:border-border disabled:not-aria-busy:bg-muted hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:hover:bg-muted",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] aria-expanded:bg-secondary aria-expanded:text-secondary-foreground disabled:not-aria-busy:border-border disabled:not-aria-busy:bg-muted",
        ghost:
          "hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:hover:bg-muted/50",
        destructive:
          "bg-destructive/10 text-destructive hover:bg-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30 disabled:not-aria-busy:border-border disabled:not-aria-busy:bg-muted",
        "destructive-solid":
          "bg-destructive text-destructive-foreground hover:bg-[color-mix(in_oklab,var(--destructive)_88%,var(--foreground))] disabled:not-aria-busy:border-border disabled:not-aria-busy:bg-muted",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default:
          "h-8 gap-1.5 px-2.5 max-sm:h-10 max-sm:px-3 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        xs: "h-6 gap-1 rounded-[min(var(--radius-md),10px)] px-2 text-xs max-sm:h-10 in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1 rounded-[min(var(--radius-md),12px)] px-2.5 text-[0.8rem] max-sm:h-10 in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-10 gap-2 px-4 text-sm has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
        icon: "size-8 max-sm:size-10",
        "icon-xs":
          "size-6 rounded-[min(var(--radius-md),10px)] max-sm:size-10 in-data-[slot=button-group]:rounded-lg [&_svg:not([class*='size-'])]:size-3",
        "icon-sm":
          "size-7 rounded-[min(var(--radius-md),12px)] max-sm:size-10 in-data-[slot=button-group]:rounded-lg",
        "icon-lg": "size-9 max-sm:size-10",
      },
      shape: {
        default: "",
        capsule: "rounded-full",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
      shape: "default",
    },
  }
)

/** True for a Phosphor icon (or any svg) element, the thing a loading button swaps out. */
function isIconElement(node: React.ReactNode): boolean {
  if (!React.isValidElement(node)) return false
  const type = node.type as
    | string
    | { displayName?: string; name?: string }
    | undefined
  if (type === "svg") return true
  if (node.props && (node.props as Record<string, unknown>)["data-icon"]) return true
  if (typeof type === "object" || typeof type === "function") {
    const name = type?.displayName ?? type?.name ?? ""
    return name.endsWith("Icon")
  }
  return false
}

function Button({
  className,
  variant = "default",
  size = "default",
  shape = "default",
  loading = false,
  disabled,
  children,
  render,
  nativeButton,
  tooltip,
  ...props
}: ButtonPrimitive.Props &
  VariantProps<typeof buttonVariants> & {
    /**
     * Shows a PixelLoader in place of the leading icon (or before the label if
     * there is none), sets aria-busy and disables the button. Pass the
     * "Saving…" form of the label as children while it is true.
     */
    loading?: boolean
    /**
     * Name tooltip, shown after a short hover and on keyboard focus. An
     * icon-only button (a size starting with "icon") with an aria-label gets one
     * automatically, with the label as its text. Pass a string to say something
     * else, or false to turn it off.
     */
    tooltip?: string | false
  }) {
  // Base UI expects a native <button>. With render={<Link/>} or {<a/>} it must
  // be told otherwise. An explicit nativeButton from the caller always wins.
  const isNative =
    nativeButton ??
    (render === undefined ||
      (React.isValidElement(render) &&
        (render.props as { type?: string }).type === "button"))
  let content: React.ReactNode = children
  if (loading) {
    const items = React.Children.toArray(children)
    const rest = isIconElement(items[0]) ? items.slice(1) : items
    content = (
      <>
        <PixelLoader size="md" />
        {rest}
      </>
    )
  }
  const label = typeof props["aria-label"] === "string" ? props["aria-label"] : undefined
  const tip =
    tooltip === false ? undefined : (tooltip ?? (size?.startsWith("icon") ? label : undefined))
  const button = (
    <ButtonPrimitive
      data-slot="button"
      aria-busy={loading || undefined}
      disabled={disabled || loading}
      render={render}
      nativeButton={isNative}
      className={cn(buttonVariants({ variant, size, shape, className }))}
      {...props}
      {...(content !== undefined ? { children: content } : null)}
    />
  )
  return tip ? <IconTip label={tip}>{button}</IconTip> : button
}

export { Button, buttonVariants }
