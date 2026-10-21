# Hướng dẫn: Video + Tự làm thí nghiệm Fe + CuSO₄ (theo kiểu vibe coding)

## 0. Đã thay đổi những gì?

| File | Thay đổi |
| --- | --- |
| `experiments/fe-cuso4.html` | **MỚI.** Chứa cả video cũ + phòng lab kéo-thả. Mở trực tiếp được bằng trình duyệt. |
| `app.js` | `EXPERIMENT_DATABASE` giờ chỉ lưu `{ title, src }` thay vì cả trang HTML dài 130 dòng. `openExperimentModal()` nạp file bằng `iframe.src`. Modal to hơn (1180px). Vẫn chạy được kiểu cũ (chuỗi HTML). |
| Các file khác | Không đổi. |

Cách chạy: mở `index.html` như cũ → chat "Fe tác dụng với CuSO4" → bấm **🧪 Xem video & tự làm thí nghiệm**.
Hoặc mở thẳng `experiments/fe-cuso4.html` (thêm `?mode=practice` để vào luôn chế độ tự làm, `?debug=1` để bật bảng debug).

> **Vì sao tách ra file riêng?** Trước đây trang thí nghiệm nằm trong một chuỗi template `` `...` `` của app.js. Kiểu đó rất dễ lỗi: chỉ cần gõ nhầm một dấu `` ` `` hoặc `${` là hỏng cả app.js, phải viết `<\/script>`, và F12 không chỉ đúng dòng lỗi. File riêng thì AI sửa an toàn hơn, editor tô màu đúng, lỗi báo đúng dòng.

---

## 1. Bức tranh tổng thể

```
fe-cuso4.html
├── PHẦN 1 · HTML/CSS
│   ├── #videoPane  (SVG "video" cũ)
│   └── #labPane    (SVG lab tương tác)   ← .layout[data-mode="watch" | "practice"]
├── PHẦN 2 · VIDEO   → window.Video.playSegment(a, b)
└── PHẦN 3 · LAB     → window.LAB.goto(k), LAB.state, LAB.CFG
```

- **Chế độ "Xem video"**: chỉ hiện video, giống bản cũ.
- **Chế độ "Tự làm"**: lab bên trái, video nhỏ bên phải. Mỗi khi bạn sang bước mới, video **tự nhảy tới đúng đoạn của bước đó và lặp lại**, nên bạn vừa xem mẫu vừa làm theo. Màn hình hẹp thì video nằm dưới lab.

### Ý tưởng cốt lõi: video là hàm của thời gian

"Video" không phải file .mp4. Nó là SVG được vẽ lại 60 lần/giây theo một biến `T` (giây):

```js
draw(T)  // T = 7.3 → đinh đang trên giấy nhám, gỉ còn 50%...
```

`kf(T, [[mốc, giá trị], ...])` nội suy giá trị giữa các mốc thời gian (keyframe). Vì video chỉ là `draw(T)`, muốn "phát đoạn bước 2" thì đặt `T` chạy từ 12 → 17 rồi quay lại. Đó là toàn bộ `Video.playSegment(12, 17)`.

### Ý tưởng cốt lõi của lab: máy trạng thái (state machine)

Lab **không** chạy theo thời gian mà theo **trạng thái** `S`:

```js
S = { step: 2, rust: 0, ml: 1.4, clamp: false, prog: 0, ... }
```

| step | Bạn phải làm | Điều kiện qua bước |
| --- | --- | --- |
| 0 | Bấm 🥽 và 🧤 | `S.gog && S.glo` |
| 1 | Kéo đinh lên giấy nhám, chà trái↔phải | `S.rust === 0` rồi thả tay |
| 2 | Kéo lọ tới miệng ống, giữ để rót | thả tay khi `2 ≤ S.ml ≤ 3.2` |
| 3 | Kéo kẹp vào đầu đinh, rồi kéo đinh vào ống | `S.clamp` rồi thả trên ống |
| 4 | Chờ (giữ ⏩ để tua) | `S.prog === 1` |
| 5 | Kéo đinh ra + trả lời 3 câu hỏi | đúng cả 3 → `S.done` |

Mọi thứ bạn thấy trên màn hình đều được **vẽ ra từ `S`** trong `render()`. Ví dụ: `opacity` lớp gỉ = `0.9 * S.rust`, màu dung dịch = trộn xanh → nhạt theo `S.prog`. Nên khi có lỗi hiển thị, **chỉ cần nhìn `S` là biết lỗi nằm ở logic hay ở phần vẽ**.

### Vòng lặp mỗi khung hình

```
requestAnimationFrame → update(dt)  : đổi số (rót thêm ml, tăng prog, vật trượt về chỗ)
                     → render(t)   : ghi số ra thuộc tính SVG (transform, opacity, d)
```

Vật kéo-thả dùng kỹ thuật "đuổi theo đích": mỗi vật có vị trí hiện tại `x,y,r` và vị trí đích `tx,ty,tr`. Thả tay thì chỉ cần đặt `tx,ty = HOME`, vật tự trượt về mượt mà.

### Kéo-thả hoạt động thế nào

1. `pointerdown` trên phần tử có `data-item="nail"` → gọi `canDrag('nail')`. Nếu sai bước, nó trả về **câu gợi ý** và hiện toast thay vì cho kéo. (Ví dụ: cầm đinh bằng tay ở bước 3 → "✋ Không cầm đinh bằng tay! Dùng kẹp".)
2. `pointermove` → đổi toạ độ màn hình sang toạ độ SVG bằng `pt(e)` (dùng `getScreenCTM().inverse()`, nên co giãn cửa sổ vẫn đúng), rồi xét **vùng đặc biệt**:
   - con trỏ trên giấy nhám → đinh nằm ngang, cộng dồn `|dx|` vào `S.rub`
   - con trỏ trên miệng ống → lọ nghiêng 170°, `S.pouring = true`
3. `pointerup` → `endDrag()` quyết định thành công hay hiện gợi ý.

Pointer Events chạy cho cả chuột lẫn cảm ứng. `touch-action:none` trên `#lab` giúp kéo trên điện thoại không bị cuộn trang.

---

## 2. Muốn chỉnh nhanh? Sửa `CFG`

```js
const CFG = {
  RUB_NEEDED: 1200,   // chà ít hơn → giảm số này
  POUR_RATE: 0.6,     // rót nhanh hơn → tăng
  REACT_SECONDS: 25,  // phản ứng nhanh hơn → giảm
  FF_MULT: 8,         // tua nhanh gấp mấy lần
  ...
};
```

Đoạn video tương ứng với từng bước nằm ở `LAB_STEPS[i].seg = [giây bắt đầu, giây kết thúc]`. Câu hỏi quan sát nằm ở mảng `QUIZ`.

---

## 3. Debug nhanh

### Bật chế độ debug

Mở `experiments/fe-cuso4.html?debug=1`:

- Góc phải dưới hiện bảng `S` cập nhật liên tục.
- Console in log `[LAB] grab nail`, `[LAB] drop nail 300 180`, `[LAB] step → 3`...

### Lệnh trong Console (F12)

```js
LAB.goto(3)            // nhảy thẳng tới bước 3 (tự hoàn thành bước 0–2)
LAB.state              // xem trạng thái hiện tại
LAB.state.ml = 2.5     // sửa trạng thái trực tiếp
LAB.CFG.RUB_NEEDED=100 // chà 1 cái là sạch, để test cho nhanh
Video.playSegment(12,17)
```

> Lưu ý: khi trang chạy **bên trong modal** của app, Console mặc định đang ở trang ngoài. Chọn ô "top" ở góc trái thanh Console → đổi sang frame `fe-cuso4.html`, hoặc mở thẳng file thí nghiệm để debug.

### Bảng tra lỗi thường gặp

| Triệu chứng | Nguyên nhân hay gặp | Xem ở đâu |
| --- | --- | --- |
| Kéo được nhưng không "ăn" vùng (chà không hết gỉ, rót không chảy) | Xét vùng bằng toạ độ **gốc vật** thay vì **con trỏ**. Người dùng nắm giữa thân đinh nên gốc (đầu đinh) lệch 80px. *Lỗi này đã xảy ra thật khi làm bản này và đã sửa.* | `pointermove`: dùng `p.x, p.y` |
| Không kéo được gì cả | Một phần tử khác (nhãn, vòng gợi ý) nằm đè lên và "ăn" click | Thêm `pointer-events="none"` cho phần tử trang trí |
| Kéo ở sai bước không có phản ứng | `canDrag()` trả về chuỗi → hiện toast. Nếu toast không hiện thì kiểm tra `#Ltoast` | `canDrag` |
| Video không nhảy theo bước | `mode` không phải `'practice'`, hoặc `seg` bị xoá vì bạn kéo thanh tua | `setStep`, `$('sl').oninput` |
| Modal trắng trơn | Sai đường dẫn `src` (phân biệt hoa/thường khi đưa lên host Linux) | `EXPERIMENT_DATABASE` trong app.js, tab Network |
| Lỗi `Identifier 'xxx' has already been declared` | Hai `<script>` cùng khai báo một tên `const` | Phần LAB đã bọc trong `(function(){ ... })()` để tránh lỗi này. Giữ nguyên lớp bọc đó. |
| Trên điện thoại kéo bị cuộn trang | Thiếu `touch-action:none` | CSS `#lab` |

### Quy trình 3 bước khi gặp bug

1. **Tái hiện nhanh:** `LAB.goto(n)` tới đúng bước bị lỗi, khỏi phải làm lại từ đầu.
2. **Nhìn `S`** (bật `?debug=1`): số có đổi đúng không?
   - Số **sai** → lỗi ở logic (`pointermove`, `endDrag`, `update`).
   - Số **đúng** mà hình sai → lỗi ở `render()`.
3. **Đưa cho AI đúng ngữ cảnh** (xem mẫu prompt bên dưới).

---

## 4. Vibe coding: prompt mẫu để làm tiếp

Mẹo chung: **nói rõ file, phần, tên hàm, và hành vi mong muốn đo được.** Dán kèm bảng debug `S` khi báo lỗi.

**Báo bug:**

```
Trong experiments/fe-cuso4.html, PHẦN 3 · LAB, bước 2 (rót CuSO₄):
khi tôi giữ lọ trên miệng ống thì lọ nghiêng nhưng S.ml không tăng.
Bảng debug: {"step":2,"pouring":true,"ml":0,...}
Hãy tìm nguyên nhân trong update()/pointermove và sửa tối thiểu, giải thích ngắn.
```

**Thêm tính năng:**

```
Trong fe-cuso4.html, thêm âm thanh "xèo" nhẹ khi chà giấy nhám (bước 1),
dùng Web Audio API tạo tiếng ồn trắng, không dùng file mp3.
Chỉ phát khi S.sanding === true và con trỏ đang di chuyển. Giữ nguyên cấu trúc S/update/render.
```

```
Cho phép kéo cao/thấp khi nhúng đinh (bước 3) để chọn độ sâu.
Đoạn đinh dưới mặt dung dịch mới phủ đồng (đang tính trong dipNail() bằng S.cuY).
Nếu nhúng ngập cả đầu đinh thì hiện toast cảnh báo.
```

**Thêm thí nghiệm mới (ví dụ Zn + HCl):**

```
Tạo experiments/zn-hcl.html theo đúng khung của fe-cuso4.html
(PHẦN 2 VIDEO dùng draw(T)+kf, PHẦN 3 LAB dùng S/LAB_STEPS/canDrag/update/render).
Các bước: đeo bảo hộ → cho viên Zn vào ống → rót 2 ml HCl → quan sát bọt khí H₂ → câu hỏi.
Rồi thêm vào EXPERIMENT_DATABASE trong app.js với khóa "zn|hcl".
```

(Nhớ kiểm tra `keysByFormula` trong `getChemicalCatalog()` có khóa `zn` và `hcl`. Thứ tự hai chất không quan trọng vì code sắp xếp trước khi so khớp.)

---

## 5. Sơ đồ luồng một lần chơi

```
[Xem video] --(bấm "Tự làm")--> mode=practice
   setStep(0) ──► Video.playSegment(0,4) lặp
   bấm 🥽🧤 ───► setStep(1) ──► video đoạn 4–12
   chà hết gỉ ──► setStep(2) ──► video đoạn 12–17
   rót 2–3 ml ─► setStep(3) ──► video đoạn 17–20.5
   kẹp + nhúng ► dipNail() → setStep(4) ──► video 20–29.5
   prog = 1 ───► setStep(5) ──► video 29.5–42
   kéo đinh ra ► removeNail() → renderQuiz()
   đúng 3 câu ─► finish()  → hiện phương trình + giải thích
```
