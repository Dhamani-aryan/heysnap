import type { ButtonHTMLAttributes, ReactNode } from "react";

export function Button({
  children,
  style,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode }) {
  return (
    <button
      {...props}
      style={{
        width: "fit-content",
        border: "1px solid #1f2328",
        borderRadius: 6,
        background: "#1f2328",
        color: "#ffffff",
        padding: "10px 14px",
        font: "inherit",
        fontWeight: 700,
        cursor: "pointer",
        ...style,
      }}
    >
      {children}
    </button>
  );
}
