/*
    Vics Tower Defense - Game.js Revision 3 (Patched for AI Enhanced UI)
    - Implemented Castle with HP and collision detection.
    - Player tower moved to a fixed defensive position.
    - Added randomized enemy path generation for each wave.
    - Corrected wave completion logic.
    - UI elements updated to match AI-enhanced CSS.
    - Added visual enhancements to drawing for entities.
*/

// ---------------------------- Configuration ----------------------------
const TD_CONFIG = {
    canvasId: 'gameCanvas',
    baseGoldPerEnemy: 15,
    waveStartDelay: 2000,
    spawnInterval: 600,
};

const MAXS = {
    TOWER_DAMAGE: 10000,
    TOWER_RANGE: 900,
    TOWER_FIRE_RATE: 50,
    CRIT_CHANCE: 90,
    CASTLE_HP: 1000,
};

const UPGRADE_COST_MULT = 1.15;

// ---------------------------- Canvas & Context Setup ----------------------------
let canvas = null;
let ctx = null;
let canvasWidth = 0;
let canvasHeight = 0;

function setupCanvas() {
    canvas = document.getElementById(TD_CONFIG.canvasId);
    ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    canvasWidth = rect.width;
    canvasHeight = rect.height;

    // IMPORTANT: Set font styles for canvas drawing here to match new UI fonts
    // Floating texts
    ctx.font = 'bold 16px "Orbitron", sans-serif'; // Default for floating texts
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle'; // Center text vertically
}

// ---------------------------- Game Path Generation ----------------------------
const gamePath = [];
const pathPresets = [
    // Path 1 (Original S-Curve)
    (w, h) => [{ x: w * 0.7, y: -50 }, { x: w * 0.7, y: h * 0.2 }, { x: w * 0.3, y: h * 0.4 }, { x: w * 0.3, y: h * 0.6 }, { x: w * 0.8, y: h * 0.8 }, { x: w * 0.8, y: h * 0.95 }],
    // Path 2 (Center Zig-Zag)
    (w, h) => [{ x: w * 0.5, y: -50 }, { x: w * 0.5, y: h * 0.1 }, { x: w * 0.2, y: h * 0.3 }, { x: w * 0.8, y: h * 0.5 }, { x: w * 0.2, y: h * 0.7 }, { x: w * 0.5, y: h * 0.95 }],
    // Path 3 (Left-Side Heavy)
    (w, h) => [{ x: w * 0.2, y: -50 }, { x: w * 0.2, y: h * 0.4 }, { x: w * 0.6, y: h * 0.5 }, { x: w * 0.6, y: h * 0.8 }, { x: w * 0.4, y: h * 0.95 }],
    // Path 4 (Right-Side Heavy)
    (w, h) => [{ x: w * 0.9, y: -50 }, { x: w * 0.9, y: h * 0.3 }, { x: w * 0.3, y: h * 0.4 }, { x: w * 0.3, y: h * 0.7 }, { x: w * 0.6, y: h * 0.95 }],
];
let currentPathIndex = 0;

function generateNewPath() {
    gamePath.length = 0;
    currentPathIndex = Math.floor(Math.random() * pathPresets.length);
    const generatedPoints = pathPresets[currentPathIndex](canvasWidth, canvasHeight);
    gamePath.push(...generatedPoints);
}


// ---------------------------- Core Game State ----------------------------
const TDState = {
    running: false,
    gameOver: false,
    lastTime: 0,
    gold: 100,
    wave: 0,
    enemiesKilled: 0,
    enemies: [],
    projectiles: [],
    floatingTexts: [],
    tower: null,
    castle: null,
    waveManager: null,
};

