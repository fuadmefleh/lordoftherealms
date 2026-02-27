// ============================================
// CAMERA — Camera/viewport management
// ============================================

class Camera {
    constructor(canvas) {
        this.canvas = canvas;
        this.x = 0;        // World-space center X
        this.y = 0;        // World-space center Y
        this.zoom = 1.0;
        this.minZoom = 0.55;
        this.maxZoom = 1.5;
        this.targetZoom = 1.0;

        // Smooth camera movement
        this.targetX = 0;
        this.targetY = 0;
        this.smoothSpeed = 6;
        this.panSpeedBase = 400;   // Configurable via settings
        this.zoomStep = 0.1;       // Configurable via settings

        // Dragging state
        this.isDragging = false;
        this.dragStartX = 0;
        this.dragStartY = 0;
        this.dragCamStartX = 0;
        this.dragCamStartY = 0;

        // World bounds (set after world generation)
        this.worldPixelWidth = 0;
        this.worldPixelHeight = 0;

        // Lock mode — when true, disables keyboard panning and drag panning
        // Camera can only move via follow() / centerOn() calls
        this.locked = false;

        // ── Performance: reusable point objects to avoid per-call allocations ──
        this._screenPt = { x: 0, y: 0 };
        this._worldPt  = { x: 0, y: 0 };
        this._boundsPt = { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 };

        // ── Pre-computed per-frame camera constants ──
        this._cx = 0;
        this._cy = 0;
        this._invZoom = 1;

        this.setupControls();
    }

    /**
     * Set world bounds for wrapping
     */
    setWorldBounds(width, height) {
        this.worldPixelWidth = width;
        this.worldPixelHeight = height;
    }

