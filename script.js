// =======================
// 全局变量与初始化
// =======================
const PARTICLE_COUNT = 20000;
let PARTICLE_SIZE = 0.24;
let scene, camera, renderer, particles, geometry, material;
let currentPositions = [];
let targetPositions = [];

// 关键变量：存储用户选择的基础模型名称 (用于回归)
let selectedBaseModelName = 'saturn';
// 记录当前显示的形状名称
let currentShapeName = 'saturn';

// 交互因子（手部缩放）
let handInteractionFactor = 0;
let targetColor = new THREE.Color(0x9600CC);

// 旋转追踪状态
let lastHandX = null;
let rotationVelocity = 0;
const DAMPING_FACTOR = 0.92;
// 增强旋转灵敏度
const ROTATION_SENSITIVITY = 0.8;

// 手势形状控制状态
let gestureMorphingEnabled = true;
// 记录上一个手势，用于避免频繁调用 morphTo
let lastDetectedGesture = null;

// --- 新增：左右手控制状态 ---
let isLeftHandEnabled = true;
let isRightHandEnabled = true;

const loader = document.getElementById('loader');
const statusDot = document.getElementById('status-dot');
const previewCanvas = document.getElementById('preview_canvas');
const previewCtx = previewCanvas.getContext('2d');
const gestureDisplay = document.getElementById('current-gesture-display');

// LLM 相关元素
const llmPrompt = document.getElementById('llm-prompt');
const llmResponse = document.getElementById('llm-response');
const llmButton = document.getElementById('generate-description-btn');
const llmLoading = document.getElementById('llm-loading');


// 数字模型的统一缩放因子
const NUMBER_SCALE = 10;

// =======================
// 1. Three.js 场景设置
// =======================
function initThree() {
    const container = document.getElementById('canvas-container');

    scene = new THREE.Scene();
    // FIX: 降低雾气密度，解决模型显示"一半"的问题
    scene.fog = new THREE.FogExp2(0x050505, 0.008);

    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.z = 30;

    renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true
    });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(renderer.domElement);

    const sprite = getSprite();
    material = new THREE.PointsMaterial({
        size: PARTICLE_SIZE,
        map: sprite,
        blending: THREE.AdditiveBlending,
        depthTest: false,
        transparent: true,
        color: targetColor,
        opacity: 0.8
    });

    geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(PARTICLE_COUNT * 3);

    for (let i = 0; i < PARTICLE_COUNT; i++) {
        positions[i * 3] = (Math.random() - 0.5) * 100;
        positions[i * 3 + 1] = (Math.random() - 0.5) * 100;
        positions[i * 3 + 2] = (Math.random() - 0.5) * 100;
        currentPositions.push(new THREE.Vector3(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]));
        targetPositions.push(new THREE.Vector3(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]));
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    particles = new THREE.Points(geometry, material);
    scene.add(particles);

    window.addEventListener('resize', onWindowResize, false);
    // 初始加载用户选择的模型
    handleModelSelection(selectedBaseModelName, true); // 强制切换并设置为当前模型

    animate();
}

function getSprite() {
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 32;
    const context = canvas.getContext('2d');
    const gradient = context.createRadialGradient(16, 16, 0, 16, 16, 16);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.2, 'rgba(255,255,255,0.8)');
    gradient.addColorStop(0.5, 'rgba(255,255,255,0.2)');
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, 32, 32);
    const texture = new THREE.Texture(canvas);
    texture.needsUpdate = true;
    return texture;
}

// =======================
// 2. 数学模型生成器
// =======================

// 辅助函数：沿两点间的线段插值
function lerpPoint(p1, p2, t) {
    return {
        x: p1.x + (p2.x - p1.x) * t,
        y: p1.y + (p2.y - p1.y) * t,
        z: p1.z + (p2.z - p1.z) * t
    };
}

// 辅助函数：贝塞尔曲线插值 (二次贝塞尔，用于平滑曲线)
function quadraticBezier(p0, p1, p2, t) {
    const x = (1 - t) * (1 - t) * p0.x + 2 * (1 - t) * t * p1.x + t * t * p2.x;
    const y = (1 - t) * (1 - t) * p0.y + 2 * (1 - t) * t * p1.y + t * t * p2.y;
    const z = (1 - t) * (1 - t) * p0.z + 2 * (1 - t) * t * p1.z + t * t * p2.z;
    return {
        x,
        y,
        z
    };
}

