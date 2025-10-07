/*
    Vics Tower Defense - Revision 12 (The Skill Tree Update)
    - Added a comprehensive, expandable Skill Tree system.
    - Implemented a SkillManager to handle skill logic, purchasing, and effects.
    - Added dynamic rendering for the skill tree modal UI.
    - Integrated 8 sample skills (Multi-Shot, Rapid Fire, Pierce, etc.) into core game mechanics.
    - Game now pauses when the skill tree is open.
    - Save/Load system now includes skill progression.
*/

// ---------------------------- Configuration ----------------------------
const TD_CONFIG = {
    canvasId: 'gameCanvas',
    waveStartDelay: 3000,
    spawnInterval: 600,
    saveKey: 'slimeTD_gameState'
};

const MAXS = {
    HERO_DAMAGE: 10000,
    HERO_RANGE: 500,
    HERO_FIRE_RATE: 20,
    CRIT_CHANCE: 90,
    CASTLE_HP: 10000,
    HERO_SPEED: 250, // Increased base speed cap for GodSpeed
};

const UPGRADE_COST_MULT = 1.18;
const ABILITY_COOLDOWNS = {
    empBlast: 45000
};

// ---------------------------- Canvas & Context Setup ----------------------------
let canvas = null, ctx = null, canvasWidth = 0, canvasHeight = 0;

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
    gamePath.push(...pathPresets[currentPathIndex](canvasWidth, canvasHeight));
}

// ---------------------------- Core Game State ----------------------------
const TDState = {
    running: false, gameOver: false, betweenWaves: true, lastTime: 0, gold: 100,
    wave: 0, enemiesKilled: 0, gemsEarned: 0, enemies: [], projectiles: [],
    particles: [], floatingTexts: [], hero: null, castle: null, waveManager: null, follower: null,
    screenShake: { intensity: 0, duration: 0 },
    abilities: { empBlast: { lastUsed: -ABILITY_COOLDOWNS.empBlast } }
};

// ---------------------------- Joystick State ----------------------------
const joystick = {
    active: false, radius: 60, deadzone: 10,
    start: { x: 0, y: 0 }, current: { x: 0, y: 0 }, vector: { x: 0, y: 0 }
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
            this.gems -= this.getCost(stat); this.upgrades[stat].level++; this.save();
            AudioManager.play('upgrade'); return true;
        }
        AudioManager.play('error'); return false;
    },
    save() {
        localStorage.setItem('slimeTDSaveData_meta', JSON.stringify({
            gems: this.gems, levels: {
                startingGold: this.upgrades.startingGold.level,
                critChance: this.upgrades.critChance.level,
                upgradeDiscount: this.upgrades.upgradeDiscount.level,
            }
        }));
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
            this.sounds[name] = audio; this.sounds[name].volume = 0.5;
        });
    },
    play(name) {
        const sound = this.sounds[name];
        if (sound && sound.isLoaded) { sound.currentTime = 0; sound.play().catch(e => {}); }
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
            p.x = x; p.y = y; p.vx = (Math.random() - 0.5) * 150; p.vy = (Math.random() - 0.5) * 150;
            p.ttl = Math.random() * 500 + 200; p.spawnTime = now();
            p.color = color; p.size = Math.random() * 3 + 2;
            TDState.particles.push(p);
        }
    }
};

// ---------------------------- NEW: Skill Tree System ----------------------------
const SkillTree = {
    multiShot: {
        id: 'multiShot', name: 'Multi-Shot', maxLevel: 10, unlockWave: 10, requires: null,
        cost: 500, description: 'Fire +1 projectile at a nearby target.'
    },
    piercingShot: {
        id: 'piercingShot', name: 'Piercing Shot', maxLevel: 10, unlockWave: 15, requires: 'multiShot',
        cost: 800, description: 'Projectiles pierce +1 enemy.'
    },
    rapidFire: {
        id: 'rapidFire', name: 'Rapid Fire', maxLevel: 10, unlockWave: 15, requires: 'multiShot',
        cost: 1200, description: 'Fire an extra projectile burst.'
    },
    legolas: {
        id: 'legolas', name: 'Legolas', maxLevel: 10, unlockWave: 20, requires: 'rapidFire',
        cost: 1500, description: 'Increase fire rate and projectile speed.'
    },
    follower: {
        id: 'follower', name: 'Follower', maxLevel: 1, unlockWave: 25, requires: 'piercingShot',
        cost: 5000, description: 'Spawns a follower that mirrors your movement.'
    },
    spreadShot: {
        id: 'spreadShot', name: 'Spread Shot', maxLevel: 10, unlockWave: 30, requires: 'follower',
        cost: 2500, description: 'All turrets fire +1 projectile in an arc.'
    },
    godSpeed: {
        id: 'godSpeed', name: 'God Speed', maxLevel: 10, unlockWave: 30, requires: 'follower',
        cost: 2000, description: 'Increases Hero movement speed.'
    },
    repair: {
        id: 'repair', name: 'Repair', maxLevel: 10, unlockWave: 35, requires: 'godSpeed',
        cost: 3000, description: 'Passively repair the castle when nearby.'
    },
};

