class EnemyManager {
    constructor(scene) {
        this.scene = scene;
        this.crystal = null;
        this.loader = new THREE.GLTFLoader();
        this.time = 0;
        
        // Enemy physics & flight parameters
        this.speed = 5.0; // 5m per second
        this.radius = 0.5; // ~1m diameter sphere collider
        
        // Laser setup
        this.laserCooldown = 0;
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
        
        this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }

    load() {
        this.loader.load('model/crystal.glb', (gltf) => {
            this.crystal = gltf.scene;
            
            // Adjust the size to approx 1m diameter
            const box = new THREE.Box3().setFromObject(this.crystal);
            const size = box.getSize(new THREE.Vector3());
            const maxDim = Math.max(size.x, size.y, size.z);
            if (maxDim > 0) {
                const scale = 1.0 / maxDim;
                this.crystal.scale.set(scale, scale, scale);
            }
            
            // Position: 10m from the far back wall (z = -40), 2m above ground
            this.crystal.position.set(0, 2, -40);
            
            this.scene.add(this.crystal);
        }, undefined, (error) => {
            console.error('An error happened loading the crystal enemy:', error);
        });
    }

    playLaserSound() {
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
        if (!this.crystal || !camera) return false;

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
        if (!this.crystal || !camera) return null;

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
    // Cannot pass through player controller body, but can fly over his head!
    checkPlayerCollision(testPos, camera) {
        const PLAYER_RADIUS = 0.45;
        const ENEMY_RADIUS = this.radius;
        const minDistXZ = PLAYER_RADIUS + ENEMY_RADIUS; // 0.95m
        
        // If bottom of enemy is at or above player's head, it can freely fly over him
        if (testPos.y - ENEMY_RADIUS >= camera.position.y) {
            return false;
        }

        // Enemy is at player body height: enforce horizontal cylinder collider
        const dx = testPos.x - camera.position.x;
        const dz = testPos.z - camera.position.z;
        const distXZ = Math.sqrt(dx * dx + dz * dz);

        return distXZ < minDistXZ;
    }

    // Move enemy with 3D collision resolution against pillars, ceiling, floor, walls, and player
    moveWithCollision(moveVec, camera) {
        const ENEMY_RADIUS = this.radius;
        const boxes = this.getPillarBoxes();
        const currentPos = this.crystal.position.clone();

        // 1. Move along X
        if (moveVec.x !== 0) {
            let testX = currentPos.x + moveVec.x;
            // Outer station walls at x = ±49.5
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
            if (!collidesX) {
                currentPos.x = testX;
            }
        }

        // 2. Move along Z
        if (moveVec.z !== 0) {
            let testZ = currentPos.z + moveVec.z;
            // Outer station walls at z = ±49.5
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
            if (!collidesZ) {
                currentPos.z = testZ;
            }
        }

        // 3. Move along Y
        if (moveVec.y !== 0) {
            let testY = currentPos.y + moveVec.y;
            // Floor is at y=0, ceiling is at y=4.2m
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
            if (!collidesY) {
                currentPos.y = testY;
            }
        }

        this.crystal.position.copy(currentPos);
    }

    update(delta, camera) {
        if (this.crystal) {
            this.time += delta;
            // Add a continuous rotation effect
            this.crystal.rotation.y += delta * 1.5;
            
            if (camera && !window.isDead && window.gameStarted) {
                // Check if the enemy can see the player (no pillars or walls blocking line of sight)
                const seesPlayer = this.canSeePlayer(camera);
                const distToPlayer = this.crystal.position.distanceTo(camera.position);

                if (seesPlayer) {
                    // Enemy chases the player at 5m per second towards player's position
                    // Aim flight towards player's camera position
                    const target = camera.position.clone();
                    const flyDir = target.sub(this.crystal.position);
                    const flyDist = flyDir.length();

                    if (flyDist > 0.05) {
                        flyDir.normalize();
                        const moveDist = Math.min(this.speed * delta, flyDist);
                        const moveVec = flyDir.multiplyScalar(moveDist);
                        this.moveWithCollision(moveVec, camera);
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
}

let enemyManager = null;

function initEnemy(scene) {
    enemyManager = new EnemyManager(scene);
    enemyManager.load();
}

function updateEnemy(delta, camera) {
    if (enemyManager) {
        enemyManager.update(delta, camera);
    }
}
