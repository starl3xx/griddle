import Link from 'next/link';
import { FaqAccordion } from '@/components/FaqAccordion';

export const metadata = {
  title: 'FAQ · Griddle',
  description: 'Frequently asked questions about Griddle.',
};

export default function FaqPage() {
  return (
    <main className="flex-1 flex flex-col items-center px-4 pt-10 pb-12 gap-8 max-w-lg mx-auto w-full">
      <header className="text-center">
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-gray-900 dark:text-gray-100">
          FAQ
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Griddle — frequently asked questions</p>
      </header>

      <div className="w-full">
        <FaqAccordion />
      </div>

      <Link href="/" className="text-sm text-gray-500 dark:text-gray-400 hover:text-brand transition-colors">
        ← back to today&apos;s puzzle
      </Link>
    </main>
  );
}
