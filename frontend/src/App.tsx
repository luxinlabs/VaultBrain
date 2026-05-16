import ForceGraph2D, { NodeObject } from "react-force-graph-2d";
import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import "./App.css";
import InstructionPage from "./pages/InstructionPage";
import TeamSessionPage from "./pages/TeamSessionPage";
import CollabPadPage from "./pages/CollabPadPage";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001";

interface User {
  id: string;
  email: string;
  name: string;
  role: "partner" | "analyst";
}

interface InvestmentCriteria {
  marketSize: string;
  traction: string;
  teamQuality: string;
  productMarketFit: string;
  competitiveMoat: string;
  fundingStatus: string;
}

function computeInvestmentCriteria(
  content: string,
  timeline: TimelineEntry[],
  signals: HogSignal[],
  fallbackSector?: string,
) {
  const text =
    `${content} ${signals.map((s) => s.content).join(" ")}`.toLowerCase();
  const timelineText = timeline
    .map((t) => t.description)
    .join(" ")
    .toLowerCase();
  const combined = `${text} ${timelineText}`;

  const marketKeywords = [
    "market",
    "tam",
    "billion",
    "customer",
    "consumer",
    "enterprise",
    "utilities",
  ];
  const hasMarketSignal = marketKeywords.some((kw) => combined.includes(kw));

  const tractionMentions =
    signals.filter((s) =>
      ["mentions", "press", "product", "funding"].includes(s.type),
    ).length +
    timeline.filter((entry) =>
      ["mentions", "press", "product"].includes(entry.event_type),
    ).length;

  const teamKeywords = ["hire", "team", "headcount", "engineer"];
  const hasTeamSignal = teamKeywords.some((kw) => combined.includes(kw));

  const pmfKeywords = ["launched", "pilot", "customers", "deploy", "live"];
  const hasPmfSignal = pmfKeywords.some((kw) => combined.includes(kw));

  const fundingEntry = timeline.find((entry) => entry.event_type === "funding");
  const hasFundingSignal =
    hasKeyword(signals, "funding") || Boolean(fundingEntry);

  return {
    marketSize: hasMarketSignal
      ? "Customer/TAM references detected"
      : "Unknown",
    traction: tractionMentions
      ? `${tractionMentions} public mentions`
      : "Early — no public mentions",
    teamQuality: hasTeamSignal ? "Active hiring signals" : "Unknown",
    productMarketFit: hasPmfSignal ? "Launches & pilots reported" : "Unknown",
    competitiveMoat: fallbackSector || "Unique positioning TBD",
    fundingStatus: hasFundingSignal
      ? fundingEntry?.description || "Recent funding activity"
      : "Unknown",
  };
}

function extractExperiencePoints(
  content: string,
  timeline: TimelineEntry[],
): string[] {
  const sentences = content
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  const keywords = ["previously", "before", "led", "founded", "worked"];
  const matched = sentences.filter((sentence) =>
    keywords.some((kw) => sentence.toLowerCase().includes(kw)),
  );
  if (!matched.length) {
    const timelineNotes = timeline
      .filter((entry) => entry.event_type !== "signal")
      .map((entry) => entry.description);
    return dedupe(timelineNotes).slice(0, 5);
  }
  return dedupe(matched).slice(0, 5);
}

function hasKeyword(signals: HogSignal[], keyword: string): boolean {
  return signals.some((signal) =>
    signal.content.toLowerCase().includes(keyword.toLowerCase()),
  );
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
  investmentInsights?: InvestmentCriteria;
  timeline?: TimelineEntry[];
}

interface BrainLink {
  source: string;
  target: string;
  relation: string;
}

interface TimelineEntry {
  timestamp: string;
  event_type: string;
  description: string;
  source: string;
  source_url?: string;
  metadata?: Record<string, any>;
}

