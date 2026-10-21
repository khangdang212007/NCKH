// ==========================================
// CẤU HÌNH VÀ QUẢN LÝ API KEY
// ==========================================
const GEMINI_MODEL = "gemini-3.5-flash-lite";

function getApiKey() {
    return localStorage.getItem("chemsafe_gemini_key") || "";
}

function updateApiStatusUI() {
    const key = getApiKey();
    const statusText = document.getElementById("api-status-text");
    const statusDot = document.getElementById("status-dot");

    if (key) {
        if (statusText) statusText.textContent = "Đã lưu khóa Gemini";
        if (statusDot) statusDot.style.background = "#22c55e"; // Xanh lá
    } else {
        if (statusText) statusText.textContent = "Đang dùng Local + PubChem";
        if (statusDot) statusDot.style.background = "#ef4444"; // Đỏ
    }
}

function openApiModal() {
    const modal = document.getElementById("api-modal");
    const input = document.getElementById("api-key-input");
    input.value = getApiKey();
    modal.style.display = "flex";
}

function closeApiModal() {
    document.getElementById("api-modal").style.display = "none";
}

function saveApiKey() {
    const input = document.getElementById("api-key-input");
    const key = input.value.trim();
    if (key) {
        localStorage.setItem("chemsafe_gemini_key", key);
        alert("Đã lưu API Key thành công!");
    } else {
        localStorage.removeItem("chemsafe_gemini_key");
        alert("Đã xóa API Key, hệ thống sẽ dùng chế độ Local.");
    }
    closeApiModal();
    updateApiStatusUI();
}

// Khởi chạy kiểm tra trạng thái ban đầu
document.addEventListener("DOMContentLoaded", updateApiStatusUI);

// ==========================================
// HÀM GỌI GEMINI API
// ==========================================
const SYSTEM_PROMPT = `Bạn là ChemSafe AI - trợ lý chuyên gia về an toàn hóa chất, độc học và phòng thí nghiệm.
Nhiệm vụ của bạn:
1. Giải đáp thắc mắc về tính chất vật lý, hóa học, mức độ độc hại của các chất.
2. Cảnh báo các nguy cơ khi pha trộn các hóa chất với nhau (tỏa nhiệt, sinh khí độc, nổ,...).
3. Hướng dẫn sơ cứu y tế khẩn cấp khi tiếp xúc hóa chất theo chuẩn GHS/MSDS.
4. Hướng dẫn tính toán nồng độ, pha loãng dung dịch chi tiết từng bước.
Yêu cầu trả lời: Ngắn gọn, chính xác, định dạng rõ ràng (dùng gạch đầu dòng, công thức hóa học rõ nét), luôn ưu tiên tính mạng và quy tắc an toàn phòng thí nghiệm.`;

async function callGeminiAI(userPrompt) {
    const apiKey = getApiKey();
    if (!apiKey) {
        throw new Error("Vui lòng nhập API Key để sử dụng AI trực tuyến.");
    }

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const history = typeof conversationHistory !== "undefined"
        ? conversationHistory.slice(-12).map(message => ({
            role: message.role === "assistant" ? "model" : "user",
            parts: [{ text: message.content }]
        }))
        : [];
    const lastMessage = history[history.length - 1];
    const contents = lastMessage?.role === "user" && lastMessage.parts[0].text === userPrompt
        ? history
        : [...history, { role: "user", parts: [{ text: userPrompt }] }];

    const payload = {
        systemInstruction: {
            parts: [{ text: SYSTEM_PROMPT }]
        },
        contents,
        generationConfig: {
            temperature: 0.3, // Nhiệt độ thấp để trả lời chính xác dữ liệu khoa học
            maxOutputTokens: 1500
        }
    };

    const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(30000)
    });

    let data;
    try {
        data = await response.json();
    } catch {
        throw new Error(`Gemini API trả về dữ liệu không hợp lệ (HTTP ${response.status}).`);
    }
    if (!response.ok) {
        throw new Error(data.error?.message || `Gemini API trả về HTTP ${response.status}`);
    }

    const answer = data.candidates?.[0]?.content?.parts
        ?.map(part => part.text || "")
        .join("")
        .trim();
    if (!answer) {
        throw new Error("Gemini không trả về nội dung. Kiểm tra giới hạn API hoặc bộ lọc an toàn.");
    }
    return answer;
}