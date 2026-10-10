class EnemyManager {
    constructor(scene) {
        this.scene = scene;
        this.crystal = null;
        this.loader = new THREE.GLTFLoader();
        this.time = 0;
        
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

        // If an obstacle (wall or pillar) is between the crystal and the player
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

        // The laser beam originates at the enemy and aims towards the player
        this.laserBeam.position.copy(hitInfo.origin);
        this.laserBeam.lookAt(hitInfo.aimTarget);
        
        // If it hits a wall or pillar, scale is limited to hitDistance so it cannot pass through
        this.laserBeam.scale.set(1, 1, hitInfo.hitDistance);
        this.laserBeam.visible = true;

        if (hitInfo.isBlocked) {
            this.laserImpact.position.copy(hitInfo.hitPoint);
            this.laserImpact.visible = true;
        } else {
            this.laserImpact.visible = false;
        }
    }

    update(delta, camera) {
        if (this.crystal) {
            this.time += delta;
            // Add a floating effect
            this.crystal.position.y = 2 + Math.sin(this.time * 2) * 0.2;
            // Add a rotation effect
            this.crystal.rotation.y += delta * 1.0;
            
            if (camera && !window.isDead && window.gameStarted) {
                const dist = this.crystal.position.distanceTo(camera.position);
                
                if (this.laserCooldown > 0) {
                    this.laserCooldown -= delta;
                }
                
                if (this.laserActiveTime > 0) {
                    this.laserActiveTime -= delta;
                    if (this.laserActiveTime <= 0) {
                        this.laserBeam.visible = false;
                        this.laserImpact.visible = false;
                    } else {
                        // Dynamically update laser path and obstacle collision each frame
                        const hitInfo = this.checkLaserHit(camera);
                        if (hitInfo) {
                            this.updateLaserVisuals(hitInfo);

                            // If player moves out from behind cover while beam is still active
                            if (!this.hasDamagedThisShot && !hitInfo.isBlocked) {
                                if (window.damagePlayer) {
                                    window.damagePlayer(10);
                                }
                                this.hasDamagedThisShot = true;
                            }
                        }
                    }
                }
                
                // If close enough and cooldown is ready
                if (dist <= 30 && this.laserCooldown <= 0) {
                    this.laserCooldown = 1.5; // Takes 1.5 seconds to recharge
                    this.laserActiveTime = 0.3; // Laser is visible for 0.3 seconds
                    this.hasDamagedThisShot = false;

                    this.playLaserSound();
                    
                    const hitInfo = this.checkLaserHit(camera);
                    if (hitInfo) {
                        this.updateLaserVisuals(hitInfo);

                        // Only damage the player if the laser was NOT blocked by a wall or pillar
                        if (!hitInfo.isBlocked) {
                            if (window.damagePlayer) {
                                window.damagePlayer(10);
                            }
                            this.hasDamagedThisShot = true;
                        }
                    }
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