// 辅助函数：添加厚度
function addThickness(pos, thickness = 1.5) {
    const randomAngle = Math.random() * Math.PI * 2;
    // 减小随机半径波动，让厚度更均匀
    const randomRadius = (Math.random() - 0.5) * 0.1;
    const zOffset = (Math.random() - 0.5) * thickness;

    return {
        x: pos.x + randomRadius * Math.cos(randomAngle),
        y: pos.y + randomRadius * Math.sin(randomAngle),
        z: pos.z + zOffset
    };
}

const Shapes = {
    sphere: (i) => {
        const phi = Math.acos(-1 + (2 * i) / PARTICLE_COUNT);
        const theta = Math.sqrt(PARTICLE_COUNT * Math.PI) * phi;
        const r = 10;
        return {
            x: r * Math.cos(theta) * Math.sin(phi),
            y: r * Math.sin(theta) * Math.sin(phi),
            z: r * Math.cos(phi)
        };
    },
    heart: (i) => {
        const t = (i / PARTICLE_COUNT) * Math.PI * 2;
        const x = 16 * Math.pow(Math.sin(t), 3) * 0.8;
        const y = (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) *
        0.8;
        const z = (Math.random() - 0.5) * 4;
        return {
            x,
            y,
            z
        };
    },
    flower: (i) => {
        const r = 10 * Math.sqrt(i / PARTICLE_COUNT);
        const theta = i * 2.4;
        const y = Math.sin(r / 2) * 5;
        return {
            x: r * Math.cos(theta),
            y: y - 5,
            z: r * Math.sin(theta)
        };
    },
    saturn: (i) => {
        if (i < PARTICLE_COUNT * 0.7) {
            const phi = Math.acos(-1 + (2 * i) / (PARTICLE_COUNT * 0.7));
            const theta = Math.sqrt((PARTICLE_COUNT * 0.7) * Math.PI) * phi;
            const r = 6;
            return {
                x: r * Math.cos(theta) * Math.sin(phi),
                y: r * Math.sin(theta) * Math.sin(phi),
                z: r * Math.cos(phi)
            };
        } else {
            const angle = (i / (PARTICLE_COUNT * 0.3)) * Math.PI * 20;
            const radius = 9 + Math.random() * 6;
            return {
                x: radius * Math.cos(angle),
                y: (Math.random() - 0.5) * 0.5,
                z: radius * Math.sin(angle)
            };
        }
    },
    torus: (i) => {
        // 甜甜圈 (Torus) 参数
        const R = 10; // 大半径
        const r = 3; // 小半径
        const t = i / PARTICLE_COUNT * Math.PI * 2; // 沿大圆的角
        const u = Math.random() * Math.PI * 2; // 沿小圆的随机角

        // 随机点在小圆上的偏移
        const r_rand = r + (Math.random() - 0.5) * 2.5;

        // Torus 方程
        const x = (R + r_rand * Math.cos(u)) * Math.cos(t);
        const y = r_rand * Math.sin(u);
        const z = (R + r_rand * Math.cos(u)) * Math.sin(t);
        return {
            x,
            y,
            z
        };
    },

    // --- 优化的数字形状 ---

    // 1: 垂直长条
    one: (i) => {
        const t = i / PARTICLE_COUNT; // 0 to 1
        const SCALE = NUMBER_SCALE;
        const p1 = {
            x: 0,
            y: -0.5 * SCALE,
            z: 0
        };
        const p2 = {
            x: 0,
            y: 0.5 * SCALE,
            z: 0
        };
        const pos = lerpPoint(p1, p2, t);
        // FIX: 增加数字厚度，使其更清晰
        return addThickness(pos, 4.0);
    },

    // 2: 顶部曲线, 中部斜线, 底部横线
    two: (i) => {
        const SCALE = NUMBER_SCALE;
        const segment1Count = Math.floor(PARTICLE_COUNT * 0.40);
        const segment2Count = Math.floor(PARTICLE_COUNT * 0.40);
        let pos = {
            x: 0,
            y: 0,
            z: 0
        };

        if (i < segment1Count) { // 顶部曲线
            const t = i / segment1Count;
            const p0 = {
                x: -0.4 * SCALE,
                y: 0.5 * SCALE,
                z: 0
            };
            const p1 = {
                x: 0.4 * SCALE,
                y: 0.8 * SCALE,
                z: 0
            };
            const p2 = {
                x: 0.6 * SCALE,
                y: 0.0 * SCALE,
                z: 0
            };
            pos = quadraticBezier(p0, p1, p2, t);
        } else if (i < segment1Count + segment2Count) { // 中部斜线
            const t = (i - segment1Count) / segment2Count;
            const p1 = {
                x: 0.6 * SCALE,
                y: 0.0 * SCALE,
                z: 0
            };
            const p2 = {
                x: -0.5 * SCALE,
                y: -0.5 * SCALE,
                z: 0
            };
            pos = lerpPoint(p1, p2, t);
        } else { // 底部横线
            const t = (i - (segment1Count + segment2Count)) / (PARTICLE_COUNT - (segment1Count +
                segment2Count));
            const p1 = {
                x: -0.5 * SCALE,
                y: -0.5 * SCALE,
                z: 0
            };
            const p2 = {
                x: 0.5 * SCALE,
                y: -0.5 * SCALE,
                z: 0
            };
            pos = lerpPoint(p1, p2, t);
        }

        // FIX: 增加数字厚度，使其更清晰
        return addThickness(pos, 4.0);
    },

    // 3: 两个半圆/曲线
    three: (i) => {
        const SCALE = NUMBER_SCALE;
        const halfCount = PARTICLE_COUNT / 2;
        let pos = {
            x: 0,
            y: 0,
            z: 0
        };

        if (i < halfCount) { // 上半部分
            const t = i / halfCount;
            const p0 = {
                x: -0.5 * SCALE,
                y: 0.5 * SCALE,
                z: 0
            };
            const p1 = {
                x: 0.8 * SCALE,
                y: 0.5 * SCALE,
                z: 0
            };
            const p2 = {
                x: -0.2 * SCALE,
                y: 0.0 * SCALE,
                z: 0
            };
            pos = quadraticBezier(p0, p1, p2, t);
        } else { // 下半部分
            const t = (i - halfCount) / halfCount;
            const p0 = {
                x: -0.2 * SCALE,
                y: 0.0 * SCALE,
                z: 0
            };
            // FIX: 将下半部分改为二次贝塞尔曲线，使其更圆润
            const p1 = {
                x: 0.8 * SCALE,
                y: -0.6 * SCALE,
                z: 0
            };
            const p2 = {
                x: -0.5 * SCALE,
                y: -0.5 * SCALE,
                z: 0
            };
            pos = quadraticBezier(p0, p1, p2, t);
        }

        // FIX: 增加数字厚度，使其更清晰
        return addThickness(pos, 4.0);
    }
};

