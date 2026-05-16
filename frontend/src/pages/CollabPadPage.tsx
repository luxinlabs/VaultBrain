import { useState, useRef } from "react";
import "../App.css";

interface Props {
  onBack: () => void;
  token: string | null;
  apiUrl: string;
}

interface AgentDef {
  handle: string;
  icon: string;
  description: string;
  color: string;
}

const AGENTS: AgentDef[] = [
  {
    handle: "@hog",
    icon: "📡",
    description: "Fetch live web signals",
    color: "#2dd4bf",
  },
  {
    handle: "@gbrain",
    icon: "🧠",
    description: "Search knowledge graph",
    color: "#a78bfa",
  },
  {
    handle: "@scanner",
    icon: "🔍",
    description: "Scan & enrich an entity",
    color: "#f472b6",
  },
  {
    handle: "@analyst",
    icon: "📊",
    description: "Run VC criteria analysis",
    color: "#fbbf24",
  },
  {
    handle: "@timeline",
    icon: "📅",
    description: "Summarise timeline & key events",
    color: "#34d399",
  },
];

interface AgentResponse {
  handle: string;
  icon: string;
  result: string;
  color: string;
}

function parseAgentMentions(text: string): string[] {
  const matches = text.match(/@\w+/g) || [];
  const knownHandles = new Set(AGENTS.map((a) => a.handle));
  return [...new Set(matches.filter((m) => knownHandles.has(m)))];
}

function highlightMentions(text: string): string {
  return text.replace(/@(\w+)/g, (match) => {
    const agent = AGENTS.find((a) => a.handle === match);
    if (!agent) return match;
    return `<mark class="mention" style="background:${agent.color}22;color:${agent.color};border-radius:4px;padding:0 4px;">${match}</mark>`;
  });
}

const SAMPLE_PAD = `# Research Session - [Date]

## Entity: 
<!-- Add company or founder name here -->

## Key questions
- What is the current funding status?
- Who are the key competitors?
- What signals has The Hog found recently?

## @hog fetch latest signals for this entity
## @analyst run investment criteria analysis
## @gbrain search for related entities in our graph

## Notes
<!-- Add collaborative notes here -->

## Action items
- [ ] Schedule call with founder
- [ ] Review pitch deck
- [ ] Check references
`;