interface NodeDetail {
  page: { content?: string; tags?: unknown } | null;
  timeline: TimelineEntry[];
  signals: HogSignal[];
  contributors: any[];
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

type OptimizationMode = "none" | "conservative" | "balanced" | "aggressive";

interface TokenComparisonMetrics {
  originalTokens: number;
  optimizedTokens: number;
  savings: number;
  savingsPercent: number;
  technique?: string;
}

interface TokenComparisonResult {
  comparison: Record<OptimizationMode, TokenComparisonMetrics>;
  examples: Record<string, string>;
  recommendation: OptimizationMode;
}

const DEFAULT_TOKEN_TEXT =
  "The Hog is a real-time web intelligence platform that streams signals about companies, founders, and market trends. It provides comprehensive data enrichment, competitive analysis, and investment insights for venture capital firms.";

function App() {
  const [token, setToken] = useState<string | null>(
    localStorage.getItem("token"),
  );
  const [user, setUser] = useState<User | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [website, setWebsite] = useState("https://thehog.ai");
  const [hogSearchMode, setHogSearchMode] = useState<"company" | "people">(
    "company",
  );
  const [hogResults, setHogResults] = useState<{
    type: "company" | "people";
    items: any[];
  } | null>(null);
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
    (localStorage.getItem("theme") as "light" | "dark") || "light",
  );
  const [scannedCache, setScannedCache] = useState<Map<string, BrainNode>>(
    new Map(),
  );
  const [nodeDetails, setNodeDetails] = useState<Record<string, NodeDetail>>(
    {},
  );
  const [loadingNodeId, setLoadingNodeId] = useState<string | null>(null);
  const [view, setView] = useState<
    "brain" | "token" | "guide" | "session" | "collab"
  >("brain");
  const [tokenText, setTokenText] = useState(DEFAULT_TOKEN_TEXT);
  const [tokenComparisonResult, setTokenComparisonResult] =
    useState<TokenComparisonResult | null>(null);
  const [tokenTesting, setTokenTesting] = useState(false);

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

