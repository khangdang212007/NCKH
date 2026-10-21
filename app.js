// ═══════════════════════════════════════
//   CHEMSAFE AI — APP.JS
//   Chat local + PubChem PUG REST, không cần API key
// ═══════════════════════════════════════

const PUBCHEM_PUG_BASE = "https://pubchem.ncbi.nlm.nih.gov/rest/pug";
const PUBCHEM_PROPERTIES = "Title,IUPACName,MolecularFormula,MolecularWeight";

// ── Lịch sử hội thoại ──
let conversationHistory = [];
let chatRequestPending = false;
let chatMessageSequence = 0;

// ── THÍ NGHIỆM MÔ PHỎNG ──
// Mỗi thí nghiệm là 1 file HTML riêng trong thư mục experiments/
// Khóa = các key hóa chất nối bằng "|" (xem keysByFormula trong getChemicalCatalog)
const EXPERIMENT_DATABASE = {
  "fe|cuso4": {
    title: "Thí nghiệm: Đinh sắt + dung dịch CuSO₄",
    src: "experiments/fe-cuso4.html"
  }
};

function getStartupNotice() {
  return `✅ **ChemSafe AI đang chạy bằng dữ liệu local + PubChem**\n\nTôi sẽ tìm trong \`chemdata.js\` trước. Nếu chưa có, tôi tự tra PubChem PUG REST miễn phí và không cần API key.`;
}

const SUBSCRIPT_DIGITS = {
  "₀": "0", "₁": "1", "₂": "2", "₃": "3", "₄": "4",
  "₅": "5", "₆": "6", "₇": "7", "₈": "8", "₉": "9"
};

const ELEMENT_SYMBOLS = new Set([
  "H", "He", "Li", "Be", "B", "C", "N", "O", "F", "Ne",
  "Na", "Mg", "Al", "Si", "P", "S", "Cl", "Ar", "K", "Ca",
  "Sc", "Ti", "V", "Cr", "Mn", "Fe", "Co", "Ni", "Cu", "Zn",
  "Ga", "Ge", "As", "Se", "Br", "Kr", "Rb", "Sr", "Y", "Zr",
  "Nb", "Mo", "Tc", "Ru", "Rh", "Pd", "Ag", "Cd", "In", "Sn",
  "Sb", "Te", "I", "Xe", "Cs", "Ba", "La", "Ce", "Pr", "Nd",
  "Pm", "Sm", "Eu", "Gd", "Tb", "Dy", "Ho", "Er", "Tm", "Yb",
  "Lu", "Hf", "Ta", "W", "Re", "Os", "Ir", "Pt", "Au", "Hg",
  "Tl", "Pb", "Bi", "Po", "At", "Rn", "Fr", "Ra", "Ac", "Th",
  "Pa", "U", "Np", "Pu", "Am", "Cm", "Bk", "Cf", "Es", "Fm",
  "Md", "No", "Lr", "Rf", "Db", "Sg", "Bh", "Hs", "Mt", "Ds",
  "Rg", "Cn", "Nh", "Fl", "Mc", "Lv", "Ts", "Og"
]);

function normalizeText(value) {
  return String(value || "")
    .replace(/[₀₁₂₃₄₅₆₇₈₉]/g, ch => SUBSCRIPT_DIGITS[ch] || ch)
    .toLowerCase()
    .normalize("NFD")
    .replace(/đ/g, "d")
    .replace(/[\u0300-\u036f]/g, "");
}

function compactFormula(value) {
  return normalizeText(value).replace(/[^a-z0-9]/g, "");
}

