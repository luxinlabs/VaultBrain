import "../App.css";

interface Props {
  onBack: () => void;
}

const WORKFLOWS = [
  {
    icon: "🔍",
    title: "Scan a company or founder",
    steps: [
      "Paste a website URL or LinkedIn profile into the Hog scan bar.",
      'Click "Enrich with The Hog" - signals are fetched in real-time.',
      "A node appears in the knowledge graph and is saved to GBrain.",
      "Click the node to view VC criteria, timeline, and signals.",
    ],
  },
  {
    icon: "📋",
    title: "Drop notes into the brain",
    steps: [
      "Paste raw meeting notes, email threads, or pitch summaries into the text box.",
      'Click "Extract to Brain" - entities are parsed automatically.',
      "Company: and Founder: labels create typed nodes.",
      "Nodes are linked if a founder and company appear together.",
    ],
  },
  {
    icon: "🤝",
    title: "Collaborate with your team",
    steps: [
      "Partners see all nodes. Analysts see only their assigned deals.",
      "Open a Team Session to discuss a specific entity live.",
      "Use the Collab Pad to write shared research and @mention agents.",
      "All changes persist in GBrain - refresh never loses data.",
    ],
  },
  {
    icon: "🤖",
    title: "Ask the Brain Agent",
    steps: [
      "Type any question in the agent chat box at the top of the right panel.",
      "Use quick-ask buttons for common queries (signals, summaries, warm paths).",
      "The agent searches GBrain, combines Hog signals, and returns a summary.",
      "Wire it to a GStack skill for AI-powered reasoning over your portfolio.",
    ],
  },
  {
    icon: "🔬",
    title: "Inspect token optimization",
    steps: [
      'Click "Token Test" in the header to open the Token Lab.',
      "Paste any memo or research doc - the optimizer compresses it before sending to LLMs.",
      "Compare conservative, balanced, and aggressive modes side-by-side.",
      "Balanced mode typically saves 30-45% of LLM context cost.",
    ],
  },
];

const ROLES = [
  {
    role: "Partner",
    badge: "#a78bfa",
    perms: [
      "Full read/write access to all deals",
      "Can assign analysts to pages",
      "Sees global graph with all nodes",
      "Receives all Hog signals across portfolio",
    ],
  },
  {
    role: "Analyst",
    badge: "#2dd4bf",
    perms: [
      "Read/write access to assigned deals only",
      "Can scan and enrich assigned companies",
      "Sees graph filtered to their assignments",
      "Agent queries scoped to visible pages",
    ],
  },
];

const AGENTS = [
  { handle: "@hog", desc: "Fetch live web signals for a company or founder" },
  { handle: "@gbrain", desc: "Search and summarise knowledge graph pages" },
  { handle: "@scanner", desc: "Trigger a full website scan and enrichment" },
  { handle: "@analyst", desc: "Run VC investment criteria analysis on a node" },
  { handle: "@timeline", desc: "Summarise the timeline and key events" },
];

export default function InstructionPage({ onBack }: Props) {
  return (
    <div className="instruction-page">
      <div className="instruction-hero">
        <div>
          <p className="panel-label">How to use</p>
          <h1>Team Guide to VaultBrain</h1>
          <p className="instruction-sub">
            VaultBrain connects <strong>GBrain</strong> (your knowledge graph),{" "}
            <strong>GStack</strong> (AI agents), and <strong>The Hog</strong>{" "}
            (live web intelligence) into a single VC research platform.
          </p>
        </div>
        <button className="ghost-btn" onClick={onBack}>
          ← Back
        </button>
      </div>

      <section className="instruction-section">
        <h2>Workflows</h2>
        <div className="workflow-grid">
          {WORKFLOWS.map((wf) => (
            <div key={wf.title} className="workflow-card">
              <div className="workflow-icon">{wf.icon}</div>
              <h3>{wf.title}</h3>
              <ol className="workflow-steps">
                {wf.steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      </section>

      <section className="instruction-section">
        <h2>Roles &amp; permissions</h2>
        <div className="roles-grid">
          {ROLES.map((r) => (
            <div key={r.role} className="role-card">
              <p className="role-badge" style={{ color: r.badge }}>
                {r.role}
              </p>
              <ul className="role-perms">
                {r.perms.map((p) => (
                  <li key={p}>✓ {p}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <section className="instruction-section">
        <h2>Available agents (use in Collab Pad)</h2>
        <div className="agent-table">
          {AGENTS.map((a) => (
            <div key={a.handle} className="agent-row">
              <code className="agent-handle">{a.handle}</code>
              <p>{a.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="instruction-section">
        <h2>Keyboard shortcuts</h2>
        <div className="shortcut-grid">
          {[
            ["Enter", "Send agent message"],
            ["Drag & drop", "Add files to brain"],
            ["Click node", "Open entity detail"],
            ["Scroll graph", "Zoom in / out"],
          ].map(([key, desc]) => (
            <div key={key} className="shortcut-row">
              <kbd>{key}</kbd>
              <span>{desc}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
