// =================================================================================
// CHỨC NĂNG: Ứng dụng thử son môi 3D (Phiên bản HOÀN CHỈNH)
// Tác giả: Đối tác lập trình (Gemini)
// CẢI TIẾN CHÍNH:
// - ✨ SỬA LỖI: Sử dụng một mesh duy nhất với viền trong (hole) để loại bỏ hoàn toàn màu ở khoang miệng.
// - ✨ NÂNG CẤP: Dùng THREE.ShapeGeometry để triangulate môi một cách mượt mà, tự động.
// - ✨ SỬA LỖI: Dùng OrthographicCamera để khớp tọa độ hoàn hảo, loại bỏ offset cứng.
// - ✨ NÂNG CẤP: ShaderMaterial hoàn toàn mới với các tính năng:
//      - Blending mode "Overlay" để giữ lại vân môi và chi tiết.
//      - Mô phỏng ánh sáng 3D đơn giản để tạo khối và chiều sâu.
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
let lipMesh; // ✨ THAY ĐỔI: Chỉ dùng một mesh duy nhất
let faceMesh;
let light; // Nguồn sáng ảo

// ✨ THAY ĐỔI: Định nghĩa lại landmarks để tạo hình có lỗ
// Viền ngoài của cả 2 môi, chạy theo một vòng khép kín
const LIP_OUTER_CONTOUR = [0, 37, 39, 40, 185, 61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 409, 270, 269, 267];
// Viền trong của cả 2 môi, là phần khoang miệng sẽ bị cắt bỏ
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
        // ✨ THAY ĐỔI: Cập nhật cho một mesh
        if (lipMesh) lipMesh.material.wireframe = isDebugging;
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
    renderer.setClearColor(0x000000, 0);

    const aspect = VIDEO_WIDTH / VIDEO_HEIGHT;
    camera = new THREE.OrthographicCamera(-aspect, aspect, 1, -1, 0.1, 1000);
    camera.position.set(0, 0, 1);

    light = new THREE.DirectionalLight(0xffffff, 0.5);
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
        videoElement.play();
    } catch (error) {
        console.error("Lỗi khi truy cập camera:", error);
        alert("Không thể bật camera. Vui lòng kiểm tra quyền truy cập.");
    }
}

function setupMediaPipe() {
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
}

// =================================================================================
// BƯỚC 3: VÒNG LẶP XỬ LÝ VÀ VẼ
// =================================================================================

function startAnimationLoop() {
    const processVideo = async () => {
        if (videoElement.readyState >= 2) {
            await faceMesh.send({ image: videoElement });
        }
        requestAnimationFrame(processVideo);
    };
    processVideo();
}

