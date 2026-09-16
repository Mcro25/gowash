document.addEventListener("DOMContentLoaded", () => {
  // Elements
  const spinBtn = document.getElementById("spinBtn");
  const spinBtnLabel = document.getElementById("spinBtnLabel");
  const spinStatusMsg = document.getElementById("spinStatusMsg");
  const campaignAlert = document.getElementById("campaignAlert");

  const participantNameInput = document.getElementById("participantName");
  const participantPhoneInput = document.getElementById("participantPhone");
  const termsCheckInput = document.getElementById("termsCheckInput");
  const nameErrorMsg = document.getElementById("nameErrorMsg");
  const phoneErrorMsg = document.getElementById("phoneErrorMsg");
  const termsErrorMsg = document.getElementById("termsErrorMsg");

  const registrationCard = document.getElementById("registrationCard");
  const winnerPersistentCard = document.getElementById("winnerPersistentCard");

  // Persistent Winner Card Elements
  const savedPrizeTitle = document.getElementById("savedPrizeTitle");
  const savedPrizeSubtext = document.getElementById("savedPrizeSubtext");
  const savedParticipantName = document.getElementById("savedParticipantName");
  const savedParticipantPhone = document.getElementById("savedParticipantPhone");
  const savedPromoCode = document.getElementById("savedPromoCode");
  const copySavedCodeBtn = document.getElementById("copySavedCodeBtn");
  const copySavedCodeText = document.getElementById("copySavedCodeText");
  const savedBookingBtn = document.getElementById("savedBookingBtn");
  const savedShareBtn = document.getElementById("savedShareBtn");

  // Winner Celebration Modal Elements
  const winnerModal = document.getElementById("winnerModal");
  const modalCloseBtn = document.getElementById("modalCloseBtn");
  const modalPrizeCard = document.getElementById("modalPrizeCard");
  const promoCodeDisplay = document.getElementById("promoCodeDisplay");
  const copyCodeBtn = document.getElementById("copyCodeBtn");
  const copyBtnText = document.getElementById("copyBtnText");
  const bookingCtaBtn = document.getElementById("bookingCtaBtn");
  const shareResultBtn = document.getElementById("shareResultBtn");

  // Terms Modal Elements
  const termsModal = document.getElementById("termsModal");
  const openTermsModalLink = document.getElementById("openTermsModalLink");
  const acceptTermsBtn = document.getElementById("acceptTermsBtn");
  const declineTermsBtn = document.getElementById("declineTermsBtn");

  // Recover Prize Modal Elements
  const recoverModal = document.getElementById("recoverModal");
  const openRecoverModalBtn = document.getElementById("openRecoverModalBtn");
  const recoverCloseBtn = document.getElementById("recoverCloseBtn");
  const recoverPhoneInput = document.getElementById("recoverPhoneInput");
  const submitRecoverBtn = document.getElementById("submitRecoverBtn");
  const recoverErrorMsg = document.getElementById("recoverErrorMsg");

  let visualPrizes = [];
  let wheelInstance = null;
  let campaignState = 'ACTIVE';
  const currentTermsVersion = "1.0";

  // Phone Normalizer helper
  function normalizeSaudiPhone(rawPhone) {
    if (!rawPhone || typeof rawPhone !== 'string') return null;
    let cleaned = rawPhone.trim().replace(/[\s\-\(\)\.]/g, '');
    if (cleaned.startsWith('+966')) {
      cleaned = '0' + cleaned.slice(4);
    } else if (cleaned.startsWith('00966')) {
      cleaned = '0' + cleaned.slice(5);
    } else if (cleaned.startsWith('966')) {
      cleaned = '0' + cleaned.slice(3);
    }
    if (/^5[0-9]{8}$/.test(cleaned)) {
      cleaned = '0' + cleaned;
    }
    if (/^05[0-9]{8}$/.test(cleaned)) {
      return cleaned;
    }
    return null;
  }

  // Pre-filled WhatsApp Booking URL
  function getWhatsAppUrl(code, prizeLabel, prizeSubtext) {
    const phone = "966580700242";
    const text = `مرحباً Go Wash، شاركت في فعالية اليوم الوطني 96 وحصلت على:\n` +
                 `🎁 الهدية: ${prizeLabel}${prizeSubtext ? ` (${prizeSubtext})` : ''}\n` +
                 `🏷️ الكود الحصري: ${code}\n` +
                 `أرغب في حجز موعد لغسيل وتلميع سيارتي بالخصم.`;
    return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
  }

  // Web Audio Synthesizer (Zero external files, 100% reliable offline)
  const soundEngine = {
    ctx: null,
    enabled: localStorage.getItem("gowash_sound_enabled") !== "false",
    init() {
      if (!this.ctx) {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (AudioContext) this.ctx = new AudioContext();
      }
      if (this.ctx && this.ctx.state === "suspended") {
        this.ctx.resume().catch(() => {});
      }
    },
    playTick() {
      if (!this.enabled) return;
      try {
        this.init();
        if (!this.ctx) return;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = "triangle";
        const now = this.ctx.currentTime;
        osc.frequency.setValueAtTime(800, now);
        osc.frequency.exponentialRampToValueAtTime(160, now + 0.03);
        gain.gain.setValueAtTime(0.18, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.03);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(now);
        osc.stop(now + 0.035);
      } catch (e) {}
    },
    playWinFanfare() {
      if (!this.enabled) return;
      try {
        this.init();
        if (!this.ctx) return;
        const chords = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6
        chords.forEach((freq, idx) => {
          const osc = this.ctx.createOscillator();
          const gain = this.ctx.createGain();
          const startTime = this.ctx.currentTime + (idx * 0.11);
          osc.type = "sine";
          osc.frequency.setValueAtTime(freq, startTime);
          gain.gain.setValueAtTime(0.22, startTime);
          gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.65);
          osc.connect(gain);
          gain.connect(this.ctx.destination);
          osc.start(startTime);
          osc.stop(startTime + 0.7);
        });
      } catch (e) {}
    },
    toggle() {
      this.enabled = !this.enabled;
      localStorage.setItem("gowash_sound_enabled", this.enabled ? "true" : "false");
      return this.enabled;
    }
  };

  // Sound Toggle Button Handler
  const soundToggleBtn = document.getElementById("soundToggleBtn");
  const soundIcon = document.getElementById("soundIcon");

  function updateSoundUI(isEnabled) {
    if (!soundToggleBtn || !soundIcon) return;
    if (isEnabled) {
      soundIcon.textContent = "🔊";
      soundToggleBtn.classList.remove("is-muted");
    } else {
      soundIcon.textContent = "🔇";
      soundToggleBtn.classList.add("is-muted");
    }
  }

  if (soundToggleBtn) {
    updateSoundUI(soundEngine.enabled);
    soundToggleBtn.addEventListener("click", () => {
      const active = soundEngine.toggle();
      updateSoundUI(active);
      if (active) soundEngine.playTick();
    });
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
      this.initLedRing();
    }

    initDPI() {
      const dpr = window.devicePixelRatio || 1;
      this.canvas.width = 460 * dpr;
      this.canvas.height = 460 * dpr;
      this.ctx.scale(dpr, dpr);
      this.size = 460;
    }

    initLedRing() {
      const ring = document.getElementById("wheelLedRing");
      if (!ring) return;
      ring.innerHTML = "";
      const totalDots = 20;
      const radius = 232;
      for (let i = 0; i < totalDots; i++) {
        const dot = document.createElement("div");
        dot.className = "led-dot";
        const angle = (i / totalDots) * (2 * Math.PI);
        const x = Math.cos(angle) * radius;
        const y = Math.sin(angle) * radius;
        dot.style.cssText = `
          position: absolute;
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: #FFE259;
          box-shadow: 0 0 8px #FFE259;
          top: calc(50% + ${y}px - 4px);
          left: calc(50% + ${x}px - 4px);
          transition: all 0.2s ease;
        `;
        ring.appendChild(dot);
      }
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

        // Sector arc
        this.ctx.beginPath();
        this.ctx.moveTo(0, 0);
        this.ctx.arc(0, 0, radius, start, end);
        this.ctx.fillStyle = p.color;
        this.ctx.fill();

        // Sector divider line
        this.ctx.lineWidth = 2.5;
        this.ctx.strokeStyle = "rgba(255, 255, 255, 0.25)";
        this.ctx.stroke();

        // Sector text
        this.ctx.save();
        this.ctx.rotate(start + this.arc / 2);
        this.ctx.textAlign = "right";
        this.ctx.textBaseline = "middle";
        this.ctx.fillStyle = p.text_color || "#FFFFFF";
        this.ctx.font = "bold 15px 'Cairo', sans-serif";
        this.ctx.fillText(p.label, radius - 24, 0);

        // Subtext if exists
        if (p.subtext) {
          this.ctx.fillStyle = "rgba(255, 255, 255, 0.82)";
          this.ctx.font = "11px 'Cairo', sans-serif";
          this.ctx.fillText(p.subtext, radius - 24, 18);
        }
        this.ctx.restore();
      }

      this.ctx.restore();
    }

    calculateAngle(targetPrizeId) {
      let targetIndex = this.prizes.findIndex(p => p.id === targetPrizeId);
      if (targetIndex === -1) targetIndex = 0;

      // Pointer is at TOP (3 * PI / 2)
      const targetMid = (targetIndex + 0.5) * this.arc;
      const targetAngle = (3 * Math.PI / 2) - targetMid;

      // Positive normalized angle
      const fullCircle = 2 * Math.PI;
      const normalized = (targetAngle % fullCircle + fullCircle) % fullCircle;

      // Add 6 to 8 full spins for realistic anticipation
      const extraSpins = (6 + Math.floor(Math.random() * 2)) * fullCircle;
      return extraSpins + normalized;
    }

    spinTo(targetAngle, onComplete) {
      if (this.isSpinning) return;
      this.isSpinning = true;

      const stage = document.querySelector(".wheel-stage");
      const pointer = document.getElementById("wheelPointer");
      const dots = document.querySelectorAll(".led-dot");
      if (stage) stage.classList.add("is-spinning");

      const startAngle = this.rotation % (2 * Math.PI);
      const totalDelta = targetAngle - startAngle;
      const duration = 4800; // 4.8 seconds
      const startTime = performance.now();

      // Quintic ease-out curve for dramatic slowdown
      const easeOut = (t) => 1 - Math.pow(1 - t, 4);
      let lastTickIndex = -1;

      const animate = (now) => {
        const elapsed = now - startTime;
        const progress = Math.min(1, elapsed / duration);
        const eased = easeOut(progress);

        this.rotation = startAngle + (totalDelta * eased);
        this.draw();

        // Audio & Haptic tick when passing sector pegs
        const currentTick = Math.floor((this.rotation + this.arc / 2) / this.arc);
        if (currentTick !== lastTickIndex) {
          lastTickIndex = currentTick;
          soundEngine.playTick();
          if (pointer) {
            pointer.classList.remove("is-ticking");
            void pointer.offsetWidth;
            pointer.classList.add("is-ticking");
          }
          if (navigator.vibrate) {
            try { navigator.vibrate(8); } catch (e) {}
          }
        }

        // Animate LED chase lights during spin
        if (dots.length > 0) {
          const activeIdx = Math.floor((this.rotation * 3.5) % dots.length);
          dots.forEach((dot, idx) => {
            if (idx === activeIdx || idx === (activeIdx + 1) % dots.length) {
              dot.style.background = "#00A3FF";
              dot.style.boxShadow = "0 0 14px #00A3FF";
            } else {
              dot.style.background = "#FFE259";
              dot.style.boxShadow = "0 0 8px #FFE259";
            }
          });
        }

        if (progress < 1) {
          requestAnimationFrame(animate);
        } else {
          this.isSpinning = false;
          if (stage) stage.classList.remove("is-spinning");
          soundEngine.playWinFanfare();
          if (navigator.vibrate) {
            try { navigator.vibrate([100, 50, 100, 50, 200]); } catch (e) {}
          }
          if (onComplete) onComplete();
        }
      };

      requestAnimationFrame(animate);
    }
  }

  // Display Winner Modal & Update Persistent Card
  function displayWinner(prize, promo, participantData) {
    const name = participantData?.name || participantNameInput.value.trim() || 'عميلنا المميز';
    const phone = participantData?.phone || normalizeSaudiPhone(participantPhoneInput.value) || '';

    // 1. Update Persistent Card (in-page, never disappears)
    savedPrizeTitle.textContent = prize.label;
    savedPrizeSubtext.textContent = prize.subtext || '';
    savedParticipantName.textContent = name;
    savedParticipantPhone.textContent = phone;
    savedPromoCode.textContent = promo.code;

    const bookingUrl = getWhatsAppUrl(promo.code, prize.label, prize.subtext);
    savedBookingBtn.href = bookingUrl;
    bookingCtaBtn.href = bookingUrl;

    registrationCard.style.display = "none";
    winnerPersistentCard.style.display = "block";

    // 2. Save to localStorage
    const payloadToSave = {
      name,
      phone,
      prize: { label: prize.label, type: prize.type, subtext: prize.subtext },
      promo: { code: promo.code, expiresAt: promo.expiresAt },
      wonAt: new Date().toISOString()
    };
    try {
      localStorage.setItem("gowash_saved_prize", JSON.stringify(payloadToSave));
    } catch (e) {}

    // 3. Update Modal
    modalPrizeCard.innerHTML = `
      <div style="font-size: 1.4rem; font-weight: 900; color: #FFF; margin-bottom: 4px;">${prize.label}</div>
      <div style="font-size: 0.92rem; color: #FCD34D;">${prize.subtext || ''}</div>
    `;
    promoCodeDisplay.textContent = promo.code;

    // Open Modal with celebration
    winnerModal.showModal();
    launchConfetti();
  }

  // High-performance 60fps Metallic Canvas Confetti Cannon
  function launchConfetti() {
    const canvas = document.getElementById("confettiCanvas");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    canvas.style.display = "block";

    const colors = ["#FFD700", "#10B981", "#00A3FF", "#FF5E1E", "#FFFFFF", "#F59E0B"];
    const particles = [];
    const total = 140;

    for (let i = 0; i < total; i++) {
      const isLeft = i < total / 2;
      particles.push({
        x: isLeft ? 50 + Math.random() * 80 : canvas.width - (50 + Math.random() * 80),
        y: canvas.height - 40,
        vx: (isLeft ? 1 : -1) * (Math.random() * 10 + 5),
        vy: -(Math.random() * 15 + 11),
        size: Math.random() * 9 + 6,
        color: colors[Math.floor(Math.random() * colors.length)],
        rotation: Math.random() * 360,
        rotSpeed: (Math.random() - 0.5) * 14,
        wobble: Math.random() * 10,
        wobbleSpeed: Math.random() * 0.12 + 0.05,
        opacity: 1
      });
    }

    let start = performance.now();
    const duration = 4000;

    function render(now) {
      const elapsed = now - start;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      let alive = false;
      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.38; // gravity
        p.vx *= 0.985; // air resistance
        p.rotation += p.rotSpeed;
        p.wobble += p.wobbleSpeed;

        if (elapsed > 2700) {
          p.opacity = Math.max(0, 1 - (elapsed - 2700) / 1300);
        }

        if (p.opacity > 0 && p.y < canvas.height + 40) {
          alive = true;
          ctx.save();
          ctx.translate(p.x + Math.sin(p.wobble) * 4, p.y);
          ctx.rotate((p.rotation * Math.PI) / 180);
          ctx.globalAlpha = p.opacity;
          ctx.fillStyle = p.color;
          ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
          ctx.restore();
        }
      }

      if (alive && elapsed < duration) {
        requestAnimationFrame(render);
      } else {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        canvas.style.display = "none";
      }
    }

    requestAnimationFrame(render);
  }

  // Check and display saved prize from localStorage or backend
  function checkExistingSavedPrize(backendParticipant) {
    // 1. Check local storage first
    try {
      const localData = localStorage.getItem("gowash_saved_prize");
      if (localData) {
        const parsed = JSON.parse(localData);
        if (parsed && parsed.promo && parsed.promo.code) {
          savedPrizeTitle.textContent = parsed.prize.label;
          savedPrizeSubtext.textContent = parsed.prize.subtext || '';
          savedParticipantName.textContent = parsed.name || 'عميل Go Wash';
          savedParticipantPhone.textContent = parsed.phone || '';
          savedPromoCode.textContent = parsed.promo.code;

          const bookingUrl = getWhatsAppUrl(parsed.promo.code, parsed.prize.label, parsed.prize.subtext);
          savedBookingBtn.href = bookingUrl;
          bookingCtaBtn.href = bookingUrl;

          registrationCard.style.display = "none";
          winnerPersistentCard.style.display = "block";
          return true;
        }
      }
    } catch (e) {}

    // 2. Check backend participant status
    if (backendParticipant && backendParticipant.hasSpun && backendParticipant.existingResult) {
      const res = backendParticipant.existingResult;
      savedPrizeTitle.textContent = res.label;
      savedPrizeSubtext.textContent = res.subtext || '';
      savedParticipantName.textContent = res.name || 'عميلنا العزيز';
      savedParticipantPhone.textContent = res.phone || '';
      savedPromoCode.textContent = res.code || '---';

      const bookingUrl = getWhatsAppUrl(res.code, res.label, res.subtext);
      savedBookingBtn.href = bookingUrl;
      bookingCtaBtn.href = bookingUrl;

      registrationCard.style.display = "none";
      winnerPersistentCard.style.display = "block";
      return true;
    }

    return false;
  }

  // Update social media links from backend
  function updateSocialLinks(links) {
    if (!links) return;
    const whatsapps = [
      document.getElementById("socialWhatsapp"),
      document.getElementById("headerSocialWhatsapp"),
      document.getElementById("footerSocialWhatsapp")
    ];
    const instagrams = [
      document.getElementById("socialInstagram"),
      document.getElementById("headerSocialInstagram"),
      document.getElementById("footerSocialInstagram")
    ];
    const tiktoks = [
      document.getElementById("socialTiktok"),
      document.getElementById("headerSocialTiktok"),
      document.getElementById("footerSocialTiktok")
    ];

    if (links.whatsapp) {
      whatsapps.forEach(el => { if (el) el.href = links.whatsapp; });
    }
    if (links.instagram) {
      instagrams.forEach(el => { if (el) el.href = links.instagram; });
    }
    if (links.tiktok) {
      tiktoks.forEach(el => { if (el) el.href = links.tiktok; });
    }
  }

  // Initialize campaign metadata from Backend
  async function initCampaign() {
    try {
      const res = await fetch("/api/campaign");
      const data = await res.json();

      if (!data.success) {
        spinStatusMsg.textContent = data.error || "تعذر تحميل بيانات الفعالية.";
        spinStatusMsg.className = "spin-status-banner error";
        spinBtn.disabled = true;
        return;
      }

      campaignState = data.campaign.status;
      visualPrizes = data.prizes;

      if (data.campaign.socialLinks) {
        updateSocialLinks(data.campaign.socialLinks);
      }

      wheelInstance = new VisualWheel("wheelCanvas", visualPrizes);

      if (campaignState === 'PAUSED') {
        campaignAlert.textContent = "⚠️ فعالية اليوم الوطني 96 متوقفة مؤقتاً حالياً.";
        campaignAlert.className = "campaign-alert-bar paused";
        spinBtn.disabled = true;
        spinStatusMsg.textContent = "الفعالية متوقفة مؤقتاً.";
        spinStatusMsg.className = "spin-status-banner error";
        return;
      }

      if (campaignState === 'ENDED') {
        campaignAlert.textContent = "🛑 انتهت فعالية اليوم الوطني السعودي 96. شكراً لثقتكم بمغسلة Go Wash!";
        campaignAlert.className = "campaign-alert-bar ended";
        spinBtn.disabled = true;
        spinStatusMsg.textContent = "انتهت الفعالية.";
        spinStatusMsg.className = "spin-status-banner error";
        return;
      }

      // Check existing prize
      checkExistingSavedPrize(data.participant);

    } catch (err) {
      console.error("Init campaign error:", err);
      spinStatusMsg.textContent = "حدث خطأ في الاتصال بالخادم. يرجى تحديث الصفحة.";
      spinStatusMsg.className = "spin-status-banner error";
      spinBtn.disabled = true;
    }
  }

  // Copy code handler helper with haptics
  function setupCopyBtn(btn, textSpan, codeSourceEl) {
    btn?.addEventListener("click", async () => {
      const code = codeSourceEl.textContent.trim();
      if (!code || code === '--------') return;
      try {
        await navigator.clipboard.writeText(code);
        if (navigator.vibrate) {
          try { navigator.vibrate(35); } catch (e) {}
        }
        const original = textSpan.textContent;
        textSpan.textContent = "تم النسخ!";
        btn.style.background = "#059669";
        btn.style.borderColor = "#10B981";
        setTimeout(() => {
          textSpan.textContent = original;
          btn.style.background = "";
          btn.style.borderColor = "";
        }, 2200);
      } catch (e) {
        textSpan.textContent = "تم النسخ!";
      }
    });
  }

  setupCopyBtn(copyCodeBtn, copyBtnText, promoCodeDisplay);
  setupCopyBtn(copySavedCodeBtn, copySavedCodeText, savedPromoCode);

  // Share handlers
  function shareWinner(codeGetter) {
    const code = codeGetter();
    const shareData = {
      title: "Go Wash | احتفال اليوم الوطني السعودي 96",
      text: `ربحت مع Go Wash في فعالية اليوم الوطني 96! كود الخصم الحصري الخاص بي: ${code}`,
      url: window.location.href
    };
    if (navigator.share) {
      navigator.share(shareData).catch(() => {});
    } else {
      navigator.clipboard.writeText(window.location.href);
      alert("تم نسخ رابط الفعالية لمشاركته مع أصدقائك!");
    }
  }

  shareResultBtn?.addEventListener("click", () => shareWinner(() => promoCodeDisplay.textContent));
  savedShareBtn?.addEventListener("click", () => shareWinner(() => savedPromoCode.textContent));

  // Terms Modal Handlers
  openTermsModalLink?.addEventListener("click", () => termsModal.showModal());
  acceptTermsBtn?.addEventListener("click", () => {
    termsCheckInput.checked = true;
    termsErrorMsg.textContent = "";
    termsModal.close();
  });
  declineTermsBtn?.addEventListener("click", () => {
    termsCheckInput.checked = false;
    termsModal.close();
  });
  modalCloseBtn?.addEventListener("click", () => winnerModal.close());

  // Recover Modal Handlers
  openRecoverModalBtn?.addEventListener("click", () => {
    recoverErrorMsg.textContent = "";
    recoverPhoneInput.value = "";
    recoverModal.showModal();
  });
  recoverCloseBtn?.addEventListener("click", () => recoverModal.close());

  submitRecoverBtn?.addEventListener("click", async () => {
    const raw = recoverPhoneInput.value.trim();
    const phone = normalizeSaudiPhone(raw);
    if (!phone) {
      recoverErrorMsg.textContent = "يرجى إدخال رقم جوال سعودي صحيح يبدأ بـ 05 (10 أرقام).";
      return;
    }
    recoverErrorMsg.textContent = "جاري البحث عن جائزتك...";

    try {
      const res = await fetch("/api/check-prize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        recoverErrorMsg.textContent = data.message || data.error || "لا توجد جائزة مسجلة بهذا الرقم.";
        return;
      }

      recoverModal.close();
      displayWinner(data.prize, data.promo, data.participant);
    } catch (e) {
      recoverErrorMsg.textContent = "حدث خطأ أثناء الاتصال. يرجى المحاولة لاحقاً.";
    }
  });

  // Client validation
  function validateForm() {
    let isValid = true;
    nameErrorMsg.textContent = "";
    phoneErrorMsg.textContent = "";
    termsErrorMsg.textContent = "";
    spinStatusMsg.textContent = "";
    spinStatusMsg.className = "spin-status-banner";

    const name = participantNameInput.value.trim();
    if (name.length < 2) {
      nameErrorMsg.textContent = "يرجى كتابة اسمك الكريم (حرفين على الأقل).";
      participantNameInput.focus();
      isValid = false;
    }

    const rawPhone = participantPhoneInput.value.trim();
    const phone = normalizeSaudiPhone(rawPhone);
    if (!phone) {
      phoneErrorMsg.textContent = "يرجى إدخال رقم جوال سعودي صحيح (مثال: 0580700242).";
      if (isValid) participantPhoneInput.focus();
      isValid = false;
    }

    if (!termsCheckInput.checked) {
      termsErrorMsg.textContent = "يجب الموافقة على الشروط والأحكام للمشاركة.";
      isValid = false;
    }

    return { isValid, name, phone };
  }

  // Spin Button Click
  spinBtn?.addEventListener("click", async () => {
    if (!wheelInstance || wheelInstance.isSpinning) return;
    if (campaignState !== 'ACTIVE') return;

    const { isValid, name, phone } = validateForm();
    if (!isValid) return;

    // Disable button & show spinner
    spinBtn.disabled = true;
    spinBtnLabel.textContent = "جاري السحب والتحقق...";
    spinStatusMsg.textContent = "جاري الاتصال بالنظام المشفر واختيار هديتك...";
    spinStatusMsg.className = "spin-status-banner";

    // Idempotency key per attempt
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
        body: JSON.stringify({
          idempotencyKey,
          termsAccepted: true,
          termsVersion: currentTermsVersion,
          name,
          phone
        })
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        spinBtn.disabled = false;
        spinBtnLabel.textContent = "لف العجلة الآن";
        const errMsg = data.message || data.error || "حدث خطأ أثناء السحب. يرجى المحاولة لاحقاً.";
        spinStatusMsg.textContent = errMsg;
        spinStatusMsg.className = "spin-status-banner error";

        if (data.code === 'ALREADY_SPUN') {
          spinBtn.disabled = true;
          if (data.existingPrize) {
            displayWinner(
              { label: data.existingPrize.label, type: data.existingPrize.type || 'DISCOUNT', subtext: data.existingPrize.subtext || '' },
              { code: data.existingPrize.code, expiresAt: data.existingPrize.expiresAt },
              { name: data.existingPrize.name || name, phone: data.existingPrize.phone || phone }
            );
          }
        }
        return;
      }

      // Success from Backend
      spinStatusMsg.textContent = "مبروك! العجلة تدور الآن...";
      sessionStorage.removeItem("gowash_idempotency_key");

      const targetAngle = wheelInstance.calculateAngle(data.prize.id);

      wheelInstance.spinTo(targetAngle, () => {
        displayWinner(data.prize, data.promo, { name: data.participant?.name || name, phone: data.participant?.phone || phone });
        spinStatusMsg.textContent = "";
      });

    } catch (err) {
      console.error("Spin error:", err);
      spinBtn.disabled = false;
      spinBtnLabel.textContent = "لف العجلة الآن";
      spinStatusMsg.textContent = "فشل الاتصال بالخادم. يرجى التحقق من اتصالك والمحاولة مجدداً.";
      spinStatusMsg.className = "spin-status-banner error";
    }
  });

  // Live National Day 96 Countdown Timer
  function initCountdownTimer() {
    let target = localStorage.getItem("gowash_countdown_target");
    if (!target) {
      const d = new Date();
      d.setDate(d.getDate() + 2);
      d.setHours(23, 59, 59, 0);
      target = d.getTime();
      localStorage.setItem("gowash_countdown_target", target);
    } else {
      target = Number(target);
    }

    const cdDays = document.getElementById("cdDays");
    const cdHours = document.getElementById("cdHours");
    const cdMins = document.getElementById("cdMins");
    const cdSecs = document.getElementById("cdSecs");

    function update() {
      const now = Date.now();
      let diff = Math.max(0, target - now);

      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      diff -= days * (1000 * 60 * 60 * 24);
      const hours = Math.floor(diff / (1000 * 60 * 60));
      diff -= hours * (1000 * 60 * 60);
      const mins = Math.floor(diff / (1000 * 60));
      diff -= mins * (1000 * 60);
      const secs = Math.floor(diff / 1000);

      if (cdDays) cdDays.textContent = String(days).padStart(2, "0");
      if (cdHours) cdHours.textContent = String(hours).padStart(2, "0");
      if (cdMins) cdMins.textContent = String(mins).padStart(2, "0");
      if (cdSecs) cdSecs.textContent = String(secs).padStart(2, "0");
    }

    update();
    setInterval(update, 1000);
  }

  // Live Recent Winners Ticker
  function initLiveFeedTicker() {
    const feedText = document.getElementById("feedText");
    if (!feedText) return;

    const feeds = [
      "🔥 فاز قبل دقيقة: فهد من الرياض بخصم 20%",
      "✨ فازت قبل 3 دقائق: نورة من جدة بترقية باقة Signature الفاخرة",
      "🎉 فاز قبل 5 دقائق: سلطان من الدمام بخصم 15%",
      "🚗 فاز قبل 7 دقائق: فيصل من الخبر بخصم 10%",
      "🇸🇦 فازت قبل 9 دقائق: ريم من مكة بترقية باقة Signature الفاخرة",
      "🎁 فاز قبل 12 دقيقة: عبدالله من المدينة بخصم 20%"
    ];

    let index = 0;
    setInterval(() => {
      index = (index + 1) % feeds.length;
      feedText.style.opacity = "0";
      feedText.style.transition = "opacity 0.3s ease";
      setTimeout(() => {
        feedText.textContent = feeds[index];
        feedText.style.opacity = "1";
      }, 300);
    }, 4500);
  }

  // Interactive Savings Calculator for Two Cars 25% Offer
  function initSavingsCalculator() {
    const car1Select = document.getElementById("car1Package");
    const car2Select = document.getElementById("car2Package");
    const origDisplay = document.getElementById("calcOriginalPrice");
    const discDisplay = document.getElementById("calcDiscountAmount");
    const finalDisplay = document.getElementById("calcFinalPrice");
    const bookingBtn = document.getElementById("twoCarsBookingBtn");

    if (!car1Select || !car2Select) return;

    const packageNames = {
      "70": "باقة واش الأساسية",
      "95": "باقة واش بلس المتميزة",
      "140": "باقة Signature الفاخرة"
    };

    function recalculate() {
      const p1 = Number(car1Select.value) || 95;
      const p2 = Number(car2Select.value) || 95;
      const original = p1 + p2;
      const discount = original * 0.25;
      const finalPrice = original - discount;

      if (origDisplay) origDisplay.textContent = `${original.toFixed(2)} ر.س`;
      if (discDisplay) discDisplay.textContent = `${discount.toFixed(2)} ر.س`;
      if (finalDisplay) finalDisplay.textContent = `${finalPrice.toFixed(2)} ر.س`;

      if (bookingBtn) {
        const p1Name = packageNames[car1Select.value] || "باقة 1";
        const p2Name = packageNames[car2Select.value] || "باقة 2";
        const message = `مرحباً Go Wash، أرغب في الاستفادة من عرض غسيل السيارتين في نفس الموقع (خصم 25% اليوم الوطني):\n` +
                        `🚗 السيارة الأولى: ${p1Name} (${p1} ر.س)\n` +
                        `🚙 السيارة الثانية: ${p2Name} (${p2} ر.س)\n` +
                        `💰 الإجمالي قبل الخصم: ${original} ر.س\n` +
                        `🎉 الخصم (25%): -${discount.toFixed(2)} ر.س\n` +
                        `💵 السعر النهائي: ${finalPrice.toFixed(2)} ر.س\n` +
                        `أرغب في تأكيد الموعد لغسيل السيارتين.`;
        bookingBtn.href = `https://wa.me/966580700242?text=${encodeURIComponent(message)}`;
      }
    }

    car1Select.addEventListener("change", recalculate);
    car2Select.addEventListener("change", recalculate);
    recalculate();
  }

  // Hero scroll button
  document.getElementById("heroScrollBtn")?.addEventListener("click", (e) => {
    e.preventDefault();
    document.getElementById("spin-arena")?.scrollIntoView({ behavior: "smooth" });
  });

  // Start initialization
  initCampaign();
  initCountdownTimer();
  initLiveFeedTicker();
  initSavingsCalculator();
});
