export interface Node {
    id: string;
    name: string;
    label: string;
    group: number;
    // Metrics (computed later)
    inDegree?: number;
    outDegree?: number;
    betweenness?: number;
    closeness?: number;
    eigenvector?: number;
    community?: number;
}

export interface Edge {
    source: string;
    target: string;
    type: string;
    weight: number;
}