const SkillManager = {
    levels: {},
    init() {
        Object.keys(SkillTree).forEach(key => this.levels[key] = 0);
    },
    getSkillLevel(id) { return this.levels[id] || 0; },
    getSkillCost(id) {
        const skill = SkillTree[id];
        if (!skill) return Infinity;
        return Math.floor(skill.cost * Math.pow(1.5, this.getSkillLevel(id)));
    },
    purchaseSkill(id) {
        const skill = SkillTree[id];
        const level = this.getSkillLevel(id);
        const cost = this.getSkillCost(id);

        if (TDState.gold >= cost && level < skill.maxLevel) {
            TDState.gold -= cost;
            this.levels[id]++;
            this.applySkillEffects(id, 1); // Apply one level's worth of effect
            AudioManager.play('upgrade');
            renderSkillTree();
            return true;
        }
        AudioManager.play('error');
        return false;
    },
    applySkillEffects(id, levels) {
        if (id === 'legolas') TDState.hero.fireRate += 0.5 * levels;
        if (id === 'godSpeed') TDState.hero.speed = Math.min(MAXS.HERO_SPEED, TDState.hero.speed + (20 * levels));
        if (id === 'follower' && !TDState.follower) TDState.follower = new Follower(TDState.hero);
    },
    applyAllLoadedEffects() {
        Object.keys(this.levels).forEach(id => {
            const level = this.getSkillLevel(id);
            if (level > 0) this.applySkillEffects(id, level);
        });
    }
};