/**
 * 切换粒子模型的目标形状。
 * @param {string} shapeName - 形状名称 (e.g., 'saturn', 'one')
 */
function morphTo(shapeName) {
    currentShapeName = shapeName; // 更新当前形状名称
    const generator = Shapes[shapeName] || Shapes['sphere'];
    for (let i = 0; i < PARTICLE_COUNT; i++) {
        const pos = generator(i);
        targetPositions[i].set(pos.x, pos.y, pos.z);
    }
}

// =======================
// 3. MediaPipe 手势识别与数字识别逻辑
// =======================

// 实用函数：判断手指是否伸展 (用于食指, 中指, 无名指, 小指)
function isFingerExtended(landmarks, tipIndex, mcpIndex) {
    const tip = landmarks[tipIndex];
    const mcp = landmarks[mcpIndex];
    const pip = landmarks[tipIndex - 2];

    // 检查指尖 Y 轴位置是否高于 PIP 关节 (Y 轴越小越靠上)
    const isTipHigherThanPip = tip.y < pip.y;

    // 检查指尖与 MCP 之间的 3D 距离
    const distTipMcp = Math.sqrt(
        Math.pow(tip.x - mcp.x, 2) +
        Math.pow(tip.y - mcp.y, 2) +
        Math.pow(tip.z - mcp.z, 2)
    );
    // 调整阈值，让伸展更容易识别
    const extendedThreshold = 0.10;

    return isTipHigherThanPip && distTipMcp > extendedThreshold;
}

