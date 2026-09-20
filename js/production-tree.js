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
                if (!recipe.products) continue;
                for (const prod of recipe.products) {
                    if (!recipesByProduct.has(prod.itemId)) {
                        recipesByProduct.set(prod.itemId, []);
                    }
                    recipesByProduct.get(prod.itemId).push(recipe);
                }
            }
        }

        return {
            itemById,
            itemByName,
            buildingById,
            resourceById,
            recipeById,
            recipesByProduct
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
     * Always prefers non-alternate recipes.
     */
    function getDefaultRecipe(itemId, index, unlockedRecipes = null) {
        const recipes = index.recipesByProduct.get(itemId) || [];
        if (recipes.length === 0) return null;

        // 1. Look for standard (non-alternate) recipe
        const standardRecipe = recipes.find(r => !r.isAlternate);
        if (standardRecipe) return standardRecipe;

        // 2. If unlockedRecipes filter is provided, prefer an unlocked recipe
        if (unlockedRecipes && unlockedRecipes.size > 0) {
            const unlocked = recipes.find(r => unlockedRecipes.has(r.id));
            if (unlocked) return unlocked;
        }

        // 3. Fallback to first available recipe
        return recipes[0];
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

    return {
        createIndex,
        findItem,
        resolveProductionChain,
        buildBottomUpTree,
        extractRawResourcesSummary,
        extractBuildingsSummary,
        countTotalNodes,
        getActiveRecipe,
        getDefaultRecipe
    };
}));

