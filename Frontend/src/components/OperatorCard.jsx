function tierFor(pct) {
  if (pct >= 100) return { label: "100%+", badge: "bg-green-100 text-green-900", bar: "bg-green-600" };
  if (pct >= 95) return { label: "95-99%", badge: "bg-amber-100 text-amber-900", bar: "bg-amber-600" };
  return { label: "Below 95%", badge: "bg-red-100 text-red-900", bar: "bg-red-600" };
}

export default function OperatorCard({ rank, name, produced, meta }) {
  const pct = meta > 0 ? Math.round((produced / meta) * 1000) / 10 : 0;
  const capped = Math.min(pct, 100);
  const tier = tierFor(pct);

  return (
    <div className="bg-paper rounded-xl px-4 py-3 mb-2.5">
      <div className="flex justify-between items-baseline mb-1.5">
        <span className="text-[15px] font-medium text-ink">
          #{rank} {name}
        </span>
        <span className={`text-xs px-2.5 py-0.5 rounded-md ${tier.badge}`}>{tier.label}</span>
      </div>
      <div className="flex justify-between text-[13px] text-gray-500 mb-1.5">
        <span>{produced.toLocaleString()} produced</span>
        <span>{pct}% of meta</span>
      </div>
      <div className="h-2 bg-white rounded overflow-hidden">
        <div className={`h-full rounded ${tier.bar}`} style={{ width: `${capped}%` }} />
      </div>
    </div>
  );
}