// 实用函数：判断拇指是否收拢 (Tucked In)
function isThumbTucked(landmarks) {
    const thumbTip = landmarks[4];
    const indexMcp = landmarks[5]; // 食指根部作为参考点

    // 如果拇指尖靠近食指根部 (距离小于 0.18)，则认为是收拢状态。
    const dist2D = Math.sqrt(
        Math.pow(thumbTip.x - indexMcp.x, 2) +
        Math.pow(thumbTip.y - indexMcp.y, 2)
    );
    return dist2D < 0.18;
}

/**
 * 基于手部关键点计算旋转和缩放交互因子。
 * 这是一个独立的函数，无论手势切换开关状态如何，只要需要交互时就调用。
 * @param {Array<Object>} landmarks - MediaPipe手部关键点
 */
function calculateHandInteractions(landmarks) {
    const wrist = landmarks[0];

    // 粒子旋转控制 (手部水平移动)
    if (lastHandX !== null) {
        const dx = wrist.x - lastHandX;
        rotationVelocity += dx * ROTATION_SENSITIVITY;
    }
    lastHandX = wrist.x;

    // 粒子大小控制 (拇指小指距离)
    const thumbTip = landmarks[4];
    const pinkyTip = landmarks[20];
    const distance = Math.sqrt(
        Math.pow(thumbTip.x - pinkyTip.x, 2) +
        Math.pow(thumbTip.y - pinkyTip.y, 2)
    );
    const minD = 0.10;
    const maxD = 0.6;
    let normalized = (distance - minD) / (maxD - minD);
    normalized = Math.min(Math.max(normalized, 0), 1);
    // 增强缩放/扩散因子范围
    handInteractionFactor = (normalized - 0.5) * 6;
}

const videoElement = document.getElementById('input_video');

