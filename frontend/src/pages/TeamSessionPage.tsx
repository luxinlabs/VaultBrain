import { useState } from "react";
import "../App.css";

interface Props {
  onBack: () => void;
  entities: Array<{ id: string; label: string; type: "company" | "founder" }>;
}

interface Skill {
  id: string;
  icon: string;
  title: string;
  description: string;
  agentHandle: string;
  applicableTo: Array<"company" | "founder" | "both">;
}

const SKILLS: Skill[] = [
  {
    id: "vc-criteria",
    icon: "📊",
    title: "VC Investment Criteria",
    description:
      "Analyse market size, traction, team quality, PMF, and funding status based on available signals.",
    agentHandle: "@analyst",
    applicableTo: ["company"],
  },
  {
    id: "hog-scan",
    icon: "📡",
    title: "Live Hog Signal Scan",
    description:
      "Fetch the latest 30-day signals from web, news, LinkedIn, and social media.",
    agentHandle: "@hog",
    applicableTo: ["company", "founder"],
  },
  {
    id: "competitor-map",
    icon: "🗺️",
    title: "Competitive Landscape",
    description:
      "Identify direct and adjacent competitors, differentiation, and moat signals.",
    agentHandle: "@gbrain",
    applicableTo: ["company"],
  },
  {
    id: "founder-background",
    icon: "👤",
    title: "Founder Background Check",
    description:
      "Summarise prior exits, notable roles, technical depth, and domain expertise.",
    agentHandle: "@analyst",
    applicableTo: ["founder"],
  },
  {
    id: "timeline",
    icon: "📅",
    title: "Timeline Summary",
    description:
      "Chronological summary of all key events: funding, hires, launches, and press.",
    agentHandle: "@timeline",
    applicableTo: ["company", "founder"],
  },
  {
    id: "warm-paths",
    icon: "🤝",
    title: "Warm Introduction Paths",
    description:
      "Find connection paths between this entity and your network via GBrain links.",
    agentHandle: "@gbrain",
    applicableTo: ["company", "founder"],
  },
  {
    id: "dd-checklist",
    icon: "✅",
    title: "Due Diligence Checklist",
    description:
      "Generate an initial DD checklist from entity data and outstanding questions.",
    agentHandle: "@analyst",
    applicableTo: ["company"],
  },
  {
    id: "token-compare",
    icon: "🔬",
    title: "Token-Optimised Summary",
    description:
      "Generate a compressed brief optimised for sharing with LLMs or other agents.",
    agentHandle: "@gbrain",
    applicableTo: ["company", "founder"],
  },
];

interface SessionMessage {
  author: string;
  text: string;
  timestamp: string;
  isAgent: boolean;
}

