/**
 * Satisfactory Interactive Collectibles Map
 * Renders the 2048x2048 Satisfactory 1.0+ world map with all fixed locations for:
 * - Somersloops (106)
 * - Mercer Spheres (298)
 * - Crash Sites / Hard Drives (118) with unlock requirements
 * - Power Slugs: Blue (596), Yellow (389), Purple (257)
 * Supports interactive pan/zoom, filtering, search, and marking locations as "Already Visited"
 * with automatic localStorage persistence and JSON export/import.
 */

const InteractiveMap = (function () {
    'use strict';

    const STORAGE_KEY = 'satisfactory_visited_collectibles_v1';
    const MAP_LOGICAL_SIZE = 8192;
    const TILE_ZOOM = 3;
    const TILE_GRID = 8; // 8x8 tiles of 256px = 2048x2048 px
    const TILE_SIZE = 256;
    const CANVAS_TEX_SIZE = TILE_GRID * TILE_SIZE; // 2048

    const CATEGORIES = {
        somersloop: {
            id: 'somersloop',
            name: 'Somersloop',
            plural: 'Somersloops',
            icon: 'images/items/Desc_WAT1_C.png',
            color: '#f43f5e',
            ringColor: '#fb7185',
            glowColor: 'rgba(244, 63, 94, 0.35)',
            badgeBg: 'rgba(244, 63, 94, 0.15)',
            description: 'Alien production amplifier & power matrix stabilizer'
        },
        mercer_sphere: {
            id: 'mercer_sphere',
            name: 'Mercer Sphere',
            plural: 'Mercer Spheres',
            icon: 'images/items/Desc_WAT2_C.png',
            color: '#a855f7',
            ringColor: '#c084fc',
            glowColor: 'rgba(168, 85, 247, 0.35)',
            badgeBg: 'rgba(168, 85, 247, 0.15)',
            description: 'Alien dimensional depot & Pocket Dimension research artifact'
        },
        hard_drive: {
            id: 'hard_drive',
            name: 'Hard Drive',
            plural: 'Hard Drives (Crash Sites)',
            icon: 'images/items/Desc_HardDrive_C.webp',
            color: '#fa9549',
            ringColor: '#fbab6d',
            glowColor: 'rgba(250, 149, 73, 0.35)',
            badgeBg: 'rgba(250, 149, 73, 0.15)',
            description: 'FICSIT Crash Site drop pod containing 1 Hard Drive for Alternate Recipes'
        },
        slug_blue: {
            id: 'slug_blue',
            name: 'Blue Power Slug',
            plural: 'Blue Power Slugs',
            icon: 'images/items/Desc_Crystal_C.png',
            color: '#38bdf8',
            ringColor: '#7dd3fc',
            glowColor: 'rgba(56, 189, 248, 0.35)',
            badgeBg: 'rgba(56, 189, 248, 0.15)',
            description: 'Synthesizes into 1 Power Shard'
        },
        slug_yellow: {
            id: 'slug_yellow',
            name: 'Yellow Power Slug',
            plural: 'Yellow Power Slugs',
            icon: 'images/items/Desc_Crystal_mk2_C.png',
            color: '#facc15',
            ringColor: '#fde047',
            glowColor: 'rgba(250, 204, 21, 0.35)',
            badgeBg: 'rgba(250, 204, 21, 0.15)',
            description: 'Synthesizes into 2 Power Shards'
        },
        slug_purple: {
            id: 'slug_purple',
            name: 'Purple Power Slug',
            plural: 'Purple Power Slugs',
            icon: 'images/items/Desc_Crystal_mk3_C.png',
            color: '#d946ef',
            ringColor: '#e879f9',
            glowColor: 'rgba(217, 70, 239, 0.35)',
            badgeBg: 'rgba(217, 70, 239, 0.15)',
            description: 'Synthesizes into 5 Power Shards'
        }
    };

    // Major Biome Labels positioned in logical 0..8192 coordinates
    const BIOME_LABELS = [
        { name: 'ROCKY DESERT', px: 1450, py: 2100 },
        { name: 'NORTHERN FOREST', px: 3850, py: 2150 },
        { name: 'SPIRE COAST', px: 4750, py: 1200 },
        { name: 'DUNE DESERT', px: 6700, py: 1950 },
        { name: 'DESERT CANYONS', px: 5300, py: 2350 },
        { name: 'CRATER LAKES', px: 2850, py: 2850 },
        { name: 'MAZE CANYON', px: 4550, py: 2950 },
        { name: 'LAKE FOREST', px: 3800, py: 3250 },
        { name: 'RED JUNGLE', px: 2100, py: 3950 },
        { name: 'RED BAMBOO FIELDS', px: 3500, py: 4150 },
        { name: 'TITAN FOREST', px: 5150, py: 3800 },
        { name: 'SWAMP', px: 6350, py: 4400 },
        { name: 'ISLANDS', px: 900, py: 4650 },
        { name: 'WESTERN DUNE FOREST', px: 2550, py: 5000 },
        { name: 'EASTERN DUNE FOREST', px: 4750, py: 5050 },
        { name: 'JUNGLE SPIRES', px: 1650, py: 5500 },
        { name: 'SNAKETREE FOREST', px: 2950, py: 5750 },
        { name: 'GRASS FIELDS', px: 2900, py: 6650 },
        { name: 'SOUTHERN FOREST', px: 4050, py: 6450 },
        { name: 'BLUE CRATER', px: 5150, py: 6500 },
        { name: 'ABYSS CLIFFS', px: 5950, py: 5900 },
        { name: 'PARADISE ISLAND', px: 1650, py: 7150 }
    ];

    // Internal State
    const mapState = {
        initialized: false,
        loading: false,
        data: null,               // { mapSize, bounds, counts, collectibles: [] }
        byId: new Map(),          // id -> collectible
        visited: new Set(),       // Set of visited collectible IDs
        activeCategories: new Set(['somersloop', 'mercer_sphere', 'hard_drive', 'slug_blue', 'slug_yellow', 'slug_purple']),
        visitedFilter: 'all',     // 'all' | 'unvisited' | 'visited'
        biomeFilter: 'all',       // 'all' | biomeName
        podReqFilter: 'all',      // 'all' | 'free' | 'power' | 'item'
        searchQuery: '',
        quickMarkMode: false,     // When true, single-clicking a pin immediately toggles visited state
        showBiomeLabels: true,
        showGrid: false,

        // Viewport transform (maps 0..8192 logical coords to screen canvas pixels)
        scale: 0.1,
        panX: 0,
        panY: 0,
        isDragging: false,
        dragMoved: false,
        dragStartX: 0,
        dragStartY: 0,

        // Interaction
        hoveredPin: null,
        selectedPin: null,
        pulsePinId: null,
        pulseStartTime: 0,
        animFrameId: null,

        // Offscreen map texture & icons
        offscreenMap: null,
        offscreenCtx: null,
        tilesLoaded: 0,
        totalTiles: TILE_GRID * TILE_GRID,
        iconImages: new Map()
    };

    // DOM References
    let dom = {};

    /**
     * Load visited set from localStorage
     */
    function loadVisitedFromStorage() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (raw) {
                const arr = JSON.parse(raw);
                if (Array.isArray(arr)) {
                    mapState.visited = new Set(arr);
                }
            }
        } catch (err) {
            console.warn('Could not load visited collectibles from localStorage:', err);
        }
    }

    /**
     * Save visited set to localStorage
     */
    function saveVisitedToStorage() {
        try {
            const arr = Array.from(mapState.visited);
            localStorage.setItem(STORAGE_KEY, JSON.stringify(arr));
        } catch (err) {
            console.warn('Could not save visited collectibles to localStorage:', err);
        }
    }

    /**
     * Preload category icons and stitched map tiles
     */
    function preloadAssets() {
        // Preload category icons
        Object.values(CATEGORIES).forEach(cat => {
            const img = new Image();
            img.onload = () => requestRedraw();
            img.src = cat.icon;
            mapState.iconImages.set(cat.id, img);
        });

        // Create offscreen 2048x2048 canvas for world map tiles
        const offCanvas = document.createElement('canvas');
        offCanvas.width = CANVAS_TEX_SIZE;
        offCanvas.height = CANVAS_TEX_SIZE;
        const offCtx = offCanvas.getContext('2d');

        // Fill initial dark background
        offCtx.fillStyle = '#0b1017';
        offCtx.fillRect(0, 0, CANVAS_TEX_SIZE, CANVAS_TEX_SIZE);

        mapState.offscreenMap = offCanvas;
        mapState.offscreenCtx = offCtx;

        for (let tx = 0; tx < TILE_GRID; tx++) {
            for (let ty = 0; ty < TILE_GRID; ty++) {
                const tileImg = new Image();
                tileImg.onload = () => {
                    offCtx.drawImage(tileImg, tx * TILE_SIZE, ty * TILE_SIZE, TILE_SIZE, TILE_SIZE);
                    mapState.tilesLoaded++;
                    requestRedraw();
                };
                tileImg.src = `images/map/${TILE_ZOOM}/${tx}/${ty}.webp`;
            }
        }
    }

    /**
     * Fetch data/collectibles.json and initialize
     */
    async function init() {
        if (mapState.initialized || mapState.loading) {
            if (mapState.initialized) {
                resizeCanvasAndFit(false);
                updateAllUI();
            }
            return;
        }

        mapState.loading = true;
        cacheDomElements();
        loadVisitedFromStorage();
        preloadAssets();

        try {
            const res = await fetch('data/collectibles.json');
            if (!res.ok) throw new Error('Failed to load data/collectibles.json');
            const data = await res.json();

            // Assign display number per category (e.g. Somersloop #1, #2...)
            const catCounters = {};
            data.collectibles.forEach(item => {
                catCounters[item.type] = (catCounters[item.type] || 0) + 1;
                item.indexInType = catCounters[item.type];
                const catInfo = CATEGORIES[item.type];
                item.displayName = `${catInfo ? catInfo.name : item.type} #${item.indexInType}`;
                mapState.byId.set(item.id, item);
            });

            mapState.data = data;
            mapState.initialized = true;
            mapState.loading = false;

            populateBiomeFilterDropdown();
            bindEvents();

            // Wait one frame for workspace layout dimensions before fitting
            requestAnimationFrame(() => {
                resizeCanvasAndFit(true);
                updateAllUI();
            });
        } catch (err) {
            console.error('Error initializing InteractiveMap:', err);
            mapState.loading = false;
            if (dom.canvasWrapper) {
                dom.canvasWrapper.innerHTML = `
                    <div style="padding: 3rem; text-align: center; color: #f87171;">
                        <h3>⚠️ Failed to load Interactive Map Data</h3>
                        <p>${err.message}</p>
                    </div>
                `;
            }
        }
    }

    /**
     * Cache DOM elements inside #interactiveMapWorkspace
     */
    function cacheDomElements() {
        dom = {
            workspace: document.getElementById('interactiveMapWorkspace'),
            categoryCardsContainer: document.getElementById('mapCategoryCards'),
            overallProgressText: document.getElementById('mapOverallProgressText'),
            overallProgressBar: document.getElementById('mapOverallProgressBar'),
            overallShardsText: document.getElementById('mapOverallShardsText'),
            showAllCatsBtn: document.getElementById('mapShowAllCatsBtn'),
            visitedFilterPills: document.getElementById('mapVisitedFilterPills'),
            biomeSelect: document.getElementById('mapBiomeFilterSelect'),
            podReqSelect: document.getElementById('mapPodReqFilterSelect'),
            searchInput: document.getElementById('mapSearchInput'),
            clearSearchBtn: document.getElementById('mapClearSearchBtn'),
            quickMarkBtn: document.getElementById('mapQuickMarkToggleBtn'),
            biomeLabelsBtn: document.getElementById('mapBiomeLabelsToggleBtn'),
            gridToggleBtn: document.getElementById('mapGridToggleBtn'),
            exportBtn: document.getElementById('mapExportVisitedBtn'),
            importBtn: document.getElementById('mapImportVisitedBtn'),
            importFileInput: document.getElementById('mapImportFileInput'),
            resetVisitedBtn: document.getElementById('mapResetVisitedBtn'),

            // Canvas & Overlays
            canvasWrapper: document.getElementById('mapCanvasWrapper'),
            canvas: document.getElementById('collectiblesMapCanvas'),
            cursorCoordsHud: document.getElementById('mapCursorCoordsHud'),
            visiblePinsCountHud: document.getElementById('mapVisiblePinsCountHud'),
            hoverTooltip: document.getElementById('mapHoverTooltip'),
            selectedPopup: document.getElementById('mapSelectedPopup'),
            zoomInBtn: document.getElementById('mapZoomInBtn'),
            zoomOutBtn: document.getElementById('mapZoomOutBtn'),
            fitViewBtn: document.getElementById('mapFitViewBtn'),

            // Sidebar Checklist & Inspector
            inspectorCard: document.getElementById('mapSelectedInspectorCard'),
            checklistCountBadge: document.getElementById('mapChecklistCountBadge'),
            checklistContainer: document.getElementById('mapChecklistContainer'),
            markAllVisibleBtn: document.getElementById('mapMarkAllVisibleBtn')
        };
    }

    /**
     * Populate the Biome select dropdown with sorted unique biomes
     */
    function populateBiomeFilterDropdown() {
        if (!dom.biomeSelect || !mapState.data) return;
        const biomes = new Set();
        mapState.data.collectibles.forEach(c => {
            if (c.biome) biomes.add(c.biome);
        });
        const sorted = Array.from(biomes).sort();
        dom.biomeSelect.innerHTML = `<option value="all">All Biomes (${sorted.length})</option>` +
            sorted.map(b => `<option value="${escapeHtml(b)}">${escapeHtml(b)}</option>`).join('');
    }

    /**
     * Check if a collectible passes all current active filters
     */
    function matchesFilters(item) {
        if (!mapState.activeCategories.has(item.type)) return false;

        const isVisited = mapState.visited.has(item.id);
        if (mapState.visitedFilter === 'unvisited' && isVisited) return false;
        if (mapState.visitedFilter === 'visited' && !isVisited) return false;

        if (mapState.biomeFilter !== 'all' && item.biome !== mapState.biomeFilter) return false;

        if (mapState.podReqFilter !== 'all') {
            if (item.type !== 'hard_drive') return false;
            if (item.reqType !== mapState.podReqFilter) return false;
        }

        if (mapState.searchQuery) {
            const q = mapState.searchQuery;
            const matchName = item.displayName.toLowerCase().includes(q);
            const matchId = item.id.toLowerCase().includes(q);
            const matchBiome = item.biome && item.biome.toLowerCase().includes(q);
            const matchReq = item.reqLabel && item.reqLabel.toLowerCase().includes(q);
            const matchCoords = `${item.x}, ${item.y}`.includes(q) || `${item.x} ${item.y}`.includes(q);
            if (!matchName && !matchId && !matchBiome && !matchReq && !matchCoords) {
                return false;
            }
        }

        return true;
    }

    /**
     * Get filtered collectibles list
     */
    function getFilteredCollectibles() {
        if (!mapState.data) return [];
        return mapState.data.collectibles.filter(matchesFilters);
    }

    /**
     * Toggle visited state of a single collectible ID
     */
    function toggleVisited(id, forceState = null) {
        if (!mapState.byId.has(id)) return;
        const nextState = forceState !== null ? !!forceState : !mapState.visited.has(id);
        if (nextState) {
            mapState.visited.add(id);
        } else {
            mapState.visited.delete(id);
        }
        saveVisitedToStorage();
        updateAllUI();
    }

    /**
     * Update Category Cards, Progress Bars, Sidebar Checklist, Inspector, and Canvas
     */
    function updateAllUI() {
        if (!mapState.initialized || !mapState.data) return;
        renderCategoryCards();
        renderInspectorCard();
        renderSelectedPopup();
        renderChecklist();
        requestRedraw();
    }

    /**
     * Render the 6 Category Toggle & Progress Cards + Overall Progress Header
     */
    function renderCategoryCards() {
        if (!dom.categoryCardsContainer || !mapState.data) return;

        // Calculate visited counts per category
        const visitedByCat = {
            somersloop: 0,
            mercer_sphere: 0,
            hard_drive: 0,
            slug_blue: 0,
            slug_yellow: 0,
            slug_purple: 0
        };

        mapState.data.collectibles.forEach(item => {
            if (mapState.visited.has(item.id)) {
                visitedByCat[item.type] = (visitedByCat[item.type] || 0) + 1;
            }
        });

        const totalCollectibles = mapState.data.counts.total;
        const totalVisited = mapState.visited.size;
        const overallPct = totalCollectibles > 0 ? Math.round((totalVisited / totalCollectibles) * 1000) / 10 : 0;

        // Power Shards calculation from collected slugs
        const totalShardsAvailable =
            mapState.data.counts.slug_blue * 1 +
            mapState.data.counts.slug_yellow * 2 +
            mapState.data.counts.slug_purple * 5;
        const collectedShards =
            visitedByCat.slug_blue * 1 +
            visitedByCat.slug_yellow * 2 +
            visitedByCat.slug_purple * 5;

        if (dom.overallProgressText) {
            dom.overallProgressText.innerHTML = `<strong>${totalVisited}</strong> / ${totalCollectibles} Visited <span class="map-pct-badge">(${overallPct}%)</span>`;
        }
        if (dom.overallProgressBar) {
            dom.overallProgressBar.style.width = `${Math.min(100, overallPct)}%`;
        }
        if (dom.overallShardsText) {
            dom.overallShardsText.innerHTML = `💎 <strong>${collectedShards}</strong> / ${totalShardsAvailable} Power Shards from Slugs`;
        }

        let html = '';
        Object.values(CATEGORIES).forEach(cat => {
            const total = mapState.data.counts[cat.id] || 0;
            const vis = visitedByCat[cat.id] || 0;
            const rem = total - vis;
            const pct = total > 0 ? Math.round((vis / total) * 100) : 0;
            const isActive = mapState.activeCategories.has(cat.id);

            html += `
                <div class="map-cat-card ${isActive ? 'active' : 'inactive'}" data-cat="${cat.id}" style="--cat-color: ${cat.color}; --cat-glow: ${cat.glowColor}; --cat-bg: ${cat.badgeBg};">
                    <div class="map-cat-card-top">
                        <div class="map-cat-icon-wrap">
                            <img src="${cat.icon}" alt="${escapeHtml(cat.name)}" onerror="this.style.display='none'">
                        </div>
                        <div class="map-cat-info">
                            <div class="map-cat-title-row">
                                <span class="map-cat-name">${escapeHtml(cat.plural)}</span>
                            </div>
                            <div class="map-cat-stats">
                                <strong class="map-cat-vis">${vis}</strong>
                                <span class="map-cat-sep">/</span>
                                <span class="map-cat-tot">${total}</span>
                                <span class="map-cat-rem">(${rem} left)</span>
                            </div>
                        </div>
                        <div class="map-cat-actions">
                            <button type="button" class="map-cat-solo-btn" data-solo="${cat.id}" title="Show ONLY ${escapeHtml(cat.plural)} on map">Only</button>
                            <span class="map-cat-eye" title="${isActive ? 'Visible on map (click card to hide)' : 'Hidden on map (click card to show)'}">
                                ${isActive ? '👁️' : '🚫'}
                            </span>
                        </div>
                    </div>
                    <div class="map-cat-progress-track">
                        <div class="map-cat-progress-fill" style="width: ${pct}%; background-color: ${cat.color};"></div>
                    </div>
                </div>
            `;
        });

        dom.categoryCardsContainer.innerHTML = html;

        // Attach click listeners for category cards & "Only" buttons
        dom.categoryCardsContainer.querySelectorAll('.map-cat-card').forEach(card => {
            card.addEventListener('click', (e) => {
                if (e.target.closest('.map-cat-solo-btn')) return;
                const catId = card.getAttribute('data-cat');
                if (mapState.activeCategories.has(catId)) {
                    mapState.activeCategories.delete(catId);
                } else {
                    mapState.activeCategories.add(catId);
                }
                updateAllUI();
            });
        });

        dom.categoryCardsContainer.querySelectorAll('.map-cat-solo-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const catId = btn.getAttribute('data-solo');
                if (mapState.activeCategories.size === 1 && mapState.activeCategories.has(catId)) {
                    // Restore all
                    Object.keys(CATEGORIES).forEach(k => mapState.activeCategories.add(k));
                } else {
                    mapState.activeCategories.clear();
                    mapState.activeCategories.add(catId);
                }
                updateAllUI();
            });
        });
    }

    /**
     * Render Selected Collectible Inspector Card in Sidebar
     */
    function renderInspectorCard() {
        if (!dom.inspectorCard) return;
        const item = mapState.selectedPin;

        if (!item) {
            dom.inspectorCard.innerHTML = `
                <div class="map-inspector-empty">
                    <span class="map-inspector-empty-icon">📍</span>
                    <div>
                        <strong>Click any pin on the map</strong>
                        <p>View exact coordinates, Crash Site unlock requirements, and mark locations as <em>Already Visited</em>.</p>
                    </div>
                </div>
            `;
            return;
        }

        const cat = CATEGORIES[item.type];
        const isVisited = mapState.visited.has(item.id);

        let extraDetailsHtml = '';
        if (item.type === 'hard_drive') {
            let reqBadgeClass = 'free';
            let reqIcon = '🔓';
            if (item.reqType === 'power') {
                reqBadgeClass = 'power';
                reqIcon = '⚡';
            } else if (item.reqType === 'item') {
                reqBadgeClass = 'item';
                reqIcon = '📦';
            }
            extraDetailsHtml = `
                <div class="map-inspector-req ${reqBadgeClass}">
                    <span class="req-label">DROP POD UNLOCK REQUIREMENT:</span>
                    <div class="req-value">
                        ${item.reqItemIcon ? `<img src="${item.reqItemIcon}" alt="" class="req-item-icon" onerror="this.style.display='none'">` : `<span>${reqIcon}</span>`}
                        <strong>${escapeHtml(item.reqLabel)}</strong>
                    </div>
                </div>
            `;
        } else if (item.shards) {
            extraDetailsHtml = `
                <div class="map-inspector-req shard">
                    <span class="req-label">POWER SHARD YIELD:</span>
                    <div class="req-value">
                        <img src="images/items/Desc_CrystalShard_C.png" alt="" class="req-item-icon" onerror="this.style.display='none'">
                        <strong>+${item.shards} Power Shard${item.shards > 1 ? 's' : ''}</strong>
                    </div>
                </div>
            `;
        }

        dom.inspectorCard.innerHTML = `
            <div class="map-inspector-active" style="--cat-color: ${cat.color};">
                <div class="map-inspector-header">
                    <img src="${cat.icon}" alt="${escapeHtml(item.displayName)}" class="map-inspector-icon">
                    <div class="map-inspector-titles">
                        <span class="map-inspector-cat" style="color: ${cat.color};">${escapeHtml(cat.name.toUpperCase())}</span>
                        <h4 class="map-inspector-name">${escapeHtml(item.displayName)}</h4>
                        <span class="map-inspector-biome">🌲 ${escapeHtml(item.biome)} &bull; <code>X: ${item.x}m, Y: ${item.y}m</code></span>
                    </div>
                    <button type="button" class="map-inspector-close" id="mapInspectorCloseBtn" title="Deselect pin">&times;</button>
                </div>

                ${extraDetailsHtml}

                <div class="map-inspector-actions">
                    <button type="button" id="mapInspectorToggleVisitedBtn" class="btn-mark-visited ${isVisited ? 'is-visited' : ''}">
                        ${isVisited ? '✅ Already Visited (Click to Unmark)' : '📍 Mark as Already Visited'}
                    </button>
                    <button type="button" id="mapInspectorCenterBtn" class="btn-center-pin" title="Center and zoom to this location">
                        🎯 Focus
                    </button>
                </div>
            </div>
        `;

        document.getElementById('mapInspectorToggleVisitedBtn')?.addEventListener('click', () => {
            toggleVisited(item.id);
        });
        document.getElementById('mapInspectorCenterBtn')?.addEventListener('click', () => {
            focusOnCollectible(item.id, true);
        });
        document.getElementById('mapInspectorCloseBtn')?.addEventListener('click', () => {
            mapState.selectedPin = null;
            renderInspectorCard();
            renderSelectedPopup();
            requestRedraw();
        });
    }

    /**
     * Render floating popup directly on the map canvas over the selected pin
     */
    function renderSelectedPopup() {
        if (!dom.selectedPopup) return;
        const item = mapState.selectedPin;
        if (!item || !matchesFilters(item)) {
            dom.selectedPopup.style.display = 'none';
            return;
        }

        const cat = CATEGORIES[item.type];
        const isVisited = mapState.visited.has(item.id);

        let subLine = '';
        if (item.type === 'hard_drive') {
            subLine = `<div class="popup-req">🔧 Unlock: <strong>${escapeHtml(item.reqLabel)}</strong></div>`;
        } else if (item.shards) {
            subLine = `<div class="popup-req">💎 Yields <strong>${item.shards} Power Shard${item.shards > 1 ? 's' : ''}</strong></div>`;
        }

        dom.selectedPopup.innerHTML = `
            <div class="map-popup-card" style="--cat-color: ${cat.color};">
                <button type="button" class="map-popup-close" id="mapPopupCloseBtn" title="Close">&times;</button>
                <div class="map-popup-head">
                    <img src="${cat.icon}" alt="" class="map-popup-icon">
                    <div>
                        <div class="map-popup-title">${escapeHtml(item.displayName)}</div>
                        <div class="map-popup-meta">${escapeHtml(item.biome)} &bull; (${item.x}m, ${item.y}m)</div>
                    </div>
                </div>
                ${subLine}
                <button type="button" id="mapPopupVisitedBtn" class="map-popup-visit-btn ${isVisited ? 'visited' : ''}">
                    ${isVisited ? '✅ Already Visited (Undo)' : '☑️ Mark as Already Visited'}
                </button>
            </div>
        `;
        dom.selectedPopup.style.display = 'block';
        updateSelectedPopupPosition();

        document.getElementById('mapPopupCloseBtn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            mapState.selectedPin = null;
            renderInspectorCard();
            renderSelectedPopup();
            requestRedraw();
        });

        document.getElementById('mapPopupVisitedBtn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleVisited(item.id);
        });
    }

    /**
     * Position the floating selected popup over the pin's current screen coordinates
     */
    function updateSelectedPopupPosition() {
        if (!dom.selectedPopup || !mapState.selectedPin || dom.selectedPopup.style.display === 'none') return;
        const item = mapState.selectedPin;
        const sx = mapState.panX + item.px * mapState.scale;
        const sy = mapState.panY + item.py * mapState.scale;

        dom.selectedPopup.style.left = `${sx}px`;
        dom.selectedPopup.style.top = `${sy - 14}px`;
    }

    /**
     * Render the scrollable checklist in the right sidebar
     */
    function renderChecklist() {
        if (!dom.checklistContainer || !mapState.data) return;

        const filtered = getFilteredCollectibles();
        if (dom.checklistCountBadge) {
            dom.checklistCountBadge.textContent = `${filtered.length} shown`;
        }
        if (dom.visiblePinsCountHud) {
            const visInFiltered = filtered.filter(i => mapState.visited.has(i.id)).length;
            dom.visiblePinsCountHud.innerHTML = `Showing <strong>${filtered.length}</strong> locations (${visInFiltered} visited, ${filtered.length - visInFiltered} remaining)`;
        }

        if (filtered.length === 0) {
            dom.checklistContainer.innerHTML = `
                <div class="map-checklist-empty">
                    <p>No collectible locations match your active filters.</p>
                </div>
            `;
            return;
        }

        // Limit DOM nodes to 250 for instant rendering while scrolling
        const maxDisplay = 250;
        const slice = filtered.slice(0, maxDisplay);

        let html = '';
        for (const item of slice) {
            const cat = CATEGORIES[item.type];
            const isVisited = mapState.visited.has(item.id);
            const isSelected = mapState.selectedPin && mapState.selectedPin.id === item.id;

            let reqTag = '';
            if (item.type === 'hard_drive') {
                reqTag = `<span class="checklist-req-tag">${escapeHtml(item.reqLabel)}</span>`;
            } else if (item.shards) {
                reqTag = `<span class="checklist-shard-tag">+${item.shards}💎</span>`;
            }

            html += `
                <div class="map-checklist-row ${isVisited ? 'visited' : ''} ${isSelected ? 'selected' : ''}" data-id="${item.id}">
                    <label class="checklist-check-wrap" title="Mark/unmark as already visited">
                        <input type="checkbox" class="checklist-checkbox" data-check-id="${item.id}" ${isVisited ? 'checked' : ''}>
                        <span class="checklist-custom-check"></span>
                    </label>
                    <img src="${cat.icon}" alt="" class="checklist-item-icon" loading="lazy">
                    <div class="checklist-item-body">
                        <div class="checklist-item-top">
                            <span class="checklist-item-title">${escapeHtml(item.displayName)}</span>
                            ${reqTag}
                        </div>
                        <div class="checklist-item-sub">
                            <span>${escapeHtml(item.biome)}</span>
                            <span>&bull;</span>
                            <code>${item.x}m, ${item.y}m</code>
                        </div>
                    </div>
                    <button type="button" class="checklist-locate-btn" data-locate-id="${item.id}" title="Locate on map">🎯</button>
                </div>
            `;
        }

        if (filtered.length > maxDisplay) {
            html += `
                <div class="map-checklist-more">
                    Showing first ${maxDisplay} of ${filtered.length} matching locations. Use category or biome filters above to narrow down.
                </div>
            `;
        }

        dom.checklistContainer.innerHTML = html;

        // Bind checkbox events & row click events
        dom.checklistContainer.querySelectorAll('.checklist-checkbox').forEach(cb => {
            cb.addEventListener('change', (e) => {
                e.stopPropagation();
                const id = cb.getAttribute('data-check-id');
                toggleVisited(id, cb.checked);
            });
            cb.addEventListener('click', e => e.stopPropagation());
        });

        dom.checklistContainer.querySelectorAll('.map-checklist-row').forEach(row => {
            row.addEventListener('click', () => {
                const id = row.getAttribute('data-id');
                focusOnCollectible(id, true);
            });
        });
    }

    /**
     * Smoothly center the map on a collectible and trigger a radar pulse
     */
    function focusOnCollectible(id, zoomIn = true) {
        const item = mapState.byId.get(id);
        if (!item || !dom.canvas) return;

        mapState.selectedPin = item;
        mapState.pulsePinId = item.id;
        mapState.pulseStartTime = performance.now();

        const rect = dom.canvas.getBoundingClientRect();
        if (zoomIn && mapState.scale < 0.22) {
            mapState.scale = 0.25;
        }
        mapState.panX = rect.width / 2 - item.px * mapState.scale;
        mapState.panY = rect.height / 2 - item.py * mapState.scale;

        renderInspectorCard();
        renderSelectedPopup();
        renderChecklist();
        startPulseLoop();
    }

    /**
     * Animate radar pulse ring around focused pin
     */
    function startPulseLoop() {
        if (mapState.animFrameId) cancelAnimationFrame(mapState.animFrameId);
        function step(now) {
            const elapsed = now - mapState.pulseStartTime;
            drawCanvas(now);
            if (elapsed < 2200) {
                mapState.animFrameId = requestAnimationFrame(step);
            } else {
                mapState.pulsePinId = null;
                mapState.animFrameId = null;
                drawCanvas();
            }
        }
        mapState.animFrameId = requestAnimationFrame(step);
    }

    /**
     * Resize canvas to match its container and optionally fit the full world map
     */
    function resizeCanvasAndFit(fitWorld = false) {
        if (!dom.canvas || !dom.canvasWrapper) return;
        const rect = dom.canvasWrapper.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;

        const dpr = window.devicePixelRatio || 1;
        dom.canvas.width = Math.round(rect.width * dpr);
        dom.canvas.height = Math.round(rect.height * dpr);

        if (fitWorld || mapState.scale <= 0) {
            fitMapToViewport();
        } else {
            requestRedraw();
        }
    }

    /**
     * Reset pan and zoom so the full 8192x8192 map fits nicely in the viewport
     */
    function fitMapToViewport() {
        if (!dom.canvasWrapper) return;
        const rect = dom.canvasWrapper.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;

        const padding = 24;
        const availW = Math.max(200, rect.width - padding * 2);
        const availH = Math.max(200, rect.height - padding * 2);
        const scale = Math.min(availW / MAP_LOGICAL_SIZE, availH / MAP_LOGICAL_SIZE);

        mapState.scale = scale;
        mapState.panX = (rect.width - MAP_LOGICAL_SIZE * scale) / 2;
        mapState.panY = (rect.height - MAP_LOGICAL_SIZE * scale) / 2;

        updateSelectedPopupPosition();
        requestRedraw();
    }

    /**
     * Request a single animation frame redraw
     */
    let redrawPending = false;
    function requestRedraw() {
        if (redrawPending) return;
        redrawPending = true;
        requestAnimationFrame((now) => {
            redrawPending = false;
            drawCanvas(now);
            updateSelectedPopupPosition();
        });
    }

    /**
     * Render the World Map, Grid, Biome Labels, and Collectible Pins on HTML5 Canvas
     */
    function drawCanvas(now = performance.now()) {
        if (!dom.canvas) return;
        const ctx = dom.canvas.getContext('2d');
        const dpr = window.devicePixelRatio || 1;
        const width = dom.canvas.width / dpr;
        const height = dom.canvas.height / dpr;

        ctx.save();
        ctx.scale(dpr, dpr);

        // 1. Clear background
        ctx.fillStyle = '#090d13';
        ctx.fillRect(0, 0, width, height);

        // 2. Draw stitched 2048x2048 World Map stretched to 0..8192 logical space
        const mapScreenX = mapState.panX;
        const mapScreenY = mapState.panY;
        const mapScreenW = MAP_LOGICAL_SIZE * mapState.scale;
        const mapScreenH = MAP_LOGICAL_SIZE * mapState.scale;

        if (mapState.offscreenMap) {
            ctx.drawImage(mapState.offscreenMap, mapScreenX, mapScreenY, mapScreenW, mapScreenH);
        }

        // Subtle border around world bounds
        ctx.strokeStyle = 'rgba(250, 149, 73, 0.35)';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(mapScreenX, mapScreenY, mapScreenW, mapScreenH);

        // 3. Optional Coordinate Grid
        if (mapState.showGrid) {
            ctx.strokeStyle = 'rgba(148, 163, 184, 0.14)';
            ctx.lineWidth = 1;
            ctx.fillStyle = 'rgba(148, 163, 184, 0.55)';
            ctx.font = '600 10px ui-monospace, SFMono-Regular, monospace';

            // Step every 1000m in game world (-3000m to +4000m)
            const x0 = -3246.98;
            const x1 = 4253.01;
            const y0 = -3750.0;
            const y1 = 3750.0;

            for (let gx = -3000; gx <= 4000; gx += 1000) {
                const px = ((gx - x0) / (x1 - x0)) * MAP_LOGICAL_SIZE;
                const sx = mapState.panX + px * mapState.scale;
                if (sx >= mapScreenX && sx <= mapScreenX + mapScreenW) {
                    ctx.beginPath();
                    ctx.moveTo(sx, Math.max(0, mapScreenY));
                    ctx.lineTo(sx, Math.min(height, mapScreenY + mapScreenH));
                    ctx.stroke();
                    ctx.fillText(`${gx}m`, sx + 4, Math.max(14, mapScreenY + 14));
                }
            }

            for (let gy = -3000; gy <= 3000; gy += 1000) {
                const py = ((gy - y0) / (y1 - y0)) * MAP_LOGICAL_SIZE;
                const sy = mapState.panY + py * mapState.scale;
                if (sy >= mapScreenY && sy <= mapScreenY + mapScreenH) {
                    ctx.beginPath();
                    ctx.moveTo(Math.max(0, mapScreenX), sy);
                    ctx.lineTo(Math.min(width, mapScreenX + mapScreenW), sy);
                    ctx.stroke();
                    ctx.fillText(`${gy}m`, Math.max(6, mapScreenX + 6), sy - 4);
                }
            }
        }

        // 4. Optional Biome Labels
        if (mapState.showBiomeLabels) {
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            const fontSize = Math.max(9, Math.min(14, Math.round(95 * mapState.scale)));
            ctx.font = `800 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;

            for (const b of BIOME_LABELS) {
                const sx = mapState.panX + b.px * mapState.scale;
                const sy = mapState.panY + b.py * mapState.scale;
                if (sx < -100 || sx > width + 100 || sy < -30 || sy > height + 30) continue;

                ctx.strokeStyle = 'rgba(9, 13, 19, 0.85)';
                ctx.lineWidth = 3.5;
                ctx.strokeText(b.name, sx, sy);
                ctx.fillStyle = 'rgba(226, 232, 240, 0.78)';
                ctx.fillText(b.name, sx, sy);
            }
        }

        // 5. Collectible Pins
        if (mapState.data) {
            const filtered = getFilteredCollectibles();

            // Pin radius scales smoothly with zoom level
            const baseRadius = Math.max(5.5, Math.min(15, 72 * mapState.scale));
            const showIconsInPins = baseRadius >= 8.5;

            // Draw visited pins first so unvisited pins stand out on top
            const visitedPins = [];
            const unvisitedPins = [];
            for (const item of filtered) {
                if (mapState.visited.has(item.id)) {
                    visitedPins.push(item);
                } else {
                    unvisitedPins.push(item);
                }
            }

            const orderedPins = [...visitedPins, ...unvisitedPins];

            for (const item of orderedPins) {
                const sx = mapState.panX + item.px * mapState.scale;
                const sy = mapState.panY + item.py * mapState.scale;

                // Frustum culling
                if (sx < -25 || sx > width + 25 || sy < -25 || sy > height + 25) continue;

                const cat = CATEGORIES[item.type];
                const isVisited = mapState.visited.has(item.id);
                const isHovered = mapState.hoveredPin && mapState.hoveredPin.id === item.id;
                const isSelected = mapState.selectedPin && mapState.selectedPin.id === item.id;

                // Slight importance scale: Hard Drives, Somersloops, Mercer Spheres slightly larger than Blue Slugs
                const typeScale = (item.type === 'somersloop' || item.type === 'mercer_sphere' || item.type === 'hard_drive') ? 1.12 : 0.94;
                let r = baseRadius * typeScale;
                if (isHovered || isSelected) r *= 1.28;

                ctx.save();
                if (isVisited && !isHovered && !isSelected) {
                    ctx.globalAlpha = 0.42;
                }

                // Selected / Hovered outer glow ring
                if (isSelected || isHovered) {
                    ctx.beginPath();
                    ctx.arc(sx, sy, r + 4, 0, Math.PI * 2);
                    ctx.fillStyle = isVisited ? 'rgba(34, 197, 94, 0.35)' : cat.glowColor;
                    ctx.fill();
                }

                // Pin background disc
                ctx.beginPath();
                ctx.arc(sx, sy, r, 0, Math.PI * 2);
                ctx.fillStyle = isVisited ? '#064e3b' : 'rgba(15, 23, 42, 0.92)';
                ctx.fill();

                // Pin colored border ring
                ctx.lineWidth = (isHovered || isSelected) ? 2.6 : 1.8;
                ctx.strokeStyle = isVisited ? '#22c55e' : cat.color;
                ctx.stroke();

                // Icon or dot inside pin
                if (showIconsInPins) {
                    const img = mapState.iconImages.get(item.type);
                    if (img && img.complete && img.naturalWidth > 0) {
                        const iconSize = r * 1.45;
                        ctx.drawImage(img, sx - iconSize / 2, sy - iconSize / 2, iconSize, iconSize);
                    }
                } else {
                    ctx.beginPath();
                    ctx.arc(sx, sy, Math.max(2, r * 0.48), 0, Math.PI * 2);
                    ctx.fillStyle = isVisited ? '#4ade80' : cat.color;
                    ctx.fill();
                }

                // Visited green checkmark badge on top-right of pin
                if (isVisited && r >= 7) {
                    const badgeR = Math.max(4, r * 0.42);
                    const bx = sx + r * 0.68;
                    const by = sy - r * 0.68;
                    ctx.beginPath();
                    ctx.arc(bx, by, badgeR, 0, Math.PI * 2);
                    ctx.fillStyle = '#10b981';
                    ctx.fill();
                    ctx.strokeStyle = '#052e16';
                    ctx.lineWidth = 1;
                    ctx.stroke();
                }

                ctx.restore();
            }

            // 6. Radar Pulse Animation around focused pin
            if (mapState.pulsePinId) {
                const pItem = mapState.byId.get(mapState.pulsePinId);
                if (pItem) {
                    const sx = mapState.panX + pItem.px * mapState.scale;
                    const sy = mapState.panY + pItem.py * mapState.scale;
                    const elapsed = (now - mapState.pulseStartTime) % 1100;
                    const t = elapsed / 1100;
                    const pulseR = 12 + t * 48;
                    const alpha = Math.max(0, 1 - t);

                    ctx.beginPath();
                    ctx.arc(sx, sy, pulseR, 0, Math.PI * 2);
                    ctx.strokeStyle = `rgba(250, 149, 73, ${alpha.toFixed(2)})`;
                    ctx.lineWidth = 3;
                    ctx.stroke();
                }
            }
        }

        ctx.restore();
    }

    /**
     * Find the topmost pin at canvas client offset (mx, my)
     */
    function findPinAtScreenPos(mx, my) {
        if (!mapState.data) return null;
        const filtered = getFilteredCollectibles();
        const baseRadius = Math.max(7, Math.min(16, 72 * mapState.scale));
        const hitPadding = 4;

        let bestPin = null;
        let bestDistSq = Infinity;

        for (let i = filtered.length - 1; i >= 0; i--) {
            const item = filtered[i];
            const sx = mapState.panX + item.px * mapState.scale;
            const sy = mapState.panY + item.py * mapState.scale;
            const hitR = baseRadius + hitPadding;
            const dx = mx - sx;
            const dy = my - sy;
            const dSq = dx * dx + dy * dy;
            if (dSq <= hitR * hitR && dSq < bestDistSq) {
                bestDistSq = dSq;
                bestPin = item;
            }
        }
        return bestPin;
    }

    /**
     * Update floating hover tooltip when hovering over a pin
     */
    function updateHoverTooltip(pin, clientX, clientY) {
        if (!dom.hoverTooltip || !dom.canvasWrapper) return;
        if (!pin || (mapState.selectedPin && mapState.selectedPin.id === pin.id)) {
            dom.hoverTooltip.style.display = 'none';
            return;
        }

        const cat = CATEGORIES[pin.type];
        const isVisited = mapState.visited.has(pin.id);

        let extraHtml = '';
        if (pin.type === 'hard_drive') {
            extraHtml = `<div class="map-tt-req">🔧 Unlock: <strong>${escapeHtml(pin.reqLabel)}</strong></div>`;
        } else if (pin.shards) {
            extraHtml = `<div class="map-tt-req">💎 Yields <strong>+${pin.shards} Power Shard${pin.shards > 1 ? 's' : ''}</strong></div>`;
        }

        dom.hoverTooltip.innerHTML = `
            <div class="map-tt-head">
                <img src="${cat.icon}" alt="" class="map-tt-icon">
                <div>
                    <div class="map-tt-title">${escapeHtml(pin.displayName)}</div>
                    <div class="map-tt-sub">${escapeHtml(pin.biome)} &bull; X: ${pin.x}m, Y: ${pin.y}m</div>
                </div>
            </div>
            ${extraHtml}
            <div class="map-tt-status ${isVisited ? 'visited' : 'unvisited'}">
                ${isVisited ? '✅ Already Visited' : '📍 Not Visited Yet'}
                <span class="map-tt-hint">${mapState.quickMarkMode ? '(Click to toggle visited)' : '(Click to inspect / mark)'}</span>
            </div>
        `;

        const wrapRect = dom.canvasWrapper.getBoundingClientRect();
        const relX = clientX - wrapRect.left;
        const relY = clientY - wrapRect.top;

        dom.hoverTooltip.style.left = `${relX + 16}px`;
        dom.hoverTooltip.style.top = `${relY + 16}px`;
        dom.hoverTooltip.style.display = 'block';
    }

    /**
     * Bind all Canvas & Toolbar Events
     */
    function bindEvents() {
        if (!dom.canvas || !dom.canvasWrapper) return;

        // 1. Canvas Mouse Pan & Click
        dom.canvas.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            mapState.isDragging = true;
            mapState.dragMoved = false;
            mapState.dragStartX = e.clientX - mapState.panX;
            mapState.dragStartY = e.clientY - mapState.panY;
            dom.canvas.style.cursor = 'grabbing';
        });

        window.addEventListener('mousemove', (e) => {
            if (!dom.workspace || dom.workspace.style.display === 'none') return;

            if (mapState.isDragging) {
                const newPanX = e.clientX - mapState.dragStartX;
                const newPanY = e.clientY - mapState.dragStartY;
                if (Math.abs(newPanX - mapState.panX) > 3 || Math.abs(newPanY - mapState.panY) > 3) {
                    mapState.dragMoved = true;
                }
                mapState.panX = newPanX;
                mapState.panY = newPanY;
                if (dom.hoverTooltip) dom.hoverTooltip.style.display = 'none';
                requestRedraw();
                return;
            }

            // Check if mouse is inside canvas
            const rect = dom.canvas.getBoundingClientRect();
            if (e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom) {
                const mx = e.clientX - rect.left;
                const my = e.clientY - rect.top;

                // Update cursor world coordinates HUD
                const logicalX = (mx - mapState.panX) / mapState.scale;
                const logicalY = (my - mapState.panY) / mapState.scale;
                if (dom.cursorCoordsHud && mapState.data) {
                    const b = mapState.data.bounds;
                    const worldX = Math.round((b.x0 + (logicalX / MAP_LOGICAL_SIZE) * (b.x1 - b.x0)) / 100);
                    const worldY = Math.round((b.y0 + (logicalY / MAP_LOGICAL_SIZE) * (b.y1 - b.y0)) / 100);
                    dom.cursorCoordsHud.textContent = `X: ${worldX}m  •  Y: ${worldY}m`;
                }

                // Hit-test pins
                const hitPin = findPinAtScreenPos(mx, my);
                if (hitPin !== mapState.hoveredPin) {
                    mapState.hoveredPin = hitPin;
                    dom.canvas.style.cursor = hitPin ? 'pointer' : 'grab';
                    requestRedraw();
                }
                updateHoverTooltip(hitPin, e.clientX, e.clientY);
            } else {
                if (mapState.hoveredPin) {
                    mapState.hoveredPin = null;
                    requestRedraw();
                }
                if (dom.hoverTooltip) dom.hoverTooltip.style.display = 'none';
            }
        });

        window.addEventListener('mouseup', (e) => {
            if (!mapState.isDragging) return;
            mapState.isDragging = false;
            if (dom.canvas) {
                dom.canvas.style.cursor = mapState.hoveredPin ? 'pointer' : 'grab';
            }

            if (!mapState.dragMoved && e.target === dom.canvas) {
                const rect = dom.canvas.getBoundingClientRect();
                const mx = e.clientX - rect.left;
                const my = e.clientY - rect.top;
                const clickedPin = findPinAtScreenPos(mx, my);

                if (clickedPin) {
                    if (mapState.quickMarkMode || e.shiftKey) {
                        // Immediately toggle visited status on single click!
                        mapState.selectedPin = clickedPin;
                        toggleVisited(clickedPin.id);
                    } else {
                        mapState.selectedPin = clickedPin;
                        if (dom.hoverTooltip) dom.hoverTooltip.style.display = 'none';
                        renderInspectorCard();
                        renderSelectedPopup();
                        renderChecklist();
                        requestRedraw();
                    }
                } else {
                    if (mapState.selectedPin) {
                        mapState.selectedPin = null;
                        renderInspectorCard();
                        renderSelectedPopup();
                        renderChecklist();
                        requestRedraw();
                    }
                }
            }
        });

        // Double-click a pin always toggles visited status immediately
        dom.canvas.addEventListener('dblclick', (e) => {
            const rect = dom.canvas.getBoundingClientRect();
            const mx = e.clientX - rect.left;
            const my = e.clientY - rect.top;
            const clickedPin = findPinAtScreenPos(mx, my);
            if (clickedPin) {
                e.preventDefault();
                mapState.selectedPin = clickedPin;
                toggleVisited(clickedPin.id);
            }
        });

        // 2. Mouse Wheel Zoom centered at cursor
        dom.canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            const rect = dom.canvas.getBoundingClientRect();
            const mx = e.clientX - rect.left;
            const my = e.clientY - rect.top;

            const zoomFactor = e.deltaY < 0 ? 1.18 : 1 / 1.18;
            zoomAroundPoint(mx, my, zoomFactor);
        }, { passive: false });

        // 3. Zoom & Fit Buttons
        dom.zoomInBtn?.addEventListener('click', () => {
            const rect = dom.canvas.getBoundingClientRect();
            zoomAroundPoint(rect.width / 2, rect.height / 2, 1.3);
        });
        dom.zoomOutBtn?.addEventListener('click', () => {
            const rect = dom.canvas.getBoundingClientRect();
            zoomAroundPoint(rect.width / 2, rect.height / 2, 1 / 1.3);
        });
        dom.fitViewBtn?.addEventListener('click', () => {
            fitMapToViewport();
        });

        // 4. Show All Categories Button
        dom.showAllCatsBtn?.addEventListener('click', () => {
            Object.keys(CATEGORIES).forEach(k => mapState.activeCategories.add(k));
            updateAllUI();
        });

        // 5. Visited Status Filter Pills
        if (dom.visitedFilterPills) {
            dom.visitedFilterPills.querySelectorAll('.filter-pill').forEach(pill => {
                pill.addEventListener('click', () => {
                    dom.visitedFilterPills.querySelectorAll('.filter-pill').forEach(p => p.classList.remove('active'));
                    pill.classList.add('active');
                    mapState.visitedFilter = pill.getAttribute('data-visited-filter') || 'all';
                    updateAllUI();
                });
            });
        }

        // 6. Biome & Crash Site Requirement Dropdowns
        dom.biomeSelect?.addEventListener('change', () => {
            mapState.biomeFilter = dom.biomeSelect.value;
            updateAllUI();
        });

        dom.podReqSelect?.addEventListener('change', () => {
            mapState.podReqFilter = dom.podReqSelect.value;
            if (mapState.podReqFilter !== 'all' && !mapState.activeCategories.has('hard_drive')) {
                mapState.activeCategories.add('hard_drive');
            }
            updateAllUI();
        });

        // 7. Search Input
        dom.searchInput?.addEventListener('input', () => {
            mapState.searchQuery = dom.searchInput.value.trim().toLowerCase();
            if (dom.clearSearchBtn) {
                dom.clearSearchBtn.style.display = mapState.searchQuery ? 'flex' : 'none';
            }
            updateAllUI();
        });

        dom.clearSearchBtn?.addEventListener('click', () => {
            if (dom.searchInput) dom.searchInput.value = '';
            mapState.searchQuery = '';
            dom.clearSearchBtn.style.display = 'none';
            updateAllUI();
        });

        // 8. Quick-Mark Mode Toggle
        dom.quickMarkBtn?.addEventListener('click', () => {
            mapState.quickMarkMode = !mapState.quickMarkMode;
            dom.quickMarkBtn.classList.toggle('active', mapState.quickMarkMode);
            dom.quickMarkBtn.innerHTML = mapState.quickMarkMode
                ? '⚡ 1-Click Mark: <strong>ON</strong>'
                : '⚡ 1-Click Mark: <strong>OFF</strong>';
        });

        // 9. Biome Labels & Grid Toggles
        dom.biomeLabelsBtn?.addEventListener('click', () => {
            mapState.showBiomeLabels = !mapState.showBiomeLabels;
            dom.biomeLabelsBtn.classList.toggle('active', mapState.showBiomeLabels);
            requestRedraw();
        });

        dom.gridToggleBtn?.addEventListener('click', () => {
            mapState.showGrid = !mapState.showGrid;
            dom.gridToggleBtn.classList.toggle('active', mapState.showGrid);
            requestRedraw();
        });

        // 10. Export / Import / Reset Visited Progress
        dom.exportBtn?.addEventListener('click', exportVisitedProgress);
        dom.importBtn?.addEventListener('click', () => dom.importFileInput?.click());
        dom.importFileInput?.addEventListener('change', handleImportFile);
        dom.resetVisitedBtn?.addEventListener('click', () => {
            if (mapState.visited.size === 0) return;
            if (confirm(`Are you sure you want to clear all ${mapState.visited.size} "Already Visited" markers?`)) {
                mapState.visited.clear();
                saveVisitedToStorage();
                updateAllUI();
            }
        });

        // 11. Window Resize
        window.addEventListener('resize', () => {
            if (dom.workspace && dom.workspace.style.display !== 'none') {
                resizeCanvasAndFit(false);
            }
        });
    }

    /**
     * Zoom around a specific canvas pixel coordinate
     */
    function zoomAroundPoint(cx, cy, factor) {
        const minScale = 0.045;
        const maxScale = 0.85;
        const newScale = Math.max(minScale, Math.min(maxScale, mapState.scale * factor));
        const actualFactor = newScale / mapState.scale;

        mapState.panX = cx - (cx - mapState.panX) * actualFactor;
        mapState.panY = cy - (cy - mapState.panY) * actualFactor;
        mapState.scale = newScale;

        updateSelectedPopupPosition();
        requestRedraw();
    }

    /**
     * Export visited IDs as a JSON file
     */
    function exportVisitedProgress() {
        const payload = {
            app: 'SatisfactoryProductionChain',
            version: 1,
            exportedAt: new Date().toISOString(),
            visitedCount: mapState.visited.size,
            visitedIds: Array.from(mapState.visited)
        };
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `satisfactory-map-visited-${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    /**
     * Import visited IDs from a JSON file
     */
    function handleImportFile(e) {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            try {
                const parsed = JSON.parse(reader.result);
                const list = Array.isArray(parsed) ? parsed : (parsed.visitedIds || []);
                if (!Array.isArray(list)) throw new Error('Invalid progress JSON format.');
                let added = 0;
                list.forEach(id => {
                    if (typeof id === 'string' && mapState.byId.has(id)) {
                        mapState.visited.add(id);
                        added++;
                    }
                });
                saveVisitedToStorage();
                updateAllUI();
                alert(`Successfully imported ${added} visited collectible locations!`);
            } catch (err) {
                alert(`Failed to import progress file: ${err.message}`);
            }
            e.target.value = '';
        };
        reader.readAsText(file);
    }

    function escapeHtml(str) {
        if (str === null || str === undefined) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    return {
        init,
        toggleVisited,
        focusOnCollectible,
        fitMapToViewport,
        getState: () => mapState
    };
})();

