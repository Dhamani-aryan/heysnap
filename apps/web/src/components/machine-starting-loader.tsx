type Props = {
  label?: string
}

export function MachineStartingLoader({ label = 'Starting Computer' }: Props) {
  return (
    <div
      role="status"
      aria-label={label}
      className="grid min-h-[100dvh] place-items-center bg-background px-xl text-heading"
    >
      <div className="flex flex-col items-center gap-[48px]">
        <h1 className="m-0 whitespace-nowrap text-[28px] font-[350] leading-none tracking-normal text-[#252629] dark:text-[#e3e4e6]">
          {label}
        </h1>

        <img
          src="/logo/light/animated.gif"
          alt=""
          aria-hidden="true"
          className="block h-auto w-[120px] dark:hidden"
        />
        <img
          src="/logo/dark/animated.gif"
          alt=""
          aria-hidden="true"
          className="hidden h-auto w-[120px] dark:block"
        />
      </div>
    </div>
  )
}
