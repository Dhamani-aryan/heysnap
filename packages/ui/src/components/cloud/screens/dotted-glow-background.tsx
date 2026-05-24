"use client";

import { useEffect, useRef, useState } from "react";

interface Dot {
  readonly x: number;
  readonly y: number;
  readonly phase: number;
}

interface DottedGlowBackgroundProps {
  readonly className?: string;
  readonly gap?: number;
  readonly radius?: number;
  readonly color?: string;
  readonly darkColor?: string;
  readonly glowColor?: string;
  readonly darkGlowColor?: string;
  readonly opacity?: number;
  readonly backgroundOpacity?: number;
}

const detectDarkMode = (): boolean => {
  const root = document.documentElement;

  if (root.classList.contains("dark")) {
    return true;
  }

  if (root.classList.contains("light")) {
    return false;
  }

  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
};

export function DottedGlowBackground({
  className,
  gap = 14,
  radius = 1.35,
  color = "rgba(82, 82, 91, 0.72)",
  darkColor = "rgba(161, 161, 170, 0.64)",
  glowColor = "rgba(82, 82, 91, 0.72)",
  darkGlowColor = "rgba(7, 89, 133, 0.82)",
  opacity = 1,
  backgroundOpacity = 0,
}: DottedGlowBackgroundProps): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [resolvedColor, setResolvedColor] = useState(color);
  const [resolvedGlowColor, setResolvedGlowColor] = useState(glowColor);

  useEffect(() => {
    const compute = () => {
      const isDark = detectDarkMode();
      setResolvedColor(isDark ? darkColor : color);
      setResolvedGlowColor(isDark ? darkGlowColor : glowColor);
    };

    compute();

    const mediaQuery = window.matchMedia?.("(prefers-color-scheme: dark)") ?? null;
    mediaQuery?.addEventListener("change", compute);

    const mutationObserver = new MutationObserver(compute);
    mutationObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style"],
    });

    return () => {
      mediaQuery?.removeEventListener("change", compute);
      mutationObserver.disconnect();
    };
  }, [color, darkColor, glowColor, darkGlowColor]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;

    if (!canvas || !container) {
      return;
    }

    const context = canvas.getContext("2d");

    if (!context) {
      return;
    }

    let dots: Dot[] = [];
    let resizeTimeout = 0;
    let width = 1;
    let height = 1;
    const dpr = Math.min(Math.max(1, window.devicePixelRatio || 1), 2);

    const resize = () => {
      const bounds = container.getBoundingClientRect();
      width = Math.max(1, Math.floor(bounds.width));
      height = Math.max(1, Math.floor(bounds.height));
      canvas.width = Math.max(1, Math.floor(width * dpr));
      canvas.height = Math.max(1, Math.floor(height * dpr));
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const regenerateDots = () => {
      dots = [];
      const cols = Math.ceil(width / gap) + 2;
      const rows = Math.ceil(height / gap) + 2;

      for (let col = -1; col < cols; col += 1) {
        for (let row = -1; row < rows; row += 1) {
          dots.push({
            x: col * gap + (row % 2 === 0 ? 0 : gap * 0.5),
            y: row * gap,
            phase: Math.random() * Math.PI * 2,
          });
        }
      }
    };

    const draw = () => {
      context.clearRect(0, 0, canvas.width, canvas.height);

      if (backgroundOpacity > 0) {
        const gradient = context.createRadialGradient(
          width * 0.5,
          height * 0.4,
          Math.min(width, height) * 0.1,
          width * 0.5,
          height * 0.5,
          Math.max(width, height) * 0.7,
        );
        gradient.addColorStop(0, "rgba(0,0,0,0)");
        gradient.addColorStop(1, `rgba(0,0,0,${Math.min(Math.max(backgroundOpacity, 0), 1)})`);
        context.fillStyle = gradient;
        context.fillRect(0, 0, width, height);
      }

      context.save();
      context.fillStyle = resolvedColor;

      for (const dot of dots) {
        const alpha = 0.2 + 0.52 * Math.abs(Math.sin(dot.phase));

        if (alpha > 0.6) {
          const glow = (alpha - 0.6) / 0.4;
          context.shadowColor = resolvedGlowColor;
          context.shadowBlur = 6 * glow;
        } else {
          context.shadowColor = "transparent";
          context.shadowBlur = 0;
        }

        context.globalAlpha = alpha * opacity;
        context.beginPath();
        context.arc(dot.x, dot.y, radius, 0, Math.PI * 2);
        context.fill();
      }

      context.restore();
    };

    const handleResize = () => {
      resize();
      window.clearTimeout(resizeTimeout);
      resizeTimeout = window.setTimeout(() => {
        regenerateDots();
        draw();
      }, 120);
    };

    resize();
    regenerateDots();
    draw();

    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(container);

    window.addEventListener("resize", handleResize);
    window.visualViewport?.addEventListener("resize", handleResize);

    return () => {
      window.clearTimeout(resizeTimeout);
      window.removeEventListener("resize", handleResize);
      window.visualViewport?.removeEventListener("resize", handleResize);
      resizeObserver.disconnect();
    };
  }, [
    gap,
    radius,
    resolvedColor,
    resolvedGlowColor,
    opacity,
    backgroundOpacity,
  ]);

  return (
    <div ref={containerRef} className={className}>
      <canvas ref={canvasRef} />
    </div>
  );
}
