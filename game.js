/*
    Vics Tower Defense - Revision 8 (Auto-Save and Persistence)
    - Implemented a complete auto-save system using localStorage.
    - Game now automatically saves progress after each wave and on pause.
    - Added loadGame() function to restore player progress on startup.
    - "Start" button intelligently changes to "Resume" if a saved game is found.
    - Added logic to clear saved data after a Game Over for a fresh run.
*/

// ---------------------------- Configuration ----------------------------
const TD_CONFIG = {
    canvasId: 'gameCanvas',
    waveStartDelay: 3000,
    spawnInterval: 600,
    saveKey: 'slimeTD_gameState' // Key for localStorage
};

const MAXS = {
    HERO_DAMAGE: 10000,
    HERO_RANGE: 500,
    HERO_FIRE_RATE: 20,
    CRIT_CHANCE: 90,
    CASTLE_HP: 1000,
};

const UPGRADE_COST_MULT = 1.18;
const ABILITY_COOLDOWNS = {
    empBlast: 45000
};

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
    ctx.font = 'bold 16px "Orbitron", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
}

// ---------------------------- Game Path Generation ----------------------------
const gamePath = [];
const pathPresets = [
    (w, h) => [{ x: w * 0.7, y: -50 }, { x: w * 0.7, y: h * 0.2 }, { x: w * 0.3, y: h * 0.4 }, { x: w * 0.3, y: h * 0.6 }, { x: w * 0.8, y: h * 0.8 }, { x: w * 0.8, y: h + 50 }],
    (w, h) => [{ x: w * 0.5, y: -50 }, { x: w * 0.5, y: h * 0.1 }, { x: w * 0.2, y: h * 0.3 }, { x: w * 0.8, y: h * 0.5 }, { x: w * 0.2, y: h * 0.7 }, { x: w * 0.5, y: h + 50 }],
    (w, h) => [{ x: w * 0.2, y: -50 }, { x: w * 0.2, y: h * 0.4 }, { x: w * 0.6, y: h * 0.5 }, { x: w * 0.6, y: h * 0.8 }, { x: w * 0.4, y: h + 50 }],
    (w, h) => [{ x: w * 0.9, y: -50 }, { x: w * 0.9, y: h * 0.3 }, { x: w * 0.3, y: h * 0.4 }, { x: w * 0.3, y: h * 0.7 }, { x: w * 0.6, y: h + 50 }],
];

function generateNewPath() {
    gamePath.length = 0;
    const currentPathIndex = Math.floor(Math.random() * pathPresets.length);
    const generatedPoints = pathPresets[currentPathIndex](canvasWidth, canvasHeight);
    gamePath.push(...generatedPoints);
}

// ---------------------------- Core Game State ----------------------------
const TDState = {
    running: false,
    gameOver: false,
    betweenWaves: true,
    lastTime: 0,
    gold: 100,
    wave: 0,
    enemiesKilled: 0,
    gemsEarned: 0,
    enemies: [],
    projectiles: [],
    particles: [],
    floatingTexts: [],
    hero: null,
    castle: null,
    waveManager: null,
    screenShake: { intensity: 0, duration: 0 },
    abilities: {
        empBlast: { lastUsed: -ABILITY_COOLDOWNS.empBlast }
    }
};

// ---------------------------- Joystick State ----------------------------
const joystick = {
    active: false,
    radius: 60,
    deadzone: 10,
    start: { x: 0, y: 0 },
    current: { x: 0, y: 0 },
    vector: { x: 0, y: 0 }
};