  const loadGraphData = useCallback(async () => {
    if (!token) {
      setGraphData({ nodes: [], links: [] });
      return;
    }

    try {
      const res = await fetch(`${API_URL}/api/pages`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to load saved entities");
      const data = await res.json();
      const nodes: BrainNode[] = (data.nodes || []).map((node: any) => {
        const tags = parseStoredTags(node.tags);
        const nodeType = node.slug.startsWith("company:")
          ? "company"
          : node.slug.startsWith("founder:")
            ? "founder"
            : node.type === "company"
              ? "company"
              : "founder";
        const sector =
          nodeType === "company" ? inferSector(node.slug, []) : undefined;
        return {
          id: node.slug,
          label: node.title,
          type: nodeType,
          summary: stripFrontmatter(node.content || "").slice(0, 220),
          tags,
          sector,
          source: "gbrain",
        };
      });
      const links: BrainLink[] = (data.links || []).map((link: any) => ({
        source: link.from_slug,
        target: link.to_slug,
        relation: link.link_type,
      }));
      setGraphData({ nodes, links });
    } catch (error) {
      console.error("Failed to hydrate graph", error);
    }
  }, [token]);

  useEffect(() => {
    loadGraphData();
  }, [loadGraphData]);

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

  const selectedDetail = selectedNodeId ? nodeDetails[selectedNodeId] : null;
  const selectedSignals = selectedDetail?.signals?.length
    ? selectedDetail.signals
    : selectedNode?.signals || [];
  const selectedTimeline = selectedDetail?.timeline || [];
  const selectedSummaryText =
    selectedDetail?.page?.content || selectedNode?.summary || "";
  const hasDetail = selectedNodeId
    ? Boolean(nodeDetails[selectedNodeId])
    : false;

  useEffect(() => {
    if (!selectedNodeId || hasDetail || !token) return;
    let cancelled = false;
    setLoadingNodeId(selectedNodeId);

    (async () => {
      try {
        const res = await fetch(
          `${API_URL}/api/pages/${encodeURIComponent(selectedNodeId)}`,
          {
            headers: { Authorization: `Bearer ${token}` },
          },
        );
        if (!res.ok) {
          throw new Error("Failed to load node detail");
        }
        const data = await res.json();
        if (cancelled) return;
        setNodeDetails((prev) => ({ ...prev, [selectedNodeId]: data }));
        setGraphData((prev) => ({
          nodes: prev.nodes.map((node) =>
            node.id === selectedNodeId
              ? {
                  ...node,
                  summary:
                    node.summary || data.page?.content?.slice(0, 220) || "",
                  tags: node.tags?.length
                    ? node.tags
                    : parseStoredTags(data.page?.tags),
                  signals: data.signals || node.signals,
                }
              : node,
          ),
          links: prev.links,
        }));
      } catch (detailError) {
        console.error("Failed to fetch node detail", detailError);
      } finally {
        if (!cancelled) {
          setLoadingNodeId(null);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedNodeId, token, hasDetail]);

  const tagList = useMemo(() => {
    const detailTags = selectedDetail?.page?.tags
      ? parseStoredTags(selectedDetail.page.tags)
      : [];
    return dedupe([...(selectedNode?.tags || []), ...detailTags]);
  }, [selectedDetail?.page?.tags, selectedNode?.tags]);

  const investmentMetrics = useMemo(() => {
    if (!selectedNode || selectedNode.type !== "company") return null;
    if (selectedNode.investmentInsights) return selectedNode.investmentInsights;
    return computeInvestmentCriteria(
      selectedSummaryText,
      selectedTimeline,
      selectedSignals,
      selectedNode.sector,
    );
  }, [selectedNode, selectedSummaryText, selectedTimeline, selectedSignals]);

  const founderExperience = useMemo(
    () =>
      selectedNode && selectedNode.type === "founder"
        ? extractExperiencePoints(selectedSummaryText, selectedTimeline)
        : [],
    [selectedNode, selectedSummaryText, selectedTimeline],
  );

  const linkedCompanies = useMemo(() => {
    if (!selectedNode) return [];
    const neighborIds = new Set<string>();
    graphData.links.forEach((link) => {
      const sourceId = normalizeLinkEndpoint((link as unknown as any).source);
      const targetId = normalizeLinkEndpoint((link as unknown as any).target);
      if (sourceId === selectedNode.id) neighborIds.add(targetId);
      if (targetId === selectedNode.id) neighborIds.add(sourceId);
    });
    return graphData.nodes.filter(
      (node) => neighborIds.has(node.id) && node.id !== selectedNode.id,
    );
  }, [graphData.links, graphData.nodes, selectedNode]);

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

  const persistNode = useCallback(
    async (node: BrainNode) => {
      if (!token) return;
      try {
        const content = node.summary || "";
        const tags = node.tags || [];
        const type = node.type || "note";
        const title = node.label || node.id;
        await fetch(`${API_URL}/api/pages/${encodeURIComponent(node.id)}`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            content: `---\ntype: ${type}\ntitle: ${title}\ntags: ${JSON.stringify(tags)}\n---\n\n${content}`,
          }),
        });
      } catch (err) {
        console.error("Failed to persist node", err);
      }
    },
    [token],
  );

  const handleDeleteEntity = useCallback(
    async (node: BrainNode) => {
      if (!token) return;
      const label = node.label || node.id;
      const confirmed = window.confirm(
        `Delete "${label}"? This removes the entity, links, and signals.`,
      );
      if (!confirmed) return;
      try {
        const res = await fetch(
          `${API_URL}/api/pages/${encodeURIComponent(node.id)}`,
          {
            method: "DELETE",
            headers: { Authorization: `Bearer ${token}` },
          },
        );
        if (!res.ok) {
          throw new Error("Failed to delete entity");
        }
        setGraphData((prev) => ({
          nodes: prev.nodes.filter((n) => n.id !== node.id),
          links: prev.links.filter(
            (link) =>
              normalizeLinkEndpoint(link.source) !== node.id &&
              normalizeLinkEndpoint(link.target) !== node.id,
          ),
        }));
        setNodeDetails((prev) => {
          const next = { ...prev };
          delete next[node.id];
          return next;
        });
        if (selectedNodeId === node.id) {
          setSelectedNodeId(null);
        }
      } catch (err) {
        console.error("Failed to delete entity", err);
      }
    },
    [token, selectedNodeId],
  );

  const handleEditEntity = useCallback(
    (node: BrainNode) => {
      const currentLabel = node.label || node.id;
      const newLabel = window.prompt("Update name", currentLabel);
      if (!newLabel) return;
      const trimmedLabel = newLabel.trim();
      if (!trimmedLabel || trimmedLabel === currentLabel) return;
      const newSummaryPrompt = window.prompt(
        "Update summary / notes (optional)",
        node.summary || "",
      );
      const updatedSummary =
        newSummaryPrompt === null ? node.summary || "" : newSummaryPrompt;
      const updatedNode: BrainNode = {
        ...node,
        label: trimmedLabel,
        summary: updatedSummary,
      };
      setGraphData((prev) => ({
        nodes: prev.nodes.map((n) =>
          n.id === node.id
            ? { ...n, label: trimmedLabel, summary: updatedSummary }
            : n,
        ),
        links: prev.links,
      }));
      setNodeDetails((prev) => {
        const next = { ...prev };
        delete next[node.id];
        return next;
      });
      persistNode(updatedNode);
    },
    [persistNode],
  );

  const persistLink = useCallback(
    async (link: BrainLink) => {
      if (!token) return;
      try {
        await fetch(`${API_URL}/api/links`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            from_slug: link.source,
            to_slug: link.target,
            link_type: link.relation,
          }),
        });
      } catch (err) {
        console.error("Failed to persist link", err);
      }
    },
    [token],
  );

  const mergeGraphData = useCallback(
    (incomingNodes: BrainNode[], incomingLinks: BrainLink[]) => {
      if (!incomingNodes.length && !incomingLinks.length) return;
      setGraphData((prev) => {
        const nodeMap = new Map(prev.nodes.map((node) => [node.id, node]));
        incomingNodes.forEach((node) => {
          const existing = nodeMap.get(node.id);
          nodeMap.set(node.id, mergeNode(existing, node));
          persistNode(node);
        });
        const mergedLinks = [...prev.links];
        incomingLinks.forEach((link) => {
          const exists = mergedLinks.some(
            (existing) =>
              existing.source === link.source &&
              existing.target === link.target &&
              existing.relation === link.relation,
          );
          if (!exists) {
            mergedLinks.push(link);
            persistLink(link);
          }
        });
        return { nodes: Array.from(nodeMap.values()), links: mergedLinks };
      });
    },
    [persistNode, persistLink],
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

  const runHogSearch = useCallback(
    async (query: string, mode: "company" | "people") => {
      if (!token) {
        setError("Please login first");
        return;
      }
      const trimmed = query.trim();
      if (!trimmed) {
        setError("Enter a search query or URL");
        return;
      }
      setScanBusy(true);
      setError(null);
      try {
        const endpoint = mode === "company" ? "companies" : "people";
        const res = await fetch(`${API_URL}/api/hog/search/${endpoint}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ query: trimmed }),
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(payload?.error || "Hog search failed");
        }
        const items = coerceHogResults(payload);
        setHogResults({ type: mode, items });
        addMessage({
          role: "agent",
          text: `The Hog found ${items.length} ${
            mode === "company" ? "companies" : "people"
          } for "${trimmed}".`,
        });
      } catch (err: any) {
        console.error("Hog search failed", err);
        setError(err.message || "Hog search failed");
      } finally {
        setScanBusy(false);
      }
    },
    [token, addMessage],
  );

  const scanWebsite = async (target?: string) => {
    if (!token) {
      setError("Please login first");
      return;
    }
    const rawInput = (target ?? website).trim();
    if (!rawInput) {
      setError("Enter a company website or LinkedIn profile");
      return;
    }

    try {
      const isLinkedInProfile = /linkedin\.com\/in\/([^/]+)/i.test(rawInput);
      const looksLikeUrl = /^(https?:\/\/|www\.)/i.test(rawInput);
      const manualTarget = Boolean(target);

      if (!manualTarget) {
        if (hogSearchMode === "people") {
          if (isLinkedInProfile) {
            await scanLinkedInProfile(rawInput);
          } else {
            await runHogSearch(rawInput, "people");
          }
          return;
        }
        if (isLinkedInProfile) {
          await scanLinkedInProfile(rawInput);
          return;
        }
        if (!looksLikeUrl) {
          await runHogSearch(rawInput, "company");
          return;
        }
      }

      const normalized = normalizeWebsite(rawInput);
      setWebsite(normalized.url);
      setError(null);
      setHogResults(null);
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

      const hogRes = await fetch(`${API_URL}/api/hog/scan`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ website: normalized.url }),
      });

      let signals: HogSignal[] = [];
      let hogData: any = {};

      if (hogRes.ok) {
        const data = await hogRes.json();
        hogData = data;
        signals = Array.isArray(data.signals) ? data.signals : [];
      }

      // Infer sector from signals/domain
      const sector = hogData.sector || inferSector(normalized.domain, signals);

      const node: BrainNode = {
        id: nodeId,
        type: "company",
        label: hogData.name || titleFromDomain(normalized.domain),
        website: normalized.url,
        summary:
          hogData.description ||
          (signals.length
            ? signals
                .slice(0, 3)
                .map((s: any) => s.content)
                .filter(Boolean)
                .join(" · ")
            : `The Hog streamed 0 signals over the past 30 days.`),
        tags: dedupe([
          ...signals.map((signal: any) => signal.source).filter(Boolean),
          ...(hogData.tags || []),
        ]),
        signals,
        source: "hog",
        sector,
        investmentInsights: hogData.investmentInsights,
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

  const scanLinkedInProfile = async (linkedinUrl: string) => {
    setScanBusy(true);
    setError(null);
    setHogResults(null);

    try {
      const match = linkedinUrl.match(/linkedin\.com\/in\/([^/]+)/);
      const username = match ? match[1] : "unknown";
      const founderName = username
        .replace(/-/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase());
      const founderId = `founder:${slugify(founderName)}`;

      // Check cache
      const cached = scannedCache.get(founderId);
      if (cached) {
        mergeGraphData([cached], []);
        setSelectedNodeId(founderId);
        addMessage({
          role: "agent",
          text: `Loaded ${cached.label} from cache.`,
        });
        setScanBusy(false);
        return;
      }

      // Call backend to enrich LinkedIn profile
      const res = await fetch(`${API_URL}/api/hog/enrich-person`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ linkedin_url: linkedinUrl }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Unable to enrich profile");
      }

      const signals: HogSignal[] = Array.isArray(data.signals)
        ? data.signals
        : [];
      const founderNode: BrainNode = {
        id: founderId,
        type: "founder",
        label: data.name || founderName,
        summary: data.bio || `LinkedIn: ${linkedinUrl}`,
        tags: data.skills || [],
        signals,
        source: "hog",
      };

      // Check if founder is associated with a company
      if (data.current_company) {
        const companyId = `company:${slugify(data.current_company)}`;
        const companyNode: BrainNode = {
          id: companyId,
          type: "company",
          label: data.current_company,
          summary: `${founderNode.label}'s current company`,
          source: "hog",
        };
        mergeGraphData(
          [founderNode, companyNode],
          [
            {
              source: founderId,
              target: companyId,
              relation: "works_at",
            },
          ],
        );
        setScannedCache((prev) =>
          new Map(prev).set(founderId, founderNode).set(companyId, companyNode),
        );
      } else {
        mergeGraphData([founderNode], []);
        setScannedCache((prev) => new Map(prev).set(founderId, founderNode));
      }

      setSelectedNodeId(founderId);
      addMessage({
        role: "agent",
        text: `Enriched ${founderNode.label} with ${signals.length} signal${signals.length === 1 ? "" : "s"}.`,
      });
    } catch (err: any) {
      setError(err.message || "Profile enrichment failed");
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

  const handleSendAgentMessage = (preset?: string) => {
    const prompt = (preset ?? agentInput).trim();
    if (!prompt) return;
    if (!preset) {
      setAgentInput("");
    }
    addMessage({ role: "user", text: prompt });
    setTimeout(() => respondWithSummary(prompt), 400);
  };

  const runTokenComparison = useCallback(async () => {
    if (!token) return;
    try {
      setTokenTesting(true);
      const sampleText = tokenText.trim() || DEFAULT_TOKEN_TEXT;
      const res = await fetch(`${API_URL}/api/optimization/compare`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ text: sampleText }),
      });

      if (!res.ok) {
        throw new Error("Failed to compare token optimization modes");
      }

      const result: TokenComparisonResult = await res.json();
      setTokenComparisonResult(result);
    } catch (err) {
      console.error("Token optimization test failed", err);
    } finally {
      setTokenTesting(false);
    }
  }, [token, tokenText]);

  const renderHeader = () => (
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
        {view !== "brain" && (
          <button className="ghost-btn" onClick={() => setView("brain")}>
            ← Brain
          </button>
        )}
        {view === "brain" && (
          <>
            <button
              className="ghost-btn"
              onClick={() => {
                setView("token");
                setTokenTesting(false);
                runTokenComparison();
              }}
              title="Token optimization lab"
            >
              🔬 Token Test
            </button>
            <button
              className="ghost-btn"
              onClick={() => setView("guide")}
              title="Team collaboration guide"
            >
              📖 Guide
            </button>
            <button
              className="ghost-btn"
              onClick={() => setView("session")}
              title="Team discussion session"
            >
              🧑‍💻 Session
            </button>
            <button
              className="ghost-btn"
              onClick={() => setView("collab")}
              title="Collaborative research pad"
            >
              📝 Collab Pad
            </button>
          </>
        )}
        <button
          className="ghost-btn"
          onClick={() => {
            setToken(null);
            localStorage.removeItem("token");
            setView("brain");
          }}
        >
          Logout
        </button>
      </div>
    </header>
  );

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

  if (view === "token") {
    const baseline = tokenComparisonResult?.comparison.none;
    const recommendedKey: OptimizationMode | undefined =
      tokenComparisonResult?.recommendation;
    const optimized = recommendedKey
      ? tokenComparisonResult?.comparison[recommendedKey]
      : tokenComparisonResult?.comparison.balanced;

    return (
      <div className={`brain-app ${theme}`}>
        {renderHeader()}
        <main className="token-lab">
          <section className="token-hero">
            <div>
              <p className="panel-label">Token Optimization Lab</p>
              <h1>Back-to-back comparison</h1>
              <p>
                Measure how the optimization layer compresses prompts before
                they hit GStack. Paste any memo or meeting note to compare.
              </p>
            </div>
            {optimized && (
              <div className="token-highlight">
                <p className="metric-label">Recommended mode</p>
                <p className="metric-value">{recommendedKey ?? "balanced"}</p>
                <p className="metric-sub">
                  {optimized.savingsPercent.toFixed(1)}% average savings
                </p>
              </div>
            )}
          </section>

          <section className="token-input">
            <textarea
              value={tokenText}
              onChange={(event) => setTokenText(event.target.value)}
              rows={10}
            />
            <button
              className="primary-btn"
              onClick={() => runTokenComparison()}
              disabled={tokenTesting}
            >
              {tokenTesting ? "Calculating…" : "Run comparison"}
            </button>
          </section>

          {tokenComparisonResult && baseline && optimized && (
            <>
              <section className="token-side-by-side">
                <div className="token-card baseline">
                  <p className="pill subtle">Without optimization</p>
                  <h3>{baseline.originalTokens} tokens</h3>
                  <p className="token-snippet">
                    {tokenComparisonResult.examples.original}
                  </p>
                </div>
                <div className="token-card optimized">
                  <p className="pill subtle">With optimization layer</p>
                  <h3>{optimized.optimizedTokens} tokens</h3>
                  <p className="token-savings">
                    Saved {optimized.savingsPercent.toFixed(1)}% of context
                  </p>
                  <p className="token-snippet">
                    {
                      tokenComparisonResult.examples[
                        recommendedKey || "balanced"
                      ]
                    }
                  </p>
                </div>
              </section>

              <section className="token-modes">
                <h3>Mode breakdown</h3>
                <div className="token-grid">
                  {Object.entries(tokenComparisonResult.comparison).map(
                    ([mode, metrics]) => (
                      <div key={mode} className="token-card mini">
                        <p className="mode-label">{mode}</p>
                        <p className="mode-tokens">
                          {metrics.optimizedTokens} tokens
                        </p>
                        <p className="mode-savings">
                          {metrics.savingsPercent.toFixed(1)}% saved
                        </p>
                      </div>
                    ),
                  )}
                </div>
              </section>
            </>
          )}
        </main>
      </div>
    );
  }

  if (view === "guide") {
    return (
      <div className={`brain-app ${theme}`}>
        {renderHeader()}
        <InstructionPage onBack={() => setView("brain")} />
      </div>
    );
  }

  if (view === "session") {
    const sessionEntities = graphData.nodes.map((n) => ({
      id: n.id,
      label: n.label,
      type: n.type as "company" | "founder",
    }));
    return (
      <div className={`brain-app ${theme}`}>
        {renderHeader()}
        <TeamSessionPage
          onBack={() => setView("brain")}
          entities={sessionEntities}
        />
      </div>
    );
  }

  if (view === "collab") {
    return (
      <div className={`brain-app ${theme}`}>
        {renderHeader()}
        <CollabPadPage
          onBack={() => setView("brain")}
          token={token}
          apiUrl={API_URL}
        />
      </div>
    );
  }

  return (
    <div className={`brain-app ${theme}`}>
      {renderHeader()}

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
              <div
                key={founder.id}
                className={`entity-row ${
                  selectedNodeId === founder.id ? "active" : ""
                }`}
              >
                <button
                  type="button"
                  className={`entity-item ${
                    selectedNodeId === founder.id ? "active" : ""
                  }`}
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
                <div className="entity-actions">
                  <button
                    type="button"
                    className="icon-btn"
                    title="Edit founder"
                    onClick={(event) => {
                      event.stopPropagation();
                      handleEditEntity(founder);
                    }}
                  >
                    ✏️
                  </button>
                  <button
                    type="button"
                    className="icon-btn danger"
                    title="Delete founder"
                    onClick={(event) => {
                      event.stopPropagation();
                      handleDeleteEntity(founder);
                    }}
                  >
                    🗑
                  </button>
                </div>
              </div>
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
              <div
                key={company.id}
                className={`entity-row ${
                  selectedNodeId === company.id ? "active" : ""
                }`}
              >
                <button
                  type="button"
                  className={`entity-item ${
                    selectedNodeId === company.id ? "active" : ""
                  }`}
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
                <div className="entity-actions">
                  <button
                    type="button"
                    className="icon-btn"
                    title="Edit company"
                    onClick={(event) => {
                      event.stopPropagation();
                      handleEditEntity(company);
                    }}
                  >
                    ✏️
                  </button>
                  <button
                    type="button"
                    className="icon-btn danger"
                    title="Delete company"
                    onClick={(event) => {
                      event.stopPropagation();
                      handleDeleteEntity(company);
                    }}
                  >
                    🗑
                  </button>
                </div>
              </div>
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
              <div className="hog-mode-toggle">
                <button
                  type="button"
                  className={hogSearchMode === "company" ? "active" : ""}
                  onClick={() => setHogSearchMode("company")}
                >
                  Company search
                </button>
                <button
                  type="button"
                  className={hogSearchMode === "people" ? "active" : ""}
                  onClick={() => setHogSearchMode("people")}
                >
                  People search
                </button>
              </div>
              <input
                type="text"
                value={website}
                onChange={(event) => setWebsite(event.target.value)}
                placeholder={
                  hogSearchMode === "company"
                    ? "https://company.com or “AI infra in SF”"
                    : "linkedin.com/in/... or “VP eng in SF”"
                }
                onKeyDown={(event) => {
                  if (event.key === "Enter") scanWebsite();
                }}
              />
              <button
                className="ghost-btn"
                onClick={() => scanWebsite()}
                disabled={scanBusy}
              >
                {scanBusy
                  ? "Searching…"
                  : hogSearchMode === "people"
                    ? "Search People"
                    : "Search Companies"}
              </button>
            </div>
            {hogResults && (
              <div className="hog-results">
                <p className="section-label">
                  Hog {hogResults.type === "company" ? "Company" : "People"}{" "}
                  search · {hogResults.items.length} result
                  {hogResults.items.length === 1 ? "" : "s"}
                </p>
                {hogResults.items.length ? (
                  <ul>
                    {hogResults.items.slice(0, 5).map((item, idx) => (
                      <li
                        key={`${hogResults.type}-${idx}`}
                        className="hog-result-item"
                      >
                        <p className="result-title">
                          {item?.name ||
                            item?.title ||
                            item?.headline ||
                            `Result ${idx + 1}`}
                        </p>
                        <p className="result-meta">
                          {describeHogResult(item, hogResults.type)}
                        </p>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted">No results returned.</p>
                )}
              </div>
            )}
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
                    ctx.fillStyle = "#1e1b4b";
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
                        ? selectedNode.sector ||
                          investmentMetrics?.competitiveMoat ||
                          "Unknown sector"
                        : selectedNode.stage || ""}
                    </p>
                  </div>
                  {loadingNodeId === selectedNode.id && (
                    <span className="pill subtle">Refreshing…</span>
                  )}
                  {selectedNode.type === "company" && selectedNode.website && (
                    <button
                      className="ghost-btn"
                      disabled={scanBusy || !selectedNode.website}
                      onClick={() =>
                        selectedNode.website &&
                        scanWebsite(selectedNode.website)
                      }
                    >
                      {scanBusy ? "Scanning…" : "Scan with The Hog"}
                    </button>
                  )}
                </div>
                <div className="field-grid">
                  <div>
                    <p className="field-label">Summary</p>
                    <p className="field-value">
                      {selectedSummaryText || "No summary yet"}
                    </p>
                  </div>
                  <div>
                    <p className="field-label">Tags</p>
                    <div className="tags-row">
                      {tagList.length
                        ? tagList.map((tag) => (
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
                {selectedNode.type === "company" && investmentMetrics && (
                  <div className="vc-metrics">
                    <h4>VC Investment Criteria</h4>
                    <div className="metric-grid">
                      <div className="metric-item">
                        <p className="metric-label">Market Size</p>
                        <p className="metric-value">
                          {investmentMetrics.marketSize}
                        </p>
                      </div>
                      <div className="metric-item">
                        <p className="metric-label">Traction</p>
                        <p className="metric-value">
                          {investmentMetrics.traction}
                        </p>
                      </div>
                      <div className="metric-item">
                        <p className="metric-label">Team Quality</p>
                        <p className="metric-value">
                          {investmentMetrics.teamQuality}
                        </p>
                      </div>
                      <div className="metric-item">
                        <p className="metric-label">Product/Market Fit</p>
                        <p className="metric-value">
                          {investmentMetrics.productMarketFit}
                        </p>
                      </div>
                      <div className="metric-item">
                        <p className="metric-label">Competitive Moat</p>
                        <p className="metric-value">
                          {investmentMetrics.competitiveMoat}
                        </p>
                      </div>
                      <div className="metric-item">
                        <p className="metric-label">Funding Status</p>
                        <p className="metric-value">
                          {investmentMetrics.fundingStatus}
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {selectedNode.type === "founder" && (
                  <div className="founder-panel">
                    <h4>Founder Focus</h4>
                    <div>
                      <p className="field-label">Experience</p>
                      {founderExperience.length ? (
                        <ul className="experience-list">
                          {founderExperience.map((point: string) => (
                            <li key={point}>{point}</li>
                          ))}
                        </ul>
                      ) : (
                        <p className="muted">No experience extracted yet.</p>
                      )}
                    </div>
                    <div>
                      <p className="field-label">Linked Companies</p>
                      {linkedCompanies.length ? (
                        <div className="linked-row">
                          {linkedCompanies.map((company) => (
                            <button
                              key={company.id}
                              className="linked-pill"
                              onClick={() => setSelectedNodeId(company.id)}
                            >
                              {company.label}
                            </button>
                          ))}
                        </div>
                      ) : (
                        <p className="muted">No linked companies recorded.</p>
                      )}
                    </div>
                  </div>
                )}

                <div className="timeline-block">
                  <div className="signals-header">
                    <h4>Timeline</h4>
                    <span className="pill small">
                      {selectedTimeline.length} entries
                    </span>
                  </div>
                  {selectedTimeline.length ? (
                    <ul className="timeline-list">
                      {selectedTimeline.map((entry) => (
                        <li key={`${entry.event_type}-${entry.timestamp}`}>
                          <div className="timeline-meta">
                            <span>
                              {new Date(entry.timestamp).toLocaleDateString()}
                            </span>
                            <span className="pill ghost">
                              {entry.event_type}
                            </span>
                          </div>
                          <p>{entry.description}</p>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="muted">No timeline updates yet.</p>
                  )}
                </div>

                <div className="signals-block">
                  <div className="signals-header">
                    <h4>Signals feed</h4>
                    <span className="pill small">
                      {selectedSignals.length} entries
                    </span>
                  </div>
                  {selectedSignals.length ? (
                    <div className="signal-list">
                      {selectedSignals.map((signal, index) => (
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
          <div className="agent-input-row">
            <input
              type="text"
              placeholder="Ask the brain anything…"
              value={agentInput}
              onChange={(event) => setAgentInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  handleSendAgentMessage();
                }
              }}
            />
            <button
              className="primary-btn"
              onClick={() => handleSendAgentMessage()}
              disabled={!agentInput.trim()}
            >
              ↑
            </button>
          </div>
          <div className="quick-asks">
            <button
              onClick={() =>
                handleSendAgentMessage("Who's most active in our pipeline?")
              }
            >
              Who's most active?
            </button>
            <button
              onClick={() =>
                handleSendAgentMessage(
                  "What signals has The Hog found this week?",
                )
              }
            >
              Hog signals
            </button>
            <button
              onClick={() =>
                handleSendAgentMessage(
                  "Summarize everything we know about our top founders",
                )
              }
            >
              Summaries
            </button>
            <button
              onClick={() =>
                handleSendAgentMessage("What warm intro paths exist right now?")
              }
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
        </aside>
      </div>
    </div>
  );
}

export default App;

function stripFrontmatter(content: string): string {
  const trimmed = content.trim();
  if (!trimmed.startsWith("---")) return trimmed;
  const end = trimmed.indexOf("---", 3);
  if (end === -1) return trimmed;
  return trimmed.slice(end + 3).trim();
}

function normalizeWebsite(input: string) {
  const trimmed = input.trim();
  const prefixed = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  const parsed = new URL(prefixed);
  return { url: prefixed, domain: parsed.hostname };
}

function coerceHogResults(payload: any): any[] {
  if (!payload) return [];
  if (Array.isArray(payload.results)) return payload.results;
  if (Array.isArray(payload.items)) return payload.items;
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload.matches)) return payload.matches;
  if (Array.isArray(payload)) return payload;
  return [];
}

function describeHogResult(item: any, type: "company" | "people"): string {
  if (!item) return "";
  if (type === "company") {
    const parts = [
      item.sector || item.industry,
      item.location || item.hq,
      item.domain || item.website,
    ];
    const text = parts.filter(Boolean).join(" • ");
    return text || item.description?.slice(0, 120) || "";
  }
  const parts = [
    item.headline || item.title,
    item.company || item.current_company,
    item.location,
  ];
  const text = parts.filter(Boolean).join(" • ");
  return text || item.summary?.slice(0, 120) || "";
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

function parseStoredTags(raw: unknown): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.filter(Boolean);
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.filter(Boolean);
      }
    } catch {
      return raw
        .split(/[,|]/)
        .map((value) => value.trim())
        .filter(Boolean);
    }
  }
  return [];
}

function dedupe<T>(values: T[]): T[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function normalizeLinkEndpoint(value: any): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object" && value.id) return value.id;
  return "";
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
