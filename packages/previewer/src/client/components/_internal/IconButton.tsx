import { useState, type ButtonHTMLAttributes, type ReactNode } from "react";

interface IconButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "type" | "children"
> {
  /** Required for assistive tech — the button has no visible label. */
  "aria-label": string;
  children: ReactNode;
  /**
   * True when the button represents the *currently selected* tool/mode
   * (e.g. the active cursor in a toolbar). Gets a stronger background tint
   * and a 1px ring, both derived from `currentColor`. `aria-pressed` is
   * forwarded automatically so screen readers announce the toggle.
   */
  isActive?: boolean;
}

/**
 * Ghost icon button. Background is transparent at rest and tints toward
 * `currentColor` on hover, mouse-active, and selected states, so it looks
 * correct on any header background without us having to know the actual
 * color. Focus ring uses the same color-mix trick.
 */
export function IconButton({ children, disabled, isActive, style, ...rest }: IconButtonProps) {
  const [hover, setHover] = useState(false);
  const [pressed, setPressed] = useState(false);
  const [focusRing, setFocusRing] = useState(false);

  // Layered tint logic, strongest wins:
  //   pressed (mouse-down) → active (selected) → hover → none.
  const background = disabled
    ? "transparent"
    : pressed
      ? "color-mix(in srgb, currentColor 18%, transparent)"
      : isActive
        ? "color-mix(in srgb, currentColor 12%, transparent)"
        : hover
          ? "color-mix(in srgb, currentColor 8%, transparent)"
          : "transparent";

  // Outline: keyboard focus wins; selected adds a quieter persistent ring.
  const outline = focusRing
    ? "2px solid color-mix(in srgb, currentColor 30%, transparent)"
    : isActive
      ? "1px solid color-mix(in srgb, currentColor 22%, transparent)"
      : "none";

  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={isActive}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => {
        setHover(false);
        setPressed(false);
      }}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      onFocus={(e) => {
        if (e.target.matches(":focus-visible")) setFocusRing(true);
      }}
      onBlur={() => setFocusRing(false)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 28,
        height: 28,
        padding: 0,
        margin: 0,
        border: 0,
        borderRadius: 6,
        background,
        color: "inherit",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.35 : 1,
        outline,
        // Negative offset so the active 1px ring sits *inside* the button's
        // 28×28 footprint rather than expanding it (which would jostle the
        // toolbar layout when a button toggles).
        outlineOffset: isActive ? -1 : 1,
        transition: "background-color 120ms ease, outline-color 120ms ease, opacity 120ms ease",
        ...style,
      }}
      {...rest}
    >
      {children}
    </button>
  );
}
