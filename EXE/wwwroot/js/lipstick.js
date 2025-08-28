// =================================================================================
// CHỨC NĂNG: Ứng dụng thử son môi 3D (Phiên bản NÂNG CAO)
// Tác giả: Đối tác lập trình (Gemini)
// CẢI TIẾN CHÍNH:
// - ✨ SỬA LỖI: Sử dụng đúng landmarks VIỀN NGOÀI của môi để tạo hình dạng chính xác.
// - ✨ NÂNG CẤP: Dùng THREE.ShapeGeometry để triangulate môi một cách mượt mà, tự động.
// - ✨ SỬA LỖI: Dùng OrthographicCamera để khớp tọa độ hoàn hảo, loại bỏ offset cứng.
// - ✨ NÂNG CẤP: ShaderMaterial hoàn toàn mới với các tính năng:
//      - Blending mode "Overlay" để giữ lại vân môi và chi tiết.
//      - Mô phỏng ánh sáng 3D đơn giản để tạo khối và chiều sâu.
//      - Thêm thông số cường độ và độ bóng để tùy chỉnh.
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
let upperLipMesh, lowerLipMesh;
let faceMesh;
let light; // Nguồn sáng ảo

// ✨ CẢI TIẾN: Định nghĩa các điểm VIỀN NGOÀI của môi theo MediaPipe
// Điều này đảm bảo chúng ta không vẽ vào trong khoang miệng.
const UPPER_LIP_OUTER = [61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291];
const LOWER_LIP_OUTER = [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291];

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
        // Wireframe sẽ được hiển thị qua material nếu cần
        if (upperLipMesh) upperLipMesh.material.wireframe = isDebugging;
        if (lowerLipMesh) lowerLipMesh.material.wireframe = isDebugging;
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

    // ✨ SỬA LỖI: Sử dụng OrthographicCamera để ánh xạ 1:1, không bị lệch
    const aspect = VIDEO_WIDTH / VIDEO_HEIGHT;
    camera = new THREE.OrthographicCamera(-aspect, aspect, 1, -1, 0.1, 1000);
    camera.position.set(0, 0, 1);

    // Nguồn sáng ảo để tạo hiệu ứng 3D
    light = new THREE.DirectionalLight(0xffffff, 0.5);
    light.position.set(0, 0.5, 1); // Hướng từ trên-trước
    scene.add(light);

    videoTexture = new THREE.VideoTexture(videoElement);
    videoTexture.minFilter = THREE.LinearFilter;
    videoTexture.magFilter = THREE.LinearFilter;
    videoTexture.format = THREE.RGBAFormat; // Dùng RGBA
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
        if (upperLipMesh) upperLipMesh.visible = false;
        if (lowerLipMesh) lowerLipMesh.visible = false;
        updateDebugInfo(false);
        return;
    }

    const landmarks = results.multiFaceLandmarks[0];

    if (!upperLipMesh || !lowerLipMesh) {
        createLipMeshes();
    }

    updateLipGeometry(landmarks);

    renderer.render(scene, camera);
    updateDebugInfo(true, landmarks);
}

// =================================================================================
// BƯỚC 4: TẠO VÀ CẬP NHẬT GEOMETRY
// =================================================================================