export default function TeamSessionPage({ onBack, entities }: Props) {
  const [selectedId, setSelectedId] = useState<string>(entities[0]?.id ?? "");
  const [activeSkills, setActiveSkills] = useState<Set<string>>(new Set());
  const [messages, setMessages] = useState<SessionMessage[]>([
    {
      author: "System",
      text: "Session started. Select an entity and activate skills to begin.",
      timestamp: new Date().toLocaleTimeString(),
      isAgent: true,
    },
  ]);
  const [input, setInput] = useState("");
  const [notes, setNotes] = useState("");

  const selected = entities.find((e) => e.id === selectedId);

  const availableSkills = SKILLS.filter(
    (s) =>
      !selected ||
      s.applicableTo.includes(selected.type) ||
      s.applicableTo.includes("both"),
  );

  const toggleSkill = (skillId: string) => {
    setActiveSkills((prev) => {
      const next = new Set(prev);
      const skill = SKILLS.find((s) => s.id === skillId)!;
      if (next.has(skillId)) {
        next.delete(skillId);
      } else {
        next.add(skillId);
        setMessages((m) => [
          ...m,
          {
            author: skill.agentHandle,
            text: `Running "${skill.title}" for ${selected?.label ?? "entity"}... (wire to GStack for live results)`,
            timestamp: new Date().toLocaleTimeString(),
            isAgent: true,
          },
        ]);
      }
      return next;
    });
  };

  const sendMessage = () => {
    if (!input.trim()) return;
    const text = input.trim();
    setInput("");
    setMessages((m) => [
      ...m,
      {
        author: "You",
        text,
        timestamp: new Date().toLocaleTimeString(),
        isAgent: false,
      },
    ]);
    setTimeout(() => {
      setMessages((m) => [
        ...m,
        {
          author: "@gbrain",
          text: `Re: "${text}" — context loaded from GBrain for ${selected?.label ?? "selected entity"}. (Stub — connect GStack for AI responses.)`,
          timestamp: new Date().toLocaleTimeString(),
          isAgent: true,
        },
      ]);
    }, 500);
  };

  const deleteEntity = () => {
    if (!selected) return;
    if (!confirm(`Delete "${selected.label}" from this session?`)) return;
    // Reset session state
    setMessages([
      {
        author: "System",
        text: `Deleted "${selected.label}". Select another entity to continue.`,
        timestamp: new Date().toLocaleTimeString(),
        isAgent: true,
      },
    ]);
    setActiveSkills(new Set());
    setNotes("");
    setSelectedId("");
  };

  return (
    <div className="session-page">
      <div className="session-header">
        <div>
          <p className="panel-label">Team Session</p>
          <h1>{selected ? selected.label : "Select an entity to start"}</h1>
          {selected && (
            <p
              className="pill subtle"
              style={{ display: "inline-block", marginTop: "0.4rem" }}
            >
              {selected.type}
            </p>
          )}
        </div>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          {selected && (
            <button
              className="ghost-btn"
              onClick={deleteEntity}
              style={{ color: "#f87171" }}
              title="Delete this entity from the session"
            >
              Delete
            </button>
          )}
          <button className="ghost-btn" onClick={onBack}>
            Back
          </button>
        </div>
      </div>

      <div className="session-layout">
        {/* Left: entity selector + skill cards */}
        <aside className="session-sidebar">
          <div className="session-section">
            <p className="section-label">Choose entity</p>
            <div className="entity-selector">
              {entities.length === 0 && (
                <p className="muted">No entities in graph yet.</p>
              )}
              {entities.map((e) => (
                <button
                  key={e.id}
                  className={`entity-item ${selectedId === e.id ? "active" : ""}`}
                  onClick={() => setSelectedId(e.id)}
                >
                  <span className={`entity-icon ${e.type}`}>
                    {e.type === "company" ? "◎" : "ƒ"}
                  </span>
                  <div>
                    <p className="entity-name">{e.label}</p>
                    <p className="entity-meta">{e.type}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="session-section">
            <p className="section-label">
              Prepared skills ({activeSkills.size} active)
            </p>
            <div className="skill-list">
              {availableSkills.map((skill) => (
                <button
                  key={skill.id}
                  className={`skill-card ${activeSkills.has(skill.id) ? "active" : ""}`}
                  onClick={() => toggleSkill(skill.id)}
                >
                  <div className="skill-top">
                    <span className="skill-icon">{skill.icon}</span>
                    <code className="skill-handle">{skill.agentHandle}</code>
                  </div>
                  <p className="skill-title">{skill.title}</p>
                  <p className="skill-desc">{skill.description}</p>
                </button>
              ))}
            </div>
          </div>
        </aside>

        {/* Center: discussion + notes */}
        <main className="session-main">
          <div className="session-chat">
            <div className="session-messages">
              {messages.map((msg, i) => (
                <div
                  key={i}
                  className={`session-msg ${msg.isAgent ? "agent" : "user"}`}
                >
                  <div className="session-msg-meta">
                    <strong>{msg.author}</strong>
                    <span className="signal-date">{msg.timestamp}</span>
                  </div>
                  <p>{msg.text}</p>
                </div>
              ))}
            </div>
            <div className="agent-input-row">
              <input
                type="text"
                placeholder="Ask about this entity or @mention an agent..."
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && sendMessage()}
              />
              <button
                className="primary-btn"
                onClick={sendMessage}
                disabled={!input.trim()}
              >
                Send
              </button>
            </div>
          </div>

          <div className="session-notes">
            <p className="section-label">Session notes</p>
            <textarea
              className="session-notes-area"
              placeholder="Shared notes for this session (not persisted yet)..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={8}
            />
          </div>
        </main>
      </div>
    </div>
  );
}