// ---------------------------- Castle Class ----------------------------
class Castle {
    constructor() { this.hp = 1000; this.maxHp = 1000; this.y = canvasHeight; }
    takeDamage(amount) {
        this.hp = Math.max(0, this.hp - amount);
        TDState.screenShake = { intensity: 15, duration: 500 }; AudioManager.play('castle_hit');
        floatingTextPool.get(`-${amount}`, canvasWidth / 2, this.y - 80, '#ef5350', 1200, 'bold 24px "Orbitron", sans-serif');
        if (this.hp <= 0) {
            TDState.gameOver = true; TDState.running = false;
            MetaUpgrades.gems += TDState.gemsEarned; MetaUpgrades.save(); clearSave(); showGameOverScreen();
        }
        updateUI();
    }
    recoverHp(percentage) {
        const recoveryAmount = Math.floor(this.maxHp * percentage);
        this.hp = Math.min(this.maxHp, this.hp + recoveryAmount);
        floatingTextPool.get(`+${recoveryAmount} HP`, canvasWidth / 2, canvasHeight - 120, '#4caf50', 2500, 'bold 28px "Bangers", cursive');
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
        this.active = false; this.type = null; this.x = 0; this.y = 0; this.hp = 1; this.maxHp = 1; this.speed = 20;
        this.reward = 5; this.size = 20; this.pathIndex = 0; this.color = '#c75869'; this.special = null;
        this.specialTimer = 0; this.stunnedUntil = 0; this.hitFlash = 0;
    }
    init(type, waveModifier) {
        this.active = true; this.type = type; this.x = gamePath[0].x; this.y = gamePath[0].y;
        this.hp = type.hp * waveModifier; this.maxHp = this.hp; this.speed = type.speed; this.reward = type.reward;
        this.size = type.size; this.color = type.color; this.special = type.special; this.pathIndex = 1; this.stunnedUntil = 0;
    }
    update(dt) {
        if (!this.active) return; if (this.hitFlash > 0) this.hitFlash -= dt * 1000;
        if (now() < this.stunnedUntil) return; if (this.pathIndex >= gamePath.length) { this.reachEnd(); return; }
        const target = gamePath[this.pathIndex]; const dx = target.x - this.x, dy = target.y - this.y;
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
        if (!this.active) return false; this.hp -= dmg; this.hitFlash = 100; AudioManager.play('enemy_hit');
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

// ---------------------------- Projectile Class ----------------------------
class Projectile {
    constructor() { this.active = false; }
    init(x, y, target, damage, isCrit = false) {
        this.active = true; this.x = x; this.y = y; this.target = target;
        this.damage = damage; this.isCrit = isCrit;
        this.spawnTime = now();
        this.pierceLeft = SkillManager.getSkillLevel('piercingShot');
        this.hitEnemies = [];
    }
    update(dt) {
        if (!this.active || now() - this.spawnTime > 3000) { this.active = false; return; }
        const projectileSpeed = 500 + (SkillManager.getSkillLevel('legolas') * 50);
        const dx = this.target.x - this.x, dy = this.target.y - this.y;
        const dist = Math.hypot(dx, dy);
        this.x += (dx / dist) * projectileSpeed * dt;
        this.y += (dy / dist) * projectileSpeed * dt;
        TDState.enemies.forEach(e => {
            if (this.active && e.active && !this.hitEnemies.includes(e) && Math.hypot(this.x - e.x, this.y - e.y) < e.size / 2) {
                e.takeDamage(this.damage);
                this.pierceLeft--;
                this.hitEnemies.push(e);
                if (this.pierceLeft < 0) this.active = false;
            }
        });
        if (dist > 2000) this.active = false; // Despawn if target is way off-screen
    }
    draw(ctx) {
        ctx.save(); const baseColor = this.isCrit ? '#ffeb3b' : '#e0e0ff';
        ctx.shadowColor = baseColor; ctx.shadowBlur = this.isCrit ? 15 : 8;
        ctx.fillStyle = baseColor; ctx.beginPath(); ctx.arc(this.x, this.y, this.isCrit ? 6 : 4, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
    }
}

// ---------------------------- Hero and Follower Classes ----------------------------
class Hero {
    constructor() {
        this.x = canvasWidth / 2; this.y = canvasHeight * 0.8;
        this.speed = 150;
        this.damage = 25; this.range = 180; this.fireRate = 1.2;
        this.crit = 5 + MetaUpgrades.getBonus('critChance');
        this.lastShot = 0; this.muzzleFlash = 0; this.repairTimer = 0;
    }
    update(dt) {
        if (joystick.active) {
            this.x += joystick.vector.x * this.speed * dt;
            this.y += joystick.vector.y * this.speed * dt;
            this.x = clamp(this.x, 20, canvasWidth - 20);
            this.y = clamp(this.y, 20, canvasHeight - 20);
        }
        const target = this.findTarget();
        this.shootAt(target);
        if (this.muzzleFlash > 0) this.muzzleFlash -= dt * 1000;
        const repairLevel = SkillManager.getSkillLevel('repair');
        if (repairLevel > 0) {
            this.repairTimer += dt * 1000;
            if (this.repairTimer > 1000) {
                this.repairTimer = 0;
                if (this.y > canvasHeight * 0.85) {
                    TDState.castle.recoverHp(0.001 * repairLevel);
                    particlePool.spawn(this.x, this.y, 1, '#4caf50');
                }
            }
        }
    }
    findTarget(excludeTarget = null) {
        let best = null, bestDist = Infinity;
        for(const e of TDState.enemies) {
            if (!e.active || e === excludeTarget) continue;
            const d = Math.hypot(e.x - this.x, e.y - this.y);
            if (d <= this.range && d < bestDist) { best = e; bestDist = d; }
        }
        return best;
    }
    shootAt(target) {
        if (!target || now() - this.lastShot < 1000 / this.fireRate) return;
        this.lastShot = now();
        this.muzzleFlash = 100;
        shootProjectile(this.x, this.y, target, this.damage, this.crit);
        const multiShotLevel = SkillManager.getSkillLevel('multiShot');
        if (multiShotLevel > 0) {
            for (let i = 0; i < multiShotLevel; i++) {
                let secondTarget = this.findTarget(target);
                if (secondTarget) shootProjectile(this.x, this.y, secondTarget, this.damage, this.crit);
            }
        }
        const rapidFireLevel = SkillManager.getSkillLevel('rapidFire');
        if (rapidFireLevel > 0) {
            for (let i = 1; i <= rapidFireLevel; i++) {
                setTimeout(() => {
                    if (target.active) shootProjectile(this.x, this.y, target, this.damage * 0.5, this.crit, true);
                }, 100 * i);
            }
        }
    }
    upgrade(stat) {
        if (!UpgradeManager.canAffordUpgrade(stat)) { floatingTextPool.get('Not enough gold!', canvasWidth / 2, canvasHeight - 150, '#ef5350', 1000); AudioManager.play('error'); return; }
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

// ---------------------------- Global Projectile Function ----------------------------
function shootProjectile(x, y, target, damage, critChance, isRapidFire = false) {
    if(!isRapidFire) AudioManager.play('shoot');
    const isCrit = Math.random() * 100 < critChance;
    const finalDamage = damage * (isCrit ? 2.5 : 1.0);
    const spreadLevel = SkillManager.getSkillLevel('spreadShot');
    for (let i = 0; i < 1 + spreadLevel; i++) {
        let p = TDState.projectiles.find(pr => !pr.active);
        if (!p) { p = new Projectile(); TDState.projectiles.push(p); }
        let currentTarget = target;
        if (i > 0) {
            const angleOffset = (i % 2 === 0 ? -1 : 1) * Math.ceil(i/2) * 15 * (Math.PI / 180);
            const dirX = target.x - x, dirY = target.y - y;
            const originalAngle = Math.atan2(dirY, dirX); const newAngle = originalAngle + angleOffset;
            currentTarget = { x: x + Math.cos(newAngle) * 2000, y: y + Math.sin(newAngle) * 2000, active: true };
        }
        p.init(x, y, currentTarget, finalDamage, isCrit);
    }
    if (!isRapidFire) {
        const color = isCrit ? '#ffeb3b' : '#e0e0ff';
        const font = isCrit ? 'bold 20px "Press Start 2P", cursive' : 'bold 16px "Orbitron", sans-serif';
        floatingTextPool.get(`-${Math.round(finalDamage)}`, target.x, target.y - 10, color, 600, font);
    }
}

// ... (Upgrade Manager, Wave Manager, Game Loop, update, draw, etc. are largely unchanged)
// ... (Only the functions that need modification are shown below for clarity)

// ---------------------------- UI, Game Control, Save/Load, Listeners ----------------------------
// All subsequent functions from the previous final file go here, with the following modifications:

// --- MODIFICATION to initGame ---
function initGame() {
    setupCanvas(); MetaUpgrades.load(); TDState.castle = new Castle();
    TDState.hero = new Hero(); TDState.waveManager = new WaveManager(); 
    UpgradeManager.init(); SkillManager.init(); // Initialize SkillManager
    if (loadGame()) {
        document.getElementById('start-button').textContent = "Resume";
        document.getElementById('call-wave-button').style.display = 'block';
        SkillManager.applyAllLoadedEffects(); // Apply effects from loaded skills
    } else { TDState.gold = 100 + MetaUpgrades.getBonus('startingGold'); }
    updateUI(); draw();
}

// --- MODIFICATION to pauseGame ---
function pauseGame() {
    if (!TDState.running) return;
    TDState.running = false;
    document.getElementById('start-button').textContent = "Resume";
    document.getElementById('start-button').style.display = 'block';
    document.getElementById('pause-button').style.display = 'none';
    saveGame();
    cancelAnimationFrame(animationFrameId);
}

// --- MODIFICATIONS to saveGame/loadGame ---
function saveGame() {
    const gameState = {
        gold: TDState.gold, wave: TDState.wave, kills: TDState.enemiesKilled, gems: TDState.gemsEarned,
        castle: { hp: TDState.castle.hp, maxHp: TDState.castle.maxHp },
        hero: {
            damage: TDState.hero.damage, fireRate: TDState.hero.fireRate,
            range: TDState.hero.range, crit: TDState.hero.crit, speed: TDState.hero.speed
        },
        upgradeLevels: UpgradeManager.levels,
        skillLevels: SkillManager.levels // Save skill levels
    };
    localStorage.setItem(TD_CONFIG.saveKey, JSON.stringify(gameState));
}
function loadGame() {
    const savedState = localStorage.getItem(TD_CONFIG.saveKey);
    if (savedState) {
        const data = JSON.parse(savedState);
        TDState.gold = data.gold; TDState.wave = data.wave; TDState.waveManager.wave = data.wave;
        TDState.enemiesKilled = data.kills; TDState.gemsEarned = data.gems;
        TDState.castle.hp = data.castle.hp; TDState.castle.maxHp = data.castle.maxHp;
        TDState.hero.damage = data.hero.damage; TDState.hero.fireRate = data.hero.fireRate;
        TDState.hero.range = data.hero.range; TDState.hero.crit = data.hero.crit;
        TDState.hero.speed = data.hero.speed || 150;
        UpgradeManager.levels = data.upgradeLevels;
        SkillManager.levels = data.skillLevels || {}; // Load skill levels
        return true;
    }
    return false;
}

// --- MODIFICATION to main event listener ---
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
    document.getElementById('skills-button').addEventListener('click', openSkillsModal); // NEW
    document.getElementById('close-skills-button').addEventListener('click', closeSkillsModal); // NEW
    document.getElementById('call-wave-button').addEventListener('click', callWaveEarly);
    document.getElementById('emp-blast-button').addEventListener('click', useEmpBlast);
    document.getElementById('upgrade-damage').addEventListener('click', () => TDState.hero.upgrade('damage'));
    document.getElementById('upgrade-fireRate').addEventListener('click', () => TDState.hero.upgrade('fireRate'));
    document.getElementById('upgrade-range').addEventListener('click', () => TDState.hero.upgrade('range'));
    document.getElementById('upgrade-crit').addEventListener('click', () => TDState.hero.upgrade('crit'));
    document.getElementById('upgrade-castle-hp').addEventListener('click', upgradeCastleHp);
});