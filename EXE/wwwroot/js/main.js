// =================================================================================
// CHỨC NĂNG: Khởi tạo và chạy ứng dụng AR Filter
// MÔ TẢ:
// - Truy cập camera của người dùng.
// - Tải và cấu hình MediaPipe Face Mesh để phát hiện khuôn mặt.
// - Tải dữ liệu và hình ảnh của bộ râu.
// - Trong mỗi khung hình, phát hiện các điểm mốc trên khuôn mặt.
// - Tính toán vị trí, tỷ lệ và góc xoay của bộ râu.
// - Vẽ bộ râu và thông tin debug lên canvas.
// =================================================================================

// --- Lấy các phần tử HTML ---
const videoElement = document.getElementById('webcam');
const canvasElement = document.getElementById('output-canvas');
const canvasCtx = canvasElement.getContext('2d');
const debugToggle = document.getElementById('debug-mode');
const debugInfoPanel = document.getElementById('debug-info');

// --- Biến toàn cục ---
let mustacheData = {}; // Lưu trữ dữ liệu từ file mustache.csv
const mustacheImage = new Image(); // Đối tượng hình ảnh cho bộ râu

// =================================================================================
// BƯỚC 1: TẢI DỮ LIỆU VÀ HÌNH ẢNH CẦN THIẾT
// =================================================================================

/**
 * Tải và phân tích cú pháp tệp CSV chứa dữ liệu về bộ râu.
 * Dữ liệu này cho biết các điểm neo (trái, phải, trên, dưới) trên ảnh gốc.
 * @returns {Promise<object>} Một đối tượng chứa dữ liệu đã được phân tích.
 */
async function loadMustacheData() {
    try {
        const response = await fetch('/data/mustache.csv');
        const csvText = await response.text();
        const lines = csvText.split('\r\n').filter(line => line.length > 0); // Lọc các dòng rỗng

        const data = {};
        // Bỏ qua dòng tiêu đề (i=1)
        for (let i = 1; i < lines.length; i++) {
            const [label, x, y, filename, image_width, image_height] = lines[i].split(',');
            if (label && x && y) {
                data[label] = { x: parseInt(x), y: parseInt(y) };
            }
            if (i === 1) { // Lấy kích thước ảnh từ dòng đầu tiên
                data.image_width = parseInt(image_width);
                data.image_height = parseInt(image_height);
            }
        }
        console.log("Tải dữ liệu bộ râu thành công:", data);
        return data;
    } catch (error) {
        console.error("Lỗi khi tải file mustache.csv:", error);
        alert("Không thể tải dữ liệu của bộ râu. Vui lòng kiểm tra console.");
        return {};
    }
}

// Bắt đầu tải dữ liệu và ảnh ngay khi script được chạy
loadMustacheData().then(data => {
    mustacheData = data;
    mustacheImage.src = '/images/mustache.png'; // Tải ảnh sau khi có dữ liệu
});

mustacheImage.onload = () => {
    console.log("Tải ảnh bộ râu thành công.");
};

mustacheImage.onerror = () => {
    console.error("Lỗi khi tải file mustache.png.");
    alert("Không thể tải hình ảnh bộ râu.");
};

// =================================================================================
// BƯỚC 2: CẤU HÌNH MEDIAPIPE FACE MESH
// =================================================================================

const faceMesh = new FaceMesh({
    locateFile: (file) => {
        return `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`;
    }
});

faceMesh.setOptions({
    maxNumFaces: 1, // Chỉ xử lý một khuôn mặt để tối ưu hiệu suất
    refineLandmarks: true, // Tăng độ chính xác quanh mắt và môi, cần thiết cho filter
    minDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5
});

// Đăng ký hàm callback `onResults` để xử lý khi có kết quả
faceMesh.onResults(onResults);

// =================================================================================
// BƯỚC 3: TRUY CẬP CAMERA VÀ CHẠY VÒNG LẶP XỬ LÝ
// =================================================================================

