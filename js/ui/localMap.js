// ============================================
// LOCAL MAP — Inner tile exploration map
// ============================================
// Opens a small hex grid representing the interior
// of a selected world tile, seeded by tile coords.

const LocalMap = {
    // Grid dimensions for the local map
    COLS: 11,
    ROWS: 9,

    // Hex size in pixels
    HEX_SIZE: 36,

    // Current state
    _canvas: null,
    _ctx: null,
    _tiles: null,
    _worldTile: null,
    _hoveredCell: null,
    _selectedCell: null,
    _offsetX: 0,
    _offsetY: 0,
    _boundMouseMove: null,
    _boundMouseClick: null,

    // -----------------------------------------------
    // Terrain palette used inside local maps
    // -----------------------------------------------
    LOCAL_TERRAIN: {
        path:        { id: 'path',        name: 'Path',           color: '#c8b87a', icon: '🛤️',  passable: true },
        clearing:    { id: 'clearing',    name: 'Clearing',       color: '#a3c96e', icon: '🌿',  passable: true },
        thicket:     { id: 'thicket',     name: 'Thicket',        color: '#4a7a3a', icon: '🌳',  passable: true },
        stream:      { id: 'stream',      name: 'Stream',         color: '#5dade2', icon: '💧',  passable: false },
        rocky:       { id: 'rocky',       name: 'Rocky Ground',   color: '#8a7a6a', icon: '🪨',  passable: true },
        slope:       { id: 'slope',       name: 'Steep Slope',    color: '#7a6a5a', icon: '⛰️',  passable: true },
        scrub:       { id: 'scrub',       name: 'Scrubland',      color: '#bbb060', icon: '🌾',  passable: true },
        bog:         { id: 'bog',         name: 'Boggy Ground',   color: '#556644', icon: '🐸',  passable: true },
        sand:        { id: 'sand',        name: 'Sandy Ground',   color: '#d4c07a', icon: '🏜️',  passable: true },
        ice_patch:   { id: 'ice_patch',   name: 'Ice Patch',      color: '#ddeeff', icon: '❄️',  passable: true },
        open:        { id: 'open',        name: 'Open Ground',    color: '#88aa55', icon: '🌿',  passable: true },
    },

    // Points of interest that can appear on the local map
    POI_TYPES: {
        herb_patch:   { id: 'herb_patch',   name: 'Herb Patch',       icon: '🌿', desc: 'A cluster of useful medicinal plants.' },
        ore_vein:     { id: 'ore_vein',     name: 'Ore Vein',         icon: '⛏️', desc: 'An exposed seam of ore in the rock face.' },
        ancient_stone:{ id: 'ancient_stone',name: 'Ancient Stone',    icon: '🗿', desc: 'A weathered standing stone covered in faded runes.' },
        hidden_spring:{ id: 'hidden_spring',name: 'Hidden Spring',    icon: '💦', desc: 'A clear spring bubbling up from the earth.' },
        bandit_camp:  { id: 'bandit_camp',  name: 'Bandit Camp',      icon: '🏕️', desc: 'The remains of a rough camp. Someone was here recently.' },
        old_shrine:   { id: 'old_shrine',   name: 'Old Shrine',       icon: '⛩️', desc: 'A small roadside shrine, offerings long since taken.' },
        cave_mouth:   { id: 'cave_mouth',   name: 'Cave Mouth',       icon: '🕳️', desc: 'A dark opening in the rock leading somewhere unknown.' },
        burial_mound: { id: 'burial_mound', name: 'Burial Mound',     icon: '⚰️', desc: 'A low earthen mound. The resting place of someone long forgotten.' },
        game_trail:   { id: 'game_trail',   name: 'Game Trail',       icon: '🦌', desc: 'Fresh tracks and a well-worn trail through the undergrowth.' },
        ruined_wall:  { id: 'ruined_wall',  name: 'Ruined Wall',      icon: '🏚️', desc: 'Crumbling stone walls of a structure long since abandoned.' },
        berry_bushes: { id: 'berry_bushes', name: 'Berry Bushes',     icon: '🫐', desc: 'Dense bushes heavy with ripe berries.' },
        mushroom_ring:{ id: 'mushroom_ring',name: 'Mushroom Ring',    icon: '🍄', desc: 'A perfect circle of large mushrooms, tingling with faint magic.' },
    },

    // Map terrain to local palette preferences
    TERRAIN_PALETTE: {
        plains:               ['open', 'open', 'open', 'clearing', 'scrub', 'path'],
        grassland:            ['open', 'open', 'clearing', 'clearing', 'scrub', 'path'],
        forest:               ['thicket', 'thicket', 'thicket', 'clearing', 'path', 'rocky'],
        dense_forest:         ['thicket', 'thicket', 'thicket', 'thicket', 'clearing', 'path'],
        woodland:             ['thicket', 'clearing', 'clearing', 'open', 'path', 'scrub'],
        seasonal_forest:      ['thicket', 'clearing', 'clearing', 'scrub', 'path', 'rocky'],
        boreal_forest:        ['thicket', 'thicket', 'clearing', 'rocky', 'ice_patch', 'path'],
        temperate_rainforest: ['thicket', 'thicket', 'clearing', 'bog', 'stream', 'path'],
        tropical_rainforest:  ['thicket', 'thicket', 'bog', 'stream', 'clearing', 'path'],
        hills:                ['rocky', 'slope', 'clearing', 'scrub', 'open', 'path'],
        mountain:             ['rocky', 'rocky', 'slope', 'slope', 'clearing', 'path'],
        snow_peak:            ['ice_patch', 'ice_patch', 'rocky', 'slope', 'clearing', 'path'],
        desert:               ['sand', 'sand', 'sand', 'scrub', 'rocky', 'path'],
        savanna:              ['scrub', 'scrub', 'open', 'clearing', 'sand', 'path'],
        tundra:               ['ice_patch', 'scrub', 'rocky', 'open', 'bog', 'path'],
        snow:                 ['ice_patch', 'ice_patch', 'scrub', 'rocky', 'clearing', 'path'],
        ice:                  ['ice_patch', 'ice_patch', 'ice_patch', 'rocky', 'clearing', 'path'],
        swamp:                ['bog', 'bog', 'stream', 'thicket', 'clearing', 'path'],
        beach:                ['sand', 'sand', 'scrub', 'clearing', 'open', 'path'],
        island:               ['sand', 'thicket', 'clearing', 'scrub', 'rocky', 'path'],
        highlands:            ['rocky', 'slope', 'scrub', 'clearing', 'open', 'path'],
        wetland:              ['bog', 'bog', 'stream', 'clearing', 'thicket', 'path'],
        coast:                ['sand', 'scrub', 'rocky', 'clearing', 'open', 'path'],
        // Fallback
        default:              ['open', 'clearing', 'scrub', 'path', 'rocky', 'thicket'],
    },

    // POI pool per terrain type
    TERRAIN_POIS: {
        plains:               ['herb_patch', 'game_trail', 'berry_bushes', 'burial_mound', 'old_shrine'],
        grassland:            ['herb_patch', 'game_trail', 'berry_bushes', 'old_shrine', 'mushroom_ring'],
        forest:               ['herb_patch', 'game_trail', 'cave_mouth', 'mushroom_ring', 'berry_bushes', 'bandit_camp'],
        dense_forest:         ['herb_patch', 'cave_mouth', 'mushroom_ring', 'ancient_stone', 'bandit_camp'],
        woodland:             ['herb_patch', 'game_trail', 'berry_bushes', 'old_shrine', 'mushroom_ring'],
        hills:                ['ore_vein', 'cave_mouth', 'ancient_stone', 'ruined_wall', 'hidden_spring'],
        mountain:             ['ore_vein', 'cave_mouth', 'hidden_spring', 'ancient_stone', 'ruined_wall'],
        desert:               ['ancient_stone', 'burial_mound', 'ruined_wall', 'hidden_spring', 'old_shrine'],
        savanna:              ['game_trail', 'old_shrine', 'burial_mound', 'herb_patch', 'berry_bushes'],
        tundra:               ['ancient_stone', 'cave_mouth', 'ruined_wall', 'game_trail', 'hidden_spring'],
        swamp:                ['mushroom_ring', 'herb_patch', 'ancient_stone', 'burial_mound', 'bandit_camp'],
        beach:                ['hidden_spring', 'ruined_wall', 'old_shrine', 'berry_bushes'],
        highlands:            ['ore_vein', 'ancient_stone', 'cave_mouth', 'ruined_wall', 'game_trail'],
        default:              ['herb_patch', 'game_trail', 'old_shrine', 'ruined_wall', 'hidden_spring'],
    },

    // -----------------------------------------------
    // Seeded pseudo-random (deterministic from tile q,r)
    // -----------------------------------------------
    _seededRand(seed) {
        let s = seed;
        return function () {
            s = (s * 1664525 + 1013904223) & 0xffffffff;
            return (s >>> 0) / 0xffffffff;
        };
    },

    // -----------------------------------------------
    // Generate the local map grid for a world tile
    // -----------------------------------------------
    generateLocalTiles(worldTile) {
        const cols = LocalMap.COLS;
        const rows = LocalMap.ROWS;
        const rand = LocalMap._seededRand(worldTile.q * 99991 + worldTile.r * 6971 + 1337);

        const terrainId = worldTile.terrain ? worldTile.terrain.id : 'plains';
        const palette = LocalMap.TERRAIN_PALETTE[terrainId] || LocalMap.TERRAIN_PALETTE.default;

        const tiles = [];
        for (let r = 0; r < rows; r++) {
            tiles[r] = [];
            for (let q = 0; q < cols; q++) {
                const idx = Math.floor(rand() * palette.length);
                const terrainKey = palette[idx];
                tiles[r][q] = {
                    q, r,
                    terrain: LocalMap.LOCAL_TERRAIN[terrainKey] || LocalMap.LOCAL_TERRAIN.open,
                    poi: null,
                    explored: false,
                };
            }
        }

        // Place a path through the middle row to make it feel like a traversable area
        const midRow = Math.floor(rows / 2);
        for (let q = 0; q < cols; q++) {
            tiles[midRow][q].terrain = LocalMap.LOCAL_TERRAIN.path;
        }

        // Place 2–4 POIs
        const poiPool = LocalMap.TERRAIN_POIS[terrainId] || LocalMap.TERRAIN_POIS.default;
        const poiCount = 2 + Math.floor(rand() * 3);
        const placed = new Set();
        let attempts = 0;
        while (placed.size < poiCount && attempts < 50) {
            attempts++;
            const pq = Math.floor(rand() * cols);
            const pr = Math.floor(rand() * rows);
            const key = `${pq},${pr}`;
            if (!placed.has(key) && tiles[pr][pq].terrain.id !== 'stream') {
                const poiIdx = Math.floor(rand() * poiPool.length);
                const poiId = poiPool[poiIdx];
                const poiDef = LocalMap.POI_TYPES[poiId];
                if (poiDef) {
                    tiles[pr][pq].poi = { ...poiDef };
                    placed.add(key);
                }
            }
        }

        // If the world tile has a resource, place it prominently near center
        if (worldTile.resource) {
            const cq = Math.floor(cols / 2);
            const cr = Math.floor(rows / 2) - 1;
            tiles[cr][cq].poi = {
                id: 'resource_' + worldTile.resource.id,
                name: worldTile.resource.name,
                icon: worldTile.resource.icon,
                desc: `A notable deposit of ${worldTile.resource.name.toLowerCase()} in this area.`,
            };
        }

        // If the world tile has an improvement, place it near center
        if (worldTile.improvement) {
            const iq = Math.floor(cols / 2);
            const ir = Math.floor(rows / 2);
            tiles[ir][iq].poi = {
                id: 'improvement_' + worldTile.improvement.type,
                name: worldTile.improvement.name || worldTile.improvement.type,
                icon: worldTile.improvement.icon || '📍',
                desc: `${worldTile.improvement.name || worldTile.improvement.type} — a notable feature of this tile.`,
            };
        }

        return tiles;
    },

    // -----------------------------------------------
    // Compute pixel center of a local hex cell
    // (pointy-top, offset layout matching main renderer)
    // -----------------------------------------------
    _hexCenter(q, r, hexSize) {
        const hexWidth = Math.sqrt(3) * hexSize;
        const rowHeight = hexWidth * 0.75;
        const offsetX = (r % 2 === 0) ? hexWidth / 2 : 0;
        return {
            x: q * hexWidth + offsetX,
            y: r * rowHeight,
        };
    },

    // -----------------------------------------------
    // Get grid cell from canvas click position
    // -----------------------------------------------
    _cellFromPoint(canvasX, canvasY, hexSize) {
        const hexWidth = Math.sqrt(3) * hexSize;
        const rowHeight = hexWidth * 0.75;

        const approxR = Math.round(canvasY / rowHeight);
        const approxQ = Math.round(canvasX / hexWidth);

        let bestCell = null;
        let minDist = Infinity;

        for (let r = approxR - 1; r <= approxR + 1; r++) {
            for (let q = approxQ - 1; q <= approxQ + 1; q++) {
                if (r < 0 || r >= LocalMap.ROWS || q < 0 || q >= LocalMap.COLS) continue;
                const c = LocalMap._hexCenter(q, r, hexSize);
                const dist = (canvasX - c.x) ** 2 + (canvasY - c.y) ** 2;
                if (dist < minDist) {
                    minDist = dist;
                    bestCell = { q, r };
                }
            }
        }

        return bestCell;
    },

    // -----------------------------------------------
    // Draw the local map on the canvas
    // -----------------------------------------------
    _render() {
        const ctx = LocalMap._ctx;
        const canvas = LocalMap._canvas;
        const size = LocalMap.HEX_SIZE;
        const tiles = LocalMap._tiles;

        if (!ctx || !tiles) return;

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Background
        ctx.fillStyle = '#0a0e17';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        ctx.save();
        ctx.translate(LocalMap._offsetX, LocalMap._offsetY);

        for (let r = 0; r < LocalMap.ROWS; r++) {
            for (let q = 0; q < LocalMap.COLS; q++) {
                const tile = tiles[r][q];
                const { x, y } = LocalMap._hexCenter(q, r, size);
                const corners = LocalMap._hexCorners(x, y, size);

                // Draw hex fill
                ctx.beginPath();
                ctx.moveTo(corners[0].x, corners[0].y);
                for (let i = 1; i < 6; i++) ctx.lineTo(corners[i].x, corners[i].y);
                ctx.closePath();

                // Highlight selected cell
                const isSel = LocalMap._selectedCell &&
                    LocalMap._selectedCell.q === q &&
                    LocalMap._selectedCell.r === r;
                const isHov = LocalMap._hoveredCell &&
                    LocalMap._hoveredCell.q === q &&
                    LocalMap._hoveredCell.r === r;

                ctx.fillStyle = tile.terrain.color;
                ctx.fill();

                if (isSel) {
                    ctx.fillStyle = 'rgba(245, 197, 66, 0.35)';
                    ctx.fill();
                } else if (isHov) {
                    ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
                    ctx.fill();
                }

                // Hex border
                ctx.strokeStyle = 'rgba(255,255,255,0.1)';
                ctx.lineWidth = 0.8;
                ctx.stroke();

                // Draw POI icon
                if (tile.poi) {
                    ctx.font = `${size * 0.55}px serif`;
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText(tile.poi.icon, x, y);
                }
            }
        }

        ctx.restore();
    },

    // -----------------------------------------------
    // Compute 6 corners of a pointy-top hex
    // -----------------------------------------------
    _hexCorners(cx, cy, size) {
        const corners = [];
        for (let i = 0; i < 6; i++) {
            const angle = Math.PI / 180 * (60 * i - 30);
            corners.push({
                x: cx + size * Math.cos(angle),
                y: cy + size * Math.sin(angle),
            });
        }
        return corners;
    },

    // -----------------------------------------------
    // Open the local map overlay
    // -----------------------------------------------
    open(game, worldTile) {
        LocalMap._worldTile = worldTile;
        LocalMap._tiles = LocalMap.generateLocalTiles(worldTile);
        LocalMap._selectedCell = null;
        LocalMap._hoveredCell = null;

        const overlay = document.getElementById('localMapOverlay');
        const titleEl = document.getElementById('localMapTitle');
        const infoEl = document.getElementById('localMapInfo');

        if (!overlay) return;

        // Set title — coordinates are offset (col, row) matching the world map grid
        const terrainName = worldTile.terrain ? worldTile.terrain.name : 'Unknown';
        const icon = worldTile.terrain ? worldTile.terrain.icon : '🗺️';
        titleEl.textContent = `${icon} Exploring: ${terrainName} (${worldTile.q}, ${worldTile.r})`;

        infoEl.innerHTML = '<span style="color:var(--text-secondary)">Click a hex to inspect it.</span>';

        // Setup canvas
        const canvas = document.getElementById('localMapCanvas');
        LocalMap._canvas = canvas;
        LocalMap._ctx = canvas.getContext('2d');

        // Size the canvas to fit the grid
        const size = LocalMap.HEX_SIZE;
        const hexWidth = Math.sqrt(3) * size;
        const rowHeight = hexWidth * 0.75;
        const gridW = (LocalMap.COLS + 0.5) * hexWidth;
        const gridH = (LocalMap.ROWS - 1) * rowHeight + 2 * size;

        // Fit within the modal (max 680 × 420)
        const maxW = 680;
        const maxH = 420;
        const scale = Math.min(maxW / gridW, maxH / gridH, 1);
        const displayW = Math.round(gridW * scale);
        const displayH = Math.round(gridH * scale);

        canvas.width = displayW;
        canvas.height = displayH;
        canvas.style.width = displayW + 'px';
        canvas.style.height = displayH + 'px';

        // Center the hex grid on the canvas
        LocalMap._offsetX = (displayW - gridW * scale) / 2 + (scale * hexWidth * 0.5);
        LocalMap._offsetY = (displayH - gridH * scale) / 2 + size * scale;

        // Scale context
        LocalMap._ctx.setTransform(scale, 0, 0, scale, 0, 0);

        // Input handlers
        LocalMap._boundMouseMove = (e) => {
            const rect = canvas.getBoundingClientRect();
            const cx = (e.clientX - rect.left) / scale - LocalMap._offsetX / scale;
            const cy = (e.clientY - rect.top) / scale - LocalMap._offsetY / scale;
            LocalMap._hoveredCell = LocalMap._cellFromPoint(cx, cy, size);
            LocalMap._render();
        };

        LocalMap._boundMouseClick = (e) => {
            const rect = canvas.getBoundingClientRect();
            const cx = (e.clientX - rect.left) / scale - LocalMap._offsetX / scale;
            const cy = (e.clientY - rect.top) / scale - LocalMap._offsetY / scale;
            const cell = LocalMap._cellFromPoint(cx, cy, size);
            if (cell) {
                LocalMap._selectedCell = cell;
                LocalMap._showCellInfo(cell, infoEl);
                LocalMap._render();
            }
        };

        canvas.addEventListener('mousemove', LocalMap._boundMouseMove);
        canvas.addEventListener('click', LocalMap._boundMouseClick);

        // Show overlay
        overlay.classList.remove('hidden');
        LocalMap._render();
    },

    // -----------------------------------------------
    // Show info for a selected local map cell
    // -----------------------------------------------
    _showCellInfo(cell, infoEl) {
        const tile = LocalMap._tiles[cell.r][cell.q];
        if (!tile) return;

        let html = `<span style="color:var(--gold); font-weight:600">${tile.terrain.icon} ${tile.terrain.name}</span>`;

        if (tile.poi) {
            html += ` &nbsp;·&nbsp; <span style="color:var(--text-primary)">${tile.poi.icon} <b>${tile.poi.name}</b></span>`;
            html += `<br><span style="color:var(--text-secondary); font-size:12px">${tile.poi.desc}</span>`;
        } else {
            html += `<br><span style="color:var(--text-secondary); font-size:12px">${tile.terrain.passable ? 'Passable ground.' : 'Impassable.'}</span>`;
        }

        infoEl.innerHTML = html;
    },

    // -----------------------------------------------
    // Close the local map overlay
    // -----------------------------------------------
    close() {
        const overlay = document.getElementById('localMapOverlay');
        if (overlay) overlay.classList.add('hidden');

        const canvas = document.getElementById('localMapCanvas');
        if (canvas) {
            if (LocalMap._boundMouseMove) canvas.removeEventListener('mousemove', LocalMap._boundMouseMove);
            if (LocalMap._boundMouseClick) canvas.removeEventListener('click', LocalMap._boundMouseClick);
        }

        LocalMap._worldTile = null;
        LocalMap._tiles = null;
        LocalMap._hoveredCell = null;
        LocalMap._selectedCell = null;
    },
};
