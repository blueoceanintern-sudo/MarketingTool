"use client";

interface Props {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  className?: string;
}

export default function Pagination({ page, totalPages, onPageChange, className = "" }: Props) {
  if (totalPages <= 1) return null;

  const pages = buildPageList(page, totalPages);

  return (
    <div className={`flex items-center gap-1 ${className}`}>
      <button
        type="button"
        onClick={() => onPageChange(page - 1)}
        disabled={page <= 1}
        aria-label="Previous page"
        className="flex items-center justify-center w-8 h-8 rounded text-grey-500 hover:bg-grey-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        <span className="material-symbols-outlined text-[18px]">chevron_left</span>
      </button>

      {pages.map((p, i) =>
        p === "…" ? (
          <span key={`ellipsis-${i}`} className="w-8 text-center text-[13px] text-grey-400 select-none">
            …
          </span>
        ) : (
          <button
            key={p}
            type="button"
            onClick={() => onPageChange(p as number)}
            className={[
              "min-w-[32px] h-8 px-2 rounded text-[13px] font-medium transition-colors",
              p === page
                ? "bg-primary text-white"
                : "text-grey-600 hover:bg-grey-50",
            ].join(" ")}
          >
            {p}
          </button>
        )
      )}

      <button
        type="button"
        onClick={() => onPageChange(page + 1)}
        disabled={page >= totalPages}
        aria-label="Next page"
        className="flex items-center justify-center w-8 h-8 rounded text-grey-500 hover:bg-grey-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        <span className="material-symbols-outlined text-[18px]">chevron_right</span>
      </button>
    </div>
  );
}

function buildPageList(current: number, total: number): (number | "…")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);

  const pages: (number | "…")[] = [1];

  if (current > 3) pages.push("…");

  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  for (let i = start; i <= end; i++) pages.push(i);

  if (current < total - 2) pages.push("…");

  pages.push(total);
  return pages;
}