function getCompactTokens(value) {
  const plain = String(value || "").replace(/[₀₁₂₃₄₅₆₇₈₉]/g, ch => SUBSCRIPT_DIGITS[ch] || ch);
  return (plain.match(/[A-Za-z0-9]+/g) || []).map(compactFormula).filter(Boolean);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function containsTextAlias(aliasText, normalizedText) {
  const escaped = escapeRegExp(aliasText).replace(/\s+/g, "\\s+");
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{N}])`, "u").test(normalizedText);
}

function matchesChemicalAlias(alias, normalizedText, compactTokens) {
  const aliasText = normalizeText(alias);
  const aliasCompact = compactFormula(alias);
  if (!aliasText || !aliasCompact) return false;

  if (isValidFormula(alias)) {
    if (aliasCompact.length < 2) return false;
    return containsTextAlias(aliasText, normalizedText);
  }

  return aliasText.length >= 3 && containsTextAlias(aliasText, normalizedText);
}

function getChemicalNameAliases(name) {
  const raw = String(name || "").trim();
  if (!raw) return [];

  const aliases = new Set([raw]);
  const primary = raw.split(/[(/]/)[0].trim();
  if (primary) aliases.add(primary);

  for (const match of raw.matchAll(/\(([^)]+)\)/g)) {
    const part = match[1].trim();
    if (!part) continue;
    aliases.add(part);
    part.split(/[;,/]/).map(item => item.trim()).filter(Boolean).forEach(item => aliases.add(item));
  }

  return [...aliases].filter(alias => normalizeText(alias).length >= 3);
}

function isValidFormula(value) {
  const formula = String(value || "").replace(/[₀₁₂₃₄₅₆₇₈₉]/g, ch => SUBSCRIPT_DIGITS[ch] || ch);
  if (!formula || /[^A-Za-z0-9]/.test(formula)) return false;

  let position = 0;
  const matcher = /([A-Z][a-z]?)(\d*)/g;
  let match;
  while ((match = matcher.exec(formula)) !== null) {
    if (match.index !== position || !ELEMENT_SYMBOLS.has(match[1])) return false;
    position = matcher.lastIndex;
  }

  return position === formula.length;
}

function getChemicalCatalog() {
  const keysByFormula = {
    hcl: "hcl", h2so4: "h2so4", hno3: "hno3", naoh: "naoh", koh: "koh",
    nh3: "nh3", h2o2: "h2o2", cl2: "cl2", c2h5oh: "ethanol",
    ch3coch3: "acetone", ch3oh: "methanol", nacl: "nacl", hf: "hf", kmno4: "kmno4",
    fe: "fe", cuso4: "cuso4"
  };

  return CHEM_DATABASE.map(chem => ({
    ...chem,
    key: keysByFormula[compactFormula(chem.formula)] || compactFormula(chem.formula),
    aliases: [chem.formula, ...getChemicalNameAliases(chem.name), ...(chem.aliases || [])]
  }));
}

function findMentionedChemicals(text) {
  const normalized = normalizeText(text);
  const compactTokens = getCompactTokens(text);
  const seen = new Set();

  return getChemicalCatalog().filter(chem => {
    const formula = compactFormula(chem.formula);
    const name = normalizeText(chem.name);
    const aliases = chem.aliases || [];

    const matched =
      (name.length >= 3 && normalized.includes(name)) ||
      aliases.some(alias => matchesChemicalAlias(alias, normalized, compactTokens));

    if (!matched || seen.has(chem.key)) return false;
    seen.add(chem.key);
    return true;
  });
}

function formatDanger(chem) {
  return chem.dangerLabel || ({ danger: "NGUY HIỂM", caution: "THẬN TRỌNG", safe: "AN TOÀN" }[chem.danger] || "CHƯA RÕ");
}

function getPpeForChem(chem) {
  if (chem.ppe) return chem.ppe;
  const text = normalizeText(`${chem.name} ${chem.properties} ${chem.msds}`);

  if (text.includes("khi") || text.includes("amoniac") || text.includes("clo") || text.includes("hoi")) {
    return "Kính kín chống hóa chất, găng phù hợp, áo choàng/tạp dề; thao tác trong tủ hút hoặc khu vực thông gió mạnh.";
  }
  if (text.includes("axit")) {
    return "Kính chống bắn, găng chống axit, áo blouse/tạp dề chống hóa chất; dùng tủ hút nếu có hơi axit.";
  }
  if (text.includes("kiem") || text.includes("hydroxide")) {
    return "Kính chống bắn, găng nitrile/neoprene, áo blouse; tránh tiếp xúc da và mắt.";
  }
  if (text.includes("dung moi") || text.includes("de chay")) {
    return "Kính bảo hộ, găng nitrile, áo blouse; tránh nguồn lửa và làm việc nơi thông gió.";
  }
  return "Kính bảo hộ, găng tay phù hợp hóa chất và áo blouse phòng thí nghiệm.";
}

function getFirstAidForChem(chem) {
  if (chem.firstAid) return chem.firstAid;
  const text = normalizeText(`${chem.name} ${chem.properties} ${chem.msds}`);

  if (text.includes("hf") || text.includes("flohidric")) {
    return "Rửa nước ngay ít nhất 15 phút, dùng gel calcium gluconate nếu có theo SOP và gọi cấp cứu/chống độc ngay.";
  }
  if (text.includes("axit") || text.includes("kiem") || text.includes("an mon") || text.includes("hydroxide")) {
    return "Dính da/mắt: rửa nước liên tục 15-20 phút, tháo đồ nhiễm bẩn. Hít phải: ra nơi thoáng khí. Nuốt phải: không gây nôn, gọi y tế.";
  }
  if (text.includes("dung moi") || text.includes("de chay")) {
    return "Hít phải: ra nơi thoáng khí. Dính da: rửa bằng nước/xà phòng. Vào mắt: rửa 15 phút. Nuốt phải hoặc chóng mặt nặng: gọi y tế.";
  }
  return "Dính da/mắt: rửa nước 15 phút. Hít phải: ra nơi thoáng khí. Nuốt phải hoặc triệu chứng nặng: gọi cơ sở y tế.";
}

function getPhysicalProperties(chem) {
  if (chem.physicalProperties) return chem.physicalProperties;

  const details = [
    chem.state,
    chem.appearance,
    chem.colorName,
    chem.boiling && `Nhiệt độ sôi: ${chem.boiling}`,
    chem.melting && `Nhiệt độ nóng chảy: ${chem.melting}`,
    chem.solubility && `Độ tan: ${chem.solubility}`,
    chem.ph && `pH tham khảo: ${chem.ph}`
  ].filter(Boolean);

  return details.join("; ") || "Chưa cập nhật dữ liệu tính chất vật lý.";
}

function getChemicalProperties(chem) {
  return chem.chemicalProperties || chem.properties || "Chưa cập nhật dữ liệu tính chất hóa học.";
}

function buildChemicalInfoResponse(chem) {
  return `🔬 **${chem.name}**\n\n**Công thức:** ${chem.formula}\n\n**Khối lượng mol:** ${chem.molar || formatCalcNumber(chem.molarMass, "g/mol")}\n\n**Tính chất vật lý:** ${getPhysicalProperties(chem)}\n\n**Tính chất hóa học:** ${getChemicalProperties(chem)}\n\n**Cảnh báo nguy hiểm:** ${formatDanger(chem)} - ${chem.msds || getChemicalProperties(chem)}\n\n**PPE:** ${getPpeForChem(chem)}\n\n**Bảo quản:** ${chem.storage || "Bảo quản kín, có nhãn rõ, tách khỏi nhóm hóa chất tương kỵ."}\n\n**Sơ cứu:** ${getFirstAidForChem(chem)}`;
}

function buildMixResponse(first, second) {
  const key = getMixKey(first.key, second.key);
  if (!key) {
    return `⚗️ **${first.formula} + ${second.formula}**\n\nChưa có cảnh báo đặc biệt trong dữ liệu nội bộ cho tổ hợp này.\n\nVẫn cần xử lý như tình huống có rủi ro: dùng lượng nhỏ, kiểm soát nhiệt, làm trong khu vực thông gió/tủ hút, chuẩn bị PPE và không trộn nếu chưa có quy trình được phê duyệt.`;
  }

  const warning = MIX_WARNINGS[key];
  return `${warning.title}\n\n**Tổ hợp:** ${first.formula} + ${second.formula}\n\n**Phản ứng:** ${warning.reaction}\n\n**Mô tả:** ${warning.desc}\n\n**Rủi ro:** ${warning.tags.join(", ")}\n\n**Khuyến nghị:** không tự ý trộn; nếu bắt buộc trong phòng thí nghiệm, chỉ thực hiện theo SOP, trong tủ hút, có giám sát và PPE đầy đủ.`;
}

function buildCommonWarningsResponse() {
  const catalog = getChemicalCatalog();
  const byKey = Object.fromEntries(catalog.map(chem => [chem.key, chem]));
  const rows = Object.entries(MIX_WARNINGS).slice(0, 8).map(([key, warning]) => {
    const pair = key.split("|").map(part => byKey[part]?.formula || part).join(" + ");
    return `- **${pair}:** ${warning.title} - ${warning.tags.join(", ")}`;
  });

  return `⚠️ **Một số cặp hóa chất không nên trộn**\n\n${rows.join("\n")}\n\nDanh sách này không thay thế MSDS/SDS hoặc SOP của phòng thí nghiệm. Khi không chắc, hãy coi là nguy hiểm và hỏi người phụ trách an toàn.`;
}

function buildFirstAidResponse() {
  return `🚨 **Sơ cứu khi tiếp xúc hóa chất**\n\n1. Ngừng tiếp xúc ngay, đưa người bị nạn ra khu vực an toàn nếu không gây nguy hiểm thêm.\n2. Dính da: xả dưới vòi nước sạch ít nhất 15-20 phút, tháo bỏ quần áo/găng bị nhiễm.\n3. Vào mắt: rửa mắt liên tục 15-20 phút, giữ mí mắt mở, không dụi mắt.\n4. Hít phải: đưa ra nơi thoáng khí, nới lỏng quần áo, theo dõi khó thở.\n5. Nuốt phải: không tự gây nôn; kiểm tra SDS và gọi cấp cứu/trung tâm chống độc.\n\nNếu bỏng nặng, khó thở, đau mắt, hoặc hóa chất là HF/oxy hóa mạnh/ăn mòn mạnh: gọi 115 hoặc cơ sở y tế ngay.`;
}

function buildMsdsResponse(chem) {
  if (chem) {
    return `📋 **MSDS/SDS tóm tắt cho ${chem.formula} - ${chem.name}**\n\n**Nguy cơ:** ${formatDanger(chem)}\n\n**Thông tin an toàn:** ${chem.msds}\n\n**PPE:** ${getPpeForChem(chem)}\n\n**Bảo quản:** ${chem.storage}\n\n**Sơ cứu:** ${getFirstAidForChem(chem)}\n\nKhi dùng thực tế, hãy đối chiếu SDS chính thức của nhà cung cấp vì nồng độ và dạng tồn tại có thể làm thay đổi mức nguy hiểm.`;
  }

  return `📋 **MSDS/SDS là gì?**\n\nSDS là tài liệu an toàn hóa chất, thường có 16 mục: nhận dạng hóa chất, nguy cơ GHS, thành phần, sơ cứu, chữa cháy, xử lý tràn đổ, lưu trữ, PPE, tính chất lý hóa, độc tính, vận chuyển và thải bỏ.\n\nKhi đọc SDS, ưu tiên các mục: nguy cơ GHS, sơ cứu, PPE, lưu trữ, xử lý tràn đổ và tương kỵ hóa chất.`;
}

function buildStorageResponse(chem) {
  if (chem) {
    return `🏷️ **Lưu trữ ${chem.formula} - ${chem.name}**\n\n${chem.storage}\n\n**Lưu ý:** dán nhãn rõ, đóng kín nắp, tách nhóm tương kỵ, kiểm tra rò rỉ định kỳ và luôn để SDS gần khu vực sử dụng.`;
  }

  return `🏷️ **Nguyên tắc lưu trữ hóa chất**\n\n- Tách axit, bazơ, chất oxy hóa, dung môi dễ cháy và chất độc thành khu riêng.\n- Không để hóa chất theo alphabet nếu chúng tương kỵ.\n- Dán nhãn đầy đủ: tên, công thức, nồng độ, ngày nhận/mở, người phụ trách.\n- Dùng tủ hút/tủ cháy/tủ axit đúng loại và có khay chống tràn.`;
}

function buildCalculatorTutorResponse(question) {

  // ─────────────────────────────────────
  // Lấy thông tin từ prompt Calculator
  // ─────────────────────────────────────

  const chemicalMatch =
    question.match(/- Tên:\s*(.+)/);

  const formulaMatch =
    question.match(/- Công thức:\s*(.+)/);

  const molarMatch =
    question.match(/- Khối lượng mol:\s*([\d.]+)/);

  const massMatch =
    question.match(/- Khối lượng:\s*([\d.]+)/);

  const molesMatch =
    question.match(/- Số mol:\s*([\d.]+)/);

  const volumeMatch =
    question.match(/- Thể tích dung dịch:\s*([\d.]+)/);

  const resultMolesMatch =
    question.match(/Số mol:\s*([\d.]+)/);

  const molarityMatch =
    question.match(/Nồng độ mol:\s*([\d.]+)/);


  const chemical =
    chemicalMatch
      ? chemicalMatch[1].trim()
      : "hóa chất";

  const formula =
    formulaMatch
      ? formulaMatch[1].trim()
      : "";

  const molarMass =
    molarMatch
      ? Number(molarMatch[1])
      : null;

  const mass =
    massMatch
      ? Number(massMatch[1])
      : null;

  const moles =
    molesMatch
      ? Number(molesMatch[1])
      : null;

  const volume =
    volumeMatch
      ? Number(volumeMatch[1])
      : null;

  const resultMoles =
    resultMolesMatch
      ? Number(resultMolesMatch[1])
      : null;

  const molarity =
    molarityMatch
      ? Number(molarityMatch[1])
      : null;


  // ═══════════════════════════════════════
  // BẮT ĐẦU TẠO CÂU TRẢ LỜI
  // ═══════════════════════════════════════

  let response = `
🧪 **PHÂN TÍCH BÀI TOÁN TỪ CALCULATOR**

---

### 📌 1. Dữ kiện

**Hóa chất:** ${chemical}

**Công thức:** ${formula || "Không xác định"}

**Khối lượng mol:** ${molarMass !== null
      ? molarMass.toFixed(4) + " g/mol"
      : "Không xác định"
    }

`;


  // ═══════════════════════════════════════
  // KHỐI LƯỢNG → MOL
  // ═══════════════════════════════════════

  if (
    mass !== null &&
    molarMass !== null
  ) {

    const calculatedMoles =
      mass / molarMass;


    response += `
### 📐 2. Tính số mol

Khi biết khối lượng của chất, ta sử dụng công thức:

**n = m / M**

Trong đó:

- **n**: số mol (mol)
- **m**: khối lượng chất (g)
- **M**: khối lượng mol (g/mol)

Thay số:

**n = ${mass} / ${molarMass.toFixed(4)}**

→ **n ≈ ${calculatedMoles.toFixed(6)} mol**

`;


    // kiểm tra kết quả Calculator

    if (resultMoles !== null) {

      const difference =
        Math.abs(
          calculatedMoles - resultMoles
        );

      if (difference < 0.00001) {

        response += `
✅ **Kiểm tra:** Kết quả Calculator chính xác.

Calculator đã tính:

**n = ${resultMoles.toFixed(6)} mol**
`;
      } else {

        response += `
⚠️ **Kiểm tra:** Kết quả Calculator có sự chênh lệch nhỏ.

Giá trị tính lại:

**n ≈ ${calculatedMoles.toFixed(6)} mol**
`;
      }
    }
  }


  // ═══════════════════════════════════════
  // TÍNH NỒNG ĐỘ MOL
  // ═══════════════════════════════════════

  if (
    volume !== null &&
    volume > 0 &&
    resultMoles !== null
  ) {

    const calculatedMolarity =
      resultMoles / volume;


    response += `
### 🧪 3. Tính nồng độ mol

Công thức:

**C = n / V**

Trong đó:

- **C**: nồng độ mol (mol/L)
- **n**: số mol
- **V**: thể tích dung dịch (L)

Thay số:

**C = ${resultMoles.toFixed(6)} / ${volume}**

→ **C ≈ ${calculatedMolarity.toFixed(6)} M**

`;


    if (molarity !== null) {

      response += `
✅ **Kết quả Calculator:** ${molarity.toFixed(6)} M
`;
    }
  }


  // ═══════════════════════════════════════
  // KẾT LUẬN
  // ═══════════════════════════════════════

  response += `
---

### 💡 4. Mẹo ghi nhớ

Khi gặp bài toán liên quan đến khối lượng và số mol:

**n = m / M**

Có thể nhớ theo tam giác:

        m
      ─────
      n × M

Suy ra:

