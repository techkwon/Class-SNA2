import dynamic from "next/dynamic";
import { type Node, type Edge } from "@/types/network";
import { useMemo, useRef, useCallback, useState, useEffect, type ReactElement } from "react";
import { AnimatePresence, motion } from "framer-motion";
import * as THREE from "three";
import { ZoomIn, ZoomOut, Maximize, Target, Hand } from "lucide-react";

type ForceGraph3DProps = Record<string, unknown> & { ref?: unknown };
const ForceGraph3D = dynamic(() => import("react-force-graph-3d"), { ssr: false }) as unknown as (
    props: ForceGraph3DProps
) => ReactElement;
type ForceGraph2DProps = Record<string, unknown> & { ref?: unknown };
const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), { ssr: false }) as unknown as (
    props: ForceGraph2DProps
) => ReactElement;

interface NetworkGraphProps {
    nodes: Node[];
    edges: Edge[];
    onStudentClick?: (node: Node) => void;
    isActive?: boolean;
    mode?: "2d" | "3d";
}

interface GraphNode extends Node {
    val: number;
    color: string;
    intimacyRatio: number;
    isIsolated: boolean;
    x?: number;
    y?: number;
    z?: number;
    fx?: number;
    fy?: number;
    fz?: number;
}

type LinkCategory = "popularity" | "activity";

interface GraphLink {
    source: string | GraphNode;
    target: string | GraphNode;
    weight: number;
    category: LinkCategory;
    metricRatio: number;
    popularityRatio: number;
    activityRatio: number;
    weightRatio: number;
    curvature: number;
    rotation: number;
}

interface CameraPosition {
    x: number;
    y: number;
    z: number;
    lookAt?: { x: number; y: number; z: number };
}

interface ForceGraphHandle {
    cameraPosition?: (
        position?: { x: number; y: number; z: number },
        lookAt?: { x: number; y: number; z: number },
        ms?: number
    ) => CameraPosition;
    zoomToFit?: (ms?: number, padding?: number) => void;
    zoom?: (k?: number, ms?: number) => number;
    centerAt?: (x?: number, y?: number, ms?: number) => { x: number; y: number } | void;
    controls?: () => OrbitControlsLike;
    graphData?: () => { nodes: GraphNode[]; links: GraphLink[] };
    d3Force?: (forceName: string) => unknown;
    d3ReheatSimulation?: () => void;
}

interface OrbitControlsLike {
    enablePan?: boolean;
    enableRotate?: boolean;
    enableZoom?: boolean;
    noPan?: boolean;
    noRotate?: boolean;
    mouseButtons?: {
        LEFT?: number;
        RIGHT?: number;
        MIDDLE?: number;
    };
    update?: () => void;
}

interface PairAggregate {
    a: string;
    b: string;
    weight: number;
    activityValue: number;
    popularityValue: number;
}

interface Graph2DViewState {
    x: number;
    y: number;
    zoom: number;
}

const NODE_COLORS = ["#79b7d4", "#e09ab7"];
const POPULARITY_COLOR = "224, 154, 183";
const ACTIVITY_COLOR = "121, 183, 212";

function resolveNodeId(node: string | GraphNode): string {
    return typeof node === "string" ? node : node.id;
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
    const r = Math.min(radius, height / 2, width / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
}

function createLabelSprite(text: string, isHovered: boolean, isDimmed: boolean) {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) return new THREE.Sprite();

    const fontSize = isHovered ? 56 : 42;
    const font = `700 ${fontSize}px Arial, "Noto Sans KR", sans-serif`;
    context.font = font;
    const textWidth = context.measureText(text).width;
    const paddingX = isHovered ? 20 : 14;
    const paddingY = isHovered ? 16 : 12;
    const width = Math.ceil(textWidth + paddingX * 2);
    const height = Math.ceil(fontSize + paddingY * 2);

    canvas.width = width;
    canvas.height = height;
    context.font = font;
    context.textAlign = "center";
    context.textBaseline = "middle";

    if (!isDimmed) {
        roundedRect(context, 1, 1, width - 2, height - 2, 18);
        context.fillStyle = "rgba(255, 255, 255, 0.97)";
        context.fill();
        context.strokeStyle = "rgba(15, 23, 42, 0.14)";
        context.lineWidth = 2;
        context.stroke();
    } else {
        roundedRect(context, 1, 1, width - 2, height - 2, 18);
        context.fillStyle = "rgba(255, 255, 255, 0.08)";
        context.fill();
    }

    context.fillStyle = isDimmed ? "rgba(100, 116, 139, 0.58)" : "#0f172a";
    context.fillText(text, width / 2, height / 2 + (isHovered ? 1 : 0));

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;

    const material = new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        toneMapped: false,
    });

    const sprite = new THREE.Sprite(material);
    const labelHeight = isHovered ? 4.2 : 3.2;
    const aspect = width / height;
    sprite.scale.set(labelHeight * aspect, labelHeight, 1);
    sprite.renderOrder = 12;
    return sprite;
}

