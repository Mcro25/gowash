document.addEventListener("DOMContentLoaded", () => {
  // Backend API Base URL Configuration for GitHub Pages & Railway Hosting
  // When running on GitHub Pages (e.g. https://mcro25.github.io/gowash/),
  // requests route to Railway Backend. In local dev, falls back to current origin.
  const API_BASE_URL = window.GOWASH_API_URL || 
    (window.location.hostname.includes('github.io') 
      ? "https://gowash-production.up.railway.app" 
      : "");

  // Resilient API Fetch Helper with Credentials & Cross-Origin Header Storage
  async function apiFetch(endpoint, options = {}) {
    const url = `${API_BASE_URL}${endpoint}`;
    const pid = localStorage.getItem("gowash_pid");
    const headers = {
      "Content-Type": "application/json",
      ...(pid ? { "X-Participant-Id": pid } : {}),
      ...(options.headers || {})
    };

    const res = await fetch(url, {
      ...options,
      credentials: "include",
      headers
    });

    const serverPid = res.headers.get("X-Participant-Id");
    if (serverPid) {
      try { localStorage.setItem("gowash_pid", serverPid); } catch (e) {}
    }

    return res;
  }

  // Elements
  const spinBtn = document.getElementById("spinBtn");
  const spinBtnLabel = document.getElementById("spinBtnLabel");
  const spinStatusMsg = document.getElementById("spinStatusMsg");
  const campaignAlert = document.getElementById("campaignAlert");

  // Terms & Entry Modal
  const termsModal = document.getElementById("termsModal");
  const termsCloseIcon = document.getElementById("termsCloseIcon");
  const termsStep1 = document.getElementById("termsStep1");
  const termsStep2 = document.getElementById("termsStep2");
  const acceptTermsBtn = document.getElementById("acceptTermsBtn");
  const declineTermsBtn = document.getElementById("declineTermsBtn");
  const participantNameInput = document.getElementById("participantName");
  const participantPhoneInput = document.getElementById("participantPhone");
  const nameErrorMsg = document.getElementById("nameErrorMsg");
  const phoneErrorMsg = document.getElementById("phoneErrorMsg");
  const startSpinSubmitBtn = document.getElementById("startSpinSubmitBtn");
  const backToTermsBtn = document.getElementById("backToTermsBtn");

  // Wheel Arena Elements
  const wheelArena = document.getElementById("wheelArena");

  // Persistent Winner Ticket Elements
  const winnerPersistentCard = document.getElementById("winnerPersistentCard");
  const ticketBadgeText = document.getElementById("ticketBadgeText");
  const ticketStatusBadge = document.getElementById("ticketStatusBadge");
  const ticketKickerText = document.getElementById("ticketKickerText");
  const savedPrizeTitle = document.getElementById("savedPrizeTitle");
  const savedPrizeSubtext = document.getElementById("savedPrizeSubtext");
  const savedParticipantName = document.getElementById("savedParticipantName");
  const savedParticipantPhone = document.getElementById("savedParticipantPhone");
  const savedPromoCode = document.getElementById("savedPromoCode");
  const copySavedCodeBtn = document.getElementById("copySavedCodeBtn");
  const copySavedCodeText = document.getElementById("copySavedCodeText");
  const savedBookingBtn = document.getElementById("savedBookingBtn");
  const savedShareBtn = document.getElementById("savedShareBtn");
  const savedHowToUseBtn = document.getElementById("savedHowToUseBtn");
  const ticketRedeemedNotice = document.getElementById("ticketRedeemedNotice");

  // Celebration Modal Elements
  const winnerModal = document.getElementById("winnerModal");
  const modalCloseBtn = document.getElementById("modalCloseBtn");
  const modalPrizeCard = document.getElementById("modalPrizeCard");
  const promoCodeDisplay = document.getElementById("promoCodeDisplay");
  const copyCodeBtn = document.getElementById("copyCodeBtn");
  const copyBtnText = document.getElementById("copyBtnText");
  const bookingCtaBtn = document.getElementById("bookingCtaBtn");
  const shareResultBtn = document.getElementById("shareResultBtn");
  const modalHowToUseBtn = document.getElementById("modalHowToUseBtn");

  // Recover Modal Elements
  const recoverModal = document.getElementById("recoverModal");
  const openRecoverModalBtn = document.getElementById("openRecoverModalBtn");
  const recoverCloseBtn = document.getElementById("recoverCloseBtn");
  const recoverPhoneInput = document.getElementById("recoverPhoneInput");
  const submitRecoverBtn = document.getElementById("submitRecoverBtn");
  const recoverErrorMsg = document.getElementById("recoverErrorMsg");

  // Section & Global Elements
  const howToUseSection = document.getElementById("howToUseSection");
  const appToast = document.getElementById("appToast");

  // State
  let visualPrizes = [];
  let wheelInstance = null;
  let campaignState = 'ACTIVE';
  let hasUserWon = false;
  let currentWinningPrizeLabel = "خصم اليوم الوطني 96";
  const currentTermsVersion = "1.1";
  let currentParticipantName = "";
  let currentParticipantPhone = "";

  let toastTimer = null;
  function showToast(message) {
    if (!appToast) return;
    if (toastTimer) clearTimeout(toastTimer);
    appToast.textContent = message;
    appToast.classList.add("is-visible");
    toastTimer = setTimeout(() => {
      appToast.classList.remove("is-visible");
    }, 2800);
  }

  // Saudi phone normalizer
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
                 `🏷️ الكود: ${code}\n` +
                 `أرغب في حجز موعد لغسيل وتلميع سيارتي بالخصم.`;
    return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
  }

  // Web Audio Synthesizer (Zero External Dependencies)
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
    playTick(pitchMod = 1) {
      if (!this.enabled) return;
      try {
        this.init();
        if (!this.ctx) return;
        const now = this.ctx.currentTime;
        
        // High-frequency tactile snap
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = "triangle";
        const baseFreq = (880 + Math.random() * 40) * pitchMod;
        osc.frequency.setValueAtTime(baseFreq, now);
        osc.frequency.exponentialRampToValueAtTime(140, now + 0.038);
        
        gain.gain.setValueAtTime(0.26, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.038);
        
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(now);
        osc.stop(now + 0.04);

        // Low body click for realistic wheel weight
        const subOsc = this.ctx.createOscillator();
        const subGain = this.ctx.createGain();
        subOsc.type = "sine";
        subOsc.frequency.setValueAtTime(180 * pitchMod, now);
        subOsc.frequency.exponentialRampToValueAtTime(60, now + 0.03);
        subGain.gain.setValueAtTime(0.18, now);
        subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.03);
        subOsc.connect(subGain);
        subGain.connect(this.ctx.destination);
        subOsc.start(now);
        subOsc.stop(now + 0.032);
      } catch (e) {}
    },
    playWinFanfare() {
      if (!this.enabled) return;
      try {
        this.init();
        if (!this.ctx) return;
        // Triumphal Royal Chords (C5, E5, G5, B5, C6)
        const notes = [523.25, 659.25, 783.99, 987.77, 1046.5];
        notes.forEach((freq, idx) => {
          const osc = this.ctx.createOscillator();
          const gain = this.ctx.createGain();
          const startTime = this.ctx.currentTime + (idx * 0.1);
          osc.type = "sine";
          osc.frequency.setValueAtTime(freq, startTime);
          gain.gain.setValueAtTime(0.28, startTime);
          gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.75);
          osc.connect(gain);
          gain.connect(this.ctx.destination);
          osc.start(startTime);
          osc.stop(startTime + 0.8);
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
    soundIcon.textContent = isEnabled ? "🔊" : "🔇";
    soundToggleBtn.classList.toggle("is-muted", !isEnabled);
  }

  if (soundToggleBtn) {
    updateSoundUI(soundEngine.enabled);
    soundToggleBtn.addEventListener("click", () => {
      const active = soundEngine.toggle();
      updateSoundUI(active);
      if (active) soundEngine.playTick();
    });
  }

  // Visual Wheel Canvas Engine (High-DPI Retina + 3D Shaded Sectors + Metallic Studs)
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
      const dpr = Math.max(window.devicePixelRatio || 1, 2);
      this.size = 460;
      this.canvas.width = this.size * dpr;
      this.canvas.height = this.size * dpr;
      this.ctx.scale(dpr, dpr);
    }

    initLedRing() {
      const ring = document.getElementById("wheelLedRing");
      if (!ring) return;
      ring.innerHTML = "";
      const totalDots = 20;
      const radius = 228;
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
          background: #FFD000;
          box-shadow: 0 0 10px #FFD000, 0 0 4px #FFF;
          top: calc(50% + ${y}px - 4px);
          left: calc(50% + ${x}px - 4px);
          transition: all 0.18s ease;
        `;
        ring.appendChild(dot);
      }
    }

    draw() {
      const center = this.size / 2;
      const radius = center - 14;

      this.ctx.clearRect(0, 0, this.size, this.size);
      this.ctx.save();
      this.ctx.translate(center, center);
      this.ctx.rotate(this.rotation);

      // 1. Draw Sectors with Rich 3D Gradients
      for (let i = 0; i < this.num; i++) {
        const p = this.prizes[i];
        const start = i * this.arc;
        const end = start + this.arc;
        const midAngle = start + this.arc / 2;

        this.ctx.beginPath();
        this.ctx.moveTo(0, 0);
        this.ctx.arc(0, 0, radius, start, end);

        // Create specialized sector gradients based on prize identity
        const isGrand = p.id === 'signature_upgrade' || p.type === 'upgrade';
        const isGreen = p.color === '#006C35' || p.color === '#005429';
        const isBlue = p.color === '#1D6FB8';

        const grad = this.ctx.createRadialGradient(0, 0, 30, 0, 0, radius);

        if (isGrand) {
          // Fiery Sunset Gold for Signature Grand Prize
          grad.addColorStop(0, "#FF4D00");
          grad.addColorStop(0.5, "#FF8C00");
          grad.addColorStop(0.85, "#FFB800");
          grad.addColorStop(1, "#FFE066");
        } else if (isGreen) {
          // Saudi Royal Emerald Green
          grad.addColorStop(0, "#004722");
          grad.addColorStop(0.6, "#006C35");
          grad.addColorStop(1, "#0A8A48");
        } else if (isBlue) {
          // Go Wash Electric Sapphire
          grad.addColorStop(0, "#082B54");
          grad.addColorStop(0.55, "#105EA6");
          grad.addColorStop(1, "#0099FF");
        } else {
          // Midnight Obsidian Navy
          grad.addColorStop(0, "#07172B");
          grad.addColorStop(0.6, "#0E294B");
          grad.addColorStop(1, "#183F72");
        }

        this.ctx.fillStyle = grad;
        this.ctx.fill();

        // Subtle Inner Sector Bevel / Glow
        this.ctx.save();
        this.ctx.beginPath();
        this.ctx.arc(0, 0, radius - 2, start + 0.01, end - 0.01);
        this.ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
        this.ctx.lineWidth = 1.5;
        this.ctx.stroke();
        this.ctx.restore();

        // Sector Divider Lines (Metallic Specular Edge)
        this.ctx.beginPath();
        this.ctx.moveTo(0, 0);
        this.ctx.lineTo(Math.cos(start) * radius, Math.sin(start) * radius);
        this.ctx.lineWidth = 2.8;
        this.ctx.strokeStyle = "rgba(255, 235, 170, 0.4)";
        this.ctx.stroke();

        this.ctx.beginPath();
        this.ctx.moveTo(0, 0);
        this.ctx.lineTo(Math.cos(start) * radius, Math.sin(start) * radius);
        this.ctx.lineWidth = 1;
        this.ctx.strokeStyle = "rgba(255, 255, 255, 0.85)";
        this.ctx.stroke();

        // 2. Sector Typography (High-Contrast Bold with Drop Shadow)
        this.ctx.save();
        this.ctx.rotate(midAngle);
        this.ctx.textAlign = "right";
        this.ctx.textBaseline = "middle";

        // Text Drop Shadow
        this.ctx.shadowColor = "rgba(0, 0, 0, 0.85)";
        this.ctx.shadowBlur = 8;
        this.ctx.shadowOffsetX = 1;
        this.ctx.shadowOffsetY = 2;

        if (isGrand) {
          // Grand Prize: Crown Icon + Bold Signature
          this.ctx.fillStyle = "#FFFFFF";
          this.ctx.font = "900 21px 'Cairo', sans-serif";
          this.ctx.fillText("👑 " + p.label, radius - 24, 0);

          this.ctx.fillStyle = "#FFF7CC";
          this.ctx.font = "800 11px 'Cairo', sans-serif";
          this.ctx.fillText("ترقية شاملة", radius - 24, 22);
        } else {
          this.ctx.fillStyle = p.text_color || "#FFFFFF";
          this.ctx.font = "900 22px 'Cairo', sans-serif";
          this.ctx.fillText(p.label, radius - 24, 0);

          if (p.subtext) {
            this.ctx.fillStyle = "rgba(255, 255, 255, 0.88)";
            this.ctx.font = "700 11px 'Cairo', sans-serif";
            const shortSub = p.subtext.includes("خصم") ? "خصم فوري" : p.subtext;
            this.ctx.fillText(shortSub, radius - 24, 20);
          }
        }
        this.ctx.restore();
      }

      // 3. Draw Outer 3D Metallic Bezel (Gold Rim)
      this.ctx.beginPath();
      this.ctx.arc(0, 0, radius, 0, Math.PI * 2);
      this.ctx.lineWidth = 9;
      const rimGrad = this.ctx.createLinearGradient(-radius, -radius, radius, radius);
      rimGrad.addColorStop(0, "#FFF3B0");
      rimGrad.addColorStop(0.25, "#B38200");
      rimGrad.addColorStop(0.5, "#FFEAA7");
      rimGrad.addColorStop(0.75, "#7A5900");
      rimGrad.addColorStop(1, "#FFD000");
      this.ctx.strokeStyle = rimGrad;
      this.ctx.stroke();

      // 4. Draw 24 Golden Rivets / Studded Chrome Pegs around the Perimeter
      const totalRivets = 24;
      for (let r = 0; r < totalRivets; r++) {
        const rivetAngle = (r / totalRivets) * Math.PI * 2;
        const rx = Math.cos(rivetAngle) * (radius - 1);
        const ry = Math.sin(rivetAngle) * (radius - 1);

        // Rivet Base Shadow
        this.ctx.beginPath();
        this.ctx.arc(rx, ry, 4.2, 0, Math.PI * 2);
        this.ctx.fillStyle = "rgba(0, 0, 0, 0.75)";
        this.ctx.fill();

        // Rivet Metallic Sphere
        const rGrad = this.ctx.createRadialGradient(rx - 1.2, ry - 1.2, 0.5, rx, ry, 3.8);
        rGrad.addColorStop(0, "#FFFFFF");
        rGrad.addColorStop(0.35, "#FFE680");
        rGrad.addColorStop(0.8, "#B8860B");
        rGrad.addColorStop(1, "#593E00");
        this.ctx.beginPath();
        this.ctx.arc(rx, ry, 3.6, 0, Math.PI * 2);
        this.ctx.fillStyle = rGrad;
        this.ctx.fill();
      }

      this.ctx.restore();
    }

    calculateAngle(targetPrizeId) {
      let targetIndex = this.prizes.findIndex(p => p.id === targetPrizeId);
      if (targetIndex === -1) targetIndex = 0;

      // Pointer is at TOP (3 * PI / 2)
      const targetMid = (targetIndex + 0.5) * this.arc;
      const targetAngle = (3 * Math.PI / 2) - targetMid;

      const fullCircle = 2 * Math.PI;
      const normalized = (targetAngle % fullCircle + fullCircle) % fullCircle;
      const extraSpins = (6 + Math.floor(Math.random() * 2)) * fullCircle;
      return extraSpins + normalized;
    }

    spinTo(targetAngle, onComplete) {
      if (this.isSpinning) return;
      this.isSpinning = true;

      const pointer = document.getElementById("wheelPointer");
      const dots = document.querySelectorAll(".led-dot");

      const startAngle = this.rotation % (2 * Math.PI);
      const totalDelta = targetAngle - startAngle;
      const duration = 5000;
      const startTime = performance.now();

      // Quintic Ease-out for smooth natural deceleration
      const easeOut = (t) => 1 - Math.pow(1 - t, 5);
      let lastTickIndex = -1;

      const animate = (now) => {
        const elapsed = now - startTime;
        const progress = Math.min(1, elapsed / duration);
        const eased = easeOut(progress);

        this.rotation = startAngle + (totalDelta * eased);
        this.draw();

        // Realistic Tick Physics & Dynamic Pitch
        const currentTick = Math.floor((this.rotation + this.arc / 2) / this.arc);
        if (currentTick !== lastTickIndex) {
          lastTickIndex = currentTick;
          // Pitch modulates with remaining speed
          const speedFactor = 1 - progress;
          soundEngine.playTick(0.85 + speedFactor * 0.35);
          if (pointer) {
            pointer.classList.remove("is-ticking");
            void pointer.offsetWidth;
            pointer.classList.add("is-ticking");
          }
          if (navigator.vibrate) {
            try { navigator.vibrate(8); } catch (e) {}
          }
        }

        // LED Neon Chase Sequence
        if (dots.length > 0) {
          const activeIdx = Math.floor((this.rotation * 3.5) % dots.length);
          dots.forEach((dot, idx) => {
            if (idx === activeIdx || idx === (activeIdx + 1) % dots.length) {
              dot.style.background = "#00C2FF";
              dot.style.boxShadow = "0 0 16px #00C2FF, 0 0 6px #FFF";
              dot.style.transform = "scale(1.35)";
            } else {
              dot.style.background = "#FFD000";
              dot.style.boxShadow = "0 0 8px rgba(255, 208, 0, 0.7)";
              dot.style.transform = "scale(1)";
            }
          });
        }

        if (progress < 1) {
          requestAnimationFrame(animate);
        } else {
          this.isSpinning = false;
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

  // Display Winner & Populate VIP Ticket
  function displayWinner(prize, promo, participantData) {
    hasUserWon = true;
    currentWinningPrizeLabel = prize.label;
    const name = participantData?.name || participantNameInput?.value?.trim() || 'عميل Go Wash المميز';
    const phone = participantData?.phone || normalizeSaudiPhone(participantPhoneInput?.value) || '';

    // 1. Update Persistent VIP Ticket in the page
    if (ticketBadgeText) ticketBadgeText.textContent = "🇸🇦 تذكرة الفائز · اليوم الوطني 96";
    if (ticketKickerText) ticketKickerText.textContent = "جائزتك مع Go Wash:";
    if (ticketStatusBadge) {
      ticketStatusBadge.textContent = "مفعل وجاهز للاستخدام";
      ticketStatusBadge.className = "ticket-status-live";
    }
    if (ticketRedeemedNotice) ticketRedeemedNotice.style.display = "none";

    savedPrizeTitle.textContent = prize.label;
    savedPrizeSubtext.textContent = prize.subtext || '';
    savedParticipantName.textContent = name;
    savedParticipantPhone.textContent = phone;
    savedPromoCode.textContent = promo.code;

    const bookingUrl = getWhatsAppUrl(promo.code, prize.label, prize.subtext);
    savedBookingBtn.href = bookingUrl;
    bookingCtaBtn.href = bookingUrl;

    // QR Code Display in VIP Ticket & Winner Modal
    const qrSrc = promo.qrDataUrl || (promo.qrToken ? `/api/qr/${promo.qrToken}` : '');
    const savedQrWrapper = document.getElementById("savedQrWrapper");
    const savedQrCodeImg = document.getElementById("savedQrCodeImg");
    if (savedQrWrapper && savedQrCodeImg && qrSrc) {
      savedQrCodeImg.src = qrSrc;
      savedQrWrapper.style.display = "flex";
    }

    const modalQrWrapper = document.getElementById("modalQrWrapper");
    const winnerQrCodeImg = document.getElementById("winnerQrCodeImg");
    if (modalQrWrapper && winnerQrCodeImg && qrSrc) {
      winnerQrCodeImg.src = qrSrc;
      modalQrWrapper.style.display = "flex";
    }

    if (entryStepSection) entryStepSection.style.display = "none";
    winnerPersistentCard.style.display = "block";
    spinBtnLabel.textContent = "تم استلام جائزتك 🎉";
    spinBtn.disabled = true;

    // 2. Save to localStorage (UX caching only, PostgreSQL is true source)
    const payload = {
      name,
      phone,
      prize: { label: prize.label, type: prize.type, subtext: prize.subtext },
      promo: {
        code: promo.code,
        status: promo.status || 'ACTIVE',
        expiresAt: promo.expiresAt,
        qrToken: promo.qrToken,
        qrDataUrl: promo.qrDataUrl
      },
      wonAt: new Date().toISOString()
    };
    try {
      localStorage.setItem("gowash_saved_prize", JSON.stringify(payload));
    } catch (e) {}

    // 3. Populate Celebration Modal (Event Moment)
    const isSignature = (prize.type === 'UPGRADE') || (prize.label && prize.label.toUpperCase().includes('SIGNATURE'));

    if (isSignature) {
      modalPrizeCard.innerHTML = `
        <div style="display: inline-block; background: #FFE259; color: #000; font-weight: 900; font-size: 0.8rem; padding: 3px 12px; border-radius: 999px; margin-bottom: 6px;">الجائزة الكبرى</div>
        <div class="prize-title-custom" style="color: #00C2FF;">GOWASH SIGNATURE</div>
        <div class="prize-sub-custom">ادفع العادي واحصل على Signature</div>
      `;
    } else {
      modalPrizeCard.innerHTML = `
        <div class="prize-percent-huge">${prize.label}</div>
        <div class="prize-sub-custom">أنت الفائز — ${prize.subtext || 'خصم مباشر على الخدمة'}</div>
      `;
    }

    promoCodeDisplay.textContent = promo.code;

    // Open Modal and fire confetti
    winnerModal.showModal();
    launchConfetti();
  }

  // 60fps 3D Metallic Confetti Cannon (Gold, Emerald, Cyan & Pure White)
  function launchConfetti() {
    const canvas = document.getElementById("confettiCanvas");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    canvas.style.display = "block";

    const colors = ["#FFD700", "#FFE875", "#10B981", "#00C2FF", "#FF6600", "#FFFFFF", "#F59E0B"];
    const particles = [];
    const total = 160;

    for (let i = 0; i < total; i++) {
      const isLeft = i < total / 2;
      particles.push({
        x: isLeft ? 50 + Math.random() * 100 : canvas.width - (50 + Math.random() * 100),
        y: canvas.height - 40,
        vx: (isLeft ? 1 : -1) * (Math.random() * 11 + 5),
        vy: -(Math.random() * 17 + 12),
        size: Math.random() * 9 + 6,
        color: colors[Math.floor(Math.random() * colors.length)],
        rotation: Math.random() * 360,
        rotSpeed: (Math.random() - 0.5) * 14,
        tilt: Math.random() * Math.PI,
        tiltSpeed: Math.random() * 0.12 + 0.06,
        isRibbon: Math.random() > 0.4,
        opacity: 1
      });
    }

    let start = performance.now();
    const duration = 4200;

    function render(now) {
      const elapsed = now - start;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      let alive = false;
      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.38;
        p.vx *= 0.985;
        p.rotation += p.rotSpeed;
        p.tilt += p.tiltSpeed;

        if (elapsed > 2800) {
          p.opacity = Math.max(0, 1 - (elapsed - 2800) / 1400);
        }

        if (p.opacity > 0 && p.y < canvas.height + 40) {
          alive = true;
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate((p.rotation * Math.PI) / 180);
          ctx.globalAlpha = p.opacity;
          ctx.fillStyle = p.color;

          // 3D Perspective Tumble (Cosine Scaling)
          const scaleY = Math.cos(p.tilt);
          ctx.scale(1, scaleY);

          if (p.isRibbon) {
            ctx.fillRect(-p.size / 2, -p.size * 0.75, p.size, p.size * 1.5);
          } else {
            ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
          }
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

  // Render Returning Customer State (Persistent DB Driven)
  function renderReturningCustomer(res) {
    hasUserWon = true;
    currentWinningPrizeLabel = res.label || "خصم اليوم الوطني 96";
    document.body.classList.add("is-returning-customer");

    const name = res.participant?.name || res.name || 'عميل Go Wash المميز';
    const phone = res.participant?.phone || res.phone || '';

    if (ticketBadgeText) ticketBadgeText.textContent = "🇸🇦 أنت شاركت بالفعل";
    if (ticketKickerText) ticketKickerText.textContent = "جائزتك مع Go Wash:";
    savedPrizeTitle.textContent = res.label;
    savedPrizeSubtext.textContent = res.subtext || 'خصم Go Wash على جميع باقات الغسيل المتنقل';
    savedPromoCode.textContent = res.code || '---';
    savedParticipantName.textContent = name;
    savedParticipantPhone.textContent = phone;

    const bookingUrl = getWhatsAppUrl(res.code, res.label, res.subtext);
    savedBookingBtn.href = bookingUrl;
    bookingCtaBtn.href = bookingUrl;

    // Server-side State Determination (No Spin / Already Spun / Redeemed / Expired)
    const status = res.status || 'ACTIVE';
    if (status === 'ACTIVE' || status === 'ALREADY_SPUN') {
      if (ticketStatusBadge) {
        ticketStatusBadge.textContent = "كودك نشط وجاهز للاستخدام";
        ticketStatusBadge.className = "ticket-status-live";
      }
      if (ticketRedeemedNotice) ticketRedeemedNotice.style.display = "none";
    } else if (status === 'REDEEMED') {
      if (ticketStatusBadge) {
        ticketStatusBadge.textContent = "مُستخدَم (تم الصرف)";
        ticketStatusBadge.className = "ticket-status-live redeemed";
      }
      const redeemedStr = res.redeemedAt ? new Date(res.redeemedAt).toLocaleString('ar-SA', { timeZone: 'Asia/Riyadh' }) : '';
      if (ticketRedeemedNotice) {
        ticketRedeemedNotice.style.display = "block";
        ticketRedeemedNotice.className = "ticket-status-notice redeemed";
        ticketRedeemedNotice.innerHTML = `✅ تم صرف واستخدام هذه الجائزة مسبقاً لدى Go Wash ${redeemedStr ? `(بتاريخ: <strong>${redeemedStr}</strong>)` : ''}. شكراً لمشاركتك!`;
      }
    } else if (status === 'EXPIRED') {
      if (ticketStatusBadge) {
        ticketStatusBadge.textContent = "منتهي الصلاحية";
        ticketStatusBadge.className = "ticket-status-live expired";
      }
      if (ticketRedeemedNotice) {
        ticketRedeemedNotice.style.display = "block";
        ticketRedeemedNotice.className = "ticket-status-notice expired";
        ticketRedeemedNotice.innerHTML = "⏳ انتهت فترة صلاحية هذا الكود (مدة الصلاحية 48 ساعة من تاريخ الحصول عليه).";
      }
    } else if (status === 'CANCELLED') {
      if (ticketStatusBadge) {
        ticketStatusBadge.textContent = "ملغي";
        ticketStatusBadge.className = "ticket-status-live cancelled";
      }
      if (ticketRedeemedNotice) {
        ticketRedeemedNotice.style.display = "block";
        ticketRedeemedNotice.className = "ticket-status-notice cancelled";
        ticketRedeemedNotice.innerHTML = "⚠️ تم إلغاء هذا الكود من قبل الإدارة.";
      }
    }

    // QR Code display in VIP ticket
    const qrSrc = res.qrDataUrl || (res.qrToken ? `/api/qr/${res.qrToken}` : '');
    const savedQrWrapper = document.getElementById("savedQrWrapper");
    const savedQrCodeImg = document.getElementById("savedQrCodeImg");
    if (savedQrWrapper && savedQrCodeImg && qrSrc) {
      savedQrCodeImg.src = qrSrc;
      savedQrWrapper.style.display = "flex";
    }

    if (entryStepSection) entryStepSection.style.display = "none";
    if (wheelArena) wheelArena.style.display = "none";
    winnerPersistentCard.style.display = "block";
    spinBtnLabel.textContent = "أنت شاركت بالفعل";
    spinBtn.disabled = true;

    // Cache to localStorage solely as UX cache (PostgreSQL is authoritative)
    try {
      localStorage.setItem("gowash_saved_prize", JSON.stringify({
        name,
        phone,
        prize: { label: res.label, type: res.type, subtext: res.subtext },
        promo: {
          code: res.code,
          status: res.status,
          expiresAt: res.expiresAt,
          redeemedAt: res.redeemedAt,
          qrToken: res.qrToken,
          qrDataUrl: res.qrDataUrl
        },
        wonAt: res.createdAt || new Date().toISOString()
      }));
    } catch (e) {}
  }

  // Check existing saved prize from backend (Primary) or local storage (Secondary cache)
  function checkExistingSavedPrize(backendParticipant) {
    if (backendParticipant && backendParticipant.hasSpun && backendParticipant.existingResult) {
      renderReturningCustomer(backendParticipant.existingResult);
      return true;
    }

    if (backendParticipant && !backendParticipant.hasSpun) {
      try {
        localStorage.removeItem("gowash_saved_prize");
      } catch (e) {}
      return false;
    }

    // Secondary local fallback if offline
    try {
      const localData = localStorage.getItem("gowash_saved_prize");
      if (localData) {
        const parsed = JSON.parse(localData);
        if (parsed && parsed.promo && parsed.promo.code) {
          renderReturningCustomer({
            label: parsed.prize.label,
            type: parsed.prize.type,
            subtext: parsed.prize.subtext,
            code: parsed.promo.code,
            status: parsed.promo.status || 'ACTIVE',
            expiresAt: parsed.promo.expiresAt,
            redeemedAt: parsed.promo.redeemedAt,
            qrToken: parsed.promo.qrToken,
            qrDataUrl: parsed.promo.qrDataUrl,
            name: parsed.name,
            phone: parsed.phone
          });
          return true;
        }
      }
    } catch (e) {}

    return false;
  }

  // Update social links
  function updateSocialLinks(links) {
    if (!links) return;
    const whats = document.getElementById("socialWhatsapp");
    const instas = document.getElementById("socialInstagram");
    const tiks = document.getElementById("socialTiktok");

    if (whats && links.whatsapp) whats.href = links.whatsapp;
    if (instas && links.instagram) instas.href = links.instagram;
    if (tiks && links.tiktok) tiks.href = links.tiktok;
  }

  // Load campaign metadata & query persistent result via GET /api/my-result
  async function initCampaign() {
    try {
      const res = await apiFetch("/api/campaign");
      const data = await res.json();

      if (!data.success) {
        spinStatusMsg.textContent = data.error || "تعذر تحميل بيانات الفعالية.";
        spinStatusMsg.className = "spin-status-banner error";
        spinBtn.disabled = true;
        return;
      }

      if (data.participantId) {
        try { localStorage.setItem("gowash_pid", data.participantId); } catch (e) {}
      }

      campaignState = data.campaign.status;
      visualPrizes = data.prizes;

      if (data.campaign.socialLinks) {
        updateSocialLinks(data.campaign.socialLinks);
      }

      wheelInstance = new VisualWheel("wheelCanvas", visualPrizes);

      if (campaignState === 'PAUSED') {
        campaignAlert.style.display = "block";
        campaignAlert.textContent = "⚠️ فعالية اليوم الوطني 96 متوقفة مؤقتاً حالياً.";
        campaignAlert.className = "campaign-alert-bar paused";
        spinBtn.disabled = true;
        return;
      }

      if (campaignState === 'ENDED') {
        campaignAlert.style.display = "block";
        campaignAlert.textContent = "🛑 انتهت فعالية اليوم الوطني السعودي 96. شكراً لكم!";
        campaignAlert.className = "campaign-alert-bar";
        spinBtn.disabled = true;
        return;
      }

      // Query PostgreSQL persistent state via GET /api/my-result
      try {
        const myRes = await apiFetch("/api/my-result");
        const myResultData = await myRes.json();
        if (myResultData && myResultData.success) {
          if (myResultData.status === 'NO_SPIN') {
            try { localStorage.removeItem("gowash_saved_prize"); } catch (e) {}
          } else {
            renderReturningCustomer({
              label: myResultData.prize.label,
              type: myResultData.prize.type,
              subtext: myResultData.prize.subtext,
              code: myResultData.promo.code,
              status: myResultData.status,
              expiresAt: myResultData.promo.expiresAt,
              redeemedAt: myResultData.promo.redeemedAt,
              name: myResultData.participant?.name,
              phone: myResultData.participant?.phone
            });
            return;
          }
        }
      } catch (err) {
        console.warn("My-result check warning:", err);
      }

      // Fallback check from campaign payload
      checkExistingSavedPrize(data.participant);

    } catch (err) {
      console.error("Init campaign error:", err);
      spinStatusMsg.textContent = "تعذر الاتصال بالخادم. يرجى تحديث الصفحة.";
      spinStatusMsg.className = "spin-status-banner error";
      spinBtn.disabled = true;
    }
  }

  // Copy code helper with clear toast feedback
  function setupCopyBtn(btn, textSpan, codeSourceEl) {
    btn?.addEventListener("click", async () => {
      const code = codeSourceEl.textContent.trim();
      if (!code || code.includes('XXXX') || code === '--------') return;
      try {
        await navigator.clipboard.writeText(code);
        if (navigator.vibrate) {
          try { navigator.vibrate(35); } catch (e) {}
        }
        showToast("تم نسخ الكود");
        if (textSpan) {
          const original = textSpan.textContent;
          textSpan.textContent = "تم النسخ!";
          setTimeout(() => { textSpan.textContent = original; }, 2000);
        }
      } catch (e) {
        showToast("تم نسخ الكود");
      }
    });
  }

  setupCopyBtn(copyCodeBtn, copyBtnText, promoCodeDisplay);
  setupCopyBtn(copySavedCodeBtn, copySavedCodeText, savedPromoCode);

  // Social Sharing Telemetry & Safe Link Sharing
  async function shareWinner(prizeLabel) {
    const prize = prizeLabel || currentWinningPrizeLabel || "خصماً حصرياً";
    const shareText = `لقد ربحت ${prize} مع Go Wash في فعالية اليوم الوطني السعودي 96! جرب حظك والعب الآن:`;
    const shareUrl = window.location.origin + window.location.pathname;

    // Send share telemetry to Railway Backend
    apiFetch("/api/share-event", {
      method: "POST",
      body: JSON.stringify({
        channel: navigator.share ? "native_share" : "clipboard_copy",
        promoCode: promoCodeDisplay ? promoCodeDisplay.textContent : null
      })
    }).catch(() => {});

    if (navigator.share) {
      try {
        await navigator.share({
          title: "Go Wash — فعالية اليوم الوطني السعودي 96",
          text: shareText,
          url: shareUrl
        });
        return;
      } catch (err) {
        if (err.name === 'AbortError') return;
      }
    }

    // Fallback: Copy share text
    try {
      await navigator.clipboard.writeText(`${shareText}\n${shareUrl}`);
      showToast("تم نسخ نص المشاركة بنجاح! شاركه الآن مع أصدقائك.");
    } catch (err) {
      showToast("تم نسخ رابط الفعالية لمشاركته مع أصدقائك.");
    }
  }

  shareResultBtn?.addEventListener("click", () => shareWinner(currentWinningPrizeLabel));
  savedShareBtn?.addEventListener("click", () => shareWinner(savedPrizeTitle ? savedPrizeTitle.textContent : ""));

  // How to use scroll helper
  function scrollToHowToUse() {
    if (winnerModal && winnerModal.open) {
      winnerModal.close();
    }
    if (howToUseSection) {
      howToUseSection.scrollIntoView({ behavior: "smooth" });
    }
  }

  savedHowToUseBtn?.addEventListener("click", scrollToHowToUse);
  modalHowToUseBtn?.addEventListener("click", scrollToHowToUse);

  // Modal Closers
  modalCloseBtn?.addEventListener("click", () => winnerModal.close());
  termsCloseIcon?.addEventListener("click", () => termsModal.close());
  recoverCloseBtn?.addEventListener("click", () => recoverModal.close());

  // Decline Terms ("غير موافق")
  declineTermsBtn?.addEventListener("click", () => {
    termsModal.close();
    showToast("يلزمك الموافقة على الشروط والأحكام للمشاركة في الفعالية.");
  });

  // Accept Terms ("موافق") -> Advances to Step 2 (بيانات استلام الجائزة)
  acceptTermsBtn?.addEventListener("click", () => {
    apiFetch("/api/consent", {
      method: "POST",
      body: JSON.stringify({ termsAccepted: true, termsVersion: currentTermsVersion })
    }).catch(err => console.warn("Consent async error:", err));

    if (termsStep1 && termsStep2) {
      termsStep1.style.display = "none";
      termsStep2.style.display = "block";
      setTimeout(() => participantNameInput?.focus(), 80);
    }
  });

  // Back to Terms from Step 2
  backToTermsBtn?.addEventListener("click", () => {
    if (termsStep1 && termsStep2) {
      termsStep2.style.display = "none";
      termsStep1.style.display = "block";
    }
  });

  openRecoverModalBtn?.addEventListener("click", () => {
    recoverErrorMsg.textContent = "";
    recoverPhoneInput.value = "";
    recoverModal.showModal();
  });

  // Recover by phone
  submitRecoverBtn?.addEventListener("click", async () => {
    const raw = recoverPhoneInput.value.trim();
    const phone = normalizeSaudiPhone(raw);
    if (!phone) {
      recoverErrorMsg.textContent = "يرجى إدخال رقم جوال سعودي صحيح (05xxxxxxxx).";
      return;
    }
    recoverErrorMsg.textContent = "جاري البحث عن جائزتك...";

    try {
      const res = await apiFetch("/api/check-prize", {
        method: "POST",
        body: JSON.stringify({ phone })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        recoverErrorMsg.textContent = data.message || data.error || "لا توجد جائزة مسجلة بهذا الرقم.";
        return;
      }

      recoverModal.close();
      renderReturningCustomer({
        label: data.prize.label,
        type: data.prize.type,
        subtext: data.prize.subtext,
        code: data.promo.code,
        status: data.promo.status || 'ACTIVE',
        expiresAt: data.promo.expiresAt,
        redeemedAt: data.promo.redeemedAt,
        createdAt: data.promo.createdAt,
        qrToken: data.promo.qrToken,
        qrDataUrl: data.promo.qrDataUrl,
        participant: data.participant
      });
      showToast("تم استرجاع جائزتك بنجاح!");
    } catch (e) {
      recoverErrorMsg.textContent = "حدث خطأ أثناء الاتصال. يرجى المحاولة لاحقاً.";
    }
  });

  // --------------------------------------------------------------------------
  // User clicks [ لف واربح ] (Wheel Button)
  // ↓
  // If already won: scroll to ticket
  // If not: open Terms & Conditions Modal (Step 1 with موافق / غير موافق)
  // ↓
  // If "غير موافق": close modal, no spin, show toast
  // If "موافق": switch to Step 2 (Name & Saudi Phone)
  // ↓
  // User clicks [ ابدأ السحب 🎡 ]: Validate data -> POST /api/spin -> Spin Wheel!
  // --------------------------------------------------------------------------

  spinBtn?.addEventListener("click", () => {
    if (hasUserWon) {
      winnerPersistentCard?.scrollIntoView({ behavior: "smooth" });
      return;
    }

    if (!wheelInstance || wheelInstance.isSpinning) return;
    if (campaignState !== 'ACTIVE') return;

    // Open Terms Modal at Step 1 (الشروط والأحكام)
    if (termsStep1 && termsStep2) {
      termsStep1.style.display = "block";
      termsStep2.style.display = "none";
    }
    if (nameErrorMsg) nameErrorMsg.textContent = "";
    if (phoneErrorMsg) phoneErrorMsg.textContent = "";

    termsModal.showModal();
  });

  // Submit Lead Capture & Start Spin
  async function handleSpinSubmission() {
    if (nameErrorMsg) nameErrorMsg.textContent = "";
    if (phoneErrorMsg) phoneErrorMsg.textContent = "";

    const name = participantNameInput?.value?.trim() || "";
    if (name.length < 2) {
      if (nameErrorMsg) nameErrorMsg.textContent = "يرجى إدخال اسمك الكريم (حرفين على الأقل).";
      participantNameInput?.focus();
      return;
    }

    const rawPhone = participantPhoneInput?.value?.trim() || "";
    const phone = normalizeSaudiPhone(rawPhone);
    if (!phone) {
      if (phoneErrorMsg) phoneErrorMsg.textContent = "يرجى إدخال رقم جوال سعودي صحيح يبدأ بـ 05 (10 أرقام).";
      participantPhoneInput?.focus();
      return;
    }

    // Validation passed: Close modal & start spin
    termsModal.close();

    spinBtn.disabled = true;
    spinBtnLabel.textContent = "جاري السحب...";
    spinStatusMsg.textContent = "جاري الاتصال بالنظام المشفر واختيار هديتك...";
    spinStatusMsg.className = "spin-status-banner";

    let idempotencyKey = sessionStorage.getItem("gowash_idempotency_key");
    if (!idempotencyKey) {
      idempotencyKey = "idemp_" + Math.random().toString(36).substring(2) + Date.now();
      sessionStorage.setItem("gowash_idempotency_key", idempotencyKey);
    }

    try {
      // Step 1: POST /api/consent
      try {
        await apiFetch("/api/consent", {
          method: "POST",
          body: JSON.stringify({
            termsAccepted: true,
            termsVersion: currentTermsVersion,
            name,
            phone
          })
        });
      } catch (consentErr) {
        console.warn("Consent recording notice:", consentErr);
      }

      // Step 2: POST /api/spin
      const response = await apiFetch("/api/spin", {
        method: "POST",
        headers: {
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
        spinBtnLabel.textContent = "لف واربح";
        const errMsg = data.message || data.error || "حدث خطأ أثناء السحب.";
        spinStatusMsg.textContent = errMsg;
        spinStatusMsg.className = "spin-status-banner error";

        if (data.code === 'ALREADY_SPUN') {
          spinBtn.disabled = true;
          spinBtnLabel.textContent = "أنت شاركت بالفعل";
          if (data.existingPrize) {
            renderReturningCustomer(data.existingPrize);
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
      spinBtnLabel.textContent = "لف واربح";
      spinStatusMsg.textContent = "فشل الاتصال بالخادم. يرجى المحاولة مجدداً.";
      spinStatusMsg.className = "spin-status-banner error";
    }
  }

  startSpinSubmitBtn?.addEventListener("click", handleSpinSubmission);

  participantNameInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      participantPhoneInput?.focus();
    }
  });

  participantPhoneInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSpinSubmission();
    }
  });

  // Start initialization
  initCampaign();
});
