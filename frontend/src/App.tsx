import ForceGraph2D, { NodeObject } from "react-force-graph-2d";
import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import "./App.css";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001";

interface User {
  id: string;
  email: string;
  name: string;
  role: "partner" | "analyst";
}

interface HogSignal {
  source: string;
  type: string;
  content: string;
  url?: string;
  timestamp?: string;
  engagement?: Record<string, number>;
}

type EntityType = "company" | "founder";

interface BrainNode {
  id: string;
  label: string;
  type: EntityType;
  summary?: string;
  tags?: string[];
  website?: string;
  sector?: string;
  stage?: string;
  lastContact?: string;
  signals?: HogSignal[];
  source?: "user" | "hog" | "gbrain";
}

interface BrainLink {
  source: string;
  target: string;
  relation: string;
}

interface GraphPayload {
  nodes: BrainNode[];
  links: BrainLink[];
}

interface ChatMessage {
  role: "agent" | "user" | "system";
  text: string;
}

const INITIAL_AGENT_MESSAGES: ChatMessage[] = [
  {
    role: "agent",
    text: "I'm your VaultBrain agent. Drop content above—I'll route it through GStack, store results in GBrain, and enrich with The Hog.",
  },
];

function App() {
  const [token, setToken] = useState<string | null>(
    localStorage.getItem("token"),
  );
  const [user, setUser] = useState<User | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [website, setWebsite] = useState("https://thehog.ai");
  const [error, setError] = useState<string | null>(null);
  const [ingestBusy, setIngestBusy] = useState(false);
  const [scanBusy, setScanBusy] = useState(false);
  const [notes, setNotes] = useState("");
  const [dragging, setDragging] = useState(false);
  const [graphData, setGraphData] = useState<{
    nodes: BrainNode[];
    links: BrainLink[];
  }>({ nodes: [], links: [] });
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>(
    INITIAL_AGENT_MESSAGES,
  );
  const [agentInput, setAgentInput] = useState("");
  const [theme, setTheme] = useState<"light" | "dark">(
    (localStorage.getItem("theme") as "light" | "dark") || "dark",
  );
  const [scannedCache, setScannedCache] = useState<Map<string, BrainNode>>(
    new Map(),
  );

  const graphRef = useRef<HTMLDivElement | null>(null);
  const [graphSize, setGraphSize] = useState({ width: 600, height: 320 });

  useEffect(() => {
    const handleResize = () => {
      if (!graphRef.current) return;
      setGraphSize({
        width: graphRef.current.clientWidth,
        height: graphRef.current.clientHeight,
      });
    };
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    if (token) {
      fetch(`${API_URL}/api/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then((r) => r.json())
        .then((u) => setUser(u))
        .catch(() => {
          setToken(null);
          localStorage.removeItem("token");
        });
    }
  }, [token]);

  useEffect(() => {
    localStorage.setItem("theme", theme);
    document.body.className = theme;
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === "dark" ? "light" : "dark"));
  };

  const selectedNode = useMemo(
    () => graphData.nodes.find((node) => node.id === selectedNodeId) ?? null,
    [graphData.nodes, selectedNodeId],
  );

  const founders = useMemo(
    () => graphData.nodes.filter((node) => node.type === "founder"),
    [graphData.nodes],
  );
  const companies = useMemo(
    () => graphData.nodes.filter((node) => node.type === "company"),
    [graphData.nodes],
  );

  const addMessage = useCallback((message: ChatMessage) => {
    setMessages((prev) => [...prev, message]);
  }, []);

  const mergeGraphData = useCallback(
    (incomingNodes: BrainNode[], incomingLinks: BrainLink[]) => {
      if (!incomingNodes.length && !incomingLinks.length) return;
      setGraphData((prev) => {
        const nodeMap = new Map(prev.nodes.map((node) => [node.id, node]));
        incomingNodes.forEach((node) => {
          const existing = nodeMap.get(node.id);
          nodeMap.set(node.id, mergeNode(existing, node));
        });
        const mergedLinks = [...prev.links];
        incomingLinks.forEach((link) => {
          const exists = mergedLinks.some(
            (existing) =>
              existing.source === link.source &&
              existing.target === link.target &&
              existing.relation === link.relation,
          );
          if (!exists) mergedLinks.push(link);
        });
        return { nodes: Array.from(nodeMap.values()), links: mergedLinks };
      });
    },
    [],
  );

  const login = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch(`${API_URL}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Login failed");
      }
      setToken(data.token);
      setUser(data.user);
      localStorage.setItem("token", data.token);
    } catch (err) {
      alert("Login failed");
    }
  };

  const handleNotesExtract = async () => {
    if (!notes.trim()) return;
    setIngestBusy(true);
    const payload = extractEntitiesFromText(notes.trim());
    if (payload.nodes.length) {
      mergeGraphData(payload.nodes, payload.links);
      setSelectedNodeId(payload.nodes[payload.nodes.length - 1].id);
      addMessage({
        role: "agent",
        text: `Structured ${payload.nodes.length} entity${payload.nodes.length === 1 ? "" : "ies"} from your notes via GStack and saved them to GBrain.`,
      });
    } else {
      addMessage({
        role: "system",
        text: "I read that text but couldn't identify distinct founders or companies. Try adding explicit labels like 'Company:' or 'Founder:'.",
      });
    }
    setNotes("");
    setIngestBusy(false);
  };

  const handleFiles = async (fileList: FileList | File[]) => {
    const files = Array.from(fileList);
    if (!files.length) return;
    setIngestBusy(true);
    for (const file of files) {
      const content = await file.text();
      const payload = extractEntitiesFromText(
        `[File: ${file.name}]\n${content}`,
      );
      if (payload.nodes.length) {
        mergeGraphData(payload.nodes, payload.links);
        setSelectedNodeId(payload.nodes[payload.nodes.length - 1].id);
        addMessage({
          role: "agent",
          text: `Parsed ${file.name} and created ${payload.nodes.length} node${payload.nodes.length === 1 ? "" : "s"}.`,
        });
      }
    }
    setIngestBusy(false);
  };

  const scanWebsite = async (target?: string) => {
    if (!token) {
      setError("Please login first");
      return;
    }
    const rawInput = (target ?? website).trim();
    if (!rawInput) {
      setError("Enter a company website");
      return;
    }

    try {
      const normalized = normalizeWebsite(rawInput);
      setWebsite(normalized.url);
      setError(null);
      const nodeId = `company:${normalized.domain}`;

      // Check cache first
      const cached = scannedCache.get(nodeId);
      if (cached) {
        mergeGraphData([cached], []);
        setSelectedNodeId(nodeId);
        addMessage({
          role: "agent",
          text: `Loaded ${cached.label} from cache (${cached.signals?.length || 0} signals).`,
        });
        return;
      }

      setScanBusy(true);
      const res = await fetch(`${API_URL}/api/hog/scan`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ website: normalized.url }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Unable to scan website");
      }
      const signals: HogSignal[] = Array.isArray(data.signals)
        ? data.signals
        : [];

      // Infer sector from signals/domain
      const sector = inferSector(normalized.domain, signals);

      const node: BrainNode = {
        id: nodeId,
        type: "company",
        label: titleFromDomain(normalized.domain),
        website: normalized.url,
        summary: `The Hog streamed ${signals.length} signal${signals.length === 1 ? "" : "s"} over the past 30 days.`,
        tags: dedupe(signals.map((signal) => signal.source)),
        signals,
        source: "hog",
        sector,
      };

      // Cache the result
      setScannedCache((prev) => new Map(prev).set(nodeId, node));

      mergeGraphData([node], []);
      setSelectedNodeId(nodeId);
      addMessage({
        role: "agent",
        text: `Synced ${signals.length} Hog signal${signals.length === 1 ? "" : "s"} for ${node.label}.`,
      });
    } catch (err: any) {
      setError(err.message || "Scan failed");
    } finally {
      setScanBusy(false);
    }
  };

  const respondWithSummary = useCallback(
    (prompt: string) => {
      const summary = `GBrain currently tracks ${companies.length} compan${companies.length === 1 ? "y" : "ies"} and ${founders.length} founder${founders.length === 1 ? "" : "s"}.`;
      const focus = selectedNode ? ` Focus: ${selectedNode.label}.` : "";
      const signals = selectedNode?.signals?.length
        ? ` ${selectedNode.signals.length} Hog signal${selectedNode.signals.length === 1 ? "" : "s"} attached.`
        : "";
      addMessage({
        role: "agent",
        text: `${summary}${focus}${signals}\n\nPrompt: "${prompt}"\n(Stubbed response – wire this to a GStack conversation skill for real answers.)`,
      });
    },
    [companies.length, founders.length, selectedNode],
  );

  const handleSendAgentMessage = () => {
    if (!agentInput.trim()) return;
    const prompt = agentInput.trim();
    addMessage({ role: "user", text: prompt });
    setAgentInput("");
    setTimeout(() => respondWithSummary(prompt), 400);
  };

  if (!token) {
    return (
      <div className="login-container">
        <div className="login-box">
          <h1>⬡ DealFlow Brain</h1>
          <p>Authenticate to collaborate with the shared VC brain.</p>
          <form onSubmit={login}>
            <input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button type="submit">Enter the brain</button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className={`brain-app ${theme}`}>
      <header className="brain-header">
        <div className="logo">
          <span className="logo-mark">⬡</span>
          <div>
            <p className="logo-title">VaultBrain</p>
            <p className="logo-tag">GBrain × GStack × The Hog</p>
          </div>
        </div>
        <div className="header-actions">
          <button
            className="ghost-btn"
            onClick={toggleTheme}
            title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
          >
            {theme === "dark" ? "☀️" : "🌙"}
          </button>
          <span className="user-chip">
            {user?.name} · {user?.role}
          </span>
          <button
            className="ghost-btn"
            onClick={() => {
              setToken(null);
              localStorage.removeItem("token");
            }}
          >
            Logout
          </button>
        </div>
      </header>

      <div className="brain-layout">
        <aside className="brain-sidebar">
          <div className="sidebar-header">
            <div>
              <p className="sidebar-label">Brain Book</p>
              <h4>
                {graphData.nodes.length || "No"} tracked entit
                {graphData.nodes.length === 1 ? "y" : "ies"}
              </h4>
            </div>
            <span className="sidebar-pill">Live</span>
          </div>

          <div className="sidebar-section">
            <p className="section-label">Founders · {founders.length}</p>
            {founders.length === 0 && (
              <p className="section-empty">
                Drop notes to create founder pages.
              </p>
            )}
            {founders.map((founder) => (
              <button
                key={founder.id}
                className={`entity-item ${selectedNodeId === founder.id ? "active" : ""}`}
                onClick={() => setSelectedNodeId(founder.id)}
              >
                <span className="entity-icon founder">ƒ</span>
                <div>
                  <p className="entity-name">{founder.label}</p>
                  <p className="entity-meta">
                    {founder.stage || "Unknown stage"}
                  </p>
                </div>
              </button>
            ))}
          </div>

          <div className="sidebar-section">
            <p className="section-label">Companies · {companies.length}</p>
            {companies.length === 0 && (
              <p className="section-empty">
                Scan a website or mention "Company:" in text to add one.
              </p>
            )}
            {companies.map((company) => (
              <button
                key={company.id}
                className={`entity-item ${selectedNodeId === company.id ? "active" : ""}`}
                onClick={() => setSelectedNodeId(company.id)}
              >
                <span className="entity-icon company">◎</span>
                <div>
                  <p className="entity-name">{company.label}</p>
                  <p className="entity-meta">
                    {company.sector || "Unknown sector"}
                  </p>
                </div>
              </button>
            ))}
          </div>
        </aside>

        <main className="brain-main">
          <section
            className={`drop-surface ${dragging ? "drag-active" : ""}`}
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={(event) => {
              event.preventDefault();
              setDragging(false);
            }}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              if (event.dataTransfer.files?.length) {
                handleFiles(event.dataTransfer.files);
              } else if (event.dataTransfer.getData("text")) {
                const payload = extractEntitiesFromText(
                  event.dataTransfer.getData("text"),
                );
                mergeGraphData(payload.nodes, payload.links);
              }
            }}
          >
            <div>
              <p className="drop-title">Drop anything into the brain</p>
              <p className="drop-sub">
                Pitch decks · meeting notes · email threads · LinkedIn bios ·
                raw research
              </p>
            </div>
            <div className="drop-chips">
              <span>.pdf</span>
              <span>.txt</span>
              <span>.eml</span>
              <span>paste text</span>
              <span>agent logs</span>
            </div>
            <label className="drop-upload">
              Upload files
              <input
                type="file"
                multiple
                onChange={(event) => {
                  if (event.target.files) {
                    handleFiles(event.target.files);
                    event.target.value = "";
                  }
                }}
              />
            </label>
          </section>

          <section className="text-ingest">
            <textarea
              className="notes-input"
              rows={4}
              value={notes}
              placeholder="Or paste raw text here — label sections with Company:, Founder:, Stage:, Website:, etc."
              onChange={(event) => setNotes(event.target.value)}
            />
            <div className="text-actions">
              <button
                className="primary-btn"
                disabled={ingestBusy}
                onClick={handleNotesExtract}
              >
                {ingestBusy ? "Extracting…" : "Extract to Brain"}
              </button>
              <div className="website-row">
                <input
                  type="url"
                  value={website}
                  onChange={(event) => setWebsite(event.target.value)}
                  placeholder="https://company.com"
                />
                <button
                  className="ghost-btn"
                  onClick={() => scanWebsite()}
                  disabled={scanBusy}
                >
                  {scanBusy ? "Scanning…" : "Scan with The Hog"}
                </button>
              </div>
            </div>
            {error && <p className="error-text">{error}</p>}
          </section>

          <section className="graph-panel">
            <div className="panel-header">
              <div>
                <p className="panel-label">Live knowledge graph</p>
                <h3>
                  {graphData.nodes.length} nodes · {graphData.links.length}{" "}
                  links
                </h3>
              </div>
              <p className="panel-meta">Synced via GBrain + GStack agents</p>
            </div>
            <div className="graph-viewport" ref={graphRef}>
              {graphData.nodes.length ? (
                <ForceGraph2D<BrainNode, BrainLink>
                  width={graphSize.width}
                  height={graphSize.height}
                  backgroundColor="transparent"
                  graphData={graphData}
                  nodeAutoColorBy="type"
                  linkColor={() => "rgba(255,255,255,0.12)"}
                  nodeCanvasObject={(
                    node: NodeObject<BrainNode> & { x?: number; y?: number },
                    ctx: CanvasRenderingContext2D,
                    globalScale: number,
                  ) => {
                    const label = node.label;
                    const fontSize = 12 / globalScale;
                    ctx.font = `${fontSize}px 'Space Grotesk', sans-serif`;
                    ctx.fillStyle =
                      node.type === "company" ? "#2dd4bf" : "#f472b6";
                    ctx.beginPath();
                    ctx.arc(node.x ?? 0, node.y ?? 0, 5, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.fillStyle = "#dee4fd";
                    ctx.fillText(label, (node.x ?? 0) + 8, (node.y ?? 0) + 4);
                  }}
                  onNodeClick={(node: NodeObject<BrainNode>) => {
                    if (typeof node.id === "string") {
                      setSelectedNodeId(node.id);
                    }
                  }}
                />
              ) : (
                <div className="graph-empty">
                  <p>Upload something or run a Hog scan to grow the graph.</p>
                </div>
              )}
            </div>
          </section>

          <section className="entity-card">
            {selectedNode ? (
              <div>
                <div className="card-header">
                  <div>
                    <p className="pill subtle">{selectedNode.type}</p>
                    <h2>{selectedNode.label}</h2>
                    <p className="card-sub">
                      {selectedNode.type === "company"
                        ? selectedNode.sector || "Unknown sector"
                        : selectedNode.stage || ""}
                    </p>
                  </div>
                  {selectedNode.type === "company" && selectedNode.website && (
                    <button
                      className="ghost-btn"
                      disabled={scanBusy}
                      onClick={() => scanWebsite(selectedNode.website!)}
                    >
                      {scanBusy ? "Scanning…" : "Scan with The Hog"}
                    </button>
                  )}
                </div>
                <div className="field-grid">
                  <div>
                    <p className="field-label">Summary</p>
                    <p className="field-value">
                      {selectedNode.summary || "No summary yet"}
                    </p>
                  </div>
                  <div>
                    <p className="field-label">Tags</p>
                    <div className="tags-row">
                      {selectedNode.tags?.length
                        ? selectedNode.tags.map((tag) => (
                            <span key={tag} className="tag-chip">
                              {tag}
                            </span>
                          ))
                        : "No tags"}
                    </div>
                  </div>
                  {selectedNode.website && (
                    <div>
                      <p className="field-label">Website</p>
                      <a
                        className="field-link"
                        href={selectedNode.website}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {selectedNode.website}
                      </a>
                    </div>
                  )}
                  {selectedNode.lastContact && (
                    <div>
                      <p className="field-label">Last contact</p>
                      <p className="field-value">{selectedNode.lastContact}</p>
                    </div>
                  )}
                </div>
                {/* VC-focused metrics */}
                {selectedNode.type === "company" && (
                  <div className="vc-metrics">
                    <h4>VC Investment Criteria</h4>
                    <div className="metric-grid">
                      <div className="metric-item">
                        <p className="metric-label">Market Size</p>
                        <p className="metric-value">
                          {selectedNode.signals?.some((s) =>
                            s.content.toLowerCase().includes("market"),
                          )
                            ? "Large TAM signals detected"
                            : "Unknown"}
                        </p>
                      </div>
                      <div className="metric-item">
                        <p className="metric-label">Traction</p>
                        <p className="metric-value">
                          {selectedNode.signals?.filter(
                            (s) => s.type === "mentions",
                          ).length || 0}{" "}
                          mentions
                        </p>
                      </div>
                      <div className="metric-item">
                        <p className="metric-label">Team Quality</p>
                        <p className="metric-value">
                          {selectedNode.signals?.some(
                            (s) =>
                              s.content.toLowerCase().includes("hire") ||
                              s.content.toLowerCase().includes("team"),
                          )
                            ? "Hiring activity detected"
                            : "Unknown"}
                        </p>
                      </div>
                      <div className="metric-item">
                        <p className="metric-label">Product/Market Fit</p>
                        <p className="metric-value">
                          {selectedNode.signals?.some(
                            (s) => s.type === "product",
                          )
                            ? "Product signals found"
                            : "Unknown"}
                        </p>
                      </div>
                      <div className="metric-item">
                        <p className="metric-label">Competitive Moat</p>
                        <p className="metric-value">
                          {selectedNode.sector || "Unknown sector"}
                        </p>
                      </div>
                      <div className="metric-item">
                        <p className="metric-label">Funding Status</p>
                        <p className="metric-value">
                          {selectedNode.signals?.some(
                            (s) => s.type === "funding",
                          )
                            ? "Recent funding activity"
                            : selectedNode.stage || "Unknown"}
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                <div className="signals-block">
                  <div className="signals-header">
                    <h4>Signals feed</h4>
                    <span className="pill small">
                      {selectedNode.signals?.length || 0} entries
                    </span>
                  </div>
                  {selectedNode.signals?.length ? (
                    <div className="signal-list">
                      {selectedNode.signals.map((signal, index) => (
                        <article
                          key={`${signal.source}-${index}`}
                          className="signal-card"
                        >
                          <div className="signal-meta-row">
                            <span className="tag-chip">{signal.source}</span>
                            <span className="tag-chip ghost">
                              {signal.type}
                            </span>
                            <span className="signal-date">
                              {signal.timestamp
                                ? new Date(signal.timestamp).toLocaleString()
                                : ""}
                            </span>
                          </div>
                          <p className="signal-content">{signal.content}</p>
                          {signal.url && (
                            <a
                              className="signal-link"
                              href={signal.url}
                              target="_blank"
                              rel="noreferrer"
                            >
                              View source →
                            </a>
                          )}
                          {signal.engagement &&
                            Object.keys(signal.engagement).length > 0 && (
                              <div className="engagement-stats">
                                {Object.entries(signal.engagement).map(
                                  ([key, value]) => (
                                    <span key={key} className="engagement-item">
                                      {key}: {value}
                                    </span>
                                  ),
                                )}
                              </div>
                            )}
                        </article>
                      ))}
                    </div>
                  ) : (
                    <p className="muted">
                      No signals yet — run a Hog scan or add more research.
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <div className="card-empty">
                <p className="pill subtle">Ready</p>
                <h2>Select a node</h2>
                <p>
                  Choose a founder or company to inspect compiled truth, tags,
                  and Hog signals.
                </p>
              </div>
            )}
          </section>
        </main>

        <aside className="agent-panel">
          <div className="agent-header">
            <div>
              <p className="panel-label">Brain Agent</p>
              <h4>Online</h4>
            </div>
            <div className="agent-status">
              <span className="status-dot" />
              <span>Streaming via GStack</span>
            </div>
          </div>
          <div className="quick-asks">
            <button
              onClick={() => {
                const prompt = "Who's most active in our pipeline?";
                setAgentInput(prompt);
                handleSendAgentMessage();
              }}
            >
              Who's most active?
            </button>
            <button
              onClick={() => {
                const prompt = "What signals has The Hog found this week?";
                setAgentInput(prompt);
                handleSendAgentMessage();
              }}
            >
              Hog signals
            </button>
            <button
              onClick={() => {
                const prompt =
                  "Summarize everything we know about our top founders";
                setAgentInput(prompt);
                handleSendAgentMessage();
              }}
            >
              Summaries
            </button>
            <button
              onClick={() => {
                const prompt = "What warm intro paths exist right now?";
                setAgentInput(prompt);
                handleSendAgentMessage();
              }}
            >
              Warm paths
            </button>
          </div>
          <div className="agent-messages">
            {messages.map((message, index) => (
              <div key={index} className={`msg ${message.role}`}>
                <p className="msg-label">{message.role}</p>
                <p>{message.text}</p>
              </div>
            ))}
          </div>
          <div className="agent-input-row">
            <textarea
              rows={2}
              placeholder="Ask the brain anything..."
              value={agentInput}
              onChange={(event) => setAgentInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  handleSendAgentMessage();
                }
              }}
            />
            <button className="primary-btn" onClick={handleSendAgentMessage}>
              ↑
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}

export default App;

function normalizeWebsite(value: string): { url: string; domain: string } {
  const trimmed = value.trim();
  const withProtocol = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  const parsed = new URL(withProtocol);
  return { url: parsed.origin, domain: parsed.hostname };
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "");
}

function titleFromDomain(domain: string): string {
  return domain
    .replace(/^www\./, "")
    .split(".")[0]
    .replace(/-/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function dedupe<T>(values: T[]): T[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function inferSector(domain: string, signals: HogSignal[]): string {
  const domainLower = domain.toLowerCase();
  const signalText = signals.map((s) => s.content.toLowerCase()).join(" ");

  // AI/ML
  if (
    domainLower.includes("ai") ||
    signalText.includes("artificial intelligence") ||
    signalText.includes("machine learning")
  ) {
    return "AI/ML";
  }
  // Fintech
  if (
    domainLower.includes("pay") ||
    domainLower.includes("bank") ||
    signalText.includes("fintech") ||
    signalText.includes("payment")
  ) {
    return "Fintech";
  }
  // Healthcare
  if (
    domainLower.includes("health") ||
    domainLower.includes("med") ||
    signalText.includes("healthcare") ||
    signalText.includes("biotech")
  ) {
    return "Healthcare";
  }
  // SaaS
  if (
    signalText.includes("saas") ||
    signalText.includes("software as a service") ||
    signalText.includes("b2b")
  ) {
    return "SaaS";
  }
  // E-commerce
  if (
    signalText.includes("ecommerce") ||
    signalText.includes("marketplace") ||
    signalText.includes("retail")
  ) {
    return "E-commerce";
  }
  // Developer Tools
  if (
    signalText.includes("developer") ||
    signalText.includes("devtools") ||
    signalText.includes("api")
  ) {
    return "Dev Tools";
  }

  return "Other";
}

function mergeSignals(
  existing?: HogSignal[],
  incoming?: HogSignal[],
): HogSignal[] | undefined {
  if (!existing && !incoming) return undefined;
  const combined = [...(existing ?? []), ...(incoming ?? [])];
  const seen = new Set<string>();
  return combined.filter((signal) => {
    const key = `${signal.source}-${signal.type}-${signal.content}-${signal.timestamp}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function mergeNode(
  existing: BrainNode | undefined,
  incoming: BrainNode,
): BrainNode {
  if (!existing) {
    return {
      ...incoming,
      tags: incoming.tags ? dedupe(incoming.tags) : undefined,
    };
  }
  return {
    ...existing,
    ...incoming,
    tags: dedupe([...(existing.tags ?? []), ...(incoming.tags ?? [])]),
    signals: mergeSignals(existing.signals, incoming.signals),
  };
}

function parseTags(text?: string): string[] {
  if (!text) return [];
  return text
    .split(/[,|]/)
    .map((value) => value.trim())
    .filter(Boolean);
}

function guessCompany(lines: string[]): string | undefined {
  for (const line of lines) {
    const match = line.match(/Company\s*[:\-]\s*(.+)/i);
    if (match) return match[1].trim();
  }
  return undefined;
}

function guessFounder(lines: string[]): string | undefined {
  for (const line of lines) {
    const match = line.match(/Founder\s*[:\-]\s*(.+)/i);
    if (match) return match[1].trim();
  }
  return undefined;
}

function extractEntitiesFromText(text: string): GraphPayload {
  const blocks = text
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean);
  const nodes: BrainNode[] = [];
  const links: BrainLink[] = [];

  blocks.forEach((block) => {
    const lines = block
      .split(/\n|;/)
      .map((line) => line.trim())
      .filter(Boolean);
    const map = new Map<string, string>();
    lines.forEach((line) => {
      const match = line.match(/^([A-Za-z /]+)\s*[:\-]\s*(.+)$/);
      if (match) {
        map.set(match[1].toLowerCase(), match[2].trim());
      }
    });

    const companyName =
      map.get("company") || map.get("startup") || guessCompany(lines);
    const founderName =
      map.get("founder") || map.get("ceo") || guessFounder(lines);

    if (companyName) {
      const companyId = `company:${slugify(companyName)}`;
      nodes.push({
        id: companyId,
        type: "company",
        label: companyName,
        sector: map.get("sector") || map.get("industry"),
        stage: map.get("stage") || map.get("round"),
        website: map.get("website"),
        summary: map.get("summary") || block.slice(0, 180),
        tags: parseTags(map.get("tags") || map.get("focus")),
        source: "user",
      });
      if (founderName) {
        const founderId = `founder:${slugify(founderName)}`;
        nodes.push({
          id: founderId,
          type: "founder",
          label: founderName,
          stage: map.get("stage"),
          summary: map.get("bio") || block.slice(0, 160),
          tags: parseTags(map.get("traits")),
          source: "user",
        });
        links.push({
          source: founderId,
          target: companyId,
          relation: "builds",
        });
      }
    } else if (founderName) {
      nodes.push({
        id: `founder:${slugify(founderName)}`,
        type: "founder",
        label: founderName,
        summary: map.get("bio") || block.slice(0, 160),
        tags: parseTags(map.get("tags")),
        source: "user",
      });
    }
  });

  return { nodes, links };
}