export default function NetworkGraph({ nodes, edges, onStudentClick, isActive = true, mode = "3d" }: NetworkGraphProps) {
    const fgRef = useRef<ForceGraphHandle | null>(null);
    const containerRef = useRef<HTMLDivElement | null>(null);
    const hasAutoCenteredRef = useRef(false);
    const hasUserInteractedRef = useRef(false);
    const [preservedNodePositions, setPreservedNodePositions] = useState<Map<string, { x: number; y: number; z: number }>>(
        new Map()
    );
    const view2DRef = useRef<Graph2DViewState | null>(null);
    const view3DRef = useRef<CameraPosition | null>(null);
    const [highlightNode, setHighlightNode] = useState<Node | null>(null);
    const [isGrabToggle, setIsGrabToggle] = useState(false);
    const [isSpaceGrab, setIsSpaceGrab] = useState(false);
    const [graphSize, setGraphSize] = useState({ width: 0, height: 0 });
    const isGrabMode = isGrabToggle || isSpaceGrab;

    const graphData = useMemo(() => {
        const nodeMap = new Map(nodes.map((node) => [node.id, node]));
        const maxNodePopularity = Math.max(...nodes.map((n) => n.inDegree || 0), 0.01);
        const maxNodeIntimacy = Math.max(...nodes.map((n) => n.eigenvector || 0), 0.01);
        const isolatedNodeIds = nodes
            .filter((node) => ((node.inDegree || 0) + (node.outDegree || 0)) === 0)
            .map((node) => node.id);
        const isolatedIndexMap = new Map(isolatedNodeIds.map((id, index) => [id, index]));
        const isolatedCount = isolatedNodeIds.length;

        // Aggregate to ensure "max two lines per student pair":
        // one activity link + one popularity link for each unordered pair.
        const pairMap = new Map<string, PairAggregate>();
        edges.forEach((edge) => {
            const [a, b] = edge.source < edge.target ? [edge.source, edge.target] : [edge.target, edge.source];
            const key = `${a}::${b}`;
            const existing = pairMap.get(key);
            const weight = edge.weight || 1;

            if (existing) {
                existing.weight += weight;
                return;
            }

            const nodeA = nodeMap.get(a);
            const nodeB = nodeMap.get(b);
            pairMap.set(key, {
                a,
                b,
                weight,
                activityValue: (nodeA?.outDegree || 0) + (nodeB?.outDegree || 0),
                popularityValue: (nodeA?.inDegree || 0) + (nodeB?.inDegree || 0),
            });
        });

        const pairList = Array.from(pairMap.values());
        const maxPairActivity = Math.max(...pairList.map((p) => p.activityValue), 0.01);
        const maxPairPopularity = Math.max(...pairList.map((p) => p.popularityValue), 0.01);
        const maxPairWeight = Math.max(...pairList.map((p) => p.weight), 0.01);

        return {
            nodes: nodes.map((n) => {
                const isolatedIndex = isolatedIndexMap.get(n.id);
                const isIsolated = isolatedIndex !== undefined;
                const angle = isolatedCount > 0 && isolatedIndex !== undefined ? (Math.PI * 2 * isolatedIndex) / isolatedCount : 0;
                const radius = 150 + ((isolatedIndex || 0) % 3) * 22;
                const isolateX = Math.cos(angle) * radius;
                const isolateY = Math.sin(angle) * radius;
                const isolateZ = (((isolatedIndex || 0) % 5) - 2) * 16;
                const preserved = preservedNodePositions.get(n.id);
                const preserveX = preserved && Number.isFinite(preserved.x) ? preserved.x : undefined;
                const preserveY = preserved && Number.isFinite(preserved.y) ? preserved.y : undefined;
                const preserveZ = preserved && Number.isFinite(preserved.z) ? preserved.z : undefined;

                return {
                    ...n,
                    intimacyRatio: Math.min((n.eigenvector || 0) / maxNodeIntimacy, 1),
                    val:
                        2.2 +
                        Math.pow(Math.min((n.eigenvector || 0) / maxNodeIntimacy, 1), 0.78) * 4.1 +
                        Math.min((n.inDegree || 0) / maxNodePopularity, 1) * 0.9,
                    color: NODE_COLORS[(n.community || 0) % NODE_COLORS.length],
                    isIsolated,
                    x: isIsolated ? isolateX : preserveX,
                    y: isIsolated ? isolateY : preserveY,
                    z: isIsolated ? isolateZ : preserveZ,
                    fx: isIsolated ? isolateX : undefined,
                    fy: isIsolated ? isolateY : undefined,
                    fz: isIsolated ? isolateZ : undefined,
                };
            }),
            links: pairList.flatMap((pair, idx) => {
                const baseCurve = 0.09 + Math.min(pair.weight * 0.015, 0.08);
                const pairRotation = idx % 2 === 0 ? 0 : Math.PI / 2;
                const activityRatio = Math.min(pair.activityValue / maxPairActivity, 1);
                const popularityRatio = Math.min(pair.popularityValue / maxPairPopularity, 1);
                const weightRatio = Math.min(pair.weight / maxPairWeight, 1);

                const activityLink: GraphLink = {
                    source: pair.a,
                    target: pair.b,
                    weight: pair.weight,
                    category: "activity",
                    metricRatio: activityRatio,
                    popularityRatio,
                    activityRatio,
                    weightRatio,
                    curvature: baseCurve,
                    rotation: pairRotation,
                };

                const popularityLink: GraphLink = {
                    source: pair.a,
                    target: pair.b,
                    weight: pair.weight,
                    category: "popularity",
                    metricRatio: popularityRatio,
                    popularityRatio,
                    activityRatio,
                    weightRatio,
                    curvature: baseCurve + 0.04,
                    rotation: pairRotation + Math.PI,
                };

                return [activityLink, popularityLink];
            }),
        };
    }, [nodes, edges, preservedNodePositions]);
    const hasIsolatedNodes = useMemo(() => graphData.nodes.some((node) => node.isIsolated), [graphData]);

    const captureNodePositions = useCallback(() => {
        const liveData = fgRef.current?.graphData?.();
        if (!liveData?.nodes?.length) return;

        const next = new Map<string, { x: number; y: number; z: number }>();
        liveData.nodes.forEach((node) => {
            if (!Number.isFinite(node.x) || !Number.isFinite(node.y)) return;
            const x = node.x as number;
            const y = node.y as number;
            const z = Number.isFinite(node.z) ? (node.z as number) : 0;
            next.set(node.id, { x, y, z });
        });

        if (next.size) setPreservedNodePositions(next);
    }, []);

    const captureCurrentView = useCallback((currentMode: "2d" | "3d") => {
        if (!fgRef.current) return;

        if (currentMode === "3d" && fgRef.current.cameraPosition) {
            const currentCamera = fgRef.current.cameraPosition();
            if (
                Number.isFinite(currentCamera?.x) &&
                Number.isFinite(currentCamera?.y) &&
                Number.isFinite(currentCamera?.z)
            ) {
                view3DRef.current = currentCamera;
            }
            return;
        }

        const zoom = fgRef.current.zoom?.();
        const center = fgRef.current.centerAt?.();
        if (
            typeof zoom === "number" &&
            center &&
            typeof center === "object" &&
            "x" in center &&
            "y" in center &&
            Number.isFinite(center.x) &&
            Number.isFinite(center.y)
        ) {
            view2DRef.current = { x: center.x, y: center.y, zoom };
        }
    }, []);

    useEffect(() => {
        hasAutoCenteredRef.current = false;
        hasUserInteractedRef.current = false;
        view2DRef.current = null;
        view3DRef.current = null;
    }, [nodes, edges]);

    useEffect(() => {
        return () => {
            captureCurrentView(mode);
            captureNodePositions();
        };
    }, [captureCurrentView, captureNodePositions, mode]);

    useEffect(() => {
        const isEditableTarget = (target: EventTarget | null) => {
            if (!(target instanceof HTMLElement)) return false;
            if (target.isContentEditable) return true;
            const tag = target.tagName.toLowerCase();
            return tag === "input" || tag === "textarea" || tag === "select";
        };

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.code !== "Space") return;
            if (!isActive) return;
            if (isEditableTarget(event.target)) return;
            event.preventDefault();
            if (event.repeat) return;
            setIsSpaceGrab(true);
        };

        const handleKeyUp = (event: KeyboardEvent) => {
            if (event.code !== "Space") return;
            event.preventDefault();
            setIsSpaceGrab(false);
        };

        const clearSpaceGrab = () => setIsSpaceGrab(false);

        window.addEventListener("keydown", handleKeyDown, { passive: false });
        window.addEventListener("keyup", handleKeyUp);
        window.addEventListener("blur", clearSpaceGrab);
        document.addEventListener("visibilitychange", clearSpaceGrab);

        return () => {
            window.removeEventListener("keydown", handleKeyDown);
            window.removeEventListener("keyup", handleKeyUp);
            window.removeEventListener("blur", clearSpaceGrab);
            document.removeEventListener("visibilitychange", clearSpaceGrab);
        };
    }, [isActive]);

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const updateSize = () => {
            const rect = container.getBoundingClientRect();
            const next = {
                width: Math.max(1, Math.round(rect.width)),
                height: Math.max(1, Math.round(rect.height)),
            };

            setGraphSize((prev) => (prev.width === next.width && prev.height === next.height ? prev : next));
        };

        updateSize();
        const observer = new ResizeObserver(updateSize);
        observer.observe(container);
        window.addEventListener("orientationchange", updateSize);

        return () => {
            observer.disconnect();
            window.removeEventListener("orientationchange", updateSize);
        };
    }, []);

    useEffect(() => {
        if (mode !== "3d") return;
        const controls = fgRef.current?.controls?.();
        if (!controls) return;

        if ("enableRotate" in controls && typeof controls.enableRotate === "boolean") controls.enableRotate = true;
        if ("enableZoom" in controls && typeof controls.enableZoom === "boolean") controls.enableZoom = true;
        if ("enablePan" in controls && typeof controls.enablePan === "boolean") controls.enablePan = isGrabMode;
        if ("noPan" in controls && typeof controls.noPan === "boolean") controls.noPan = !isGrabMode;
        if ("noRotate" in controls && typeof controls.noRotate === "boolean") controls.noRotate = isGrabMode;

        if (controls.mouseButtons) {
            controls.mouseButtons.LEFT = isGrabMode ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE;
            controls.mouseButtons.RIGHT = isGrabMode ? THREE.MOUSE.ROTATE : THREE.MOUSE.PAN;
        }

        controls.update?.();
    }, [isGrabMode, mode]);

    useEffect(() => {
        if (!isActive || graphSize.width <= 0 || graphSize.height <= 0) return;

        const timer = window.setTimeout(() => {
            if (!fgRef.current) return;

            if (mode === "3d" && fgRef.current.cameraPosition) {
                const saved3D = view3DRef.current;
                if (saved3D) {
                    fgRef.current.cameraPosition(
                        { x: saved3D.x, y: saved3D.y, z: saved3D.z },
                        saved3D.lookAt,
                        0
                    );
                    return;
                }

                const saved2D = view2DRef.current;
                if (saved2D) {
                    const zDistance = Math.max(180, Math.min(800, 650 / Math.max(saved2D.zoom, 0.35)));
                    fgRef.current.cameraPosition(
                        { x: saved2D.x * 0.18, y: saved2D.y * 0.18, z: zDistance },
                        { x: saved2D.x * 0.18, y: saved2D.y * 0.18, z: 0 },
                        260
                    );
                }
                return;
            }

            const saved2D = view2DRef.current;
            if (saved2D) {
                fgRef.current?.centerAt?.(saved2D.x, saved2D.y, 0);
                fgRef.current?.zoom?.(saved2D.zoom, 0);
                return;
            }

            const saved3D = view3DRef.current;
            if (saved3D) {
                const x = saved3D.lookAt?.x ?? 0;
                const y = saved3D.lookAt?.y ?? 0;
                const zoom = Math.max(0.45, Math.min(3.6, 650 / Math.max(Math.abs(saved3D.z), 150)));
                fgRef.current?.centerAt?.(x, y, 260);
                fgRef.current?.zoom?.(zoom, 260);
            }
        }, 70);

        return () => window.clearTimeout(timer);
    }, [graphSize.height, graphSize.width, isActive, mode]);

    useEffect(() => {
        const graph = fgRef.current;
        if (!graph?.d3Force) return;

        const charge = graph.d3Force("charge") as
            | {
                  strength?: (value: number | ((node: GraphNode) => number)) => unknown;
                  distanceMax?: (value: number) => unknown;
              }
            | undefined;
        charge?.strength?.((node: GraphNode) => (node.isIsolated ? -80 : -520));
        charge?.distanceMax?.(640);

        const link = graph.d3Force("link") as
            | { distance?: (value: number | ((link: GraphLink) => number)) => unknown; strength?: (value: number | ((link: GraphLink) => number)) => unknown }
            | undefined;
        link?.distance?.((linkData: GraphLink) => {
            const indexRatio = linkData.category === "activity" ? linkData.activityRatio : linkData.popularityRatio;
            return 150 + (1 - indexRatio) * 95 + (1 - linkData.weightRatio) * 36;
        });
        link?.strength?.((linkData: GraphLink) => {
            const indexRatio = linkData.category === "activity" ? linkData.activityRatio : linkData.popularityRatio;
            return 0.08 + indexRatio * 0.2 + linkData.weightRatio * 0.1;
        });

        const collide = graph.d3Force("collision") as
            | { radius?: (value: number | ((node: GraphNode) => number)) => unknown; strength?: (value: number) => unknown }
            | undefined;
        collide?.radius?.((node: GraphNode) => node.val + 2.6);
        collide?.strength?.(0.85);

        graph.d3ReheatSimulation?.();
    }, [graphData]);

    useEffect(() => {
        const canCenter = isActive && graphSize.width > 0 && graphSize.height > 0;
        if (!canCenter) return;

        const center = () => {
            if (hasUserInteractedRef.current) return;
            if (fgRef.current?.cameraPosition) {
                fgRef.current.cameraPosition(
                    { x: 0, y: 0, z: 340 },
                    { x: 0, y: 0, z: 0 },
                    420
                );
            } else {
                fgRef.current?.centerAt?.(0, 0, 420);
                fgRef.current?.zoom?.(1.12, 420);
            }
            window.setTimeout(() => {
                if (hasUserInteractedRef.current) return;
                if (hasIsolatedNodes) return;
                fgRef.current?.zoomToFit?.(900, 118);
            }, 120);
        };

        const initial = window.setTimeout(center, 220);
        const followup = window.setTimeout(center, 980);
        return () => {
            window.clearTimeout(initial);
            window.clearTimeout(followup);
        };
    }, [edges, nodes, graphSize.height, graphSize.width, hasIsolatedNodes, isActive]);

    const handleNodeClick = useCallback(
        (node: GraphNode) => {
            hasUserInteractedRef.current = true;
            setHighlightNode(node);
            if (onStudentClick) onStudentClick(node);

            const distance = 80;
            const currentDistance = Math.hypot(node.x || 0, node.y || 0, node.z || 0) || 1;
            const distRatio = 1 + distance / currentDistance;

            if (!fgRef.current) return;
            if (mode === "3d" && fgRef.current.cameraPosition) {
                fgRef.current.cameraPosition(
                    { x: (node.x || 0) * distRatio, y: (node.y || 0) * distRatio, z: (node.z || 0) * distRatio },
                    { x: node.x || 0, y: node.y || 0, z: node.z || 0 },
                    2000
                );
            } else {
                fgRef.current.centerAt?.(node.x || 0, node.y || 0, 900);
                const currentZoom = fgRef.current.zoom?.() ?? 1;
                fgRef.current.zoom?.(Math.max(currentZoom, 2.6), 900);
            }
        },
        [mode, onStudentClick]
    );

    const handleBackgroundClick = useCallback(() => {
        setHighlightNode(null);
    }, []);

    const zoomToFit = useCallback(() => {
        hasUserInteractedRef.current = true;
        if (hasIsolatedNodes) {
            if (mode === "3d" && fgRef.current?.cameraPosition) {
                fgRef.current.cameraPosition(
                    { x: 0, y: 0, z: 340 },
                    { x: 0, y: 0, z: 0 },
                    700
                );
                return;
            }
            fgRef.current?.centerAt?.(0, 0, 420);
            fgRef.current?.zoom?.(1.12, 420);
            return;
        }
        fgRef.current?.zoomToFit?.(900, 56);
    }, [hasIsolatedNodes, mode]);

    const zoomIn = useCallback(() => {
        if (!fgRef.current) return;
        hasUserInteractedRef.current = true;
        if (mode === "3d" && fgRef.current.cameraPosition) {
            const currentPos = fgRef.current.cameraPosition();
            fgRef.current.cameraPosition(
                { x: currentPos.x * 0.7, y: currentPos.y * 0.7, z: currentPos.z * 0.7 },
                currentPos.lookAt,
                500
            );
            return;
        }

        const currentZoom = fgRef.current.zoom?.() ?? 1;
        fgRef.current.zoom?.(currentZoom * 1.24, 400);
    }, [mode]);

    const zoomOut = useCallback(() => {
        if (!fgRef.current) return;
        hasUserInteractedRef.current = true;
        if (mode === "3d" && fgRef.current.cameraPosition) {
            const currentPos = fgRef.current.cameraPosition();
            fgRef.current.cameraPosition(
                { x: currentPos.x * 1.25, y: currentPos.y * 1.25, z: currentPos.z * 1.25 },
                currentPos.lookAt,
                500
            );
            return;
        }

        const currentZoom = fgRef.current.zoom?.() ?? 1;
        fgRef.current.zoom?.(Math.max(0.35, currentZoom / 1.24), 400);
    }, [mode]);

    const connectedNodeIds = useMemo(() => {
        if (!highlightNode) return new Set<string>();
        const set = new Set<string>();
        edges.forEach((edge) => {
            if (edge.source === highlightNode.id) set.add(edge.target);
            if (edge.target === highlightNode.id) set.add(edge.source);
        });
        set.add(highlightNode.id);
        return set;
    }, [highlightNode, edges]);

    const handleEngineStop = useCallback(() => {
        captureNodePositions();
        if (!isActive || graphSize.width <= 0 || graphSize.height <= 0) return;
        if (hasIsolatedNodes) return;
        if (hasAutoCenteredRef.current || hasUserInteractedRef.current) return;
        hasAutoCenteredRef.current = true;
        fgRef.current?.zoomToFit?.(1500, 120);
    }, [captureNodePositions, graphSize.height, graphSize.width, hasIsolatedNodes, isActive]);

    const resolveLinkColor = useCallback(
        (link: GraphLink) => {
            const sourceId = resolveNodeId(link.source);
            const targetId = resolveNodeId(link.target);
            const isRelated = highlightNode ? highlightNode.id === sourceId || highlightNode.id === targetId : false;

            if (highlightNode && !isRelated) return "rgba(148, 163, 184, 0.08)";

            const opacity = Math.min(0.24 + link.metricRatio * 0.68, 0.95);
            if (link.category === "activity") return `rgba(${ACTIVITY_COLOR}, ${opacity})`;
            return `rgba(${POPULARITY_COLOR}, ${opacity})`;
        },
        [highlightNode]
    );

    const resolveLinkWidth = useCallback(
        (link: GraphLink) => {
            const sourceId = resolveNodeId(link.source);
            const targetId = resolveNodeId(link.target);
            const isRelated = highlightNode ? highlightNode.id === sourceId || highlightNode.id === targetId : false;
            const indexRatio = link.category === "activity" ? link.activityRatio : link.popularityRatio;
            const metricWidth = 0.24 + indexRatio * 2.7 + link.weightRatio * 1.25;

            if (highlightNode && !isRelated) return Math.max(metricWidth * 0.16, 0.12);
            if (isRelated) return metricWidth * 1.22;
            return metricWidth;
        },
        [highlightNode]
    );

    const drawNode2D = useCallback(
        (rawNode: GraphNode, ctx: CanvasRenderingContext2D, globalScale: number) => {
            const isHovered = highlightNode ? highlightNode.id === rawNode.id : false;
            const isConnected = highlightNode ? connectedNodeIds.has(rawNode.id) : false;
            const isDimmed = highlightNode ? !isHovered && !isConnected : false;

            const radius = Math.max(rawNode.val * 1.55, 3.8);
            ctx.beginPath();
            ctx.arc(rawNode.x || 0, rawNode.y || 0, radius, 0, 2 * Math.PI, false);
            ctx.fillStyle = isHovered ? "#ffffff" : rawNode.color;
            ctx.globalAlpha = isDimmed ? 0.22 : 0.94;
            ctx.fill();
            ctx.globalAlpha = 1;

            const fontSize = (isHovered ? 16 : 12) / Math.max(globalScale, 0.3);
            ctx.font = `700 ${fontSize}px Arial, \"Noto Sans KR\", sans-serif`;
            const text = rawNode.name;
            const textWidth = ctx.measureText(text).width;
            const paddingX = 6 / Math.max(globalScale, 0.3);
            const paddingY = 4 / Math.max(globalScale, 0.3);
            const boxW = textWidth + paddingX * 2;
            const boxH = fontSize + paddingY * 2;
            const labelX = (rawNode.x || 0) - boxW / 2;
            const labelY = (rawNode.y || 0) - radius - boxH - 4 / Math.max(globalScale, 0.3);

            ctx.fillStyle = isDimmed ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.96)";
            ctx.strokeStyle = "rgba(15,23,42,0.15)";
            ctx.lineWidth = 1 / Math.max(globalScale, 0.4);
            roundedRect(ctx, labelX, labelY, boxW, boxH, 4 / Math.max(globalScale, 0.3));
            ctx.fill();
            ctx.stroke();

            ctx.fillStyle = isDimmed ? "rgba(100,116,139,0.58)" : "#0f172a";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(text, (rawNode.x || 0), labelY + boxH / 2);
        },
        [connectedNodeIds, highlightNode]
    );

    return (
        <div
            ref={containerRef}
            className={`w-full h-full min-h-[430px] sm:min-h-[560px] overflow-hidden relative bg-transparent ${isGrabMode ? "cursor-grab active:cursor-grabbing" : ""}`}
        >
            <div className="absolute top-3 right-3 z-10 flex flex-col gap-1.5 bg-card/92 backdrop-blur-md p-1.5 rounded-xl border border-border shadow-sm">
                <button
                    onClick={() => setIsGrabToggle((prev) => !prev)}
                    className={`p-2 rounded-lg transition-colors ${isGrabMode ? "text-primary bg-primary/12" : "text-muted-foreground hover:text-primary hover:bg-primary/10"}`}
                    title={isGrabMode ? "그랩 모드 해제" : "그랩 모드"}
                >
                    <Hand size={16} />
                </button>
                <button onClick={zoomIn} className="p-2 text-muted-foreground hover:text-primary hover:bg-primary/10 rounded-lg transition-colors" title="확대">
                    <ZoomIn size={16} />
                </button>
                <button onClick={zoomOut} className="p-2 text-muted-foreground hover:text-accent hover:bg-accent/10 rounded-lg transition-colors" title="축소">
                    <ZoomOut size={16} />
                </button>
                <button onClick={zoomToFit} className="p-2 text-muted-foreground hover:text-foreground hover:bg-secondary rounded-lg transition-colors" title="전체 보기">
                    <Maximize size={16} />
                </button>
            </div>

            {graphSize.width > 0 && graphSize.height > 0 && (
                <AnimatePresence mode="wait" initial={false}>
                    <motion.div
                        key={mode}
                        className="absolute inset-0"
                        initial={{ opacity: 0, scale: 0.985 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 1.015 }}
                        transition={{ duration: 0.24, ease: "easeOut" }}
                    >
                        {mode === "3d" ? (
                            <ForceGraph3D
                                ref={fgRef}
                                width={graphSize.width}
                                height={graphSize.height}
                                graphData={graphData}
                                warmupTicks={220}
                                cooldownTicks={320}
                                d3AlphaDecay={0.014}
                                d3VelocityDecay={0.34}
                                backgroundColor="rgba(0,0,0,0)"
                                nodeLabel=""
                                nodeRelSize={2.8}
                                nodeColor="color"
                                enableNodeDrag={!isGrabMode}
                                linkDirectionalArrowLength={0}
                                linkCurvature="curvature"
                                linkCurveRotation="rotation"
                                onEngineStop={handleEngineStop}
                                linkColor={resolveLinkColor}
                                linkOpacity={1}
                                linkWidth={resolveLinkWidth}
                                onNodeClick={handleNodeClick}
                                onBackgroundClick={handleBackgroundClick}
                                nodeThreeObject={(node: GraphNode) => {
                                    const isHovered = highlightNode ? highlightNode.id === node.id : false;
                                    const isConnected = highlightNode ? connectedNodeIds.has(node.id) : false;
                                    const isDimmed = highlightNode ? !isHovered && !isConnected : false;

                                    const group = new THREE.Group();
                                    const geometry = new THREE.SphereGeometry(node.val, 32, 32);
                                    const material = new THREE.MeshPhysicalMaterial({
                                        color: isHovered ? "#ffffff" : node.color,
                                        metalness: 0.1,
                                        roughness: 0.35,
                                        clearcoat: 0.25,
                                        opacity: isDimmed ? 0.2 : 1,
                                        transparent: true,
                                    });

                                    if (isHovered) {
                                        material.emissive = new THREE.Color(node.color);
                                        material.emissiveIntensity = 0.65;
                                    }

                                    const sphere = new THREE.Mesh(geometry, material);
                                    group.add(sphere);

                                    const sprite = createLabelSprite(node.name, isHovered, isDimmed);
                                    const yOffset = node.val + (isHovered ? 6.4 : 5.3);
                                    sprite.position.set(0, yOffset, 0);
                                    group.add(sprite);

                                    if (isHovered) {
                                        const ringGeo = new THREE.RingGeometry(node.val * 1.25, node.val * 1.45, 32);
                                        const ringMat = new THREE.MeshBasicMaterial({
                                            color: node.color,
                                            side: THREE.DoubleSide,
                                            transparent: true,
                                            opacity: 0.55,
                                        });
                                        const ring = new THREE.Mesh(ringGeo, ringMat);
                                        ring.onBeforeRender = (_renderer, _scene, camera) => {
                                            ring.quaternion.copy(camera.quaternion);
                                        };
                                        group.add(ring);
                                    }

                                    return group;
                                }}
                            />
                        ) : (
                            <ForceGraph2D
                                ref={fgRef}
                                width={graphSize.width}
                                height={graphSize.height}
                                graphData={graphData}
                                warmupTicks={220}
                                cooldownTicks={320}
                                d3AlphaDecay={0.014}
                                d3VelocityDecay={0.34}
                                backgroundColor="rgba(0,0,0,0)"
                                nodeRelSize={2.8}
                                nodeColor="color"
                                enableNodeDrag={!isGrabMode}
                                linkDirectionalArrowLength={0}
                                linkCurvature="curvature"
                                linkColor={resolveLinkColor}
                                linkWidth={resolveLinkWidth}
                                onEngineStop={handleEngineStop}
                                onNodeClick={handleNodeClick}
                                onBackgroundClick={handleBackgroundClick}
                                nodeCanvasObject={drawNode2D}
                            />
                        )}
                    </motion.div>
                </AnimatePresence>
            )}

            {highlightNode && (
                <div className="absolute bottom-4 left-4 right-4 sm:right-auto sm:max-w-sm z-10 bg-card/95 backdrop-blur border border-border rounded-xl px-4 py-3 shadow-lg pointer-events-none">
                    <h4 className="font-extrabold text-foreground text-sm sm:text-base flex items-center gap-2">
                        <Target size={16} className="text-primary" />
                        {highlightNode.name}
                    </h4>
                    <p className="text-muted-foreground text-xs sm:text-sm mt-1 mb-2">학생쌍마다 인기도/활동성 선 2개만 표시됩니다.</p>
                    <div className="flex flex-wrap gap-3 text-[11px] sm:text-xs font-bold">
                        <span className="text-primary">■ 활동성 연결선</span>
                        <span className="text-accent">■ 인기도 연결선</span>
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-1">
                        {isGrabMode ? "그랩 모드 ON: 화면을 잡아 이동할 수 있습니다." : "그랩 모드 OFF: 버튼 또는 스페이스바 홀드로 화면을 잡아 이동하세요."}
                    </p>
                </div>
            )}
        </div>
    );
}
