export function WorkspaceLoading({ title }: { title: string }) {
  return (
    <main className="mx-auto w-full max-w-[1180px] px-4 py-12 sm:px-8" aria-busy="true" aria-label={`Loading ${title.toLowerCase()}`}>
      <h1 className="text-3xl font-bold tracking-tight text-text">{title}</h1>
      <p role="status" className="mt-3 text-base text-text-secondary">Loading your workspace...</p>
      <div className="mt-10 space-y-4" aria-hidden="true">
        <div className="h-12 w-56 rounded-md bg-text/5" />
        <div className="h-48 border-y border-text/10 bg-text/[0.02]" />
      </div>
    </main>
  );
}
