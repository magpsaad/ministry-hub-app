export function StubTab({ title, description }: { title: string; description: string }) {
  return (
    <div className="mt-4 rounded-xl bg-white shadow-[0_4px_20px_rgba(0,0,0,0.06)] p-8 text-center">
      <h2 className="text-xl font-bold text-brand">{title}</h2>
      <p className="mt-2 text-sm text-[#666] max-w-md mx-auto">{description}</p>
    </div>
  );
}
