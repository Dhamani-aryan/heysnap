export function FullPageLoader() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div
        aria-label="Loading"
        className="h-6 w-6 animate-spin rounded-pill border-2 border-border border-t-primary"
      />
    </div>
  )
}
