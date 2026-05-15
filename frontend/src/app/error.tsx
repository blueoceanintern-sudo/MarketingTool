"use client";

export default function Error({
  error,
}: {
  error: Error;
}) {
  return (
    <div className="p-6">
      <h2 className="text-xl font-bold">
        Something went wrong
      </h2>

      <p className="mt-2 text-red-500">
        {error.message}
      </p>
    </div>
  );
}