function createLipMeshes() {
    // ✨ NÂNG CẤP: Shader Material hoàn toàn mới
    const createAdvancedLipMaterial = (color) => {
        return new THREE.ShaderMaterial({
            uniforms: {
                u_texture: { value: videoTexture },
                u_color: { value: new THREE.Color(color) },
                u_intensity: { value: 0.8 }, // Cường độ màu
                u_lightDirection: { value: light.position }
            },
            vertexShader: `
                varying vec2 v_uv;
                varying float v_lighting; // Gửi thông tin ánh sáng tới fragment shader
                
                uniform vec3 u_lightDirection;

                void main() {
                    v_uv = uv;
                    
                    // Tính toán ánh sáng đơn giản
                    vec3 transformedNormal = normalMatrix * normal;
                    vec3 lightDir = normalize(u_lightDirection);
                    v_lighting = max(dot(transformedNormal, lightDir), 0.2); // 0.2 là ánh sáng môi trường
                    
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform sampler2D u_texture;
                uniform vec3 u_color;
                uniform float u_intensity;
                
                varying vec2 v_uv;
                varying float v_lighting;

                // Hàm chuyển đổi RGB sang độ sáng (Luminance)
                float toLuminance(vec3 color) {
                    return dot(color, vec3(0.299, 0.587, 0.114));
                }

                // Hàm blend "Overlay" - một lựa chọn tốt cho son môi
                vec3 blendOverlay(vec3 base, vec3 blend) {
                    return mix(
                        1.0 - 2.0 * (1.0 - base) * (1.0 - blend),
                        2.0 * base * blend,
                        step(base, vec3(0.5))
                    );
                }

                void main() {
                    vec3 originalColor = texture2D(u_texture, v_uv).rgb;
                    
                    // ✨ NÂNG CẤP BLENDING: Dùng chế độ Overlay
                    vec3 blendedColor = blendOverlay(originalColor, u_color);

                    // Trộn màu cuối cùng dựa trên cường độ
                    vec3 finalColor = mix(originalColor, blendedColor, u_intensity);

                    // Áp dụng hiệu ứng ánh sáng 3D
                    finalColor *= v_lighting;

                    gl_FragColor = vec4(finalColor, 1.0);
                }
            `,
            transparent: false, // Để true có thể gây lỗi với Z-fighting
            depthWrite: true,
            wireframe: debugToggle.checked
        });
    };

    const initialColor = colorPicker.value;
    const upperMaterial = createAdvancedLipMaterial(initialColor);
    const lowerMaterial = createAdvancedLipMaterial(initialColor);

    // Geometry sẽ được tạo rỗng và cập nhật trong vòng lặp
    const upperGeometry = new THREE.BufferGeometry();
    const lowerGeometry = new THREE.BufferGeometry();

    upperLipMesh = new THREE.Mesh(upperGeometry, upperMaterial);
    lowerLipMesh = new THREE.Mesh(lowerGeometry, lowerMaterial);

    // Z-offset nhỏ để tránh hiện tượng Z-fighting nếu cần
    upperLipMesh.position.z = 0.01;
    lowerLipMesh.position.z = 0.01;

    scene.add(upperLipMesh);
    scene.add(lowerLipMesh);

    colorPicker.addEventListener('input', () => {
        const newColor = new THREE.Color(colorPicker.value);
        upperLipMesh.material.uniforms.u_color.value.copy(newColor);
        lowerLipMesh.material.uniforms.u_color.value.copy(newColor);
    });
}


function updateLipGeometry(landmarks) {
    const aspect = VIDEO_WIDTH / VIDEO_HEIGHT;

    // ✨ NÂNG CẤP: Sử dụng ShapeGeometry để tạo lưới môi hoàn hảo
    const createGeometryFromPoints = (pointsIndices) => {
        const points = [];
        const uvs = [];
        pointsIndices.forEach(index => {
            const lm = landmarks[index];
            // Chuyển đổi tọa độ MediaPipe (0.0 -> 1.0) sang tọa độ màn hình Three.js
            // Lật X vì video bị mirror
            const x = (1.0 - lm.x) * 2.0 * aspect - aspect;
            const y = (1.0 - lm.y) * 2.0 - 1.0;
            points.push(new THREE.Vector2(x, y));
            uvs.push(new THREE.Vector2(lm.x, 1.0 - lm.y));
        });

        const shape = new THREE.Shape(points);
        const geometry = new THREE.ShapeGeometry(shape);
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs.flatMap(v => [v.x, v.y]), 2));

        // Tính toán pháp tuyến để shader có thể tính toán ánh sáng
        geometry.computeVertexNormals();

        return geometry;
    };

    // Cập nhật geometry cho môi trên và dưới
    const upperGeometry = createGeometryFromPoints(UPPER_LIP_OUTER);
    const lowerGeometry = createGeometryFromPoints(LOWER_LIP_OUTER);

    upperLipMesh.geometry.dispose(); // Xóa geometry cũ
    upperLipMesh.geometry = upperGeometry;

    lowerLipMesh.geometry.dispose(); // Xóa geometry cũ
    lowerLipMesh.geometry = lowerGeometry;

    upperLipMesh.visible = true;
    lowerLipMesh.visible = true;
}

function updateDebugInfo(faceDetected, landmarks = null) {
    if (debugToggle.checked) {
        let info = `
            <strong>--- DEBUG INFO ---</strong><br>
            - Trạng thái: ${faceDetected ? '<span style="color: #00ff00;">Đã phát hiện</span>' : '<span style="color: #ff0000;">Không tìm thấy</span>'}<br>
            - Camera: Orthographic<br>
        `;
        if (landmarks && upperLipMesh) {
            info += `- Triangles: Trên-${upperLipMesh.geometry.index.count / 3}, Dưới-${lowerLipMesh.geometry.index.count / 3}<br>`;
            info += `- Shader: Advanced (Overlay + Lighting)<br>`;
        }
        debugInfoPanel.innerHTML = info;
    }
}

// --- Khởi chạy ứng dụng ---
main();