// ---------------------------- Meta Progression & Storage ----------------------------
const MetaUpgrades = {
    upgrades: {
        startingGold: { name: "Starting Gold", level: 0, maxLevel: 10, cost: 5, bonus: 10 },
        critChance: { name: "Crit Chance", level: 0, maxLevel: 10, cost: 8, bonus: 0.5 },
        upgradeDiscount: { name: "Upgrade Discount", level: 0, maxLevel: 10, cost: 10, bonus: 1 },
    },
    gems: 0,
    getCost(stat) { return this.upgrades[stat].cost * (this.upgrades[stat].level + 1); },
    getBonus(stat) {
        const upgrade = this.upgrades[stat];
        if (!upgrade) return 0;
        if (stat === 'upgradeDiscount') return 1 - (upgrade.level * upgrade.bonus) / 100;
        return upgrade.level * upgrade.bonus;
    },
    purchase(stat) {
        if (this.gems >= this.getCost(stat) && this.upgrades[stat].level < this.upgrades[stat].maxLevel) {
            this.gems -= this.getCost(stat);
            this.upgrades[stat].level++;
            this.save();
            AudioManager.play('upgrade');
            return true;
        }
        AudioManager.play('error');
        return false;
    },
    save() {
        const saveData = {
            gems: this.gems,
            levels: {
                startingGold: this.upgrades.startingGold.level,
                critChance: this.upgrades.critChance.level,
                upgradeDiscount: this.upgrades.upgradeDiscount.level,
            }
        };
        localStorage.setItem('slimeTDSaveData_meta', JSON.stringify(saveData));
    },
    load() {
        const saved = localStorage.getItem('slimeTDSaveData_meta');
        if (saved) {
            const data = JSON.parse(saved);
            this.gems = data.gems || 0;
            this.upgrades.startingGold.level = data.levels.startingGold || 0;
            this.upgrades.critChance.level = data.levels.critChance || 0;
            this.upgrades.upgradeDiscount.level = data.levels.upgradeDiscount || 0;
        }
    }
};

// ---------------------------- Audio Manager ----------------------------
const AudioManager = {
    sounds: {},
    init(soundList) {
        soundList.forEach(name => {
            const audio = new Audio(`audio/${name}.mp3`);
            audio.isLoaded = false;
            audio.addEventListener('canplaythrough', () => audio.isLoaded = true, { once: true });
            audio.addEventListener('error', () => {});
            this.sounds[name] = audio;
            this.sounds[name].volume = 0.5;
        });
    },
    play(name) {
        const sound = this.sounds[name];
        if (sound && sound.isLoaded) {
            sound.currentTime = 0;
            sound.play().catch(e => {});
        }
    }
};

// ---------------------------- Utility & Object Pools ----------------------------
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function now() { return performance.now(); }

const floatingTextPool = {
    pool: [],
    get(text, x, y, color = 'white', ttl = 1000, font = 'bold 16px "Orbitron", sans-serif') {
        let obj = this.pool.length > 0 ? this.pool.pop() : {};
        obj.text = text; obj.x = x; obj.y = y; obj.color = color; obj.ttl = ttl;
        obj.spawnTime = now(); obj.font = font;
        TDState.floatingTexts.push(obj);
    }
};

const particlePool = {
    pool: [],
    get() { return this.pool.length > 0 ? this.pool.pop() : {}; },
    spawn(x, y, count, color) {
        for (let i = 0; i < count; i++) {
            let p = this.get();
            p.x = x; p.y = y;
            p.vx = (Math.random() - 0.5) * 150; p.vy = (Math.random() - 0.5) * 150;
            p.ttl = Math.random() * 500 + 200; p.spawnTime = now();
            p.color = color; p.size = Math.random() * 3 + 2;
            TDState.particles.push(p);
        }
    }
};


// ---------------------------- Castle Class ----------------------------
class Castle {
    constructor() {
        this.hp = MAXS.CASTLE_HP; this.maxHp = MAXS.CASTLE_HP; this.y = canvasHeight;
    }
    takeDamage(amount) {
        this.hp = Math.max(0, this.hp - amount);
        TDState.screenShake = { intensity: 15, duration: 500 };
        AudioManager.play('castle_hit');
        floatingTextPool.get(`-${amount}`, canvasWidth / 2, this.y - 80, '#ef5350', 1200, 'bold 24px "Orbitron", sans-serif');
        if (this.hp <= 0) {
            TDState.gameOver = true; TDState.running = false;
            MetaUpgrades.gems += TDState.gemsEarned;
            MetaUpgrades.save();
            clearSave(); // Clear the game state on game over
            showGameOverScreen();
        }
        updateUI();
    }
    draw(ctx) {}
}

// ---------------------------- Enemy Definitions & Class ----------------------------
const EnemyTypes = {
    NORMAL: { hp: 30, speed: 40, reward: 5, size: 20, color: '#ff6b6b' },
    TANK: { hp: 100, speed: 25, reward: 10, size: 30, color: '#4834d4' },
    RUNNER: { hp: 15, speed: 80, reward: 3, size: 15, color: '#1dd1a1' },
    HEALER: { hp: 40, speed: 30, reward: 15, size: 22, color: '#feca57', special: 'HEAL' },
    SPLITTER: { hp: 50, speed: 35, reward: 8, size: 28, color: '#ff9ff3', special: 'SPLIT' }
};

