import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-6 py-10 gap-4 text-center">
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest">
        404
      </p>
      <h1 className="text-4xl font-bold tracking-tight text-gray-900">
        Word not found
      </h1>
      <p className="text-gray-500 max-w-sm">
        The page you’re looking for isn’t on the grid. Head back to today’s puzzle.
      </p>
      <Link href="/" className="btn-primary mt-2 no-underline">
        Play today’s puzzle
      </Link>
    </main>
  );
}
