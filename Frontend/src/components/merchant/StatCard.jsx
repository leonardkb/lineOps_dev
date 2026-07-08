/*
  Small KPI tile.
  <StatCard icon={Hash} label="Códigos totales" value={128} hint="+4 esta semana" />
*/
export default function StatCard({ icon: Icon, label, value, hint }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4 flex items-center gap-3">
      <div className="w-10 h-10 rounded-lg bg-slate-900 text-white flex items-center justify-center shrink-0">
        <Icon size={18} />
      </div>
      <div className="min-w-0">
        <p className="text-xl font-bold text-slate-800 leading-tight truncate">{value}</p>
        <p className="text-xs text-slate-500 truncate">{label}</p>
        {hint && <p className="text-[11px] text-emerald-600">{hint}</p>}
      </div>
    </div>
  );
}