// =================================================================================
// CHỨC NĂNG: Ứng dụng AR Makeup Chuyên nghiệp
// Tác giả: Đối tác lập trình (Gemini)
// CẢI TIẾN CHÍNH:
// - Thêm Face Mesh và Beauty Shader để làm đẹp da (mịn, sáng, hồng).
// - Thay thế color picker bằng bảng màu son (swatches) chuyên nghiệp.
// - Thêm các thanh trượt để điều khiển hiệu ứng da.
// - Giữ lại toàn bộ cấu trúc shader cho môi để đảm bảo chất lượng.
// =================================================================================

// --- Lấy các phần tử DOM ---
const videoElement = document.getElementById('webcam');
const canvasElement = document.getElementById('webgl-canvas');
const debugToggle = document.getElementById('debug-mode');
const debugInfoPanel = document.getElementById('debug-info');
// ✨ DOM MỚI
const colorPalette = document.getElementById('color-palette');
const smoothingSlider = document.getElementById('smoothing-slider');
const brighteningSlider = document.getElementById('brightening-slider');
const pinkingSlider = document.getElementById('pinking-slider');


// --- Cài đặt chung ---
const VIDEO_WIDTH = 640;
const VIDEO_HEIGHT = 480;

// --- Khai báo biến toàn cục ---
let scene, camera, renderer, videoTexture;
let lipMesh, faceMesh; // ✨ Thêm faceMesh
let light;
let faceMeshDetector;

let prevLandmarks = null;
const SMOOTH_ALPHA = 0.4;

// ✨ Bảng màu son
const LIP_COLORS = {
    "Đỏ Ruby": "#E02D40",
    "Hồng Đất": "#B96F71",
    "Cam Cháy": "#D96831",
    "Nâu Đất": "#9A6A5F",
    "Nude Beige": "#D8A790",
    "Hồng Baby": "#F29FB0",
    "Đỏ Rượu": "#8C1D2A",
    "Tím Mận": "#6E3A57",
};

// ✨ Định nghĩa landmarks cho DA MẶT (trừ mắt, miệng, mũi)
// Đây là một tập hợp các điểm tạo thành một lớp phủ trên da
const FACE_OVAL = [
    10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400,
    377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103,
    67, 109
];
const LIP_OUTER_CONTOUR = [0, 37, 39, 40, 185, 61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 409, 270, 269, 267];
const LIP_INNER_CONTOUR = [13, 82, 81, 80, 191, 78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308];


// =================================================================================
// BƯỚC 1: HÀM MAIN
// =================================================================================
async function main() {
    setupUIListeners();
    setupThreeJS();
    await setupCamera();
    setupMediaPipe();
    startAnimationLoop();
}

// =================================================================================
// BƯỚC 2: CÀI ĐẶT CÁC THÀNH PHẦN
// =================================================================================

function setupUIListeners() {
    debugToggle.addEventListener('change', () => {
        const isDebugging = debugToggle.checked;
        debugInfoPanel.style.display = isDebugging ? 'block' : 'none';
        if (lipMesh) lipMesh.material.wireframe = isDebugging;
        if (faceMesh) faceMesh.material.wireframe = isDebugging; // Debug cho cả da
    });

    // ✨ Tạo bảng màu và gán sự kiện
    Object.entries(LIP_COLORS).forEach(([name, color], index) => {
        const swatch = document.createElement('div');
        swatch.className = 'color-swatch';
        swatch.style.backgroundColor = color;
        swatch.dataset.color = color;
        swatch.title = name;
        if (index === 0) swatch.classList.add('active'); // Đặt màu đầu tiên làm mặc định

        swatch.addEventListener('click', () => {
            document.querySelector('.color-swatch.active').classList.remove('active');
            swatch.classList.add('active');
            updateLipColor(swatch.dataset.color);
        });
        colorPalette.appendChild(swatch);
    });

    // ✨ Gán sự kiện cho các thanh trượt
    smoothingSlider.addEventListener('input', (e) => {
        if (faceMesh) faceMesh.material.uniforms.u_smoothing.value = parseFloat(e.target.value);
    });
    brighteningSlider.addEventListener('input', (e) => {
        if (faceMesh) faceMesh.material.uniforms.u_brightening.value = parseFloat(e.target.value);
    });
    pinkingSlider.addEventListener('input', (e) => {
        if (faceMesh) faceMesh.material.uniforms.u_pinking.value = parseFloat(e.target.value);
    });
}

