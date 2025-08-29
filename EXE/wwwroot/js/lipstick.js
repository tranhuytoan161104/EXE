// =================================================================================
// CHỨC NĂNG: Ứng dụng thử son môi 3D (Phiên bản HOÀN CHỈNH) — *ĐÃ SỬA/HOÀN THIỆN*
// Tác giả: Đối tác lập trình (Gemini) + patch bởi trợ lý
// CẢI TIẾN CHÍNH (thực thi trong file):
// - Dùng một mesh duy nhất với hole (inner contour) để loại bỏ màu ở khoang miệng.
// - Dùng ShapeGeometry để triangulate mượt.
// - UV được tính **per-vertex** từ vị trí geometry (không map thô theo danh sách indices).
// - Thêm attribute a_mask cho soft alpha edge (giải quyết viền nham nhở).
// - Shader two-tone + overlay preserve-detail + soft lighting.
// - Thêm smoothing đơn giản cho landmarks (EMA) để giảm jitter/nháy.
// - Tự động nạp Mediapipe nếu chưa được load (tăng khả năng chống lỗi).
// =================================================================================

// --- Lấy các phần tử DOM ---
const videoElement = document.getElementById('webcam');
const canvasElement = document.getElementById('webgl-canvas');
const colorPicker = document.getElementById('color-picker');
const debugToggle = document.getElementById('debug-mode');
const debugInfoPanel = document.getElementById('debug-info');

// --- Cài đặt chung ---
const VIDEO_WIDTH = 640;
const VIDEO_HEIGHT = 480;

// --- Khai báo biến toàn cục ---
let scene, camera, renderer, videoTexture;
let lipMesh; // chỉ dùng một mesh duy nhất
let faceMesh;
let light; // Nguồn sáng ảo

// smoothing
let prevLandmarks = null;
const SMOOTH_ALPHA = 0.4; // 0..1, càng thấp càng mượt (1 = no smoothing)

// ✨ THAY ĐỔI: Định nghĩa lại landmarks để tạo hình có lỗ
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
        if (lipMesh && lipMesh.material) lipMesh.material.wireframe = isDebugging;
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
    videoTexture.crossOrigin = '';

    // ensure canvas is on top
    canvasElement.style.zIndex = 2;
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

        // === HIỂN THỊ VIDEO ĐẰNG SAU CANVAS (KHÔNG THAY THUẬT TOÁN) ===
        // Đảm bảo video DOM xuất hiện và nằm dưới canvas WebGL.
        // Canvas có transparent (renderer alpha: true) nên filter vẽ lên video.
        videoElement.style.visibility = 'visible';
        videoElement.style.position = 'absolute';
        videoElement.style.top = '0';
        videoElement.style.left = '0';
        videoElement.style.width = '100%';
        videoElement.style.height = '100%';
        videoElement.style.objectFit = 'cover';
        // Mirror video để khớp UX camera front
        videoElement.style.transform = 'scaleX(-1)';
        // đặt z-index thấp hơn canvas
        videoElement.style.zIndex = '1';

        // Canvas style: ở trên, trong suốt, không chặn sự kiện
        canvasElement.style.position = 'absolute';
        canvasElement.style.top = '0';
        canvasElement.style.left = '0';
        canvasElement.style.width = '100%';
        canvasElement.style.height = '100%';
        canvasElement.style.background = 'transparent';
        canvasElement.style.zIndex = '2';
        canvasElement.style.pointerEvents = 'none';

        // Nếu CSS cũ của bạn có `#webcam { visibility: hidden }` trong file CSS, 
        // hãy xóa/ghi đè nó hoặc đảm bảo đoạn JS này thực hiện sau khi CSS load.
    } catch (error) {
        console.error("Lỗi khi truy cập camera:", error);
        alert("Không thể bật camera. Vui lòng kiểm tra quyền truy cập.");
    }
}