// ---------------------------- Utility Functions & Text Pool ----------------------------
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function now() { return performance.now(); }
const floatingTextPool = {
    pool: [],
    get(text, x, y, color = 'white', ttl = 1000, font = 'bold 16px "Orbitron", sans-serif') { // Added font parameter
        let obj = this.pool.length > 0 ? this.pool.pop() : {};
        obj.text = text; obj.x = x; obj.y = y; obj.color = color; obj.ttl = ttl;
        obj.spawnTime = now();
        obj.font = font; // Store font with the object
        TDState.floatingTexts.push(obj);
    },
    release(obj) { this.pool.push(obj); }
};

// ---------------------------- Castle Class ----------------------------
class Castle {
    constructor() {
        this.hp = MAXS.CASTLE_HP;
        this.maxHp = MAXS.CASTLE_HP;
        // Position the castle at the bottom edge of the *canvas*
        // The UI handles its own positioning on top of this.
        this.x = 0;
        this.y = canvasHeight - 50; // Give it a fixed height from the bottom of the canvas
        this.width = canvasWidth;
        this.height = 50; // Visual height for the canvas element
    }
    takeDamage(amount) {
        this.hp = Math.max(0, this.hp - amount);
        // Using `calc(canvasWidth / 2)` for floating text position for visual consistency.
        floatingTextPool.get(`-${amount}`, canvasWidth / 2, this.y + this.height / 2, '#ef5350', 1200, 'bold 24px "Orbitron", sans-serif'); // Brighter red, larger font
        if (this.hp <= 0) {
            TDState.gameOver = true;
            TDState.running = false;
            floatingTextPool.get('GAME OVER', canvasWidth / 2, canvasHeight / 2, '#ef5350', 5000, 'bold 48px "Bangers", cursive'); // More impactful game over
        }
        updateUI();
    }
    draw(ctx) {
        // The castle itself isn't drawn here; it's represented by the bottom area
        // and the HP bar. We might draw a symbolic base if needed, but for now
        // it's abstract.
        // ctx.fillStyle = '#2c3a58'; // panel-bg
        // ctx.fillRect(this.x, this.y, this.width, this.height);
        // ctx.strokeStyle = '#232d43'; // panel-border
        // ctx.lineWidth = 2;
        // ctx.strokeRect(this.x, this.y, this.width, this.height);
    }
}