- **n = m / M**
- **m = n × M**
- **M = m / n**

`;

  response += `
### 🎯 Tóm tắt

Calculator đã giúp bạn thực hiện phần tính toán.

AI Tutor giúp bạn hiểu:

**Dữ kiện → Công thức → Thay số → Kết quả → Kiểm tra**

Hãy chú ý đến **đơn vị** khi làm bài: khối lượng thường dùng g, khối lượng mol dùng g/mol và thể tích dung dịch dùng L.
`;


  return response;
}

function getLocalChatResponse(question) {
  window.lastMatchedChem = null;
  window.lastMatchedChemPair = null; // reset để nút thí nghiệm không dính sang câu hỏi sau
  if (question.includes("Tôi đang học Hóa học và vừa sử dụng Chemistry Calculator")) {
    return buildCalculatorTutorResponse(question);
  }
  const normalized = normalizeText(question);
  const mentioned = findMentionedChemicals(question);
  const isMixQuestion = normalized.includes("tron") || normalized.includes("ket hop") || normalized.includes("pha") || question.includes("+");
  const isFirstAidQuestion = [
    "so cuu", "do ra da", "dinh da", "vao mat", "hit phai", "nuot",
    "tiep xuc", "bi ban", "tran do", "do hoa chat", "hoa chat ban"
  ].some(phrase => normalized.includes(phrase));
  const isStorageQuestion = ["luu tru", "bao quan", "cat giu", "cach luu", "de hoa chat"].some(
    phrase => normalized.includes(phrase)
  );
  const pubChemQuery = extractPubChemQuery(question);
  const hasUnknownChemicalQuery = Boolean(pubChemQuery && mentioned.length === 0);

  if (normalized.includes("cam tron") || normalized.includes("khong duoc tron") || normalized.includes("tuyet doi khong")) {
    return buildCommonWarningsResponse();
  }

  if ((isMixQuestion || mentioned.length >= 2) && mentioned.length >= 2) {
    window.lastMatchedChemPair = [mentioned[0], mentioned[1]];
    return buildMixResponse(mentioned[0], mentioned[1]);
  }

  if (normalized.includes("msds") || normalized.includes("sds")) {
    return buildMsdsResponse(mentioned[0]);
  }

  if (isFirstAidQuestion) {
    return buildFirstAidResponse();
  }

  if (isStorageQuestion) {
    return buildStorageResponse(mentioned[0]);
  }

  if (mentioned.length > 0) {
    window.lastMatchedChem = mentioned[0];
    return buildChemicalInfoResponse(mentioned[0]);
  }

  return null;
}

function extractPubChemQuery(question) {
  const formulaText = question.replace(/[₀₁₂₃₄₅₆₇₈₉]/g, ch => SUBSCRIPT_DIGITS[ch] || ch);
  const formulaTokens = [...formulaText.matchAll(/(?:^|[^\p{L}\p{N}])((?:[A-Z][a-z]?\d*)+)(?=$|[^\p{L}\p{N}])/gu)]
    .map(match => match[1]);
  const formulaMatch = formulaTokens.find(isValidFormula);
  if (formulaMatch) return formulaMatch;

  return normalizeText(question)
    .replace(/\b(la gi|tim|tra cuu|cho toi biet|thong tin|hoa chat|chat|ve|cua|msds|sds|ppe|bao quan|luu tru|so cuu|nguy hiem|khong)\b/g, " ")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function looksLikeFormula(value) {
  return isValidFormula(value);
}

async function fetchPubChemJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`PubChem HTTP ${response.status}`);
  return response.json();
}

function getPubChemProperty(data) {
  return data?.PropertyTable?.Properties?.[0] || null;
}

async function fetchPubChemCompound(query) {
  const cleanQuery = query.trim();
  if (!cleanQuery) return null;

  const propertyUrl = `${PUBCHEM_PUG_BASE}/compound/name/${encodeURIComponent(cleanQuery)}/property/${PUBCHEM_PROPERTIES}/JSON`;

  try {
    const data = await fetchPubChemJson(propertyUrl);
    const compound = getPubChemProperty(data);
    if (compound) return compound;
  } catch (err) {
    // Formula search below covers inputs such as C6H6 when name lookup is ambiguous.
  }

  if (!looksLikeFormula(cleanQuery)) return null;

  const cidsUrl = `${PUBCHEM_PUG_BASE}/compound/fastformula/${encodeURIComponent(cleanQuery)}/cids/JSON`;
  const cidsData = await fetchPubChemJson(cidsUrl);
  const cid = cidsData?.IdentifierList?.CID?.[0];
  if (!cid) return null;

  const cidPropertyUrl = `${PUBCHEM_PUG_BASE}/compound/cid/${cid}/property/${PUBCHEM_PROPERTIES}/JSON`;
  const data = await fetchPubChemJson(cidPropertyUrl);
  return getPubChemProperty(data);
}

function buildPubChemResponse(compound, query) {
  const name = compound.Title || compound.IUPACName || query;
  const formula = compound.MolecularFormula || "Không rõ";
  const weight = compound.MolecularWeight ? `${compound.MolecularWeight} g/mol` : "Không rõ";
  const cidLine = compound.CID ? `\n\n**PubChem CID:** ${compound.CID}` : "";

  return `🔎 **${name}**\n\n**Công thức:** ${formula}\n\n**Khối lượng mol:** ${weight}\n\n**Tính chất vật lý:** PubChem chưa trả về đủ dữ liệu vật lý cho truy vấn này. Hãy kiểm tra SDS chính thức để biết trạng thái, màu sắc, nhiệt độ sôi/nóng chảy và độ tan.\n\n**Tính chất hóa học:** Chưa có mô tả phản ứng trong dữ liệu local. Cần đối chiếu SDS/GHS và tài liệu kỹ thuật trước khi sử dụng.\n\n**Cảnh báo nguy hiểm:** Chưa có hồ sơ an toàn local trong \`chemdata.js\`. Hãy kiểm tra SDS/GHS chính thức trước khi sử dụng.\n\n**PPE:** Kính bảo hộ, găng tay phù hợp hóa chất, áo blouse; thao tác trong tủ hút nếu chất bay hơi, có mùi mạnh hoặc chưa rõ độc tính.\n\n**Bảo quản:** Đóng kín, dán nhãn rõ ràng, để nơi khô mát và tách khỏi axit/bazơ/chất oxy hóa/dung môi dễ cháy theo SDS.\n\n**Sơ cứu:** Dính da/mắt rửa nước 15-20 phút; hít phải đưa ra nơi thoáng khí; nuốt phải không tự gây nôn và liên hệ y tế/chống độc.${cidLine}`;
}

async function getChatResponse(question) {
  window.lastMatchedChemPair = null;
  const localResponse = getLocalChatResponse(question);
  if (localResponse) return localResponse;

  const query = extractPubChemQuery(question);
  if (query) {
    try {
      const compound = await fetchPubChemCompound(query);
      if (compound) {
        window.lastMatchedChem = {
          formula: compound.MolecularFormula || query,
          name: compound.Title || compound.IUPACName || query,
          cid: compound.CID,
          key: compactFormula(compound.MolecularFormula || query)
        };
        return buildPubChemResponse(compound, query);
      }
    } catch (err) {
      console.error("PubChem lookup error:", err);
    }
  }

  if (getApiKey()) return callGeminiAI(question);

  if (!query) {
    return `Tôi chưa nhận ra tên hoặc công thức hóa chất trong câu hỏi.\n\nBạn có thể nhập kiểu: \`HCl\`, \`NaOH\`, \`H2SO4\`, \`benzene\`, \`acetone\`. Muốn hỏi đáp tự do, hãy cấu hình Gemini API Key.`;
  }

  return `Không tìm thấy **${query}** trong \`chemdata.js\` hoặc PubChem PUG REST.\n\nThử nhập tên tiếng Anh/IUPAC hoặc công thức chuẩn, ví dụ \`HCl\`, \`sodium hydroxide\`, \`C6H6\`; hoặc cấu hình Gemini API Key để hỏi đáp tự do.`;
}

function updateDataStatus() {
  const statusText = document.getElementById("api-status-text");
  const apiNote = document.getElementById("api-note");
  if (!statusText || !apiNote) return;

  const hasApiKey = typeof getApiKey === "function" && Boolean(getApiKey());
  statusText.textContent = hasApiKey
    ? "Gemini + Local + PubChem đang hoạt động"
    : "Local + PubChem đang hoạt động";
  apiNote.textContent = hasApiKey ? "Đã cấu hình Gemini API" : "Không cần API key";
}

// ── GIAO DIỆN & TÁC VỤ ──
function switchTab(tabId, btn) {
  document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
  document.querySelectorAll(".nav-item").forEach(b => b.classList.remove("active"));
  document.getElementById("tab-" + tabId).classList.add("active");
  btn.classList.add("active");
}

function autoResize(el) {
  el.style.height = "auto";
  el.style.height = Math.min(el.scrollHeight, 160) + "px";
}

function handleKey(e) {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
}

function showLoading(show) {
  const el = document.getElementById("loading");
  if (el) el.classList.toggle("visible", show);
}

// ── KIỂM TRA ĐƠN CHẤT (chỉ hợp chất mới có video / mô phỏng) ──
// Đơn chất: công thức chỉ gồm 1 nguyên tố, vd: Fe, Cu, Na, O2, H2, Cl2, S8
function isElementalSubstance(chem) {
  if (!chem) return false;
  const formula = String(chem.formula || "")
    .replace(/[₀₁₂₃₄₅₆₇₈₉]/g, ch => SUBSCRIPT_DIGITS[ch] || ch)
    .replace(/\s+/g, "");
  return /^[A-Z][a-z]?\d*$/.test(formula);
}

// ── CHAT & TẠO NÚT XEM VIDEO ──
function attachVideoButton(chem, bubbleElement) {
  if (!chem || !bubbleElement) return;
  if (isElementalSubstance(chem)) return; // đơn chất: không có video

  const chemKey = chem.key || compactFormula(chem.formula);
  const videoMap = typeof VIDEO_DATABASE !== "undefined" ? VIDEO_DATABASE : {};
  const videoUrl = videoMap[chemKey] || chem.videoUrl;

  if (bubbleElement.querySelector(".btn-video-chip") || !videoUrl) return;

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn-video-chip";
  btn.style.cssText = `
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin-top: 10px;
    margin-right: 8px;
    padding: 5px 12px;
    background: rgba(16, 163, 127, 0.1);
    border: 1px solid #10a37f;
    border-radius: 12px;
    color: #10a37f;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s ease;
  `;
  btn.innerHTML = `🎬 Xem video`;
  btn.onclick = () => openVideoModal(chem.name || chem.formula, videoUrl);

  bubbleElement.appendChild(btn);
}

