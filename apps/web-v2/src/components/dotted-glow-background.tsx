import { useEffect, useRef, useState, type CSSProperties } from 'react'

type DottedGlowBackgroundProps = {
  className?: string
  style?: CSSProperties
  gap?: number
  radius?: number
  color?: string
  darkColor?: string
  glowColor?: string
  darkGlowColor?: string
  opacity?: number
  speedMin?: number
  speedMax?: number
  speedScale?: number
}

type Dot = {
  x: number
  y: number
  phase: number
  speed: number
}

function isDarkTheme(): boolean {
  if (document.documentElement.classList.contains('dark')) return true
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function DottedGlowBackground({
  className,
  style,
  gap = 10,
  radius = 1.6,
  color = 'rgba(74, 80, 92, 0.55)',
  darkColor = 'rgba(148, 163, 184, 0.58)',
  glowColor = 'rgba(112, 144, 196, 0.58)',
  darkGlowColor = 'rgba(70, 130, 180, 0.55)',
  opacity = 0.82,
  speedMin = 0.3,
  speedMax = 1.35,
  speedScale = 1,
}: DottedGlowBackgroundProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [colors, setColors] = useState(() => ({
    dot: color,
    glow: glowColor,
  }))

  useEffect(() => {
    const computeColors = () => {
      const dark = isDarkTheme()
      setColors({
        dot: dark ? darkColor : color,
        glow: dark ? darkGlowColor : glowColor,
      })
    }

    computeColors()

    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const observer = new MutationObserver(computeColors)

    media.addEventListener('change', computeColors)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    })

    return () => {
      media.removeEventListener('change', computeColors)
      observer.disconnect()
    }
  }, [color, darkColor, glowColor, darkGlowColor])

  useEffect(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return

    const context = canvas.getContext('2d')
    if (!context) return

    let animationFrame = 0
    let isVisible = true
    let isStopped = false
    let dots: Dot[] = []
    const reduceMotion = prefersReducedMotion()
    const dpr = Math.min(Math.max(1, window.devicePixelRatio || 1), 2)

    const resizeCanvas = () => {
      const { width, height } = container.getBoundingClientRect()
      canvas.width = Math.max(1, Math.floor(width * dpr))
      canvas.height = Math.max(1, Math.floor(height * dpr))
      canvas.style.width = `${Math.floor(width)}px`
      canvas.style.height = `${Math.floor(height)}px`
      context.setTransform(dpr, 0, 0, dpr, 0, 0)
    }

    const regenerateDots = () => {
      dots = []
      const { width, height } = container.getBoundingClientRect()
      const cols = Math.ceil(width / gap) + 2
      const rows = Math.ceil(height / gap) + 2
      const minSpeed = Math.min(speedMin, speedMax)
      const speedRange = Math.max(Math.max(speedMin, speedMax) - minSpeed, 0)

      for (let column = -1; column < cols; column += 1) {
        for (let row = -1; row < rows; row += 1) {
          dots.push({
            x: column * gap + (row % 2 === 0 ? 0 : gap * 0.5),
            y: row * gap,
            phase: Math.random() * Math.PI * 2,
            speed: minSpeed + Math.random() * speedRange,
          })
        }
      }
    }

    const draw = (now: number) => {
      if (isStopped) return

      if (!isVisible) {
        animationFrame = window.requestAnimationFrame(draw)
        return
      }

      const { width, height } = container.getBoundingClientRect()
      context.clearRect(0, 0, width, height)
      context.save()
      context.fillStyle = colors.dot

      const time = reduceMotion ? 0.7 : (now / 1000) * Math.max(speedScale, 0)

      for (const dot of dots) {
        const mod = (time * dot.speed + dot.phase) % 2
        const pulse = mod < 1 ? mod : 2 - mod
        const alpha = reduceMotion ? 0.45 : 0.24 + 0.56 * pulse

        if (!reduceMotion && alpha > 0.6) {
          context.shadowColor = colors.glow
          context.shadowBlur = 6 * ((alpha - 0.6) / 0.4)
        } else {
          context.shadowColor = 'transparent'
          context.shadowBlur = 0
        }

        context.globalAlpha = alpha * opacity
        context.beginPath()
        context.arc(dot.x, dot.y, radius, 0, Math.PI * 2)
        context.fill()
      }

      context.restore()
      animationFrame = reduceMotion ? 0 : window.requestAnimationFrame(draw)
    }

    const handleResize = () => {
      resizeCanvas()
      regenerateDots()
      if (reduceMotion) draw(performance.now())
    }

    const resizeObserver = new ResizeObserver(handleResize)
    const intersectionObserver = new IntersectionObserver(
      ([entry]) => {
        isVisible = entry?.isIntersecting ?? true
      },
      { threshold: 0.1 },
    )

    resizeObserver.observe(container)
    intersectionObserver.observe(container)
    handleResize()
    animationFrame = window.requestAnimationFrame(draw)

    return () => {
      isStopped = true
      if (animationFrame !== 0) window.cancelAnimationFrame(animationFrame)
      resizeObserver.disconnect()
      intersectionObserver.disconnect()
    }
  }, [
    colors.dot,
    colors.glow,
    gap,
    opacity,
    radius,
    speedMax,
    speedMin,
    speedScale,
  ])

  return (
    <div
      ref={containerRef}
      aria-hidden="true"
      className={className}
      style={{ position: 'absolute', inset: 0, ...style }}
    >
      <canvas
        ref={canvasRef}
        style={{ display: 'block', height: '100%', width: '100%' }}
      />
    </div>
  )
}
