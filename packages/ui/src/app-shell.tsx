import type { ReactNode } from "react";
import { Button } from "./button";

export function AppShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children?: ReactNode;
}) {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: 24,
        fontFamily:
          'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        background: "#f7f7f5",
        color: "#1f2328",
      }}
    >
      <section
        style={{
          width: "min(720px, 100%)",
          display: "grid",
          gap: 20,
        }}
      >
        <div style={{ display: "grid", gap: 8 }}>
          <p
            style={{
              margin: 0,
              fontSize: 13,
              fontWeight: 700,
              letterSpacing: 0,
              color: "#4f6f52",
              textTransform: "uppercase",
            }}
          >
            ank1015 app
          </p>
          <h1 style={{ margin: 0, fontSize: 40, lineHeight: 1.1 }}>{title}</h1>
          <p style={{ margin: 0, fontSize: 18, lineHeight: 1.6, color: "#59636e" }}>
            {subtitle}
          </p>
        </div>
        {children ?? <Button>Shared component</Button>}
      </section>
    </main>
  );
}