// ---------------------------- Enemy Class ----------------------------
class Enemy {
    constructor() { this.reset(); }
    reset() {
        this.active = false;
        this.x = 0; this.y = 0;
        this.hp = 1; this.maxHp = 1;
        this.speed = 20;
        this.reward = 5;
        this.size = 20;
        this.pathIndex = 0;
        this.color = '#c75869'; // Default slime color
    }
    init(template) {
        this.active = true;
        this.x = gamePath[0].x;
        this.y = gamePath[0].y;
        this.hp = template.hp; this.maxHp = template.hp;
        this.speed = template.speed;
        this.reward = template.reward;
        this.pathIndex = 1;
        // Randomize enemy color slightly
        const hue = Math.floor(Math.random() * 60) + 330; // Red-pinkish hues
        const saturation = Math.floor(Math.random() * 30) + 70; // 70-100%
        const lightness = Math.floor(Math.random() * 10) + 50; // 50-60%
        this.color = `hsl(${hue}, ${saturation}%, ${lightness}%)`;
    }
    update(dt) {
        if (!this.active) return;
        
        if (this.pathIndex >= gamePath.length) {
            this.reachEnd();
            return;
        }

        const target = gamePath[this.pathIndex];
        const dx = target.x - this.x;
        const dy = target.y - this.y;
        const dist = Math.hypot(dx, dy);

        if (dist < 1) { // Close enough to next point
            this.pathIndex++;
        } else {
            this.x += (dx / dist) * this.speed * dt;
            this.y += (dy / dist) * this.speed * dt;
        }
    }
    draw(ctx) {
        ctx.save();
        ctx.translate(this.x, this.y);

        // Slime body with blob effect (simple arc for now)
        ctx.fillStyle = this.color;
        ctx.beginPath();
        ctx.arc(0, 0, this.size / 2, 0, Math.PI * 2);
        ctx.fill();

        // Eyes
        ctx.fillStyle = 'white';
        ctx.beginPath();
        ctx.arc(-this.size / 4, -this.size / 4, this.size / 8, 0, Math.PI * 2);
        ctx.arc(this.size / 4, -this.size / 4, this.size / 8, 0, Math.PI * 2);
        ctx.fill();
        // Pupils
        ctx.fillStyle = 'black';
        ctx.beginPath();
        ctx.arc(-this.size / 4, -this.size / 4, this.size / 16, 0, Math.PI * 2);
        ctx.arc(this.size / 4, -this.size / 4, this.size / 16, 0, Math.PI * 2);
        ctx.fill();

        // HP Bar above enemy
        const hpPct = this.hp / this.maxHp;
        const hpBarWidth = this.size + 10;
        const hpBarHeight = 5;
        const hpBarYOffset = -this.size / 2 - 10;

        ctx.fillStyle = 'rgba(0,0,0,0.5)'; // Dark background for HP bar
        ctx.fillRect(-hpBarWidth / 2, hpBarYOffset, hpBarWidth, hpBarHeight);
        
        // HP bar gradient
        const gradient = ctx.createLinearGradient(-hpBarWidth / 2, 0, hpBarWidth / 2, 0);
        gradient.addColorStop(0, '#ef5350'); // Red for low HP
        gradient.addColorStop(0.5, '#ffeb3b'); // Yellow for mid HP
        gradient.addColorStop(1, '#4caf50'); // Green for high HP
        
        ctx.fillStyle = gradient;
        ctx.fillRect(-hpBarWidth / 2, hpBarYOffset, hpBarWidth * hpPct, hpBarHeight);

        ctx.restore();
    }
    takeDamage(dmg) {
        this.hp -= dmg;
        if (this.hp <= 0) {
            this.die();
            return true;
        }
        return false;
    }
    die() {
        this.active = false;
        TDState.enemiesKilled++;
        TDState.gold += this.reward;
        floatingTextPool.get(`+${this.reward}`, this.x, this.y, '#ffeb3b'); // Accent gold
        // Release the enemy back to a pool for reuse if you have one
    }
    reachEnd() {
        this.active = false;
        TDState.castle.takeDamage(10); // Each enemy deals 10 damage
        // Release the enemy back to a pool
    }
}

// ---------------------------- Projectile & Tower Classes (largely unchanged) ----------------------------
class Projectile {
    constructor() { this.active = false; }
    init(x, y, target, damage, isCrit = false) { // Added isCrit flag
        this.active = true;
        this.x = x; this.y = y;
        this.target = target;
        this.damage = damage;
        this.speed = 400;
        this.spawnTime = now();
        this.isCrit = isCrit; // Store if it's a critical hit
    }
    update(dt) {
        if (!this.active || !this.target.active || now() - this.spawnTime > 3000) {
            this.active = false;
            return;
        }
        const dx = this.target.x - this.x;
        const dy = this.target.y - this.y;
        const dist = Math.hypot(dx, dy);
        if (dist < 10) {
            this.target.takeDamage(this.damage);
            this.active = false;
        } else {
            this.x += (dx / dist) * this.speed * dt;
            this.y += (dy / dist) * this.speed * dt;
        }
    }
    draw(ctx) {
        ctx.save();
        ctx.translate(this.x, this.y);

        // Projectile glow effect
        const baseColor = this.isCrit ? '#ffeb3b' : '#e0e0ff'; // Gold for crit, light blue for normal
        ctx.shadowColor = baseColor;
        ctx.shadowBlur = this.isCrit ? 15 : 8; // More blur for crit

        ctx.fillStyle = baseColor;
        ctx.beginPath();
        ctx.arc(0, 0, this.isCrit ? 6 : 4, 0, Math.PI * 2); // Larger for crit
        ctx.fill();

        ctx.restore();
    }
}

