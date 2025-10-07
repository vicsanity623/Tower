/*
    Vics Tower Defense - Game.js Revision 2
    - Implemented Castle with HP and collision detection.
    - Player tower moved to a fixed defensive position.
    - Added randomized enemy path generation for each wave.
    - Corrected wave completion logic.
*/

// ---------------------------- Configuration ----------------------------
const TD_CONFIG = {
    canvasId: 'gameCanvas',
    baseGoldPerEnemy: 5,
    waveStartDelay: 2000,
    spawnInterval: 600,
};

const MAXS = {
    TOWER_DAMAGE: 10000,
    TOWER_RANGE: 500,
    TOWER_FIRE_RATE: 10,
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
    get(text, x, y, color = 'white', ttl = 1000) {
        let obj = this.pool.length > 0 ? this.pool.pop() : {};
        obj.text = text; obj.x = x; obj.y = y; obj.color = color; obj.ttl = ttl;
        obj.spawnTime = now();
        TDState.floatingTexts.push(obj);
    },
    release(obj) { this.pool.push(obj); }
};

// ---------------------------- Castle Class ----------------------------
class Castle {
    constructor() {
        this.hp = MAXS.CASTLE_HP;
        this.maxHp = MAXS.CASTLE_HP;
        this.x = 0;
        this.y = canvasHeight * 0.95;
        this.width = canvasWidth;
        this.height = canvasHeight * 0.05;
    }
    takeDamage(amount) {
        this.hp = Math.max(0, this.hp - amount);
        floatingTextPool.get(`-${amount}`, canvasWidth / 2, this.y - 10, '#c75869');
        if (this.hp <= 0) {
            TDState.gameOver = true;
            TDState.running = false;
            floatingTextPool.get('GAME OVER', canvasWidth / 2, canvasHeight / 2, 'red', 5000);
        }
        updateUI();
    }
    draw(ctx) {
        ctx.fillStyle = '#232d43';
        ctx.fillRect(this.x, this.y, this.width, this.height);
        ctx.strokeStyle = 'rgba(0,0,0,0.4)';
        ctx.lineWidth = 2;
        ctx.strokeRect(this.x, this.y, this.width, this.height);
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
    }
    init(template) {
        this.active = true;
        this.x = gamePath[0].x;
        this.y = gamePath[0].y;
        this.hp = template.hp; this.maxHp = template.hp;
        this.speed = template.speed;
        this.reward = template.reward;
        this.pathIndex = 1;
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

        if (dist < 1) {
            this.pathIndex++;
        } else {
            this.x += (dx / dist) * this.speed * dt;
            this.y += (dy / dist) * this.speed * dt;
        }
    }
    draw(ctx) {
        ctx.fillStyle = '#c75869';
        ctx.fillRect(this.x - this.size / 2, this.y - this.size / 2, this.size, this.size);
        ctx.fillStyle = 'white';
        ctx.fillRect(this.x - 5, this.y - 5, 4, 4);
        ctx.fillRect(this.x + 1, this.y - 5, 4, 4);
        const hpPct = this.hp / this.maxHp;
        ctx.fillStyle = '#333';
        ctx.fillRect(this.x - this.size / 2, this.y - 15, this.size, 4);
        ctx.fillStyle = '#63d68c';
        ctx.fillRect(this.x - this.size / 2, this.y - 15, this.size * hpPct, 4);
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
        floatingTextPool.get(`+${this.reward}`, this.x, this.y, '#ffc93c');
    }
    reachEnd() {
        this.active = false;
        TDState.castle.takeDamage(10); // Each enemy deals 10 damage
    }
}

