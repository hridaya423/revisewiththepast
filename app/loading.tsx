export default function Loading() {
  return (
    <div className="min-h-[100dvh] bg-bg">
      <div className="h-16 border-b border-text/10 bg-bg-elevated" />
      <main className="mx-auto max-w-[1440px] px-4 py-7 sm:px-8 lg:px-10" aria-label="Loading page">
        <div className="skeleton h-9 w-full max-w-sm rounded-[4px]" />
        <div className="skeleton mt-3 h-4 w-full max-w-xl rounded-[2px]" />
        <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,0.82fr)_minmax(520px,1.18fr)]">
          <div className="space-y-3 border-t border-text/10 pt-5">
            <div className="skeleton h-12 rounded-[4px]" />
            <div className="skeleton h-12 rounded-[4px]" />
            <div className="skeleton h-12 rounded-[4px]" />
            <div className="skeleton h-36 rounded-[4px]" />
          </div>
          <div className="skeleton aspect-[1/1.18] max-h-[720px] rounded-[5px]" />
        </div>
      </main>
    </div>
  );
}