class Tower {
    constructor() {
        this.x = canvasWidth / 2;
        this.y = canvasHeight * 0.9; // Positioned in front of the castle
        this.damage = 25;
        this.range = 180;
        this.fireRate = 1.2;
        this.crit = 5;
        this.lastShot = 0;
        this.muzzleFlash = 0; // Timer for muzzle flash effect
    }
    findTarget() {
        let best = null;
        let bestDist = Infinity;
        for (const e of TDState.enemies) {
            if (!e.active) continue;
            const d = Math.hypot(e.x - this.x, e.y - this.y);
            if (d <= this.range && d < bestDist) {
                best = e;
                bestDist = d;
            }
        }
        return best;
    }
    shootAt(target) {
        if (!target || now() - this.lastShot < 1000 / this.fireRate) return;
        this.lastShot = now();
        this.muzzleFlash = 100; // Reset muzzle flash duration

        const crit = Math.random() * 100 < this.crit;
        const damage = this.damage * (crit ? 2.5 : 1.0);
        
        let p = TDState.projectiles.find(pr => !pr.active) || new Projectile();
        if (!TDState.projectiles.includes(p)) TDState.projectiles.push(p);
        p.init(this.x, this.y - 20, target, damage, crit); // Pass crit status to projectile

        const color = crit ? '#ffeb3b' : '#e0e0ff'; // Gold for crit, light blue for normal
        const font = crit ? 'bold 20px "Press Start 2P", cursive' : 'bold 16px "Orbitron", sans-serif'; // Larger, more impactful font for crits
        floatingTextPool.get(`-${Math.round(damage)}`, target.x, target.y - 10, color, 600, font);
    }
    upgrade(stat) {
        if (!UpgradeManager.canAffordUpgrade(stat)) {
            // Provide feedback if cannot afford
            floatingTextPool.get('Not enough gold!', canvasWidth / 2, canvasHeight - 100, '#ef5350', 1000);
            return;
        }
        UpgradeManager.payForUpgrade(stat);
        let upgradeValue = 0;
        switch(stat) {
            case 'damage':
                this.damage = Math.min(MAXS.TOWER_DAMAGE, this.damage + 6);
                upgradeValue = `+6 DMG`;
                break;
            case 'range':
                this.range = Math.min(MAXS.TOWER_RANGE, this.range + 10);
                upgradeValue = `+10 RNG`;
                break;
            case 'fireRate':
                this.fireRate = Math.min(MAXS.TOWER_FIRE_RATE, this.fireRate + 0.1);
                upgradeValue = `+0.1 SPD`;
                break;
            case 'crit':
                this.crit = Math.min(MAXS.CRIT_CHANCE, this.crit + 1);
                upgradeValue = `+1% CRIT`;
                break;
        }
        // Show upgrade text feedback
        floatingTextPool.get(upgradeValue, this.x, this.y - 50, '#4caf50', 800);
        updateUI();
    }
    draw(ctx) {
        ctx.save();
        ctx.translate(this.x, this.y);

        // Range indicator (subtle glow)
        ctx.fillStyle = "rgba(135, 153, 194, 0.05)"; // Very light fill
        ctx.strokeStyle = "rgba(135, 153, 194, 0.2)"; // Light stroke
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(0, 0, this.range, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        // Tower Base (more metallic/techy)
        ctx.fillStyle = '#4f4f8a'; // Panel border color for base
        ctx.beginPath();
        ctx.arc(0, 0, 35, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#6a6ac2';
        ctx.lineWidth = 3;
        ctx.stroke();

        // Tower Body (main component)
        ctx.fillStyle = '#3a3a60'; // Panel bg light
        ctx.beginPath();
        ctx.roundRect(-20, -40, 40, 60, 10); // Rounded rectangle
        ctx.fill();
        ctx.strokeStyle = '#4f4f8a';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Tower Top/Gun barrel
        ctx.fillStyle = '#1e1e3b'; // Panel bg dark
        ctx.beginPath();
        ctx.roundRect(-10, -55, 20, 20, 5);
        ctx.fill();
        ctx.strokeStyle = '#4f4f8a';
        ctx.lineWidth = 1;
        ctx.stroke();

        // Muzzle Flash
        if (this.muzzleFlash > 0) {
            ctx.fillStyle = `rgba(255, 235, 59, ${this.muzzleFlash/100})`; // Bright gold flash
            ctx.beginPath();
            ctx.arc(0, -55, 15 * (this.muzzleFlash / 100), 0, Math.PI * 2); // Dynamic size
            ctx.fill();
            ctx.shadowColor = `rgba(255, 235, 59, ${this.muzzleFlash/100})`;
            ctx.shadowBlur = 20;
        }
        
        ctx.restore(); // Restore context to remove shadow blur for other elements
    }
}

// ---------------------------- Upgrade Manager ----------------------------
const UpgradeManager = {
    costs: { damage: 50, range: 60, fireRate: 80, crit: 120 },
    levels: { damage: 0, range: 0, fireRate: 0, crit: 0 },
    baseCosts: {},
    init() { this.baseCosts = { ...this.costs }; },
    getCost(stat) {
        const lvl = this.levels[stat];
        const base = this.baseCosts[stat];
        return Math.ceil(base * Math.pow(UPGRADE_COST_MULT, lvl));
    },
    canAffordUpgrade(stat) { return TDState.gold >= this.getCost(stat); },
    payForUpgrade(stat) {
        TDState.gold -= this.getCost(stat);
        this.levels[stat]++;
    }
};

// ---------------------------- Wave Manager ----------------------------
class WaveManager {
    constructor() { this.reset(); }
    reset() {
        this.wave = 0;
        this.spawning = false;
        this.enemiesToSpawn = 0;
        this.spawned = 0;
        this.spawnTimer = 0;
    }
    startNextWave() {
        if (this.spawning) return;
        generateNewPath(); // Generate a new path for the new wave
        this.wave++;
        TDState.wave = this.wave;
        this.enemiesToSpawn = 8 + this.wave * 2;
        this.spawned = 0;
        this.spawnTimer = 0;
        this.spawning = true;
        floatingTextPool.get(`Wave ${this.wave} Incoming!`, canvasWidth / 2, canvasHeight * 0.4, '#e0e0ff', 2000, 'bold 32px "Bangers", cursive'); // More prominent wave text
        updateUI(); // Update UI immediately when wave starts
    }
    update(dt) {
        if (!this.spawning) return;
        const interval = Math.max(100, TD_CONFIG.spawnInterval - this.wave * 5);
        this.spawnTimer += dt * 1000;
        if (this.spawnTimer > interval && this.spawned < this.enemiesToSpawn) {
            this.spawnTimer = 0;
            this.spawned++;
            let e = TDState.enemies.find(en => !en.active) || new Enemy();
            if (!TDState.enemies.includes(e)) TDState.enemies.push(e);
            e.init({
                hp: 30 * (1 + this.wave * 0.1),
                speed: 40 + this.wave * 0.5,
                reward: 5 + Math.floor(this.wave / 5),
            });
        }
        // Wave completion check
        // Ensure all *active* enemies are accounted for
        const activeEnemiesCount = TDState.enemies.filter(e => e.active).length;
        if (this.spawned >= this.enemiesToSpawn && activeEnemiesCount === 0) {
            this.spawning = false;
            const bonus = 10 * this.wave;
            TDState.gold += bonus;
            floatingTextPool.get(`Wave Cleared! +${bonus} Gold!`, canvasWidth / 2, canvasHeight * 0.4, '#ffeb3b', 2000, 'bold 28px "Bangers", cursive'); // Prominent bonus text
            updateUI(); // Update UI for new gold
            setTimeout(() => this.startNextWave(), TD_CONFIG.waveStartDelay); // Use configured delay
        }
    }
}

// ---------------------------- Main Game Loop ----------------------------
let animationFrameId = null;

function gameLoop(timestamp) {
    if (!TDState.running || TDState.gameOver) { // Check gameOver here too
        if (TDState.gameOver) {
            // Optional: Show a "Restart" button or final score screen here
        }
        return;
    }
    const dt = (timestamp - TDState.lastTime) / 1000;
    TDState.lastTime = timestamp;
    update(clamp(dt, 0.01, 0.1));
    draw();
    animationFrameId = requestAnimationFrame(gameLoop);
}

function update(dt) {
    TDState.waveManager.update(dt);
    TDState.enemies.forEach(e => e.update(dt));
    TDState.projectiles.forEach(p => p.update(dt));
    const target = TDState.tower.findTarget();
    TDState.tower.shootAt(target);
    if(TDState.tower.muzzleFlash > 0) TDState.tower.muzzleFlash -= dt * 1000; // Decay muzzle flash
    TDState.floatingTexts = TDState.floatingTexts.filter(ft => {
        ft.y -= 30 * dt; // Faster vertical movement for visual pop
        const alive = now() - ft.spawnTime < ft.ttl;
        if (!alive) floatingTextPool.release(ft);
        return alive;
    });
    updateUI(); // Call updateUI once per frame
}

function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw Path (more visually distinct)
    if (gamePath.length > 0) {
        ctx.strokeStyle = "rgba(79, 79, 138, 0.4)"; // var(--panel-border) with transparency
        ctx.lineWidth = 50;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(gamePath[0].x, gamePath[0].y);
        for (let i = 1; i < gamePath.length; i++) {
            ctx.lineTo(gamePath[i].x, gamePath[i].y);
        }
        ctx.stroke();

        // Inner path for visual detail
        ctx.strokeStyle = "rgba(255, 255, 255, 0.1)"; // Lighter inner line
        ctx.lineWidth = 2;
        ctx.stroke();
    }
    
    // Draw Objects
    TDState.castle.draw(ctx); // Still call, even if it does nothing visible here
    TDState.tower.draw(ctx);
    TDState.enemies.forEach(e => { if (e.active) e.draw(ctx); });
    TDState.projectiles.forEach(p => { if (p.active) p.draw(ctx); });
    
    // Draw Floating Texts
    TDState.floatingTexts.forEach(ft => {
        ctx.font = ft.font; // Use the font stored with the floating text object
        ctx.fillStyle = ft.color;
        ctx.textAlign = 'center';
        ctx.fillText(ft.text, ft.x, ft.y);
    });
}

// ---------------------------- UI Integration ----------------------------
function updateUI() {
    // Update resource bar
    document.getElementById('gold-display').textContent = `Gold: ${Math.floor(TDState.gold)}`;
    document.getElementById('wave-display').textContent = `Wave: ${TDState.wave}`;
    document.getElementById('kills-display').textContent = `Kills: ${TDState.enemiesKilled}`;

    // Update tower stats and costs
    const tower = TDState.tower;
    document.getElementById('damage-value').textContent = Math.round(tower.damage);
    document.getElementById('fireRate-value').textContent = `${tower.fireRate.toFixed(2)}/s`;
    document.getElementById('range-value').textContent = Math.round(tower.range);
    document.getElementById('crit-value').textContent = `${tower.crit.toFixed(0)}%`;

    document.getElementById('damage-cost').textContent = `Cost: ${UpgradeManager.getCost('damage')}`;
    document.getElementById('fireRate-cost').textContent = `Cost: ${UpgradeManager.getCost('fireRate')}`;
    document.getElementById('range-cost').textContent = `Cost: ${UpgradeManager.getCost('range')}`;
    document.getElementById('crit-cost').textContent = `Cost: ${UpgradeManager.getCost('crit')}`;

    // Update Castle HP Bar
    const hpPct = (TDState.castle.hp / TDState.castle.maxHp) * 100;
    const castleHpBar = document.getElementById('castle-hp-bar');
    castleHpBar.style.width = `${hpPct}%`;

    // Update the HP percentage text overlay
    const hpTextOverlay = document.querySelector('#castle-hp-bar-container::after'); // This won't work directly on pseudo-element
    // Instead, create a span inside the container for the text and update that.
    let hpTextSpan = document.getElementById('castle-hp-text-overlay');
    if (!hpTextSpan) {
        hpTextSpan = document.createElement('span');
        hpTextSpan.id = 'castle-hp-text-overlay';
        document.getElementById('castle-hp-bar-container').appendChild(hpTextSpan);
    }
    // The text format is also slightly cleaned up for better readability
    hpTextSpan.textContent = `${Math.max(0, Math.floor(TDState.castle.hp))} / ${TDState.castle.maxHp}`;
    
    // Change HP bar color based on percentage (dynamic gradient)
    if (hpPct > 60) {
        castleHpBar.style.background = 'linear-gradient(to right, var(--accent-green), #90ee90)';
    } else if (hpPct > 30) {
        castleHpBar.style.background = 'linear-gradient(to right, #ffeb3b, #ffda4a)'; // Yellow/Gold
    } else {
        castleHpBar.style.background = 'linear-gradient(to right, var(--accent-red), #ff7f7f)'; // Red
    }
}


// ---------------------------- Game Control ----------------------------
function initGame() {
    setupCanvas();
    UpgradeManager.init();
    TDState.castle = new Castle();
    TDState.tower = new Tower();
    TDState.waveManager = new WaveManager();
    updateUI(); // Initial UI update
    draw(); // Initial draw of the canvas
}

function startGame() {
    if (TDState.running || TDState.gameOver) return;
    TDState.running = true;
    document.getElementById('start-button').disabled = true;
    document.getElementById('pause-button').disabled = false;
    TDState.lastTime = performance.now();
    if(TDState.wave === 0) {
        TDState.waveManager.startNextWave();
    }
    gameLoop(TDState.lastTime);
}

function pauseGame() {
    if (!TDState.running) return;
    TDState.running = false;
    document.getElementById('start-button').disabled = false;
    document.getElementById('pause-button').disabled = true;
    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
    }
}