// Sử dụng Camera utils của MediaPipe để dễ dàng quản lý camera
const camera = new Camera(videoElement, {
    onFrame: async () => {
        // Gửi khung hình hiện tại đến Face Mesh để xử lý
        await faceMesh.send({ image: videoElement });
    },
    width: 640,
    height: 480
});
camera.start();

// =================================================================================
// BƯỚC 4: HÀM XỬ LÝ KẾT QUẢ VÀ VẼ LÊN CANVAS (TRÁI TIM CỦA ỨNG DỤNG)
// =================================================================================

/**
 * Được gọi mỗi khi MediaPipe xử lý xong một khung hình.
 * @param {object} results - Đối tượng chứa kết quả phát hiện khuôn mặt.
 */
function onResults(results) {
    // Thiết lập kích thước canvas khớp với video
    canvasElement.width = videoElement.videoWidth;
    canvasElement.height = videoElement.videoHeight;

    // --- Xóa và vẽ lại canvas ---
    canvasCtx.save();
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);

    // LẬT NGANG CANVAS để tạo hiệu ứng gương soi (quan trọng cho trải nghiệm người dùng)
    // Di chuyển của bạn ngoài đời sẽ khớp với trên màn hình.
    canvasCtx.translate(canvasElement.width, 0);
    canvasCtx.scale(-1, 1);

    // Vẽ khung hình video hiện tại lên canvas
    canvasCtx.drawImage(results.image, 0, 0, canvasElement.width, canvasElement.height);

    // --- Xử lý và vẽ filter nếu phát hiện khuôn mặt ---
    if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0 && mustacheImage.complete) {
        // Chỉ lấy khuôn mặt đầu tiên
        const landmarks = results.multiFaceLandmarks[0];

        // --- Tính toán vị trí, tỷ lệ và góc xoay ---

        // 1. VỊ TRÍ (ANCHOR POINT)
        // Ta chọn điểm mốc 164, là điểm ngay dưới vách ngăn mũi.
        // Đây là vị trí neo rất ổn định cho bộ râu.
        // Tọa độ là dạng chuẩn hóa (0.0 - 1.0), cần nhân với kích thước canvas.
        const anchorPoint = {
            x: landmarks[164].x * canvasElement.width,
            y: landmarks[164].y * canvasElement.height,
        };

        // 2. TỶ LỆ (SCALE)
        // Ta dùng khoảng cách giữa hai má (điểm 234 và 454) để đo độ rộng khuôn mặt.
        const leftCheek = { x: landmarks[234].x * canvasElement.width, y: landmarks[234].y * canvasElement.height };
        const rightCheek = { x: landmarks[454].x * canvasElement.width, y: landmarks[454].y * canvasElement.height };
        const faceWidth = Math.hypot(rightCheek.x - leftCheek.x, rightCheek.y - leftCheek.y);

        // Lấy chiều rộng gốc của bộ râu từ file CSV
        const originalMustacheWidth = mustacheData.right_point.x - mustacheData.left_point.x;
        // Tỷ lệ = chiều rộng khuôn mặt thực tế / chiều rộng bộ râu gốc
        // Có thể nhân với một hệ số để tinh chỉnh kích thước cho vừa vặn hơn.
        // THAM SỐ TÙY CHỈNH: Thay đổi giá trị 1.2 để làm bộ râu to hơn hoặc nhỏ hơn.
        const scale = (faceWidth / originalMustacheWidth) * 1.2;

        // 3. GÓC XOAY (ROTATION)
        // Ta tính góc nghiêng của đường thẳng nối hai má.
        const angle = Math.atan2(rightCheek.y - leftCheek.y, rightCheek.x - leftCheek.x);


        // --- Vẽ bộ râu lên canvas ---
        canvasCtx.save();

        // Di chuyển gốc tọa độ đến điểm neo trên khuôn mặt
        canvasCtx.translate(anchorPoint.x, anchorPoint.y);
        // Xoay canvas theo góc nghiêng của đầu
        canvasCtx.rotate(angle);
        // Phóng to/thu nhỏ canvas
        canvasCtx.scale(scale, scale);

        // Điểm neo trên ảnh bộ râu là "top_center".
        // Ta cần vẽ ảnh với một độ lệch âm để điểm neo này trùng với gốc tọa độ mới.
        const mustacheAnchor = mustacheData.top_center;
        canvasCtx.drawImage(
            mustacheImage,
            -mustacheAnchor.x, // Dịch chuyển sang trái bằng tọa độ x của điểm neo
            -mustacheAnchor.y, // Dịch chuyển lên trên bằng tọa độ y của điểm neo
            mustacheData.image_width,
            mustacheData.image_height
        );

        // Khôi phục lại trạng thái canvas để các thao tác vẽ sau không bị ảnh hưởng
        canvasCtx.restore();

        // --- Hiển thị thông tin debug nếu được bật ---
        if (debugToggle.checked) {
            drawDebugInfo(landmarks, { scale, angle: angle * (180 / Math.PI), position: anchorPoint });
        }
    }

    // Khôi phục lại trạng thái canvas ban đầu (trước khi lật ngang)
    canvasCtx.restore();
}