export default function CollabPadPage({ onBack, token, apiUrl }: Props) {
  const [content, setContent] = useState(SAMPLE_PAD);
  const [preview, setPreview] = useState(false);
  const [responses, setResponses] = useState<AgentResponse[]>([]);
  const [running, setRunning] = useState<string | null>(null);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [suggestionQuery, setSuggestionQuery] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const activeMentions = parseAgentMentions(content);

  const insertMention = (handle: string) => {
    if (!textareaRef.current) return;
    const el = textareaRef.current;
    const pos = el.selectionStart;
    const before = content.slice(0, pos);
    const after = content.slice(pos);
    const newContent = `${before}${handle} ${after}`;
    setContent(newContent);
    setShowSuggestions(false);
    setTimeout(() => {
      el.focus();
      el.setSelectionRange(pos + handle.length + 1, pos + handle.length + 1);
    }, 0);
  };

  const runAgent = async (agentDef: AgentDef) => {
    setRunning(agentDef.handle);
    await new Promise((r) => setTimeout(r, 800));

    let result = "";
    switch (agentDef.handle) {
      case "@hog":
        result =
          "Fetched 12 signals from web, LinkedIn, and news in the last 30 days. Top signal: recent press mention + 3 new hires detected. (Connect The Hog API for live data.)";
        break;
      case "@gbrain":
        result =
          "Found 4 related entities in GBrain: 2 companies (potential competitors), 1 shared investor, 1 portfolio company. Search GBrain knowledge graph for details.";
        break;
      case "@scanner":
        result =
          "Scanning entity website... detected tech stack, team size ~40, product in beta. Enrichment complete - node updated in GBrain. (Connect Hog scan API for real data.)";
        break;
      case "@analyst":
        result =
          "VC Criteria Summary:\n- Market Size: Large TAM signals detected\n- Traction: Early - limited public signals\n- Team: 2 prior exits found\n- PMF: Pilot customers mentioned\n- Moat: Network effects referenced\n- Funding: Pre-seed stage";
        break;
      case "@timeline":
        result =
          "Timeline highlights: Founded 2022, first product launch Q2 2023, seed raise Q4 2023, 3 press mentions Q1 2024, team grew from 5 to 18 over 12 months.";
        break;
      default:
        result =
          "Agent response stub. Wire this to GStack for live AI results.";
    }

    setResponses((prev) => {
      const filtered = prev.filter((r) => r.handle !== agentDef.handle);
      return [
        ...filtered,
        {
          handle: agentDef.handle,
          icon: agentDef.icon,
          result,
          color: agentDef.color,
        },
      ];
    });
    setRunning(null);
  };

  const runAllMentioned = async () => {
    for (const handle of activeMentions) {
      const agentDef = AGENTS.find((a) => a.handle === handle);
      if (agentDef) await runAgent(agentDef);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "@") {
      setShowSuggestions(true);
      setSuggestionQuery("");
    } else if (showSuggestions) {
      if (e.key === "Escape") {
        setShowSuggestions(false);
      } else if (e.key !== "Shift") {
        setSuggestionQuery((q) => q + e.key);
      }
    }
  };

  const filteredAgents = AGENTS.filter(
    (a) =>
      !suggestionQuery ||
      a.handle.toLowerCase().includes(suggestionQuery.toLowerCase()),
  );

  const renderedHtml = highlightMentions(
    content
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/^## (.+)$/gm, "<h3>$1</h3>")
      .replace(/^# (.+)$/gm, "<h2>$1</h2>")
      .replace(/^- \[ \] (.+)$/gm, '<li class="todo-item unchecked">$1</li>')
      .replace(/^- (.+)$/gm, "<li>$1</li>")
      .replace(/\n/g, "<br>"),
  );

  return (
    <div className="collab-page">
      <div className="collab-header">
        <div>
          <p className="panel-label">Collab Pad</p>
          <h1>Shared Research Document</h1>
          <p className="instruction-sub">
            Write collaborative notes and{" "}
            <strong style={{ color: "#2dd4bf" }}>@mention agents</strong> to
            request live searches directly from your document.
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
          <button className="ghost-btn" onClick={() => setPreview((p) => !p)}>
            {preview ? "Edit" : "Preview"}
          </button>
          <button className="ghost-btn" onClick={onBack}>
            Back
          </button>
        </div>
      </div>

      <div className="collab-layout">
        {/* Editor / Preview */}
        <main className="collab-editor-wrap">
          {preview ? (
            <div
              className="collab-preview"
              dangerouslySetInnerHTML={{ __html: renderedHtml }}
            />
          ) : (
            <div style={{ position: "relative" }}>
              <textarea
                ref={textareaRef}
                className="collab-editor"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                onKeyDown={handleKeyDown}
                spellCheck={false}
              />
              {showSuggestions && (
                <div className="mention-popup">
                  {filteredAgents.map((a) => (
                    <button
                      key={a.handle}
                      className="mention-option"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        insertMention(a.handle);
                      }}
                    >
                      <span>{a.icon}</span>
                      <span style={{ color: a.color }}>{a.handle}</span>
                      <span className="mention-desc">{a.description}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Agent mention legend */}
          <div className="mention-legend">
            <p className="section-label">
              Available agents - type @ to mention
            </p>
            <div className="mention-chips">
              {AGENTS.map((a) => (
                <button
                  key={a.handle}
                  className="mention-chip"
                  style={{ borderColor: `${a.color}55`, color: a.color }}
                  onClick={() => insertMention(a.handle)}
                >
                  {a.icon} {a.handle}
                </button>
              ))}
            </div>
          </div>
        </main>

        {/* Right: Agent results panel */}
        <aside className="collab-results">
          <div className="collab-results-header">
            <p className="section-label">
              Agent results ({responses.length} completed)
            </p>
            {activeMentions.length > 0 && (
              <button
                className="primary-btn"
                style={{ fontSize: "0.8rem", padding: "0.4rem 0.9rem" }}
                onClick={runAllMentioned}
                disabled={!!running}
              >
                {running
                  ? `Running ${running}...`
                  : `Run all (${activeMentions.length})`}
              </button>
            )}
          </div>

          {activeMentions.length === 0 && responses.length === 0 && (
            <p className="muted" style={{ padding: "1rem" }}>
              Mention agents in your document using @handle to request searches.
            </p>
          )}

          {activeMentions.map((handle) => {
            const agentDef = AGENTS.find((a) => a.handle === handle)!;
            const response = responses.find((r) => r.handle === handle);
            return (
              <div key={handle} className="agent-result-card">
                <div className="agent-result-header">
                  <span>{agentDef.icon}</span>
                  <span style={{ color: agentDef.color }}>{handle}</span>
                  <button
                    className="ghost-btn"
                    style={{ fontSize: "0.75rem", marginLeft: "auto" }}
                    onClick={() => runAgent(agentDef)}
                    disabled={!!running}
                  >
                    {running === handle ? "Running..." : "Run"}
                  </button>
                </div>
                {response ? (
                  <p className="agent-result-text">{response.result}</p>
                ) : (
                  <p className="muted agent-result-text">Not yet run</p>
                )}
              </div>
            );
          })}

          {responses
            .filter((r) => !activeMentions.includes(r.handle))
            .map((r) => (
              <div key={r.handle} className="agent-result-card stale">
                <div className="agent-result-header">
                  <span>{r.icon}</span>
                  <span style={{ color: r.color }}>{r.handle}</span>
                  <span
                    className="pill subtle"
                    style={{ marginLeft: "auto", fontSize: "0.65rem" }}
                  >
                    cached
                  </span>
                </div>
                <p className="agent-result-text">{r.result}</p>
              </div>
            ))}
        </aside>
      </div>
    </div>
  );
}