function openVideoModal(title, videoUrl) {
  let modal = document.getElementById("chem-video-modal");

  if (!modal) {
    modal = document.createElement("div");
    modal.id = "chem-video-modal";
    modal.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      background: rgba(0, 0, 0, 0.75); display: flex; justify-content: center;
      align-items: center; z-index: 9999; opacity: 0; transition: opacity 0.2s ease;
    `;
    modal.innerHTML = `
      <div style="position: relative; width: 90%; max-width: 650px; background: #1e1e24; border-radius: 12px; padding: 16px; border: 1px solid #333;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
          <h3 id="video-modal-title" style="margin: 0; font-size: 16px; color: #fff;">Xem Video</h3>
          <span style="color: #aaa; font-size: 24px; cursor: pointer; line-height: 1;" onclick="closeVideoModal()">&times;</span>
        </div>
        <div id="video-modal-container" style="width: 100%; border-radius: 8px; overflow: hidden; background: #000;"></div>
      </div>
    `;
    modal.onclick = (e) => { if (e.target === modal) closeVideoModal(); };
    document.body.appendChild(modal);
  }

  const titleEl = modal.querySelector("#video-modal-title");
  const container = modal.querySelector("#video-modal-container");

  if (titleEl) titleEl.textContent = `Video: ${title}`;

  if (videoUrl.includes("youtube.com") || videoUrl.includes("youtu.be")) {
    const embedUrl = videoUrl.replace("watch?v=", "embed/");
    container.innerHTML = `<iframe src="${embedUrl}" width="100%" height="360" frameborder="0" allowfullscreen></iframe>`;
  } else {
    container.innerHTML = `
      <video controls autoplay style="width:100%; max-height:360px;">
        <source src="${videoUrl}" type="video/mp4">
        Trình duyệt không hỗ trợ phát video này.
      </video>`;
  }

  modal.style.display = "flex";
  setTimeout(() => { modal.style.opacity = "1"; }, 10);
}

function closeVideoModal() {
  const modal = document.getElementById("chem-video-modal");
  if (modal) {
    modal.style.opacity = "0";
    setTimeout(() => {
      modal.style.display = "none";
      const container = modal.querySelector("#video-modal-container");
      if (container) container.innerHTML = "";
    }, 200);
  }
}

// ── CHAT & TẠO NÚT XEM MÔ PHỎNG THÍ NGHIỆM ──
function attachExperimentButton(chemOrPair, bubbleElement) {
  if (!chemOrPair || !bubbleElement) return;

  const list = Array.isArray(chemOrPair) ? chemOrPair : [chemOrPair];
  const keyOf = c => c.key || compactFormula(c.formula);

  // Chỉ hợp chất mới có video/mô phỏng: bỏ hết đơn chất, nếu không còn hợp chất nào thì dừng
  const compounds = list.filter(c => c && !isElementalSubstance(c));
  if (compounds.length === 0) return;

  // Mỗi thí nghiệm gắn với hợp chất của nó; khớp theo từng khóa (không khớp chuỗi con)
  let matchedExp = null;
  for (const [dbKey, exp] of Object.entries(EXPERIMENT_DATABASE)) {
    const dbTokens = dbKey.split("|").sort();
    if (list.length >= 2) {
      // Cặp chất: phải trùng đúng cặp phản ứng (không phân biệt thứ tự)
      const pairTokens = list.map(keyOf).sort();
      if (dbTokens.join("|") === pairTokens.join("|")) { matchedExp = exp; break; }
    }
    // Chất đơn lẻ (kể cả hợp chất như CuSO₄): không có nút mô phỏng
  }

  if (bubbleElement.querySelector(".btn-exp-chip") || !matchedExp) return;

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn-exp-chip";
  btn.style.cssText = `
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin-top: 10px;
    margin-right: 8px;
    padding: 5px 12px;
    background: rgba(30, 111, 217, 0.1);
    border: 1px solid #1e6fd9;
    border-radius: 12px;
    color: #1e6fd9;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s ease;
  `;
  btn.innerHTML = `🧪 Xem video & tự làm thí nghiệm`;
  // Hỗ trợ cả kiểu cũ (chuỗi HTML) và kiểu mới ({ title, src })
  const expTitle = typeof matchedExp === "string"
    ? ((matchedExp.match(/<title>([^<]*)<\/title>/i) || [])[1] || "Mô phỏng thí nghiệm")
    : (matchedExp.title || "Mô phỏng thí nghiệm");
  btn.onclick = () => openExperimentModal(expTitle, matchedExp);

  bubbleElement.appendChild(btn);
}

function openExperimentModal(title, exp) {
  let modal = document.getElementById("chem-exp-modal");

  if (!modal) {
    modal = document.createElement("div");
    modal.id = "chem-exp-modal";
    modal.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      background: rgba(0, 0, 0, 0.75); display: flex; justify-content: center;
      align-items: center; z-index: 9999; opacity: 0; transition: opacity 0.2s ease;
    `;
    modal.innerHTML = `
      <div style="position: relative; width: 96%; max-width: 1180px; height: 92vh; background: #1e1e24; border-radius: 12px; padding: 16px; border: 1px solid #333; display: flex; flex-direction: column;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
          <h3 id="exp-modal-title" style="margin: 0; font-size: 16px; color: #fff;">Mô phỏng thí nghiệm</h3>
          <span style="color: #aaa; font-size: 24px; cursor: pointer; line-height: 1;" onclick="closeExperimentModal()">&times;</span>
        </div>
        <div id="exp-modal-container" style="flex: 1; width: 100%; border-radius: 8px; overflow: hidden; background: #fff;"></div>
      </div>
    `;
    modal.onclick = (e) => { if (e.target === modal) closeExperimentModal(); };
    document.body.appendChild(modal);
  }

  const titleEl = modal.querySelector("#exp-modal-title");
  const container = modal.querySelector("#exp-modal-container");

  if (titleEl) titleEl.textContent = title;

  const iframe = document.createElement("iframe");
  iframe.style.width = "100%";
  iframe.style.height = "100%";
  iframe.style.border = "none";
  container.innerHTML = "";
  container.appendChild(iframe);

  if (typeof exp === "string") {
    // Kiểu cũ: HTML nhúng thẳng trong app.js
    iframe.contentWindow.document.open();
    iframe.contentWindow.document.write(exp);
    iframe.contentWindow.document.close();
  } else {
    // Kiểu mới: nạp file riêng (dễ sửa, dễ debug bằng F12)
    iframe.src = exp.src;
  }

  modal.style.display = "flex";
  setTimeout(() => { modal.style.opacity = "1"; }, 10);
}

function closeExperimentModal() {
  const modal = document.getElementById("chem-exp-modal");
  if (modal) {
    modal.style.opacity = "0";
    setTimeout(() => {
      modal.style.display = "none";
      const container = modal.querySelector("#exp-modal-container");
      if (container) container.innerHTML = "";
    }, 200);
  }
}

function sendQuick(text) {
  document.getElementById("chat-input").value = text;
  sendMessage();
}

function clearChat() {
  conversationHistory = [];
  const msgs = document.getElementById("chat-messages");
  msgs.innerHTML = `
    <div class="msg bot">
      <div class="msg-avatar">AI</div>
      <div class="msg-content">
        <div class="msg-bubble">
          Cuộc trò chuyện đã được xóa. Tôi sẵn sàng hỗ trợ bạn!<br><br>
          Hãy đặt câu hỏi về hóa chất bất cứ lúc nào. 🔬
        </div>
        <div class="msg-time">Hệ thống</div>
      </div>
    </div>`;
}

function updateBotChatMessage(id, newHtml) {
  const msgDiv = document.getElementById(id);
  if (msgDiv) {
    const bubble = msgDiv.querySelector(".msg-bubble");
    if (bubble) bubble.innerHTML = newHtml;
    const chatMessages = document.getElementById("chat-messages");
    if (chatMessages) chatMessages.scrollTop = chatMessages.scrollHeight;
  }
}

async function sendMessage() {
  const input = document.getElementById("chat-input");
  const message = input.value.trim();
  if (!message || chatRequestPending) return;

  chatRequestPending = true;
  appendChatMessage(message, "user");
  input.value = "";
  autoResize(input);

  const sendButton = document.getElementById("send-btn");
  if (sendButton) sendButton.disabled = true;
  input.disabled = true;
  const botMsgId = appendChatMessage("Đang tra cứu dữ liệu...", "bot", true);

  try {
    conversationHistory.push({ role: "user", content: message });
    const reply = await getChatResponse(message);
    conversationHistory.push({ role: "assistant", content: reply });
    updateBotChatMessage(botMsgId, formatMessageText(reply));

    const bubble = document.getElementById(botMsgId)?.querySelector(".msg-bubble");
    if (window.lastMatchedChemPair) {
      attachExperimentButton(window.lastMatchedChemPair, bubble);
    } else if (window.lastMatchedChem) {
      if (typeof attachMol3DButton === "function") {
        attachMol3DButton(window.lastMatchedChem, bubble);
      }
      attachVideoButton(window.lastMatchedChem, bubble);
      attachExperimentButton(window.lastMatchedChem, bubble);
    }
  } catch (err) {
    console.error("Chat lookup error:", err);
    const errorMessage = err instanceof Error ? err.message : String(err);
    updateBotChatMessage(botMsgId, `⚠️ ${formatMessageText(`Không thể tra cứu lúc này: ${errorMessage}`)}`);
  } finally {
    chatRequestPending = false;
    if (sendButton) sendButton.disabled = false;
    input.disabled = false;
    input.focus();
  }
}

function escapeHtml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function formatMessageText(text) {
  return text
    .split(/(`[^`\n]+`)/g)
    .map(part => {
      if (/^`[^`\n]+`$/.test(part)) {
        return `<code>${escapeHtml(part.slice(1, -1))}</code>`;
      }

      return escapeHtml(part).replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
    })
    .join("")
    .replace(/\n/g, "<br>");
}