// ---------------------------- Event Listeners (FIXED) ----------------------------

// A helper function to delay execution
function debounce(func, delay = 250) {
    let timeout;
    return (...args) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => {
            func.apply(this, args);
        }, delay);
    };
}

document.addEventListener('DOMContentLoaded', () => {
    initGame(); // Initialize the game once on load

    // Create a debounced version of the initGame function for resizing
    const debouncedInit = debounce(() => {
        // We only need to re-setup the canvas and tower positions, not the whole game state
        setupCanvas();
        if (TDState.tower) {
            TDState.tower.x = canvasWidth / 2;
            TDState.tower.y = canvasHeight * 0.9;
        }
        if (TDState.castle) {
            TDState.castle.y = canvasHeight - 50;
        }
        // Redraw the canvas with the new dimensions
        draw(); 
    }, 250);

    // Use the debounced function for the resize event
    window.addEventListener('resize', debouncedInit);
    
    document.getElementById('start-button').addEventListener('click', startGame);
    document.getElementById('pause-button').addEventListener('click', pauseGame);
    document.getElementById('pause-button').disabled = true;

    document.getElementById('upgrade-damage').addEventListener('click', () => TDState.tower.upgrade('damage'));
    document.getElementById('upgrade-fireRate').addEventListener('click', () => TDState.tower.upgrade('fireRate'));
    document.getElementById('upgrade-range').addEventListener('click', () => TDState.tower.upgrade('range'));
    document.getElementById('upgrade-crit').addEventListener('click', () => TDState.tower.upgrade('crit'));
});