function setupMediaPipe() {
    // If FaceMesh not loaded (e.g., wrong script tag), auto-load from CDN
    const mpUrl = 'https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/face_mesh.js';
    const init = () => {
        try {
            faceMesh = new window.FaceMesh({
                locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`
            });
            faceMesh.setOptions({
                maxNumFaces: 1,
                refineLandmarks: true,
                minDetectionConfidence: 0.5,
                minTrackingConfidence: 0.5
            });
            faceMesh.onResults(onResults);
        } catch (err) {
            console.error('Không thể khởi tạo FaceMesh:', err);
        }
    };

    if (typeof window.FaceMesh === 'undefined') {
        const s = document.createElement('script');
        s.src = mpUrl;
        s.onload = () => { console.info('Mediapipe FaceMesh loaded dynamically'); init(); };
        s.onerror = (e) => console.error('Không load được Mediapipe FaceMesh:', e);
        document.head.appendChild(s);
    } else {
        init();
    }
}

// =================================================================================
// BƯỚC 3: VÒNG LẶP XỬ LÝ VÀ VẼ
// =================================================================================

function startAnimationLoop() {
    const processVideo = async () => {
        if (videoElement.readyState >= 2 && faceMesh && typeof faceMesh.send === 'function') {
            try {
                await faceMesh.send({ image: videoElement });
            } catch (e) {
                // ignore occasional errors from mediapipe send
                console.warn('faceMesh.send error', e);
            }
        }
        requestAnimationFrame(processVideo);
    };
    processVideo();
}

function onResults(results) {
    renderer.clear();

    if (!results.multiFaceLandmarks || results.multiFaceLandmarks.length === 0) {
        if (lipMesh) lipMesh.visible = false;
        updateDebugInfo(false);
        return;
    }

    const landmarks = results.multiFaceLandmarks[0];

    if (!lipMesh) {
        createLipMesh();
    }

    updateLipGeometry(landmarks);

    renderer.render(scene, camera);
    updateDebugInfo(true, landmarks);
}

// =================================================================================
// BƯỚC 4: TẠO VÀ CẬP NHẬT GEOMETRY
// =================================================================================

function createLipMesh() {
    const createAdvancedLipMaterial = (colorHex) => {
        const base = new THREE.Color(colorHex || '#E02D40');
        const baseB = base.clone();
        baseB.offsetHSL(0, -0.08, -0.06); // slightly different tone

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

                float overlay(float base, float blend) {
                    if (base < 0.5) {
                        return 2.0 * base * blend;
                    } else {
                        return 1.0 - 2.0 * (1.0 - base) * (1.0 - blend);
                    }
                }
                vec3 overlayVec(vec3 base, vec3 blend) {
                    return vec3(
                        overlay(base.r, blend.r),
                        overlay(base.g, blend.g),
                        overlay(base.b, blend.b)
                    );
                }
                void main() {
                    vec3 orig = texture2D(u_texture, v_uv).rgb;
                    float lum = dot(orig, vec3(0.299, 0.587, 0.114));
                    vec3 chosenTone = mix(u_colorA, u_colorB, smoothstep(0.2, 0.6, 1.0 - lum));
                    vec3 blended = overlayVec(orig, chosenTone);
                    vec3 colorMix = mix(orig, blended, u_intensity);
                    float lightFactor = mix(1.0, v_lighting, u_lightIntensity);
                    vec3 finalColor = colorMix * lightFactor;
                    float alpha = clamp(v_mask, 0.0, 1.0);
                    finalColor = pow(finalColor, vec3(1.0 / 2.2)); // gamma correction
                    gl_FragColor = vec4(finalColor, alpha);
                }
            `,
            transparent: true,
            depthWrite: false,
            depthTest: false,
            side: THREE.DoubleSide,
            wireframe: debugToggle.checked
        });
    };

    const initialColor = colorPicker.value || '#E02D40';
    const lipMaterial = createAdvancedLipMaterial(initialColor);

    // start with an empty geometry that we'll fill each frame
    const lipGeometry = new THREE.BufferGeometry();
    lipGeometry.setAttribute('position', new THREE.Float32BufferAttribute([], 3));
    lipGeometry.setAttribute('uv', new THREE.Float32BufferAttribute([], 2));
    lipGeometry.setAttribute('a_mask', new THREE.Float32BufferAttribute([], 1));

    lipMesh = new THREE.Mesh(lipGeometry, lipMaterial);
    lipMesh.position.z = 0.01;
    lipMesh.renderOrder = 999;
    scene.add(lipMesh);

    colorPicker.addEventListener('input', () => {
        const newColor = new THREE.Color(colorPicker.value);
        if (lipMesh && lipMesh.material && lipMesh.material.uniforms) {
            lipMesh.material.uniforms.u_colorA.value.copy(newColor);
            const b = new THREE.Color(newColor.getHex());
            b.offsetHSL(0, -0.08, -0.06);
            lipMesh.material.uniforms.u_colorB.value.copy(b);
        }
    });
}

// Smoothing helper: EMA on landmark coords (per-index)
function smoothLandmarks(latest) {
    if (!prevLandmarks || prevLandmarks.length !== latest.length) {
        prevLandmarks = latest.map(l => ({ x: l.x, y: l.y, z: l.z || 0 }));
        return prevLandmarks;
    }
    for (let i = 0; i < latest.length; i++) {
        const cur = latest[i];
        const prev = prevLandmarks[i];
        prev.x = prev.x * (1 - SMOOTH_ALPHA) + cur.x * SMOOTH_ALPHA;
        prev.y = prev.y * (1 - SMOOTH_ALPHA) + cur.y * SMOOTH_ALPHA;
        prev.z = prev.z * (1 - SMOOTH_ALPHA) + (cur.z || 0) * SMOOTH_ALPHA;
    }
    return prevLandmarks;
}

// Viết lại hoàn toàn hàm updateLipGeometry (safe UV + mask + winding + smoothing)
function updateLipGeometry(landmarks) {
    if (!landmarks || landmarks.length === 0) {
        if (lipMesh) lipMesh.visible = false;
        return;
    }

    // apply smoothing
    const smoothed = smoothLandmarks(landmarks);

    const aspect = VIDEO_WIDTH / VIDEO_HEIGHT;
    const toVec2 = (lm) => {
        // map Mediapipe normalized coords to orthographic coords used in camera
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

    // ensure winding: outer CCW, inner CW
    const polygonArea = (pts) => {
        let a = 0;
        for (let i = 0; i < pts.length; i++) {
            const p1 = pts[i];
            const p2 = pts[(i + 1) % pts.length];
            a += (p1.x * p2.y - p2.x * p1.y);
        }
        return a * 0.5;
    };
    if (polygonArea(outerPts) < 0) outerPts.reverse();
    if (polygonArea(innerPts) > 0) innerPts.reverse();

    const lipShape = new THREE.Shape(outerPts);
    const holePath = new THREE.Path(innerPts);
    lipShape.holes = [holePath];
    const newGeometry = new THREE.ShapeGeometry(lipShape);

    // compute UVs per vertex from geometry positions (inverse mapping)
    const posAttr = newGeometry.attributes.position;
    const vertCount = posAttr.count;
    const uvs = new Float32Array(vertCount * 2);

    for (let i = 0; i < vertCount; i++) {
        const x = posAttr.getX(i);
        const y = posAttr.getY(i);
        // inverse of earlier mapping:
        const u = (1.0 - (x / aspect)) * 0.5;
        const v = (1.0 + y) * 0.5;
        uvs[i * 2] = THREE.MathUtils.clamp(u, 0, 1);
        uvs[i * 2 + 1] = THREE.MathUtils.clamp(v, 0, 1);
    }
    newGeometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));

    // compute inner contour in UV space for mask computation
    const innerUV = innerPts.map(p => {
        const u = (1.0 - (p.x / aspect)) * 0.5;
        const v = (1.0 + p.y) * 0.5;
        return new THREE.Vector2(u, v);
    });

    // helper: shortest distance from point to polygon edges (in UV space)
    function pointToPolyDist(p, poly) {
        let minD = Infinity;
        for (let i = 0; i < poly.length; i++) {
            const a = poly[i];
            const b = poly[(i + 1) % poly.length];
            const ab = b.clone().sub(a);
            const t = THREE.MathUtils.clamp(p.clone().sub(a).dot(ab) / ab.dot(ab), 0, 1);
            const proj = a.clone().add(ab.multiplyScalar(t));
            const d = proj.distanceTo(p);
            if (d < minD) minD = d;
        }
        return minD;
    }

    // compute a_mask per-vertex: closer to inner contour => 1.0 (solid), near boundaries => 0
    const masks = new Float32Array(vertCount);
    const FALLBACK_FALLOFF = 0.06; // tune for softness; smaller -> sharper edge
    for (let i = 0; i < vertCount; i++) {
        const u = uvs[i * 2], v = uvs[i * 2 + 1];
        const p = new THREE.Vector2(u, v);
        const d = pointToPolyDist(p, innerUV);
        const maskVal = 1.0 - THREE.MathUtils.clamp(d / FALLBACK_FALLOFF, 0.0, 1.0);
        // slightly boost center areas
        masks[i] = THREE.MathUtils.smoothstep(maskVal, 0.0, 1.0);
    }
    newGeometry.setAttribute('a_mask', new THREE.BufferAttribute(masks, 1));

    newGeometry.computeVertexNormals();

    // swap geometry (dispose previous safely)
    try { if (lipMesh.geometry) lipMesh.geometry.dispose(); } catch (e) { /* ignore */ }
    lipMesh.geometry = newGeometry;
    lipMesh.visible = true;
}

// DEBUG INFO (safe)
function updateDebugInfo(faceDetected, landmarks = null) {
    if (debugToggle.checked) {
        let info = `
            <strong>--- DEBUG INFO ---</strong><br>
            - Trạng thái: ${faceDetected ? '<span style="color: #00ff00;">Đã phát hiện</span>' : '<span style="color: #ff0000;">Không tìm thấy</span>'}<br>
            - Camera: Orthographic<br>
        `;
        if (landmarks && lipMesh && lipMesh.geometry) {
            const geom = lipMesh.geometry;
            let triCount = 0;
            if (geom.index) triCount = geom.index.count / 3;
            else if (geom.attributes && geom.attributes.position) triCount = Math.max(0, (geom.attributes.position.count - 2)); // approx
            info += `- Triangles (approx): ${Math.round(triCount)}<br>`;
            info += `- Shader: Advanced (Overlay + Lighting)<br>`;
        }
        debugInfoPanel.innerHTML = info;
    }
}

// --- Khởi chạy ứng dụng ---
main();