class Enemy {
    constructor() { this.reset(); }
    reset() {
        this.active = false; this.type = null; this.x = 0; this.y = 0; this.hp = 1; this.maxHp = 1;
        this.speed = 20; this.reward = 5; this.size = 20; this.pathIndex = 0; this.color = '#c75869';
        this.special = null; this.specialTimer = 0; this.stunnedUntil = 0; this.hitFlash = 0;
    }
    init(type, waveModifier) {
        this.active = true; this.type = type; this.x = gamePath[0].x; this.y = gamePath[0].y;
        this.hp = type.hp * waveModifier; this.maxHp = this.hp; this.speed = type.speed; this.reward = type.reward;
        this.size = type.size; this.color = type.color; this.special = type.special; this.pathIndex = 1; this.stunnedUntil = 0;
    }
    update(dt) {
        if (!this.active) return;
        if (this.hitFlash > 0) this.hitFlash -= dt * 1000;
        if (now() < this.stunnedUntil) return;
        if (this.pathIndex >= gamePath.length) { this.reachEnd(); return; }

        const target = gamePath[this.pathIndex];
        const dx = target.x - this.x, dy = target.y - this.y;
        const dist = Math.hypot(dx, dy);
        if (dist < 1) { this.pathIndex++; } else { this.x += (dx / dist) * this.speed * dt; this.y += (dy / dist) * this.speed * dt; }

        if (this.special === 'HEAL') {
            this.specialTimer += dt * 1000;
            if (this.specialTimer > 3000) {
                this.specialTimer = 0; let healed = false;
                TDState.enemies.forEach(e => {
                    if (e.active && e !== this && Math.hypot(this.x - e.x, this.y - e.y) < 60 && e.hp < e.maxHp) {
                        e.hp = Math.min(e.maxHp, e.hp + this.maxHp * 0.1); healed = true;
                    }
                });
                if (healed) particlePool.spawn(this.x, this.y, 10, '#00ff00');
            }
        }
    }
    draw(ctx) {
        ctx.save(); ctx.translate(this.x, this.y);
        if (this.special === 'HEAL') {
            ctx.fillStyle = `rgba(0, 255, 0, ${0.1 + Math.sin(now()/200)*0.05})`;
            ctx.beginPath(); ctx.arc(0, 0, 60, 0, Math.PI * 2); ctx.fill();
        }
        ctx.fillStyle = this.color; ctx.beginPath(); ctx.arc(0, 0, this.size / 2, 0, Math.PI * 2); ctx.fill();
        if (this.hitFlash > 0) {
            ctx.fillStyle = `rgba(255, 255, 255, ${this.hitFlash / 100})`;
            ctx.beginPath(); ctx.arc(0, 0, this.size / 2 + 2, 0, Math.PI * 2); ctx.fill();
        }
        ctx.fillStyle = 'white'; ctx.beginPath(); ctx.arc(-this.size / 4, -this.size / 4, this.size / 8, 0, Math.PI * 2); ctx.arc(this.size / 4, -this.size / 4, this.size / 8, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'black'; ctx.beginPath(); ctx.arc(-this.size / 4, -this.size / 4, this.size / 16, 0, Math.PI * 2); ctx.arc(this.size / 4, -this.size / 4, this.size / 16, 0, Math.PI * 2); ctx.fill();
        const hpPct = this.hp / this.maxHp; ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(-this.size/2, -this.size/2 - 10, this.size, 4);
        const hpColor = hpPct > 0.6 ? '#4caf50' : hpPct > 0.3 ? '#ffeb3b' : '#ef5350';
        ctx.fillStyle = hpColor; ctx.fillRect(-this.size/2, -this.size/2 - 10, this.size * hpPct, 4);
        if (now() < this.stunnedUntil) {
            ctx.fillStyle = 'rgba(255, 255, 255, 0.7)'; ctx.font = 'bold 12px Orbitron'; ctx.fillText('Zzz', 0, this.size / 2 + 5);
        }
        ctx.restore();
    }
    takeDamage(dmg) {
        if (!this.active) return false;
        this.hp -= dmg; this.hitFlash = 100; AudioManager.play('enemy_hit');
        if (this.hp <= 0) { this.die(); return true; } return false;
    }
    die() {
        this.active = false; TDState.enemiesKilled++; TDState.gold += this.reward;
        particlePool.spawn(this.x, this.y, 20, this.color); AudioManager.play('enemy_die');
        floatingTextPool.get(`+${this.reward}`, this.x, this.y, '#ffeb3b');
        if (this.special === 'SPLIT') {
            for (let i = 0; i < 2; i++) {
                let e = TDState.enemies.find(en => !en.active); if (!e) { e = new Enemy(); TDState.enemies.push(e); }
                let childType = { ...EnemyTypes.NORMAL, size: 15, reward: 1 }; e.init(childType, 1);
                e.x = this.x + (i * 20 - 10); e.y = this.y;
            }
        }
    }
    reachEnd() { this.active = false; TDState.castle.takeDamage(10); }
}

// ---------------------------- Projectile & Hero Classes ----------------------------
class Projectile {
    constructor() { this.active = false; }
    init(x, y, target, damage, isCrit = false) {
        this.active = true; this.x = x; this.y = y; this.target = target;
        this.damage = damage; this.speed = 500; this.spawnTime = now(); this.isCrit = isCrit;
    }
    update(dt) {
        if (!this.active || !this.target.active || now() - this.spawnTime > 3000) { this.active = false; return; }
        const dx = this.target.x - this.x, dy = this.target.y - this.y; const dist = Math.hypot(dx, dy);
        if (dist < 10) { this.target.takeDamage(this.damage); this.active = false; } else { this.x += (dx / dist) * this.speed * dt; this.y += (dy / dist) * this.speed * dt; }
    }
    draw(ctx) {
        ctx.save(); const baseColor = this.isCrit ? '#ffeb3b' : '#e0e0ff';
        ctx.shadowColor = baseColor; ctx.shadowBlur = this.isCrit ? 15 : 8;
        ctx.fillStyle = baseColor; ctx.beginPath(); ctx.arc(this.x, this.y, this.isCrit ? 6 : 4, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
    }
}

class Hero {
    constructor() {
        this.x = canvasWidth / 2; this.y = canvasHeight * 0.8; this.speed = 150;
        this.damage = 25; this.range = 180; this.fireRate = 1.2;
        this.crit = 5 + MetaUpgrades.getBonus('critChance'); this.lastShot = 0; this.muzzleFlash = 0;
    }
    update(dt) {
        if (joystick.active) {
            this.x += joystick.vector.x * this.speed * dt; this.y += joystick.vector.y * this.speed * dt;
            this.x = clamp(this.x, 20, canvasWidth - 20); this.y = clamp(this.y, 20, canvasHeight - 20);
        }
        const target = this.findTarget(); this.shootAt(target);
        if (this.muzzleFlash > 0) this.muzzleFlash -= dt * 1000;
    }
    findTarget() {
        let best = null, bestDist = Infinity;
        TDState.enemies.forEach(e => {
            if (!e.active) return; const d = Math.hypot(e.x - this.x, e.y - this.y);
            if (d <= this.range && d < bestDist) { best = e; bestDist = d; }
        });
        return best;
    }
    shootAt(target) {
        if (!target || now() - this.lastShot < 1000 / this.fireRate) return;
        this.lastShot = now(); this.muzzleFlash = 100; AudioManager.play('shoot');
        const isCrit = Math.random() * 100 < this.crit; const damage = this.damage * (isCrit ? 2.5 : 1.0);
        let p = TDState.projectiles.find(pr => !pr.active) || new Projectile();
        if (!TDState.projectiles.includes(p)) TDState.projectiles.push(p);
        p.init(this.x, this.y, target, damage, isCrit);
        const color = isCrit ? '#ffeb3b' : '#e0e0ff';
        const font = isCrit ? 'bold 20px "Press Start 2P", cursive' : 'bold 16px "Orbitron", sans-serif';
        floatingTextPool.get(`-${Math.round(damage)}`, target.x, target.y - 10, color, 600, font);
    }
    upgrade(stat) {
        if (!UpgradeManager.canAffordUpgrade(stat)) {
            floatingTextPool.get('Not enough gold!', canvasWidth / 2, canvasHeight - 150, '#ef5350', 1000);
            AudioManager.play('error'); return;
        }
        UpgradeManager.payForUpgrade(stat); AudioManager.play('upgrade');
        let text = "";
        switch (stat) {
            case 'damage': this.damage = Math.min(MAXS.HERO_DAMAGE, this.damage + 6); text = `+6 DMG`; break;
            case 'range': this.range = Math.min(MAXS.HERO_RANGE, this.range + 10); text = `+10 RNG`; break;
            case 'fireRate': this.fireRate = Math.min(MAXS.HERO_FIRE_RATE, this.fireRate + 0.15); text = `+0.15 SPD`; break;
            case 'crit': this.crit = Math.min(MAXS.CRIT_CHANCE, this.crit + 1); text = `+1% CRIT`; break;
        }
        floatingTextPool.get(text, this.x, this.y - 50, '#4caf50', 800);
        updateUI();
    }
    draw(ctx) {
        ctx.save(); ctx.translate(this.x, this.y);
        ctx.fillStyle = "rgba(135, 153, 194, 0.08)"; ctx.strokeStyle = "rgba(135, 153, 194, 0.25)";
        ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, this.range, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#6a6ac2'; ctx.beginPath(); ctx.arc(0, 0, 25, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#e0e0ff'; ctx.beginPath(); ctx.arc(0, 0, 15, 0, Math.PI * 2); ctx.fill();
        if (this.muzzleFlash > 0) {
            ctx.fillStyle = `rgba(255, 235, 59, ${this.muzzleFlash/100})`;
            ctx.beginPath(); ctx.arc(0, 0, 18, 0, Math.PI * 2); ctx.fill();
        }
        ctx.restore();
    }
}

// ---------------------------- Upgrade Manager ----------------------------
const UpgradeManager = {
    costs: { damage: 50, range: 60, fireRate: 80, crit: 120 },
    levels: { damage: 0, range: 0, fireRate: 0, crit: 0 },
    baseCosts: {},
    init() {
        this.baseCosts = { ...this.costs };
        this.levels = { damage: 0, range: 0, fireRate: 0, crit: 0 };
    },
    getCost(stat) {
        const lvl = this.levels[stat];
        const base = this.baseCosts[stat];
        const discount = MetaUpgrades.getBonus('upgradeDiscount');
        return Math.ceil(base * Math.pow(UPGRADE_COST_MULT, lvl) * discount);
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
        this.wave = 0; this.spawning = false; this.spawnFinished = false; this.enemiesToSpawn = 0;
        this.spawned = 0; this.spawnTimer = 0; this.waveComposition = [];
    }
    startNextWave() {
        if (this.spawning) return;
        TDState.betweenWaves = false; document.getElementById('call-wave-button').style.display = 'none';
        generateNewPath();
        this.wave++; TDState.wave = this.wave; this.generateWaveComposition();
        this.enemiesToSpawn = this.waveComposition.length; this.spawned = 0; this.spawnTimer = 0;
        this.spawning = true; this.spawnFinished = false; AudioManager.play('wave_start');
        floatingTextPool.get(`Wave ${this.wave}`, canvasWidth / 2, canvasHeight * 0.4, '#e0e0ff', 2000, 'bold 32px "Bangers", cursive');
        updateUI();
    }
    endWave() {
        this.spawning = false; TDState.betweenWaves = true;
        const bonus = 15 * this.wave; TDState.gold += bonus;
        TDState.gemsEarned += 1 + Math.floor(this.wave / 5);
        document.getElementById('call-wave-button').style.display = 'block';
        AudioManager.play('wave_clear');
        floatingTextPool.get(`Wave Cleared! +${bonus} Gold!`, canvasWidth / 2, canvasHeight * 0.4, '#ffeb3b', 2000, 'bold 28px "Bangers", cursive');
        saveGame();
        updateUI();
    }
    generateWaveComposition() {
        this.waveComposition = []; const baseCount = 8 + this.wave * 2;
        for (let i = 0; i < baseCount; i++) this.waveComposition.push(EnemyTypes.NORMAL);
        if (this.wave > 1) for (let i = 0; i < this.wave; i++) this.waveComposition.push(EnemyTypes.RUNNER);
        if (this.wave > 3) for (let i = 0; i < Math.floor(this.wave / 2); i++) this.waveComposition.push(EnemyTypes.TANK);
        if (this.wave > 5) for (let i = 0; i < Math.floor(this.wave / 3); i++) this.waveComposition.push(EnemyTypes.SPLITTER);
        if (this.wave > 7) for (let i = 0; i < Math.floor(this.wave / 4); i++) this.waveComposition.push(EnemyTypes.HEALER);
        this.waveComposition.sort(() => Math.random() - 0.5);
    }
    update(dt) {
        if (this.spawning) {
            const interval = Math.max(100, TD_CONFIG.spawnInterval - this.wave * 10); this.spawnTimer += dt * 1000;
            if (this.spawnTimer > interval && this.spawned < this.enemiesToSpawn) {
                this.spawnTimer = 0; const enemyType = this.waveComposition[this.spawned]; this.spawned++;
                let e = TDState.enemies.find(en => !en.active); if (!e) { e = new Enemy(); TDState.enemies.push(e); }
                const waveModifier = 1 + this.wave * 0.15; e.init(enemyType, waveModifier);
            }
            if (this.spawned >= this.enemiesToSpawn) { this.spawning = false; this.spawnFinished = true; }
        }
        if (this.spawnFinished && !TDState.betweenWaves) {
            const activeEnemiesCount = TDState.enemies.filter(e => e.active).length;
            if (activeEnemiesCount === 0) { this.endWave(); }
        }
    }
}

// ---------------------------- Main Game Loop ----------------------------
let animationFrameId = null;

function gameLoop(timestamp) {
    if (!TDState.running) return;
    const dt = clamp((timestamp - TDState.lastTime) / 1000, 0.01, 0.1);
    TDState.lastTime = timestamp;
    update(dt); draw();
    animationFrameId = requestAnimationFrame(gameLoop);
}

function update(dt) {
    if (TDState.gameOver) return;
    TDState.waveManager.update(dt); TDState.hero.update(dt);
    TDState.enemies.forEach(e => e.update(dt));
    TDState.projectiles = TDState.projectiles.filter(p => p.active); TDState.projectiles.forEach(p => p.update(dt));
    TDState.particles = TDState.particles.filter(p => now() - p.spawnTime < p.ttl);
    TDState.particles.forEach(p => { p.x += p.vx * dt; p.y += p.vy * dt; });
    TDState.floatingTexts = TDState.floatingTexts.filter(ft => now() - ft.spawnTime < ft.ttl);
    TDState.floatingTexts.forEach(ft => { ft.y -= 30 * dt; });
    if (TDState.screenShake.duration > 0) {
        TDState.screenShake.duration -= dt * 1000; TDState.screenShake.intensity *= 0.9;
    } else { TDState.screenShake.intensity = 0; }
    updateUI();
}

function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.save();
    if (TDState.screenShake.intensity > 0) {
        const sx = (Math.random() - 0.5) * TDState.screenShake.intensity;
        const sy = (Math.random() - 0.5) * TDState.screenShake.intensity;
        ctx.translate(sx, sy);
    }
    if (gamePath.length > 0) {
        ctx.strokeStyle = "rgba(79, 79, 138, 0.4)"; ctx.lineWidth = 50;
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.beginPath(); ctx.moveTo(gamePath[0].x, gamePath[0].y);
        for (let i = 1; i < gamePath.length; i++) ctx.lineTo(gamePath[i].x, gamePath[i].y);
        ctx.stroke();
        ctx.strokeStyle = "rgba(255, 255, 255, 0.1)"; ctx.lineWidth = 2; ctx.stroke();
    }
    TDState.castle.draw(ctx); TDState.hero.draw(ctx);
    TDState.enemies.forEach(e => { if (e.active) e.draw(ctx); });
    TDState.projectiles.forEach(p => p.draw(ctx));
    TDState.particles.forEach(p => { ctx.fillStyle = p.color; ctx.fillRect(p.x, p.y, p.size, p.size); });
    TDState.floatingTexts.forEach(ft => {
        ctx.font = ft.font; ctx.fillStyle = ft.color;
        ctx.textAlign = 'center'; ctx.fillText(ft.text, ft.x, ft.y);
    });
    if (joystick.active) {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(joystick.start.x, joystick.start.y, joystick.radius, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.beginPath(); ctx.arc(joystick.current.x, joystick.current.y, joystick.radius / 2, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
}

// ---------------------------- UI Integration ----------------------------
function updateUI() {
    document.getElementById('gold-display').textContent = `Gold: ${Math.floor(TDState.gold)}`;
    document.getElementById('wave-display').textContent = `Wave: ${TDState.wave}`;
    document.getElementById('kills-display').textContent = `Kills: ${TDState.enemiesKilled}`;
    const hero = TDState.hero;
    document.getElementById('damage-value').textContent = Math.round(hero.damage);
    document.getElementById('fireRate-value').textContent = `${hero.fireRate.toFixed(2)}/s`;
    document.getElementById('range-value').textContent = Math.round(hero.range);
    document.getElementById('crit-value').textContent = `${hero.crit.toFixed(0)}%`;
    document.getElementById('damage-cost').textContent = `Cost: ${UpgradeManager.getCost('damage')}`;
    document.getElementById('fireRate-cost').textContent = `Cost: ${UpgradeManager.getCost('fireRate')}`;
    document.getElementById('range-cost').textContent = `Cost: ${UpgradeManager.getCost('range')}`;
    document.getElementById('crit-cost').textContent = `Cost: ${UpgradeManager.getCost('crit')}`;
    const hpPct = (TDState.castle.hp / TDState.castle.maxHp) * 100;
    const castleHpBar = document.getElementById('castle-hp-bar');
    castleHpBar.style.width = `${hpPct}%`;
    let hpTextSpan = document.getElementById('castle-hp-text-overlay');
    if (!hpTextSpan) {
        hpTextSpan = document.createElement('span'); hpTextSpan.id = 'castle-hp-text-overlay';
        document.getElementById('castle-hp-bar-container').appendChild(hpTextSpan);
    }
    hpTextSpan.textContent = `${Math.max(0, Math.floor(TDState.castle.hp))} / ${TDState.castle.maxHp}`;
    if (hpPct > 60) castleHpBar.style.background = 'linear-gradient(to right, var(--accent-green), #90ee90)';
    else if (hpPct > 30) castleHpBar.style.background = 'linear-gradient(to right, #ffeb3b, #ffda4a)';
    else castleHpBar.style.background = 'linear-gradient(to right, var(--accent-red), #ff7f7f)';
    const empButton = document.getElementById('emp-blast-button');
    const cooldownTime = (TDState.abilities.empBlast.lastUsed + ABILITY_COOLDOWNS.empBlast) - now();
    if (cooldownTime > 0) {
        empButton.disabled = true;
        empButton.textContent = `${(cooldownTime / 1000).toFixed(1)}s`;
    } else {
        empButton.disabled = false;
        empButton.textContent = 'EMP';
    }
}

function showGameOverScreen() {
    document.getElementById('game-over-screen').style.display = 'flex';
    document.getElementById('final-wave-stat').textContent = `Wave Reached: ${TDState.wave}`;
    document.getElementById('final-kills-stat').textContent = `Slimes Defeated: ${TDState.enemiesKilled}`;
    document.getElementById('gems-earned-stat').textContent = `Gems Earned: ${TDState.gemsEarned}`;
}

// ---------------------------- NEW: Save/Load System ----------------------------
function saveGame() {
    const gameState = {
        gold: TDState.gold,
        wave: TDState.wave,
        kills: TDState.enemiesKilled,
        gems: TDState.gemsEarned,
        castleHp: TDState.castle.hp,
        hero: {
            damage: TDState.hero.damage,
            fireRate: TDState.hero.fireRate,
            range: TDState.hero.range,
            crit: TDState.hero.crit,
        },
        upgradeLevels: UpgradeManager.levels,
    };
    localStorage.setItem(TD_CONFIG.saveKey, JSON.stringify(gameState));
    console.log("Game Saved!");
}

function loadGame() {
    const savedState = localStorage.getItem(TD_CONFIG.saveKey);
    if (savedState) {
        const data = JSON.parse(savedState);
        TDState.gold = data.gold;
        TDState.wave = data.wave;
        TDState.waveManager.wave = data.wave;
        TDState.enemiesKilled = data.kills;
        TDState.gemsEarned = data.gems;
        TDState.castle.hp = data.castleHp;
        TDState.hero.damage = data.hero.damage;
        TDState.hero.fireRate = data.hero.fireRate;
        TDState.hero.range = data.hero.range;
        TDState.hero.crit = data.hero.crit;
        UpgradeManager.levels = data.upgradeLevels;

        console.log("Game Loaded!");
        return true;
    }
    return false;
}

function clearSave() {
    localStorage.removeItem(TD_CONFIG.saveKey);
    console.log("Save data cleared.");
}


// ---------------------------- Game Control ----------------------------
function initGame() {
    setupCanvas();
    MetaUpgrades.load();
    TDState.castle = new Castle();
    TDState.hero = new Hero();
    TDState.waveManager = new WaveManager();
    UpgradeManager.init();

    if (loadGame()) {
        document.getElementById('start-button').textContent = "Resume";
        document.getElementById('call-wave-button').style.display = 'block';
    } else {
        TDState.gold = 100 + MetaUpgrades.getBonus('startingGold');
    }
    
    updateUI();
    draw();
}

function startGame() {
    if (TDState.running || TDState.gameOver) return;
    TDState.running = true;
    document.getElementById('start-button').style.display = 'none';
    document.getElementById('pause-button').style.display = 'block';
    TDState.lastTime = performance.now();
    if (TDState.wave === 0) {
        TDState.waveManager.startNextWave();
    } else {
        // If resuming, we just unpause. The wave manager is already in the correct state.
        TDState.betweenWaves = true;
        document.getElementById('call-wave-button').style.display = 'block';
    }
    gameLoop(TDState.lastTime);
}

function pauseGame() {
    if (!TDState.running) return;
    TDState.running = false;
    document.getElementById('start-button').textContent = "Resume";
    document.getElementById('start-button').style.display = 'block';
    document.getElementById('pause-button').style.display = 'none';
    saveGame(); // Save progress when pausing
    cancelAnimationFrame(animationFrameId);
}

function callWaveEarly() {
    if (TDState.betweenWaves && !TDState.waveManager.spawning) {
        const bonus = 5 * (TDState.wave + 1);
        TDState.gold += bonus;
        floatingTextPool.get(`Early Bonus! +${bonus}`, canvasWidth/2, canvasHeight - 150, '#ffeb3b');
        TDState.waveManager.startNextWave();
        AudioManager.play('ui_click');
    }
}

function useEmpBlast() {
    const cooldownTime = (TDState.abilities.empBlast.lastUsed + ABILITY_COOLDOWNS.empBlast) - now();
    if (cooldownTime <= 0) {
        TDState.abilities.empBlast.lastUsed = now();
        TDState.enemies.forEach(e => { if (e.active) e.stunnedUntil = now() + 3000; });
        TDState.screenShake = { intensity: 20, duration: 300 };
        AudioManager.play('emp_blast');
        particlePool.spawn(TDState.hero.x, TDState.hero.y, 100, '#82ccdd');
    }
}

// ---------------------------- Event Listeners ----------------------------
function handleJoystickStart(e) {
    if (e.target !== canvas) return;
    e.preventDefault();
    joystick.active = true;
    const rect = canvas.getBoundingClientRect();
    const touch = e.changedTouches ? e.changedTouches[0] : e;
    joystick.start.x = touch.clientX - rect.left;
    joystick.start.y = touch.clientY - rect.top;
    joystick.current.x = joystick.start.x;
    joystick.current.y = joystick.start.y;
}

function handleJoystickMove(e) {
    if (!joystick.active) return;
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const touch = e.changedTouches ? e.changedTouches[0] : e;
    const moveX = touch.clientX - rect.left;
    const moveY = touch.clientY - rect.top;
    const dx = moveX - joystick.start.x, dy = moveY - joystick.start.y;
    const dist = Math.hypot(dx, dy);
    if (dist < joystick.deadzone) {
        joystick.vector.x = 0; joystick.vector.y = 0;
        joystick.current.x = moveX; joystick.current.y = moveY;
        return;
    }
    const angle = Math.atan2(dy, dx);
    const clampedDist = Math.min(dist, joystick.radius);
    joystick.current.x = joystick.start.x + Math.cos(angle) * clampedDist;
    joystick.current.y = joystick.start.y + Math.sin(angle) * clampedDist;
    joystick.vector.x = Math.cos(angle);
    joystick.vector.y = Math.sin(angle);
}

function handleJoystickEnd(e) {
    if (!joystick.active) return;
    e.preventDefault();
    joystick.active = false;
    joystick.vector.x = 0;
    joystick.vector.y = 0;
}

document.addEventListener('DOMContentLoaded', () => {
    AudioManager.init(['shoot', 'enemy_hit', 'enemy_die', 'castle_hit', 'wave_start', 'wave_clear', 'upgrade', 'error', 'emp_blast', 'ui_click']);
    initGame();
    canvas.addEventListener('mousedown', handleJoystickStart);
    canvas.addEventListener('mousemove', handleJoystickMove);
    window.addEventListener('mouseup', handleJoystickEnd);
    canvas.addEventListener('touchstart', handleJoystickStart, { passive: false });
    canvas.addEventListener('touchmove', handleJoystickMove, { passive: false });
    window.addEventListener('touchend', handleJoystickEnd);
    window.addEventListener('touchcancel', handleJoystickEnd);
    document.getElementById('start-button').addEventListener('click', startGame);
    document.getElementById('pause-button').addEventListener('click', pauseGame);
    document.getElementById('call-wave-button').addEventListener('click', callWaveEarly);
    document.getElementById('emp-blast-button').addEventListener('click', useEmpBlast);
    document.getElementById('upgrade-damage').addEventListener('click', () => TDState.hero.upgrade('damage'));
    document.getElementById('upgrade-fireRate').addEventListener('click', () => TDState.hero.upgrade('fireRate'));
    document.getElementById('upgrade-range').addEventListener('click', () => TDState.hero.upgrade('range'));
    document.getElementById('upgrade-crit').addEventListener('click', () => TDState.hero.upgrade('crit'));
});
