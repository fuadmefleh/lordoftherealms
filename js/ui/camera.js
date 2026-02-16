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

        // Dragging state
        this.isDragging = false;
        this.dragStartX = 0;
        this.dragStartY = 0;
        this.dragCamStartX = 0;
        this.dragCamStartY = 0;

        // World bounds (set after world generation)
        this.worldPixelWidth = 0;
        this.worldPixelHeight = 0;

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
            const zoomDelta = e.deltaY > 0 ? -0.1 : 0.1;
            this.targetZoom = Utils.clamp(this.targetZoom + zoomDelta, this.minZoom, this.maxZoom);
        }, { passive: false });

        // Mouse drag for panning
        canvas.addEventListener('mousedown', (e) => {
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
        // Keyboard panning
        const panSpeed = 400 / this.zoom;
        if (this.keys['ArrowLeft'] || this.keys['a']) this.targetX -= panSpeed * deltaTime;
        if (this.keys['ArrowRight'] || this.keys['d']) this.targetX += panSpeed * deltaTime;
        if (this.keys['ArrowUp'] || this.keys['w']) this.targetY -= panSpeed * deltaTime;
        if (this.keys['ArrowDown'] || this.keys['s']) this.targetY += panSpeed * deltaTime;

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
     * Convert screen coords to world coords
     */
    screenToWorld(screenX, screenY) {
        const cx = this.canvas.width / 2;
        const cy = this.canvas.height / 2;
        const worldX = (screenX - cx) / this.zoom + this.x;
        const worldY = (screenY - cy) / this.zoom + this.y;
        return { x: worldX, y: worldY };
    }

    /**
     * Convert world coords to screen coords
     */
    worldToScreen(worldX, worldY) {
        const cx = this.canvas.width / 2;
        const cy = this.canvas.height / 2;

        // Handle wrapping — find the closest wrapped version
        let dx = worldX - this.x;
        if (this.worldPixelWidth > 0) {
            if (dx > this.worldPixelWidth / 2) dx -= this.worldPixelWidth;
            if (dx < -this.worldPixelWidth / 2) dx += this.worldPixelWidth;
        }

        const screenX = cx + dx * this.zoom;
        const screenY = cy + (worldY - this.y) * this.zoom;
        return { x: screenX, y: screenY };
    }

    /**
     * Get visible world bounds
     */
    getVisibleBounds() {
        const halfW = (this.canvas.width / 2) / this.zoom;
        const halfH = (this.canvas.height / 2) / this.zoom;
        return {
            left: this.x - halfW,
            right: this.x + halfW,
            top: this.y - halfH,
            bottom: this.y + halfH,
            width: halfW * 2,
            height: halfH * 2
        };
    }
}
