const queueItems = [
  {
    id: 1,
    name: "Sarah Chen",
    role: "Director of Ops, CloudScale",
    confidence: "High",
    confidenceClass: "bg-success-bg text-success",
    status: "Needs Review",
    statusClass: "bg-warning-bg text-warning",
    time: "2m ago",
    active: true,
  },
  {
    id: 2,
    name: "Marcus Holloway",
    role: "CTO, Nexus Systems",
    confidence: "Moderate",
    confidenceClass: "bg-warning-bg text-warning",
    status: "Drafting",
    statusClass: "bg-grey-100 text-grey-500",
    time: "15m ago",
    active: false,
  },
  {
    id: 3,
    name: "Elena Rodriguez",
    role: "VP Engineering, DataFlow",
    confidence: "High",
    confidenceClass: "bg-success-bg text-success",
    status: "Needs Review",
    statusClass: "bg-warning-bg text-warning",
    time: "1h ago",
    active: false,
  },
  {
    id: 4,
    name: "Julian Sorel",
    role: "Product Head, Stellar Labs",
    confidence: "Low",
    confidenceClass: "bg-danger-bg text-danger",
    status: "Needs Review",
    statusClass: "bg-warning-bg text-warning",
    time: "2h ago",
    active: false,
  },
];

const checks = [
  { label: "Lead data",         status: "good" as const },
  { label: "Persona alignment", status: "good" as const },
  { label: "Personalisation",   status: "weak" as const },
  { label: "Length",            status: "good" as const },
];

const draftText =
  `Subject: Optimizing CloudScale's latency for edge nodes\n\nHi Sarah,\n\nI noticed CloudScale's recent move into edge computing regions. Given your role overseeing Ops, you're likely balancing performance spikes with infrastructure costs.\n\nOur team at BlueOcean has developed a specific orchestration layer that reduces cold-start latency by 24% for nodes in high-density areas. It integrates directly with your existing Kubernetes stack without requiring a complete rewrite.\n\nWould you be open to a 10-minute brief on how we're handling similar throughput for Tier-1 providers?\n\nBest,\nThe BlueOcean Team`;

