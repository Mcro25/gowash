document.addEventListener("DOMContentLoaded", () => {
  // DOM Elements
  const spinBtn = document.getElementById("spinBtn");
  const statusMsg = document.getElementById("spinStatusMsg");
  const trackerText = document.getElementById("trackerText");
  const trackerBox = document.getElementById("eligibilityTracker");
  const campaignAlert = document.getElementById("campaignAlert");
  const modal = document.getElementById("winnerModal");
  const closeBtn = document.getElementById("modalCloseBtn");
  const prizeCard = document.getElementById("modalPrizeCard");
  const codeDisplay = document.getElementById("promoCodeDisplay");
  const copyBtn = document.getElementById("copyCodeBtn");
  const copyText = document.getElementById("copyBtnText");
  const bookingBtn = document.getElementById("bookingCtaBtn");
  const shareBtn = document.getElementById("shareResultBtn");
  const accordToggle = document.getElementById("instructionsToggle");
  const accordContent = document.querySelector(".instructions-accordion");

  let visualPrizes = [];
  let wheelInstance = null;
  let campaignState = 'ACTIVE';

  // WhatsApp Booking URL generator
  function getWhatsAppUrl(code, prizeLabel, prizeSubtext) {
    const phone = "966580700242";
    const text = `مرحباً Go Wash، شاركت في فعالية اليوم الوطني 96 وحصلت على:\n` +
                 `الهدية: ${prizeLabel} (${prizeSubtext})\n` +
                 `الكود الحصري: ${code}\n` +
                 `أرغب في حجز موعد لغسيل سيارتي.`;
    return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
  }

  // Visual Wheel Engine
  class VisualWheel {
    constructor(canvasId, prizes) {
      this.canvas = document.getElementById(canvasId);
      this.ctx = this.canvas.getContext("2d");
      this.prizes = prizes;
      this.num = prizes.length;
      this.arc = (2 * Math.PI) / this.num;
      this.rotation = 0;
      this.isSpinning = false;

      this.initDPI();
      this.draw();
    }

    initDPI() {
      const dpr = window.devicePixelRatio || 1;
      this.canvas.width = 460 * dpr;
      this.canvas.height = 460 * dpr;
      this.ctx.scale(dpr, dpr);
      this.size = 460;
    }

    draw() {
      const center = this.size / 2;
      const radius = center - 8;

      this.ctx.clearRect(0, 0, this.size, this.size);
      this.ctx.save();
      this.ctx.translate(center, center);
      this.ctx.rotate(this.rotation);

      for (let i = 0; i < this.num; i++) {
        const p = this.prizes[i];
        const start = i * this.arc;
        const end = start + this.arc;

        this.ctx.beginPath();
        this.ctx.moveTo(0, 0);
        this.ctx.arc(0, 0, radius, start, end);
        this.ctx.fillStyle = p.color;
        this.ctx.fill();

        this.ctx.lineWidth = 2;
        this.ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
        this.ctx.stroke();

        // Sector text
        this.ctx.save();
        this.ctx.rotate(start + this.arc / 2);
        this.ctx.textAlign = "right";
        this.ctx.fillStyle = p.text_color || "#FFFFFF";

        if (p.type === "upgrade") {
          this.ctx.font = "900 18px 'Cairo', sans-serif";
          this.ctx.fillText("Signature", radius - 28, 6);
        } else {
          this.ctx.font = "900 24px 'Cairo', sans-serif";
          this.ctx.fillText(p.label, radius - 30, 8);
        }
        this.ctx.restore();
      }
      this.ctx.restore();
    }

    calculateAngle(prizeId) {
      let index = this.prizes.findIndex(p => p.id === prizeId);
      if (index === -1) index = 0;

      const sectorCenter = (index * this.arc) + (this.arc / 2);
      const pointer = 1.5 * Math.PI; // Top center

      const jitter = (Math.random() - 0.5) * (this.arc * 0.4);
      let baseAngle = pointer - sectorCenter + jitter;
      baseAngle = ((baseAngle % (2 * Math.PI)) + (2 * Math.PI)) % (2 * Math.PI);

      const spins = 6 * (2 * Math.PI);
      const currentMod = this.rotation % (2 * Math.PI);
      const distance = ((baseAngle - currentMod) + (2 * Math.PI)) % (2 * Math.PI);

      return this.rotation + spins + distance;
    }

    spinTo(targetAngle, callback) {
      this.isSpinning = true;
      const start = this.rotation;
      const delta = targetAngle - start;
      const duration = 5200;
      const startTime = performance.now();

      const easeOut = (t) => 1 - Math.pow(1 - t, 5);

      const frame = (now) => {
        const elapsed = now - startTime;
        const prog = Math.min(elapsed / duration, 1);
        this.rotation = start + (delta * easeOut(prog));
        this.draw();

        if (prog < 1) {
          requestAnimationFrame(frame);
        } else {
          this.isSpinning = false;
          this.rotation = targetAngle;
          this.draw();
          if (callback) callback();
        }
      };

      requestAnimationFrame(frame);
    }
  }

  function displayWinnerModal(prize, promo) {
    if (prize.type === "upgrade") {
      prizeCard.innerHTML = `
        <div class="prize-badge-amount" style="color: var(--gowash-orange);">GoWash Signature</div>
        <div class="prize-badge-title">ترقية مجانية فاخرة!</div>
        <div class="prize-badge-sub">ادفع قيمة الغسيل العادي واحصل على باقة GoWash Signature الشاملة.</div>
      `;
    } else {
      prizeCard.innerHTML = `
        <div class="prize-badge-amount">${prize.label}</div>
        <div class="prize-badge-title">خصم اليوم الوطني على غسيلك</div>
        <div class="prize-badge-sub">${prize.subtext || 'خصم خاص بمناسبة اليوم الوطني 96'}</div>
      `;
    }

    codeDisplay.textContent = promo.code;
    bookingBtn.href = getWhatsAppUrl(promo.code, prize.label, prize.subtext || '');
    modal.showModal();
  }

  function disablePermanently(msg, existingResult) {
    spinBtn.disabled = true;
    spinBtn.classList.remove("is-loading");
    statusMsg.textContent = msg;
    trackerBox.classList.add("exhausted");
    trackerText.textContent = "تم استهلاك فرصة التدوير الخاصة بك في فعالية اليوم الوطني 96.";

    if (existingResult) {
      // Add a view prize button if already spun
      const viewBtn = document.createElement("button");
      viewBtn.className = "btn";
      viewBtn.style.cssText = "margin-top: 10px; background: rgba(29, 111, 184, 0.2); border: 1px solid var(--gowash-blue); color: #FFF; font-size: 0.88rem; padding: 6px 14px; border-radius: var(--radius-sm); cursor: pointer;";
      viewBtn.textContent = "عرض جائزتي والكود الترويجي";
      viewBtn.onclick = () => {
        displayWinnerModal({ label: existingResult.label, type: existingResult.type, subtext: existingResult.subtext }, { code: existingResult.code });
      };
      statusMsg.innerHTML = `<div>${msg}</div>`;
      statusMsg.appendChild(viewBtn);
    }
  }

  // Load Campaign Metadata from Backend
  async function initCampaign() {
    try {
      const res = await fetch("/api/campaign");
      const data = await res.json();

      if (!data.success) {
        statusMsg.textContent = data.error || "تعذر تحميل الفعالية حالياً.";
        statusMsg.classList.add("error");
        spinBtn.disabled = true;
        return;
      }

      campaignState = data.campaign.status;
      visualPrizes = data.prizes;

      wheelInstance = new VisualWheel("wheelCanvas", visualPrizes);

      if (campaignState === 'PAUSED') {
        campaignAlert.textContent = "⚠️ الفعالية متوقفة مؤقتاً حالياً.";
        campaignAlert.className = "campaign-alert-bar paused";
        spinBtn.disabled = true;
        statusMsg.textContent = "الفعالية متوقفة مؤقتاً.";
        return;
      }

      if (campaignState === 'ENDED') {
        campaignAlert.textContent = "🛑 انتهت فعالية اليوم الوطني 96. شكراً لمشاركتكم!";
        campaignAlert.className = "campaign-alert-bar ended";
        spinBtn.disabled = true;
        statusMsg.textContent = "انتهت الفعالية.";
        return;
      }

      // Check participant history
      if (data.participant && data.participant.hasSpun) {
        disablePermanently(`لقد حصلت مسبقاً على: (${data.participant.existingResult.label})`, data.participant.existingResult);
      }
    } catch (err) {
      console.error("Init campaign error:", err);
      statusMsg.textContent = "حدث خطأ في الاتصال بالخادم. يرجى تحديث الصفحة.";
      statusMsg.classList.add("error");
      spinBtn.disabled = true;
    }
  }

  // UI Event Handlers
  document.getElementById("heroStartBtn")?.addEventListener("click", (e) => {
    e.preventDefault();
    document.getElementById("wheel-section").scrollIntoView({ behavior: "smooth" });
  });

  accordToggle?.addEventListener("click", () => {
    const isExp = accordContent.classList.toggle("active");
    accordToggle.setAttribute("aria-expanded", isExp);
  });

  closeBtn?.addEventListener("click", () => modal.close());
  modal?.addEventListener("click", (e) => { if (e.target === modal) modal.close(); });

  copyBtn?.addEventListener("click", async () => {
    const code = codeDisplay.textContent;
    if (!code || code === "--------") return;
    try {
      await navigator.clipboard.writeText(code);
      copyText.textContent = "تم النسخ!";
      setTimeout(() => copyText.textContent = "نسخ الكود", 2500);
    } catch(e) {
      copyText.textContent = "تم النسخ!";
    }
  });

  shareBtn?.addEventListener("click", () => {
    const code = codeDisplay.textContent;
    const shareData = {
      title: "Go Wash | احتفال اليوم الوطني السعودي 96",
      text: `ربحت مع Go Wash في فعالية اليوم الوطني السعودي 96! كود الخصم: ${code}`,
      url: window.location.href
    };
    if (navigator.share) {
      navigator.share(shareData).catch(() => {});
    } else {
      navigator.clipboard.writeText(window.location.href);
      alert("تم نسخ رابط الفعالية لمشاركته مع أصدقائك!");
    }
  });

  // Spin Request Action
  spinBtn.addEventListener("click", async () => {
    if (!wheelInstance || wheelInstance.isSpinning) return;
    if (campaignState !== 'ACTIVE') return;

    // Disable button immediately to prevent double clicks
    spinBtn.disabled = true;
    spinBtn.classList.add("is-loading");
    statusMsg.textContent = "جاري التحقق وسحب الجائزة من السيرفر...";
    statusMsg.classList.remove("error");

    // Generate client-side idempotency key for this attempt
    let idempotencyKey = sessionStorage.getItem("gowash_idempotency_key");
    if (!idempotencyKey) {
      idempotencyKey = "idemp_" + Math.random().toString(36).substring(2) + Date.now();
      sessionStorage.setItem("gowash_idempotency_key", idempotencyKey);
    }

    try {
      const response = await fetch("/api/spin", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey
        },
        body: JSON.stringify({ idempotencyKey })
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        spinBtn.classList.remove("is-loading");
        const errMsg = data.message || data.error || "حدث خطأ أثناء السحب. يرجى المحاولة لاحقاً.";
        statusMsg.textContent = errMsg;
        statusMsg.classList.add("error");

        if (data.code === 'ALREADY_SPUN') {
          disablePermanently("تم استهلاك فرصة التدوير الخاصة بك في فعالية اليوم الوطني 96.", data.existingPrize);
        } else if (data.code === 'CAMPAIGN_PAUSED' || data.code === 'CAMPAIGN_ENDED') {
          spinBtn.disabled = true;
        } else {
          // Allow retry on transient error
          spinBtn.disabled = false;
        }
        return;
      }

      // Successful spin response from backend
      statusMsg.textContent = "";
      sessionStorage.removeItem("gowash_idempotency_key");

      const targetAngle = wheelInstance.calculateAngle(data.prize.id);

      wheelInstance.spinTo(targetAngle, () => {
        disablePermanently(`مبروك! فزت بـ ${data.prize.label}`, {
          label: data.prize.label,
          type: data.prize.type,
          subtext: data.prize.subtext,
          code: data.promo.code
        });
        displayWinnerModal(data.prize, data.promo);
      });
    } catch (err) {
      console.error("Spin request error:", err);
      spinBtn.disabled = false;
      spinBtn.classList.remove("is-loading");
      statusMsg.textContent = "فشل الاتصال بالخادم. يرجى التحقق من اتصالك والمحاولة مرة أخرى.";
      statusMsg.classList.add("error");
    }
  });

  // Start initialization
  initCampaign();
});