// ---------------------------- Projectile & Tower Classes (largely unchanged) ----------------------------
class Projectile {
    constructor() { this.active = false; }
    init(x, y, target, damage) {
        this.active = true;
        this.x = x; this.y = y;
        this.target = target;
        this.damage = damage;
        this.speed = 400;
        this.spawnTime = now();
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
        ctx.fillStyle = '#ffc93c';
        ctx.beginPath();
        ctx.arc(this.x, this.y, 5, 0, Math.PI * 2);
        ctx.fill();
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
        this.muzzleFlash = 0;
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
        this.muzzleFlash = 100;

        const crit = Math.random() * 100 < this.crit;
        const damage = this.damage * (crit ? 2.5 : 1.0);
        
        let p = TDState.projectiles.find(pr => !pr.active) || new Projectile();
        if (!TDState.projectiles.includes(p)) TDState.projectiles.push(p);
        p.init(this.x, this.y - 20, target, damage);

        const color = crit ? 'orange' : 'white';
        floatingTextPool.get(`-${Math.round(damage)}`, target.x, target.y - 10, color, 600);
    }
    upgrade(stat) {
        if (!UpgradeManager.canAffordUpgrade(stat)) return;
        UpgradeManager.payForUpgrade(stat);
        if (stat === 'damage') this.damage = Math.min(MAXS.TOWER_DAMAGE, this.damage + 6);
        if (stat === 'range') this.range = Math.min(MAXS.TOWER_RANGE, this.range + 10);
        if (stat === 'fireRate') this.fireRate = Math.min(MAXS.TOWER_FIRE_RATE, this.fireRate + 0.1);
        if (stat === 'crit') this.crit = Math.min(MAXS.CRIT_CHANCE, this.crit + 1);
        updateUI();
    }
    draw(ctx) {
        ctx.fillStyle = "rgba(135, 153, 194, 0.1)";
        ctx.strokeStyle = "rgba(135, 153, 194, 0.3)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.range, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#63d68c';
        ctx.beginPath();
        ctx.arc(this.x, this.y, 30, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
        ctx.beginPath();
        ctx.arc(this.x - 10, this.y - 10, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'white';
        ctx.beginPath();
        ctx.arc(this.x - 8, this.y, 5, 0, Math.PI * 2);
        ctx.arc(this.x + 8, this.y, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'black';
        ctx.beginPath();
        ctx.arc(this.x - 7, this.y + 1, 3, 0, Math.PI * 2);
        ctx.arc(this.x + 9, this.y + 1, 3, 0, Math.PI * 2);
        ctx.fill();
        if (this.muzzleFlash > 0) {
            ctx.fillStyle = `rgba(255, 201, 60, ${this.muzzleFlash/100})`;
            ctx.beginPath();
            ctx.arc(this.x, this.y - 25, 10, 0, Math.PI * 2);
            ctx.fill();
        }
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
        floatingTextPool.get(`Wave ${this.wave}`, canvasWidth / 2, 40, 'white', 2000);
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
        if (this.spawned >= this.enemiesToSpawn && TDState.enemies.every(e => !e.active)) {
            this.spawning = false;
            const bonus = 10 * this.wave;
            TDState.gold += bonus;
            floatingTextPool.get(`Wave Cleared! +${bonus}`, canvasWidth / 2, 70, '#ffc93c', 2000);
            setTimeout(() => this.startNextWave(), 2500);
        }
    }
}

// ---------------------------- Main Game Loop ----------------------------
let animationFrameId = null;

function gameLoop(timestamp) {
    if (!TDState.running) return;
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
    if(TDState.tower.muzzleFlash > 0) TDState.tower.muzzleFlash -= dt * 1000;
    TDState.floatingTexts = TDState.floatingTexts.filter(ft => {
        ft.y -= 10 * dt;
        const alive = now() - ft.spawnTime < ft.ttl;
        if (!alive) floatingTextPool.release(ft);
        return alive;
    });
    updateUI();
}

function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // Draw Path
    if (gamePath.length > 0) {
        ctx.strokeStyle = "rgba(0,0,0,0.2)";
        ctx.lineWidth = 50;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(gamePath[0].x, gamePath[0].y);
        for (let i = 1; i < gamePath.length; i++) {
            ctx.lineTo(gamePath[i].x, gamePath[i].y);
        }
        ctx.stroke();
    }
    // Draw Objects
    TDState.castle.draw(ctx);
    TDState.tower.draw(ctx);
    TDState.enemies.forEach(e => { if (e.active) e.draw(ctx); });
    TDState.projectiles.forEach(p => { if (p.active) p.draw(ctx); });
    TDState.floatingTexts.forEach(ft => {
        ctx.font = 'bold 16px sans-serif';
        ctx.fillStyle = ft.color;
        ctx.textAlign = 'center';
        ctx.fillText(ft.text, ft.x, ft.y);
    });
}

// ---------------------------- UI Integration ----------------------------
function updateUI() {
    document.getElementById('gold-display').textContent = `Gold: ${Math.floor(TDState.gold)}`;
    document.getElementById('wave-display').textContent = `Wave: ${TDState.wave}`;
    document.getElementById('kills-display').textContent = `Kills: ${TDState.enemiesKilled}`;
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
    document.getElementById('castle-hp-bar').style.width = `${hpPct}%`;
}


// ---------------------------- Game Control ----------------------------
function initGame() {
    setupCanvas();
    UpgradeManager.init();
    TDState.castle = new Castle();
    TDState.tower = new Tower();
    TDState.waveManager = new WaveManager();
    updateUI();
    draw();
}

function startGame() {
    if (TDState.running || TDState.gameOver) return;
    TDState.running = true;
    TDState.lastTime = performance.now();
    if(TDState.wave === 0) { // Only start the first wave
        TDState.waveManager.startNextWave();
    }
    gameLoop(TDState.lastTime);
}

function pauseGame() {
    TDState.running = false;
    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
    }
}

// ---------------------------- Event Listeners ----------------------------
document.addEventListener('DOMContentLoaded', () => {
    initGame();
    window.addEventListener('resize', initGame);
    document.getElementById('start-button').addEventListener('click', startGame);
    document.getElementById('pause-button').addEventListener('click', pauseGame);
    document.getElementById('upgrade-damage').addEventListener('click', () => TDState.tower.upgrade('damage'));
    document.getElementById('upgrade-fireRate').addEventListener('click', () => TDState.tower.upgrade('fireRate'));
    document.getElementById('upgrade-range').addEventListener('click', () => TDState.tower.upgrade('range'));
    document.getElementById('upgrade-crit').addEventListener('click', () => TDState.tower.upgrade('crit'));
});