function setupThreeJS() {
    scene = new THREE.Scene();
    renderer = new THREE.WebGLRenderer({
        canvas: canvasElement,
        alpha: true,
        antialias: true
    });
    renderer.setSize(VIDEO_WIDTH, VIDEO_HEIGHT);
    renderer.setPixelRatio(window.devicePixelRatio || 1);
    renderer.setClearColor(0x000000, 0);

    const aspect = VIDEO_WIDTH / VIDEO_HEIGHT;
    camera = new THREE.OrthographicCamera(-aspect, aspect, 1, -1, 0.1, 1000);
    camera.position.set(0, 0, 1);

    light = new THREE.DirectionalLight(0xffffff, 0.6);
    light.position.set(0, 0.5, 1);
    scene.add(light);

    videoTexture = new THREE.VideoTexture(videoElement);
    videoTexture.minFilter = THREE.LinearFilter;
    videoTexture.magFilter = THREE.LinearFilter;
    videoTexture.format = THREE.RGBAFormat;
}

async function setupCamera() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { width: VIDEO_WIDTH, height: VIDEO_HEIGHT, facingMode: 'user' },
            audio: false
        });
        videoElement.srcObject = stream;
        await new Promise(resolve => {
            videoElement.onloadedmetadata = () => resolve();
        });
        await videoElement.play();
        videoElement.style.transform = 'scaleX(-1)';
    } catch (error) {
        console.error("Lỗi khi truy cập camera:", error);
        alert("Không thể bật camera. Vui lòng kiểm tra quyền truy cập.");
    }
}

