import type { FilesystemBrowserUploadProgress } from '../../../lib/filesystem/filesystem-upload.ts'

export function FilesystemUploadDialog({
  progress,
}: {
  progress: FilesystemBrowserUploadProgress
}) {
  const percent = computePercent(progress)
  const isPreparing = progress.phase === 'preparing'

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/[0.36] backdrop-blur-[2px]">
      <div className="w-[360px] rounded-[10px] border border-black/[0.08] bg-card p-[18px] text-card-foreground shadow-[0_18px_60px_rgba(0,0,0,0.32)] dark:border-white/[0.08]">
        <div className="flex items-baseline justify-between">
          <h3 className="m-0 text-[13px] font-semibold tracking-[-0.01em]">
            Uploading
          </h3>
          <span className="text-[12px] font-medium tabular-nums text-black/[0.54] dark:text-white/[0.54]">
            {isPreparing ? '—' : `${percent}%`}
          </span>
        </div>
        <div className="mt-[10px] h-[5px] w-full overflow-hidden rounded-full bg-black/[0.08] dark:bg-white/[0.10]">
          <div
            className={
              isPreparing
                ? 'h-full w-1/3 animate-[upload-shimmer_1.2s_ease-in-out_infinite] rounded-full bg-black/[0.72] dark:bg-white/[0.78]'
                : 'h-full rounded-full bg-black/[0.72] transition-[width] duration-150 ease-out dark:bg-white/[0.78]'
            }
            style={isPreparing ? undefined : { width: `${percent}%` }}
          />
        </div>
        <p className="mt-[10px] overflow-hidden text-ellipsis whitespace-nowrap text-[11px] text-black/[0.46] dark:text-white/[0.46]">
          {progress.detail}
        </p>
      </div>
      <style>{shimmerKeyframes}</style>
    </div>
  )
}

function computePercent(progress: FilesystemBrowserUploadProgress): number {
  if (progress.totalBytes <= 0) return 0
  const pct = (progress.completedBytes / progress.totalBytes) * 100
  return Math.min(100, Math.max(0, Math.round(pct)))
}

const shimmerKeyframes = `
@keyframes upload-shimmer {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(400%); }
}
`