export default function DraftsPage() {
  return (
    /* Full height minus the 64px topbar from layout */
    <div className="h-[calc(100vh-4rem)] flex flex-col overflow-hidden">

      {/* Split content area */}
      <div className="flex-1 flex overflow-hidden">

        {/* ── Left queue panel ── */}
        <section className="w-[320px] bg-white border-r border-grey-100 flex flex-col overflow-y-auto shrink-0">
          <div className="px-5 py-4 border-b border-grey-100 sticky top-0 bg-white z-10">
            <h2 className="text-[16px] font-semibold text-primary">Queue (42)</h2>
          </div>

          {queueItems.map((item) => (
            <div
              key={item.id}
              className={[
                "p-4 border-b border-grey-100 cursor-pointer transition-colors",
                item.active
                  ? "bg-ocean-wash border-l-4 border-l-primary"
                  : "hover:bg-grey-50 border-l-4 border-l-transparent",
              ].join(" ")}
            >
              <div className="flex justify-between items-start mb-1">
                <h3 className="text-[14px] font-semibold text-primary">{item.name}</h3>
                <span className={`px-2 py-0.5 text-[11px] font-medium rounded ${item.confidenceClass}`}>
                  {item.confidence}
                </span>
              </div>
              <p className="text-[13px] text-grey-500 mb-2">{item.role}</p>
              <div className="flex items-center justify-between">
                <span className={`px-2 py-0.5 text-[11px] font-medium rounded ${item.statusClass}`}>
                  {item.status}
                </span>
                <span className="text-[11px] text-grey-300">{item.time}</span>
              </div>
            </div>
          ))}
        </section>

        {/* ── Right workspace ── */}
        <section className="flex-1 bg-grey-50 overflow-y-auto">
          <div className="p-10 flex flex-col gap-6">

            {/* Contact info strip */}
            <div className="bg-white p-6 rounded-lg shadow-[0_1px_3px_rgba(27,45,91,0.08)] flex justify-between items-center">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-full bg-primary-fixed flex items-center justify-center font-bold text-[14px] text-on-primary-fixed">
                  SC
                </div>
                <div>
                  <h2 className="text-[20px] font-bold text-primary">Sarah Chen</h2>
                  <div className="flex gap-4 mt-1">
                    <span className="flex items-center gap-1 text-[13px] text-grey-500">
                      <span className="material-symbols-outlined text-[16px]">location_on</span>
                      San Francisco, CA
                    </span>
                    <span className="flex items-center gap-1 text-[13px] text-grey-500">
                      <span className="material-symbols-outlined text-[16px]">link</span>
                      LinkedIn Profile
                    </span>
                  </div>
                </div>
              </div>
              <div className="flex gap-3">
                <span className="bg-ocean-wash text-primary px-3 py-1 rounded text-[13px] font-medium">
                  SaaS
                </span>
                <span className="bg-ocean-wash text-primary px-3 py-1 rounded text-[13px] font-medium">
                  Enterprise AI
                </span>
              </div>
            </div>

            {/* Content grid */}
            <div className="grid grid-cols-12 gap-6">

              {/* Email editor — col-span-8 */}
              <div className="col-span-8 flex flex-col gap-4">
                {/* Persona tabs */}
                <div className="flex gap-0 border-b border-grey-100">
                  <button className="px-5 py-2 text-[13px] font-medium border-b-2 border-primary text-primary">
                    Technical
                  </button>
                  <button className="px-5 py-2 text-[13px] font-medium border-b-2 border-transparent text-grey-500 hover:text-primary transition-colors">
                    Executive
                  </button>
                  <button className="px-5 py-2 text-[13px] font-medium border-b-2 border-transparent text-grey-500 hover:text-primary transition-colors">
                    Ops
                  </button>
                </div>

                {/* Draft editor */}
                <div className="bg-white rounded-lg border border-grey-100 flex flex-col h-[400px]">
                  <div className="px-3 py-2.5 bg-grey-50 border-b border-grey-100 flex justify-between items-center">
                    <span className="text-[11px] text-grey-500 uppercase tracking-wider">
                      Draft: Technical Outreach #1
                    </span>
                    <div className="flex gap-2">
                      <span className="material-symbols-outlined text-grey-500 text-[18px] cursor-pointer hover:text-primary transition-colors">
                        copy_all
                      </span>
                      <span className="material-symbols-outlined text-grey-500 text-[18px] cursor-pointer hover:text-primary transition-colors">
                        refresh
                      </span>
                    </div>
                  </div>
                  <textarea
                    className="flex-1 p-6 font-mono text-[13px] bg-transparent border-none focus:outline-none resize-none text-primary leading-relaxed"
                    spellCheck={false}
                    defaultValue={draftText}
                  />
                  <div className="px-4 py-2 border-t border-grey-100 flex justify-between items-center">
                    <div className="flex gap-4">
                      <span className="text-[11px] text-grey-500">
                        Words: <span className="text-primary">94</span>/125
                      </span>
                      <span className="text-[11px] text-grey-500">
                        Reading time: <span className="text-primary">45s</span>
                      </span>
                    </div>
                    <span className="text-[11px] text-success">✓ Optimal length</span>
                  </div>
                </div>
              </div>

              {/* Right sidebar — col-span-4 */}
              <div className="col-span-4 flex flex-col gap-6">

                {/* Confidence score widget */}
                <div className="bg-white rounded-lg shadow-[0_1px_3px_rgba(27,45,91,0.08)] overflow-hidden">
                  <div className="bg-success px-6 py-3 flex justify-between items-center text-white">
                    <span className="text-[13px] font-medium">Confidence Score</span>
                    <span className="text-[16px] font-semibold">High</span>
                  </div>
                  <div className="h-1.5 w-full bg-success opacity-50" />
                  <div className="p-6 flex flex-col gap-4">
                    {checks.map(({ label, status }) => (
                      <div key={label} className="flex justify-between items-center">
                        <span className="text-[13px] text-grey-500">{label}</span>
                        {status === "good" ? (
                          <span className="flex items-center gap-1 text-[13px] font-medium text-success">
                            <span className="material-symbols-outlined text-[16px]">check_circle</span>
                            Good
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-[13px] font-medium text-warning">
                            <span className="material-symbols-outlined text-[16px]">warning</span>
                            Weak
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Targeting strategy card */}
                <div className="bg-white p-6 rounded-lg shadow-[0_1px_3px_rgba(27,45,91,0.08)]">
                  <h3 className="text-[14px] font-semibold text-primary mb-3">
                    Targeting Strategy
                  </h3>
                  <p className="text-[13px] text-grey-700 leading-relaxed">
                    Focusing on technical pain points regarding "cold starts" and "latency" based
                    on CloudScale's recent infrastructure announcement.
                  </p>
                  <div className="mt-4 pt-4 border-t border-grey-100">
                    <span className="text-[11px] text-grey-500 uppercase tracking-wide">
                      Context Signal
                    </span>
                    <div className="mt-2 flex items-center gap-2 bg-ocean-wash p-2 rounded">
                      <span className="material-symbols-outlined text-primary text-[18px]">
                        rss_feed
                      </span>
                      <span className="text-[11px] text-primary font-medium">
                        Recent blog: "Edge expansion is here…"
                      </span>
                    </div>
                  </div>
                </div>

              </div>
            </div>
          </div>
        </section>
      </div>

      {/* ── Sticky footer actions ── */}
      <footer className="bg-white border-t border-grey-100 px-10 py-4 flex justify-between items-center shrink-0">
        <div className="flex items-center gap-4">
          <span className="text-[13px] text-grey-500">Showing 1 of 42 leads in queue</span>
          <div className="flex gap-2">
            <button className="w-8 h-8 flex items-center justify-center border border-grey-100 rounded hover:bg-grey-50 transition-colors">
              <span className="material-symbols-outlined text-[20px] text-grey-500">chevron_left</span>
            </button>
            <button className="w-8 h-8 flex items-center justify-center border border-grey-100 rounded hover:bg-grey-50 transition-colors">
              <span className="material-symbols-outlined text-[20px] text-grey-500">chevron_right</span>
            </button>
          </div>
        </div>
        <div className="flex gap-4">
          <button className="px-6 py-2 border border-danger text-danger text-[14px] font-semibold rounded-lg hover:bg-danger-bg transition-colors duration-150">
            Reject
          </button>
          <button className="px-6 py-2 border border-primary text-primary text-[14px] font-semibold rounded-lg hover:bg-ocean-wash transition-colors duration-150">
            Edit Draft
          </button>
          <button className="px-8 py-2 bg-success text-white text-[14px] font-semibold rounded-lg shadow-[0_1px_3px_rgba(27,45,91,0.08)] active:scale-[0.98] transition-transform">
            Approve &amp; Send
          </button>
        </div>
      </footer>
    </div>
  );
}