// 修改：完全重写的 onResults 函数，支持左右手过滤
function onResults(results) {
    // --- 新增逻辑：筛选有效的手 ---
    let activeLandmarks = null; // 用于存储"主要控制手"的关键点

    if (results.multiHandLandmarks && results.multiHandedness) {
        // 遍历检测到的每一只手
        for (let i = 0; i < results.multiHandLandmarks.length; i++) {
            const label = results.multiHandedness[i].label; // "Left" 或 "Right"
            const landmarks = results.multiHandLandmarks[i];

            // 检查当前手是否被允许
            const isAllowed = (label === 'Left' && isLeftHandEnabled) ||
                (label === 'Right' && isRightHandEnabled);

            if (isAllowed) {
                // 在预览窗口绘制这只手（应用镜像变换，与视频画面方向一致）
                previewCtx.save();
                previewCtx.scale(-1, 1);
                previewCtx.translate(-previewCanvas.width, 0);
                drawConnectors(previewCtx, landmarks, HAND_CONNECTIONS, {
                    color: '#00FF00',
                    lineWidth: 2
                });
                drawLandmarks(previewCtx, landmarks, {
                    color: '#FF0000',
                    lineWidth: 1,
                    radius: 3
                });
                previewCtx.restore();

                // 如果还没有选定"主控手"，则将这只手作为主控手（用于旋转、缩放等交互）
                if (!activeLandmarks) {
                    activeLandmarks = landmarks;
                }
            }
        }
    }

    // --- 如果检测到了有效的手 (activeLandmarks)，执行交互逻辑 ---
    if (activeLandmarks) {
        statusDot.classList.replace('bg-red-500', 'bg-green-500');
        statusDot.classList.replace('shadow-[0_0_8px_rgba(239,68,68,0.8)]',
            'shadow-[0_0_8px_rgba(34,197,94,0.8)]');

        const landmarks = activeLandmarks; // 使用筛选出的有效手

        // 检查所有非拇指手指的伸展状态
        const isIndexExtended = isFingerExtended(landmarks, 8, 5);
        const isMiddleExtended = isFingerExtended(landmarks, 12, 9);
        const isRingExtended = isFingerExtended(landmarks, 16, 13);
        const isPinkyExtended = isFingerExtended(landmarks, 20, 17);
        const isThumbTuckedIn = isThumbTucked(landmarks);

        // --- 手势形状切换逻辑 ---
        if (gestureMorphingEnabled) {

            let detectedShape = null;
            let gestureName = 'Regression';
            let isNumberGestureDetected = false; // <-- 标志：是否检测到 1, 2, 3

            // 1: 
            if (isThumbTuckedIn && isIndexExtended && !isMiddleExtended && !isRingExtended && !
                isPinkyExtended) {
                detectedShape = 'one';
                gestureName = '1 (食指)';
                isNumberGestureDetected = true;
            }
            // 2: 
            else if (isThumbTuckedIn && isIndexExtended && isMiddleExtended && !isRingExtended && !
                isPinkyExtended) {
                detectedShape = 'two';
                gestureName = '2 (食指+中指)';
                isNumberGestureDetected = true;
            }
            // 3: 
            else if (isThumbTuckedIn && isIndexExtended && isMiddleExtended && isRingExtended && !
                isPinkyExtended) {
                detectedShape = 'three';
                gestureName = '3 (三指)';
                isNumberGestureDetected = true;
            }
            // 其他状态 (回归到用户选择的基础模型)
            else {
                detectedShape = selectedBaseModelName;
                gestureName = 'Regression';
                isNumberGestureDetected = false;
            }

            // **交互控制细化：**
            if (isNumberGestureDetected) {
                // 优先级 1: 检测到 1/2/3。禁用所有交互，专注于形状切换。
                lastHandX = null;
                rotationVelocity = 0;
                handInteractionFactor = 0;
                gestureDisplay.textContent = `当前手势/模型: ${detectedShape.toUpperCase()} (锁定交互)`;
            } else {
                // 优先级 2: 未检测到 1/2/3 (回归模式)。允许交互。
                calculateHandInteractions(landmarks);
                gestureDisplay.textContent = `当前手势/模型: ${selectedBaseModelName.toUpperCase()} (交互中)`;
            }

            // 只有当检测到新的形状时才进行 Morphing
            if (detectedShape && lastDetectedGesture !== detectedShape) {
                morphTo(detectedShape);
                lastDetectedGesture = detectedShape;
            }

        } else {
            // 手势控制关闭时 (默认交互模式)
            calculateHandInteractions(landmarks);

            // 确保在交互模式下，lastDetectedGesture 保持为当前形状，防止误切换
            lastDetectedGesture = currentShapeName;
            gestureDisplay.textContent = `当前手势/模型: ${currentShapeName.toUpperCase()} (交互模式)`;
        }


    } else {
        // 没有有效手被检测到 (或者被过滤掉了)
        statusDot.classList.replace('bg-green-500', 'bg-red-500');
        statusDot.classList.replace('shadow-[0_0_8px_rgba(34,197,94,0.8)]',
            'shadow-[0_0_8px_rgba(239,68,68,0.8)]');

        // 无手部检测时，清空交互状态
        handInteractionFactor = THREE.MathUtils.lerp(handInteractionFactor, 0, 0.05);
        lastHandX = null;

        // 如果手势控制开启，且手部消失，模型回归到基础模型
        if (gestureMorphingEnabled && lastDetectedGesture !== selectedBaseModelName) {
            morphTo(selectedBaseModelName);
            lastDetectedGesture = selectedBaseModelName;
            gestureDisplay.textContent = `当前手势/模型: ${selectedBaseModelName.toUpperCase()} (No Hand)`;
        } else if (!gestureMorphingEnabled) {
            gestureDisplay.textContent = `当前手势/模型: ${currentShapeName.toUpperCase()} (No Hand)`;
        }
    }

}

// 使用 CDN 版本的 MediaPipe 资源（你本机已开代理）
const hands = new Hands({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
});
// 修改：将 maxNumHands 改为 2，以支持双手同时检测并进行筛选
hands.setOptions({
    maxNumHands: 2,
    modelComplexity: 1,
    minDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5
});
hands.onResults(onResults);

