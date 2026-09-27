/**
 * Satisfactory Production Chain Engine
 * 
 * Recursively resolves the full manufacturing dependency tree for any item
 * down to raw harvestable resources, identifying responsible production buildings
 * and tracking available alternate recipes without deduplicating branches.
 */

(function (root, factory) {
    const exported = factory();
    if (typeof define === 'function' && define.amd) {
        define([], function () { return exported; });
    } else if (typeof module === 'object' && module.exports) {
        module.exports = exported;
    }
    if (typeof root !== 'undefined') {
        root.ProductionTree = exported;
    }
    if (typeof window !== 'undefined') {
        window.ProductionTree = exported;
    }
    if (typeof globalThis !== 'undefined') {
        globalThis.ProductionTree = exported;
    }
}(typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : this), function () {

    /**
     * Pre-indexes datasets for O(1) lookups
     * @param {Object} dataset { items, recipes, buildings, resources }
     */
    function createIndex(dataset) {
        const itemById = new Map();
        const itemByName = new Map();
        const buildingById = new Map();
        const resourceById = new Map();
        const recipeById = new Map();
        const recipesByProduct = new Map(); // itemId -> Array of recipes
        const recipesByIngredient = new Map(); // itemId -> Array of recipes

        if (dataset.items) {
            for (const item of dataset.items) {
                itemById.set(item.id, item);
                itemByName.set(item.name.toLowerCase().trim(), item);
            }
        }

        if (dataset.buildings) {
            for (const b of dataset.buildings) {
                buildingById.set(b.id, b);
            }
        }

        if (dataset.resources) {
            for (const r of dataset.resources) {
                resourceById.set(r.id, r);
            }
        }

        if (dataset.recipes) {
            for (const recipe of dataset.recipes) {
                recipeById.set(recipe.id, recipe);
                if (recipe.products) {
                    for (const prod of recipe.products) {
                        if (!recipesByProduct.has(prod.itemId)) {
                            recipesByProduct.set(prod.itemId, []);
                        }
                        recipesByProduct.get(prod.itemId).push(recipe);
                    }
                }
                if (recipe.ingredients) {
                    for (const ing of recipe.ingredients) {
                        if (!recipesByIngredient.has(ing.itemId)) {
                            recipesByIngredient.set(ing.itemId, []);
                        }
                        recipesByIngredient.get(ing.itemId).push(recipe);
                    }
                }
            }

            // Sort recipesByProduct so that recipes where the item is the PRIMARY product (products[0])
            // always appear before recipes where the item is merely an incidental secondary by-product.
            for (const [prodId, rList] of recipesByProduct.entries()) {
                rList.sort((a, b) => {
                    const aIsPrimary = a.products && a.products[0] && a.products[0].itemId === prodId;
                    const bIsPrimary = b.products && b.products[0] && b.products[0].itemId === prodId;
                    if (aIsPrimary && !bIsPrimary) return -1;
                    if (!aIsPrimary && bIsPrimary) return 1;
                    if (!a.isAlternate && b.isAlternate) return -1;
                    if (a.isAlternate && !b.isAlternate) return 1;
                    return 0;
                });
            }
        }

        return {
            itemById,
            itemByName,
            buildingById,
            resourceById,
            recipeById,
            recipesByProduct,
            recipesByIngredient
        };
    }

    /**
     * Resolves an item object by its ID or display name
     */
    function findItem(identifier, index) {
        if (!identifier) return null;
        if (index.itemById.has(identifier)) {
            return index.itemById.get(identifier);
        }
        const lower = String(identifier).toLowerCase().trim();
        if (index.itemByName.has(lower)) {
            return index.itemByName.get(lower);
        }
        // Partial search
        for (const [name, item] of index.itemByName.entries()) {
            if (name === lower || name.includes(lower)) {
                return item;
            }
        }
        return null;
    }

    /**
     * Selects the default (standard/base) recipe for an item.
     * Always prefers recipes where the item is the PRIMARY product over incidental by-products.
     * Always prefers non-alternate recipes.
     */
    function getDefaultRecipe(itemId, index, unlockedRecipes = null) {
        const recipes = index.recipesByProduct.get(itemId) || [];
        if (recipes.length === 0) return null;

        // Separate recipes where itemId is the PRIMARY product (products[0]) from secondary by-product recipes
        const primaryRecipes = recipes.filter(r => r.products && r.products[0] && r.products[0].itemId === itemId);
        const secondaryRecipes = recipes.filter(r => !r.products || !r.products[0] || r.products[0].itemId !== itemId);

        function pickBest(list) {
            if (list.length === 0) return null;

            // 1. Standard (non-alternate) recipe
            const standardRecipe = list.find(r => !r.isAlternate);
            if (standardRecipe) return standardRecipe;

            // 2. Unlocked recipe if filter active
            if (unlockedRecipes && unlockedRecipes.size > 0) {
                const unlocked = list.find(r => unlockedRecipes.has(r.id));
                if (unlocked) return unlocked;
            }

            // 3. Fallback to first in list
            return list[0];
        }

        // Always prioritize recipes where itemId is the primary product!
        const primaryChoice = pickBest(primaryRecipes);
        if (primaryChoice) return primaryChoice;

        // Fallback only if no primary production recipe exists
        return pickBest(secondaryRecipes);
    }

    /**
     * Resolves the active recipe for an item taking user overrides and unlocked save recipes into account.
     */
    function getActiveRecipe(itemId, index, recipeOverrides, unlockedRecipes = null) {
        if (recipeOverrides) {
            const customRecipeId = recipeOverrides instanceof Map 
                ? recipeOverrides.get(itemId) 
                : recipeOverrides[itemId];
            if (customRecipeId && index.recipeById && index.recipeById.has(customRecipeId)) {
                return index.recipeById.get(customRecipeId);
            }
        }
        return getDefaultRecipe(itemId, index, unlockedRecipes);
    }

    /**
     * Resolves the primary building name for a recipe
     */
    function getBuildingName(recipe, index) {
        if (!recipe) return 'RAW RESOURCE';
        if (recipe.primaryBuildingName && recipe.primaryBuildingName !== 'CraftBench') {
            return recipe.primaryBuildingName;
        }
        if (recipe.primaryBuildingId && index.buildingById.has(recipe.primaryBuildingId)) {
            return index.buildingById.get(recipe.primaryBuildingId).name;
        }
        return 'Manufacturer';
    }

    /**
     * Recursively resolves the production chain for a target item.
     * 
     * Rule: Branches are NOT deduplicated (e.g. if Circuit Board and Cable both use Copper Ingot,
     * both branches are fully preserved in the tree).
     * 
     * @param {string} itemIdentifier Item ID (e.g. 'Desc_Computer_C') or Name ('Computer')
     * @param {Object} dataset { items, recipes, buildings, resources } or an indexed object
     * @param {Object} [options] Configuration options
     * @returns {Object} Root node of the production tree
     */
    function resolveProductionChain(itemIdentifier, dataset, options = {}) {
        const index = dataset.itemById ? dataset : createIndex(dataset);
        const item = findItem(itemIdentifier, index);

        if (!item) {
            throw new Error(`Item not found: "${itemIdentifier}"`);
        }

        const maxDepth = options.maxDepth || 25;

        function buildNode(currentItem, depth, visitedPath) {
            const isRaw = currentItem.isRawResource || index.resourceById.has(currentItem.id);
            const itemIcon = currentItem.icon || `images/items/${currentItem.id}.png`;

            // Base case: Raw resource reached
            if (isRaw) {
                return {
                    id: currentItem.id,
                    name: currentItem.name,
                    icon: itemIcon,
                    category: currentItem.category || 'Raw Resource',
                    isRawResource: true,
                    form: currentItem.form,
                    recipe: null,
                    building: 'RAW RESOURCE',
                    buildingId: null,
                    buildingIcon: null,
                    alternateRecipesCount: 0,
                    alternateRecipes: [],
                    children: []
                };
            }

            // Cycle guard
            if (visitedPath.includes(currentItem.id)) {
                return {
                    id: currentItem.id,
                    name: currentItem.name,
                    icon: itemIcon,
                    isCycle: true,
                    isRawResource: false,
                    building: 'CYCLE DETECTED',
                    children: []
                };
            }

            if (depth >= maxDepth) {
                return {
                    id: currentItem.id,
                    name: currentItem.name,
                    icon: itemIcon,
                    isMaxDepth: true,
                    isRawResource: false,
                    building: 'DEPTH LIMIT',
                    children: []
                };
            }

            // Find all recipes producing this item
            const unlockedRecipes = options.unlockedRecipes || null;
            const allRecipes = (index.recipesByProduct.get(currentItem.id) || []).map(r => ({
                ...r,
                isUnlockedInSave: unlockedRecipes ? unlockedRecipes.has(r.id) : true
            }));
            const activeRecipe = getActiveRecipe(currentItem.id, index, options.recipeOverrides, unlockedRecipes);
            const alternateRecipes = allRecipes.filter(r => r.isAlternate);

            if (!activeRecipe) {
                // Item has no recipe and is not classified as raw resource
                return {
                    id: currentItem.id,
                    name: currentItem.name,
                    icon: itemIcon,
                    category: currentItem.category,
                    isRawResource: false,
                    noRecipeFound: true,
                    building: 'UNKNOWN',
                    children: []
                };
            }

            const isRecipeLocked = unlockedRecipes ? !unlockedRecipes.has(activeRecipe.id) : false;
            const buildingName = getBuildingName(activeRecipe, index);
            const buildingId = activeRecipe.primaryBuildingId;
            const buildingObj = buildingId ? index.buildingById.get(buildingId) : null;
            const buildingIcon = buildingObj?.icon || (buildingId ? `images/buildings/${buildingId}.png` : null);

            const children = [];
            const nextPath = [...visitedPath, currentItem.id];

            // Recurse for each ingredient (do not deduplicate branches)
            if (activeRecipe.ingredients) {
                for (const ing of activeRecipe.ingredients) {
                    const ingItem = index.itemById.get(ing.itemId);
                    if (ingItem) {
                        const childNode = buildNode(ingItem, depth + 1, nextPath);
                        childNode.requiredAmount = ing.amount;
                        children.push(childNode);
                    } else {
                        children.push({
                            id: ing.itemId,
                            name: ing.itemId,
                            icon: `images/items/${ing.itemId}.png`,
                            isUnknown: true,
                            building: 'UNKNOWN',
                            children: []
                        });
                    }
                }
            }

            // Secondary by-products generated by this recipe
            const byproducts = (activeRecipe.products || [])
                .filter(p => p.itemId !== currentItem.id)
                .map(p => {
                    const byItem = index.itemById.get(p.itemId) || { id: p.itemId, name: p.itemId, icon: `images/items/${p.itemId}.png`, isFluid: false };
                    const byAmount = byItem.isFluid ? (p.amount / 1000.0) : p.amount;
                    return {
                        id: byItem.id,
                        name: byItem.name,
                        icon: byItem.icon || `images/items/${byItem.id}.png`,
                        isFluid: !!byItem.isFluid,
                        unit: byItem.isFluid ? 'm³/min' : 'parts/min',
                        amount: byAmount
                    };
                });

            return {
                id: currentItem.id,
                name: currentItem.name,
                icon: itemIcon,
                category: currentItem.category,
                isRawResource: false,
                recipe: {
                    id: activeRecipe.id,
                    name: activeRecipe.name,
                    duration: activeRecipe.duration,
                    isAlternate: !!activeRecipe.isAlternate,
                    isLockedInSave: isRecipeLocked
                },
                building: buildingName,
                buildingId: buildingId,
                buildingIcon: buildingIcon,
                alternateRecipesCount: alternateRecipes.length,
                alternateRecipes: alternateRecipes.map(r => ({
                    id: r.id,
                    name: r.name,
                    duration: r.duration,
                    isUnlockedInSave: r.isUnlockedInSave
                })),
                allRecipes: allRecipes,
                byproducts: byproducts,
                children: children
            };
        }

        return buildNode(item, 0, []);
    }

    /**
     * Traverses the production tree to extract the set of unique raw resources
     * @param {Object} treeRoot
     * @returns {Array<string>} Array of raw resource names
     */
    function extractRawResourcesSummary(treeRoot) {
        const rawSet = new Set();

        function traverse(node) {
            if (!node) return;
            if (node.isRawResource) {
                rawSet.add(node.name);
                return;
            }
            if (node.children) {
                for (const child of node.children) {
                    traverse(child);
                }
            }
        }

        traverse(treeRoot);
        return Array.from(rawSet).sort();
    }

    /**
     * Traverses the production tree to extract the set of unique production buildings
     * @param {Object} treeRoot
     * @returns {Array<string>} Array of building names
     */
    function extractBuildingsSummary(treeRoot) {
        const buildingSet = new Set();

        function traverse(node) {
            if (!node) return;
            if (node.building && node.building !== 'RAW RESOURCE' && node.building !== 'UNKNOWN' && node.building !== 'CYCLE DETECTED') {
                buildingSet.add(node.building);
            }
            if (node.children) {
                for (const child of node.children) {
                    traverse(child);
                }
            }
        }

        traverse(treeRoot);
        return Array.from(buildingSet).sort();
    }

    /**
     * Traverses the production tree to extract by-products generated across the chain
     * @param {Object} treeRoot
     * @returns {Array<Object>} Unique byproducts with item info and list of producing machines/recipes
     */
    function extractByproductsSummary(treeRoot) {
        const byMap = new Map();

        function traverse(node) {
            if (!node) return;
            if (node.byproducts && node.byproducts.length > 0) {
                for (const by of node.byproducts) {
                    if (!byMap.has(by.id)) {
                        byMap.set(by.id, {
                            id: by.id,
                            name: by.name,
                            icon: by.icon,
                            isFluid: by.isFluid,
                            unit: by.unit,
                            producers: []
                        });
                    }
                    byMap.get(by.id).producers.push({
                        recipeName: node.recipe?.name,
                        building: node.building,
                        amount: by.amount
                    });
                }
            }
            if (node.children) {
                for (const child of node.children) {
                    traverse(child);
                }
            }
        }

        traverse(treeRoot);
        return Array.from(byMap.values()).sort((a, b) => a.name.localeCompare(b.name));
    }

    /**
     * Counts the total number of production nodes across the full tree
     */
    function countTotalNodes(treeRoot) {
        let count = 0;
        function traverse(node) {
            if (!node) return;
            count++;
            if (node.children) {
                for (const child of node.children) {
                    traverse(child);
                }
            }
        }
        traverse(treeRoot);
        return count;
    }

    /**
     * Helper to collect all paths from leaves (raw resources) to the root target item
     */
    function collectLeafToRootPaths(node, currentPath = []) {
        const step = {
            id: node.id,
            name: node.name,
            category: node.category,
            isRawResource: node.isRawResource,
            form: node.form,
            recipe: node.recipe,
            building: node.building,
            buildingId: node.buildingId,
            alternateRecipesCount: node.alternateRecipesCount,
            alternateRecipes: node.alternateRecipes,
            requiredAmount: node.requiredAmount
        };

        const newPath = [step, ...currentPath];

        if (!node.children || node.children.length === 0) {
            return [newPath];
        }

        const allPaths = [];
        for (const child of node.children) {
            allPaths.push(...collectLeafToRootPaths(child, newPath));
        }
        return allPaths;
    }

    /**
     * Builds an inverted (Bottom-Up) production tree starting from Raw Resources
     * and flowing forward through intermediate manufacturing stages up to the Target item.
     * 
     * @param {Object} topDownTree Root node from resolveProductionChain
     * @returns {Object} Inverted tree root
     */
    function buildBottomUpTree(topDownTree) {
        if (!topDownTree) return null;
        const paths = collectLeafToRootPaths(topDownTree);

        function mergePaths(pathsList, depth) {
            const groups = new Map();

            for (const path of pathsList) {
                if (depth >= path.length) continue;
                const node = path[depth];
                const key = node.id;
                if (!groups.has(key)) {
                    groups.set(key, {
                        template: node,
                        subPaths: []
                    });
                }
                groups.get(key).subPaths.push(path);
            }

            const resultNodes = [];
            for (const [key, group] of groups.entries()) {
                const isTarget = (depth === group.subPaths[0].length - 1);
                const nextChildren = mergePaths(group.subPaths, depth + 1);

                const mergedNode = Object.assign({}, group.template, {
                    isTarget: isTarget,
                    children: nextChildren
                });
                resultNodes.push(mergedNode);
            }

            return resultNodes;
        }

        const rawRoots = mergePaths(paths, 0);

        return {
            id: 'BOTTOM_UP_ROOT',
            name: 'RAW ORE INPUTS',
            isWrapper: true,
            isRawResource: false,
            building: 'SOURCE ORES',
            children: rawRoots
        };
    }

    /**
     * Helper to compute Power Shards required for a clock speed percentage
     */
    function getShardsRequired(clockSpeedPercent) {
        if (clockSpeedPercent <= 100) return 0;
        if (clockSpeedPercent <= 150) return 1;
        if (clockSpeedPercent <= 200) return 2;
        return 3;
    }

    /**
     * Helper to calculate smart integer-machine overclock presets
     */
    function calculateOverclockPresets(machines100) {
        const presets = [];
        if (!machines100 || machines100 <= 0) return presets;

        // 1. Underclock option: Math.ceil(machines100) machines
        const ceilMachines = Math.ceil(machines100);
        if (ceilMachines > 0) {
            const clockSpeed = (machines100 / ceilMachines) * 100;
            presets.push({
                type: 'underclock',
                label: `${ceilMachines}× @ ${Math.round(clockSpeed * 10) / 10}%`,
                machineCount: ceilMachines,
                clockSpeedPercent: clockSpeed,
                shardsPerMachine: 0,
                totalShards: 0,
                badge: 'Underclocked (Power Saver)'
            });
        }

        // 2. Overclock option 1: Math.floor(machines100) machines
        const floorMachines = Math.floor(machines100);
        if (floorMachines > 0 && floorMachines !== ceilMachines) {
            const clockSpeed = (machines100 / floorMachines) * 100;
            if (clockSpeed <= 250) {
                const shards = getShardsRequired(clockSpeed);
                presets.push({
                    type: 'overclock',
                    label: `${floorMachines}× @ ${Math.round(clockSpeed * 10) / 10}%`,
                    machineCount: floorMachines,
                    clockSpeedPercent: clockSpeed,
                    shardsPerMachine: shards,
                    totalShards: shards * floorMachines,
                    badge: `${shards} Shard${shards > 1 ? 's' : ''} each`
                });
            }
        }

        // 3. Compact option: floorMachines - 1 (if valid <= 250%)
        if (floorMachines > 1) {
            const compactMachines = floorMachines - 1;
            const clockSpeed = (machines100 / compactMachines) * 100;
            if (clockSpeed <= 250 && !presets.some(p => p.machineCount === compactMachines)) {
                const shards = getShardsRequired(clockSpeed);
                presets.push({
                    type: 'compact',
                    label: `${compactMachines}× @ ${Math.round(clockSpeed * 10) / 10}%`,
                    machineCount: compactMachines,
                    clockSpeedPercent: clockSpeed,
                    shardsPerMachine: shards,
                    totalShards: shards * compactMachines,
                    badge: `${shards} Shard${shards > 1 ? 's' : ''} each`
                });
            }
        }

        // 4. Maximum compaction: smallest integer >= machines100 / 2.5
        const minMachinesAt250 = Math.ceil(machines100 / 2.5);
        if (minMachinesAt250 > 0 && !presets.some(p => p.machineCount === minMachinesAt250)) {
            const clockSpeed = (machines100 / minMachinesAt250) * 100;
            if (clockSpeed <= 250) {
                const shards = getShardsRequired(clockSpeed);
                presets.push({
                    type: 'max_compact',
                    label: `${minMachinesAt250}× @ ${Math.round(clockSpeed * 10) / 10}%`,
                    machineCount: minMachinesAt250,
                    clockSpeedPercent: clockSpeed,
                    shardsPerMachine: shards,
                    totalShards: shards * minMachinesAt250,
                    badge: `Max Compaction (${shards} Shards each)`
                });
            }
        }

        return presets;
    }

    /**
     * Resolves all immediate next-step consumer recipes for an available input item and rate.
     * 
     * @param {string} itemIdentifier Item ID or Name
     * @param {number} inputRate Available rate per minute (e.g. 225)
     * @param {Object} index Pre-built index from createIndex
     * @param {Object} [options] { unlockedRecipes: Set<string> }
     * @returns {Array<Object>} List of evaluated next-step recipe options
     */
    function findNextStepOptions(itemIdentifier, inputRate, index, options = {}) {
        const item = findItem(itemIdentifier, index);
        if (!item || !index.recipesByIngredient) return [];

        const recipes = index.recipesByIngredient.get(item.id) || [];
        const unlockedRecipes = options.unlockedRecipes || null;

        const results = [];

        for (const recipe of recipes) {
            const isAlternate = !!recipe.isAlternate;
            const isUnlocked = unlockedRecipes ? unlockedRecipes.has(recipe.id) : true;

            // Skip manual CraftBench / Workshop equipment recipes since they cannot be automated or overclocked
            if (recipe.primaryBuildingName === 'CraftBench' || recipe.primaryBuildingId === 'Build_CraftBench_C' || recipe.primaryBuildingId === 'Build_Workshop_C') {
                continue;
            }

            // Find this input item in recipe ingredients
            const ingDef = (recipe.ingredients || []).find(i => i.itemId === item.id);
            if (!ingDef) continue;

            const cycleDuration = recipe.duration || 4.0;
            const cyclesPerMin = 60.0 / cycleDuration;
            const ingAmount = item.isFluid ? (ingDef.amount / 1000.0) : ingDef.amount;
            const consumptionPerMachine100 = cyclesPerMin * ingAmount;

            if (consumptionPerMachine100 <= 0) continue;

            // Base machines needed at 100% clock speed
            const machinesNeeded100 = inputRate / consumptionPerMachine100;

            // Products generated
            const products = (recipe.products || []).map((p, pIdx) => {
                const prodItem = index.itemById.get(p.itemId) || { id: p.itemId, name: p.itemId, icon: `images/items/${p.itemId}.png`, isFluid: false };
                const prodAmount = prodItem.isFluid ? (p.amount / 1000.0) : p.amount;
                const outputPerMachine100 = cyclesPerMin * prodAmount;
                const totalOutputRate = machinesNeeded100 * outputPerMachine100;
                return {
                    id: prodItem.id,
                    name: prodItem.name,
                    icon: prodItem.icon || `images/items/${prodItem.id}.png`,
                    isFluid: !!prodItem.isFluid,
                    unit: prodItem.isFluid ? 'm³/min' : 'parts/min',
                    amountPerCycle: prodAmount,
                    outputPerMachine100,
                    totalOutputRate,
                    isByproduct: pIdx > 0
                };
            });

            // Co-ingredients required
            const coIngredients = (recipe.ingredients || [])
                .filter(i => i.itemId !== item.id)
                .map(i => {
                    const coItem = index.itemById.get(i.itemId) || { id: i.itemId, name: i.itemId, icon: `images/items/${i.itemId}.png`, isFluid: false };
                    const coAmount = coItem.isFluid ? (i.amount / 1000.0) : i.amount;
                    const requiredPerMachine100 = cyclesPerMin * coAmount;
                    const totalRequiredRate = machinesNeeded100 * requiredPerMachine100;
                    return {
                        id: coItem.id,
                        name: coItem.name,
                        icon: coItem.icon || `images/items/${coItem.id}.png`,
                        isFluid: !!coItem.isFluid,
                        unit: coItem.isFluid ? 'm³/min' : 'parts/min',
                        amountPerCycle: coAmount,
                        requiredPerMachine100,
                        totalRequiredRate
                    };
                });

            // Machine building metadata
            const bldObj = recipe.primaryBuildingId ? index.buildingById.get(recipe.primaryBuildingId) : null;
            const buildingName = recipe.primaryBuildingName || (bldObj ? bldObj.name : 'Manufacturer');
            const buildingId = recipe.primaryBuildingId || bldObj?.id;
            const buildingIcon = bldObj?.icon || (buildingId ? `images/buildings/${buildingId}.png` : null);

            // Calculate Overclock presets and suggestions
            const smartPresets = calculateOverclockPresets(machinesNeeded100);

            results.push({
                recipeId: recipe.id,
                recipeName: recipe.name,
                isAlternate,
                isUnlocked,
                buildingName,
                buildingId,
                buildingIcon,
                cycleDuration,
                cyclesPerMin,
                inputItem: item,
                inputAmountPerCycle: ingAmount,
                inputConsumptionPerMachine100: consumptionPerMachine100,
                machinesNeeded100,
                products,
                coIngredients,
                smartPresets
            });
        }

        // Sort: Standard recipes first, then alternates alphabetically by primary product
        results.sort((a, b) => {
            if (a.isAlternate !== b.isAlternate) {
                return a.isAlternate ? 1 : -1;
            }
            const nameA = a.products[0]?.name || a.recipeName;
            const nameB = b.products[0]?.name || b.recipeName;
            return nameA.localeCompare(nameB);
        });

        return results;
    }

    return {
        createIndex,
        findItem,
        resolveProductionChain,
        buildBottomUpTree,
        extractRawResourcesSummary,
        extractBuildingsSummary,
        extractByproductsSummary,
        countTotalNodes,
        getActiveRecipe,
        getDefaultRecipe,
        findNextStepOptions,
        calculateOverclockPresets,
        getShardsRequired
    };
}));