function onResults(results) {
    renderer.clear();

    if (!results.multiFaceLandmarks || results.multiFaceLandmarks.length === 0) {
        // ✨ THAY ĐỔI: Cập nhật cho một mesh
        if (lipMesh) lipMesh.visible = false;
        updateDebugInfo(false);
        return;
    }

    const landmarks = results.multiFaceLandmarks[0];

    // ✨ THAY ĐỔI: Cập nhật cho một mesh
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

// ✨ THAY ĐỔI: Đổi tên hàm thành createLipMesh (số ít)
function createLipMesh() {
    const createAdvancedLipMaterial = (color) => {
        return new THREE.ShaderMaterial({
            uniforms: {
                u_texture: { value: videoTexture },
                u_color: { value: new THREE.Color(color) },
                u_intensity: { value: 0.8 },
                u_lightDirection: { value: light.position }
            },
            vertexShader: `
                varying vec2 v_uv;
                varying float v_lighting;
                uniform vec3 u_lightDirection;
                void main() {
                    v_uv = uv;
                    vec3 transformedNormal = normalMatrix * normal;
                    vec3 lightDir = normalize(u_lightDirection);
                    v_lighting = max(dot(transformedNormal, lightDir), 0.2);
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform sampler2D u_texture;
                uniform vec3 u_color;
                uniform float u_intensity;
                varying vec2 v_uv;
                varying float v_lighting;
                vec3 blendOverlay(vec3 base, vec3 blend) {
                    return mix(
                        1.0 - 2.0 * (1.0 - base) * (1.0 - blend),
                        2.0 * base * blend,
                        step(base, vec3(0.5))
                    );
                }
                void main() {
                    vec3 originalColor = texture2D(u_texture, v_uv).rgb;
                    vec3 blendedColor = blendOverlay(originalColor, u_color);
                    vec3 finalColor = mix(originalColor, blendedColor, u_intensity);
                    finalColor *= v_lighting;
                    gl_FragColor = vec4(finalColor, 1.0);
                }
            `,
            depthWrite: true,
            wireframe: debugToggle.checked
        });
    };

    const initialColor = colorPicker.value;
    const lipMaterial = createAdvancedLipMaterial(initialColor);
    const lipGeometry = new THREE.BufferGeometry();

    // ✨ THAY ĐỔI: Chỉ tạo một lipMesh
    lipMesh = new THREE.Mesh(lipGeometry, lipMaterial);
    lipMesh.position.z = 0.01;
    scene.add(lipMesh);

    // ✨ THAY ĐỔI: Cập nhật event listener cho một mesh
    colorPicker.addEventListener('input', () => {
        const newColor = new THREE.Color(colorPicker.value);
        lipMesh.material.uniforms.u_color.value.copy(newColor);
    });
}

// ✨ THAY ĐỔI: Viết lại hoàn toàn hàm updateLipGeometry
function updateLipGeometry(landmarks) {
    const aspect = VIDEO_WIDTH / VIDEO_HEIGHT;

    const getPoints = (indices) => {
        const points = [];
        for (const index of indices) {
            const lm = landmarks[index];
            if (!lm) continue;
            const x = (1.0 - lm.x) * 2.0 * aspect - aspect;
            const y = (1.0 - lm.y) * 2.0 - 1.0;
            points.push(new THREE.Vector2(x, y));
        }
        return points;
    };

    const getUVs = (indices) => {
        const uvs = [];
        for (const index of indices) {
            const lm = landmarks[index];
            if (!lm) continue;
            uvs.push(lm.x, 1.0 - lm.y);
        }
        return uvs;
    };

    const outerPoints = getPoints(LIP_OUTER_CONTOUR);
    const innerPoints = getPoints(LIP_INNER_CONTOUR);

    if (outerPoints.length < 3 || innerPoints.length < 3) {
        lipMesh.visible = false;
        return;
    }

    const lipShape = new THREE.Shape(outerPoints);
    const holePath = new THREE.Path(innerPoints);
    lipShape.holes.push(holePath);

    const newGeometry = new THREE.ShapeGeometry(lipShape);

    const allIndices = [...LIP_OUTER_CONTOUR, ...LIP_INNER_CONTOUR];
    const uvs = getUVs(allIndices);
    newGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));

    newGeometry.computeVertexNormals();

    lipMesh.geometry.dispose();
    lipMesh.geometry = newGeometry;
    lipMesh.visible = true;
}

function updateDebugInfo(faceDetected, landmarks = null) {
    if (debugToggle.checked) {
        let info = `
            <strong>--- DEBUG INFO ---</strong><br>
            - Trạng thái: ${faceDetected ? '<span style="color: #00ff00;">Đã phát hiện</span>' : '<span style="color: #ff0000;">Không tìm thấy</span>'}<br>
            - Camera: Orthographic<br>
        `;
        // ✨ THAY ĐỔI: Cập nhật cho một mesh
        if (landmarks && lipMesh && lipMesh.geometry.index) {
            info += `- Triangles: ${lipMesh.geometry.index.count / 3}<br>`;
            info += `- Shader: Advanced (Overlay + Lighting)<br>`;
        }
        debugInfoPanel.innerHTML = info;
    }
}

// --- Khởi chạy ứng dụng ---
main();