function appendChatMessage(text, sender, isLoading = false) {
  const chatMessages = document.getElementById("chat-messages");
  const msgDiv = document.createElement("div");
  const id = `msg-${Date.now()}-${++chatMessageSequence}`;
  msgDiv.className = `msg ${sender}`;
  msgDiv.id = id;

  msgDiv.innerHTML = `
    <div class="msg-avatar">${sender === "bot" ? "AI" : "Bạn"}</div>
    <div class="msg-content">
      <div class="msg-bubble">${isLoading ? "<em>AI đang suy nghĩ...</em>" : formatMessageText(text)}</div>
      <div class="msg-time">${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
    </div>
  `;

  chatMessages.appendChild(msgDiv);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return id;
}

function showTyping() {
  const msgs = document.getElementById("chat-messages");
  const id = "typing-" + Date.now();
  const div = document.createElement("div");
  div.className = "msg bot";
  div.id = id;
  div.innerHTML = `
    <div class="msg-avatar">AI</div>
    <div class="msg-content">
      <div class="msg-bubble">
        <div class="typing-indicator">
          <div class="typing-dot"></div>
          <div class="typing-dot"></div>
          <div class="typing-dot"></div>
        </div>
      </div>
    </div>`;
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
  return id;
}

function removeTyping(id) {
  const el = document.getElementById(id);
  if (el) el.remove();
}

// ── WARNING TAB ──
function getUniqueChemicalCatalog() {
  const unique = new Map();
  getChemicalCatalog().forEach(chem => {
    if (!unique.has(chem.key)) unique.set(chem.key, chem);
  });
  return [...unique.values()];
}

function getChemByKey(key) {
  return getUniqueChemicalCatalog().find(chem => chem.key === key);
}

function getChemLabel(key) {
  const chem = getChemByKey(key);
  return chem ? `${chem.formula} (${chem.name})` : key;
}

function getChemShortLabel(key) {
  return getChemByKey(key)?.formula || key;
}

function getMixGroupLabel(chem) {
  const text = normalizeText(`${chem.formula} ${chem.name} ${chem.properties} ${chem.msds}`);
  const formula = compactFormula(chem.formula);

  if (text.includes("khi ") || text.includes("gas") || ["cl2", "nh3", "h2s", "so2", "co", "co2", "o2", "h2", "n2"].includes(formula)) return "Khí";
  if (text.includes("axit") || text.includes("acid") || ["hcl", "h2so4", "hno3", "hf", "hbr", "hi", "hclo4"].includes(formula)) return "Axit";
  if (text.includes("kiem") || text.includes("hydroxide") || text.includes("amoniac")) return "Bazơ / kiềm";
  if (text.includes("oxy hoa") || text.includes("hypochlorite") || text.includes("nitrate") || text.includes("nitrite") || text.includes("perchloric")) return "Oxy hóa / nitrate";
  if (text.includes("dung moi") || text.includes("de chay") || text.includes("solvent") || text.includes("alcohol") || text.includes("ether")) return "Dung môi / hữu cơ";
  if (text.includes("kim loai") || ["mg", "zn", "al", "fe", "cu", "p", "s", "c"].includes(formula)) return "Kim loại / nguyên tố";
  if (text.includes("muoi") || text.includes("chloride") || text.includes("sulfate") || text.includes("carbonate") || text.includes("fluoride")) return "Muối vô cơ";
  return "Khác";
}

function renderMixOptions() {
  const selects = [document.getElementById("chem1"), document.getElementById("chem2")].filter(Boolean);
  if (!selects.length) return;

  const groupOrder = ["Axit", "Bazơ / kiềm", "Oxy hóa / nitrate", "Dung môi / hữu cơ", "Khí", "Muối vô cơ", "Kim loại / nguyên tố", "Khác"];
  const groups = Object.fromEntries(groupOrder.map(group => [group, []]));
  getUniqueChemicalCatalog().forEach(chem => {
    const group = getMixGroupLabel(chem);
    (groups[group] || groups["Khác"]).push(chem);
  });

  const optionsHtml = `<option value="">— Chọn hóa chất —</option>` + groupOrder
    .filter(group => groups[group].length)
    .map(group => {
      const options = groups[group]
        .sort((a, b) => a.formula.localeCompare(b.formula, "vi"))
        .map(chem => `<option value="${escapeHtml(chem.key)}">${escapeHtml(`${chem.formula} —${chem.name}`)}</option>`)
        .join("");
      return `<optgroup label="${escapeHtml(group)}">${options}</optgroup>`;
    })
    .join("");

  selects.forEach(select => {
    const selected = select.value;
    select.innerHTML = optionsHtml;
    if (selected) select.value = selected;
  });
}

function renderCommonWarnings() {
  const list = document.getElementById("common-warnings");
  if (!list) return;

  const priority = [
    "naclo|hcl", "naclo|nh3", "na2s|hcl", "nano2|hcl", "hclo4|ethanol",
    "h2|o2", "h2s|cl2", "hcl|naoh", "h2so4|naoh", "hno3|ethanol",
    "h2o2|acetone", "cl2|nh3", "h2so4|h2o2", "k2cr2o7|h2so4"
  ];
  const orderedKeys = [
    ...priority.filter(key => MIX_WARNINGS[key]),
    ...Object.keys(MIX_WARNINGS).filter(key => !priority.includes(key))
  ].slice(0, 16);

  list.innerHTML = orderedKeys.map(key => {
    const warning = MIX_WARNINGS[key];
    const [first, second] = key.split("|");
    const badgeClass = warning.level === "caution" ? "amber" : "red";
    const badgeText = warning.level === "caution" ? "THẬN TRỌNG" : "NGUY HIỂM";
    const pair = `${getChemShortLabel(first)} + ${getChemShortLabel(second)}`;
    const desc = warning.desc.split(".")[0];

    return `
      <div class="warn-item ${escapeHtml(warning.level)}" onclick="loadWarn('${first}','${second}')">
        <div class="warn-badge ${badgeClass}">${badgeText}</div>
        <div class="warn-info">
          <div class="warn-name">${escapeHtml(pair)}</div>
          <div class="warn-desc">${escapeHtml(desc)}</div>
        </div>
      </div>`;
  }).join("");
}

function loadWarn(c1, c2) {
  document.getElementById("chem1").value = c1;
  document.getElementById("chem2").value = c2;
  autoCheck();
}

function autoCheck() {
  const c1 = document.getElementById("chem1").value;
  const c2 = document.getElementById("chem2").value;
  if (!c1 || !c2) return;
  if (c1 === c2) {
    document.getElementById("mix-result").innerHTML = `
      <div class="result-card neutral">
        <div class="result-title">— Cùng một chất</div>
        Không có phản ứng đặc biệt khi trộn một chất với chính nó.
      </div>`;
    return;
  }
  const key = getMixKey(c1, c2);
  const resultEl = document.getElementById("mix-result");
  if (key) {
    const w = MIX_WARNINGS[key];
    const tags = w.tags.map(t => `<span class="rtag">${t}</span>`).join("");
    resultEl.innerHTML = `
      <div class="result-card ${w.level}">
        <div class="result-title">${w.title}</div>
        <div style="font-family:var(--font-mono);font-size:12px;color:var(--text-secondary);margin-bottom:8px">${w.reaction}</div>
        ${w.desc}
        <div class="result-tags">${tags}</div>
      </div>`;
  } else {
    resultEl.innerHTML = `
      <div class="result-card safe">
        <div class="result-title">✅ Không có cảnh báo đặc biệt</div>
        Tổ hợp này không nằm trong danh sách nguy hiểm đã biết. Tuy nhiên vẫn cần tuân thủ quy trình an toàn cơ bản. Nhấn "Phân tích bằng chatbot" để kiểm tra chi tiết hơn.
      </div>`;
  }
}

async function analyzeWithAI() {
  const chem1 = document.getElementById("chem1").value;
  const chem2 = document.getElementById("chem2").value;

  if (!chem1 || !chem2) {
    alert("Vui lòng chọn cả 2 hóa chất để phân tích!");
    return;
  }

  const prompt = `Phân tích chi tiết mức độ nguy hiểm, hiện tượng phản ứng và biện pháp an toàn khi trộn hai chất sau: ${chem1} và ${chem2}.`;

  // Chuyển sang tab Chatbot và gửi câu hỏi
  switchTab("chat", document.querySelector('[data-tab="chat"]'));
  document.getElementById("chat-input").value = prompt;
  sendMessage();
}

// ── QR CODE ──
let qrInstance = null;

function updateQRPreview() {
  const name = document.getElementById("qr-name").value || "Tên hóa chất";
  const formula = document.getElementById("qr-formula").value || "???";
  const danger = document.getElementById("qr-danger").value;
  const location = document.getElementById("qr-location").value || "Chưa xác định";
  const contact = document.getElementById("qr-contact").value || "Chưa có";

  document.getElementById("qr-preview-name").textContent = name;
  document.getElementById("qr-preview-formula").textContent = formula;
  document.getElementById("qr-prev-location").textContent = location;
  document.getElementById("qr-prev-contact").textContent = contact;
  document.getElementById("qr-prev-date").textContent = new Date().toLocaleDateString("vi-VN");

  const badge = document.getElementById("qr-preview-badge");
  const header = document.getElementById("qr-preview-header");
  const labels = {
    safe: "✅ AN TOÀN",
    caution: "⚡ THẬN TRỌNG",
    danger: "⚠️ NGUY HIỂM",
    extreme: "☠️ CỰC KỲ NGUY HIỂM"
  };
  badge.textContent = labels[danger];
  badge.className = "qr-badge " + danger;
  header.className = "qr-preview-header " + danger;

  const formulaEl = document.getElementById("qr-preview-formula");
  if (danger === "danger" || danger === "extreme") {
    formulaEl.style.color = "#ff4757";
  } else if (danger === "caution") {
    formulaEl.style.color = "#ffa502";
  } else {
    formulaEl.style.color = "#2ed573";
  }
}

