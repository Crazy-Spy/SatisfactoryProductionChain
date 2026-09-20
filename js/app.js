/**
 * Satisfactory Production Chain - Webapp Controller
 */

(function () {
    'use strict';

    // Application State
    const state = {
        dataset: null,
        index: null,
        activeItem: null,
        activeTree: null,
        flowDirection: 'top-down', // 'top-down' | 'bottom-up'
        viewMode: 'graph',         // 'graph' (default) | 'tree'
        targetRate: 1.0,
        selectedRecipes: new Map(), // itemId -> recipeId
        saveData: null,             // { sessionName, playDurationFormatted, totalAvailableRecipes, unlockedAlternateRecipesCount, unlockedRecipeIds: Set }
        hideLockedRecipes: false
    };

    // DOM Elements
    const elements = {
        loadingIndicator: document.getElementById('loadingIndicator'),
        welcomeState: document.getElementById('welcomeState'),
        resultsWorkspace: document.getElementById('resultsWorkspace'),
        itemSearchInput: document.getElementById('itemSearchInput'),
        clearSearchBtn: document.getElementById('clearSearchBtn'),
        dropdownToggleBtn: document.getElementById('dropdownToggleBtn'),
        searchResultsDropdown: document.getElementById('searchResultsDropdown'),
        activeItemIcon: document.getElementById('activeItemIcon'),
        activeItemTitle: document.getElementById('activeItemTitle'),
        activeItemDescription: document.getElementById('activeItemDescription'),
        automationNarrativeCard: document.getElementById('automationNarrativeCard'),
        automationNarrativeBody: document.getElementById('automationNarrativeBody'),
        treeContainer: document.getElementById('treeContainer'),
        rawResourcesList: document.getElementById('rawResourcesList'),
        buildingsList: document.getElementById('buildingsList'),
        alternatesCardContent: document.getElementById('alternatesCardContent'),
        totalNodesBadge: document.getElementById('totalNodesBadge'),
        expandAllBtn: document.getElementById('expandAllBtn'),
        collapseAllBtn: document.getElementById('collapseAllBtn'),
        flowTopDownBtn: document.getElementById('flowTopDownBtn'),
        flowBottomUpBtn: document.getElementById('flowBottomUpBtn'),
        // View Mode Switcher
        tabTreeViewBtn: document.getElementById('tabTreeViewBtn'),
        tabGraphViewBtn: document.getElementById('tabGraphViewBtn'),
        treeWorkspaceGrid: document.getElementById('treeWorkspaceGrid'),
        treeControlsGroup: document.getElementById('treeControlsGroup'),
        graphToolbarGroup: document.getElementById('graphToolbarGroup'),
        // Factory Graph Controls
        factoryGraphSection: document.getElementById('factoryGraphSection'),
        graphTargetRateInput: document.getElementById('graphTargetRateInput'),
        graphRateUnit: document.getElementById('graphRateUnit'),
        graphTotalMachines: document.getElementById('graphTotalMachines'),
        graphTotalSteps: document.getElementById('graphTotalSteps'),
        graphAltsToggleBtn: document.getElementById('graphAltsToggleBtn'),
        graphAltsCountBadge: document.getElementById('graphAltsCountBadge'),
        graphZoomInBtn: document.getElementById('graphZoomInBtn'),
        graphZoomOutBtn: document.getElementById('graphZoomOutBtn'),
        graphFitBtn: document.getElementById('graphFitBtn'),
        graphResetBtn: document.getElementById('graphResetBtn'),
        graphCanvasContainer: document.getElementById('graphCanvasContainer'),
        graphAltsDrawer: document.getElementById('graphAltsDrawer'),
        closeAltsDrawerBtn: document.getElementById('closeAltsDrawerBtn'),
        graphAltsDrawerContent: document.getElementById('graphAltsDrawerContent'),
        // Stat badges
        statItemsCount: document.getElementById('statItemsCount'),
        statRecipesCount: document.getElementById('statRecipesCount'),
        statBuildingsCount: document.getElementById('statBuildingsCount'),
        statResourcesCount: document.getElementById('statResourcesCount'),
        // Save Game Elements
        saveFileInput: document.getElementById('saveFileInput'),
        uploadSaveBtn: document.getElementById('uploadSaveBtn'),
        saveLoadedBadge: document.getElementById('saveLoadedBadge'),
        saveSessionName: document.getElementById('saveSessionName'),
        saveMetaDetails: document.getElementById('saveMetaDetails'),
        unloadSaveBtn: document.getElementById('unloadSaveBtn'),
        dragDropOverlay: document.getElementById('dragDropOverlay'),
        saveHelpBtn: document.getElementById('saveHelpBtn'),
        saveHelpModal: document.getElementById('saveHelpModal'),
        closeSaveHelpBtn: document.getElementById('closeSaveHelpBtn'),
        dismissSaveHelpBtn: document.getElementById('dismissSaveHelpBtn'),
        copySavePathBtn: document.getElementById('copySavePathBtn'),
        savePathInput: document.getElementById('savePathInput')
    };

    /**
     * Fetch JSON datasets concurrently
     */
    async function loadData() {
        try {
            const [itemsRes, recipesRes, buildingsRes, resourcesRes] = await Promise.all([
                fetch('data/items.json'),
                fetch('data/recipes.json'),
                fetch('data/buildings.json'),
                fetch('data/resources.json')
            ]);

            if (!itemsRes.ok || !recipesRes.ok || !buildingsRes.ok || !resourcesRes.ok) {
                throw new Error('Failed to load one or more dataset JSON files.');
            }

            const items = await itemsRes.json();
            const recipes = await recipesRes.json();
            const buildings = await buildingsRes.json();
            const resources = await resourcesRes.json();

            state.dataset = { items, recipes, buildings, resources };
            state.index = ProductionTree.createIndex(state.dataset);

            // Update stats
            elements.statItemsCount.textContent = items.length;
            elements.statRecipesCount.textContent = recipes.length;
            elements.statBuildingsCount.textContent = buildings.length;
            elements.statResourcesCount.textContent = resources.length;

            elements.loadingIndicator.style.display = 'none';

            // Initial view: Select "Computer" by default to immediately demonstrate functionality
            selectItem('Computer');

        } catch (error) {
            console.error('Error loading data:', error);
            elements.loadingIndicator.innerHTML = `
                <div style="color: #f87171; max-width: 600px; margin: 0 auto;">
                    <h3>⚠️ Error Loading Game Data</h3>
                    <p>${error.message}</p>
                    <p style="font-size: 0.85rem; margin-top: 0.5rem; color: #94a3b8;">
                        Please ensure you are viewing this page through a local web server (e.g. VS Code Live Server or python -m http.server) rather than file:// directly.
                    </p>
                </div>
            `;
        }
    }

    /**
     * Selects an item and renders its production chain
     */
    function selectItem(itemIdentifier) {
        if (!state.dataset || !state.index) return;

        const item = ProductionTree.findItem(itemIdentifier, state.index);
        if (!item) {
            alert(`Item "${itemIdentifier}" not found.`);
            return;
        }

        state.activeItem = item;
        elements.itemSearchInput.value = item.name;
        elements.clearSearchBtn.style.display = 'flex';
        elements.searchResultsDropdown.style.display = 'none';
        elements.dropdownToggleBtn?.classList.remove('open');

        // Highlight active quick chip
        document.querySelectorAll('.chip').forEach(chip => {
            const chipItem = chip.getAttribute('data-item');
            chip.classList.toggle('active', chipItem === item.name || chipItem === item.id);
        });

        recalculateAndRender();
    }

    /**
     * Recalculates the active production tree taking custom recipe overrides into account,
     * then refreshes the entire UI workspace (Tree, Graph, Resources, Buildings, and Alternates).
     */
    function recalculateAndRender() {
        if (!state.activeItem || !state.index) return;
        try {
            state.activeTree = ProductionTree.resolveProductionChain(state.activeItem.id, state.index, { 
                recipeOverrides: state.selectedRecipes,
                unlockedRecipes: state.saveData ? state.saveData.unlockedRecipeIds : null
            });
            renderResults(state.activeItem, state.activeTree);
        } catch (err) {
            console.error('Error calculating chain:', err);
            alert(`Error calculating chain for ${state.activeItem.name}: ${err.message}`);
        }
    }

    /**
     * Extracts unique intermediate components from the production tree
     */
    function extractIntermediateComponents(treeRoot) {
        const compMap = new Map();
        function traverse(node) {
            if (!node) return;
            if (!node.isRawResource && node.id !== treeRoot.id) {
                if (!compMap.has(node.name)) {
                    compMap.set(node.name, {
                        id: node.id,
                        name: node.name,
                        icon: node.icon
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
        return Array.from(compMap.values()).sort((a, b) => a.name.localeCompare(b.name));
    }

    /**
     * Interprets the production graph/tree into a clear natural-language summary
     */
    function renderAutomationNarrative(item, tree) {
        if (!elements.automationNarrativeBody) return;

        // If the target item itself is a raw resource
        if (tree.isRawResource) {
            elements.automationNarrativeBody.innerHTML = `
                The item <strong>${escapeHtml(item.name)}</strong> is a naturally occurring <span class="narrative-chip raw">RAW RESOURCE</span>, harvested directly from world nodes using Miners or Resource Extractors without intermediate components.
            `;
            return;
        }

        // 1. Detect active alternate recipes in this chain
        const activeAlts = new Map(); // recipeId -> recipeName
        function findAlts(node) {
            if (!node) return;
            if (node.recipe && node.recipe.isAlternate) {
                activeAlts.set(node.recipe.id, node.recipe.name);
            }
            if (node.children) {
                for (const c of node.children) findAlts(c);
            }
        }
        findAlts(tree);

        const altCount = activeAlts.size;
        const cleanAltNames = Array.from(activeAlts.values()).map(n => n.replace(/^Alternate:\s*/i, ''));
        let recipeQualifierHtml = '';
        if (altCount === 0) {
            recipeQualifierHtml = `<span class="narrative-recipe-tag standard">📋 utilizing standard recipes</span>`;
        } else {
            recipeQualifierHtml = `<span class="narrative-recipe-tag alternate">⚡ utilizing ${altCount} alternate recipe${altCount > 1 ? 's' : ''}: ${escapeHtml(cleanAltNames.join(', '))}</span>`;
        }

        // 2. Extract Raw Resources
        const rawResources = ProductionTree.extractRawResourcesSummary(tree);
        const rawChips = rawResources.map(r => {
            const rItem = state.index ? ProductionTree.findItem(r, state.index) : null;
            const rIcon = rItem?.icon || (rItem ? `images/items/${rItem.id}.png` : '');
            return `<span class="narrative-chip raw">${rIcon ? `<img src="${rIcon}" alt="" onerror="this.style.display='none'">` : ''}${escapeHtml(r)}</span>`;
        }).join('');

        // 3. Extract Intermediate Components
        const intermediateComponents = extractIntermediateComponents(tree);
        const compChips = intermediateComponents.map(c => {
            return `<span class="narrative-chip comp">${c.icon ? `<img src="${c.icon}" alt="" onerror="this.style.display='none'">` : ''}${escapeHtml(c.name)}</span>`;
        }).join('');

        // 4. Calculate exact machine demands per building type via FactoryGraph DAG
        const buildingTotals = new Map(); // buildingName -> totalCount
        const buildingIcons = new Map();  // buildingName -> iconPath

        if (typeof FactoryGraph !== 'undefined' && state.index) {
            try {
                const dag = FactoryGraph.calculateFactoryDAG(item.id, state.targetRate || 1.0, state.index, {
                    recipeOverrides: state.selectedRecipes,
                    unlockedRecipes: state.saveData ? state.saveData.unlockedRecipeIds : null
                });

                for (const node of dag.nodes) {
                    if (node.type === 'machine' && node.buildingName) {
                        const prev = buildingTotals.get(node.buildingName) || 0;
                        buildingTotals.set(node.buildingName, prev + (node.machineCount || 0));
                    }
                }
            } catch (err) {
                console.warn('Could not compute DAG machine counts for narrative:', err);
            }
        }

        // Fallback to tree summary if DAG calculation was unavailable
        if (buildingTotals.size === 0) {
            const fallbackBuildings = ProductionTree.extractBuildingsSummary(tree);
            for (const b of fallbackBuildings) {
                buildingTotals.set(b, null);
            }
        }

        // Retrieve building icons from dataset
        for (const bName of buildingTotals.keys()) {
            if (state.dataset?.buildings) {
                const matchB = state.dataset.buildings.find(b => b.name.toLowerCase() === bName.toLowerCase());
                if (matchB) {
                    buildingIcons.set(bName, matchB.icon || `images/buildings/${matchB.id}.png`);
                }
            }
        }

        const sortedBuildings = Array.from(buildingTotals.keys()).sort();
        const bldChips = sortedBuildings.map(bName => {
            const count = buildingTotals.get(bName);
            const iconPath = buildingIcons.get(bName);
            const countPrefix = count !== null && count !== undefined ? `${formatNumber(count)}× ` : '';
            return `<span class="narrative-chip machine">${iconPath ? `<img src="${iconPath}" alt="" onerror="this.style.display='none'">` : '🏭 '}${countPrefix}${escapeHtml(bName)}</span>`;
        }).join('');

        const rateUnit = item.isFluid ? 'm³/min' : (state.targetRate === 1 ? 'part/min' : 'parts/min');

        let narrativeHtml = `To start automating <strong>${escapeHtml(item.name)}</strong> ${recipeQualifierHtml}, you will need access to the following <strong>Raw Resources</strong>: ${rawChips || '<em>None</em>'}.`;

        if (intermediateComponents.length > 0) {
            narrativeHtml += `<br>Throughout the production chain, the following <strong>${intermediateComponents.length} Intermediate Component${intermediateComponents.length > 1 ? 's' : ''}</strong> will be created: ${compChips}. `;
        } else {
            narrativeHtml += `<br>This item is manufactured directly from raw materials with no intermediate components. `;
        }

        if (sortedBuildings.length > 0) {
            narrativeHtml += `<br>The entire industrial operation requires <strong>${sortedBuildings.length} Machine Type${sortedBuildings.length > 1 ? 's' : ''}</strong> (producing ${formatNumber(state.targetRate)} ${rateUnit}): ${bldChips}.`;
        }

        elements.automationNarrativeBody.innerHTML = narrativeHtml;
    }

    /**
     * Renders the complete workspace (Tree + Summaries)
     */
    function renderResults(item, tree) {
        elements.welcomeState.style.display = 'none';
        elements.resultsWorkspace.style.display = 'block';

        // Header info
        if (elements.activeItemIcon) {
            elements.activeItemIcon.src = item.icon || `images/items/${item.id}.png`;
            elements.activeItemIcon.alt = item.name;
            elements.activeItemIcon.style.display = 'block';
            elements.activeItemIcon.onerror = function () { this.style.display = 'none'; };
        }
        elements.activeItemTitle.textContent = item.name;
        elements.activeItemDescription.textContent = item.description || `Industrial component. Category: ${item.category || 'Component'}`;
        elements.totalNodesBadge.textContent = `${ProductionTree.countTotalNodes(tree)} Chain Steps`;

        // Render Automation Narrative interpretation
        renderAutomationNarrative(item, tree);

        // Render Tree based on flowDirection
        elements.treeContainer.innerHTML = '';
        elements.treeContainer.classList.toggle('flow-bottom-up', state.flowDirection === 'bottom-up');
        if (state.flowDirection === 'bottom-up') {
            const bottomUpTree = ProductionTree.buildBottomUpTree(tree);
            if (bottomUpTree && bottomUpTree.children) {
                for (const rawRoot of bottomUpTree.children) {
                    elements.treeContainer.appendChild(renderTreeNode(rawRoot, true));
                }
            }
        } else {
            const rootElement = renderTreeNode(tree, true);
            elements.treeContainer.appendChild(rootElement);
        }

        // Render Raw Resources Summary
        const rawResources = ProductionTree.extractRawResourcesSummary(tree);
        elements.rawResourcesList.innerHTML = '';
        if (rawResources.length === 0) {
            elements.rawResourcesList.innerHTML = '<li class="summary-list-item" style="color: #64748b;">No raw resources detected</li>';
        } else {
            for (const raw of rawResources) {
                const rawName = typeof raw === 'string' ? raw : raw.name;
                const rawItem = state.index ? ProductionTree.findItem(rawName, state.index) : null;
                const rawIcon = (typeof raw === 'object' && raw.icon) ? raw.icon : (rawItem?.icon || (rawItem ? `images/items/${rawItem.id}.png` : ''));
                const li = document.createElement('li');
                li.className = 'summary-list-item';
                li.innerHTML = `
                    <div class="summary-item-left">
                        ${rawIcon ? `<img class="summary-item-icon" src="${rawIcon}" alt="${rawName}" loading="lazy" onerror="this.style.display='none'">` : ''}
                        <span>${rawName}</span>
                    </div>
                    <span class="machine-badge raw">RAW ORE</span>
                `;
                elements.rawResourcesList.appendChild(li);
            }
        }

        // Render Buildings Summary
        const buildings = ProductionTree.extractBuildingsSummary(tree);
        elements.buildingsList.innerHTML = '';
        if (buildings.length === 0) {
            elements.buildingsList.innerHTML = '<li class="summary-list-item" style="color: #64748b;">No production buildings required</li>';
        } else {
            for (const bld of buildings) {
                const bldName = typeof bld === 'string' ? bld : bld.name;
                let bldIcon = (typeof bld === 'object' && bld.icon) ? bld.icon : null;
                if (!bldIcon && state.dataset?.buildings) {
                    const matchB = state.dataset.buildings.find(b => b.name.toLowerCase() === bldName.toLowerCase());
                    if (matchB) bldIcon = matchB.icon || `images/buildings/${matchB.id}.png`;
                }
                const li = document.createElement('li');
                li.className = 'summary-list-item';
                const machineClass = getMachineBadgeClass(bldName);
                li.innerHTML = `
                    <div class="summary-item-left">
                        ${bldIcon ? `<img class="summary-item-icon" src="${bldIcon}" alt="${bldName}" loading="lazy" onerror="this.style.display='none'">` : ''}
                        <span>${bldName}</span>
                    </div>
                    <span class="machine-badge ${machineClass}">MACHINE</span>
                `;
                elements.buildingsList.appendChild(li);
            }
        }

        // Render Alternates Card
        renderAlternatesSummary(tree);

        // If currently in graph mode, render/update the graph
        if (state.viewMode === 'graph') {
            renderGraphView();
        }
    }

    /**
     * Helper to format numbers cleanly
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
     * Renders the interactive Factory Graph DAG
     */
    function renderGraphView() {
        if (!state.activeItem || !state.index || typeof FactoryGraph === 'undefined') return;
        if (!elements.graphCanvasContainer) return;

        try {
            const dag = FactoryGraph.calculateFactoryDAG(state.activeItem.id, state.targetRate, state.index, { 
                recipeOverrides: state.selectedRecipes,
                unlockedRecipes: state.saveData ? state.saveData.unlockedRecipeIds : null
            });
            const layout = FactoryGraph.layoutGraph(dag);
            FactoryGraph.renderSVG(layout, elements.graphCanvasContainer);

            // Update stats & labels
            if (elements.graphTotalMachines) {
                elements.graphTotalMachines.textContent = formatNumber(dag.totalMachines);
            }
            if (elements.graphTotalSteps) {
                elements.graphTotalSteps.textContent = dag.nodes.length.toString();
            }
            if (elements.graphRateUnit) {
                elements.graphRateUnit.textContent = `${state.activeItem.isFluid ? 'm³' : 'parts'} / min`;
            }
        } catch (err) {
            console.error('Error rendering factory graph:', err);
            elements.graphCanvasContainer.innerHTML = `
                <div style="color: #f87171; text-align: center; padding: 3rem;">
                    <p>⚠️ Error generating factory diagram: ${err.message}</p>
                </div>
            `;
        }
    }

    /**
     * Toggles between Tree View and Graph View
     */
    function switchViewMode(mode) {
        state.viewMode = mode;
        if (mode === 'graph') {
            if (elements.tabGraphViewBtn) elements.tabGraphViewBtn.classList.add('active');
            if (elements.tabTreeViewBtn) elements.tabTreeViewBtn.classList.remove('active');
            if (elements.treeWorkspaceGrid) elements.treeWorkspaceGrid.style.display = 'none';
            if (elements.treeControlsGroup) elements.treeControlsGroup.style.display = 'none';
            if (elements.graphToolbarGroup) elements.graphToolbarGroup.style.display = 'flex';
            if (elements.factoryGraphSection) elements.factoryGraphSection.style.display = 'flex';
            renderGraphView();
        } else {
            if (elements.tabTreeViewBtn) elements.tabTreeViewBtn.classList.add('active');
            if (elements.tabGraphViewBtn) elements.tabGraphViewBtn.classList.remove('active');
            if (elements.treeWorkspaceGrid) elements.treeWorkspaceGrid.style.display = 'grid';
            if (elements.treeControlsGroup) elements.treeControlsGroup.style.display = 'flex';
            if (elements.graphToolbarGroup) elements.graphToolbarGroup.style.display = 'none';
            if (elements.factoryGraphSection) elements.factoryGraphSection.style.display = 'none';
            if (elements.graphAltsDrawer) elements.graphAltsDrawer.style.display = 'none';
        }
    }

    /**
     * Creates a CSS class name based on machine name
     */
    function getMachineBadgeClass(buildingName) {
        if (!buildingName) return 'raw';
        const lower = buildingName.toLowerCase();
        if (lower.includes('smelter')) return 'smelter';
        if (lower.includes('foundry')) return 'foundry';
        if (lower.includes('constructor')) return 'constructor';
        if (lower.includes('assembler')) return 'assembler';
        if (lower.includes('manufacturer')) return 'manufacturer';
        if (lower.includes('refinery')) return 'refinery';
        if (lower.includes('blender')) return 'blender';
        if (lower.includes('packager')) return 'packager';
        if (lower.includes('particle') || lower.includes('converter') || lower.includes('quantum')) return 'advanced';
        if (lower.includes('raw')) return 'raw';
        return 'manufacturer';
    }

    /**
     * Recursively renders a DOM tree node
     */
    function renderTreeNode(node, isRoot = false) {
        const wrapper = document.createElement('div');
        wrapper.className = 'tree-node-wrapper';

        const card = document.createElement('div');
        const isTarget = !!node.isTarget;
        card.className = `tree-node-card ${isRoot ? 'root-node' : ''} ${node.isRawResource ? 'raw-node' : ''} ${isTarget ? 'target-node' : ''}`;

        // Toggle button (if has children)
        const hasChildren = node.children && node.children.length > 0;
        if (hasChildren) {
            const toggleBtn = document.createElement('button');
            toggleBtn.className = 'tree-node-toggle';
            toggleBtn.textContent = '▼';
            toggleBtn.title = 'Toggle branch';
            toggleBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const childrenContainer = wrapper.querySelector('.tree-children');
                if (childrenContainer) {
                    const isCollapsed = childrenContainer.classList.toggle('collapsed');
                    toggleBtn.textContent = isCollapsed ? '▶' : '▼';
                }
            });
            card.appendChild(toggleBtn);
        } else {
            // Spacer for alignment
            const spacer = document.createElement('span');
            spacer.style.width = '20px';
            card.appendChild(spacer);
        }

        // Item Icon
        const itemIcon = document.createElement('img');
        itemIcon.className = 'tree-node-icon';
        itemIcon.src = node.icon || `images/items/${node.id}.png`;
        itemIcon.alt = node.name;
        itemIcon.loading = 'lazy';
        itemIcon.onerror = function () { this.style.display = 'none'; };
        card.appendChild(itemIcon);

        // Node Content
        const content = document.createElement('div');
        content.className = 'tree-node-content';

        const header = document.createElement('div');
        header.className = 'tree-node-header';

        const nameSpan = document.createElement('span');
        nameSpan.className = 'tree-node-name';
        nameSpan.textContent = node.name;
        header.appendChild(nameSpan);

        if (isTarget) {
            const targetBadge = document.createElement('span');
            targetBadge.className = 'target-badge';
            targetBadge.textContent = '🎯 TARGET ITEM';
            header.appendChild(targetBadge);
        }

        if (node.requiredAmount) {
            const amountSpan = document.createElement('span');
            amountSpan.className = 'tree-node-amount';
            amountSpan.textContent = `x${node.requiredAmount}`;
            header.appendChild(amountSpan);
        }

        content.appendChild(header);

        // Metadata: Machine badge + Alternate recipe badge
        const meta = document.createElement('div');
        meta.className = 'tree-node-meta';

        // Machine badge
        const machineBadge = document.createElement('span');
        const machineClass = getMachineBadgeClass(node.building);
        machineBadge.className = `machine-badge ${machineClass}`;

        const bldIconPath = node.buildingIcon || (node.buildingId ? `images/buildings/${node.buildingId}.png` : null);
        if (bldIconPath && node.building !== 'RAW RESOURCE') {
            const bldImg = document.createElement('img');
            bldImg.className = 'machine-badge-icon';
            bldImg.src = bldIconPath;
            bldImg.alt = '';
            bldImg.loading = 'lazy';
            bldImg.onerror = function () { this.style.display = 'none'; };
            machineBadge.appendChild(bldImg);
        }

        const bldText = document.createTextNode(node.building || 'RAW RESOURCE');
        machineBadge.appendChild(bldText);
        meta.appendChild(machineBadge);

        // Active Recipe badge
        if (node.recipe) {
            const recipeBadge = document.createElement('span');
            const isLocked = !!node.recipe.isLockedInSave;
            recipeBadge.className = `tree-recipe-badge ${node.recipe.isAlternate ? 'alt-recipe' : ''} ${isLocked ? 'locked-recipe' : ''}`;
            if (isLocked) {
                recipeBadge.innerHTML = `🔒 ${escapeHtml(node.recipe.name)} <span class="alt-locked-pill">LOCKED IN SAVE</span>`;
                recipeBadge.title = `Recipe: ${node.recipe.name} (Not unlocked in your savegame yet!)`;
            } else if (node.recipe.isAlternate) {
                recipeBadge.innerHTML = `⚡ ${escapeHtml(node.recipe.name)} <span class="alt-tag">ALT</span>`;
                recipeBadge.title = `Recipe: ${node.recipe.name} (${node.recipe.duration || 4}s)`;
            } else {
                recipeBadge.innerHTML = `📋 ${escapeHtml(node.recipe.name)}`;
                recipeBadge.title = `Recipe: ${node.recipe.name} (${node.recipe.duration || 4}s)`;
            }
            meta.appendChild(recipeBadge);
        }

        // Alternate recipes badge
        if (node.alternateRecipesCount > 0) {
            const altBadge = document.createElement('span');
            altBadge.className = 'alt-badge';
            altBadge.innerHTML = `🔄 ${node.alternateRecipesCount} alternate${node.alternateRecipesCount > 1 ? 's' : ''}`;
            altBadge.title = node.alternateRecipes.map(r => r.name).join('\n');
            meta.appendChild(altBadge);
        }

        content.appendChild(meta);
        card.appendChild(content);
        wrapper.appendChild(card);

        // Render Children recursively
        if (hasChildren) {
            const childrenContainer = document.createElement('div');
            childrenContainer.className = 'tree-children';
            for (const child of node.children) {
                childrenContainer.appendChild(renderTreeNode(child, false));
            }
            wrapper.appendChild(childrenContainer);
        }

        return wrapper;
    }

    /**
     * Helper to render the interactive list of recipes into a given DOM container
     */
    function renderAlternatesIntoContainer(container, chainItemsMap, activeOverridesCount) {
        if (!container) return;
        container.innerHTML = '';

        if (chainItemsMap.size === 0) {
            container.innerHTML = '<p class="alt-empty-notice">No alternate recipes exist for items in this chain.</p>';
            return;
        }

        // Top bar: summary badge and "Reset to Defaults" button
        const topBar = document.createElement('div');
        topBar.className = 'alt-recipes-top-bar';

        const countBadge = document.createElement('span');
        countBadge.className = `alt-status-badge ${activeOverridesCount > 0 ? 'has-custom' : ''}`;
        countBadge.textContent = activeOverridesCount > 0 
            ? `${activeOverridesCount} Active Alternate${activeOverridesCount > 1 ? 's' : ''}` 
            : `${chainItemsMap.size} Customizable Product${chainItemsMap.size > 1 ? 's' : ''}`;
        topBar.appendChild(countBadge);

        if (activeOverridesCount > 0) {
            const resetBtn = document.createElement('button');
            resetBtn.className = 'btn-reset-alts';
            resetBtn.innerHTML = '↺ Restore Defaults';
            resetBtn.title = 'Revert all items in this chain back to standard recipes';
            resetBtn.addEventListener('click', () => {
                state.selectedRecipes.clear();
                recalculateAndRender();
            });
            topBar.appendChild(resetBtn);
        }
        container.appendChild(topBar);

        // Optional Save Filter Row
        if (state.saveData) {
            const filterRow = document.createElement('div');
            filterRow.className = 'alt-save-filter-row';
            filterRow.innerHTML = `
                <label>
                    <input type="checkbox" ${state.hideLockedRecipes ? 'checked' : ''}>
                    <span>Hide recipes locked in save</span>
                </label>
                <span title="Save: ${escapeHtml(state.saveData.sessionName)}">🔒 Save Filter</span>
            `;
            filterRow.querySelector('input').addEventListener('change', (e) => {
                state.hideLockedRecipes = e.target.checked;
                recalculateAndRender();
            });
            container.appendChild(filterRow);
        }

        // List of items
        const listDiv = document.createElement('div');
        listDiv.className = 'alt-recipes-list';

        for (const [itemId, itemData] of chainItemsMap.entries()) {
            const activeRecipeId = state.selectedRecipes.get(itemId) || itemData.activeRecipe.id;
            const defaultRecipe = ProductionTree.getDefaultRecipe(itemId, state.index, state.saveData?.unlockedRecipeIds || null);
            const isCustom = state.selectedRecipes.has(itemId);

            const card = document.createElement('div');
            card.className = `alt-item-card ${isCustom ? 'is-custom' : ''}`;

            // Header: Item Icon + Name + Custom Tag
            const cardHeader = document.createElement('div');
            cardHeader.className = 'alt-card-header';

            const headerLeft = document.createElement('div');
            headerLeft.className = 'alt-card-left';
            if (itemData.icon) {
                const img = document.createElement('img');
                img.className = 'alt-card-icon';
                img.src = itemData.icon;
                img.alt = itemData.name;
                img.loading = 'lazy';
                img.onerror = function() { this.style.display = 'none'; };
                headerLeft.appendChild(img);
            }
            const nameEl = document.createElement('span');
            nameEl.className = 'alt-card-title';
            nameEl.textContent = itemData.name;
            headerLeft.appendChild(nameEl);
            cardHeader.appendChild(headerLeft);

            if (isCustom) {
                const isCurrentLocked = state.saveData && !state.saveData.unlockedRecipeIds.has(activeRecipeId);
                const customPill = document.createElement('span');
                if (isCurrentLocked) {
                    customPill.className = 'alt-locked-pill';
                    customPill.textContent = '🔒 LOCKED IN SAVE';
                } else {
                    customPill.className = 'alt-active-pill';
                    customPill.textContent = 'ALT ACTIVE';
                }
                cardHeader.appendChild(customPill);
            }
            card.appendChild(cardHeader);

            // Select Dropdown
            const selectWrapper = document.createElement('div');
            selectWrapper.className = 'alt-select-wrapper';

            const select = document.createElement('select');
            select.className = 'alt-recipe-select';

            for (const recipe of itemData.allRecipes) {
                const isUnlocked = state.saveData ? state.saveData.unlockedRecipeIds.has(recipe.id) : true;
                if (state.hideLockedRecipes && !isUnlocked && recipe.id !== activeRecipeId) {
                    continue;
                }

                const opt = document.createElement('option');
                opt.value = recipe.id;
                const bld = recipe.primaryBuildingName || 'Machine';
                let tag = '';
                if (!isUnlocked) {
                    tag = '🔒 [LOCKED] ';
                } else if (recipe.isAlternate) {
                    tag = '★ [ALT] ';
                } else {
                    tag = '[STD] ';
                }
                opt.textContent = `${tag}${recipe.name} (${bld})`;
                if (recipe.id === activeRecipeId) {
                    opt.selected = true;
                }
                select.appendChild(opt);
            }

            select.addEventListener('change', (e) => {
                const chosenId = e.target.value;
                if (defaultRecipe && chosenId === defaultRecipe.id) {
                    state.selectedRecipes.delete(itemId);
                } else {
                    state.selectedRecipes.set(itemId, chosenId);
                }
                recalculateAndRender();
            });

            selectWrapper.appendChild(select);
            card.appendChild(selectWrapper);

            // Active recipe ingredients preview
            const currentRecipeObj = state.index.recipeById?.get(activeRecipeId) || itemData.activeRecipe;
            if (currentRecipeObj && currentRecipeObj.ingredients) {
                const preview = document.createElement('div');
                preview.className = 'alt-recipe-preview';
                const ingSummary = currentRecipeObj.ingredients.map(ing => {
                    const ingItem = state.index.itemById?.get(ing.itemId);
                    const name = ingItem ? ingItem.name : ing.itemId;
                    return `${ing.amount}× ${name}`;
                }).join(' + ');

                const prodSummary = currentRecipeObj.products ? currentRecipeObj.products.map(p => {
                    const pItem = state.index.itemById?.get(p.itemId);
                    return `${p.amount}× ${pItem ? pItem.name : itemData.name}`;
                }).join(', ') : itemData.name;

                preview.textContent = `${ingSummary} ➔ ${prodSummary} (${currentRecipeObj.duration || 4}s)`;
                card.appendChild(preview);
            }

            listDiv.appendChild(card);
        }

        container.appendChild(listDiv);
    }

    /**
     * Collects and displays customizable recipes found across the chain
     */
    function renderAlternatesSummary(tree) {
        // Collect all items in chain that have multiple recipes (alternates available)
        const chainItemsMap = new Map();

        function walk(node) {
            if (!node) return;
            if (node.recipe && node.allRecipes && node.allRecipes.length > 1 && !chainItemsMap.has(node.id)) {
                chainItemsMap.set(node.id, {
                    id: node.id,
                    name: node.name,
                    icon: node.icon || `images/items/${node.id}.png`,
                    activeRecipe: node.recipe,
                    allRecipes: node.allRecipes
                });
            }
            if (node.children) {
                for (const c of node.children) walk(c);
            }
        }

        walk(tree);

        // Count how many overrides are currently active in this chain
        let activeOverridesCount = 0;
        for (const itemId of chainItemsMap.keys()) {
            if (state.selectedRecipes.has(itemId)) {
                activeOverridesCount++;
            }
        }

        // Render into Sidebar Card (Tree View)
        renderAlternatesIntoContainer(elements.alternatesCardContent, chainItemsMap, activeOverridesCount);

        // Render into Slide-in Drawer (Graph View)
        renderAlternatesIntoContainer(elements.graphAltsDrawerContent, chainItemsMap, activeOverridesCount);

        // Update toolbar badge
        if (elements.graphAltsCountBadge) {
            if (activeOverridesCount > 0) {
                elements.graphAltsCountBadge.textContent = `${activeOverridesCount} active`;
                elements.graphAltsCountBadge.classList.add('has-active');
            } else {
                elements.graphAltsCountBadge.textContent = `${chainItemsMap.size} alts`;
                elements.graphAltsCountBadge.classList.remove('has-active');
            }
        }
    }

    /**
     * Helpers for Search & Highlighting
     */
    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function escapeRegExp(string) {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    function highlightMatch(text, query) {
        if (!query) return escapeHtml(text);
        const safeText = escapeHtml(text);
        const safeQuery = escapeHtml(query);
        const regex = new RegExp(`(${escapeRegExp(safeQuery)})`, 'gi');
        return safeText.replace(regex, '<span class="search-match">$1</span>');
    }

    function getCategorySlug(category) {
        if (!category) return 'component';
        return category.toLowerCase().replace(/\s+/g, '-');
    }

    /**
     * Search Autocomplete & Filter Combobox
     */
    function setupSearch() {
        const input = elements.itemSearchInput;
        const dropdown = elements.searchResultsDropdown;
        const clearBtn = elements.clearSearchBtn;
        const toggleBtn = elements.dropdownToggleBtn;
        const wrapper = document.querySelector('.search-input-wrapper');

        let isDropdownOpen = false;

        function closeDropdown() {
            dropdown.style.display = 'none';
            toggleBtn?.classList.remove('open');
            isDropdownOpen = false;
        }

        function openDropdown(forceAll = false) {
            renderDropdown(forceAll);
            dropdown.style.display = 'flex';
            toggleBtn?.classList.add('open');
            isDropdownOpen = true;
        }

        function toggleDropdown() {
            if (isDropdownOpen) {
                closeDropdown();
            } else {
                input.focus();
                input.select();
                openDropdown(true);
            }
        }

        function renderDropdown(forceAll = false) {
            if (!state.dataset || !state.dataset.items) return;

            const rawVal = input.value.trim();
            // If forceAll is true (e.g. clicking toggle button, focusing input, or query matches active item), show full list
            const isBrowsingAll = forceAll || (state.activeItem && rawVal.toLowerCase() === state.activeItem.name.toLowerCase());
            const query = isBrowsingAll ? '' : rawVal.toLowerCase();

            // Toggle clear button
            clearBtn.style.display = rawVal ? 'flex' : 'none';

            let matches = [];
            if (!query) {
                // Show all items sorted alphabetically A-Z
                matches = state.dataset.items.slice().sort((a, b) => a.name.localeCompare(b.name));
            } else {
                // Filter items matching query
                matches = state.dataset.items.filter(it => it.name.toLowerCase().includes(query));
                // Sort by match quality (items starting with query first, then alphabetical)
                matches.sort((a, b) => {
                    const aName = a.name.toLowerCase();
                    const bName = b.name.toLowerCase();
                    const aStarts = aName.startsWith(query);
                    const bStarts = bName.startsWith(query);
                    if (aStarts && !bStarts) return -1;
                    if (!aStarts && bStarts) return 1;
                    return aName.localeCompare(bName);
                });
            }

            if (matches.length === 0) {
                dropdown.innerHTML = `
                    <div class="dropdown-empty">
                        <div class="dropdown-empty-icon">🔍</div>
                        <div class="dropdown-empty-text">No items found matching "<strong>${escapeHtml(rawVal)}</strong>"</div>
                        <div class="dropdown-empty-hint">Try searching by item name or raw resource</div>
                    </div>
                `;
                return;
            }

            // Dropdown Header with live count & shortcut hints
            const headerHtml = `
                <div class="dropdown-header">
                    <span class="dropdown-header-count">${query ? `${matches.length} matching item${matches.length > 1 ? 's' : ''}` : `All items (${matches.length})`}</span>
                    <span class="dropdown-header-hint">↑↓ to navigate &bull; ↵ to select</span>
                </div>
            `;

            // Dropdown Items List
            let listHtml = '<div class="dropdown-list">';
            matches.forEach((item, index) => {
                const isSelected = state.activeItem && (state.activeItem.id === item.id || state.activeItem.name === item.name);
                const isActive = isSelected || (index === 0 && !state.activeItem);
                const itemIcon = item.icon || `images/items/${item.id}.png`;
                const catSlug = getCategorySlug(item.category);
                const categoryLabel = item.category || (item.isRawResource ? 'Raw Resource' : 'Item');

                let subLabel = 'Manufactured Product';
                if (item.isRawResource) {
                    subLabel = 'Raw Natural Resource';
                } else if (item.form === 'RF_LIQUID') {
                    subLabel = 'Liquid Resource';
                } else if (item.form === 'RF_GAS') {
                    subLabel = 'Gas Resource';
                }

                listHtml += `
                    <div class="dropdown-item ${isSelected ? 'selected' : ''} ${isActive ? 'active' : ''}" data-item-id="${item.id}" data-item-name="${escapeHtml(item.name)}">
                        <div class="dropdown-item-left">
                            <img class="dropdown-item-icon" src="${itemIcon}" alt="" loading="lazy" onerror="this.style.opacity='0.2'">
                            <div class="dropdown-item-info">
                                <span class="dropdown-item-name">${highlightMatch(item.name, query)}</span>
                                <span class="dropdown-item-sub">${subLabel}</span>
                            </div>
                        </div>
                        <div class="dropdown-item-right">
                            <span class="dropdown-item-badge badge-${catSlug}">${categoryLabel}</span>
                            ${isSelected ? '<span class="dropdown-item-check" title="Currently Selected">✓</span>' : ''}
                        </div>
                    </div>
                `;
            });
            listHtml += '</div>';

            dropdown.innerHTML = headerHtml + listHtml;

            // Click listeners for dropdown items
            const itemEls = dropdown.querySelectorAll('.dropdown-item');
            itemEls.forEach(el => {
                el.addEventListener('click', () => {
                    const itemId = el.getAttribute('data-item-id');
                    selectItem(itemId);
                });
            });

            // Scroll selected or active item into view
            const targetEl = dropdown.querySelector('.dropdown-item.selected') || dropdown.querySelector('.dropdown-item.active');
            if (targetEl) {
                setTimeout(() => {
                    targetEl.scrollIntoView({ block: 'nearest' });
                }, 0);
            }
        }

        // Input typing listener: real-time filter
        input.addEventListener('input', () => {
            openDropdown(false);
        });

        // Focus listener: open dropdown and select text
        input.addEventListener('focus', () => {
            input.select();
            openDropdown(true);
        });

        // Click listener: open dropdown if closed
        input.addEventListener('click', () => {
            if (!isDropdownOpen) {
                input.select();
                openDropdown(true);
            }
        });

        // Dropdown toggle button click
        if (toggleBtn) {
            toggleBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                toggleDropdown();
            });
        }

        // Clear button click
        clearBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            input.value = '';
            input.focus();
            openDropdown(true);
        });

        // Keyboard navigation (Arrow keys, Enter, Escape, Tab)
        input.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                if (!isDropdownOpen) {
                    openDropdown(true);
                    return;
                }
                const items = dropdown.querySelectorAll('.dropdown-item');
                if (items.length === 0) return;

                let activeIdx = Array.from(items).findIndex(el => el.classList.contains('active'));
                if (activeIdx >= 0) items[activeIdx].classList.remove('active');
                activeIdx = (activeIdx + 1) % items.length;
                items[activeIdx].classList.add('active');
                items[activeIdx].scrollIntoView({ block: 'nearest' });
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                if (!isDropdownOpen) {
                    openDropdown(true);
                    return;
                }
                const items = dropdown.querySelectorAll('.dropdown-item');
                if (items.length === 0) return;

                let activeIdx = Array.from(items).findIndex(el => el.classList.contains('active'));
                if (activeIdx >= 0) items[activeIdx].classList.remove('active');
                activeIdx = (activeIdx - 1 + items.length) % items.length;
                items[activeIdx].classList.add('active');
                items[activeIdx].scrollIntoView({ block: 'nearest' });
            } else if (e.key === 'Enter') {
                if (isDropdownOpen) {
                    e.preventDefault();
                    const activeEl = dropdown.querySelector('.dropdown-item.active') || dropdown.querySelector('.dropdown-item');
                    if (activeEl) {
                        const itemId = activeEl.getAttribute('data-item-id');
                        selectItem(itemId);
                    }
                }
            } else if (e.key === 'Escape') {
                if (isDropdownOpen) {
                    e.preventDefault();
                    closeDropdown();
                    input.value = state.activeItem ? state.activeItem.name : '';
                }
            } else if (e.key === 'Tab') {
                closeDropdown();
            }
        });

        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (wrapper && !wrapper.contains(e.target) && !dropdown.contains(e.target)) {
                closeDropdown();
            }
        });

        // Quick select chips
        document.querySelectorAll('.chip').forEach(chip => {
            chip.addEventListener('click', () => {
                const itemName = chip.getAttribute('data-item');
                selectItem(itemName);
            });
        });

        // Expand / Collapse all controls
        if (elements.expandAllBtn) {
            elements.expandAllBtn.addEventListener('click', () => {
                document.querySelectorAll('.tree-children').forEach(el => el.classList.remove('collapsed'));
                document.querySelectorAll('.tree-node-toggle').forEach(el => el.textContent = '▼');
            });
        }

        if (elements.collapseAllBtn) {
            elements.collapseAllBtn.addEventListener('click', () => {
                document.querySelectorAll('.tree-children').forEach(el => el.classList.add('collapsed'));
                document.querySelectorAll('.tree-node-toggle').forEach(el => el.textContent = '▶');
            });
        }

        // Flow Direction toggle controls
        if (elements.flowTopDownBtn && elements.flowBottomUpBtn) {
            elements.flowTopDownBtn.addEventListener('click', () => {
                if (state.flowDirection === 'top-down') return;
                state.flowDirection = 'top-down';
                elements.flowTopDownBtn.classList.add('active');
                elements.flowBottomUpBtn.classList.remove('active');
                if (state.activeItem && state.activeTree) {
                    renderResults(state.activeItem, state.activeTree);
                }
            });

            elements.flowBottomUpBtn.addEventListener('click', () => {
                if (state.flowDirection === 'bottom-up') return;
                state.flowDirection = 'bottom-up';
                elements.flowBottomUpBtn.classList.add('active');
                elements.flowTopDownBtn.classList.remove('active');
                if (state.activeItem && state.activeTree) {
                    renderResults(state.activeItem, state.activeTree);
                }
            });
        }

        // View Mode Switcher tabs
        if (elements.tabTreeViewBtn && elements.tabGraphViewBtn) {
            elements.tabTreeViewBtn.addEventListener('click', () => switchViewMode('tree'));
            elements.tabGraphViewBtn.addEventListener('click', () => switchViewMode('graph'));
        }

        // Graph Target Rate Input
        if (elements.graphTargetRateInput) {
            elements.graphTargetRateInput.addEventListener('input', (e) => {
                const val = parseFloat(e.target.value);
                if (!isNaN(val) && val > 0) {
                    state.targetRate = val;
                    renderGraphView();
                    if (state.activeItem && state.activeTree) {
                        renderAutomationNarrative(state.activeItem, state.activeTree);
                    }
                }
            });
        }

        // Graph Pan/Zoom controls
        if (elements.graphZoomInBtn) {
            elements.graphZoomInBtn.addEventListener('click', () => {
                const svg = elements.graphCanvasContainer?.querySelector('svg');
                svg?._panZoom?.zoomIn();
            });
        }
        if (elements.graphZoomOutBtn) {
            elements.graphZoomOutBtn.addEventListener('click', () => {
                const svg = elements.graphCanvasContainer?.querySelector('svg');
                svg?._panZoom?.zoomOut();
            });
        }
        if (elements.graphFitBtn) {
            elements.graphFitBtn.addEventListener('click', () => {
                const svg = elements.graphCanvasContainer?.querySelector('svg');
                svg?._panZoom?.fit();
            });
        }
        if (elements.graphResetBtn) {
            elements.graphResetBtn.addEventListener('click', () => {
                const svg = elements.graphCanvasContainer?.querySelector('svg');
                svg?._panZoom?.reset();
            });
        }

        // Graph Alternate Recipes Drawer toggle
        if (elements.graphAltsToggleBtn && elements.graphAltsDrawer) {
            elements.graphAltsToggleBtn.addEventListener('click', () => {
                const isHidden = elements.graphAltsDrawer.style.display === 'none';
                elements.graphAltsDrawer.style.display = isHidden ? 'flex' : 'none';
            });
        }
        if (elements.closeAltsDrawerBtn && elements.graphAltsDrawer) {
            elements.closeAltsDrawerBtn.addEventListener('click', () => {
                elements.graphAltsDrawer.style.display = 'none';
            });
        }

        setupSaveControls();
    }

    /**
     * Process an uploaded .sav file
     */
    async function handleSaveFile(file) {
        if (!file) return;
        if (!file.name.toLowerCase().endsWith('.sav')) {
            alert('Please select a valid Satisfactory savegame file (.sav)');
            return;
        }

        const originalBtnText = elements.uploadSaveBtn?.innerHTML || 'Load Save (.sav)';
        if (elements.uploadSaveBtn) {
            elements.uploadSaveBtn.innerHTML = '<span class="btn-icon">⏳</span><span>Reading save...</span>';
            elements.uploadSaveBtn.disabled = true;
        }

        try {
            const arrayBuffer = await file.arrayBuffer();
            const result = await SaveParser.parseSaveFile(arrayBuffer, (p) => {
                if (elements.uploadSaveBtn && p.percent) {
                    elements.uploadSaveBtn.innerHTML = `<span class="btn-icon">⏳</span><span>${p.percent}%</span>`;
                }
            });

            state.saveData = result;

            // Persist in localStorage
            try {
                localStorage.setItem('sf_save_session', result.sessionName);
                localStorage.setItem('sf_save_duration', result.playDurationFormatted);
                localStorage.setItem('sf_save_alts_count', result.unlockedAlternateRecipesCount.toString());
                localStorage.setItem('sf_save_recipes', JSON.stringify(Array.from(result.unlockedRecipeIds)));
            } catch (e) {
                console.warn('Could not cache save in localStorage:', e);
            }

            updateSaveHeaderUI();
            recalculateAndRender();
        } catch (err) {
            console.error('Error parsing save file:', err);
            if (elements.uploadSaveBtn) {
                elements.uploadSaveBtn.innerHTML = `<span class="btn-icon">⚠️</span><span>Error reading save</span>`;
                setTimeout(() => {
                    elements.uploadSaveBtn.innerHTML = originalBtnText;
                }, 3000);
            }
        } finally {
            if (elements.uploadSaveBtn) {
                elements.uploadSaveBtn.innerHTML = originalBtnText;
                elements.uploadSaveBtn.disabled = false;
            }
        }
    }

    function unloadSave() {
        state.saveData = null;
        try {
            localStorage.removeItem('sf_save_session');
            localStorage.removeItem('sf_save_duration');
            localStorage.removeItem('sf_save_alts_count');
            localStorage.removeItem('sf_save_recipes');
        } catch (e) {}

        updateSaveHeaderUI();
        recalculateAndRender();
    }

    function updateSaveHeaderUI() {
        if (state.saveData) {
            if (elements.uploadSaveBtn) elements.uploadSaveBtn.style.display = 'none';
            if (elements.saveLoadedBadge) elements.saveLoadedBadge.style.display = 'inline-flex';
            if (elements.saveSessionName) elements.saveSessionName.textContent = state.saveData.sessionName;
            if (elements.saveMetaDetails) {
                elements.saveMetaDetails.innerHTML = `${state.saveData.playDurationFormatted} &bull; ${state.saveData.unlockedAlternateRecipesCount} Alts Unlocked`;
            }
        } else {
            if (elements.uploadSaveBtn) elements.uploadSaveBtn.style.display = 'inline-flex';
            if (elements.saveLoadedBadge) elements.saveLoadedBadge.style.display = 'none';
        }
    }

    function tryRestoreCachedSave() {
        try {
            const session = localStorage.getItem('sf_save_session');
            const duration = localStorage.getItem('sf_save_duration');
            const altsCount = localStorage.getItem('sf_save_alts_count');
            const recipesJson = localStorage.getItem('sf_save_recipes');

            if (session && recipesJson) {
                const recipeArr = JSON.parse(recipesJson);
                state.saveData = {
                    sessionName: session,
                    playDurationFormatted: duration || '',
                    unlockedAlternateRecipesCount: parseInt(altsCount, 10) || 0,
                    unlockedRecipeIds: new Set(recipeArr)
                };
                updateSaveHeaderUI();
            }
        } catch (e) {
            console.warn('Failed restoring cached save from localStorage:', e);
        }
    }

    function setupDragAndDrop() {
        let dragCounter = 0;
        const overlay = elements.dragDropOverlay;

        window.addEventListener('dragenter', (e) => {
            e.preventDefault();
            dragCounter++;
            if (overlay) overlay.style.display = 'flex';
        });

        window.addEventListener('dragleave', (e) => {
            e.preventDefault();
            dragCounter--;
            if (dragCounter <= 0) {
                dragCounter = 0;
                if (overlay) overlay.style.display = 'none';
            }
        });

        window.addEventListener('dragover', (e) => {
            e.preventDefault();
        });

        window.addEventListener('drop', (e) => {
            e.preventDefault();
            dragCounter = 0;
            if (overlay) overlay.style.display = 'none';

            if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                handleSaveFile(e.dataTransfer.files[0]);
            }
        });
    }

    function setupSaveHelpModal() {
        const modal = elements.saveHelpModal;
        const openBtn = elements.saveHelpBtn;
        const closeBtn = elements.closeSaveHelpBtn;
        const dismissBtn = elements.dismissSaveHelpBtn;
        const copyBtn = elements.copySavePathBtn;
        const pathInput = elements.savePathInput;

        if (!modal) return;

        function openModal() {
            modal.style.display = 'flex';
        }

        function closeModal() {
            modal.style.display = 'none';
        }

        if (openBtn) {
            openBtn.addEventListener('click', openModal);
        }
        if (closeBtn) {
            closeBtn.addEventListener('click', closeModal);
        }
        if (dismissBtn) {
            dismissBtn.addEventListener('click', closeModal);
        }

        // Close when clicking backdrop
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                closeModal();
            }
        });

        // Close on Escape key
        window.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && modal.style.display === 'flex') {
                closeModal();
            }
        });

        // Copy path helper
        if (copyBtn && pathInput) {
            copyBtn.addEventListener('click', async () => {
                const textToCopy = pathInput.value;
                try {
                    if (navigator.clipboard && navigator.clipboard.writeText) {
                        await navigator.clipboard.writeText(textToCopy);
                    } else {
                        pathInput.select();
                        document.execCommand('copy');
                    }
                    copyBtn.textContent = '✅ Copied!';
                    copyBtn.classList.add('copied');
                    setTimeout(() => {
                        copyBtn.textContent = '📋 Copy Path';
                        copyBtn.classList.remove('copied');
                    }, 2000);
                } catch (err) {
                    pathInput.select();
                    document.execCommand('copy');
                    copyBtn.textContent = '✅ Copied!';
                    setTimeout(() => {
                        copyBtn.textContent = '📋 Copy Path';
                    }, 2000);
                }
            });
        }
    }

    function setupSaveControls() {
        if (elements.uploadSaveBtn && elements.saveFileInput) {
            elements.uploadSaveBtn.addEventListener('click', () => {
                elements.saveFileInput.click();
            });
            elements.saveFileInput.addEventListener('change', (e) => {
                if (e.target.files && e.target.files.length > 0) {
                    handleSaveFile(e.target.files[0]);
                    e.target.value = ''; // allow re-uploading same file
                }
            });
        }
        if (elements.unloadSaveBtn) {
            elements.unloadSaveBtn.addEventListener('click', () => {
                unloadSave();
            });
        }
        setupDragAndDrop();
        setupSaveHelpModal();
    }

    // Expose helpers globally for testing/interaction
    window.selectItem = selectItem;
    window.appState = state;
    window.switchViewMode = switchViewMode;
    window.handleSaveFile = handleSaveFile;
    window.unloadSave = unloadSave;
    window.setRecipe = function (itemId, recipeId) {
        if (!itemId || !recipeId) return;
        state.selectedRecipes.set(itemId, recipeId);
        recalculateAndRender();
    };
    window.resetRecipes = function () {
        state.selectedRecipes.clear();
        recalculateAndRender();
    };
    window.recalculateAndRender = recalculateAndRender;

    // Initialize application
    tryRestoreCachedSave();
    setupSearch();
    loadData();

})();

