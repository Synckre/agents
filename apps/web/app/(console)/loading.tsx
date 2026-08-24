export default function ConsoleLoading() {
  return (
    <div className="flex flex-col gap-4 p-1">
      <div className="h-10 w-64 rounded-lg bg-muted animate-pulse" />
      <div className="h-28 w-full rounded-2xl bg-muted animate-pulse" />
      <div className="h-48 w-full rounded-2xl bg-muted animate-pulse" />
    </div>
  );
}