function generateQR() {
  const name = document.getElementById("qr-name").value || "Hóa chất";
  const formula = document.getElementById("qr-formula").value || "N/A";
  const danger = document.getElementById("qr-danger").value;
  const location = document.getElementById("qr-location").value || "N/A";
  const contact = document.getElementById("qr-contact").value || "N/A";
  const date = new Date().toLocaleDateString("vi-VN");

  const qrContent = `CHEMSAFE AI\nHóa chất: ${name}\nCông thức: ${formula}\nMức độ: ${danger.toUpperCase()}\nVị trí: ${location}\nKhẩn cấp: ${contact}\nNgày: ${date}\nhttps://chemsafe.ai`;

  const canvas = document.getElementById("qr-canvas");
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, 200, 200);

  if (typeof QRCode !== "undefined" && typeof QRCode.toCanvas === "function") {
    try {
      const newCanvas = document.createElement("canvas");
      QRCode.toCanvas(newCanvas, qrContent, { width: 200, margin: 2, color: { dark: "#000000", light: "#ffffff" } }, function (err) {
        if (err) {
          drawFakeQR(ctx, formula, danger);
          return;
        }
        ctx.drawImage(newCanvas, 0, 0);
      });
    } catch (err) {
      drawFakeQR(ctx, formula, danger);
    }
  } else {
    drawFakeQR(ctx, formula, danger);
  }

  updateQRPreview();
  document.getElementById("download-btn").disabled = false;
}

function drawFakeQR(ctx, formula, danger) {
  const colors = { safe: "#2ed573", caution: "#ffa502", danger: "#ff4757", extreme: "#111111" };
  const c = colors[danger] || "#00d4a8";
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, 200, 200);

  const cells = [
    [1, 1, 7, 7], [3, 3, 3, 3], [11, 1, 7, 7], [13, 3, 3, 3], [1, 11, 7, 7], [3, 13, 3, 3],
    [10, 2, 1, 1], [10, 4, 1, 1], [10, 6, 1, 1], [12, 5, 1, 1], [14, 2, 1, 1], [14, 6, 1, 1],
    [2, 10, 1, 1], [4, 10, 1, 1], [6, 10, 1, 1], [5, 12, 1, 1], [2, 14, 1, 1], [6, 14, 1, 1],
    [10, 10, 2, 2], [13, 10, 1, 1], [10, 13, 1, 1], [12, 13, 2, 1], [10, 15, 3, 1], [14, 12, 1, 3],
  ];
  ctx.fillStyle = c;
  const size = 200 / 17;
  cells.forEach(([x, y, w, h]) => {
    ctx.fillRect(x * size, y * size, w * size - 1, h * size - 1);
  });

  ctx.fillStyle = "#333";
  ctx.font = "bold 14px 'Space Mono', monospace";
  ctx.textAlign = "center";
  ctx.fillText(formula, 100, 108);
}

function downloadQR() {
  const card = document.getElementById("qr-preview-card");

  if (typeof html2canvas !== "undefined") {
    html2canvas(card, {
      scale: 2,
      backgroundColor: "#ffffff",
      logging: false
    }).then(canvas => {
      const a = document.createElement("a");
      const formula = document.getElementById("qr-formula").value || "hoachat";
      a.download = `QR_${formula}_${new Date().toLocaleDateString("vi-VN").replace(/\//g, "-")}.png`;
      a.href = canvas.toDataURL("image/png");
      a.click();
    }).catch(err => {
      console.error("html2canvas error:", err);
      const canvas = document.getElementById("qr-canvas");
      const a = document.createElement("a");
      const formula = document.getElementById("qr-formula").value || "hoachat";
      a.download = `QR_${formula}.png`;
      a.href = canvas.toDataURL("image/png");
      a.click();
    });
  } else {
    const canvas = document.getElementById("qr-canvas");
    const a = document.createElement("a");
    const formula = document.getElementById("qr-formula").value || "hoachat";
    a.download = `QR_${formula}.png`;
    a.href = canvas.toDataURL("image/png");
    a.click();
  }
}

// ── CALC TAB ──
// =========================================
// CHEMICAL SEARCH - CALCULATOR
// =========================================

let selectedCalcChemicalIndex = 0;


function renderCalcOptions() {

  const searchInput =
    document.getElementById("calc-chemical-search");

  const hiddenInput =
    document.getElementById("calc-chem");

  if (!searchInput || !hiddenInput) return;

  selectedCalcChemicalIndex = 0;

  hiddenInput.value = 0;

  const firstChemical = CHEM_DATABASE[0];

  if (firstChemical) {
    searchInput.value =
      `${firstChemical.formula} - ${firstChemical.name}`;
  }

  renderCalcChemicalResults("");

  updateCalc();
}


function getSelectedCalcChemical() {

  const index = Number(
    document.getElementById("calc-chem")?.value || 0
  );

  return (
    CHEM_DATABASE[index] ||
    CHEM_DATABASE[0]
  );
}


// =========================================
// TÌM KIẾM HÓA CHẤT
// =========================================

function searchCalcChemical(keyword) {

  const results =
    document.getElementById(
      "calc-chemical-results"
    );

  if (!results) return;

  renderCalcChemicalResults(keyword);

  results.classList.add("show");
}


function showCalcChemicalResults() {

  const keyword =
    document.getElementById(
      "calc-chemical-search"
    )?.value || "";

  const results =
    document.getElementById(
      "calc-chemical-results"
    );

  if (!results) return;

  renderCalcChemicalResults(keyword);

  results.classList.add("show");
}


// =========================================
// HIỂN THỊ KẾT QUẢ TÌM KIẾM
// =========================================

function renderCalcChemicalResults(keyword = "") {

  const results =
    document.getElementById(
      "calc-chemical-results"
    );

  if (!results) return;

  const search =
    normalizeText(keyword.trim());

  let chemicals = CHEM_DATABASE;

  if (search) {

    chemicals = CHEM_DATABASE.filter(chem => {

      const formula =
        normalizeText(chem.formula || "");

      const name =
        normalizeText(chem.name || "");

      return (
        formula.includes(search) ||
        name.includes(search)
      );

    });

  }

  // Giới hạn số kết quả hiển thị
  chemicals = chemicals.slice(0, 20);


  if (!chemicals.length) {

    results.innerHTML = `
      <div class="chemical-no-result">
        Không tìm thấy hóa chất
      </div>
    `;

    return;
  }


  results.innerHTML =
    chemicals.map(chem => {

      const index =
        CHEM_DATABASE.indexOf(chem);

      const molarMass =
        chem.molarMass ||
        Number.parseFloat(chem.molar);


      return `
        <button
          type="button"
          class="chemical-search-item"
          onclick="selectCalcChemical(${index})"
        >

          <div class="chemical-result-main">

            <span class="chemical-result-formula">
              ${escapeHtml(chem.formula || "--")}
            </span>

            <span class="chemical-result-name">
              ${escapeHtml(chem.name || "Không có tên")}
            </span>

          </div>

          <span class="chemical-result-molar">
            M = ${formatCalcNumber(molarMass, "g/mol")}
          </span>

        </button>
      `;

    }).join("");
}


// =========================================
// CHỌN HÓA CHẤT
// =========================================

function selectCalcChemical(index) {

  const chem =
    CHEM_DATABASE[index];

  if (!chem) return;


  selectedCalcChemicalIndex =
    index;


  // Lưu index
  const hiddenInput =
    document.getElementById("calc-chem");

  if (hiddenInput) {
    hiddenInput.value = index;
  }


  // Hiển thị tên trong ô tìm kiếm
  const searchInput =
    document.getElementById(
      "calc-chemical-search"
    );

  if (searchInput) {

    searchInput.value =
      `${chem.formula} - ${chem.name}`;

  }


  // Đóng danh sách
  const results =
    document.getElementById(
      "calc-chemical-results"
    );

  if (results) {
    results.classList.remove("show");
  }


  // Cập nhật Calculator
  updateCalc();
}

function getSelectedCalcChemical() {
  const select = document.getElementById("calc-chem");
  const index = Number(select?.value || 0);
  return CHEM_DATABASE[index] || CHEM_DATABASE[0];
}

