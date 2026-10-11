class SingleEnemy {
    constructor(scene, audioCtx, crystal, initialPos, id = 0) {
        this.scene = scene;
        this.audioCtx = audioCtx;
        this.crystal = crystal;
        this.id = id;
        this.time = 0;

        // Enemy physics & flight parameters
        this.speed = 5.0; // 5m per second
        this.radius = 0.5; // ~1m diameter sphere collider

        // Position crystal
        if (this.crystal) {
            this.crystal.position.copy(initialPos);
            this.scene.add(this.crystal);
        }

        // Laser setup
        this.laserCooldown = Math.random() * 0.8; // Slight initial stagger
        this.laserActiveTime = 0;
        this.hasDamagedThisShot = false;
        this.raycaster = new THREE.Raycaster();

        const material = new THREE.MeshBasicMaterial({ color: 0x00ff00, transparent: true, opacity: 0.85 });
        // Cylinder geometry with 0.1m radius gives 0.2m (20cm) diameter
        const geometry = new THREE.CylinderGeometry(0.1, 0.1, 1, 8);
        geometry.rotateX(Math.PI / 2); // align with Z axis for lookAt
        geometry.translate(0, 0, 0.5); // move origin to the base of the cylinder
        this.laserBeam = new THREE.Mesh(geometry, material);
        this.laserBeam.visible = false;
        this.scene.add(this.laserBeam);

        // Impact spark/glow when laser hits an obstacle (wall or pillar)
        const impactGeo = new THREE.SphereGeometry(0.15, 8, 8);
        const impactMat = new THREE.MeshBasicMaterial({ color: 0x55ff55, transparent: true, opacity: 0.9 });
        this.laserImpact = new THREE.Mesh(impactGeo, impactMat);
        this.laserImpact.visible = false;
        this.scene.add(this.laserImpact);

        // Enemy Health parameters
        this.health = 100;
        this.maxHealth = 100;
        this.isDead = false;

        // Explosion effects tracking
        this.explosionParticles = [];
        this.explosionFlash = null;
        this.explosionRing = null;
    }

    playLaserSound() {
        if (!this.audioCtx) return;
        if (this.audioCtx.state === 'suspended') {
            this.audioCtx.resume();
        }
        const osc = this.audioCtx.createOscillator();
        const gainNode = this.audioCtx.createGain();

        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(800, this.audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(100, this.audioCtx.currentTime + 0.3);

        gainNode.gain.setValueAtTime(0.5, this.audioCtx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, this.audioCtx.currentTime + 0.3);

        osc.connect(gainNode);
        gainNode.connect(this.audioCtx.destination);

        osc.start();
        osc.stop(this.audioCtx.currentTime + 0.3);
    }

    getObstacles() {
        if (window.interactableMeshes && window.interactableMeshes.length > 0) {
            return window.interactableMeshes;
        }
        const obstacles = [];
        if (this.scene) {
            this.scene.traverse((child) => {
                if (child.isMesh && child !== this.laserBeam && child !== this.laserImpact && 
                    (!this.crystal || !this.crystal.getObjectById(child.id))) {
                    obstacles.push(child);
                }
            });
        }
        return obstacles;
    }

    getPillarBoxes() {
        if (window.colliders && window.colliders.length > 0) {
            return window.colliders;
        }
        const boxes = [];
        if (window.interactableMeshes) {
            for (const m of window.interactableMeshes) {
                if (m.geometry && m.geometry.type === 'BoxGeometry') {
                    boxes.push(new THREE.Box3().setFromObject(m));
                }
            }
        }
        return boxes;
    }

    // Check if enemy sees player (no pillars or walls between enemy and player)
    canSeePlayer(camera) {
        if (!this.crystal || !camera || this.isDead) return false;

        const origin = this.crystal.position.clone();
        const target = camera.position.clone();
        const distToPlayer = origin.distanceTo(target);
        if (distToPlayer < 0.1) return true;

        const dir = target.clone().sub(origin).normalize();
        this.raycaster.set(origin, dir);
        this.raycaster.near = 0.1;
        this.raycaster.far = distToPlayer;

        const obstacles = this.getObstacles();
        const intersects = this.raycaster.intersectObjects(obstacles, false);

        // If any pillar or wall is in between, the enemy cannot see the player
        if (intersects.length > 0 && intersects[0].distance < distToPlayer - 0.2) {
            return false;
        }

        return true;
    }

    checkLaserHit(camera) {
        if (!this.crystal || !camera || this.isDead) return null;

        const origin = this.crystal.position.clone();
        // Aim at torso level (0.5m below eye height)
        const aimTarget = new THREE.Vector3(camera.position.x, camera.position.y - 0.5, camera.position.z);
        const distToPlayer = origin.distanceTo(aimTarget);
        const dir = new THREE.Vector3().subVectors(aimTarget, origin).normalize();

        this.raycaster.set(origin, dir);
        this.raycaster.near = 0.1;
        this.raycaster.far = distToPlayer + 1;

        const obstacles = this.getObstacles();
        const intersects = this.raycaster.intersectObjects(obstacles, false);

        let isBlocked = false;
        let hitDistance = distToPlayer;
        let hitPoint = aimTarget;

        if (intersects.length > 0 && intersects[0].distance < distToPlayer - 0.1) {
            isBlocked = true;
            hitDistance = intersects[0].distance;
            hitPoint = intersects[0].point;
        }

        return {
            origin,
            aimTarget,
            distToPlayer,
            isBlocked,
            hitDistance,
            hitPoint
        };
    }

    updateLaserVisuals(hitInfo) {
        if (!hitInfo) return;

        this.laserBeam.position.copy(hitInfo.origin);
        this.laserBeam.lookAt(hitInfo.aimTarget);
        this.laserBeam.scale.set(1, 1, hitInfo.hitDistance);
        this.laserBeam.visible = true;

        if (hitInfo.isBlocked) {
            this.laserImpact.position.copy(hitInfo.hitPoint);
            this.laserImpact.visible = true;
        } else {
            this.laserImpact.visible = false;
        }
    }

    // Sphere-to-AABB box collision test
    sphereIntersectsBox(sphereCenter, radius, box) {
        const cx = Math.max(box.min.x, Math.min(sphereCenter.x, box.max.x));
        const cy = Math.max(box.min.y, Math.min(sphereCenter.y, box.max.y));
        const cz = Math.max(box.min.z, Math.min(sphereCenter.z, box.max.z));
        const distSq = (sphereCenter.x - cx) ** 2 + (sphereCenter.y - cy) ** 2 + (sphereCenter.z - cz) ** 2;
        return distSq < radius * radius;
    }

    // Check collision with the player first person controller
    checkPlayerCollision(testPos, camera) {
        const PLAYER_RADIUS = 0.45;
        const ENEMY_RADIUS = this.radius;
        const minDistXZ = PLAYER_RADIUS + ENEMY_RADIUS; // 0.95m
        
        // If bottom of enemy is at or above player's head, it can freely fly over him
        if (testPos.y - ENEMY_RADIUS >= camera.position.y) {
            return false;
        }

        // Enforce horizontal cylinder collider
        const dx = testPos.x - camera.position.x;
        const dz = testPos.z - camera.position.z;
        const distXZ = Math.sqrt(dx * dx + dz * dz);

        return distXZ < minDistXZ;
    }

    // Check collision with other alive enemies to avoid overlapping
    checkOtherEnemiesCollision(testPos, otherEnemies) {
        if (!otherEnemies) return false;
        const minDist = this.radius * 2.0; // 1.0m
        for (const other of otherEnemies) {
            if (other === this || other.isDead || !other.crystal) continue;
            if (testPos.distanceTo(other.crystal.position) < minDist) {
                return true;
            }
        }
        return false;
    }

    // Move enemy with 3D collision resolution against pillars, ceiling, floor, walls, player, and other enemies
    moveWithCollision(moveVec, camera, otherEnemies) {
        const ENEMY_RADIUS = this.radius;
        const boxes = this.getPillarBoxes();
        const currentPos = this.crystal.position.clone();

        // 1. Move along X
        if (moveVec.x !== 0) {
            let testX = currentPos.x + moveVec.x;
            testX = Math.max(-49.0, Math.min(49.0, testX));
            let testPos = new THREE.Vector3(testX, currentPos.y, currentPos.z);

            let collidesX = false;
            for (const box of boxes) {
                if (this.sphereIntersectsBox(testPos, ENEMY_RADIUS, box)) {
                    collidesX = true;
                    break;
                }
            }
            if (!collidesX && this.checkPlayerCollision(testPos, camera)) {
                collidesX = true;
            }
            if (!collidesX && this.checkOtherEnemiesCollision(testPos, otherEnemies)) {
                collidesX = true;
            }
            if (!collidesX) {
                currentPos.x = testX;
            }
        }

        // 2. Move along Z
        if (moveVec.z !== 0) {
            let testZ = currentPos.z + moveVec.z;
            testZ = Math.max(-49.0, Math.min(49.0, testZ));
            let testPos = new THREE.Vector3(currentPos.x, currentPos.y, testZ);

            let collidesZ = false;
            for (const box of boxes) {
                if (this.sphereIntersectsBox(testPos, ENEMY_RADIUS, box)) {
                    collidesZ = true;
                    break;
                }
            }
            if (!collidesZ && this.checkPlayerCollision(testPos, camera)) {
                collidesZ = true;
            }
            if (!collidesZ && this.checkOtherEnemiesCollision(testPos, otherEnemies)) {
                collidesZ = true;
            }
            if (!collidesZ) {
                currentPos.z = testZ;
            }
        }

        // 3. Move along Y
        if (moveVec.y !== 0) {
            let testY = currentPos.y + moveVec.y;
            testY = Math.max(ENEMY_RADIUS, Math.min(4.2 - ENEMY_RADIUS, testY));
            let testPos = new THREE.Vector3(currentPos.x, testY, currentPos.z);

            let collidesY = false;
            for (const box of boxes) {
                if (this.sphereIntersectsBox(testPos, ENEMY_RADIUS, box)) {
                    collidesY = true;
                    break;
                }
            }
            if (!collidesY && this.checkPlayerCollision(testPos, camera)) {
                collidesY = true;
            }
            if (!collidesY && this.checkOtherEnemiesCollision(testPos, otherEnemies)) {
                collidesY = true;
            }
            if (!collidesY) {
                currentPos.y = testY;
            }
        }

        this.crystal.position.copy(currentPos);
    }

    isEnemyObject(object) {
        if (!this.crystal || this.isDead) return false;
        let curr = object;
        while (curr) {
            if (curr === this.crystal) return true;
            curr = curr.parent;
        }
        return false;
    }

    takeDamage(amount, hitPoint) {
        if (this.isDead) return;

        this.health -= amount;
        console.log(`Enemy #${this.id} took ${amount} damage. Remaining HP: ${this.health}`);

        this.flashHit();
        this.playHurtSound();

        if (this.health <= 0) {
            this.health = 0;
            this.die();
        }
    }

    flashHit() {
        if (!this.crystal || this.isDead) return;
        this.crystal.traverse((child) => {
            if (child.isMesh && child.name !== 'enemyHitbox') {
                if (child.material) {
                    if (child.material.emissive && !child.userData.origEmissive) {
                        child.userData.origEmissive = child.material.emissive.clone();
                        child.material.emissive.setHex(0xff3333);
                    }
                }
            }
        });
        setTimeout(() => {
            if (this.crystal && !this.isDead) {
                this.crystal.traverse((child) => {
                    if (child.isMesh && child.userData && child.userData.origEmissive) {
                        child.material.emissive.copy(child.userData.origEmissive);
                        delete child.userData.origEmissive;
                    }
                });
            }
        }, 120);
    }

    playHurtSound() {
        try {
            if (!this.audioCtx) return;
            if (this.audioCtx.state === 'suspended') {
                this.audioCtx.resume();
            }
            const osc = this.audioCtx.createOscillator();
            const gain = this.audioCtx.createGain();
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(320, this.audioCtx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(70, this.audioCtx.currentTime + 0.15);
            gain.gain.setValueAtTime(0.4, this.audioCtx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, this.audioCtx.currentTime + 0.15);
            osc.connect(gain);
            gain.connect(this.audioCtx.destination);
            osc.start();
            osc.stop(this.audioCtx.currentTime + 0.15);
        } catch (e) {
            console.error(e);
        }
    }

    die() {
        if (this.isDead) return;
        this.isDead = true;

        const explosionPos = this.crystal ? this.crystal.position.clone() : new THREE.Vector3(0, 2, -40);

        // Immediately hide and disable enemy laser & impact
        this.laserBeam.visible = false;
        this.laserImpact.visible = false;

        // Vanish the enemy crystal model
        if (this.crystal) {
            this.scene.remove(this.crystal);
            this.crystal.visible = false;
        }

        // Spawn yellowish fire and grey smoke explosion
        this.spawnExplosion(explosionPos);

        // Play explosion sound
        this.playExplosionSound();
    }

    spawnExplosion(pos) {
        // 1. Dynamic Yellowish Flash Light
        const flashLight = new THREE.PointLight(0xffdd33, 14, 25);
        flashLight.position.copy(pos);
        this.scene.add(flashLight);
        this.explosionFlash = {
            light: flashLight,
            timer: 0.35,
            maxTimer: 0.35,
            maxIntensity: 14
        };

        // 2. Expanding Yellow Shockwave Ring
        const ringGeo = new THREE.RingGeometry(0.3, 0.6, 32);
        ringGeo.rotateX(-Math.PI / 2);
        const ringMat = new THREE.MeshBasicMaterial({
            color: 0xffea00,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.85,
            depthWrite: false
        });
        const ringMesh = new THREE.Mesh(ringGeo, ringMat);
        ringMesh.position.copy(pos);
        this.scene.add(ringMesh);
        this.explosionRing = {
            mesh: ringMesh,
            timer: 0.45,
            maxTimer: 0.45
        };

        // 3. Yellowish Fire Particles (60 particles)
        const fireColors = [0xfff24f, 0xffea00, 0xffd000, 0xffb703, 0xffa000, 0xff8c00];
        for (let i = 0; i < 60; i++) {
            const fireGeo = (i % 2 === 0) 
                ? new THREE.DodecahedronGeometry(0.12 + Math.random() * 0.12)
                : new THREE.TetrahedronGeometry(0.14 + Math.random() * 0.14);
            const color = fireColors[Math.floor(Math.random() * fireColors.length)];
            const fireMat = new THREE.MeshBasicMaterial({
                color: color,
                transparent: true,
                opacity: 1.0,
                depthWrite: false
            });
            const mesh = new THREE.Mesh(fireGeo, fireMat);
            
            // Spawn around center
            mesh.position.set(
                pos.x + (Math.random() - 0.5) * 0.3,
                pos.y + (Math.random() - 0.5) * 0.3,
                pos.z + (Math.random() - 0.5) * 0.3
            );

            // Explosive spherical burst outward
            const phi = Math.random() * Math.PI * 2;
            const costheta = Math.random() * 2 - 1;
            const theta = Math.acos(costheta);
            const dir = new THREE.Vector3(
                Math.sin(theta) * Math.cos(phi),
                Math.sin(theta) * Math.sin(phi),
                Math.cos(theta)
            );
            const speed = 4.5 + Math.random() * 7.5;
            const velocity = dir.multiplyScalar(speed);
            velocity.y += 1.8 + Math.random() * 2.2; // Upward thermal buoyancy

            this.scene.add(mesh);
            const life = 0.55 + Math.random() * 0.35;
            this.explosionParticles.push({
                type: 'fire',
                mesh: mesh,
                velocity: velocity,
                buoyancy: 3.5,
                drag: 2.5,
                life: life,
                maxLife: life,
                baseScale: 1.0,
                rotSpeed: new THREE.Vector3(
                    (Math.random() - 0.5) * 12,
                    (Math.random() - 0.5) * 12,
                    (Math.random() - 0.5) * 12
                )
            });
        }

        // 4. Grey Smoke Particles (45 particles)
        const smokeColors = [0x4a4a4a, 0x606060, 0x787878, 0x909090, 0xa5a5a5, 0x3e3e3e];
        for (let i = 0; i < 45; i++) {
            const smokeGeo = new THREE.SphereGeometry(0.18 + Math.random() * 0.12, 7, 7);
            const color = smokeColors[Math.floor(Math.random() * smokeColors.length)];
            const smokeMat = new THREE.MeshBasicMaterial({
                color: color,
                transparent: true,
                opacity: 0.75,
                depthWrite: false
            });
            const mesh = new THREE.Mesh(smokeGeo, smokeMat);

            mesh.position.set(
                pos.x + (Math.random() - 0.5) * 0.4,
                pos.y + (Math.random() - 0.5) * 0.4,
                pos.z + (Math.random() - 0.5) * 0.4
            );

            // Smoke drifts outward and rises upwards
            const dir = new THREE.Vector3(
                (Math.random() - 0.5) * 2,
                Math.random() * 1.5,
                (Math.random() - 0.5) * 2
            ).normalize();
            const speed = 1.5 + Math.random() * 3.2;
            const velocity = dir.multiplyScalar(speed);
            velocity.y += 1.6 + Math.random() * 1.6;

            this.scene.add(mesh);
            const life = 1.4 + Math.random() * 0.8;
            this.explosionParticles.push({
                type: 'smoke',
                mesh: mesh,
                velocity: velocity,
                buoyancy: 2.2,
                drag: 1.8,
                life: life,
                maxLife: life,
                baseScale: 1.0,
                rotSpeed: new THREE.Vector3(
                    (Math.random() - 0.5) * 4,
                    (Math.random() - 0.5) * 4,
                    (Math.random() - 0.5) * 4
                )
            });
        }
    }

    playExplosionSound() {
        try {
            if (!this.audioCtx) return;
            if (this.audioCtx.state === 'suspended') {
                this.audioCtx.resume();
            }
            const now = this.audioCtx.currentTime;

            // 1. Noise buffer for explosion blast roar
            const bufferSize = Math.floor(this.audioCtx.sampleRate * 1.2);
            const noiseBuffer = this.audioCtx.createBuffer(1, bufferSize, this.audioCtx.sampleRate);
            const output = noiseBuffer.getChannelData(0);
            for (let i = 0; i < bufferSize; i++) {
                output[i] = Math.random() * 2 - 1;
            }

            const whiteNoise = this.audioCtx.createBufferSource();
            whiteNoise.buffer = noiseBuffer;

            const noiseFilter = this.audioCtx.createBiquadFilter();
            noiseFilter.type = 'lowpass';
            noiseFilter.frequency.setValueAtTime(850, now);
            noiseFilter.frequency.exponentialRampToValueAtTime(70, now + 1.1);

            const noiseGain = this.audioCtx.createGain();
            noiseGain.gain.setValueAtTime(0.85, now);
            noiseGain.gain.exponentialRampToValueAtTime(0.01, now + 1.15);

            whiteNoise.connect(noiseFilter);
            noiseFilter.connect(noiseGain);
            noiseGain.connect(this.audioCtx.destination);
            whiteNoise.start(now);
            whiteNoise.stop(now + 1.2);

            // 2. Heavy Sub-Bass detonation thump
            const osc = this.audioCtx.createOscillator();
            const oscGain = this.audioCtx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(150, now);
            osc.frequency.exponentialRampToValueAtTime(28, now + 0.8);

            oscGain.gain.setValueAtTime(0.95, now);
            oscGain.gain.exponentialRampToValueAtTime(0.01, now + 0.85);

            osc.connect(oscGain);
            oscGain.connect(this.audioCtx.destination);
            osc.start(now);
            osc.stop(now + 0.85);
        } catch (e) {
            console.error(e);
        }
    }

    updateExplosion(delta) {
        // Flash light fade
        if (this.explosionFlash) {
            this.explosionFlash.timer -= delta;
            if (this.explosionFlash.timer <= 0) {
                this.scene.remove(this.explosionFlash.light);
                this.explosionFlash = null;
            } else {
                const ratio = this.explosionFlash.timer / this.explosionFlash.maxTimer;
                this.explosionFlash.light.intensity = ratio * this.explosionFlash.maxIntensity;
            }
        }

        // Ring shockwave
        if (this.explosionRing) {
            this.explosionRing.timer -= delta;
            if (this.explosionRing.timer <= 0) {
                this.scene.remove(this.explosionRing.mesh);
                if (this.explosionRing.mesh.geometry && typeof this.explosionRing.mesh.geometry.dispose === 'function') {
                    this.explosionRing.mesh.geometry.dispose();
                }
                if (this.explosionRing.mesh.material && typeof this.explosionRing.mesh.material.dispose === 'function') {
                    this.explosionRing.mesh.material.dispose();
                }
                this.explosionRing = null;
            } else {
                const progress = 1 - (this.explosionRing.timer / this.explosionRing.maxTimer);
                const s = 1 + progress * 14;
                this.explosionRing.mesh.scale.set(s, s, 1);
                this.explosionRing.mesh.material.opacity = (1 - progress) * 0.85;
            }
        }

        // Explosion Particles (Yellowish Fire and Grey Smoke)
        for (let i = this.explosionParticles.length - 1; i >= 0; i--) {
            const p = this.explosionParticles[i];
            p.life -= delta;

            if (p.life <= 0) {
                this.scene.remove(p.mesh);
                if (p.mesh.geometry && typeof p.mesh.geometry.dispose === 'function') {
                    p.mesh.geometry.dispose();
                }
                if (p.mesh.material && typeof p.mesh.material.dispose === 'function') {
                    p.mesh.material.dispose();
                }
                this.explosionParticles.splice(i, 1);
                continue;
            }

            p.mesh.position.addScaledVector(p.velocity, delta);
            p.velocity.multiplyScalar(Math.max(0, 1 - delta * p.drag));
            p.velocity.y += p.buoyancy * delta;

            if (p.rotSpeed) {
                p.mesh.rotation.x += p.rotSpeed.x * delta;
                p.mesh.rotation.y += p.rotSpeed.y * delta;
                p.mesh.rotation.z += p.rotSpeed.z * delta;
            }

            const lifeRatio = p.life / p.maxLife;

            if (p.type === 'fire') {
                const scale = p.baseScale * (0.6 + 0.8 * Math.sin(lifeRatio * Math.PI));
                p.mesh.scale.set(scale, scale, scale);
                p.mesh.material.opacity = Math.min(1.0, lifeRatio * 1.6);
            } else if (p.type === 'smoke') {
                const expandFactor = 1.0 + (1 - lifeRatio) * 3.8;
                const scale = p.baseScale * expandFactor;
                p.mesh.scale.set(scale, scale, scale);
                p.mesh.material.opacity = lifeRatio * 0.75;
                p.velocity.x += (Math.random() - 0.5) * 0.3 * delta;
                p.velocity.z += (Math.random() - 0.5) * 0.3 * delta;
            }
        }
    }

    update(delta, camera, otherEnemies) {
        // Always update explosion effects and particles
        this.updateExplosion(delta);

        if (this.isDead || !this.crystal) {
            return;
        }

        this.time += delta;
        // Continuous rotation effect
        this.crystal.rotation.y += delta * 1.5;

        if (camera && !window.isDead && window.gameStarted) {
            const seesPlayer = this.canSeePlayer(camera);
            const distToPlayer = this.crystal.position.distanceTo(camera.position);

            if (seesPlayer) {
                // Chase player at 5m/s towards player's position
                const target = camera.position.clone();
                const flyDir = target.sub(this.crystal.position);
                const flyDist = flyDir.length();

                if (flyDist > 0.05) {
                    flyDir.normalize();
                    const moveDist = Math.min(this.speed * delta, flyDist);
                    const moveVec = flyDir.multiplyScalar(moveDist);
                    this.moveWithCollision(moveVec, camera, otherEnemies);
                }

                // Laser attack handling when in range and seeing player
                if (this.laserCooldown > 0) {
                    this.laserCooldown -= delta;
                }

                if (this.laserActiveTime > 0) {
                    this.laserActiveTime -= delta;
                    if (this.laserActiveTime <= 0) {
                        this.laserBeam.visible = false;
                        this.laserImpact.visible = false;
                    } else {
                        const hitInfo = this.checkLaserHit(camera);
                        if (hitInfo) {
                            this.updateLaserVisuals(hitInfo);
                            if (!this.hasDamagedThisShot && !hitInfo.isBlocked) {
                                if (window.damagePlayer) {
                                    window.damagePlayer(10);
                                }
                                this.hasDamagedThisShot = true;
                            }
                        }
                    }
                }

                // If close enough (within 30m) and laser cooldown ready
                if (distToPlayer <= 30 && this.laserCooldown <= 0) {
                    this.laserCooldown = 1.5;
                    this.laserActiveTime = 0.3;
                    this.hasDamagedThisShot = false;

                    this.playLaserSound();

                    const hitInfo = this.checkLaserHit(camera);
                    if (hitInfo) {
                        this.updateLaserVisuals(hitInfo);
                        if (!hitInfo.isBlocked) {
                            if (window.damagePlayer) {
                                window.damagePlayer(10);
                            }
                            this.hasDamagedThisShot = true;
                        }
                    }
                }
            } else {
                // Cannot see player (pillar in between): stop chasing and stop laser
                this.laserBeam.visible = false;
                this.laserImpact.visible = false;

                // Idle floating bob when stationary
                this.crystal.position.y += Math.sin(this.time * 2) * 0.002;
                this.crystal.position.y = Math.max(this.radius, Math.min(4.2 - this.radius, this.crystal.position.y));
            }
        } else {
            this.laserBeam.visible = false;
            this.laserImpact.visible = false;
        }
    }
}

class EnemyManager {
    constructor(scene) {
        this.scene = scene;
        this.loader = new THREE.GLTFLoader();
        this.enemies = [];
        this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }

    // Deep clone crystal model and give each clone its own material instances so hit flashing is independent
    cloneCrystalModel(originalCrystal) {
        const clonedGroup = originalCrystal.clone(true);
        clonedGroup.traverse((child) => {
            if (child.isMesh && child.material) {
                if (Array.isArray(child.material)) {
                    child.material = child.material.map(m => m.clone());
                } else {
                    child.material = child.material.clone();
                }
            }
        });
        return clonedGroup;
    }

    // Generate random positions spread across the station away from pillars, player start, and existing enemies
    getRandomSpawnPosition(existingPositions) {
        const minPlayerDist = 16.0;
        const minEnemyDist = 12.0;
        const ENEMY_RADIUS = 0.5;
        const playerStart = new THREE.Vector3(0, 1.6, 10);
        const pillarBoxes = (window.colliders && window.colliders.length > 0) ? window.colliders : [];

        for (let attempts = 0; attempts < 300; attempts++) {
            // Station bounds: x in [-36, 36], z in [-36, 36]
            const x = (Math.random() - 0.5) * 72;
            const z = (Math.random() - 0.5) * 72;
            const y = 1.8 + Math.random() * 0.6; // between 1.8m and 2.4m

            const candidate = new THREE.Vector3(x, y, z);

            // Avoid player start position
            if (candidate.distanceTo(playerStart) < minPlayerDist) {
                continue;
            }

            // Avoid other enemy positions
            let tooClose = false;
            for (const pos of existingPositions) {
                if (candidate.distanceTo(pos) < minEnemyDist) {
                    tooClose = true;
                    break;
                }
            }
            if (tooClose) continue;

            // Avoid pillars
            let collidesPillar = false;
            for (const box of pillarBoxes) {
                const cx = Math.max(box.min.x, Math.min(candidate.x, box.max.x));
                const cy = Math.max(box.min.y, Math.min(candidate.y, box.max.y));
                const cz = Math.max(box.min.z, Math.min(candidate.z, box.max.z));
                const distSq = (candidate.x - cx) ** 2 + (candidate.y - cy) ** 2 + (candidate.z - cz) ** 2;
                if (distSq < (ENEMY_RADIUS + 0.9) ** 2) {
                    collidesPillar = true;
                    break;
                }
            }
            if (collidesPillar) continue;

            return candidate;
        }

        // Guaranteed fallback positions in open station corridors
        const fallbacks = [
            new THREE.Vector3(-24, 2.0, -16),
            new THREE.Vector3(24, 2.0, -16),
            new THREE.Vector3(-16, 2.0, 24),
            new THREE.Vector3(16, 2.0, 24),
            new THREE.Vector3(0, 2.0, 32)
        ];
        for (const fb of fallbacks) {
            if (!existingPositions.some(p => p.distanceTo(fb) < 6.0)) {
                return fb;
            }
        }
        return new THREE.Vector3(-20, 2.0, -20);
    }

    load() {
        this.loader.load('model/crystal.glb', (gltf) => {
            const baseCrystal = gltf.scene;

            // Adjust size to approx 1m diameter
            const box = new THREE.Box3().setFromObject(baseCrystal);
            const size = box.getSize(new THREE.Vector3());
            const maxDim = Math.max(size.x, size.y, size.z);
            if (maxDim > 0) {
                const scale = 1.0 / maxDim;
                baseCrystal.scale.set(scale, scale, scale);

                // Add spherical hitbox in local coordinate space to guarantee responsive raycast hits
                const hitGeo = new THREE.SphereGeometry(0.65 * maxDim, 12, 12);
                const hitMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
                const hitbox = new THREE.Mesh(hitGeo, hitMat);
                hitbox.name = 'enemyHitbox';
                baseCrystal.add(hitbox);
            }

            // 1. Original enemy at (0, 2, -40)
            const origPos = new THREE.Vector3(0, 2, -40);
            const origEnemy = new SingleEnemy(this.scene, this.audioCtx, baseCrystal, origPos, 1);
            this.enemies.push(origEnemy);

            const spawnedPositions = [origPos];

            // 2 & 3. Clone 2 more enemies from the original one placed at random positions
            for (let i = 0; i < 2; i++) {
                const clonedCrystal = this.cloneCrystalModel(baseCrystal);
                const randomPos = this.getRandomSpawnPosition(spawnedPositions);
                spawnedPositions.push(randomPos);

                const clonedEnemy = new SingleEnemy(this.scene, this.audioCtx, clonedCrystal, randomPos, i + 2);
                this.enemies.push(clonedEnemy);
                console.log(`Cloned Enemy #${i + 2} spawned at (${randomPos.x.toFixed(1)}, ${randomPos.y.toFixed(1)}, ${randomPos.z.toFixed(1)})`);
            }

            if (window.updateEnemyHealthUI) {
                window.updateEnemyHealthUI(100, 100);
            }
        }, undefined, (error) => {
            console.error('An error happened loading the crystal enemy:', error);
        });
    }

    // Get all alive enemy crystal roots for raycasting
    getEnemyTargets() {
        return this.enemies
            .filter(e => !e.isDead && e.crystal)
            .map(e => e.crystal);
    }

    // Check if an object belongs to any enemy
    isEnemyObject(object) {
        return this.enemies.some(e => e.isEnemyObject(object));
    }

    // Find the specific enemy that owns the hit object
    getHitEnemy(object) {
        return this.enemies.find(e => e.isEnemyObject(object)) || null;
    }

    // Backward compatibility getters
    get crystal() {
        const alive = this.enemies.find(e => !e.isDead);
        return alive ? alive.crystal : (this.enemies[0] ? this.enemies[0].crystal : null);
    }

    get isDead() {
        return this.enemies.length > 0 && this.enemies.every(e => e.isDead);
    }

    get health() {
        const alive = this.enemies.find(e => !e.isDead);
        return alive ? alive.health : 0;
    }

    get maxHealth() {
        return 100;
    }

    // Take damage backward compatibility
    takeDamage(amount, hitPoint, hitObject) {
        if (hitObject) {
            const hitEnemy = this.getHitEnemy(hitObject);
            if (hitEnemy) {
                hitEnemy.takeDamage(amount, hitPoint);
                return;
            }
        }
        // Fallback: apply to closest alive enemy to hitPoint, or first alive
        let targetEnemy = null;
        let minDist = Infinity;
        for (const enemy of this.enemies) {
            if (enemy.isDead || !enemy.crystal) continue;
            const d = enemy.crystal.position.distanceTo(hitPoint);
            if (d < minDist) {
                minDist = d;
                targetEnemy = enemy;
            }
        }
        if (targetEnemy) {
            targetEnemy.takeDamage(amount, hitPoint);
        }
    }

    update(delta, camera) {
        for (const enemy of this.enemies) {
            enemy.update(delta, camera, this.enemies);
        }
    }
}

let enemyManager = null;

function initEnemy(scene) {
    enemyManager = new EnemyManager(scene);
    enemyManager.load();
    window.enemyManager = enemyManager;
}

function updateEnemy(delta, camera) {
    if (enemyManager) {
        enemyManager.update(delta, camera);
    }
}
