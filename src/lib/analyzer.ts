import Graph from "graphology";
import { inDegreeCentrality, outDegreeCentrality } from "graphology-metrics/centrality/degree";
import betweennessCentrality from "graphology-metrics/centrality/betweenness";
import closenessCentrality from "graphology-metrics/centrality/closeness";
import eigenvectorCentrality from "graphology-metrics/centrality/eigenvector";
import louvain from "graphology-communities-louvain";
import { type Node, type Edge } from "@/types/network";

function createSeededRng(seedSource: string) {
    let seed = 2166136261;
    for (const char of seedSource) {
        seed ^= char.charCodeAt(0);
        seed = Math.imul(seed, 16777619);
    }
    if (seed === 0) seed = 1;

    return () => {
        seed ^= seed << 13;
        seed ^= seed >>> 17;
        seed ^= seed << 5;
        return (seed >>> 0) / 4294967296;
    };
}

/**
 * Replaces Python NetworkAnalyzer
 */
export function analyzeNetwork(nodes: Node[], edges: Edge[]) {
    // 1. Build Graph
    const graph = new Graph({ type: "directed", multi: true });

    nodes.forEach((n) => {
        if (!graph.hasNode(n.id)) {
            graph.addNode(n.id, { ...n });
        }
    });

    edges.forEach((e) => {
        if (graph.hasNode(e.source) && graph.hasNode(e.target)) {
            graph.addDirectedEdge(e.source, e.target, { type: e.type, weight: e.weight });
        }
    });

    // Handle unconnected components effectively for centrality
    // In graphology, some centrality metrics fail entirely if graph is disconnected or lack of paths.
    // We'll calculate each safely.

    try {
        inDegreeCentrality.assign(graph);
        outDegreeCentrality.assign(graph);
    } catch (e) { console.warn("Degree centrality error:", e) }

    try {
        betweennessCentrality.assign(graph);
    } catch (e) { console.warn("Betweenness error:", e) }

    try {
        // Closeness may fail on disconnected graphs in graphology. 
        // Usually we would extract strongly connected components, but for simplicity:
        closenessCentrality.assign(graph);
    } catch (e) { console.warn("Closeness error:", e) }

    try {
        eigenvectorCentrality.assign(graph, { maxIterations: 1000, tolerance: 1e-6 });
    } catch (e) { console.warn("Eigenvector error:", e) }

    // Detect Communities (Louvain only works well on undirected graphs typically, 
    // but graphology's louvain can handle directed by casting)
    try {
        const seedSource = `${nodes
            .map((node) => node.id)
            .sort()
            .join("|")}::${edges
            .map((edge) => `${edge.source}>${edge.target}:${edge.type}:${edge.weight}`)
            .sort()
            .join("|")}`;
        const rng = createSeededRng(seedSource);

        // We treat the graph as undirected for the purpose of community detection
        const communities = louvain(graph.copy(), {
            getEdgeWeight: "weight",
            rng,
            randomWalk: true,
        });
        graph.forEachNode((node) => {
            graph.setNodeAttribute(node, 'community', communities[node] || 1);
        });
    } catch (e) {
        console.warn("Louvain community detection failed:", e);
    }

    // Export enriched nodes
    const enrichedNodes: Node[] = graph.mapNodes((node, attr) => ({
        id: node,
        name: attr.name,
        label: attr.label,
        group: attr.group,
        inDegree: attr.inDegreeCentrality || 0,
        outDegree: attr.outDegreeCentrality || 0,
        betweenness: attr.betweennessCentrality || 0,
        closeness: attr.closenessCentrality || 0,
        eigenvector: attr.eigenvectorCentrality || 0,
        community: attr.community || 1
    }));

    // Identify isolated students (e.g. inDegree === 0)
    const isolatedStudents = enrichedNodes.filter(n => (n.inDegree || 0) === 0);

    return {
        graph,
        nodes: enrichedNodes,
        edges,
        isolatedStudents
    };
}
