/**
 * Satisfactory Production Chain - Factory Graph Engine (DAG Flowchart)
 * 
 * Computes unified machine rates, ingredient conveyor flows, and renders
 * an interactive SVG factory diagram matching the classic DAG layout.
 */

(function (root, factory) {
    const exported = factory();
    if (typeof define === 'function' && define.amd) {
        define([], function () { return exported; });
    } else if (typeof module === 'object' && module.exports) {
        module.exports = exported;
    }
    if (typeof root !== 'undefined') root.FactoryGraph = exported;
    if (typeof window !== 'undefined') window.FactoryGraph = exported;
    if (typeof globalThis !== 'undefined') globalThis.FactoryGraph = exported;
}(typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : this), function () {

    // Machine color accents matching the industrial FICSIT palette
    const MACHINE_COLORS = {
        smelter: '#f97316',
        foundry: '#ea580c',
        constructor: '#0284c7',
        assembler: '#0d9488',
        manufacturer: '#e11d48',
        refinery: '#9333ea',
        blender: '#a855f7',
        packager: '#ca8a04',
        extractor: '#10b981',
        advanced: '#ec4899',
        target: '#fa9549',
        byproduct: '#8b5cf6',
        raw: '#22c55e'
    };

    function getMachineColor(buildingName, isRaw = false, isTarget = false, isByproduct = false) {
        if (isTarget) return MACHINE_COLORS.target;
        if (isByproduct) return MACHINE_COLORS.byproduct;
        if (isRaw) return MACHINE_COLORS.raw;
        if (!buildingName) return MACHINE_COLORS.manufacturer;
        const lower = buildingName.toLowerCase();
        if (lower.includes('smelter')) return MACHINE_COLORS.smelter;
        if (lower.includes('foundry')) return MACHINE_COLORS.foundry;
        if (lower.includes('constructor')) return MACHINE_COLORS.constructor;
        if (lower.includes('assembler')) return MACHINE_COLORS.assembler;
        if (lower.includes('manufacturer')) return MACHINE_COLORS.manufacturer;
        if (lower.includes('refinery')) return MACHINE_COLORS.refinery;
        if (lower.includes('blender')) return MACHINE_COLORS.blender;
        if (lower.includes('packager')) return MACHINE_COLORS.packager;
        if (lower.includes('miner') || lower.includes('extractor') || lower.includes('pump')) return MACHINE_COLORS.extractor;
        return MACHINE_COLORS.advanced;
    }

    /**
     * Resolves the default recipe for an item from indexed dataset
     */
    function getDefaultRecipe(itemId, index, unlockedRecipes = null) {
        const recipes = index.recipesByProduct.get(itemId) || [];
        if (recipes.length === 0) return null;
        const std = recipes.find(r => !r.isAlternate);
        if (std) return std;
        if (unlockedRecipes && unlockedRecipes.size > 0) {
            const unlocked = recipes.find(r => unlockedRecipes.has(r.id));
            if (unlocked) return unlocked;
        }
        return recipes[0];
    }

    /**
     * Resolves the active recipe taking recipeOverrides and unlocked save recipes into account
     */
    function getActiveRecipe(itemId, index, overrides, unlockedRecipes = null) {
        if (overrides) {
            const customId = overrides instanceof Map ? overrides.get(itemId) : overrides[itemId];
            if (customId && index.recipeById && index.recipeById.has(customId)) {
                return index.recipeById.get(customId);
            }
        }
        return getDefaultRecipe(itemId, index, unlockedRecipes);
    }

    /**
     * Calculates the complete Unified Factory DAG given a target item and output rate
     * 
     * @param {string} targetItemId e.g. 'Desc_Computer_C'
     * @param {number} targetRate e.g. 1.0 (items/min)
     * @param {Object} index Indexed dataset
     * @param {Object} [options] Configuration options (e.g. recipeOverrides, unlockedRecipes)
     * @returns {Object} { nodes, edges, summary }
     */
    function calculateFactoryDAG(targetItemId, targetRate = 1.0, index, options = {}) {
        const recipeOverrides = (options && options.recipeOverrides) ? options.recipeOverrides : null;
        const unlockedRecipes = (options && options.unlockedRecipes) ? options.unlockedRecipes : null;
        const targetItem = index.itemById.get(targetItemId) || ProductionTree.findItem(targetItemId, index);
        if (!targetItem) throw new Error(`Target item not found: ${targetItemId}`);

        const itemDemands = new Map(); // itemId -> total rate needed
        itemDemands.set(targetItem.id, targetRate);

        const recipeDemands = new Map(); // recipeId -> total output rate demanded
        const recipeNodes = new Map();   // recipeId -> Node data
        const rawDemands = new Map();    // itemId -> total raw extraction rate
        const rawNodes = new Map();      // itemId -> Node data
        const byproducts = new Map();    // itemId -> { rate, producerRecipeId }

        // BFS / Topological demand resolution queue
        const queue = [targetItem.id];
        const visitedItems = new Set();

        while (queue.length > 0) {
            const currentItemId = queue.shift();
            const currentRateNeeded = itemDemands.get(currentItemId) || 0;
            const currentItem = index.itemById.get(currentItemId);
            if (!currentItem || currentRateNeeded <= 0) continue;

            const isRaw = currentItem.isRawResource || index.resourceById.has(currentItem.id);
            if (isRaw) {
                const prev = rawDemands.get(currentItem.id) || 0;
                rawDemands.set(currentItem.id, prev + currentRateNeeded);
                continue;
            }

            const recipe = getActiveRecipe(currentItem.id, index, recipeOverrides, unlockedRecipes);
            if (!recipe) {
                // Item without recipe - treat as raw input
                const prev = rawDemands.get(currentItem.id) || 0;
                rawDemands.set(currentItem.id, prev + currentRateNeeded);
                continue;
            }

            // Product quantity per cycle
            const prodDef = recipe.products.find(p => p.itemId === currentItem.id) || recipe.products[0];
            const prodAmount = currentItem.isFluid ? (prodDef.amount / 1000.0) : prodDef.amount;
            const cycleDuration = recipe.duration || 4.0;
            const ratePerMachine = (60.0 / cycleDuration) * prodAmount;

            // Machines required for this specific demand increment
            const machinesRequired = currentRateNeeded / ratePerMachine;

            // Accumulate machine count for this recipe
            if (!recipeDemands.has(recipe.id)) {
                recipeDemands.set(recipe.id, {
                    recipe,
                    producedItem: currentItem,
                    machines: machinesRequired,
                    outputRate: currentRateNeeded
                });
            } else {
                const recData = recipeDemands.get(recipe.id);
                recData.machines += machinesRequired;
                recData.outputRate += currentRateNeeded;
            }

            // Check for byproducts (e.g. Heavy Oil Residue in Plastic recipe)
            if (recipe.products.length > 1) {
                for (const otherProd of recipe.products) {
                    if (otherProd.itemId === currentItem.id) continue;
                    const byItem = index.itemById.get(otherProd.itemId);
                    if (!byItem) continue;
                    const byAmount = byItem.isFluid ? (otherProd.amount / 1000.0) : otherProd.amount;
                    const byRate = machinesRequired * (60.0 / cycleDuration) * byAmount;
                    if (!byproducts.has(byItem.id)) {
                        byproducts.set(byItem.id, {
                            item: byItem,
                            rate: byRate,
                            producerRecipeId: recipe.id
                        });
                    } else {
                        byproducts.get(byItem.id).rate += byRate;
                    }
                }
            }

            // Propagate demand to ingredients
            if (recipe.ingredients) {
                for (const ing of recipe.ingredients) {
                    const ingItem = index.itemById.get(ing.itemId);
                    if (!ingItem) continue;
                    const ingAmount = ingItem.isFluid ? (ing.amount / 1000.0) : ing.amount;
                    const ingRateNeeded = machinesRequired * (60.0 / cycleDuration) * ingAmount;

                    const prevDemand = itemDemands.get(ingItem.id) || 0;
                    itemDemands.set(ingItem.id, prevDemand + ingRateNeeded);

                    if (!visitedItems.has(ingItem.id)) {
                        visitedItems.add(ingItem.id);
                        queue.push(ingItem.id);
                    }
                }
            }
        }

        // Build Graph Nodes & Edges
        const nodes = [];
        const edges = [];
        const nodeMap = new Map();

        // 1. Raw Resource Nodes (Source Extractors)
        for (const [rawId, totalRate] of rawDemands.entries()) {
            const rawItem = index.itemById.get(rawId);
            const isFluid = rawItem.isFluid;
            // Base extractor heuristics (e.g. Miner Mk.1 = 60/min, Oil Pump = 120/min)
            let extractorName = isFluid ? 'Oil Extractor' : 'Miner Mk.1';
            let extractorBaseRate = isFluid ? 120.0 : 60.0;
            if (rawItem.name.includes('Water')) {
                extractorName = 'Water Extractor';
                extractorBaseRate = 120.0;
            }
            const extractorCount = totalRate / extractorBaseRate;

            const nodeId = `raw_${rawId}`;
            const node = {
                id: nodeId,
                type: 'raw',
                name: rawItem.name,
                itemId: rawId,
                itemIcon: rawItem.icon || `images/items/${rawId}.png`,
                buildingName: extractorName,
                buildingIcon: `images/items/${rawId}.png`,
                machineCount: extractorCount,
                outputRate: totalRate,
                isFluid: isFluid,
                unit: isFluid ? 'm³/min' : 'units/min',
                isRaw: true,
                isTarget: false,
                isByproduct: false,
                layer: 0
            };
            nodes.push(node);
            nodeMap.set(nodeId, node);
            nodeMap.set(rawId, node); // Lookup alias for recipe ingredients
        }

        // 2. Production Machine Nodes (Recipes)
        for (const [recipeId, data] of recipeDemands.entries()) {
            const { recipe, producedItem, machines, outputRate } = data;
            const bldObj = recipe.primaryBuildingId ? index.buildingById.get(recipe.primaryBuildingId) : null;
            const bldName = recipe.primaryBuildingName || (bldObj ? bldObj.name : 'Assembler');
            const bldIcon = bldObj?.icon || (recipe.primaryBuildingId ? `images/buildings/${recipe.primaryBuildingId}.png` : null);

            const nodeId = `recipe_${recipeId}`;
            const node = {
                id: nodeId,
                type: 'machine',
                name: producedItem.name,
                recipeId: recipe.id,
                recipeName: recipe.name,
                itemId: producedItem.id,
                itemIcon: producedItem.icon || `images/items/${producedItem.id}.png`,
                buildingName: bldName,
                buildingId: recipe.primaryBuildingId,
                buildingIcon: bldIcon || `images/items/${producedItem.id}.png`,
                machineCount: machines,
                outputRate: outputRate,
                isFluid: producedItem.isFluid,
                unit: producedItem.isFluid ? 'm³/min' : 'units/min',
                isRaw: false,
                isTarget: false,
                isByproduct: false,
                isAlternate: !!recipe.isAlternate,
                isLockedInSave: unlockedRecipes ? !unlockedRecipes.has(recipe.id) : false,
                layer: 1
            };
            nodes.push(node);
            nodeMap.set(nodeId, node);
            nodeMap.set(producedItem.id, node); // Lookup alias
        }

        // 3. Final Target Item Node
        const targetNodeId = `target_${targetItem.id}`;
        const targetNode = {
            id: targetNodeId,
            type: 'target',
            name: targetItem.name,
            itemId: targetItem.id,
            itemIcon: targetItem.icon || `images/items/${targetItem.id}.png`,
            buildingName: 'TARGET PRODUCT',
            buildingIcon: targetItem.icon || `images/items/${targetItem.id}.png`,
            machineCount: null,
            outputRate: targetRate,
            isFluid: targetItem.isFluid,
            unit: targetItem.isFluid ? 'm³/min' : 'units/min',
            isRaw: false,
            isTarget: true,
            isByproduct: false,
            layer: 99 // adjusted in layout
        };
        nodes.push(targetNode);
        nodeMap.set(targetNodeId, targetNode);

        // Connect Target Node from its producer machine
        const finalRecipe = getActiveRecipe(targetItem.id, index, recipeOverrides);
        const finalProducer = nodeMap.get(`recipe_${finalRecipe?.id}`);
        if (finalProducer) {
            edges.push({
                id: `edge_${finalProducer.id}_to_${targetNode.id}`,
                sourceId: finalProducer.id,
                targetId: targetNode.id,
                itemId: targetItem.id,
                itemName: targetItem.name,
                itemIcon: targetItem.icon,
                rate: targetRate,
                isFluid: targetItem.isFluid,
                unit: targetItem.isFluid ? 'm³/min' : 'units/min'
            });
        }

        // 4. Byproduct Nodes
        for (const [byItemId, byData] of byproducts.entries()) {
            const byItem = byData.item;
            const byNodeId = `byproduct_${byItemId}`;
            const byNode = {
                id: byNodeId,
                type: 'byproduct',
                name: byItem.name,
                itemId: byItemId,
                itemIcon: byItem.icon || `images/items/${byItemId}.png`,
                buildingName: 'BYPRODUCT',
                buildingIcon: byItem.icon || `images/items/${byItemId}.png`,
                machineCount: null,
                outputRate: byData.rate,
                isFluid: byItem.isFluid,
                unit: byItem.isFluid ? 'm³/min' : 'units/min',
                isRaw: false,
                isTarget: false,
                isByproduct: true,
                layer: 99
            };
            nodes.push(byNode);
            nodeMap.set(byNodeId, byNode);

            const producerNode = nodeMap.get(`recipe_${byData.producerRecipeId}`);
            if (producerNode) {
                edges.push({
                    id: `edge_${producerNode.id}_to_${byNode.id}`,
                    sourceId: producerNode.id,
                    targetId: byNode.id,
                    itemId: byItem.id,
                    itemName: byItem.name,
                    itemIcon: byItem.icon,
                    rate: byData.rate,
                    isFluid: byItem.isFluid,
                    unit: byItem.isFluid ? 'm³/min' : 'units/min',
                    isByproduct: true
                });
            }
        }

        // 5. Connect Ingredients Edges between Machines
        for (const [recipeId, data] of recipeDemands.entries()) {
            const { recipe, machines } = data;
            const consumerNode = nodeMap.get(`recipe_${recipeId}`);
            if (!consumerNode || !recipe.ingredients) continue;

            const cycleDuration = recipe.duration || 4.0;
            for (const ing of recipe.ingredients) {
                const ingItem = index.itemById.get(ing.itemId);
                if (!ingItem) continue;

                const ingAmount = ingItem.isFluid ? (ing.amount / 1000.0) : ing.amount;
                const flowRate = machines * (60.0 / cycleDuration) * ingAmount;

                // Find supplier node (either a recipe machine or raw extractor)
                let supplierNode = null;
                const isRaw = ingItem.isRawResource || index.resourceById.has(ingItem.id);
                if (isRaw) {
                    supplierNode = nodeMap.get(`raw_${ingItem.id}`);
                } else {
                    const supplierRecipe = getActiveRecipe(ingItem.id, index, recipeOverrides);
                    if (supplierRecipe) {
                        supplierNode = nodeMap.get(`recipe_${supplierRecipe.id}`);
                    }
                }

                if (supplierNode && supplierNode.id !== consumerNode.id) {
                    edges.push({
                        id: `edge_${supplierNode.id}_to_${consumerNode.id}_${ingItem.id}`,
                        sourceId: supplierNode.id,
                        targetId: consumerNode.id,
                        itemId: ingItem.id,
                        itemName: ingItem.name,
                        itemIcon: ingItem.icon,
                        rate: flowRate,
                        isFluid: ingItem.isFluid,
                        unit: ingItem.isFluid ? 'm³/min' : 'units/min'
                    });
                }
            }
        }

        // Compute Topological Layers (Sugiyama Layer Assignment)
        assignLayers(nodes, edges);

        return {
            nodes,
            edges,
            targetItem,
            targetRate,
            totalMachines: nodes.reduce((sum, n) => sum + (n.machineCount || 0), 0)
        };
    }

    /**
     * Assigns topological layers from layer 0 (raw ores) up to layer N (target item)
     */
    function assignLayers(nodes, edges) {
        const nodeById = new Map(nodes.map(n => [n.id, n]));
        const inEdges = new Map(nodes.map(n => [n.id, []]));
        const outEdges = new Map(nodes.map(n => [n.id, []]));

        for (const e of edges) {
            inEdges.get(e.targetId)?.push(e);
            outEdges.get(e.sourceId)?.push(e);
        }

        // Longest path layering from sources
        function getLayer(nodeId, visited = new Set()) {
            if (visited.has(nodeId)) return 0;
            visited.add(nodeId);

            const incoming = inEdges.get(nodeId) || [];
            if (incoming.length === 0) return 0;

            let maxLayer = 0;
            for (const edge of incoming) {
                const sourceL = getLayer(edge.sourceId, new Set(visited));
                if (sourceL + 1 > maxLayer) {
                    maxLayer = sourceL + 1;
                }
            }
            return maxLayer;
        }

        for (const node of nodes) {
            if (node.isRaw) {
                node.layer = 0;
            } else if (node.isTarget) {
                // Computed after all others
            } else if (node.isByproduct) {
                // Aligned right of producer
                const inEdge = inEdges.get(node.id)[0];
                if (inEdge) {
                    const prodLayer = getLayer(inEdge.sourceId);
                    node.layer = prodLayer + 1;
                }
            } else {
                node.layer = getLayer(node.id);
            }
        }

        // Ensure target is on the rightmost layer
        const maxIntermediateLayer = Math.max(...nodes.filter(n => !n.isTarget).map(n => n.layer || 0));
        for (const node of nodes) {
            if (node.isTarget) {
                node.layer = maxIntermediateLayer + 1;
            }
        }
    }

    /**
     * Computes multi-port arrival/departure anchor points and cubic Bézier curves for all edges
     */
    function computeAllEdgeGeometries(nodes, edges) {
        const nodeMap = new Map(nodes.map(n => [n.id, n]));

        // Group incoming edges by targetId
        const incomingByTarget = new Map();
        // Group outgoing edges by sourceId
        const outgoingBySource = new Map();

        for (const edge of edges) {
            if (!incomingByTarget.has(edge.targetId)) incomingByTarget.set(edge.targetId, []);
            incomingByTarget.get(edge.targetId).push(edge);

            if (!outgoingBySource.has(edge.sourceId)) outgoingBySource.set(edge.sourceId, []);
            outgoingBySource.get(edge.sourceId).push(edge);
        }

        // Sort incoming edges vertically by source node's Y coordinate to eliminate curve crossings
        for (const inEdges of incomingByTarget.values()) {
            inEdges.sort((a, b) => {
                const srcA = nodeMap.get(a.sourceId);
                const srcB = nodeMap.get(b.sourceId);
                return (srcA?.y || 0) - (srcB?.y || 0);
            });
        }

        // Sort outgoing edges vertically by target node's Y coordinate
        for (const outEdges of outgoingBySource.values()) {
            outEdges.sort((a, b) => {
                const tgtA = nodeMap.get(a.targetId);
                const tgtB = nodeMap.get(b.targetId);
                return (tgtA?.y || 0) - (tgtB?.y || 0);
            });
        }

        // Calculate geometry for every edge
        for (const edge of edges) {
            const src = nodeMap.get(edge.sourceId);
            const tgt = nodeMap.get(edge.targetId);
            if (!src || !tgt) continue;

            const outList = outgoingBySource.get(src.id) || [edge];
            const outIdx = outList.indexOf(edge);
            const outCount = outList.length;

            let srcOffsetY = 0;
            if (outCount > 1) {
                const maxOutSpread = Math.min(src.radius * 1.3, 38);
                srcOffsetY = ((outIdx / (outCount - 1)) - 0.5) * maxOutSpread;
            }
            const srcOffsetX = Math.sqrt(Math.max(4, src.radius * src.radius - srcOffsetY * srcOffsetY));
            const p1 = { x: src.x + srcOffsetX, y: src.y + srcOffsetY };

            const inList = incomingByTarget.get(tgt.id) || [edge];
            const inIdx = inList.indexOf(edge);
            const inCount = inList.length;

            let tgtOffsetY = 0;
            if (inCount > 1) {
                const maxInSpread = Math.min(tgt.radius * 1.35, 46);
                tgtOffsetY = ((inIdx / (inCount - 1)) - 0.5) * maxInSpread;
            }
            const tgtOffsetX = -Math.sqrt(Math.max(4, tgt.radius * tgt.radius - tgtOffsetY * tgtOffsetY));
            const p2 = { x: tgt.x + tgtOffsetX, y: tgt.y + tgtOffsetY };

            // Control points for cubic Bézier with smooth horizontal lead-in/lead-out
            const dist = Math.max(50, Math.abs(p2.x - p1.x) * 0.5);
            const c1 = { x: p1.x + dist, y: p1.y };
            const c2 = { x: p2.x - dist, y: p2.y };

            edge.pathData = `M ${p1.x} ${p1.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${p2.x} ${p2.y}`;

            // Parametric position for label along curve to prevent overlapping pills
            let t = 0.5;
            if (inCount === 2) {
                t = inIdx === 0 ? 0.38 : 0.62;
            } else if (inCount === 3) {
                t = inIdx === 0 ? 0.32 : (inIdx === 1 ? 0.50 : 0.68);
            } else if (inCount >= 4) {
                t = 0.25 + (inIdx / (inCount - 1)) * 0.50;
            }

            const mt = 1 - t;
            const mt2 = mt * mt;
            const mt3 = mt2 * mt;
            const t2 = t * t;
            const t3 = t2 * t;

            edge.labelX = mt3 * p1.x + 3 * mt2 * t * c1.x + 3 * mt * t2 * c2.x + t3 * p2.x;
            edge.labelY = mt3 * p1.y + 3 * mt2 * t * c1.y + 3 * mt * t2 * c2.y + t3 * p2.y - 8;
        }
    }

    /**
     * Computes (X, Y) layout coordinates for nodes and edge curves
     */
    function layoutGraph(dagData, options = {}) {
        const { nodes, edges } = dagData;
        const layerWidth = options.layerWidth || 320;
        const nodeSpacing = options.nodeSpacing || 180;
        const startX = options.startX || 140;

        // Group nodes by layer
        const layers = new Map();
        for (const node of nodes) {
            const l = node.layer;
            if (!layers.has(l)) layers.set(l, []);
            layers.get(l).push(node);
        }

        // Calculate max nodes in any layer to determine canvas bounds
        let maxNodesInLayer = 1;
        for (const list of layers.values()) {
            if (list.length > maxNodesInLayer) maxNodesInLayer = list.length;
        }

        const totalHeight = Math.max(750, maxNodesInLayer * nodeSpacing + 220);
        const sortedLayers = Array.from(layers.keys()).sort((a, b) => a - b);
        const totalWidth = Math.max(1100, sortedLayers.length * layerWidth + 320);

        // Position nodes vertically centered per layer
        for (const l of sortedLayers) {
            const nodeList = layers.get(l);
            const layerHeight = nodeList.length * nodeSpacing;
            const layerStartY = (totalHeight - layerHeight) / 2 + (nodeSpacing / 2);

            nodeList.forEach((node, idx) => {
                node.x = startX + (l * layerWidth);
                node.y = layerStartY + (idx * nodeSpacing);
                node.initialX = node.x;
                node.initialY = node.y;
                node.radius = node.isTarget ? 42 : 36;
            });
        }

        // Compute edge Bézier paths with multi-port distribution and staggered labels
        computeAllEdgeGeometries(nodes, edges);

        return {
            nodes,
            edges,
            width: totalWidth,
            height: totalHeight
        };
    }

    /**
     * Formats number for industrial display (e.g. 0.533 -> '0.54', 1.6 -> '1.6', 4.0 -> '4')
     */
    function formatNumber(val) {
        if (val === null || val === undefined) return '';
        const num = Number(val);
        if (Number.isInteger(num)) return num.toString();
        if (num < 0.01) return num.toFixed(3);
        const rounded = Math.round(num * 100) / 100;
        return rounded.toString();
    }

    /**
     * Drag State for interactive node movement
     */
    const dragState = {
        isDragging: false,
        node: null,
        startX: 0,
        startY: 0,
        nodeStartX: 0,
        nodeStartY: 0
    };

    /**
     * Renders the complete interactive SVG DOM into containerElement
     */
    function renderSVG(layoutResult, containerElement) {
        const { nodes, edges, width, height } = layoutResult;
        containerElement.innerHTML = '';

        const svgNS = "http://www.w3.org/2000/svg";
        const svg = document.createElementNS(svgNS, "svg");
        svg.setAttribute("class", "factory-graph-svg");
        svg.setAttribute("width", "100%");
        svg.setAttribute("height", "100%");

        // Definitions: Markers, ClipPaths, Filters
        const defs = document.createElementNS(svgNS, "defs");

        // Arrow Marker
        const marker = document.createElementNS(svgNS, "marker");
        marker.setAttribute("id", "arrow-head");
        marker.setAttribute("viewBox", "0 0 10 10");
        marker.setAttribute("refX", "8");
        marker.setAttribute("refY", "5");
        marker.setAttribute("markerWidth", "6");
        marker.setAttribute("markerHeight", "6");
        marker.setAttribute("orient", "auto-start-reverse");
        const markerPath = document.createElementNS(svgNS, "path");
        markerPath.setAttribute("d", "M 0 1.5 L 8 5 L 0 8.5 z");
        markerPath.setAttribute("fill", "#64748b");
        marker.appendChild(markerPath);
        defs.appendChild(marker);

        // ClipPath for each circular node image
        for (const node of nodes) {
            const clip = document.createElementNS(svgNS, "clipPath");
            clip.setAttribute("id", `clip_${node.id}`);
            const clipCircle = document.createElementNS(svgNS, "circle");
            clipCircle.setAttribute("cx", node.x);
            clipCircle.setAttribute("cy", node.y);
            clipCircle.setAttribute("r", (node.radius - 4).toString());
            clip.appendChild(clipCircle);
            defs.appendChild(clip);
            node._clipCircle = clipCircle;
        }

        svg.appendChild(defs);

        // Viewport Group for Pan & Zoom
        const viewport = document.createElementNS(svgNS, "g");
        viewport.setAttribute("class", "graph-viewport");

        // --- 1. Edges Layer ---
        const edgesGroup = document.createElementNS(svgNS, "g");
        edgesGroup.setAttribute("class", "graph-edges-layer");

        for (const edge of edges) {
            const gEdge = document.createElementNS(svgNS, "g");
            gEdge.setAttribute("class", "edge-group");

            // Glow background line
            const pathGlow = document.createElementNS(svgNS, "path");
            pathGlow.setAttribute("d", edge.pathData);
            pathGlow.setAttribute("class", "edge-glow");

            // Main edge line
            const path = document.createElementNS(svgNS, "path");
            path.setAttribute("d", edge.pathData);
            path.setAttribute("class", `edge-path ${edge.isFluid ? 'fluid-edge' : ''}`);
            path.setAttribute("marker-end", "url(#arrow-head)");

            // Label pill
            const gLabel = document.createElementNS(svgNS, "g");
            gLabel.setAttribute("class", "edge-label-group");
            gLabel.setAttribute("transform", `translate(${edge.labelX}, ${edge.labelY})`);

            const labelText = `${edge.itemName} (${formatNumber(edge.rate)} ${edge.unit})`;
            const textEl = document.createElementNS(svgNS, "text");
            textEl.setAttribute("class", "edge-label-text");
            textEl.setAttribute("text-anchor", "middle");
            textEl.setAttribute("dy", "3");
            textEl.textContent = labelText;

            // Pill background
            const pillRect = document.createElementNS(svgNS, "rect");
            const pillW = Math.max(70, labelText.length * 6.5 + 14);
            pillRect.setAttribute("class", "edge-label-bg");
            pillRect.setAttribute("x", (-pillW / 2).toString());
            pillRect.setAttribute("y", "-10");
            pillRect.setAttribute("width", pillW.toString());
            pillRect.setAttribute("height", "18");
            pillRect.setAttribute("rx", "9");

            gLabel.appendChild(pillRect);
            gLabel.appendChild(textEl);

            gEdge.appendChild(pathGlow);
            gEdge.appendChild(path);
            gEdge.appendChild(gLabel);
            edgesGroup.appendChild(gEdge);

            // Store DOM references on edge for real-time dragging updates
            edge._pathEl = path;
            edge._glowEl = pathGlow;
            edge._labelEl = gLabel;
        }

        viewport.appendChild(edgesGroup);

        // --- 2. Nodes Layer ---
        const nodesGroup = document.createElementNS(svgNS, "g");
        nodesGroup.setAttribute("class", "graph-nodes-layer");

        for (const node of nodes) {
            const gNode = document.createElementNS(svgNS, "g");
            gNode.setAttribute("class", `graph-node ${node.type}-node ${node.isAlternate ? 'alternate-node' : ''}`);
            gNode.setAttribute("data-id", node.id);

            const color = getMachineColor(node.buildingName, node.isRaw, node.isTarget, node.isByproduct);

            // Outer Glow Circle
            const glowCircle = document.createElementNS(svgNS, "circle");
            glowCircle.setAttribute("cx", node.x);
            glowCircle.setAttribute("cy", node.y);
            glowCircle.setAttribute("r", (node.radius + 3).toString());
            glowCircle.setAttribute("class", `node-glow-ring ${node.isAlternate ? 'alt-glow-ring' : ''}`);
            glowCircle.setAttribute("stroke", node.isAlternate ? '#f59e0b' : color);

            // Node Background Circle
            const bgCircle = document.createElementNS(svgNS, "circle");
            bgCircle.setAttribute("cx", node.x);
            bgCircle.setAttribute("cy", node.y);
            bgCircle.setAttribute("r", node.radius.toString());
            bgCircle.setAttribute("class", "node-bg-circle");
            bgCircle.setAttribute("stroke", color);

            // Node Image
            const imgEl = document.createElementNS(svgNS, "image");
            const imgSize = node.radius * 1.5;
            imgEl.setAttribute("href", node.buildingIcon || node.itemIcon);
            imgEl.setAttribute("x", (node.x - imgSize / 2).toString());
            imgEl.setAttribute("y", (node.y - imgSize / 2).toString());
            imgEl.setAttribute("width", imgSize.toString());
            imgEl.setAttribute("height", imgSize.toString());
            imgEl.setAttribute("clip-path", `url(#clip_${node.id})`);
            imgEl.setAttribute("class", "node-image");

            // Label text underneath node
            const textGroup = document.createElementNS(svgNS, "g");
            textGroup.setAttribute("class", "node-text-group");
            textGroup.setAttribute("transform", `translate(${node.x}, ${node.y + node.radius + 16})`);

            // Primary Label (e.g. "x0.4 Manufacturer" or "1 Computer")
            const titleText = document.createElementNS(svgNS, "text");
            titleText.setAttribute("class", "node-label-title");
            titleText.setAttribute("text-anchor", "middle");

            if (node.isTarget) {
                titleText.textContent = `${formatNumber(node.outputRate)} ${node.name}`;
            } else if (node.isByproduct) {
                titleText.textContent = `${formatNumber(node.outputRate)} ${node.unit} ${node.name}*`;
            } else if (node.machineCount !== null) {
                titleText.textContent = `x${formatNumber(node.machineCount)} ${node.buildingName}`;
            } else {
                titleText.textContent = node.buildingName;
            }

            // Subtitle (e.g. "(Computer)" or "(Wet Concrete) [ALT]" or "(Wet Concrete) 🔒 LOCKED")
            const subText = document.createElementNS(svgNS, "text");
            subText.setAttribute("class", `node-label-sub ${node.isAlternate ? 'alt-label-sub' : ''} ${node.isLockedInSave ? 'locked-label-sub' : ''}`);
            subText.setAttribute("text-anchor", "middle");
            subText.setAttribute("dy", "14");
            if (!node.isTarget && !node.isByproduct) {
                let tag = '';
                if (node.isLockedInSave) {
                    tag = ' 🔒 [LOCKED]';
                } else if (node.isAlternate) {
                    tag = ' [ALT]';
                }
                subText.textContent = `(${node.name})${tag}`;
            }

            textGroup.appendChild(titleText);
            if (!node.isTarget && !node.isByproduct) {
                textGroup.appendChild(subText);
            }

            gNode.appendChild(glowCircle);
            gNode.appendChild(bgCircle);
            gNode.appendChild(imgEl);
            gNode.appendChild(textGroup);
            nodesGroup.appendChild(gNode);

            // Store DOM references on node
            node._glowCircle = glowCircle;
            node._bgCircle = bgCircle;
            node._imgEl = imgEl;
            node._textGroup = textGroup;
            node._gNode = gNode;
            node._imgSize = imgSize;

            // Interactive Node Dragging listener
            gNode.addEventListener('mousedown', (e) => {
                if (e.button !== 0) return;
                e.stopPropagation(); // prevent canvas pan
                e.preventDefault();

                dragState.isDragging = true;
                dragState.node = node;
                dragState.startX = e.clientX;
                dragState.startY = e.clientY;
                dragState.nodeStartX = node.x;
                dragState.nodeStartY = node.y;

                gNode.classList.add('dragging');
            });
        }

        viewport.appendChild(nodesGroup);
        svg.appendChild(viewport);
        containerElement.appendChild(svg);

        // Setup Interactive Pan, Zoom & Node Dragging with Content-Bounding Fit
        setupPanZoomAndDrag(svg, viewport, nodes, edges, width, height);
    }

    /**
     * Configures mouse drag (Pan), scroll wheel (Zoom), and Node Dragging with bounding-box Fit
     */
    function setupPanZoomAndDrag(svg, viewport, nodes, edges, initialWidth, initialHeight) {
        let isPanning = false;
        let panStartX = 0;
        let panStartY = 0;
        let translateX = 0;
        let translateY = 0;
        let scale = 1.0;

        function updateTransform() {
            viewport.setAttribute("transform", `translate(${translateX}, ${translateY}) scale(${scale})`);
        }

        // Calculates the precise bounding box of all nodes and their labels
        function getContentBounds() {
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            for (const node of nodes) {
                const r = node.radius || 40;
                const left = node.x - r - 25;
                const right = node.x + r + 25;
                const top = node.y - r - 15;
                const bottom = node.y + r + 45; // includes text underneath

                if (left < minX) minX = left;
                if (right > maxX) maxX = right;
                if (top < minY) minY = top;
                if (bottom > maxY) maxY = bottom;
            }
            const width = Math.max(100, maxX - minX);
            const height = Math.max(100, maxY - minY);
            return {
                minX, minY, maxX, maxY, width, height,
                centerX: (minX + maxX) / 2,
                centerY: (minY + maxY) / 2
            };
        }

        // Fits ONLY the actual nodes and lines to the viewport with a clean margin
        function fitToContent() {
            const bounds = getContentBounds();
            const cRect = svg.parentElement?.getBoundingClientRect() || svg.getBoundingClientRect();
            if (!cRect || cRect.width <= 0 || cRect.height <= 0) return;

            const padX = 60;
            const padY = 50;
            const availW = Math.max(100, cRect.width - padX * 2);
            const availH = Math.max(100, cRect.height - padY * 2);

            const fitScale = Math.min(availW / bounds.width, availH / bounds.height);
            // Allow zoom up to 1.25x so small chains look great, and down to 0.15x for huge graphs
            scale = Math.min(1.25, Math.max(0.15, fitScale));

            translateX = (cRect.width / 2) - (bounds.centerX * scale);
            translateY = (cRect.height / 2) - (bounds.centerY * scale);
            updateTransform();
        }

        // Canvas Mouse Pan
        svg.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            if (dragState.isDragging) return;
            isPanning = true;
            panStartX = e.clientX - translateX;
            panStartY = e.clientY - translateY;
            svg.style.cursor = 'grabbing';
        });

        // Record initial positions for full reset capability
        for (const node of nodes) {
            if (node.initialX === undefined) node.initialX = node.x;
            if (node.initialY === undefined) node.initialY = node.y;
        }

        // Helper to update a node's visual SVG DOM elements
        function updateNodeVisual(node) {
            if (node._glowCircle) {
                node._glowCircle.setAttribute("cx", node.x);
                node._glowCircle.setAttribute("cy", node.y);
            }
            if (node._bgCircle) {
                node._bgCircle.setAttribute("cx", node.x);
                node._bgCircle.setAttribute("cy", node.y);
            }
            if (node._imgEl) {
                node._imgEl.setAttribute("x", (node.x - node._imgSize / 2).toString());
                node._imgEl.setAttribute("y", (node.y - node._imgSize / 2).toString());
            }
            if (node._clipCircle) {
                node._clipCircle.setAttribute("cx", node.x);
                node._clipCircle.setAttribute("cy", node.y);
            }
            if (node._textGroup) {
                node._textGroup.setAttribute("transform", `translate(${node.x}, ${node.y + node.radius + 16})`);
            }
        }

        // Helper to recompute and re-render all edge curves and labels
        function updateAllEdges() {
            computeAllEdgeGeometries(nodes, edges);
            for (const edge of edges) {
                if (edge._pathEl) edge._pathEl.setAttribute("d", edge.pathData);
                if (edge._glowEl) edge._glowEl.setAttribute("d", edge.pathData);
                if (edge._labelEl) edge._labelEl.setAttribute("transform", `translate(${edge.labelX}, ${edge.labelY})`);
            }
        }

        // Window MouseMove (handles both Canvas Pan and Node Dragging)
        window.addEventListener('mousemove', (e) => {
            if (dragState.isDragging && dragState.node) {
                const node = dragState.node;
                const dx = (e.clientX - dragState.startX) / scale;
                const dy = (e.clientY - dragState.startY) / scale;
                node.x = dragState.nodeStartX + dx;
                node.y = dragState.nodeStartY + dy;

                updateNodeVisual(node);
                updateAllEdges();
                return;
            }

            if (isPanning) {
                translateX = e.clientX - panStartX;
                translateY = e.clientY - panStartY;
                updateTransform();
            }
        });

        window.addEventListener('mouseup', () => {
            if (dragState.isDragging) {
                if (dragState.node && dragState.node._gNode) {
                    dragState.node._gNode.classList.remove('dragging');
                }
                dragState.isDragging = false;
                dragState.node = null;
            }
            if (isPanning) {
                isPanning = false;
                svg.style.cursor = 'grab';
            }
        });

        // Mouse Wheel Zoom centered at pointer
        svg.addEventListener('wheel', (e) => {
            e.preventDefault();
            const rect = svg.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;

            const zoomFactor = e.deltaY < 0 ? 1.12 : 0.89;
            const newScale = Math.min(3.0, Math.max(0.25, scale * zoomFactor));

            // Adjust translation to zoom towards mouse position
            translateX = mouseX - (mouseX - translateX) * (newScale / scale);
            translateY = mouseY - (mouseY - translateY) * (newScale / scale);
            scale = newScale;
            updateTransform();
        }, { passive: false });

        // Fit immediately on load
        fitToContent();
        // And re-fit on next tick in case parent container layout is pending
        setTimeout(fitToContent, 60);

        // Expose control methods via svg._panZoom
        svg._panZoom = {
            zoomIn: () => {
                scale = Math.min(3.0, scale * 1.2);
                updateTransform();
            },
            zoomOut: () => {
                scale = Math.max(0.25, scale / 1.2);
                updateTransform();
            },
            reset: () => {
                for (const node of nodes) {
                    if (node.initialX !== undefined && node.initialY !== undefined) {
                        node.x = node.initialX;
                        node.y = node.initialY;
                        updateNodeVisual(node);
                    }
                }
                updateAllEdges();
                fitToContent();
            },
            fit: () => {
                fitToContent();
            },
            getScale: () => scale
        };
    }

    return {
        calculateFactoryDAG,
        layoutGraph,
        renderSVG,
        MACHINE_COLORS
    };
}));