    /**
     * Setup mouse/touch controls
     */
    setupControls() {
        const canvas = this.canvas;

        // Mouse wheel zoom
        canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            const zoomDelta = e.deltaY > 0 ? -(this.zoomStep || 0.1) : (this.zoomStep || 0.1);
            this.targetZoom = Utils.clamp(this.targetZoom + zoomDelta, this.minZoom, this.maxZoom);
        }, { passive: false });

        // Mouse drag for panning (disabled when camera is locked)
        canvas.addEventListener('mousedown', (e) => {
            if (this.locked) return; // Camera locked to player
            if (e.button === 1 || e.button === 2 || (e.button === 0 && e.shiftKey)) {
                // Middle click, right click, or shift+left click to drag
                this.isDragging = true;
                this.dragStartX = e.clientX;
                this.dragStartY = e.clientY;
                this.dragCamStartX = this.targetX;
                this.dragCamStartY = this.targetY;
                canvas.style.cursor = 'grabbing';
                e.preventDefault();
            }
        });

        window.addEventListener('mousemove', (e) => {
            if (this.isDragging) {
                const dx = (e.clientX - this.dragStartX) / this.zoom;
                const dy = (e.clientY - this.dragStartY) / this.zoom;
                this.targetX = this.dragCamStartX - dx;
                this.targetY = this.dragCamStartY - dy;

                // Clamp vertical
                this.targetY = Utils.clamp(this.targetY, -100, this.worldPixelHeight + 100);
            }
        });

        window.addEventListener('mouseup', (e) => {
            if (this.isDragging) {
                this.isDragging = false;
                canvas.style.cursor = 'default';
            }
        });

        // Prevent context menu
        canvas.addEventListener('contextmenu', (e) => e.preventDefault());

        // Keyboard controls
        this.keys = {};
        window.addEventListener('keydown', (e) => { this.keys[e.key] = true; });
        window.addEventListener('keyup', (e) => { this.keys[e.key] = false; });
    }

    /**
     * Center camera on a world position
     */
    centerOn(worldX, worldY) {
        this.targetX = worldX;
        this.targetY = worldY;
        this.x = worldX;
        this.y = worldY;
    }

    /**
     * Smoothly follow a target position
     */
    follow(worldX, worldY) {
        this.targetX = worldX;
        this.targetY = worldY;
    }

    /**
     * Update camera (call each frame)
     */
    update(deltaTime) {
        // Keyboard panning (disabled when camera is locked)
        if (!this.locked) {
            const panSpeed = (this.panSpeedBase || 400) / this.zoom;
            if (this.keys['ArrowLeft'] || this.keys['a']) this.targetX -= panSpeed * deltaTime;
            if (this.keys['ArrowRight'] || this.keys['d']) this.targetX += panSpeed * deltaTime;
            if (this.keys['ArrowUp'] || this.keys['w']) this.targetY -= panSpeed * deltaTime;
            if (this.keys['ArrowDown'] || this.keys['s']) this.targetY += panSpeed * deltaTime;
        }

        // Keyboard zoom
        if (this.keys['+'] || this.keys['=']) this.targetZoom = Utils.clamp(this.targetZoom + 1.5 * deltaTime, this.minZoom, this.maxZoom);
        if (this.keys['-'] || this.keys['_']) this.targetZoom = Utils.clamp(this.targetZoom - 1.5 * deltaTime, this.minZoom, this.maxZoom);

        // Smooth interpolation
        const t = 1 - Math.exp(-this.smoothSpeed * deltaTime);
        this.x = Utils.lerp(this.x, this.targetX, t);
        this.y = Utils.lerp(this.y, this.targetY, t);
        this.zoom = Utils.lerp(this.zoom, this.targetZoom, t);

        // Wrap camera X
        if (this.worldPixelWidth > 0) {
            this.targetX = ((this.targetX % this.worldPixelWidth) + this.worldPixelWidth) % this.worldPixelWidth;
            this.x = ((this.x % this.worldPixelWidth) + this.worldPixelWidth) % this.worldPixelWidth;
        }

        // Clamp Y
        this.y = Utils.clamp(this.y, -100, this.worldPixelHeight + 100);
        this.targetY = Utils.clamp(this.targetY, -100, this.worldPixelHeight + 100);
    }

    /**
     * Pre-compute constants at the start of each frame.
     * Call once per frame before any worldToScreen / getVisibleBounds calls.
     */
    precomputeFrame() {
        this._cx = this.canvas.width / 2;
        this._cy = this.canvas.height / 2;
        this._invZoom = 1 / this.zoom;
    }

    /**
     * Convert screen coords to world coords
     */
    screenToWorld(screenX, screenY) {
        const worldX = (screenX - this._cx) * this._invZoom + this.x;
        const worldY = (screenY - this._cy) * this._invZoom + this.y;
        return { x: worldX, y: worldY };
    }

    /**
     * Convert world coords to screen coords.
     * Returns a NEW object (safe to store). For hot-path loops use worldToScreenFast().
     */
    worldToScreen(worldX, worldY) {
        let dx = worldX - this.x;
        if (this.worldPixelWidth > 0) {
            if (dx > this.worldPixelWidth / 2) dx -= this.worldPixelWidth;
            if (dx < -this.worldPixelWidth / 2) dx += this.worldPixelWidth;
        }
        return {
            x: this._cx + dx * this.zoom,
            y: this._cy + (worldY - this.y) * this.zoom
        };
    }

    /**
     * Convert world coords to screen coords — FAST version.
     * Reuses an internal point object. The returned reference is ONLY valid
     * until the next call to worldToScreenFast. Use for immediate consumption
     * in tight tile-rendering loops to avoid GC pressure.
     */
    worldToScreenFast(worldX, worldY) {
        let dx = worldX - this.x;
        if (this.worldPixelWidth > 0) {
            if (dx > this.worldPixelWidth / 2) dx -= this.worldPixelWidth;
            if (dx < -this.worldPixelWidth / 2) dx += this.worldPixelWidth;
        }
        this._screenPt.x = this._cx + dx * this.zoom;
        this._screenPt.y = this._cy + (worldY - this.y) * this.zoom;
        return this._screenPt;
    }

    /**
     * Get visible world bounds (reuses internal object — don't store the reference)
     */
    getVisibleBounds() {
        const halfW = this._cx * this._invZoom;
        const halfH = this._cy * this._invZoom;
        const b = this._boundsPt;
        b.left   = this.x - halfW;
        b.right  = this.x + halfW;
        b.top    = this.y - halfH;
        b.bottom = this.y + halfH;
        b.width  = halfW * 2;
        b.height = halfH * 2;
        return b;
    }
}
