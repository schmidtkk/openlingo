export default function UnitLoading() {
  return (
    <div className="mx-auto max-w-lg">
      <div className="mb-6 text-center">
        <div className="mx-auto h-8 w-48 animate-pulse rounded-lg bg-lingo-gray" />
        <div className="mx-auto mt-2 h-4 w-32 animate-pulse rounded-lg bg-lingo-gray" />
      </div>
      <div className="flex flex-col items-center gap-4 py-4">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="h-16 w-16 animate-pulse rounded-full bg-lingo-gray"
          />
        ))}
      </div>
    </div>
  );
}