/**
 * 使用原生 getUserMedia 而不是 MediaPipe Camera 工具，
 * 避免某些环境下 Camera 类不工作导致画面黑屏。
 */
async function initCamera() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: {
                width: 320,
                height: 240,
                facingMode: 'user'
            },
            audio: false
        });

        videoElement.srcObject = stream;

        await new Promise((resolve) => {
            videoElement.onloadedmetadata = () => {
                videoElement.play().then(resolve).catch(resolve);
            };
        });

        // 启动基础预览循环：即使 Hand 识别失败也能看到画面
        function drawPreviewLoop() {
            if (videoElement.readyState >= 2) {
                previewCanvas.width = videoElement.videoWidth || 320;
                previewCanvas.height = videoElement.videoHeight || 240;

                previewCtx.save();
                previewCtx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
                previewCtx.scale(-1, 1);
                previewCtx.translate(-previewCanvas.width, 0);
                previewCtx.drawImage(videoElement, 0, 0, previewCanvas.width, previewCanvas.height);
                previewCtx.restore();
            }
            requestAnimationFrame(drawPreviewLoop);
        }
        requestAnimationFrame(drawPreviewLoop);

        // 关闭加载遮罩
        loader.style.opacity = '0';
        setTimeout(() => loader.style.display = 'none', 500);

        // 使用 requestAnimationFrame 持续向 Hands 发送帧（若可用）
        async function frameLoop() {
            if (videoElement.readyState >= 2) {
                try {
                    await hands.send({
                        image: videoElement
                    });
                } catch (e) {
                    console.warn('Hands 处理帧失败，将仅显示摄像头预览。', e);
                }
            }
            requestAnimationFrame(frameLoop);
        }
        requestAnimationFrame(frameLoop);
    } catch (err) {
        console.error('无法访问摄像头: ', err);
        loader.innerHTML = `<p class="text-red-500">无法访问摄像头。<br>请在浏览器中允许摄像头权限，或检查系统隐私设置。</p>`;
    }
}


// =======================
// 4. 动画循环与交互逻辑 (已优化：数字自动回正)
// =======================
let time = 0;

