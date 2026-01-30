(() => {
  const clamp = (val, min, max) => Math.min(Math.max(val, min), max);
  const toNumber = (value) => {
    const num = parseFloat(value);
    return Number.isFinite(num) ? num : 0;
  };

  const normalizeHex = (value) => {
    if (!value) return "";
    let hex = value.trim().toLowerCase();
    if (!hex.startsWith("#")) hex = `#${hex}`;
    if (hex.length === 4) {
      hex = `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`;
    }
    return hex;
  };

  const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  const copyToClipboard = async (text) => {
    if (!text) return false;
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(textarea);
      return ok;
    }
  };

  const downloadBlob = (blob, filename) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const initSvgOptimizer = (root) => {
    const input = root.querySelector("[data-svg-input]");
    const output = root.querySelector("[data-svg-output]");
    const status = root.querySelector("[data-svg-status]");
    const runBtn = root.querySelector("[data-svg-optimize]");
    const copyBtn = root.querySelector("[data-svg-copy]");
    const downloadBtn = root.querySelector("[data-svg-download]");
    const stripMeta = root.querySelector("[data-svg-strip-metadata]");
    if (!input || !output || !runBtn) return;

    const setStatus = (text) => { if (status) status.textContent = text; };

    runBtn.addEventListener("click", () => {
      const raw = input.value || "";
      if (!raw.trim()) {
        setStatus("Paste SVG to optimize.");
        return;
      }
      let optimized = raw.replace(/<!--[\s\S]*?-->/g, "");
      if (stripMeta && stripMeta.checked) {
        optimized = optimized.replace(/<metadata[\s\S]*?<\/metadata>/gi, "");
        optimized = optimized.replace(/<desc[\s\S]*?<\/desc>/gi, "");
        optimized = optimized.replace(/<title[\s\S]*?<\/title>/gi, "");
      }
      optimized = optimized.replace(/>\s+</g, "><").replace(/\s{2,}/g, " ").trim();
      output.value = optimized;
      setStatus("Optimized.");
    });

    copyBtn?.addEventListener("click", async () => {
      const ok = await copyToClipboard(output.value);
      setStatus(ok ? "Copied." : "Copy failed.");
    });

    downloadBtn?.addEventListener("click", () => {
      if (!output.value.trim()) {
        setStatus("Nothing to download.");
        return;
      }
      downloadBlob(new Blob([output.value], { type: "image/svg+xml" }), "optimized.svg");
      setStatus("Download ready.");
    });
  };

  const syncColorInputs = (colorInput, textInput) => {
    if (!colorInput || !textInput) return;
    const setBoth = (value) => {
      const normalized = normalizeHex(value);
      colorInput.value = normalized || colorInput.value;
      textInput.value = normalized || textInput.value;
    };
    colorInput.addEventListener("input", (event) => setBoth(event.target.value));
    textInput.addEventListener("input", (event) => setBoth(event.target.value));
  };

  const initSvgColorSwapper = (root) => {
    const input = root.querySelector("[data-swap-input]");
    const output = root.querySelector("[data-swap-output]");
    const status = root.querySelector("[data-swap-status]");
    const runBtn = root.querySelector("[data-swap-run]");
    const copyBtn = root.querySelector("[data-swap-copy]");
    const downloadBtn = root.querySelector("[data-swap-download]");
    const fromColor = root.querySelector("[data-color-from]");
    const toColor = root.querySelector("[data-color-to]");
    const fromText = root.querySelector("[data-color-from-text]");
    const toText = root.querySelector("[data-color-to-text]");
    const caseToggle = root.querySelector("[data-swap-case]");
    if (!input || !output || !runBtn) return;

    const setStatus = (text) => { if (status) status.textContent = text; };
    syncColorInputs(fromColor, fromText);
    syncColorInputs(toColor, toText);

    runBtn.addEventListener("click", () => {
      const raw = input.value || "";
      const from = normalizeHex(fromText?.value || fromColor?.value || "");
      const to = normalizeHex(toText?.value || toColor?.value || "");
      if (!raw.trim()) {
        setStatus("Paste SVG to swap colors.");
        return;
      }
      if (!from || !to) {
        setStatus("Select both colors.");
        return;
      }
      const flags = caseToggle?.checked ? "gi" : "g";
      const matcher = new RegExp(escapeRegExp(from), flags);
      const swapped = raw.replace(matcher, to);
      output.value = swapped;
      setStatus("Colors swapped.");
    });

    copyBtn?.addEventListener("click", async () => {
      const ok = await copyToClipboard(output.value);
      setStatus(ok ? "Copied." : "Copy failed.");
    });

    downloadBtn?.addEventListener("click", () => {
      if (!output.value.trim()) {
        setStatus("Nothing to download.");
        return;
      }
      downloadBlob(new Blob([output.value], { type: "image/svg+xml" }), "swapped.svg");
      setStatus("Download ready.");
    });
  };

  const initBackgroundRemover = (root) => {
    const input = root.querySelector("[data-bg-input]");
    const colorInput = root.querySelector("[data-bg-color]");
    const toleranceInput = root.querySelector("[data-bg-tolerance]");
    const runBtn = root.querySelector("[data-bg-run]");
    const downloadBtn = root.querySelector("[data-bg-download]");
    const canvas = root.querySelector("[data-bg-canvas]");
    const status = root.querySelector("[data-bg-status]");
    if (!input || !canvas || !runBtn) return;

    const ctx = canvas.getContext("2d");
    let currentImage = null;
    const setStatus = (text) => { if (status) status.textContent = text; };

    const loadImage = (file) => {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          currentImage = img;
          canvas.width = img.width;
          canvas.height = img.height;
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0, img.width, img.height);
          setStatus("Image loaded.");
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    };

    input.addEventListener("change", (event) => {
      const file = event.target.files && event.target.files[0];
      if (file) loadImage(file);
    });

    runBtn.addEventListener("click", () => {
      if (!currentImage) {
        setStatus("Upload an image first.");
        return;
      }
      const { width, height } = canvas;
      const imageData = ctx.getImageData(0, 0, width, height);
      const data = imageData.data;
      const bgColor = normalizeHex(colorInput?.value || "#ffffff");
      const tolerance = clamp(toNumber(toleranceInput?.value), 0, 80);
      const rBg = parseInt(bgColor.slice(1, 3), 16);
      const gBg = parseInt(bgColor.slice(3, 5), 16);
      const bBg = parseInt(bgColor.slice(5, 7), 16);
      const maxDist = (tolerance / 100) * 255;

      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const dist = Math.sqrt(
          (r - rBg) ** 2 + (g - gBg) ** 2 + (b - bBg) ** 2
        );
        if (dist <= maxDist) {
          data[i + 3] = 0;
        }
      }
      ctx.putImageData(imageData, 0, 0);
      setStatus("Background removed.");
    });

    downloadBtn?.addEventListener("click", () => {
      canvas.toBlob((blob) => {
        if (!blob) {
          setStatus("Nothing to download.");
          return;
        }
        downloadBlob(blob, "background-removed.png");
        setStatus("Download ready.");
      }, "image/png");
    });
  };

  const initUpscaler = (root) => {
    const input = root.querySelector("[data-upscale-input]");
    const factorSelect = root.querySelector("[data-upscale-factor]");
    const runBtn = root.querySelector("[data-upscale-run]");
    const downloadBtn = root.querySelector("[data-upscale-download]");
    const canvas = root.querySelector("[data-upscale-canvas]");
    const status = root.querySelector("[data-upscale-status]");
    if (!input || !canvas || !runBtn) return;

    const ctx = canvas.getContext("2d");
    let currentImage = null;
    const setStatus = (text) => { if (status) status.textContent = text; };

    input.addEventListener("change", (event) => {
      const file = event.target.files && event.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          currentImage = img;
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          const scale = Math.min(canvas.width / img.width, canvas.height / img.height, 1);
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = "high";
          ctx.drawImage(img, 0, 0, img.width * scale, img.height * scale);
          setStatus("Image loaded.");
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });

    runBtn.addEventListener("click", () => {
      if (!currentImage) {
        setStatus("Upload an image first.");
        return;
      }
      const factor = toNumber(factorSelect?.value) || 2;
      const width = currentImage.width * factor;
      const height = currentImage.height * factor;
      canvas.width = width;
      canvas.height = height;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(currentImage, 0, 0, width, height);
      setStatus(`Upscaled ${factor}x.`);
    });

    downloadBtn?.addEventListener("click", () => {
      canvas.toBlob((blob) => {
        if (!blob) {
          setStatus("Nothing to download.");
          return;
        }
        downloadBlob(blob, "upscaled.png");
        setStatus("Download ready.");
      }, "image/png");
    });
  };

  const initListingGenerator = (root) => {
    const productInput = root.querySelector("[data-listing-product]");
    const styleInput = root.querySelector("[data-listing-style]");
    const keywordsInput = root.querySelector("[data-listing-keywords]");
    const runBtn = root.querySelector("[data-listing-run]");
    const copyBtn = root.querySelector("[data-listing-copy]");
    const output = root.querySelector("[data-listing-output]");
    const status = root.querySelector("[data-listing-status]");
    if (!runBtn || !output) return;

    const setStatus = (text) => { if (status) status.textContent = text; };

    const templates = [
      "{style} {product} | {keywords}",
      "{product} - {keywords} ({style})",
      "{keywords} {product} in {style} Style",
      "{style} {product} Gift | {keywords}",
      "{product} for {keywords} Lovers"
    ];

    const buildTitles = () => {
      const product = (productInput?.value || "").trim();
      const style = (styleInput?.value || "").trim();
      const keywords = (keywordsInput?.value || "").split(",").map(k => k.trim()).filter(Boolean);
      if (!product) return [];
      const keywordText = keywords.slice(0, 3).join(" ");
      const filled = templates.map((tpl, idx) => {
        const kw = keywordText || product;
        return tpl
          .replace("{product}", product)
          .replace("{style}", style || "Modern")
          .replace("{keywords}", kw)
          .replace(/\s{2,}/g, " ")
          .trim();
      });
      return filled.map((title, idx) => `${idx + 1}. ${title}`);
    };

    runBtn.addEventListener("click", () => {
      const titles = buildTitles();
      if (!titles.length) {
        setStatus("Add a product name first.");
        return;
      }
      output.innerHTML = titles.map((title) => `<li>${title}</li>`).join("");
      setStatus("Generated.");
    });

    copyBtn?.addEventListener("click", async () => {
      const text = Array.from(output.querySelectorAll("li")).map(li => li.textContent).join("\n");
      const ok = await copyToClipboard(text);
      setStatus(ok ? "Copied." : "Copy failed.");
    });
  };

  const initProfitCalculator = (root) => {
    const priceInput = root.querySelector("[data-profit-price]");
    const costInput = root.querySelector("[data-profit-cost]");
    const shippingInput = root.querySelector("[data-profit-shipping]");
    const feeInput = root.querySelector("[data-profit-fee]");
    const platformInput = root.querySelector("[data-profit-platform]");
    const fixedInput = root.querySelector("[data-profit-fixed]");
    const feesOutput = root.querySelector("[data-profit-fees]");
    const netOutput = root.querySelector("[data-profit-net]");
    const marginOutput = root.querySelector("[data-profit-margin]");
    if (!priceInput || !feesOutput || !netOutput || !marginOutput) return;

    const update = () => {
      const price = toNumber(priceInput.value);
      const cost = toNumber(costInput?.value);
      const shipping = toNumber(shippingInput?.value);
      const feePercent = toNumber(feeInput?.value);
      const platformPercent = toNumber(platformInput?.value);
      const fixedFee = toNumber(fixedInput?.value);
      const percentFees = price * ((feePercent + platformPercent) / 100);
      const totalFees = percentFees + fixedFee;
      const net = price - cost - shipping - totalFees;
      const margin = price > 0 ? (net / price) * 100 : 0;
      feesOutput.textContent = `$${totalFees.toFixed(2)}`;
      netOutput.textContent = `$${net.toFixed(2)}`;
      marginOutput.textContent = `${margin.toFixed(1)}%`;
    };

    [priceInput, costInput, shippingInput, feeInput, platformInput, fixedInput].forEach((input) => {
      input?.addEventListener("input", update);
    });

    update();
  };

  const initModals = (root) => {
    root.addEventListener("click", (event) => {
      const open = event.target.closest("[data-tool-modal-open]");
      if (open) {
        const id = open.getAttribute("data-tool-modal-open");
        const modal = root.querySelector(`[data-tool-modal="${id}"]`);
        if (modal) modal.hidden = false;
        return;
      }
      const close = event.target.closest("[data-tool-modal-close]");
      if (close) {
        const id = close.getAttribute("data-tool-modal-close");
        const modal = root.querySelector(`[data-tool-modal="${id}"]`);
        if (modal) modal.hidden = true;
      }
    });
  };

  window.PFTools = {
    init(root) {
      if (!root || root.dataset.toolsInitialized) return;
      root.dataset.toolsInitialized = "true";
      initModals(root);
      initSvgOptimizer(root);
      initSvgColorSwapper(root);
      initBackgroundRemover(root);
      initUpscaler(root);
      initListingGenerator(root);
      initProfitCalculator(root);
    }
  };
})();
