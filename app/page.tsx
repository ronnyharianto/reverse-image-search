import ScanForm from "@/components/ScanForm";

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-neutral-50 px-4">
      <div className="w-full max-w-xl text-center">
        <h1 className="mb-2 text-3xl font-bold tracking-tight text-neutral-900">Copyright Image Scanner</h1>
        <p className="mb-8 text-neutral-600">
          Crawl a website, screen its images against reverse image search sources, and review
          images that may require a license check.
        </p>
        <div className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm sm:p-8">
          <ScanForm />
        </div>
        <p className="mt-6 text-xs leading-relaxed text-neutral-400">
          Results are screening hints only — they never constitute a legal conclusion. A
          &quot;No Match&quot; result does not mean an image is copyright-free.
        </p>
      </div>
    </main>
  );
}