function animate() {
    requestAnimationFrame(animate);
    time += 0.005;

    material.color.lerp(targetColor, 0.05);

    // --- 核心修复：旋转逻辑分流 ---
    const isNumberShape = ['one', 'two', 'three'].includes(currentShapeName);

    if (isNumberShape) {
        // 【数字模式】：强制回正
        // 计算当前旋转角度相对于 2PI 的最近倍数，防止倒转
        const cycle = Math.PI * 2;
        const targetRotation = Math.round(particles.rotation.y / cycle) * cycle;

        // 平滑插值 (Lerp)
        particles.rotation.y += (targetRotation - particles.rotation.y) * 0.1;

        // 强制清零旋转速度
        rotationVelocity = 0;
    } else {
        // 【普通模式】：允许自由旋转
        rotationVelocity *= DAMPING_FACTOR;
        particles.rotation.y += rotationVelocity;

        if (Math.abs(rotationVelocity) < 0.001) {
            particles.rotation.y += 0.0005;
        }
    }
    // --------------------------------

    const positions = geometry.attributes.position.array;
    for (let i = 0; i < PARTICLE_COUNT; i++) {
        const target = targetPositions[i];
        const current = currentPositions[i];

        const noiseX = Math.sin(time * 2 + i) * 0.05;
        const noiseY = Math.cos(time * 3 + i) * 0.05;

        let tx = target.x;
        let ty = target.y;
        let tz = target.z;

        // 应用手势缩放因子
        let scale = 1 + handInteractionFactor;

        if (scale < 0.2) scale = 0.2;
        if (scale > 4.0) scale = 4.0;

        tx *= scale;
        ty *= scale;
        tz *= scale;

        // 模拟爆炸/扰动
        if (handInteractionFactor > 1.0) {
            tx += (Math.random() - 0.5) * 5;
            ty += (Math.random() - 0.5) * 5;
            tz += (Math.random() - 0.5) * 5;
        }

        current.x += (tx - current.x) * 0.08 + noiseX;
        current.y += (ty - current.y) * 0.08 + noiseY;
        current.z += (tz - current.z) * 0.08;

        positions[i * 3] = current.x;
        positions[i * 3 + 1] = current.y;
        positions[i * 3 + 2] = current.z;
    }
    geometry.attributes.position.needsUpdate = true;
    renderer.render(scene, camera);
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

// =======================
// 5. UI 事件绑定
// =======================

/**
 * 处理模型按钮点击事件
 * @param {string} shapeName 
 * @param {boolean} isInitial - 是否是初始化调用
 */
function handleModelSelection(shapeName, isInitial = false) {
    // 1. 基础模型按钮，更新回归目标
    if (['sphere', 'heart', 'saturn', 'flower', 'torus'].includes(shapeName)) {
        selectedBaseModelName = shapeName;
    }

    // 2. 立即切换模型，并更新UI
    morphTo(shapeName);
    if (!isInitial) {
        gestureDisplay.textContent = `当前手势/模型: ${shapeName.toUpperCase()}`;
    }

    // 3. 更新 UI 选中状态 (仅标记基础模型)
    updateActiveButton(selectedBaseModelName);
}

function updateActiveButton(activeShapeName) {
    document.querySelectorAll('.model-button').forEach(btn => {
        const shape = btn.getAttribute('data-shape');
        // 仅对基础模型按钮进行高亮
        if (['sphere', 'heart', 'saturn', 'flower', 'torus'].includes(shape)) {
            btn.classList.remove('active', 'bg-blue-900/50');
            btn.classList.add('bg-gray-700', 'hover:bg-gray-600');

            if (shape === activeShapeName) {
                btn.classList.add('active', 'bg-blue-900/50');
                btn.classList.remove('bg-gray-700', 'hover:bg-gray-600');
            }
        }
    });
}

// 绑定所有模型按钮
document.querySelectorAll('.model-button').forEach(button => {
    button.addEventListener('click', (e) => {
        const shape = e.currentTarget.getAttribute('data-shape');
        handleModelSelection(shape);
    });
});

// 颜色选择器
document.getElementById('colorPicker').addEventListener('input', (e) => {
    targetColor = new THREE.Color(e.target.value);
    document.getElementById('colorHex').innerText = e.target.value.toUpperCase();
});

// 大小滑块
document.getElementById('sizeSlider').addEventListener('input', (e) => {
    const size = parseFloat(e.target.value);
    if (material) material.size = size;
    document.getElementById('sizeValue').innerText = size.toFixed(2);
});

// 手势形状控制开关
const gestureToggle = document.getElementById('gestureMorphToggle');
const gestureHint = document.getElementById('gesture-hint');
gestureToggle.addEventListener('change', (e) => {
    gestureMorphingEnabled = e.target.checked;

    // 无论开启还是关闭，都回归到基础模型
    morphTo(selectedBaseModelName);
    lastDetectedGesture = selectedBaseModelName;

    if (gestureMorphingEnabled) {
        gestureHint.textContent = '开启时：识别 1/2/3 切换模型，同时禁用交互。未识别时允许交互。';
        gestureDisplay.textContent = `当前手势/模型: ${selectedBaseModelName.toUpperCase()}`;
    } else {
        gestureHint.textContent = '关闭时：手部移动控制旋转，张合控制缩放/扩散。';
        gestureDisplay.textContent = `当前手势/模型: ${selectedBaseModelName.toUpperCase()} (交互模式)`;
    }
});

// 新增：左右手开关事件绑定
document.getElementById('toggleLeftHand').addEventListener('change', (e) => {
    isLeftHandEnabled = e.target.checked;
});
document.getElementById('toggleRightHand').addEventListener('change', (e) => {
    isRightHandEnabled = e.target.checked;
});


// =======================
// 6. Gemini LLM 交互功能
// =======================

const GEMINI_MODEL = "gemini-2.5-flash-preview-09-2025";
const API_BASE_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
const API_KEY = ""; // 请在此处填入您的 API Key

/**
 * 调用 Gemini API 进行文本生成，并实现指数退避。
 */
async function callGeminiApi(prompt, systemInstruction, retries = 0) {
    const MAX_RETRIES = 5;
    llmButton.disabled = true;
    llmLoading.classList.remove('hidden');
    llmResponse.textContent = "";

    const payload = {
        contents: [{
            parts: [{
                text: prompt
            }]
        }],
        systemInstruction: {
            parts: [{
                text: systemInstruction
            }]
        },
    };

    try {
        const response = await fetch(`${API_BASE_URL}?key=${API_KEY}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        if (response.status === 429 && retries < MAX_RETRIES) {
            const delay = Math.pow(2, retries) * 1000;
            console.log(`API 限制，等待 ${delay}ms 后重试...`);
            await new Promise(resolve => setTimeout(resolve, delay));
            return callGeminiApi(prompt, systemInstruction, retries + 1);
        }

        if (!response.ok) {
            throw new Error(`API 请求失败: ${response.statusText}`);
        }

        const result = await response.json();
        // 可选链写法，防止 Gemini 响应结构变化时报错
        const text = result.candidates?.[0]?.content?.parts?.[0]?.text;

        if (text) {
            llmResponse.textContent = text;
        } else {
            llmResponse.textContent = "未能生成内容，请尝试修改提示词。";
            console.error("API 响应内容为空:", result);
        }

    } catch (error) {
        llmResponse.textContent = `生成失败: ${error.message}`;
        console.error("Gemini API Error:", error);
    } finally {
        llmButton.disabled = false;
        llmLoading.classList.add('hidden');
    }
}

llmButton.addEventListener('click', () => {
    const userPrompt = llmPrompt.value.trim();
    if (!userPrompt) {
        llmResponse.textContent = "请输入您的提示词。";
        return;
    }

    // **增强：将当前形状名称包含在系统指令中**
    const shapeMapping = {
        'sphere': '球体',
        'heart': '爱心',
        'saturn': '土星',
        'flower': '花朵',
        'torus': '甜甜圈',
        'one': '数字 1',
        'two': '数字 2',
        'three': '数字 3',
    };
    const currentShape = shapeMapping[currentShapeName] || currentShapeName;

    const systemInstruction =
        `你是一个富有创意和诗意的描述生成器。用户正在观察一个由粒子构成的3D形状：【${currentShape}】。请用中文和简洁的语言，根据用户的提示，生成一段300字以内，并与【${currentShape}】这一形状相关的创意描述或分析。`;

    callGeminiApi(userPrompt, systemInstruction);
});

// =======================
// 7. 辅助功能
// =======================

// 快捷键监听
window.addEventListener('keydown', (e) => {
    const key = e.key.toLowerCase();

    // X键：切换UI面板
    if (key === 'x') {
        const ui = document.getElementById('ui-panel');
        ui.style.display = (ui.style.display === 'none') ? 'block' : 'none';
    }

    // I键：切换摄像头预览
    if (key === 'i') {
        const cam = document.getElementById('camera_preview');
        cam.style.display = (cam.style.display === 'none') ? 'block' : 'none';
    }
});

// 摄像头拖拽逻辑 (保持不变)
const camPreview = document.getElementById('camera_preview');
let isDragging = false;
let startX, startY, initialLeft, initialTop;

camPreview.addEventListener('mousedown', (e) => {
    const rect = camPreview.getBoundingClientRect();
    const isResizeZone = (e.clientX > rect.right - 20 && e.clientY > rect.bottom - 20);

    if (isResizeZone) return;

    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;

    camPreview.style.left = rect.left + 'px';
    camPreview.style.top = rect.top + 'px';
    camPreview.style.bottom = 'auto';
    camPreview.style.right = 'auto';

    initialLeft = rect.left;
    initialTop = rect.top;

    e.preventDefault();
});

window.addEventListener('mousemove', (e) => {
    if (!isDragging) return;

    const dx = e.clientX - startX;
    const dy = e.clientY - startY;

    camPreview.style.left = (initialLeft + dx) + 'px';
    camPreview.style.top = (initialTop + dy) + 'px';
});

window.addEventListener('mouseup', () => {
    isDragging = false;
});

// 初始化
window.onload = () => {
    initThree();
    initCamera();
};