function setupMediaPipe() {
    faceMeshDetector = new window.FaceMesh({
        locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`
    });
    faceMeshDetector.setOptions({
        maxNumFaces: 1,
        refineLandmarks: true,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5
    });
    faceMeshDetector.onResults(onResults);
}

// =================================================================================
// BƯỚC 3: VÒNG LẶP XỬ LÝ VÀ VẼ
// =================================================================================

function startAnimationLoop() {
    const processVideo = async () => {
        if (videoElement.readyState >= 2 && faceMeshDetector) {
            await faceMeshDetector.send({ image: videoElement });
        }
        requestAnimationFrame(processVideo);
    };
    processVideo();
}

function onResults(results) {
    renderer.clear();

    if (!results.multiFaceLandmarks || results.multiFaceLandmarks.length === 0) {
        if (lipMesh) lipMesh.visible = false;
        if (faceMesh) faceMesh.visible = false; // Ẩn cả da mặt
        return;
    }

    const landmarks = results.multiFaceLandmarks[0];

    if (!lipMesh) createLipMesh();
    if (!faceMesh) createFaceMesh(); // ✨ Tạo face mesh nếu chưa có

    updateLipGeometry(landmarks);
    updateFaceGeometry(landmarks); // ✨ Cập nhật face mesh

    renderer.render(scene, camera);
}


// =================================================================================
// BƯỚC 4: TẠO VÀ CẬP NHẬT GEOMETRY & MATERIALS
// =================================================================================

// --- Phần xử lý cho MÔI (Lipstick) ---

function createLipMesh() {
    const lipMaterial = createAdvancedLipMaterial(LIP_COLORS["Đỏ Ruby"]); // Màu mặc định
    const lipGeometry = new THREE.BufferGeometry();
    lipMesh = new THREE.Mesh(lipGeometry, lipMaterial);
    lipMesh.renderOrder = 2; // Ưu tiên vẽ môi lên trên da
    scene.add(lipMesh);
}

function updateLipColor(hexColor) {
    const newColor = new THREE.Color(hexColor);
    if (lipMesh && lipMesh.material && lipMesh.material.uniforms) {
        lipMesh.material.uniforms.u_colorA.value.copy(newColor);
        const b = newColor.clone().offsetHSL(0, -0.08, -0.06);
        lipMesh.material.uniforms.u_colorB.value.copy(b);
    }
}

function createAdvancedLipMaterial(colorHex) {
    const base = new THREE.Color(colorHex);
    const baseB = base.clone().offsetHSL(0, -0.08, -0.06);

    return new THREE.ShaderMaterial({
        uniforms: {
            u_texture: { value: videoTexture },
            u_colorA: { value: base },
            u_colorB: { value: baseB },
            u_intensity: { value: 0.85 },
            u_lightIntensity: { value: 0.35 },
            u_lightDirection: { value: light.position.clone() }
        },
        vertexShader: `
            attribute float a_mask;
            varying vec2 v_uv;
            varying float v_lighting;
            varying float v_mask;
            uniform vec3 u_lightDirection;
            void main() {
                v_uv = uv;
                v_mask = a_mask;
                vec3 transformedNormal = normalize(normalMatrix * normal);
                vec3 lightDir = normalize(u_lightDirection);
                float NdotL = max(dot(transformedNormal, lightDir), 0.0);
                v_lighting = 0.6 + 0.4 * NdotL;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            uniform sampler2D u_texture;
            uniform vec3 u_colorA;
            uniform vec3 u_colorB;
            uniform float u_intensity;
            uniform float u_lightIntensity;
            varying vec2 v_uv;
            varying float v_lighting;
            varying float v_mask;

            vec3 overlay(vec3 base, vec3 blend) {
                return mix(
                    2.0 * base * blend,
                    1.0 - 2.0 * (1.0 - base) * (1.0 - blend),
                    step(0.5, base)
                );
            }
            void main() {
                vec3 orig = texture2D(u_texture, v_uv).rgb;
                float lum = dot(orig, vec3(0.299, 0.587, 0.114));
                vec3 chosenTone = mix(u_colorA, u_colorB, smoothstep(0.2, 0.6, 1.0 - lum));
                vec3 blended = overlay(orig, chosenTone);
                vec3 colorMix = mix(orig, blended, u_intensity);
                float lightFactor = mix(1.0, v_lighting, u_lightIntensity);
                vec3 finalColor = colorMix * lightFactor;
                float alpha = clamp(v_mask, 0.0, 1.0);
                gl_FragColor = vec4(finalColor, alpha);
            }
        `,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        wireframe: debugToggle.checked
    });
}

function updateLipGeometry(landmarks) {
    // ... (Toàn bộ hàm updateLipGeometry từ code gốc của bạn, không cần thay đổi)
    // ... Vì hàm này đã rất tối ưu, tôi sẽ không dán lại để tiết kiệm không gian.
    // ... Bạn chỉ cần copy và paste toàn bộ hàm này từ file JS cũ của bạn vào đây.
    // Đảm bảo các hàm smoothLandmarks và các hằng số contour được giữ lại.
    if (!landmarks || landmarks.length === 0) {
        if (lipMesh) lipMesh.visible = false;
        return;
    }

    // apply smoothing 
    const smoothed = smoothLandmarks(landmarks);

    const aspect = VIDEO_WIDTH / VIDEO_HEIGHT;
    const toVec2 = (lm) => {
        const x = aspect * (1 - 2 * lm.x);
        const y = (1.0 - lm.y) * 2.0 - 1.0;
        return new THREE.Vector2(x, y);
    };

    const outerPts = LIP_OUTER_CONTOUR.map(i => toVec2(smoothed[i])).filter(Boolean);
    const innerPts = LIP_INNER_CONTOUR.map(i => toVec2(smoothed[i])).filter(Boolean);

    if (outerPts.length < 3 || innerPts.length < 3) {
        if (lipMesh) lipMesh.visible = false;
        return;
    }
    const lipShape = new THREE.Shape(outerPts);
    const holePath = new THREE.Path(innerPts);
    lipShape.holes = [holePath];
    const newGeometry = new THREE.ShapeGeometry(lipShape);
    const posAttr = newGeometry.attributes.position;
    const vertCount = posAttr.count;
    const uvs = new Float32Array(vertCount * 2);

    for (let i = 0; i < vertCount; i++) {
        const x = posAttr.getX(i);
        const y = posAttr.getY(i);
        const u = (1.0 - (x / aspect)) * 0.5;
        const v = (1.0 + y) * 0.5;
        uvs[i * 2] = u;
        uvs[i * 2 + 1] = v;
    }
    newGeometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));

    const masks = new Float32Array(vertCount);
    // Đây là một cách đơn giản để tạo mask, có thể cải thiện sau
    for (let i = 0; i < vertCount; i++) {
        masks[i] = 1.0;
    }
    newGeometry.setAttribute('a_mask', new THREE.BufferAttribute(masks, 1));
    newGeometry.computeVertexNormals();

    lipMesh.geometry.dispose();
    lipMesh.geometry = newGeometry;
    lipMesh.visible = true;
}


// --- ✨ Phần xử lý MỚI cho DA MẶT (Skin Beautification) ---

function createFaceMesh() {
    const faceMaterial = createBeautyShaderMaterial();
    const faceGeometry = new THREE.BufferGeometry();
    faceMesh = new THREE.Mesh(faceGeometry, faceMaterial);
    faceMesh.renderOrder = 1; // Vẽ da trước, dưới lớp môi
    scene.add(faceMesh);
}

function createBeautyShaderMaterial() {
    return new THREE.ShaderMaterial({
        uniforms: {
            u_texture: { value: videoTexture },
            u_smoothing: { value: parseFloat(smoothingSlider.value) },
            u_brightening: { value: parseFloat(brighteningSlider.value) },
            u_pinking: { value: parseFloat(pinkingSlider.value) },
            u_resolution: { value: new THREE.Vector2(VIDEO_WIDTH, VIDEO_HEIGHT) },
        },
        vertexShader: `
            varying vec2 v_uv;
            void main() {
                v_uv = uv;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            uniform sampler2D u_texture;
            uniform float u_smoothing;
            uniform float u_brightening;
            uniform float u_pinking;
            uniform vec2 u_resolution;
            varying vec2 v_uv;

            // Hàm làm mờ đơn giản (box blur)
            vec3 blur(sampler2D image, vec2 uv, vec2 resolution, float radius) {
                vec3 col = vec3(0.0);
                float count = 0.0;
                for(float x = -radius; x <= radius; x++) {
                    for(float y = -radius; y <= radius; y++) {
                        vec2 offset = vec2(x, y) / resolution;
                        col += texture2D(image, uv + offset).rgb;
                        count++;
                    }
                }
                return col / count;
            }

            void main() {
                vec3 originalColor = texture2D(u_texture, v_uv).rgb;

                // 1. Làm mịn da
                // Kỹ thuật này trộn màu gốc với màu đã làm mờ.
                // u_smoothing càng cao, da càng mịn.
                vec3 blurredColor = blur(u_texture, v_uv, u_resolution, 3.0);
                vec3 smoothedColor = mix(originalColor, blurredColor, u_smoothing);

                // 2. Làm sáng da
                vec3 brightenedColor = smoothedColor + u_brightening;

                // 3. Làm hồng da
                vec3 pinkTint = vec3(1.0, 0.9, 0.9); // Màu hồng nhẹ
                vec3 pinkedColor = mix(brightenedColor, brightenedColor * pinkTint, u_pinking);

                gl_FragColor = vec4(pinkedColor, 1.0);
            }
        `,
        transparent: false,
        depthWrite: false,
    });
}

function updateFaceGeometry(landmarks) {
    if (!landmarks || landmarks.length === 0) {
        if (faceMesh) faceMesh.visible = false;
        return;
    }

    const smoothed = smoothLandmarks(landmarks);
    const aspect = VIDEO_WIDTH / VIDEO_HEIGHT;

    const positions = [];
    const uvs = [];
    FACE_OVAL.forEach(i => {
        const lm = smoothed[i];
        if (lm) {
            positions.push(aspect * (1 - 2 * lm.x), (1.0 - lm.y) * 2.0 - 1.0, 0);
            uvs.push(lm.x, 1.0 - lm.y);
        }
    });

    if (positions.length === 0) {
        if (faceMesh) faceMesh.visible = false;
        return;
    }

    const faceGeometry = faceMesh.geometry;
    faceGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    faceGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));

    // Tạo chỉ mục (indices) để vẽ các tam giác
    // EarCut là một thư viện nhỏ nhưng hiệu quả để triangulate một polygon.
    // Vì không muốn thêm thư viện ngoài, ta dùng cách đơn giản của Three.js
    const indices = THREE.ShapeUtils.triangulateShape(
        positions.map((_, i) => i % 3 === 0 ? new THREE.Vector2(positions[i], positions[i + 1]) : null).filter(v => v),
        []
    ).flat();

    faceGeometry.setIndex(indices);
    faceGeometry.computeVertexNormals();

    faceMesh.geometry.attributes.position.needsUpdate = true;
    faceMesh.geometry.attributes.uv.needsUpdate = true;
    faceMesh.geometry.index.needsUpdate = true;

    faceMesh.visible = true;
}

function smoothLandmarks(latest) {
    if (!prevLandmarks) {
        prevLandmarks = latest.map(l => ({ x: l.x, y: l.y, z: l.z }));
        return prevLandmarks;
    }
    for (let i = 0; i < latest.length; i++) {
        const cur = latest[i];
        const prev = prevLandmarks[i];
        prev.x = prev.x * (1 - SMOOTH_ALPHA) + cur.x * SMOOTH_ALPHA;
        prev.y = prev.y * (1 - SMOOTH_ALPHA) + cur.y * SMOOTH_ALPHA;
        prev.z = prev.z * (1 - SMOOTH_ALPHA) + cur.z * SMOOTH_ALPHA;
    }
    return prevLandmarks;
}

// --- Khởi chạy ứng dụng ---
main();