// =================================================================================
// BƯỚC 5: CÁC HÀM HỖ TRỢ VÀ DEBUG
// =================================================================================

/**
 * Vẽ thông tin gỡ lỗi lên canvas và panel.
 * @param {Array} landmarks - Mảng các điểm mốc của khuôn mặt.
 * @param {object} filterData - Dữ liệu đã tính toán (tỷ lệ, góc xoay, vị trí).
 */
function drawDebugInfo(landmarks, filterData) {
    debugInfoPanel.style.display = 'block';

    // Vẽ tất cả các điểm mốc và kết nối của khuôn mặt
    drawConnectors(canvasCtx, landmarks, FACEMESH_TESSELATION, { color: '#C0C0C070', lineWidth: 1 });
    drawConnectors(canvasCtx, landmarks, FACEMESH_RIGHT_EYE, { color: '#FF3030' });
    drawConnectors(canvasCtx, landmarks, FACEMESH_RIGHT_EYEBROW, { color: '#FF3030' });
    drawConnectors(canvasCtx, landmarks, FACEMESH_LEFT_EYE, { color: '#30FF30' });
    drawConnectors(canvasCtx, landmarks, FACEMESH_LEFT_EYEBROW, { color: '#30FF30' });
    drawConnectors(canvasCtx, landmarks, FACEMESH_FACE_OVAL, { color: '#E0E0E0' });
    drawConnectors(canvasCtx, landmarks, FACEMESH_LIPS, { color: '#E0E0E0' });

    // Vẽ các điểm mốc quan trọng dùng để tính toán với màu khác biệt
    const keyLandmarksIndices = [164, 234, 454]; // [anchor, leftCheek, rightCheek]
    for (const index of keyLandmarksIndices) {
        const point = landmarks[index];
        canvasCtx.beginPath();
        canvasCtx.arc(point.x * canvasElement.width, point.y * canvasElement.height, 5, 0, 2 * Math.PI);
        canvasCtx.fillStyle = 'red'; // Vẽ màu đỏ để nổi bật
        canvasCtx.fill();
    }

    // Cập nhật thông tin text vào panel debug
    debugInfoPanel.innerHTML = `
        <strong>--- DEBUG INFO ---</strong><br>
        - Vị trí (x, y): (${filterData.position.x.toFixed(2)}, ${filterData.position.y.toFixed(2)})<br>
        - Tỷ lệ: ${filterData.scale.toFixed(3)}<br>
        - Góc xoay: ${filterData.angle.toFixed(2)} độ
    `;
}

// Lắng nghe sự kiện thay đổi của checkbox debug
debugToggle.addEventListener('change', () => {
    if (!debugToggle.checked) {
        debugInfoPanel.style.display = 'none'; // Ẩn panel khi tắt debug
    }
});