function readCalcNumber(id) {
  const raw = document.getElementById(id)?.value;
  if (raw === undefined || raw === null || String(raw).trim() === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function formatCalcNumber(value, unit) {
  if (!Number.isFinite(value)) return "--";
  const formatted = value === 0
    ? "0"
    : value.toLocaleString("vi-VN", { maximumSignificantDigits: 6 });
  return unit ? `${formatted} ${unit}` : formatted;
}

function setCalcText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

// =========================================
// CALCULATOR UNIT CONVERSION
// =========================================

function convertMassToGram(value, unit) {

  if (value === null) return null;

  switch (unit) {

    case "mg":
      return value / 1000;

    case "kg":
      return value * 1000;

    case "g":
    default:
      return value;

  }
}


function convertVolumeToLiter(value, unit) {

  if (value === null) return null;

  switch (unit) {

    case "mL":
      return value / 1000;

    case "L":
    default:
      return value;

  }
}

function updateCalc() {
  const chem = getSelectedCalcChemical();
  if (!chem) return;

  const molarMass = chem.molarMass || Number.parseFloat(chem.molar);
  setCalcText("calc-formula", chem.formula);
  setCalcText("calc-name", chem.name);
  setCalcText("calc-molar-mass", formatCalcNumber(molarMass, "g/mol"));
  setCalcText("calc-danger", chem.dangerLabel);
  setCalcText("calc-ph", chem.ph);

  const massInput = readCalcNumber("calc-mass-g");
  const massUnit =
    document.getElementById("calc-mass-unit")?.value || "g";

  const moles = readCalcNumber("calc-moles");

  const volumeInput = readCalcNumber("calc-volume-l");
  const volumeUnit =
    document.getElementById("calc-volume-unit")?.value || "L";


  // Quy đổi về đơn vị chuẩn
  // Khối lượng → g
  // Thể tích → L

  const mass = convertMassToGram(
    massInput,
    massUnit
  );

  const volume = convertVolumeToLiter(
    volumeInput,
    volumeUnit
  );


  // Tính toán

  const molesFromMass =
    mass !== null && molarMass > 0
      ? mass / molarMass
      : NaN;

  const massFromMoles =
    moles !== null
      ? moles * molarMass
      : NaN;

  const baseMoles =
    moles !== null
      ? moles
      : molesFromMass;

  const molarity =
    Number.isFinite(baseMoles) &&
      volume !== null &&
      volume > 0
      ? baseMoles / volume
      : NaN;

  setCalcText("calc-result-moles", formatCalcNumber(molesFromMass, "mol"));
  setCalcText("calc-result-mass", formatCalcNumber(massFromMoles, "g"));
  setCalcText("calc-result-molarity", formatCalcNumber(molarity, "M"));

  const targetM =
    readCalcNumber("calc-target-m");

  const targetVolumeInput =
    readCalcNumber("calc-target-volume-l");

  const targetVolumeUnit =
    document.getElementById(
      "calc-target-volume-unit"
    )?.value || "L";

  const targetVolume =
    convertVolumeToLiter(
      targetVolumeInput,
      targetVolumeUnit
    );
  const targetMoles = targetM && targetVolume ? targetM * targetVolume : NaN;
  const gramsNeeded = Number.isFinite(targetMoles) ? targetMoles * molarMass : NaN;

  setCalcText("calc-result-target-moles", formatCalcNumber(targetMoles, "mol"));
  setCalcText("calc-result-grams-needed", formatCalcNumber(gramsNeeded, "g"));

  const stockM =
    readCalcNumber("calc-stock-m");

  const finalM =
    readCalcNumber("calc-final-m");

  const finalVolumeInput =
    readCalcNumber("calc-final-volume-l");

  const finalVolumeUnit =
    document.getElementById(
      "calc-final-volume-unit"
    )?.value || "L";

  const finalVolume =
    convertVolumeToLiter(
      finalVolumeInput,
      finalVolumeUnit
    );
  const stockVolume = stockM && finalM && finalVolume ? (finalM * finalVolume) / stockM : NaN;
  const solventVolume = Number.isFinite(stockVolume) && finalVolume !== null
    ? Math.max(finalVolume - stockVolume, 0)
    : NaN;

  setCalcText("calc-result-stock-volume", formatCalcNumber(stockVolume, "L"));
  setCalcText("calc-result-solvent", formatCalcNumber(solventVolume, "L"));
}

// ── DATABASE TAB ──
function renderDB(data) {
  const grid = document.getElementById("db-grid");
  const dangerColors = {
    danger: { color: "#ff4757", bg: "rgba(255,71,87,0.1)", border: "rgba(255,71,87,0.3)" },
    caution: { color: "#ffa502", bg: "rgba(255,165,2,0.1)", border: "rgba(255,165,2,0.3)" },
    safe: { color: "#2ed573", bg: "rgba(46,213,115,0.1)", border: "rgba(46,213,115,0.3)" }
  };

  grid.innerHTML = data.map(chem => {
    const dc = dangerColors[chem.danger] || dangerColors.safe;
    return `
      <div class="db-card" onclick="askAbout('${chem.formula}', '${chem.name}')">
        <div class="db-card-formula" style="color:${dc.color}">${chem.formula}</div>
        <div class="db-card-name">${chem.name}</div>
        <div class="db-card-props">
          <div class="db-prop-row"><span>Khối lượng phân tử</span><span class="db-prop-val">${chem.molar}</span></div>
          <div class="db-prop-row"><span>Điểm sôi</span><span class="db-prop-val">${chem.boiling}</span></div>
          <div class="db-prop-row"><span>pH (dd)</span><span class="db-prop-val">${chem.ph}</span></div>
        </div>
        <span class="db-danger-badge" style="background:${dc.bg};color:${dc.color};border:1px solid ${dc.border}">
          ${chem.dangerLabel}
        </span>
        <div style="margin-top:8px;font-size:11px;color:var(--text-dim)">Nhấn để hỏi AI →</div>
        <button class="mol3d-db-btn" type="button" onclick="event.stopPropagation(); openMol3DByFormula('${chem.formula.replace(/'/g, "\\'")}')">🧬 Xem 3D</button>
      </div>`;
  }).join("");
}

function filterDB(query) {
  const q = normalizeText(query);
  const compact = compactFormula(query);
  const filtered = CHEM_DATABASE.filter(c => {
    const searchableText = normalizeText([
      c.formula,
      c.name,
      c.properties,
      c.msds,
      ...(c.aliases || [])
    ].join(" "));
    const searchableFormula = compactFormula(c.formula);

    return searchableText.includes(q) ||
      (compact && searchableFormula.includes(compact));
  });
  renderDB(filtered);
}

function askAbout(formula, name) {
  const chatBtn = document.querySelector('[data-tab="chat"]');
  switchTab("chat", chatBtn);
  document.getElementById("chat-input").value = `Cho tôi biết thông tin đầy đủ về ${formula} (${name}): tính chất, mức độ nguy hiểm và PPE cần thiết.`;
  sendMessage();
}

// ── KHỞI TẠO ──
document.addEventListener("DOMContentLoaded", () => {
  renderMixOptions();
  renderCommonWarnings();
  renderDB(CHEM_DATABASE);
  renderCalcOptions();
  updateDataStatus();
  document.getElementById("qr-prev-date").textContent = new Date().toLocaleDateString("vi-VN");

  setTimeout(() => {
    appendChatMessage(getStartupNotice(), "bot");
  }, 500);
});

// ═══════════════════════════════════════
// STEP-BY-STEP CHEMISTRY SOLUTIONS
// ═══════════════════════════════════════

function showSolution(id, html) {
  const box = document.getElementById(id);

  if (!box) {
    console.error("Không tìm thấy solution box:", id);
    return;
  }

  box.innerHTML = html;
  box.classList.add("show");
}


// ═══════════════════════════════════════
// MOL / MASS / MOLARITY
// ═══════════════════════════════════════

function showMoleSolution() {

  console.log("showMoleSolution() đã được gọi");

  const chem = getSelectedCalcChemical();

  if (!chem) {
    alert("Vui lòng chọn hóa chất.");
    return;
  }

  const molarMass =
    chem.molarMass ||
    Number.parseFloat(chem.molar);

  const mass = readCalcNumber("calc-mass-g");
  const moles = readCalcNumber("calc-moles");
  const volume = readCalcNumber("calc-volume-l");

  let html = `
        <div class="solution-header">
            📘 LỜI GIẢI TỪNG BƯỚC
        </div>
    `;


  if (
    mass === null &&
    moles === null &&
    volume === null
  ) {

    html += `
            <div class="solution-empty">
                ⚠️ Vui lòng nhập dữ liệu trước khi xem lời giải.
            </div>
        `;

    showSolution("mole-solution", html);
    return;
  }


  // KHỐI LƯỢNG → MOL
  if (mass !== null) {

    const calculatedMoles =
      mass / molarMass;

    html += `
            <div class="solution-step">

                <div class="solution-step-title">
                    Bước 1 — Dữ kiện
                </div>

                <div>
                    Hóa chất:
                    <strong>${chem.formula}</strong>
                </div>

                <div>
                    Khối lượng:
                    <strong>${mass} g</strong>
                </div>

                <div>
                    Khối lượng mol:
                    <strong>${molarMass.toFixed(4)} g/mol</strong>
                </div>

            </div>


            <div class="solution-step">

                <div class="solution-step-title">
                    Bước 2 — Công thức
                </div>

                <div class="solution-formula">
                    n = m / M
                </div>

            </div>


            <div class="solution-step">

                <div class="solution-step-title">
                    Bước 3 — Thay số
                </div>

                <div class="solution-formula">
                    n = ${mass} / ${molarMass.toFixed(4)}
                </div>

            </div>


            <div class="solution-step">

                <div class="solution-step-title">
                    Bước 4 — Kết quả
                </div>

                <div class="solution-answer">
                    n = ${calculatedMoles.toFixed(6)} mol
                </div>

            </div>
        `;
  }


  // MOL → KHỐI LƯỢNG
  if (moles !== null) {

    const calculatedMass =
      moles * molarMass;

    html += `
            <div class="solution-step">

                <div class="solution-step-title">
                    Tính khối lượng
                </div>

                <div class="solution-formula">
                    m = n × M
                </div>

                <br>

                <div class="solution-formula">
                    m = ${moles} × ${molarMass.toFixed(4)}
                </div>

                <div class="solution-answer">
                    m = ${calculatedMass.toFixed(6)} g
                </div>

            </div>
        `;
  }


  // MOLARITY
  if (
    volume !== null &&
    volume > 0
  ) {

    const baseMoles =
      moles !== null
        ? moles
        : mass !== null
          ? mass / molarMass
          : null;


    if (baseMoles !== null) {

      const molarity =
        baseMoles / volume;

      html += `
                <div class="solution-step">

                    <div class="solution-step-title">
                        Tính nồng độ mol
                    </div>

                    <div class="solution-formula">
                        C = n / V
                    </div>

                    <br>

                    <div class="solution-formula">
                        C =
                        ${baseMoles.toFixed(6)}
                        /
                        ${volume}
                    </div>

                    <div class="solution-answer">
                        C = ${molarity.toFixed(6)} M
                    </div>

                </div>
            `;
    }
  }


  showSolution(
    "mole-solution",
    html
  );
}


// ═══════════════════════════════════════
// PHA DUNG DỊCH
// ═══════════════════════════════════════

function showPreparationSolution() {

  const chem =
    getSelectedCalcChemical();

  if (!chem) {
    alert("Vui lòng chọn hóa chất.");
    return;
  }

  const molarMass =
    chem.molarMass ||
    Number.parseFloat(chem.molar);

  const targetM =
    readCalcNumber("calc-target-m");

  const targetVolume =
    readCalcNumber("calc-target-volume-l");


  let html = `
        <div class="solution-header">
            📘 LỜI GIẢI PHA DUNG DỊCH
        </div>
    `;


  if (
    targetM === null ||
    targetVolume === null ||
    targetM <= 0 ||
    targetVolume <= 0
  ) {

    html += `
            <div class="solution-empty">
                ⚠️ Vui lòng nhập nồng độ và thể tích cần pha.
            </div>
        `;

    showSolution(
      "preparation-solution",
      html
    );

    return;
  }


  const targetMoles =
    targetM * targetVolume;

  const gramsNeeded =
    targetMoles * molarMass;


  html += `

        <div class="solution-step">

            <div class="solution-step-title">
                Bước 1 — Dữ kiện
            </div>

            <div>
                Hóa chất:
                <strong>${chem.formula}</strong>
            </div>

            <div>
                Nồng độ:
                <strong>${targetM} M</strong>
            </div>

            <div>
                Thể tích:
                <strong>${targetVolume} L</strong>
            </div>

            <div>
                Khối lượng mol:
                <strong>${molarMass.toFixed(4)} g/mol</strong>
            </div>

        </div>


        <div class="solution-step">

            <div class="solution-step-title">
                Bước 2 — Tính số mol
            </div>

            <div class="solution-formula">
                n = C × V
            </div>

            <br>

            <div class="solution-formula">
                n = ${targetM} × ${targetVolume}
            </div>

            <div class="solution-answer">
                n = ${targetMoles.toFixed(6)} mol
            </div>

        </div>


        <div class="solution-step">

            <div class="solution-step-title">
                Bước 3 — Tính khối lượng
            </div>

            <div class="solution-formula">
                m = n × M
            </div>

            <br>

            <div class="solution-formula">
                m =
                ${targetMoles.toFixed(6)}
                ×
                ${molarMass.toFixed(4)}
            </div>

            <div class="solution-answer">
                m = ${gramsNeeded.toFixed(6)} g
            </div>

        </div>


        <div class="solution-step">

            <div class="solution-step-title">
                Bước 4 — Kết luận
            </div>

            <div class="solution-answer">
                Cần cân
                ${gramsNeeded.toFixed(4)} g
                ${chem.formula}
                để pha
                ${targetVolume} L
                dung dịch
                ${targetM} M.
            </div>

        </div>

    `;


  showSolution(
    "preparation-solution",
    html
  );
}


// ═══════════════════════════════════════
// PHA LOÃNG
// ═══════════════════════════════════════

function showDilutionSolution() {

  const stockM =
    readCalcNumber("calc-stock-m");

  const finalM =
    readCalcNumber("calc-final-m");

  const finalVolume =
    readCalcNumber("calc-final-volume-l");


  let html = `
        <div class="solution-header">
            📘 LỜI GIẢI PHA LOÃNG
        </div>
    `;


  if (
    stockM === null ||
    finalM === null ||
    finalVolume === null ||
    stockM <= 0 ||
    finalM <= 0 ||
    finalVolume <= 0
  ) {

    html += `
            <div class="solution-empty">
                ⚠️ Vui lòng nhập đầy đủ C₁, C₂ và V₂.
            </div>
        `;

    showSolution(
      "dilution-solution",
      html
    );

    return;
  }


  const stockVolume =
    (finalM * finalVolume) /
    stockM;

  const solventVolume =
    Math.max(
      finalVolume - stockVolume,
      0
    );


  html += `

        <div class="solution-step">

            <div class="solution-step-title">
                Bước 1 — Dữ kiện
            </div>

            <div>
                C₁ =
                <strong>${stockM} M</strong>
            </div>

            <div>
                C₂ =
                <strong>${finalM} M</strong>
            </div>

            <div>
                V₂ =
                <strong>${finalVolume} L</strong>
            </div>

        </div>


        <div class="solution-step">

            <div class="solution-step-title">
                Bước 2 — Công thức
            </div>

            <div class="solution-formula">
                C₁V₁ = C₂V₂
            </div>

        </div>


        <div class="solution-step">

            <div class="solution-step-title">
                Bước 3 — Tính V₁
            </div>

            <div class="solution-formula">
                V₁ = (C₂ × V₂) / C₁
            </div>

            <br>

            <div class="solution-formula">
                V₁ =
                (${finalM} × ${finalVolume})
                /
                ${stockM}
            </div>

            <div class="solution-answer">
                V₁ = ${stockVolume.toFixed(6)} L
            </div>

        </div>


        <div class="solution-step">

            <div class="solution-step-title">
                Bước 4 — Lượng dung môi
            </div>

            <div class="solution-formula">
                Vdung môi = V₂ − V₁
            </div>

            <br>

            <div class="solution-formula">
                ${finalVolume}
                −
                ${stockVolume.toFixed(6)}
            </div>

            <div class="solution-answer">
                Dung môi ≈
                ${solventVolume.toFixed(6)} L
            </div>

        </div>

    `;


  showSolution(
    "dilution-solution",
    html
  );
}


// ═══════════════════════════════════════
// MAKE FUNCTIONS AVAILABLE TO HTML
// ═══════════════════════════════════════

window.showMoleSolution = showMoleSolution;
window.showPreparationSolution = showPreparationSolution;
window.showDilutionSolution = showDilutionSolution;

// ═══════════════════════════════════════
// CALCULATOR → AI
// ═══════════════════════════════════════


// ───────────────────────────────────────
// Lấy thông tin hóa chất hiện tại
// ───────────────────────────────────────

function getCalculatorChemicalContext() {

  const chem = getSelectedCalcChemical();

  if (!chem) {
    return null;
  }

  const molarMass =
    chem.molarMass ||
    Number.parseFloat(chem.molar);

  return {
    name: chem.name || chem.formula,
    formula: chem.formula || "",
    molarMass: molarMass
  };
}


// ───────────────────────────────────────
// MOL / MASS / MOLARITY → AI
// ───────────────────────────────────────

function askAIAboutMoleProblem() {

  const chem =
    getCalculatorChemicalContext();

  if (!chem) {
    alert("Vui lòng chọn hóa chất trước.");
    return;
  }


  const mass =
    readCalcNumber("calc-mass-g");

  const moles =
    readCalcNumber("calc-moles");

  const volume =
    readCalcNumber("calc-volume-l");


  if (
    mass === null &&
    moles === null &&
    volume === null
  ) {
    alert("Vui lòng nhập dữ liệu Calculator trước.");
    return;
  }


  const calculatedMoles =
    mass !== null
      ? mass / chem.molarMass
      : moles;


  let calculatedMolarity = null;

  if (
    volume !== null &&
    volume > 0 &&
    calculatedMoles !== null
  ) {
    calculatedMolarity =
      calculatedMoles / volume;
  }


  const prompt = `
Tôi đang học Hóa học và vừa sử dụng Chemistry Calculator.

Hóa chất:
- Tên: ${chem.name}
- Công thức: ${chem.formula}
- Khối lượng mol: ${chem.molarMass.toFixed(4)} g/mol

Dữ kiện:
- Khối lượng: ${mass !== null ? mass + " g" : "Không nhập"}
- Số mol: ${moles !== null ? moles + " mol" : "Không nhập"}
- Thể tích dung dịch: ${volume !== null ? volume + " L" : "Không nhập"}

Kết quả Calculator:
- Số mol: ${calculatedMoles !== null
      ? calculatedMoles.toFixed(6) + " mol"
      : "Không tính được"
    }

- Nồng độ mol: ${calculatedMolarity !== null
      ? calculatedMolarity.toFixed(6) + " M"
      : "Không tính được"
    }

Hãy giải thích bài toán này cho một học sinh.

Yêu cầu:
1. Giải thích dữ kiện.
2. Giải thích công thức được sử dụng.
3. Giải thích tại sao dùng công thức đó.
4. Kiểm tra kết quả Calculator.
5. Nếu có lỗi, chỉ ra lỗi.
6. Đưa ra một mẹo để nhớ công thức.

Không cần giải thích quá dài.
Hãy dùng tiếng Việt dễ hiểu.
    `;


  sendQuick(prompt);
}


// ───────────────────────────────────────
// PHA DUNG DỊCH → AI
// ───────────────────────────────────────

function askAIAboutPreparation() {

  const chem =
    getCalculatorChemicalContext();

  if (!chem) {
    alert("Vui lòng chọn hóa chất trước.");
    return;
  }


  const targetM =
    readCalcNumber("calc-target-m");

  const targetVolume =
    readCalcNumber(
      "calc-target-volume-l"
    );


  if (
    targetM === null ||
    targetVolume === null
  ) {
    alert("Vui lòng nhập đầy đủ dữ liệu.");
    return;
  }


  const targetMoles =
    targetM * targetVolume;


  const gramsNeeded =
    targetMoles * chem.molarMass;


  const prompt = `
Tôi đang học Hóa học.

Tôi cần pha dung dịch:

Hóa chất:
${chem.name}
Công thức:
${chem.formula}

Khối lượng mol:
${chem.molarMass.toFixed(4)} g/mol

Nồng độ cần pha:
${targetM} M

Thể tích cần pha:
${targetVolume} L

Calculator tính được:

Số mol:
${targetMoles.toFixed(6)} mol

Khối lượng hóa chất:
${gramsNeeded.toFixed(6)} g

Hãy giải thích cho học sinh:

1. Tại sao phải tính số mol trước?
2. Công thức n = C × V có ý nghĩa gì?
3. Tại sao m = n × M?
4. Kiểm tra kết quả.
5. Giải thích ngắn gọn quy trình pha dung dịch.

Dùng tiếng Việt dễ hiểu.
    `;


  sendQuick(prompt);
}


// ───────────────────────────────────────
// PHA LOÃNG → AI
// ───────────────────────────────────────

function askAIAboutDilution() {

  const stockM =
    readCalcNumber("calc-stock-m");

  const finalM =
    readCalcNumber("calc-final-m");

  const finalVolume =
    readCalcNumber(
      "calc-final-volume-l"
    );


  if (
    stockM === null ||
    finalM === null ||
    finalVolume === null
  ) {
    alert("Vui lòng nhập đầy đủ dữ liệu.");
    return;
  }


  const stockVolume =
    (finalM * finalVolume) /
    stockM;


  const solventVolume =
    Math.max(
      finalVolume - stockVolume,
      0
    );


  const prompt = `
Tôi đang học Hóa học.

Tôi đang giải bài toán pha loãng.

Dữ kiện:

C₁ = ${stockM} M

C₂ = ${finalM} M

V₂ = ${finalVolume} L

Calculator đã tính:

Công thức:
C₁V₁ = C₂V₂

V₁ =
${stockVolume.toFixed(6)} L

Lượng dung môi cần thêm ≈
${solventVolume.toFixed(6)} L

Hãy:

1. Giải thích công thức C₁V₁ = C₂V₂.
2. Giải thích tại sao có thể sử dụng công thức này.
3. Kiểm tra kết quả.
4. Giải thích cách thực hiện pha loãng ngoài thực tế.
5. Nêu một lỗi học sinh thường mắc khi làm dạng bài này.

Dùng tiếng Việt dễ hiểu.
    `;


  sendQuick(prompt);
}
// Bấm ra ngoài ô tìm hóa chất thì đóng danh sách gợi ý
document.addEventListener("click", e => {
  if (!e.target.closest(".chemical-search-wrap")) {
    document.getElementById("calc-chemical-results")?.classList.remove("show");
  }
});